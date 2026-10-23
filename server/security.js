'use strict';
/*
 * Các hàm mật mã dùng chung: token ngẫu nhiên, băm, JWT của Portal, mật khẩu admin,
 * mã hoá mã coupon khi lưu DB, giới hạn tần suất (rate limit).
 */
const crypto = require('crypto');
const env = require('./env');

function randomToken(bytes) { return crypto.randomBytes(bytes || 32).toString('base64url'); }
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function hmac(key, data, enc) { return crypto.createHmac('sha256', key).update(data).digest(enc || 'hex'); }

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// Khoá con dẫn xuất từ APP_SECRET để mỗi mục đích dùng một khoá riêng.
function subKey(purpose, len) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(env.APP_SECRET), Buffer.from('hlw2026'), Buffer.from(purpose), len || 32));
}

// ------------------------------------------------------------ JWT (HS256) từ Portal
function b64urlJson(part) {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function signJwt(payload, secret) {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s = hmac(secret, h + '.' + p, 'base64url');
  return h + '.' + p + '.' + s;
}

class TokenError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/*
 * Token Portal gửi sang có dạng JWT HS256: { sub: "<mã khách hàng>", iat, exp, jti?, aud? }
 * Ký bằng PORTAL_JWT_SECRET (chỉ Portal backend và game server biết).
 */
function verifyPortalJwt(token, nowMs) {
  const now = Math.floor((nowMs || Date.now()) / 1000);
  if (typeof token !== 'string' || token.length > 4096) throw new TokenError('malformed', 'Token không hợp lệ');
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('malformed', 'Token không hợp lệ');
  let header, payload;
  try { header = b64urlJson(parts[0]); payload = b64urlJson(parts[1]); } catch (e) { throw new TokenError('malformed', 'Token không hợp lệ'); }
  if (!header || header.alg !== 'HS256') throw new TokenError('alg', 'Thuật toán ký không được chấp nhận');
  const expected = hmac(env.PORTAL_JWT_SECRET, parts[0] + '.' + parts[1], 'base64url');
  if (!safeEqual(expected, parts[2])) throw new TokenError('signature', 'Chữ ký token không đúng');
  if (!payload || typeof payload !== 'object') throw new TokenError('malformed', 'Token không hợp lệ');
  const sub = payload.sub === undefined || payload.sub === null ? '' : String(payload.sub);
  if (!/^[A-Za-z0-9_.:@-]{1,64}$/.test(sub)) throw new TokenError('sub', 'Mã khách hàng không hợp lệ');
  if (typeof payload.exp !== 'number') throw new TokenError('exp', 'Token thiếu thời hạn');
  if (payload.exp < now - 30) throw new TokenError('expired', 'Token đã hết hạn');
  const iat = typeof payload.iat === 'number' ? payload.iat : now;
  if (iat > now + 120) throw new TokenError('iat', 'Thời điểm phát hành token không hợp lệ');
  if (payload.exp - iat > env.PORTAL_TOKEN_MAX_TTL) throw new TokenError('ttl', 'Thời hạn token quá dài');
  if (env.PORTAL_JWT_AUDIENCE) {
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.PORTAL_JWT_AUDIENCE)) throw new TokenError('aud', 'Token không dành cho ứng dụng này');
  }
  const rawEmail = payload[env.PORTAL_JWT_EMAIL_CLAIM || 'email'];
  const email = typeof rawEmail === 'string' && /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"']{2,}$/.test(rawEmail.trim()) ? rawEmail.trim().toLowerCase() : null;
  return { sub, email, exp: payload.exp, iat, jti: typeof payload.jti === 'string' ? payload.jti.slice(0, 128) : null };
}

// ------------------------------------------------------------ mật khẩu admin (scrypt)
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pw), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), dk.toString('base64')].join('$');
}
function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const dk = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), expected.length,
      { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
    return crypto.timingSafeEqual(dk, expected);
  } catch (e) { return false; }
}
// Chạy khi username không tồn tại để thời gian phản hồi giống nhau (chống dò tài khoản).
const DUMMY_HASH = hashPassword(randomToken(12));
function burnPasswordCheck(pw) { verifyPassword(pw, DUMMY_HASH); }

function passwordProblems(pw, username) {
  const p = String(pw || '');
  const out = [];
  if (p.length < 10) out.push('Mật khẩu cần ít nhất 10 ký tự.');
  if (!/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/[0-9]/.test(p)) out.push('Mật khẩu cần có chữ thường, chữ hoa và chữ số.');
  if (username && p.toLowerCase().includes(String(username).toLowerCase())) out.push('Mật khẩu không được chứa tên đăng nhập.');
  return out;
}

// ------------------------------------------------------------ mã hoá mã coupon (AES-256-GCM)
let encKey = null;
function couponKey() {
  if (encKey) return encKey;
  if (env.COUPON_ENC_KEY) {
    const k = Buffer.from(env.COUPON_ENC_KEY, /^[0-9a-f]{64}$/i.test(env.COUPON_ENC_KEY) ? 'hex' : 'base64');
    if (k.length !== 32) throw new Error('COUPON_ENC_KEY phải là 32 byte (64 ký tự hex hoặc base64)');
    encKey = k;
  } else {
    encKey = subKey('coupon-enc');
  }
  return encKey;
}
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', couponKey(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decrypt(b64) {
  if (!b64) return null;
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', couponKey(), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}
const hashKey = () => subKey('coupon-hash');
function normalizeCode(code) { return String(code || '').trim().toUpperCase().replace(/\s+/g, ''); }
function codeHash(code) { return hmac(hashKey(), normalizeCode(code)); }

// ------------------------------------------------------------ rate limit (bộ nhớ trong)
const buckets = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.count++;
  return { ok: b.count <= max, retryAfter: Math.ceil((b.reset - now) / 1000), count: b.count };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now >= b.reset) buckets.delete(k);
}, 60000).unref();

module.exports = {
  randomToken, sha256, hmac, safeEqual, subKey, signJwt, verifyPortalJwt, TokenError,
  hashPassword, verifyPassword, burnPasswordCheck, passwordProblems,
  encrypt, decrypt, codeHash, normalizeCode, rateLimit
};
