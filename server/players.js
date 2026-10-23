'use strict';
/*
 * Người chơi: đăng nhập qua token Portal, token truy cập của game, lượt chơi (hồi theo thời gian).
 * Lượt chơi CHỈ được tính ở server — trình duyệt không thể tự cộng lượt.
 */
const db = require('./db');
const env = require('./env');
const sec = require('./security');
const settings = require('./settings');
const { HttpError, clientIp } = require('./http');
const util = require('./util');

function getById(id) { return db.get('SELECT * FROM players WHERE id = ?', id); }
function getByExt(ext) { return db.get('SELECT * FROM players WHERE ext_id = ?', ext); }

function upsert(extId, isTest, now) {
  let p = getByExt(extId);
  if (p) {
    db.run('UPDATE players SET last_seen_at = ? WHERE id = ?', now, p.id);
    return getById(p.id);
  }
  const s = settings.current();
  db.run('INSERT INTO players (ext_id, is_test, created_at, last_seen_at, turns, turns_at) VALUES (?, ?, ?, ?, ?, ?)',
    extId, isTest ? 1 : 0, now, now, s.turns.max, now);
  return getByExt(extId);
}

// ------------------------------------------------------------ token truy cập (Bearer)
function issueToken(player, req, deviceInfo) {
  const token = sec.randomToken(32);
  const now = Date.now();
  const exp = now + env.PLAYER_TOKEN_TTL_H * 3600 * 1000;
  db.run('INSERT INTO auth_tokens (token_hash, player_id, created_at, expires_at, device, ip) VALUES (?, ?, ?, ?, ?, ?)',
    sec.sha256(token), player.id, now, exp, deviceInfo ? deviceInfo.device : null, clientIp(req));
  return { token, expiresAt: exp };
}

function authenticate(req) {
  const h = String(req.headers.authorization || '');
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(h);
  if (!m) throw new HttpError(401, 'unauthorized', 'Bạn cần đăng nhập Portal iNET để chơi');
  const row = db.get('SELECT player_id, expires_at, device FROM auth_tokens WHERE token_hash = ?', sec.sha256(m[1]));
  if (!row || row.expires_at < Date.now()) throw new HttpError(401, 'session_expired', 'Phiên đăng nhập đã hết hạn, vui lòng tải lại trang Portal');
  const p = getById(row.player_id);
  if (!p) throw new HttpError(401, 'unauthorized', 'Không tìm thấy người chơi');
  if (p.banned) throw new HttpError(403, 'banned', 'Tài khoản của bạn đã bị tạm khóa khỏi chương trình' + (p.ban_reason ? ': ' + p.ban_reason : ''));
  req.player = p;
  req.playerDevice = row.device;
  return p;
}

// ------------------------------------------------------------ lượt chơi
function turnState(p, s, now) {
  s = s || settings.current();
  now = now || Date.now();
  const max = s.turns.max;
  const regen = Math.max(30000, Math.round(s.turns.regenMinutes * 60000));
  let turns = Math.min(p.turns, max);
  let anchor = p.turns_at;
  if (turns < max) {
    const gained = Math.floor((now - anchor) / regen);
    if (gained > 0) { turns = Math.min(max, turns + gained); anchor += gained * regen; }
  }
  const full = turns >= max;
  return {
    turns,
    max,
    bonus: p.bonus_turns,
    total: turns + p.bonus_turns,
    regenMs: regen,
    anchor: full ? now : anchor,
    full,
    nextAt: full ? null : anchor + regen
  };
}

function consumeTurn(p, s, now) {
  const st = turnState(p, s, now);
  if (st.turns > 0) {
    db.run('UPDATE players SET turns = ?, turns_at = ? WHERE id = ?', st.turns - 1, st.full ? now : st.anchor, p.id);
  } else if (p.bonus_turns > 0) {
    db.run('UPDATE players SET bonus_turns = bonus_turns - 1, turns = ?, turns_at = ? WHERE id = ?', st.turns, st.anchor, p.id);
  } else {
    throw new HttpError(429, 'no_turns', 'Bạn đã hết lượt chơi', { nextAt: st.nextAt });
  }
  return turnState(getById(p.id), s, now);
}

function publicTurns(st) {
  return { turns: st.turns, max: st.max, bonus: st.bonus, nextAt: st.nextAt, regenMs: st.regenMs };
}

function ownedTiers(playerId) {
  return db.all("SELECT tier_id, COUNT(*) n FROM coupons WHERE player_id = ? AND status != 'revoked' GROUP BY tier_id", playerId)
    .reduce((o, r) => { o[r.tier_id] = r.n; return o; }, {});
}

// ------------------------------------------------------------ đăng nhập
function deviceFrom(req, hint) {
  const ua = String(req.headers['user-agent'] || '').slice(0, 400);
  const h = hint && typeof hint === 'object' ? { device: String(hint.device || ''), touch: !!hint.touch } : null;
  return util.parseUA(ua, h);
}

function recordOpen(p, device) {
  const now = Date.now();
  const { day, hour } = util.vnParts(now);
  db.run('INSERT INTO events (player_id, is_test, type, device, created_at, day, hour) VALUES (?, ?, ?, ?, ?, ?, ?)',
    p.id, p.is_test, 'open', device, now, day, hour);
  db.run('UPDATE players SET device_last = ? WHERE id = ?', device, p.id);
}

function loginWithPortalToken(req, token, hint) {
  const ip = clientIp(req);
  const rl = sec.rateLimit('auth:' + ip, 120, 60000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Thao tác quá nhanh, thử lại sau ít giây');
  let claims;
  try { claims = sec.verifyPortalJwt(token); } catch (e) {
    throw new HttpError(401, 'bad_portal_token', e.code === 'expired'
      ? 'Liên kết chơi game đã hết hạn, vui lòng tải lại trang Portal'
      : 'Không xác thực được tài khoản Portal');
  }
  const now = Date.now();
  if (claims.jti) {
    // Chống dùng lại token (nếu Portal có gửi jti): mỗi jti chỉ dùng được 1 lần.
    const used = db.get('SELECT jti FROM used_jti WHERE jti = ?', claims.jti);
    if (used) throw new HttpError(401, 'token_reused', 'Liên kết chơi game đã được sử dụng, vui lòng tải lại trang Portal');
    db.run('INSERT INTO used_jti (jti, expires_at) VALUES (?, ?)', claims.jti, (claims.exp + 60) * 1000);
  }
  const p = upsert(claims.sub, false, now);
  if (claims.email) db.run('UPDATE players SET email_enc = ? WHERE id = ?', sec.encrypt(claims.email), p.id);
  if (p.banned) throw new HttpError(403, 'banned', 'Tài khoản của bạn đã bị tạm khóa khỏi chương trình');
  const dev = deviceFrom(req, hint);
  const t = issueToken(p, req, dev);
  recordOpen(p, dev.device);
  return { player: p, token: t };
}

// Đăng nhập thử (chỉ bật khi ALLOW_DEMO_LOGIN=true, mặc định TẮT ở production) — dữ liệu gắn cờ test.
function loginDemo(req, id, hint) {
  if (!env.ALLOW_DEMO_LOGIN) throw new HttpError(404, 'not_found', 'Không hỗ trợ');
  const ip = clientIp(req);
  const rl = sec.rateLimit('auth:' + ip, 120, 60000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Thao tác quá nhanh, thử lại sau ít giây');
  const clean = String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || ('guest' + sec.randomToken(3));
  const p = upsert('demo-' + clean, true, Date.now());
  const dev = deviceFrom(req, hint);
  const t = issueToken(p, req, dev);
  recordOpen(p, dev.device);
  return { player: p, token: t };
}

// Đăng nhập khách (khi chưa tích hợp Portal): trình duyệt giữ 1 khoá ngẫu nhiên, máy chủ băm khoá
// thành mã người chơi. Không đoán được khoá của người khác nên không mạo danh được.
function loginGuest(req, key, hint) {
  if (!env.GUEST_LOGIN) throw new HttpError(404, 'not_found', 'Không hỗ trợ');
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{22,64}$/.test(key)) throw new HttpError(400, 'bad_key', 'Dữ liệu không hợp lệ');
  const ip = clientIp(req);
  const rl = sec.rateLimit('auth:' + ip, 120, 60000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Thao tác quá nhanh, thử lại sau ít giây');
  const ext = 'KH' + sec.hmac(sec.subKey('guest-id'), key).slice(0, 10).toUpperCase();
  if (!getByExt(ext)) {
    // hạn chế tạo hàng loạt tài khoản từ 1 địa chỉ IP
    // 4G và Wi-Fi văn phòng có rất nhiều người dùng chung 1 IP -> ngưỡng đủ rộng cho người thật, vẫn chặn tạo hàng loạt
    const rc = sec.rateLimit('guestnew:' + ip, 300, 3600000);
    if (!rc.ok) throw new HttpError(429, 'rate_limited', 'Bạn tạo quá nhiều tài khoản, thử lại sau');
  }
  const p = upsert(ext, false, Date.now());
  if (p.banned) throw new HttpError(403, 'banned', 'Tài khoản của bạn đã bị tạm khóa khỏi chương trình' + (p.ban_reason ? ': ' + p.ban_reason : ''));
  const dev = deviceFrom(req, hint);
  const t = issueToken(p, req, dev);
  recordOpen(p, dev.device);
  return { player: p, token: t };
}

// Admin tạo token chơi thử cho tài khoản test (dữ liệu gắn cờ test, không tính vào thống kê).
function issueTestToken(adminName, req) {
  const p = upsert('test-' + String(adminName).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24), true, Date.now());
  return { player: p, token: issueToken(p, req, { device: 'desktop' }) };
}

function maskId(ext) {
  const s = String(ext);
  if (s.length <= 4) return s[0] + '***';
  return s.slice(0, 2) + '***' + s.slice(-2);
}

module.exports = {
  getById, getByExt, upsert, issueToken, authenticate, turnState, consumeTurn, publicTurns, ownedTiers,
  deviceFrom, loginWithPortalToken, loginDemo, loginGuest, issueTestToken, maskId
};
