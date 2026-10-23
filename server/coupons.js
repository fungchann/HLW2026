'use strict';
/*
 * Coupon: chỉ được tạo ở server, SAU KHI server tự tính lại điểm của lượt chơi.
 *  - 1 lượt chơi tối đa 1 coupon (UNIQUE session_id)
 *  - mỗi người tối đa N coupon mỗi mốc (mặc định 1)
 *  - có thể đặt hạn mức (quota) tổng cho từng mốc
 *  - mã coupon được mã hoá AES-256-GCM khi lưu DB; tra cứu bằng HMAC
 *
 * Nguồn mã (provider):
 *  - mock : sinh mã giả để chạy thử toàn bộ luồng (mặc định)
 *  - pool : lấy lần lượt từ kho mã do Admin nhập (mã tạo sẵn trên hệ thống billing)
 *  - http : gọi API của hệ thống billing để tạo mã (cấu hình URL/KEY trong .env)
 */
const crypto = require('crypto');
const db = require('./db');
const env = require('./env');
const sec = require('./security');
const settings = require('./settings');
const realtime = require('./realtime');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

function tierById(s, id) { return s.tiers.find((t) => t.id === id) || null; }

function ownedCount(playerId, tierId) {
  return db.get("SELECT COUNT(*) n FROM coupons WHERE player_id = ? AND tier_id = ? AND status != 'revoked'", playerId, tierId).n;
}
function issuedCount(tierId) {
  return db.get("SELECT COUNT(*) n FROM coupons WHERE tier_id = ? AND is_test = 0 AND status != 'revoked'", tierId).n;
}

function setCode(couponId, code) {
  db.run("UPDATE coupons SET code_enc = ?, code_hash = ?, status = 'issued', error = NULL WHERE id = ?",
    sec.encrypt(code), sec.codeHash(code), couponId);
}

// Tạo mã cho coupon đang ở trạng thái 'pending'. mock/pool chạy đồng bộ; http chạy bất đồng bộ.
function fulfillSync(c, s) {
  const tier = tierById(s, c.tier_id) || { prefix: 'HLW' };
  if (c.provider === 'mock') {
    for (let i = 0; i < 5; i++) {
      const code = (c.is_test ? 'TEST-' : '') + (tier.prefix || 'HLW') + '-' + randomCode(8);
      try { setCode(c.id, code); return true; } catch (e) { /* trùng mã (rất hiếm) -> thử lại */ }
    }
    db.run('UPDATE coupons SET error = ? WHERE id = ?', 'Không sinh được mã', c.id);
    return false;
  }
  if (c.provider === 'pool') {
    const row = db.get('UPDATE coupon_pool SET coupon_id = ?, assigned_at = ? WHERE id = (SELECT id FROM coupon_pool WHERE tier_id = ? AND coupon_id IS NULL ORDER BY id LIMIT 1) RETURNING code_enc, code_hash',
      c.id, Date.now(), c.tier_id);
    if (!row) {
      db.run('UPDATE coupons SET error = ? WHERE id = ?', 'Kho mã của mốc này đã hết', c.id);
      realtime.activity({ type: 'warning', text: 'Kho mã coupon mốc "' + c.tier_id + '" đã hết — cần nhập thêm mã!' });
      return false;
    }
    db.run("UPDATE coupons SET code_enc = ?, code_hash = ?, status = 'issued', error = NULL WHERE id = ?", row.code_enc, row.code_hash, c.id);
    return true;
  }
  return false;
}

const inflight = new Map();
// Lỗi mạng mà CHẮC CHẮN yêu cầu chưa tới được máy chủ iNET -> thử lại an toàn, không sợ sinh trùng mã
const SAFE_NET_ERRORS = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT']);
const MAX_API_ATTEMPTS = 6;

// "description" gửi API: email khách (từ Portal). Chưa có email -> mã người chơi + mã lượt để tra ngược trong admin.
function couponDescription(c) {
  const p = db.get('SELECT ext_id, email_enc FROM players WHERE id = ?', c.player_id) || {};
  if (p.email_enc) { const e = decryptSafe(p.email_enc); if (e) return e; }
  return 'HLW2026 | ' + (p.ext_id || 'player-' + c.player_id) + ' | luot ' + String(c.session_id || c.id).slice(0, 24);
}

/*
 * API iNET: POST {point, description} + header x-token-api.
 *  - Thành công (HTTP 200): {"code":"ABCDEFGHIJ","status":"approved","promotionValue":20,...}
 *  - Lỗi: CŨNG trả HTTP 200 nhưng {"status":"error","message":"..."} -> phải kiểm tra nội dung
 * Mức giảm do máy chủ iNET quyết theo point; game chỉ gửi point của mốc (cấu hình apiPoint).
 */
async function fulfillHttp(c, s) {
  if (inflight.has(c.id)) return inflight.get(c.id);
  const p = (async () => {
    const fail = (msg, opts) => {
      opts = opts || {};
      db.run('UPDATE coupons SET error = ?, api_attempts = api_attempts + ?, api_uncertain = ? WHERE id = ?',
        String(msg).slice(0, 300), opts.counted === false ? 0 : 1, opts.uncertain ? 1 : 0, c.id);
      if (opts.alert) realtime.activity({ type: 'warning', text: 'Tạo mã coupon #' + c.id + ' lỗi: ' + String(msg).slice(0, 120) });
      return false;
    };
    if (!env.COUPON_API_URL || !env.COUPON_API_KEY) return fail('Chưa cấu hình API coupon (COUPON_API_URL / COUPON_API_KEY)', { counted: false });
    const tier = tierById(s, c.tier_id) || {};
    const point = Number(tier.apiPoint) || ({ email: 200, cloud: 450, hosting: 700 }[c.tier_id] || 0);
    if (![200, 450, 700].includes(point)) return fail('Mốc "' + c.tier_id + '" chưa gán point cho API (200/450/700)', { counted: false, alert: true });
    db.run('UPDATE coupons SET api_attempts = api_attempts + 1 WHERE id = ?', c.id);
    const body = JSON.stringify({ point, description: couponDescription(c) });
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), env.COUPON_API_TIMEOUT);
    let res;
    try {
      res = await fetch(env.COUPON_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'x-token-api': env.COUPON_API_KEY },
        body,
        signal: ctl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      const code = e && e.cause && e.cause.code;
      if (e.name !== 'AbortError' && SAFE_NET_ERRORS.has(code)) return fail('Không kết nối được API coupon (' + code + ')', { counted: false });
      // quá thời gian / đứt kết nối giữa chừng: KHÔNG biết mã đã được sinh chưa -> không tự gọi lại (tránh sinh 2 mã), chờ Admin kiểm tra
      return fail('Không chắc API đã sinh mã chưa (' + (e.name === 'AbortError' ? 'quá thời gian chờ' : (code || e.message)) + ') — kiểm tra với kỹ thuật rồi bấm "Tạo lại mã"', { counted: false, uncertain: true, alert: true });
    } finally {
      clearTimeout(timer);
    }
    let data = null;
    const text = await res.text().catch(() => '');
    try { data = JSON.parse(text); } catch (e) { /* không phải JSON */ }
    if (!res.ok) return fail('API coupon trả HTTP ' + res.status, { alert: res.status === 401 || res.status === 403 });
    if (!data || typeof data !== 'object') return fail('API coupon trả dữ liệu không hợp lệ');
    if (data.status === 'error') return fail('API coupon báo lỗi: ' + String(data.message || '').slice(0, 200), { alert: true });
    const code = typeof data.code === 'string' ? sec.normalizeCode(data.code).slice(0, 64) : '';
    if (!code) return fail('API coupon không trả về mã');
    if (data.promotionValue !== undefined && Math.round(Number(data.promotionValue)) !== Number(c.discount)) {
      realtime.activity({ type: 'warning', text: 'Coupon #' + c.id + ': API cấp giảm ' + data.promotionValue + '% nhưng mốc "' + c.tier_id + '" ghi ' + c.discount + '% — kiểm tra cấu hình mốc/point' });
    }
    try { setCode(c.id, code); } catch (e) { return fail('Mã trùng với mã đã có: ' + code, { alert: true }); }
    db.run('UPDATE coupons SET api_uncertain = 0 WHERE id = ?', c.id);
    return true;
  })().finally(() => inflight.delete(c.id));
  inflight.set(c.id, p);
  return p;
}

// force: Admin bấm "Tạo lại mã" (kể cả khi lần trước không chắc đã sinh)
async function fulfill(couponId, opts) {
  const c = db.get('SELECT * FROM coupons WHERE id = ?', couponId);
  if (!c || c.status !== 'pending') return c;
  const s = settings.current();
  if (c.provider === 'http') {
    const force = opts && opts.force;
    if (!force && (c.api_uncertain || c.api_attempts >= MAX_API_ATTEMPTS)) return c;
    await fulfillHttp(c, s);
  } else fulfillSync(c, s);
  return db.get('SELECT * FROM coupons WHERE id = ?', couponId);
}

// Job định kỳ: thử lại các coupon đang chờ mã (lỗi rõ ràng, chưa vượt số lần thử)
let retrying = false;
async function retryPending() {
  if (retrying) return;
  retrying = true;
  try {
    const rows = db.all("SELECT id FROM coupons WHERE status = 'pending' AND provider = 'http' AND api_uncertain = 0 AND api_attempts < ? AND created_at > ? ORDER BY id LIMIT 20",
      MAX_API_ATTEMPTS, Date.now() - 3 * 86400e3);
    for (const r of rows) await fulfill(r.id);
  } finally { retrying = false; }
}

/*
 * Quyết định phần thưởng cho 1 lượt chơi đã được server xác nhận điểm.
 * Trả về { status, tier, coupon } với status:
 *   none      : chưa đạt mốc có quà
 *   issued    : đã cấp coupon mới (hoặc 'pending' nếu đang chờ API tạo mã)
 *   held      : lượt chơi bị nghi ngờ -> coupon chờ Admin duyệt
 *   owned     : đã sở hữu coupon của mốc này
 *   sold_out  : mốc này đã phát hết hạn mức
 */
function award(player, session, score, suspicious) {
  const s = settings.current();
  const tiers = settings.rewardTiers(s).slice().reverse(); // cao -> thấp
  const eligible = tiers.filter((t) => score >= t.score);
  if (!eligible.length) return { status: 'none', tier: null };
  const candidates = s.coupons.fallbackToLowerTier ? eligible : [eligible[0]];
  let firstBlock = null;
  for (const t of candidates) {
    if (s.coupons.maxPerTierPerPlayer > 0 && ownedCount(player.id, t.id) >= s.coupons.maxPerTierPerPlayer) { firstBlock = firstBlock || { status: 'owned', tier: t }; continue; }
    if (t.quota > 0 && !session.is_test && issuedCount(t.id) >= t.quota) { firstBlock = firstBlock || { status: 'sold_out', tier: t }; continue; }
    const hold = suspicious && s.coupons.holdSuspicious;
    const now = Date.now();
    const r = db.run(`INSERT INTO coupons (player_id, session_id, tier_id, is_test, status, provider, label, product, discount, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      player.id, session.id, t.id, session.is_test, hold ? 'held' : 'pending', s.coupons.provider,
      t.label, t.product, t.discount, now, Date.parse(s.coupons.expiresAt));
    const id = Number(r.lastInsertRowid);
    let c = db.get('SELECT * FROM coupons WHERE id = ?', id);
    if (!hold && c.provider !== 'http') { fulfillSync(c, s); c = db.get('SELECT * FROM coupons WHERE id = ?', id); }
    if (!hold && c.provider === 'http') fulfill(id).catch(() => {});
    return { status: hold ? 'held' : (c.status === 'issued' ? 'issued' : 'pending'), tier: t, coupon: c };
  }
  return firstBlock || { status: 'none', tier: null };
}

// ------------------------------------------------------------ hiển thị cho người chơi
function couponStatus(c, now) {
  if (c.status === 'redeemed') return 'redeemed';
  if (c.status === 'revoked') return 'revoked';
  if (c.status === 'held') return 'held';
  if (c.expires_at && c.expires_at < (now || Date.now())) return 'expired';
  if (c.status === 'pending') return 'pending';
  return 'active';
}

function publicCoupon(c, s, withCode) {
  const tier = tierById(s, c.tier_id) || {};
  let code = null;
  if (withCode && c.code_enc && (c.status === 'issued' || c.status === 'redeemed')) {
    try { code = sec.decrypt(c.code_enc); } catch (e) { code = null; }
  }
  return {
    id: c.id,
    tierId: c.tier_id,
    label: c.label,
    short: tier.short || c.label,
    product: c.product,
    discount: c.discount,
    status: couponStatus(c),
    revealed: !!c.revealed_at,
    code,
    url: tier.url || '',
    createdAt: c.created_at,
    expiresAt: c.expires_at
  };
}

function listForPlayer(playerId) {
  const s = settings.current();
  return db.all('SELECT * FROM coupons WHERE player_id = ? ORDER BY created_at DESC, id DESC', playerId)
    .filter((c) => c.status !== 'revoked')
    .map((c) => publicCoupon(c, s, !!c.revealed_at));
}

async function reveal(playerId, couponId) {
  let c = db.get('SELECT * FROM coupons WHERE id = ? AND player_id = ?', couponId, playerId);
  if (!c || c.status === 'revoked') return { error: 'not_found' };
  if (c.status === 'held') return { error: 'held' };
  if (c.status === 'pending') c = await fulfill(c.id);
  if (!c || c.status === 'pending') return { error: 'pending' };
  if (!c.revealed_at) {
    db.run('UPDATE coupons SET revealed_at = ? WHERE id = ?', Date.now(), c.id);
    c = db.get('SELECT * FROM coupons WHERE id = ?', c.id);
  }
  return { coupon: publicCoupon(c, settings.current(), true) };
}

// ------------------------------------------------------------ dành cho Admin / tích hợp
function decryptSafe(enc) { try { return sec.decrypt(enc); } catch (e) { return null; } }

function maskCode(code) {
  if (!code) return '';
  if (code.length <= 6) return code[0] + '****';
  return code.slice(0, Math.min(6, code.length - 4)) + '****' + code.slice(-3);
}

function findByCode(code) {
  return db.get('SELECT * FROM coupons WHERE code_hash = ?', sec.codeHash(code));
}

function markRedeemed(c, ref, at) {
  if (c.status === 'redeemed') return false;
  db.run("UPDATE coupons SET status = 'redeemed', redeemed_at = ?, redeem_ref = ? WHERE id = ?", at || Date.now(), ref || null, c.id);
  const p = db.get('SELECT ext_id, is_test FROM players WHERE id = ?', c.player_id);
  realtime.activity({ type: 'redeem', text: 'Khách hàng ' + (p ? p.ext_id : '?') + ' đã sử dụng ' + c.label, test: c.is_test });
  return true;
}

function importPool(tierId, codes) {
  let added = 0, dup = 0, bad = 0;
  const now = Date.now();
  db.tx(() => {
    for (const raw of codes) {
      const code = sec.normalizeCode(raw);
      if (!/^[A-Z0-9_-]{4,64}$/.test(code)) { bad++; continue; }
      const h = sec.codeHash(code);
      const exists = db.get('SELECT 1 FROM coupon_pool WHERE code_hash = ?', h) || db.get('SELECT 1 FROM coupons WHERE code_hash = ?', h);
      if (exists) { dup++; continue; }
      db.run('INSERT INTO coupon_pool (tier_id, code_enc, code_hash, added_at) VALUES (?, ?, ?, ?)', tierId, sec.encrypt(code), h, now);
      added++;
    }
  });
  return { added, dup, bad };
}

function poolStats() {
  return db.all('SELECT tier_id, COUNT(*) total, SUM(coupon_id IS NULL) free FROM coupon_pool GROUP BY tier_id');
}

module.exports = {
  award, fulfill, reveal, listForPlayer, publicCoupon, couponStatus, decryptSafe, maskCode, findByCode, retryPending,
  markRedeemed, importPool, poolStats, ownedCount, tierById
};
