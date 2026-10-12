'use strict';
/*
 * Tạo dữ liệu DEMO để xem thử trang Admin trước khi có người chơi thật.
 *   npm run seed-demo            (mặc định 300 người chơi)
 *   npm run seed-demo -- 1000
 * Toàn bộ dữ liệu được gắn cờ TEST: chỉ hiện khi tick "Gồm dữ liệu test" và xoá được bằng
 * nút "Xoá dữ liệu test" (Admin > Tài khoản & dữ liệu). Điểm số được mô phỏng bằng chính engine game.
 */
const env = require('../server/env');
const db = require('../server/db');
db.open(env.DB_PATH);
const crypto = require('crypto');
const Engine = require('../shared/engine');
const settings = require('../server/settings');
const sec = require('../server/security');
const util = require('../server/util');

const N = Math.max(10, Math.min(5000, parseInt(process.argv[2] || '300', 10)));
const s = settings.current();
const cfg = settings.gameConfig(s);
const tiers = s.tiers.filter((t) => t.enabled).sort((a, b) => a.score - b.score);
const rewardTiers = tiers.filter((t) => t.reward);
const campStart = Date.parse(s.campaign.start);
const campEnd = Date.parse(s.campaign.end);
const expires = Date.parse(s.coupons.expiresAt);

let seed = 20261031;
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function pick(arr, weights) {
  let r = rnd() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < arr.length; i++) { if ((r -= weights[i]) < 0) return arr[i]; }
  return arr[arr.length - 1];
}
// Giờ chơi: cao điểm trưa (11-13h) và tối (19-23h)
const HOUR_W = [1, 0.5, 0.3, 0.2, 0.2, 0.4, 1, 2, 3, 3.5, 3.5, 5, 6, 4, 3, 3, 3.5, 4, 5, 7, 8.5, 8, 6, 3];
function randomTime() {
  const days = Math.max(1, Math.round((campEnd - campStart) / 86400000));
  const day = Math.floor(rnd() * days);
  const hour = pick([...Array(24).keys()], HOUR_W);
  return campStart + day * 86400000 + hour * 3600000 + Math.floor(rnd() * 3600000);
}

const profiles = ['casual', 'average', 'skilled'];
const devices = [['mobile', 'Android', 'Chrome'], ['mobile', 'iOS', 'Safari'], ['mobile', 'Android', 'Cốc Cốc'], ['desktop', 'Windows', 'Chrome'], ['desktop', 'Windows', 'Cốc Cốc'], ['desktop', 'macOS', 'Safari'], ['tablet', 'iOS', 'Safari']];
const devW = [34, 22, 6, 22, 7, 5, 4];

const stats = { players: 0, sessions: 0, coupons: 0 };
db.tx(() => {
  for (let i = 0; i < N; i++) {
    const ext = 'demo-KH' + (100000 + i);
    if (db.get('SELECT 1 FROM players WHERE ext_id = ?', ext)) continue;
    const prof = Engine.PROFILES[pick(profiles, [45, 40, 15])];
    const dev = pick(devices, devW);
    const nSessions = 1 + Math.floor(Math.pow(rnd(), 1.7) * 9);
    let t = randomTime();
    const firstSeen = t - Math.floor(rnd() * 120000);
    db.run('INSERT INTO players (ext_id, is_test, created_at, last_seen_at, turns, turns_at) VALUES (?, 1, ?, ?, ?, ?)', ext, firstSeen, firstSeen, s.turns.max, firstSeen);
    const pid = db.get('SELECT id FROM players WHERE ext_id = ?', ext).id;
    const { day: d0, hour: h0 } = util.vnParts(firstSeen);
    db.run("INSERT INTO events (player_id, is_test, type, device, created_at, day, hour) VALUES (?, 1, 'open', ?, ?, ?, ?)", pid, dev[0], firstSeen, d0, h0);
    if (rnd() < 0.35) db.run("INSERT INTO events (player_id, is_test, type, device, created_at, day, hour) VALUES (?, 1, 'guide_open', ?, ?, ?, ?)", pid, dev[0], firstSeen + 5000, d0, h0);
    const owned = {};
    let best = 0, bestCombo = 0, sum = 0, bombs = 0;
    let firstPlay = null, lastPlay = null;
    for (let k = 0; k < nSessions; k++) {
      if (k > 0) t += rnd() < 0.55 ? Math.floor(60000 + rnd() * 900000) : Math.floor(3600000 * (2 + rnd() * 40));
      if (t > campEnd) break;
      const gseed = crypto.randomBytes(4).readInt32LE(0);
      const sim = Engine.simulateOne(cfg, prof, gseed, { thresholds: tiers.map((x) => x.score), maxSeconds: 600 });
      let score = sim.score, endReason = 'bomb', gameMs = sim.endT;
      // một phần người chơi chủ động dừng ở mốc họ muốn
      const reached = rewardTiers.filter((x) => score >= x.score);
      if (reached.length && rnd() < 0.3) {
        const want = rewardTiers.find((x) => !owned[x.id] && score >= x.score);
        if (want) {
          const idx = tiers.findIndex((x) => x.id === want.id);
          const next = tiers[idx + 1];
          const cap = next ? next.score - 1 : want.score + 60;
          score = Math.min(score, want.score + Math.floor(rnd() * Math.max(1, cap - want.score)));
          endReason = 'quit';
          gameMs = Math.round(sim.endT * Math.min(1, score / Math.max(1, sim.score)));
        }
      }
      if (rnd() < 0.03) endReason = 'timeout';
      const ts = Engine.tierStatus(s.tiers, score);
      const sid = sec.randomToken(18);
      const { day, hour } = util.vnParts(t);
      let award = 'none', couponId = null;
      const rt = ts.reachedReward;
      if (rt) {
        if (owned[rt.id]) award = 'owned';
        else {
          owned[rt.id] = 1;
          award = 'issued';
          const code = 'TEST-' + rt.prefix + '-' + crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 8);
          const revealed = rnd() < 0.86 ? t + gameMs + 4000 : null;
          const copied = revealed && rnd() < 0.7 ? revealed + 3000 : null;
          const redeemed = revealed && rnd() < 0.18 ? t + gameMs + Math.floor(rnd() * 86400000) : null;
          const r = db.run(`INSERT INTO coupons (player_id, session_id, tier_id, is_test, status, provider, code_enc, code_hash, label, product, discount, created_at, expires_at, revealed_at, copied_at, redeemed_at, redeem_ref)
            VALUES (?, ?, ?, 1, ?, 'mock', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          pid, sid, rt.id, redeemed ? 'redeemed' : 'issued', sec.encrypt(code), sec.codeHash(code), rt.label, rt.product, rt.discount,
          t + gameMs, expires, revealed, copied, redeemed, redeemed ? 'DH' + Math.floor(rnd() * 900000 + 100000) : null);
          couponId = Number(r.lastInsertRowid);
          stats.coupons++;
          if (rnd() < 0.42) {
            const ct = t + gameMs + 8000;
            const p = util.vnParts(ct);
            db.run("INSERT INTO events (player_id, is_test, type, tier_id, session_id, source, device, created_at, day, hour) VALUES (?, 1, 'register_click', ?, ?, ?, ?, ?, ?, ?)",
              pid, rt.id, sid, rnd() < 0.8 ? 'result' : 'coupons', dev[0], ct, p.day, p.hour);
          }
        }
      }
      const kills = Math.round(score / 13), taps = Math.round(kills * (1.25 + rnd() * 0.3));
      db.run(`INSERT INTO sessions (id, player_id, is_test, status, end_reason, seed, cfg_json, settings_ver, engine_ver, started_at, last_sync_at, ended_at, game_ms,
        score, max_combo, kills, hits, taps, bombs_hit, level, tier_id, award_status, coupon_id, summary_json, flags_json, suspicious, device, os, browser, ip, day, hour)
        VALUES (?, ?, 1, ?, ?, ?, '{}', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '127.0.0.1', ?, ?)`,
      sid, pid, endReason === 'timeout' ? 'abandoned' : 'finished', endReason, gseed, settings.version(), Engine.VERSION, t, t + gameMs, t + gameMs + 1500, gameMs,
      score, sim.maxCombo, kills, Math.round(kills * 1.15), taps, endReason === 'bomb' ? 2 : Math.floor(rnd() * 2), 1 + Math.floor(gameMs / 15000),
      rt ? rt.id : null, award, couponId,
      JSON.stringify({ score, maxCombo: sim.maxCombo, kills, hits: Math.round(kills * 1.15), taps, endT: gameMs, reactionMedian: Math.round(prof.react * 0.95), maxTapRate: 4 + Math.floor(rnd() * 4) }),
      JSON.stringify({ flags: [], info: [], ratio: 1, syncs: Math.round(gameMs / 3000) }), 0, dev[0], dev[1], dev[2], day, hour);
      stats.sessions++;
      best = Math.max(best, score); bestCombo = Math.max(bestCombo, sim.maxCombo); sum += score; if (endReason === 'bomb') bombs++;
      firstPlay = firstPlay || t; lastPlay = t;
      t += gameMs;
      if (k === nSessions - 1 && rnd() < 0.25) {
        const nt = t + 1000, p = util.vnParts(nt);
        db.run("INSERT INTO events (player_id, is_test, type, created_at, day, hour) VALUES (?, 1, 'no_turns', ?, ?, ?)", pid, nt, p.day, p.hour);
      }
    }
    const cnt = db.get('SELECT COUNT(*) n FROM sessions WHERE player_id = ?', pid).n;
    db.run(`UPDATE players SET total_sessions = ?, done_sessions = ?, sum_score = ?, best_score = ?, best_combo = ?, bomb_deaths = ?, first_play_at = ?, last_play_at = ?, device_last = ? WHERE id = ?`,
      cnt, cnt, sum, best, bestCombo, bombs, firstPlay, lastPlay, dev[0], pid);
    stats.players++;
  }
});
console.log('Đã tạo dữ liệu demo (gắn cờ test): ' + stats.players + ' người chơi, ' + stats.sessions + ' lượt chơi, ' + stats.coupons + ' coupon.');
console.log('Xem tại /admin (tick "Gồm dữ liệu test"). Xoá bằng Admin > Tài khoản & dữ liệu > Xoá dữ liệu test.');
db.close();
