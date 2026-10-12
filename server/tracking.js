'use strict';
/* Ghi nhận hành vi người chơi phục vụ báo cáo (click đăng ký, copy mã, mở hướng dẫn...). */
const db = require('./db');
const sec = require('./security');
const settings = require('./settings');
const util = require('./util');
const realtime = require('./realtime');
const { HttpError } = require('./http');

const TYPES = new Set(['register_click', 'coupon_copy', 'guide_open', 'coupons_open', 'leaderboard_open', 'sound_off', 'sound_on']);
const SOURCES = new Set(['result', 'coupons', 'home', 'pause', 'guide']);

function track(p, body, device) {
  const type = String(body.type || '');
  if (!TYPES.has(type)) throw new HttpError(400, 'bad_type', 'Loại sự kiện không hợp lệ');
  const rl = sec.rateLimit('track:' + p.id, 40, 60000);
  if (!rl.ok) return { ok: true, skipped: true };
  const s = settings.current();
  let tierId = body.tierId ? String(body.tierId).slice(0, 24) : null;
  if (tierId && !s.tiers.some((t) => t.id === tierId)) tierId = null;
  const source = SOURCES.has(body.source) ? body.source : null;
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.slice(0, 40) : null;
  const now = Date.now();

  if (type === 'register_click') {
    if (!tierId) throw new HttpError(400, 'bad_tier', 'Thiếu mốc voucher');
    // chống bấm liên tục làm sai số liệu: 1 lượt / 5 giây / mốc
    const dup = sec.rateLimit('click:' + p.id + ':' + tierId, 1, 5000);
    if (!dup.ok) return { ok: true, skipped: true };
  }
  if (type === 'coupon_copy' && body.couponId) {
    db.run('UPDATE coupons SET copied_at = COALESCE(copied_at, ?) WHERE id = ? AND player_id = ?', now, Number(body.couponId) || 0, p.id);
  }
  const { day, hour } = util.vnParts(now);
  db.run('INSERT INTO events (player_id, is_test, type, tier_id, session_id, source, device, created_at, day, hour) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    p.id, p.is_test, type, tierId, sessionId, source, device || null, now, day, hour);
  if (type === 'register_click') {
    const t = s.tiers.find((x) => x.id === tierId);
    realtime.activity({ type: 'click', test: !!p.is_test, text: p.ext_id + ' bấm "Đăng ký ngay" → ' + (t ? t.product || t.label : tierId) });
  }
  return { ok: true };
}

module.exports = { track };
