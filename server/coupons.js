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
async function fulfillHttp(c, s) {
  if (inflight.has(c.id)) return inflight.get(c.id);
  const p = (async () => {
    if (!env.COUPON_API_URL) {
      db.run('UPDATE coupons SET error = ? WHERE id = ?', 'Chưa cấu hình COUPON_API_URL', c.id);
      return false;
    }
    const player = db.get('SELECT ext_id FROM players WHERE id = ?', c.player_id);
    const tier = tierById(s, c.tier_id) || {};
    const body = JSON.stringify({
      requestId: 'hlw2026-' + c.id,
      customerId: player ? player.ext_id : null,
      tier: c.tier_id,
      product: c.product,
      discountPercent: c.discount,
      prefix: tier.prefix || '',
      expiresAt: c.expires_at ? new Date(c.expires_at).toISOString() : null,
      campaign: s.campaign.name
    });
    const ts = String(Math.floor(Date.now() / 1000));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), env.COUPON_API_TIMEOUT);
    try {
      const res = await fetch(env.COUPON_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + env.COUPON_API_KEY,
          'X-HLW-Timestamp': ts,
          'X-HLW-Signature': 'sha256=' + sec.hmac(env.COUPON_API_KEY || env.INTEGRATION_SECRET, ts + '.' + body)
        },
        body,
        signal: ctl.signal
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data || typeof data.code !== 'string' || !data.code.trim()) {
        db.run('UPDATE coupons SET error = ? WHERE id = ?', 'API coupon lỗi ' + res.status, c.id);
        return false;
      }
      setCode(c.id, sec.normalizeCode(data.code).slice(0, 64));
      return true;
    } catch (e) {
      db.run('UPDATE coupons SET error = ? WHERE id = ?', 'Không gọi được API coupon: ' + (e.name === 'AbortError' ? 'quá thời gian' : e.message), c.id);
      return false;
    } finally {
      clearTimeout(timer);
      inflight.delete(c.id);
    }
  })();
  inflight.set(c.id, p);
  return p;
}

async function fulfill(couponId) {
  const c = db.get('SELECT * FROM coupons WHERE id = ?', couponId);
  if (!c || c.status !== 'pending') return c;
  const s = settings.current();
  if (c.provider === 'http') await fulfillHttp(c, s);
  else fulfillSync(c, s);
  return db.get('SELECT * FROM coupons WHERE id = ?', couponId);
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
  award, fulfill, reveal, listForPlayer, publicCoupon, couponStatus, decryptSafe, maskCode, findByCode,
  markRedeemed, importPool, poolStats, ownedCount, tierById
};
