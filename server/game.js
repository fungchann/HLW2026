'use strict';
/*
 * Vòng đời 1 lượt chơi phía server:
 *   start  -> trừ lượt, sinh seed ngẫu nhiên, lưu snapshot cấu hình
 *   sync   -> nhận lô thao tác [t, ô] mỗi ~3 giây, tái hiện bằng engine, kiểm tra đồng hồ
 *   finish -> tính điểm cuối cùng do SERVER tính, phân tích gian lận, cấp coupon
 * Lượt bị bỏ dở (đóng tab, mất mạng) sẽ được job tự kết thúc sau N phút.
 */
const crypto = require('crypto');
const Engine = require('../shared/engine');
const db = require('./db');
const sec = require('./security');
const settings = require('./settings');
const players = require('./players');
const coupons = require('./coupons');
const realtime = require('./realtime');
const util = require('./util');
const { HttpError, clientIp } = require('./http');

const CLOCK_TOLERANCE_MS = 1500;   // đồng hồ game không được chạy nhanh hơn đồng hồ thật
const HARD_TAP_RATE = 40;          // > 40 lần đập / giây: chắc chắn không phải người (kể cả gõ phím 1–9 rất nhanh)
const MAX_EVENTS_PER_BATCH = 800;

const active = new Map(); // sid -> ctx (bộ đệm các lượt đang chơi)

function parseEv(txt) {
  const out = [];
  if (!txt) return out;
  for (const part of txt.split(';')) {
    if (!part) continue;
    const i = part.indexOf(',');
    out.push([parseInt(part.slice(0, i), 10), parseInt(part.slice(i + 1), 10)]);
  }
  return out;
}
function parseSync(txt) {
  const out = [];
  if (!txt) return out;
  for (const part of txt.split(';')) {
    if (!part) continue;
    const a = part.split(',');
    out.push([parseInt(a[0], 10), parseInt(a[1], 10), parseInt(a[2], 10)]);
  }
  return out;
}

function loadCtx(sid) {
  let ctx = active.get(sid);
  if (ctx) return ctx;
  const row = db.get('SELECT * FROM sessions WHERE id = ?', sid);
  if (!row) return null;
  if (row.status !== 'active') return { row, ended: true };
  const cfg = JSON.parse(row.cfg_json);
  const game = new Engine.Game(row.seed, cfg);
  const events = parseEv(row.ev_txt);
  for (const e of events) game.tap(e[0], e[1]);
  ctx = { row, cfg, game, events, syncs: parseSync(row.sync_txt), lastGt: row.game_ms, invalid: null };
  active.set(sid, ctx);
  return ctx;
}

function publicTiers(s) {
  return s.tiers.filter((t) => t.enabled).map((t) => ({
    id: t.id, score: t.score, reward: t.reward, label: t.label, short: t.short, product: t.product, discount: t.discount, url: t.url
  }));
}

// ------------------------------------------------------------ bắt đầu lượt
function start(req, p, body) {
  const s = settings.current();
  const camp = settings.campaignStatus(s);
  if (body && body.engine !== Engine.VERSION) throw new HttpError(409, 'reload', 'Trò chơi vừa được cập nhật, vui lòng tải lại trang');
  if (s.campaign.maintenance && !p.is_test) throw new HttpError(503, 'maintenance', s.campaign.maintenanceMessage);
  const outside = camp.status !== 'live';
  if (outside && !s.campaign.testMode && !p.is_test) {
    throw new HttpError(403, camp.status === 'upcoming' ? 'not_started' : 'ended',
      camp.status === 'upcoming' ? 'Chương trình chưa bắt đầu' : 'Chương trình đã kết thúc');
  }
  const rl = sec.rateLimit('start:' + p.id, 12, 60000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Thao tác quá nhanh');

  // Mỗi người chỉ có 1 lượt đang chạy: lượt cũ (nếu có) được kết thúc trước.
  for (const r of db.all("SELECT id FROM sessions WHERE player_id = ? AND status = 'active'", p.id)) {
    finalize(r.id, 'replaced');
  }

  const now = Date.now();
  const isTest = p.is_test || outside ? 1 : 0;
  const sid = sec.randomToken(18);
  const seed = crypto.randomBytes(4).readInt32LE(0);
  const cfg = settings.gameConfig(s);
  const dev = players.deviceFrom(req, body && body.device);
  const { day, hour } = util.vnParts(now);
  let turns;
  db.tx(() => {
    turns = players.consumeTurn(players.getById(p.id), s, now);
    db.run(`INSERT INTO sessions (id, player_id, is_test, status, seed, cfg_json, settings_ver, engine_ver, started_at, last_sync_at,
      device, os, browser, ip, day, hour) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sid, p.id, isTest, seed, JSON.stringify(cfg), settings.version(), Engine.VERSION, now, now,
    dev.device, dev.os, dev.browser, clientIp(req), day, hour);
    db.run('UPDATE players SET total_sessions = total_sessions + 1, first_play_at = COALESCE(first_play_at, ?), last_play_at = ?, device_last = ? WHERE id = ?',
      now, now, dev.device, p.id);
  });
  realtime.tick();
  return {
    sessionId: sid,
    seed,
    cfg,
    engine: Engine.VERSION,
    test: !!isTest,
    tiers: publicTiers(s),
    owned: players.ownedTiers(p.id),
    turns: players.publicTurns(turns)
  };
}

// ------------------------------------------------------------ nhận lô thao tác
function invalidate(ctx, reason) {
  if (!ctx.invalid) ctx.invalid = reason;
  return ctx.invalid;
}

function ingest(ctx, body, now) {
  const elapsed = now - ctx.row.started_at;
  const gt = Math.floor(Number(body.gt));
  if (!Number.isFinite(gt) || gt < 0) throw new HttpError(400, 'bad_request', 'Dữ liệu không hợp lệ');
  if (gt > elapsed + CLOCK_TOLERANCE_MS) invalidate(ctx, 'clock_ahead');
  if (gt + 2000 < ctx.lastGt) invalidate(ctx, 'clock_backwards');

  const base = Math.floor(Number(body.base));
  const ev = Array.isArray(body.ev) ? body.ev : [];
  if (!Number.isFinite(base) || base < 0) throw new HttpError(400, 'bad_request', 'Dữ liệu không hợp lệ');
  if (ev.length > MAX_EVENTS_PER_BATCH) invalidate(ctx, 'batch_too_large');
  if (base > ctx.events.length) throw new HttpError(409, 'resync', 'Cần gửi lại dữ liệu', { acked: ctx.events.length });

  const skip = ctx.events.length - base;
  const fresh = skip < ev.length ? ev.slice(skip) : [];
  let lastT = ctx.events.length ? ctx.events[ctx.events.length - 1][0] : 0;
  const accepted = [];
  for (const e of fresh) {
    if (!Array.isArray(e) || e.length !== 2) { invalidate(ctx, 'bad_event'); break; }
    const t = e[0], h = e[1];
    if (!Number.isInteger(t) || !Number.isInteger(h) || h < 0 || h >= Engine.HOLES || t < 0) { invalidate(ctx, 'bad_event'); break; }
    if (t < lastT) { invalidate(ctx, 'event_order'); break; }
    if (t > gt + 50) { invalidate(ctx, 'event_future'); break; }
    lastT = t;
    if (ctx.game.over()) continue; // thao tác sau khi ván đã kết thúc: bỏ qua
    ctx.game.tap(t, h);
    if (ctx.game.idle) continue;    // cú chạm đến sau thời hạn "không thao tác": không tính
    accepted.push([t, h]);
  }
  if (ctx.game.maxTapRate > HARD_TAP_RATE) invalidate(ctx, 'tap_flood');
  // hết thời gian chờ thao tác (tính theo đồng hồ game) -> ván kết thúc
  ctx.game.checkIdle(gt);
  liveCheck(ctx);

  for (const e of accepted) ctx.events.push(e);
  const paused = body.paused ? 1 : 0;
  ctx.syncs.push([elapsed, gt, paused]);
  ctx.lastGt = Math.max(ctx.lastGt, gt);
  const g = ctx.game;
  db.run(`UPDATE sessions SET ev_txt = ev_txt || ?, ev_count = ?, sync_txt = sync_txt || ?, last_sync_at = ?, game_ms = ?,
    score = ?, max_combo = ?, kills = ?, hits = ?, taps = ?, bombs_hit = ?, level = ? WHERE id = ?`,
  accepted.map((e) => e[0] + ',' + e[1] + ';').join(''), ctx.events.length, elapsed + ',' + gt + ',' + paused + ';', now, ctx.lastGt,
  g.score, g.maxCombo, g.kills, g.hits, g.taps, g.bombsHit, g.level(ctx.lastGt), ctx.row.id);
  ctx.row.last_sync_at = now;
}

// Đập nhanh một mình KHÔNG đủ để kết luận gian lận: người chơi bằng bàn phím 1–9 có thể đạt 20+ lần/giây
// (thường kèm nhiều cú đập trượt). Auto click vừa nhanh vừa gần như không trượt -> mới chặn.
function tapRateSuspicious(rate, taps, hits, ac) {
  return rate > ac.maxTapRate && taps >= 30 && hits / taps >= 0.9;
}

// Chặn NGAY trong lúc chơi khi dấu hiệu gian lận đã rõ (không đợi tới cuối ván).
function liveCheck(ctx) {
  if (ctx.invalid) return;
  const s = settings.current();
  const ac = s.antiCheat;
  if (!ac.blockSuspicious) return;
  const g = ctx.game;
  if (tapRateSuspicious(g.maxTapRate, g.taps, g.hits, ac)) { invalidate(ctx, 'tap_rate'); return; }
  if (g.reactions.length >= 20) {
    const r = g.reactions.slice().sort((a, b) => a - b);
    const med = r[Math.floor(r.length / 2)];
    if (med < ac.minMedianReactionMs) { invalidate(ctx, 'fast_reaction'); return; }
  }
  const a = analyzeClock(ctx.syncs);
  if (a.n >= 8 && a.pw >= 30000 && a.ratio < ac.slowClockRatio) invalidate(ctx, 'slow_clock');
}

function analyzeClock(sy) {
  let pw = 0, pg = 0, n = 0;
  for (let i = 1; i < sy.length; i++) {
    const a = sy[i - 1], b = sy[i];
    if (a[2] || b[2]) continue;          // có tạm dừng trong khoảng này
    const dw = b[0] - a[0], dg = b[1] - a[1];
    if (dw < 1000 || dw > 15000) continue; // quá ngắn hoặc tab bị treo / mất mạng
    pw += dw; pg += dg; n++;
  }
  return { pw, pg, n, ratio: pw > 0 ? pg / pw : 1 };
}

function ownCtx(p, sid) {
  if (typeof sid !== 'string' || sid.length > 64) throw new HttpError(400, 'bad_request', 'Thiếu mã lượt chơi');
  const ctx = loadCtx(sid);
  if (!ctx || ctx.row.player_id !== p.id) throw new HttpError(404, 'not_found', 'Không tìm thấy lượt chơi');
  return ctx;
}

function sync(p, body) {
  const ctx = ownCtx(p, body.sid);
  if (ctx.ended) return { ended: true, result: resultFor(ctx.row, p) };
  const rl = sec.rateLimit('sync:' + p.id, 90, 60000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Thao tác quá nhanh');
  ingest(ctx, body, Date.now());
  if (ctx.invalid) {
    const result = finalize(ctx.row.id, 'invalid');
    return { ended: true, result };
  }
  if (ctx.game.idle) return { ended: true, result: finalize(ctx.row.id, 'idle') };
  const g = ctx.game;
  return { ok: true, acked: ctx.events.length, score: g.score, combo: g.combo, strikes: g.strikes, dead: g.dead };
}

function finish(p, body) {
  const ctx = ownCtx(p, body.sid);
  if (ctx.ended) return { result: resultFor(ctx.row, p) };
  ingest(ctx, body, Date.now());
  const reason = ctx.invalid ? 'invalid' : 'quit';
  return { result: finalize(ctx.row.id, reason) };
}

// Người chơi chọn "kết thúc" lượt đang dang dở (sau khi tải lại trang).
function abandon(p, body) {
  const ctx = ownCtx(p, body.sid);
  if (ctx.ended) return { result: resultFor(ctx.row, p) };
  return { result: finalize(ctx.row.id, 'quit') };
}

// Dữ liệu để chơi tiếp lượt dang dở (tải lại trang giữa chừng).
function activeFor(p) {
  const s = settings.current();
  if (!s.features.resumeSession) return null;
  const row = db.get("SELECT id FROM sessions WHERE player_id = ? AND status = 'active' ORDER BY started_at DESC LIMIT 1", p.id);
  if (!row) return null;
  const ctx = loadCtx(row.id);
  if (!ctx || ctx.ended) return null;
  if (ctx.game.over()) { finalize(row.id, ctx.game.idle ? 'idle' : 'quit'); return null; }
  return {
    sessionId: ctx.row.id,
    seed: ctx.row.seed,
    cfg: ctx.cfg,
    engine: Engine.VERSION,
    test: !!ctx.row.is_test,
    events: ctx.events,
    gt: ctx.lastGt,
    score: ctx.game.score,
    tiers: publicTiers(s),
    owned: players.ownedTiers(p.id)
  };
}

// ------------------------------------------------------------ phân tích gian lận
function analyze(ctx, sum, s) {
  const ac = s.antiCheat;
  const flags = [];
  const sy = ctx.syncs;
  const { pw, n, ratio } = analyzeClock(sy);
  if (n >= 5 && pw >= 20000 && ratio < ac.slowClockRatio) flags.push({ code: 'slow_clock', detail: 'Tốc độ game/thật = ' + ratio.toFixed(2) });
  if (sum.reactionCount >= 20 && sum.reactionMedian !== null && sum.reactionMedian < ac.minMedianReactionMs) {
    flags.push({ code: 'fast_reaction', detail: 'Phản xạ trung vị ' + sum.reactionMedian + 'ms' });
  }
  if (tapRateSuspicious(sum.maxTapRate, sum.taps, sum.hits, ac)) flags.push({ code: 'tap_rate', detail: sum.maxTapRate + ' lần đập/giây' });
  if (sum.taps >= 120 && sum.hits / sum.taps >= 0.99 && (sum.reactionMedian || 999) < 280) {
    flags.push({ code: 'too_precise', detail: 'Chính xác ' + Math.round(100 * sum.hits / sum.taps) + '% với ' + sum.taps + ' lần đập' });
  }
  if (sum.endT >= 30000 && sy.length < Math.floor(sum.endT / 12000)) flags.push({ code: 'sparse_sync', detail: sy.length + ' lần đồng bộ cho ' + Math.round(sum.endT / 1000) + 's' });
  const info = [];
  if (sum.bombsShown >= 40 && sum.bombsHit === 0) info.push({ code: 'no_bomb_hit', detail: 'Né ' + sum.bombsShown + ' quả bom' });
  return { flags, info, ratio: Math.round(ratio * 1000) / 1000, suspicious: flags.length > 0 };
}

// ------------------------------------------------------------ kết thúc lượt
const REASON_TEXT = { bomb: 'Trúng bom', quit: 'Chủ động kết thúc', idle: 'Không thao tác (tự kết thúc)', timeout: 'Bỏ dở (quá thời gian)', replaced: 'Bỏ dở (mở lượt mới)', invalid: 'Gian lận / không hợp lệ' };

function finalize(sid, reason) {
  const ctx = loadCtx(sid);
  if (!ctx) return null;
  if (ctx.ended) return resultFor(ctx.row, players.getById(ctx.row.player_id));
  const s = settings.current();
  const now = Date.now();
  const p = players.getById(ctx.row.player_id);
  const sum = ctx.game.summary(ctx.lastGt);
  const analysis = analyze(ctx, sum, s);
  // Chế độ chặn: lượt có dấu hiệu gian lận bị huỷ kết quả, không cấp coupon
  if (!ctx.invalid && analysis.suspicious && s.antiCheat.blockSuspicious) ctx.invalid = analysis.flags[0].code;
  const invalid = reason === 'invalid' || !!ctx.invalid;
  if (invalid) analysis.flags.unshift({ code: 'invalid', detail: ctx.invalid || 'invalid' });

  let endReason, status;
  if (invalid) { endReason = 'invalid'; status = 'invalid'; }
  else if (sum.dead) { endReason = 'bomb'; status = 'finished'; }
  else if (sum.idle) { endReason = 'idle'; status = 'finished'; }
  else if (reason === 'quit') { endReason = 'quit'; status = 'finished'; }
  else { endReason = reason; status = 'abandoned'; }

  const score = invalid ? 0 : sum.score;
  const ts = Engine.tierStatus(s.tiers, score);
  let aw = { status: invalid ? 'invalid' : 'none', tier: null };

  db.tx(() => {
    if (!invalid) aw = coupons.award(p, ctx.row, score, analysis.suspicious);
    db.run(`UPDATE sessions SET status = ?, end_reason = ?, ended_at = ?, game_ms = ?, score = ?, max_combo = ?, kills = ?, hits = ?,
      taps = ?, bombs_hit = ?, level = ?, tier_id = ?, award_status = ?, coupon_id = ?, summary_json = ?, flags_json = ?, suspicious = ?
      WHERE id = ?`,
    status, endReason, now, sum.endT, score, invalid ? 0 : sum.maxCombo, sum.kills, sum.hits, sum.taps, sum.bombsHit, sum.level,
    ts.reachedReward ? ts.reachedReward.id : null, aw.status, aw.coupon ? aw.coupon.id : null,
    JSON.stringify(sum), JSON.stringify({ flags: analysis.flags, info: analysis.info, ratio: analysis.ratio, syncs: ctx.syncs.length }),
    analysis.suspicious || invalid ? 1 : 0, sid);
    db.run(`UPDATE players SET done_sessions = done_sessions + 1, sum_score = sum_score + ?, best_score = MAX(best_score, ?),
      best_combo = MAX(best_combo, ?), bomb_deaths = bomb_deaths + ?, flagged_sessions = flagged_sessions + ?, last_play_at = ? WHERE id = ?`,
    score, score, invalid ? 0 : sum.maxCombo, endReason === 'bomb' ? 1 : 0, analysis.suspicious || invalid ? 1 : 0, now, p.id);
  });
  active.delete(sid);

  // Tự khoá tài khoản khi bị phát hiện gian lận nhiều lần
  let banned = false;
  if (invalid && s.antiCheat.autoBanAfter > 0 && !p.is_test) {
    const n = db.get("SELECT COUNT(*) n FROM sessions WHERE player_id = ? AND status = 'invalid'", p.id).n;
    if (n >= s.antiCheat.autoBanAfter) {
      db.run('UPDATE players SET banned = 1, ban_reason = ? WHERE id = ?', 'Hệ thống phát hiện gian lận nhiều lần', p.id);
      db.run('DELETE FROM auth_tokens WHERE player_id = ?', p.id);
      banned = true;
    }
  }

  const row = db.get('SELECT * FROM sessions WHERE id = ?', sid);
  const who = p.ext_id;
  if (banned) realtime.activity({ type: 'warning', test: !!row.is_test, text: 'Đã TỰ KHOÁ tài khoản ' + who + ' do gian lận nhiều lần' });
  if (aw.status === 'issued' || aw.status === 'pending' || aw.status === 'held') {
    realtime.activity({ type: 'coupon', test: !!row.is_test, text: who + ' đạt ' + score + ' điểm — nhận ' + aw.tier.label + (aw.status === 'held' ? ' (chờ duyệt)' : '') });
  } else if (invalid || analysis.suspicious) {
    realtime.activity({ type: 'warning', test: !!row.is_test, text: 'Lượt chơi của ' + who + ' bị đánh dấu ' + (invalid ? 'KHÔNG HỢP LỆ' : 'nghi ngờ') + ' (' + analysis.flags.map((f) => f.code).join(', ') + ')' });
  } else {
    realtime.activity({ type: 'session', test: !!row.is_test, text: who + ' kết thúc lượt: ' + score + ' điểm · ' + REASON_TEXT[endReason] });
  }
  return resultFor(row, players.getById(p.id));
}

function resultFor(row, p) {
  const s = settings.current();
  const ts = Engine.tierStatus(s.tiers, row.score);
  let coupon = null;
  if (row.coupon_id) {
    const c = db.get('SELECT * FROM coupons WHERE id = ?', row.coupon_id);
    if (c) coupon = coupons.publicCoupon(c, s, !!c.revealed_at);
  }
  const tier = row.tier_id ? coupons.tierById(s, row.tier_id) : null;
  const status = row.award_status || 'none';
  let message;
  if (status === 'issued' || status === 'pending' || status === 'held') message = util.pickRandom(s.messages.congrats);
  else if (status === 'owned') message = util.pickRandom(s.messages.owned);
  else message = util.pickRandom(s.messages.encourage);
  const prevBest = db.get("SELECT MAX(score) m FROM sessions WHERE player_id = ? AND id != ? AND status IN ('finished','abandoned')", p.id, row.id).m || 0;
  return {
    sessionId: row.id,
    score: row.score,
    maxCombo: row.max_combo,
    durationMs: row.game_ms,
    level: row.level,
    kills: row.kills,
    endReason: row.end_reason,
    test: !!row.is_test,
    newBest: row.score > prevBest && row.score > 0,
    best: { score: p.best_score, combo: p.best_combo },
    award: {
      status,
      tier: tier ? { id: tier.id, label: tier.label, short: tier.short, discount: tier.discount, product: tier.product, url: tier.url } : null,
      coupon
    },
    reached: ts.reachedReward ? { id: ts.reachedReward.id, label: ts.reachedReward.label, short: ts.reachedReward.short } : null,
    next: ts.nextReward ? { id: ts.nextReward.id, label: ts.nextReward.label, short: ts.nextReward.short, need: ts.need, score: ts.nextReward.score } : null,
    message,
    gameOverTitle: util.pickRandom(s.messages.gameOver),
    owned: players.ownedTiers(p.id),
    turns: players.publicTurns(players.turnState(p, s)),
    banned: !!p.banned
  };
}

// Job định kỳ: kết thúc các lượt bị bỏ dở.
function sweepAbandoned() {
  const s = settings.current();
  const cutoff = Date.now() - s.antiCheat.abandonMinutes * 60000;
  const rows = db.all("SELECT id FROM sessions WHERE status = 'active' AND last_sync_at < ?", cutoff);
  for (const r of rows) {
    try { finalize(r.id, 'timeout'); } catch (e) { console.error('[sweep]', r.id, e.message); }
  }
  // dọn bộ đệm
  for (const [sid, ctx] of active) if (ctx.row.last_sync_at < cutoff - 60000) active.delete(sid);
  return rows.length;
}

function liveCount() {
  const since = Date.now() - 20000;
  return db.get("SELECT COUNT(*) n FROM sessions WHERE status = 'active' AND last_sync_at >= ? AND is_test = 0", since).n;
}

module.exports = { start, sync, finish, abandon, activeFor, finalize, sweepAbandoned, liveCount, resultFor, parseEv, parseSync, REASON_TEXT, analyze };
