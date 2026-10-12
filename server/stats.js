'use strict';
/* Truy vấn thống kê cho Dashboard Admin. Ngày/giờ tính theo giờ Việt Nam (UTC+7). */
const db = require('./db');
const settings = require('./settings');
const game = require('./game');

const DONE = "status IN ('finished','abandoned')";
const cache = new Map();

function q1(sql, ...a) { return db.get(sql, ...a) || {}; }

function overview(f) {
  const key = JSON.stringify(f);
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - 2000) return hit.data;
  const data = compute(f);
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  return data;
}

function compute(f) {
  const s = settings.current();
  const from = f.from, to = f.to, T = f.test ? 1 : 0;
  const R = 'started_at BETWEEN ? AND ? AND (is_test = 0 OR ? = 1)';
  const r = [from, to, T];
  const ER = 'created_at BETWEEN ? AND ? AND (is_test = 0 OR ? = 1)';

  const o = q1(`SELECT COUNT(*) sessions, COUNT(DISTINCT player_id) players,
      SUM(${DONE}) done,
      AVG(CASE WHEN ${DONE} THEN score END) avg_score,
      MAX(CASE WHEN ${DONE} THEN score END) max_score,
      MAX(CASE WHEN ${DONE} THEN max_combo END) max_combo,
      AVG(CASE WHEN ${DONE} THEN max_combo END) avg_combo,
      AVG(CASE WHEN ${DONE} THEN game_ms END) avg_ms,
      SUM(end_reason = 'bomb') bomb_deaths,
      SUM(end_reason = 'quit') quits,
      SUM(status != 'active') ended,
      SUM(suspicious) suspicious,
      SUM(status = 'invalid') invalid
    FROM sessions WHERE ${R}`, ...r);

  const topScore = q1(`SELECT s.score, s.max_combo, s.started_at, p.ext_id FROM sessions s JOIN players p ON p.id = s.player_id
    WHERE ${DONE.replace('status', 's.status')} AND s.started_at BETWEEN ? AND ? AND (s.is_test = 0 OR ? = 1) ORDER BY s.score DESC, s.started_at LIMIT 1`, ...r);
  const topCombo = q1(`SELECT s.max_combo, s.score, p.ext_id FROM sessions s JOIN players p ON p.id = s.player_id
    WHERE ${DONE.replace('status', 's.status')} AND s.started_at BETWEEN ? AND ? AND (s.is_test = 0 OR ? = 1) ORDER BY s.max_combo DESC, s.started_at LIMIT 1`, ...r);

  // Mốc điểm: số NGƯỜI (theo điểm cao nhất trong khoảng thời gian) và số LƯỢT đạt mỗi mốc
  const tiers = s.tiers.filter((t) => t.enabled);
  const tierReach = tiers.map((t) => {
    const players = q1(`SELECT COUNT(*) n FROM (SELECT player_id, MAX(score) b FROM sessions WHERE ${DONE} AND ${R} GROUP BY player_id) WHERE b >= ?`, ...r, t.score).n || 0;
    const sessions = q1(`SELECT COUNT(*) n FROM sessions WHERE ${DONE} AND ${R} AND score >= ?`, ...r, t.score).n || 0;
    const quits = q1(`SELECT COUNT(*) n FROM sessions WHERE end_reason = 'quit' AND ${R} AND tier_id = ?`, ...r, t.id).n || 0;
    return { id: t.id, label: t.label, short: t.short, score: t.score, reward: t.reward, players, sessions, quits };
  });

  const couponRows = db.all(`SELECT tier_id, COUNT(*) issued, SUM(revealed_at IS NOT NULL) revealed, SUM(copied_at IS NOT NULL) copied,
      SUM(status = 'redeemed') redeemed, SUM(status = 'held') held, SUM(status = 'pending') pending
    FROM coupons WHERE ${ER} AND status != 'revoked' GROUP BY tier_id`, from, to, T);
  const clickRows = db.all(`SELECT tier_id, COUNT(*) clicks, COUNT(DISTINCT player_id) players FROM events
    WHERE type = 'register_click' AND ${ER} GROUP BY tier_id`, from, to, T);
  const clickSource = db.all(`SELECT COALESCE(source, 'khác') source, COUNT(*) clicks FROM events
    WHERE type = 'register_click' AND ${ER} GROUP BY source`, from, to, T);
  const rewardTiers = tiers.filter((t) => t.reward);
  const couponsByTier = rewardTiers.map((t) => {
    const c = couponRows.find((x) => x.tier_id === t.id) || {};
    const k = clickRows.find((x) => x.tier_id === t.id) || {};
    return {
      id: t.id, label: t.label, short: t.short, product: t.product, url: t.url, quota: t.quota,
      issued: c.issued || 0, revealed: c.revealed || 0, copied: c.copied || 0, redeemed: c.redeemed || 0,
      held: c.held || 0, pending: c.pending || 0, clicks: k.clicks || 0, clickPlayers: k.players || 0
    };
  });

  const ret = q1(`SELECT COUNT(*) total, SUM(d >= 2) multi_day FROM (SELECT player_id, COUNT(DISTINCT day) d FROM sessions WHERE ${R} GROUP BY player_id)`, ...r);
  const retGap = q1(`SELECT COUNT(*) n FROM (
      SELECT player_id, MAX(gap) g FROM (
        SELECT player_id, started_at - LAG(started_at) OVER (PARTITION BY player_id ORDER BY started_at) gap FROM sessions WHERE ${R}
      ) GROUP BY player_id) WHERE g >= 1800000`, ...r);
  const activeDays = db.all(`SELECT d, COUNT(*) players FROM (SELECT player_id, COUNT(DISTINCT day) d FROM sessions WHERE ${R} GROUP BY player_id) GROUP BY d ORDER BY d`, ...r);
  const sessionsPerPlayer = db.all(`SELECT CASE WHEN n >= 10 THEN 10 ELSE n END k, COUNT(*) players FROM
      (SELECT player_id, COUNT(*) n FROM sessions WHERE ${R} GROUP BY player_id) GROUP BY k ORDER BY k`, ...r);

  const devices = db.all(`SELECT COALESCE(device, 'desktop') device, COUNT(*) sessions, COUNT(DISTINCT player_id) players FROM sessions WHERE ${R} GROUP BY device`, ...r);
  const os = db.all(`SELECT COALESCE(os, 'Khác') name, COUNT(*) sessions FROM sessions WHERE ${R} GROUP BY os ORDER BY sessions DESC LIMIT 8`, ...r);
  const browsers = db.all(`SELECT COALESCE(browser, 'Khác') name, COUNT(*) sessions FROM sessions WHERE ${R} GROUP BY browser ORDER BY sessions DESC LIMIT 8`, ...r);

  const byDay = db.all(`SELECT day, COUNT(*) sessions, COUNT(DISTINCT player_id) players, AVG(CASE WHEN ${DONE} THEN score END) avg_score
    FROM sessions WHERE ${R} GROUP BY day ORDER BY day`, ...r);
  const byDayHour = db.all(`SELECT day, hour, COUNT(*) n FROM sessions WHERE ${R} GROUP BY day, hour`, ...r);
  const byHour = db.all(`SELECT hour, COUNT(*) n FROM sessions WHERE ${R} GROUP BY hour ORDER BY hour`, ...r);
  const histogram = db.all(`SELECT MIN(score / 50, 30) * 50 b, COUNT(*) n FROM sessions WHERE ${DONE} AND ${R} GROUP BY b ORDER BY b`, ...r);
  const endReasons = db.all(`SELECT end_reason reason, COUNT(*) n FROM sessions WHERE status != 'active' AND ${R} GROUP BY end_reason`, ...r);

  const firstReward = rewardTiers[0];
  const funnel = [
    { key: 'open', label: 'Mở game', n: q1(`SELECT COUNT(DISTINCT player_id) n FROM events WHERE type = 'open' AND ${ER}`, from, to, T).n || 0 },
    { key: 'play', label: 'Chơi ≥ 1 lượt', n: o.players || 0 },
    { key: 'tier', label: firstReward ? 'Đạt ≥ ' + firstReward.score + ' điểm' : 'Đạt mốc quà', n: firstReward ? (tierReach.find((x) => x.id === firstReward.id) || {}).players || 0 : 0 },
    { key: 'coupon', label: 'Nhận coupon', n: q1(`SELECT COUNT(DISTINCT player_id) n FROM coupons WHERE status != 'revoked' AND ${ER}`, from, to, T).n || 0 },
    { key: 'reveal', label: 'Xem mã coupon', n: q1(`SELECT COUNT(DISTINCT player_id) n FROM coupons WHERE revealed_at IS NOT NULL AND status != 'revoked' AND ${ER}`, from, to, T).n || 0 },
    { key: 'click', label: 'Bấm "Đăng ký ngay"', n: q1(`SELECT COUNT(DISTINCT player_id) n FROM events WHERE type = 'register_click' AND ${ER}`, from, to, T).n || 0 },
    { key: 'redeem', label: 'Dùng coupon (chuyển đổi)', n: q1(`SELECT COUNT(DISTINCT player_id) n FROM coupons WHERE status = 'redeemed' AND ${ER}`, from, to, T).n || 0 }
  ];
  const noTurns = q1(`SELECT COUNT(DISTINCT player_id) n, COUNT(*) times FROM events WHERE type = 'no_turns' AND ${ER}`, from, to, T);
  const uiEvents = db.all(`SELECT type, COUNT(*) n, COUNT(DISTINCT player_id) players FROM events WHERE type IN ('guide_open','coupons_open','coupon_copy','leaderboard_open','sound_off') AND ${ER} GROUP BY type`, from, to, T);

  return {
    generatedAt: Date.now(),
    range: { from, to, test: !!f.test },
    live: game.liveCount(),
    kpi: {
      players: o.players || 0,
      sessions: o.sessions || 0,
      done: o.done || 0,
      perPlayer: o.players ? o.sessions / o.players : 0,
      avgScore: o.avg_score || 0,
      maxScore: o.max_score || 0,
      maxCombo: o.max_combo || 0,
      avgCombo: o.avg_combo || 0,
      avgMs: o.avg_ms || 0,
      bombDeaths: o.bomb_deaths || 0,
      quits: o.quits || 0,
      ended: o.ended || 0,
      bombRate: o.ended ? (o.bomb_deaths || 0) / o.ended : 0,
      suspicious: o.suspicious || 0,
      invalid: o.invalid || 0,
      returning: ret.multi_day || 0,
      returningRate: ret.total ? (ret.multi_day || 0) / ret.total : 0,
      returningGap: retGap.n || 0,
      returningGapRate: ret.total ? (retGap.n || 0) / ret.total : 0,
      noTurnsPlayers: noTurns.n || 0,
      noTurnsTimes: noTurns.times || 0
    },
    top: { score: topScore.score ? topScore : null, combo: topCombo.max_combo ? topCombo : null },
    tierReach,
    coupons: couponsByTier,
    clickSource,
    activeDays,
    sessionsPerPlayer,
    devices,
    os,
    browsers,
    byDay,
    byDayHour,
    byHour,
    histogram,
    endReasons,
    funnel,
    uiEvents
  };
}

module.exports = { overview };
