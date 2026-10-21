'use strict';
/*
 * Bộ kiểm thử tự động end-to-end (không cần trình duyệt):
 *   npm test
 * Chạy server trên DB tạm, dùng bot chơi bằng chính engine, thử các kiểu gian lận phổ biến
 * và kiểm tra các API quản trị. Không ảnh hưởng dữ liệu thật trong thư mục data/.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hlw-test-'));
process.env.DATA_DIR = TMP;
process.env.DB_PATH = path.join(TMP, 'test.db');
process.env.PORT = String(18000 + Math.floor(Math.random() * 1000));
process.env.HOST = '127.0.0.1';
process.env.ALLOW_DEMO_LOGIN = 'true';
process.env.GUEST_LOGIN = 'true';
process.env.ADMIN_PATH = 'test-admin-' + require('crypto').randomBytes(6).toString('hex');
const ADMIN = '/' + process.env.ADMIN_PATH;
process.env.ADMIN_BOOTSTRAP_USER = 'boss';
process.env.ADMIN_BOOTSTRAP_PASSWORD = 'Pumpkin2026Night';
process.env.APP_SECRET = 'test-app-secret-0123456789-abcdefghijklmnop';
process.env.PORTAL_JWT_SECRET = 'test-portal-secret-0123456789-abcdefghijkl';
process.env.INTEGRATION_SECRET = 'test-integration-secret-0123456789-abcdefg';
process.env.NODE_ENV = 'test';

const Engine = require('../shared/engine');
const server = require('../server/index');
const db = require('../server/db');
const sec = require('../server/security');
const settings = require('../server/settings');
const game = require('../server/game');

const BASE = 'http://127.0.0.1:' + process.env.PORT;
let passed = 0;
const results = [];

async function api(method, p, body, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {});
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
  if (opts.cookie) headers.Cookie = opts.cookie;
  if (opts.csrf) headers['X-CSRF-Token'] = opts.csrf;
  if (p.startsWith('/api/admin') && !opts.raw) p = ADMIN + p;
  const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = text; }
  return { status: res.status, data, headers: res.headers };
}

async function step(name, fn) {
  try {
    await fn();
    passed++;
    results.push('  ✔ ' + name);
  } catch (e) {
    results.push('  ✘ ' + name + '\n      ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n      ') : e));
    throw e;
  }
}

// Bot: chơi "hoàn hảo" bằng engine, phản xạ ~260ms, né bom; dừng khi đạt targetScore.
function botEvents(seed, cfg, targetScore, maxMs) {
  const g = new Engine.Game(seed, cfg);
  const sp = g.spawner;
  const events = [];
  let busy = 0, idx = 0;
  while (g.score < targetScore) {
    sp.generateUntil(sp.generatedUntil + 2000);
    if (idx >= sp.spawns.length) continue;
    const s = sp.spawns[idx++];
    if (s.at > maxMs) break;
    if (s.type === 'bomb') continue;
    let t = Math.max(busy, s.at + 260 + (s.id % 7) * 15);
    if (t + (s.hp - 1) * 130 > s.at + s.dur - 30) continue;
    for (let k = 0; k < s.hp && g.score < targetScore + 1000; k++) {
      const r = g.tap(Math.round(t), s.hole);
      events.push([Math.round(t), s.hole]);
      if (r.kind === 'kill' && g.score >= targetScore) break;
      t += 130;
    }
    busy = t;
  }
  return { events, score: g.score, endT: events.length ? events[events.length - 1][0] + 50 : 0, game: g };
}

function backdate(sid, ms) {
  db.run('UPDATE sessions SET started_at = started_at - ? WHERE id = ?', ms, sid);
}

async function playSession(token, targetScore, opts) {
  opts = opts || {};
  const st = await api('POST', '/api/game/start', { engine: Engine.VERSION, device: { device: 'mobile', touch: true } }, { token });
  if (st.status !== 200) return { start: st };
  const { sessionId, seed, cfg } = st.data;
  const bot = botEvents(seed, cfg, targetScore, 600000);
  backdate(sessionId, bot.endT + 4000);
  // gửi theo lô mỗi 3 giây game
  let base = 0, lastSync = 0;
  for (let i = 0; i < bot.events.length; i++) {
    const t = bot.events[i][0];
    if (t - lastSync >= 3000) {
      const batch = bot.events.slice(base, i);
      const r = await api('POST', '/api/game/sync', { sid: sessionId, base, ev: batch, gt: t, paused: false }, { token });
      assert.strictEqual(r.status, 200, 'sync status ' + JSON.stringify(r.data));
      assert.strictEqual(r.data.acked, i);
      base = i; lastSync = t;
    }
  }
  const fin = await api('POST', '/api/game/finish', { sid: sessionId, base, ev: bot.events.slice(base), gt: bot.endT, reason: 'quit' }, { token });
  return { start: st, bot, fin, sessionId };
}

(async function main() {
  await new Promise((r) => server.once('listening', r).listening ? r() : null);
  await new Promise((r) => setTimeout(r, 200));
  console.log('Self-test trên ' + BASE + ' (DB tạm: ' + TMP + ')');

  // ---------------------------------------------------------- engine
  await step('Engine tất định: cùng seed + thao tác -> cùng kết quả', () => {
    const cfg = settings.gameConfig(settings.defaults());
    for (let i = 0; i < 200; i++) {
      const seed = (i * 2654435761) | 0;
      const b = botEvents(seed, cfg, 400 + (i % 5) * 100, 300000);
      const r = Engine.replay(seed, cfg, b.events, b.endT);
      assert.strictEqual(r.summary.score, b.score);
    }
  });
  await step('Engine: bom thứ 2 kết thúc ván, combo tính đúng', () => {
    const cfg = settings.gameConfig(settings.defaults());
    cfg.rules.idleMs = 0; // bỏ luật 10 giây để đập thẳng vào bom
    const g = new Engine.Game(7, cfg);
    g.spawner.generateUntil(120000);
    const bombs = g.spawner.spawns.filter((s) => s.type === 'bomb').slice(0, 2);
    const r1 = g.tap(bombs[0].at + 50, bombs[0].hole);
    assert.strictEqual(r1.kind, 'bomb'); assert.strictEqual(r1.dead, false);
    const r2 = g.tap(bombs[1].at + 50, bombs[1].hole);
    assert.strictEqual(r2.kind, 'bomb'); assert.strictEqual(r2.dead, true);
    assert.strictEqual(g.tap(bombs[1].at + 100, 0).kind, 'ignored');
    const c = Engine.comboBonus(cfg, 2) + Engine.comboBonus(cfg, 3) + Engine.comboBonus(cfg, 4) + Engine.comboBonus(cfg, 9);
    assert.strictEqual(c, 2 + 3 + 4 + 5);
  });

  await step('Engine v2: mọi vật phẩm nổi bằng nhau; chỉ được giữ lại sau cú đập trúng', () => {
    const cfg = settings.gameConfig(settings.defaults());
    const g = new Engine.Game(11, cfg);
    g.spawner.generateUntil(30000);
    const early = g.spawner.spawns.filter((x) => x.at < 20000 && !x.rush && x.type !== 'bomb' && Engine.BOSS_TYPES.indexOf(x.type) < 0);
    const byDur = {};
    early.forEach((x) => { const D = Engine.difficultyAt(cfg, x.at); assert.strictEqual(x.dur, D.upTime, x.type + ' dur'); byDur[x.type] = 1; });
    assert.ok(Object.keys(byDur).length >= 3, 'nhiều loại vật phẩm');
    const iron = g.spawner.spawns.find((x) => x.type === 'pumpkinIron');
    assert.ok(iron, 'có bí nón sắt');
    const t1 = iron.at + iron.dur - 60;
    assert.strictEqual(g.tap(t1, iron.hole).kind, 'hit');
    // sau cú đập đầu, vẫn đập tiếp được dù đã quá thời gian nổi ban đầu
    assert.notStrictEqual(g.tap(iron.at + iron.dur + 200, iron.hole).kind, 'miss');
  });

  await step('Engine v2: nhiều ô cùng lúc, bom hoá trang (level 3/5), boss 5 rồi 10 đập', () => {
    const cfg = settings.gameConfig(settings.defaults());
    let burst = 0, skins = {}, bosses = [];
    for (let seed = 1; seed <= 30; seed++) {
      const sp = new Engine.Game(seed, cfg).spawner;
      sp.generateUntil(240000);
      const at = {};
      sp.spawns.forEach((x) => {
        at[x.at] = (at[x.at] || 0) + 1;
        if (x.skin) { skins[x.skin] = Math.min(skins[x.skin] || 99, x.level); assert.strictEqual(x.type, 'bomb'); }
        if (Engine.BOSS_TYPES.indexOf(x.type) >= 0 && seed === 1) bosses.push(x);
      });
      burst = Math.max(burst, Math.max.apply(null, Object.values(at)));
    }
    assert.ok(burst >= 3, 'có lúc hiện ' + burst + ' ô cùng lúc');
    assert.ok(skins.cloth >= 3 && skins.iron >= 3, 'bom nón vải/sắt từ level 3: ' + JSON.stringify(skins));
    assert.ok(skins.potion >= 5, 'bom giả nồi thuốc độc từ level 5');
    assert.ok(bosses.length >= 2, 'có boss');
    assert.strictEqual(bosses[0].type, 'boss'); assert.strictEqual(bosses[0].hp, 5); assert.ok(bosses[0].level >= 4);
    assert.strictEqual(bosses[1].type, 'bossArmor'); assert.strictEqual(bosses[1].hp, 10);
    assert.ok(bosses.every((b) => b.hp <= 10));
  });

  await step('Engine v3: đầu game đã có nhiều ô cùng lúc; thỉnh thoảng tràn đồng cả 9 ô (bom có giới hạn)', () => {
    const cfg = settings.gameConfig(settings.defaults());
    const sp = new Engine.Game(21, cfg).spawner;
    sp.generateUntil(120000);
    const early = {};
    sp.spawns.filter((x) => x.at < 15000 && !x.rush).forEach((x) => { early[x.at] = (early[x.at] || 0) + 1; });
    assert.ok(Math.max.apply(null, Object.values(early)) >= 3, 'đầu game có lúc 3+ con cùng lúc');
    const waves = {};
    sp.spawns.filter((x) => x.rush).forEach((x) => { (waves[x.at] = waves[x.at] || []).push(x); });
    const list = Object.values(waves);
    assert.ok(list.length >= 3, 'có ít nhất 3 đợt tràn đồng trong 2 phút: ' + list.length);
    assert.ok(list[0][0].at <= 12000, 'đợt đầu sớm');
    list.forEach((w) => {
      assert.ok(w.length >= 6, 'tràn đồng ít nhất 6 ô: ' + w.length);
      assert.strictEqual(new Set(w.map((x) => x.hole)).size, w.length);
      assert.ok(w.filter((x) => x.type === 'bomb').length <= cfg.difficulty.rushBombMax);
    });
  });

  await step('Giới hạn 5 phút: chơi chậm mà chắc cũng tự kết thúc đúng lúc hết giờ; máy chủ ghi lý do "hết thời gian"', async () => {
    const cfg = settings.gameConfig(settings.defaults());
    assert.strictEqual(cfg.rules.maxMs, 300000);
    const g = new Engine.Game(7, cfg); g.spawner.generateUntil(400000);
    let next = 1000;
    for (const x of g.spawner.spawns) { if (x.type === 'bomb' || x.at < next) continue; let t = x.at + 400; for (let k = 0; k < x.hp; k++) { g.tap(t, x.hole); t += 300; } next = t + 3000; if (g.over()) break; }
    const sum = g.summary(400000);
    assert.strictEqual(sum.timeUp, true); assert.strictEqual(sum.endT, 300000); assert.strictEqual(sum.dead, false);
    assert.strictEqual(g.tap(300500, 0).kind, 'ignored');
    // qua máy chủ
    const tk = (await api('POST', '/api/auth/guest', { key: sec.randomToken(24) })).data.accessToken;
    const st = await api('POST', '/api/game/start', { engine: Engine.VERSION }, { token: tk });
    const ev = [];
    next = 1000;
    const g2 = new Engine.Game(st.data.seed, st.data.cfg); g2.spawner.generateUntil(400000);
    let lastTap = 0;
    const keepAlive = (until) => { // chạm ô trống mỗi 8 giây để không bị luật 10 giây kết thúc
      while (until - lastTap > 8000) { const t = lastTap + 8000; let h = 0; while (h < 9 && g2.spawnAt(h, t)) h++; ev.push([t, h % 9]); g2.tap(t, h % 9); lastTap = t; }
    };
    for (const x of g2.spawner.spawns) {
      if (x.type === 'bomb' || x.at < next) continue;
      let t = x.at + 400;
      keepAlive(t);
      if (g2.over()) break;
      for (let k = 0; k < x.hp; k++) { ev.push([t, x.hole]); g2.tap(t, x.hole); lastTap = t; t += 300; }
      next = t + 1500; if (g2.over()) break;
    }
    assert.strictEqual(g2.timeUp, true, 'bot thử phải chơi tới hết giờ');
    backdate(st.data.sessionId, 305000);
    let base = 0, last = 0;
    for (let i = 0; i < ev.length; i++) if (ev[i][0] - last >= 3000) { const r = await api('POST', '/api/game/sync', { sid: st.data.sessionId, base, ev: ev.slice(base, i), gt: ev[i][0] }, { token: tk }); if (r.data.ended) break; base = i; last = ev[i][0]; }
    const fin = await api('POST', '/api/game/finish', { sid: st.data.sessionId, base, ev: ev.slice(base).filter((e) => e[0] < 300000), gt: 300000, reason: 'quit' }, { token: tk });
    assert.strictEqual(fin.data.result.endReason, 'time', JSON.stringify(fin.data.result).slice(0, 200));
    assert.ok(fin.data.result.durationMs <= 300000);
    // dọn dữ liệu của bài này để các bài đếm coupon phía sau không bị lệch
    db.run('DELETE FROM coupons WHERE session_id = ?', st.data.sessionId);
  });

  await step('Engine v7: không bao giờ trống vật phẩm quá 3 giây (kể cả lúc có boss + tràn đồng)', () => {
    const cfg = settings.gameConfig(settings.defaults());
    for (let seed = 1; seed <= 120; seed++) {
      const sp = new Engine.Spawner(seed, cfg); sp.generateUntil(300000);
      const at = sp.spawns.filter((x) => x.type !== 'bomb').map((x) => x.at).sort((a, b) => a - b);
      for (let i = 1; i < at.length; i++) assert.ok(at[i] - at[i - 1] <= 3000, 'seed ' + seed + ' trống ' + (at[i] - at[i - 1]) + 'ms lúc ' + at[i - 1]);
    }
  });

  await step('Engine v2: 10 giây không thao tác -> tự kết thúc lượt', () => {
    const cfg = settings.gameConfig(settings.defaults());
    const g = new Engine.Game(5, cfg);
    assert.strictEqual(g.checkIdle(9000), false);
    assert.strictEqual(g.checkIdle(10500), true);
    const sum = g.summary(30000);
    assert.strictEqual(sum.idle, true);
    assert.strictEqual(sum.endT, 10000);
    assert.strictEqual(g.tap(11000, 0).kind, 'ignored');
  });

  // ---------------------------------------------------------- đăng nhập
  let token;
  await step('Đăng nhập demo + /api/me (3 lượt)', async () => {
    const r = await api('POST', '/api/auth/demo', { id: 'tester1' });
    assert.strictEqual(r.status, 200);
    token = r.data.accessToken;
    const me = await api('GET', '/api/me', undefined, { token });
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.data.turns.turns, 3);
  });

  await step('Token Portal: chữ ký sai bị từ chối, token đúng được chấp nhận, jti không dùng lại được', async () => {
    const now = Math.floor(Date.now() / 1000);
    const bad = sec.signJwt({ sub: 'KH1001', iat: now, exp: now + 600 }, 'sai-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx');
    assert.strictEqual((await api('POST', '/api/auth/portal', { token: bad })).status, 401);
    const none = Buffer.from('{"alg":"none"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: 'KH1001', exp: now + 600 })).toString('base64url') + '.';
    assert.strictEqual((await api('POST', '/api/auth/portal', { token: none })).status, 401);
    const expired = sec.signJwt({ sub: 'KH1001', iat: now - 7200, exp: now - 3600 }, process.env.PORTAL_JWT_SECRET);
    assert.strictEqual((await api('POST', '/api/auth/portal', { token: expired })).status, 401);
    const good = sec.signJwt({ sub: 'KH1001', iat: now, exp: now + 600, jti: 'abc-1' }, process.env.PORTAL_JWT_SECRET);
    const ok = await api('POST', '/api/auth/portal', { token: good });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual((await api('POST', '/api/auth/portal', { token: good })).status, 401);
    const me = await api('GET', '/api/me', undefined, { token: ok.data.accessToken });
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.data.player.test, false);
  });

  await step('Đăng nhập khách: khoá sai bị từ chối; cùng khoá -> cùng người chơi', async () => {
    assert.strictEqual((await api('POST', '/api/auth/guest', { key: 'ngan' })).status, 400);
    const key = sec.randomToken ? sec.randomToken(24) : require('crypto').randomBytes(24).toString('base64url');
    const a = await api('POST', '/api/auth/guest', { key });
    assert.strictEqual(a.status, 200);
    const b = await api('POST', '/api/auth/guest', { key });
    const ma = await api('GET', '/api/me', undefined, { token: a.data.accessToken });
    const mb = await api('GET', '/api/me', undefined, { token: b.data.accessToken });
    assert.strictEqual(ma.data.player.id, mb.data.player.id);
    assert.strictEqual(ma.data.player.test, false);
  });

  await step('API yêu cầu token: không có token -> 401', async () => {
    assert.strictEqual((await api('POST', '/api/game/start', {})).status, 401);
    assert.strictEqual((await api('GET', '/api/coupons', undefined, { token: 'x'.repeat(43) })).status, 401);
  });

  // ---------------------------------------------------------- chơi & coupon
  let first;
  await step('Chơi 1 lượt tới ~260 điểm: server tự tính lại đúng điểm, cấp voucher Email', async () => {
    first = await playSession(token, 260);
    assert.strictEqual(first.fin.status, 200, JSON.stringify(first.fin.data));
    const res = first.fin.data.result;
    assert.strictEqual(res.score, first.bot.score);
    assert.ok(res.score >= 260 && res.score < 450, 'score ' + res.score);
    assert.strictEqual(res.award.status, 'issued');
    assert.strictEqual(res.award.tier.id, 'email');
    assert.ok(res.next && res.next.id === 'cloud' && res.next.need === 450 - res.score);
  });

  let couponId, code;
  await step('Nhận coupon: hiện mã; gọi lại vẫn cùng 1 mã (không nhân bản)', async () => {
    couponId = first.fin.data.result.award.coupon.id;
    const a = await api('POST', '/api/coupons/' + couponId + '/reveal', {}, { token });
    assert.strictEqual(a.status, 200);
    code = a.data.coupon.code;
    assert.ok(/^TEST-HLWEM-[A-Z0-9]{8}$/.test(code), code);
    const b = await api('POST', '/api/coupons/' + couponId + '/reveal', {}, { token });
    assert.strictEqual(b.data.coupon.code, code);
    const list = await api('GET', '/api/coupons', undefined, { token });
    assert.strictEqual(list.data.coupons.length, 1);
  });

  await step('Gửi lại "finish" của lượt đã xong không tạo thêm coupon', async () => {
    const again = await api('POST', '/api/game/finish', { sid: first.sessionId, base: 0, ev: [], gt: 1000, reason: 'quit' }, { token });
    assert.strictEqual(again.status, 200);
    assert.strictEqual(db.get('SELECT COUNT(*) n FROM coupons').n, 1);
  });

  await step('Đạt lại mốc Email lần nữa -> nhận thêm voucher mới (mặc định không giới hạn)', async () => {
    const r = await playSession(token, 230);
    assert.strictEqual(r.fin.data.result.award.status, 'issued');
    assert.strictEqual(db.get('SELECT COUNT(*) n FROM coupons').n, 2);
  });

  await step('Hết 3 lượt -> server từ chối lượt thứ 4 (429) và trả thời điểm hồi lượt', async () => {
    const r3 = await playSession(token, 50);
    assert.strictEqual(r3.fin.status, 200);
    const r4 = await api('POST', '/api/game/start', { engine: Engine.VERSION }, { token });
    assert.strictEqual(r4.status, 429);
    assert.strictEqual(r4.data.error, 'no_turns');
    assert.ok(r4.data.nextAt > Date.now());
  });

  await step('Hồi lượt theo thời gian (giả lập 10 phút trôi qua)', async () => {
    db.run("UPDATE players SET turns_at = turns_at - 600000 WHERE ext_id = 'demo-tester1'");
    const me = await api('GET', '/api/me', undefined, { token });
    assert.strictEqual(me.data.turns.turns, 1);
  });

  // ---------------------------------------------------------- gian lận
  let tok2;
  await step('Gian lận: đồng hồ game chạy nhanh hơn thời gian thật -> lượt KHÔNG HỢP LỆ, không coupon', async () => {
    tok2 = (await api('POST', '/api/auth/demo', { id: 'cheater' })).data.accessToken;
    const st = await api('POST', '/api/game/start', { engine: Engine.VERSION }, { token: tok2 });
    const { sessionId, seed, cfg } = st.data;
    const bot = botEvents(seed, cfg, 800, 600000);
    // KHÔNG lùi started_at: gửi thao tác "ở tương lai" so với thời gian thật
    const r = await api('POST', '/api/game/finish', { sid: sessionId, base: 0, ev: bot.events, gt: bot.endT, reason: 'quit' }, { token: tok2 });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.result.award.status, 'invalid');
    assert.strictEqual(r.data.result.score, 0);
    const row = db.get('SELECT status FROM sessions WHERE id = ?', sessionId);
    assert.strictEqual(row.status, 'invalid');
  });

  await step('Gian lận: tự gửi điểm/thao tác sai thứ tự -> không hợp lệ', async () => {
    const st = await api('POST', '/api/game/start', { engine: Engine.VERSION }, { token: tok2 });
    backdate(st.data.sessionId, 60000);
    const r = await api('POST', '/api/game/finish', { sid: st.data.sessionId, base: 0, ev: [[5000, 1], [3000, 2]], gt: 6000, score: 99999, reason: 'quit' }, { token: tok2 });
    assert.strictEqual(r.data.result.award.status, 'invalid');
  });

  await step('Gian lận: điểm do client gửi bị bỏ qua (server tự tính)', async () => {
    const st = await api('POST', '/api/game/start', { engine: Engine.VERSION }, { token: tok2 });
    backdate(st.data.sessionId, 30000);
    const r = await api('POST', '/api/game/finish', { sid: st.data.sessionId, base: 0, ev: [], gt: 20000, score: 5000, reason: 'quit' }, { token: tok2 });
    assert.strictEqual(r.data.result.score, 0);
    assert.strictEqual(r.data.result.award.status, 'none');
  });

  await step('Gian lận: dùng lượt / coupon của người khác -> 404', async () => {
    const tok3 = (await api('POST', '/api/auth/demo', { id: 'tomo' })).data.accessToken;
    const other = await api('POST', '/api/coupons/' + couponId + '/reveal', {}, { token: tok3 });
    assert.strictEqual(other.status, 404);
    const s2 = await api('POST', '/api/game/sync', { sid: first.sessionId, base: 0, ev: [], gt: 1 }, { token: tok3 });
    assert.strictEqual(s2.status, 404);
  });

  await step('Gian lận: auto click dồn dập -> chặn ngay, lượt bị huỷ; 3 lượt gian lận liên tiếp -> tạm khoá chơi 24 giờ (không khoá vĩnh viễn)', async () => {
    const key = sec.randomToken(24);
    const gt = (await api('POST', '/api/auth/guest', { key })).data.accessToken;
    let r;
    for (let k = 0; k < 3; k++) {
      const st = await api('POST', '/api/game/start', { engine: Engine.VERSION }, { token: gt });
      assert.strictEqual(st.status, 200, JSON.stringify(st.data));
      backdate(st.data.sessionId, 20000);
      const ev = [];
      // dồn dập trong 1 giây đầu (chưa có bom) để kết quả không phụ thuộc vào việc trúng bom
      for (let i = 0; i < 60; i++) ev.push([1000 + i * 15, i % 9]);
      r = await api("POST", "/api/game/sync", { sid: st.data.sessionId, base: 0, ev, gt: 2000, paused: false }, { token: gt });
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.data.ended, true, 'máy chủ dừng lượt ngay');
      assert.strictEqual(r.data.result.award.status, 'invalid');
      assert.strictEqual(r.data.result.score, 0);
      assert.strictEqual(!!r.data.result.lockedUntil, k === 2, 'lần ' + (k + 1));
      assert.strictEqual(r.data.result.banned, false, 'không khoá vĩnh viễn');
    }
    const again = await api('POST', '/api/game/start', { engine: Engine.VERSION }, { token: gt });
    assert.strictEqual(again.status, 403);
    assert.strictEqual(again.data.error, 'locked', 'tạm khoá chơi');
    // vẫn vào được trang chủ, chỉ không bắt đầu lượt được; hết hạn khoá là chơi lại được
    const relog = await api('POST', '/api/auth/guest', { key });
    assert.strictEqual(relog.status, 200);
    const pid = db.get('SELECT player_id FROM auth_tokens ORDER BY created_at DESC LIMIT 1').player_id;
    const lk = db.get('SELECT locked_until FROM players WHERE id = ?', pid).locked_until;
    assert.ok(lk > Date.now() + 23 * 3600e3 && lk < Date.now() + 25 * 3600e3, 'khoá khoảng 24 giờ');
    db.run('UPDATE players SET locked_until = ? WHERE id = ?', Date.now() - 1000, pid);
    db.run('UPDATE players SET turns_at = turns_at - 3600000 WHERE id = ?', pid);
    const back = await api('POST', '/api/game/start', { engine: Engine.VERSION }, { token: relog.data.accessToken });
    assert.strictEqual(back.status, 200, 'hết hạn khoá chơi lại được: ' + JSON.stringify(back.data));
  });

  await step('Gian lận: trình duyệt báo có AI/công cụ chơi hộ -> từ chối bắt đầu; đang chơi thì huỷ lượt ngay', async () => {
    const tk = (await api('POST', '/api/auth/guest', { key: sec.randomToken(24) })).data.accessToken;
    const no = await api('POST', '/api/game/start', { engine: Engine.VERSION, bot: 'webdriver' }, { token: tk });
    assert.strictEqual(no.status, 403); assert.strictEqual(no.data.error, 'automation');
    const st = await api('POST', '/api/game/start', { engine: Engine.VERSION }, { token: tk });
    backdate(st.data.sessionId, 8000);
    const r = await api('POST', '/api/game/sync', { sid: st.data.sessionId, base: 0, ev: [], gt: 3000, bot: 'mouse_jump' }, { token: tk });
    assert.strictEqual(r.data.ended, true);
    assert.strictEqual(r.data.result.award.status, 'invalid');
    const f = JSON.parse(db.get('SELECT flags_json FROM sessions WHERE id = ?', st.data.sessionId).flags_json);
    assert.ok(JSON.stringify(f).includes('bot_mouse_jump'));
    // giá trị lạ bị bỏ qua (không cho lợi dụng)
    const st2 = await api('POST', '/api/game/start', { engine: Engine.VERSION, bot: '<script>' }, { token: tk });
    assert.strictEqual(st2.status, 200);
  });

  await step('Chống gian lận: phân tích đồng hồ chậm (speed hack) & phản xạ máy móc', () => {
    const s = settings.current();
    const syncs = [];
    for (let i = 0; i <= 20; i++) syncs.push([i * 3000, i * 1500, 0]); // game chạy 0.5x thời gian thật
    const a = game.analyze({ syncs }, { reactionCount: 50, reactionMedian: 90, maxTapRate: 6, taps: 150, hits: 149, endT: 30000, bombsShown: 3, bombsHit: 0 }, s);
    const codes = a.flags.map((f) => f.code);
    assert.ok(codes.includes('slow_clock'), codes.join());
    assert.ok(codes.includes('fast_reaction'));
    assert.ok(codes.includes('too_precise'));
    // gõ phím 1–9 rất nhanh nhưng có trượt -> KHÔNG bị coi là gian lận; nhanh mà gần như không trượt -> nghi auto click
    const human = game.analyze({ syncs: syncs.map((x) => [x[0], x[0], 0]) }, { reactionCount: 50, reactionMedian: 380, maxTapRate: 26, taps: 120, hits: 84, endT: 60000, bombsShown: 10, bombsHit: 1 }, s);
    assert.ok(!human.flags.some((x) => x.code === 'tap_rate'), 'người chơi bàn phím nhanh không bị gắn cờ');
    const bot = game.analyze({ syncs: syncs.map((x) => [x[0], x[0], 0]) }, { reactionCount: 50, reactionMedian: 380, maxTapRate: 26, taps: 120, hits: 119, endT: 60000, bombsShown: 10, bombsHit: 0 }, s);
    assert.ok(bot.flags.some((x) => x.code === 'tap_rate'), 'nhanh + không trượt -> nghi auto click');
    const ok = game.analyze({ syncs: syncs.map((x) => [x[0], x[0], 0]) }, { reactionCount: 50, reactionMedian: 420, maxTapRate: 5, taps: 100, hits: 80, endT: 60000, bombsShown: 10, bombsHit: 1 }, s);
    assert.strictEqual(ok.flags.length, 0);
  });

  // ---------------------------------------------------------- tích hợp billing
  await step('Webhook billing: chữ ký sai bị từ chối; chữ ký đúng đánh dấu coupon đã dùng', async () => {
    const body = JSON.stringify({ code, orderId: 'DH-1001' });
    const ts = String(Math.floor(Date.now() / 1000));
    const bad = await api('POST', '/api/integration/coupon-redeemed', body, { headers: { 'X-HLW-Timestamp': ts, 'X-HLW-Signature': 'sha256=deadbeef' } });
    assert.strictEqual(bad.status, 401);
    const sig = sec.hmac(process.env.INTEGRATION_SECRET, ts + '.' + body);
    const chk = await api('POST', '/api/integration/coupon-check', JSON.stringify({ code }), { headers: { 'X-HLW-Timestamp': ts, 'X-HLW-Signature': 'sha256=' + sec.hmac(process.env.INTEGRATION_SECRET, ts + '.' + JSON.stringify({ code })) } });
    assert.strictEqual(chk.status, 200);
    assert.strictEqual(chk.data.status, 'active');
    const ok = await api('POST', '/api/integration/coupon-redeemed', body, { headers: { 'X-HLW-Timestamp': ts, 'X-HLW-Signature': 'sha256=' + sig } });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
    assert.strictEqual(db.get('SELECT status FROM coupons WHERE id = ?', couponId).status, 'redeemed');
  });

  // ---------------------------------------------------------- admin
  await step('Trang quản trị chỉ có ở đường dẫn bí mật; /admin/ không tồn tại; trang game không chứa mã coupon', async () => {
    const a = await api('GET', ADMIN + '/');
    assert.strictEqual(a.status, 200);
    assert.ok(String(a.data).includes('Đăng nhập'));
    assert.ok(/noindex/.test(a.headers.get('x-robots-tag') || ''));
    assert.strictEqual((await api('GET', '/admin/')).status, 404);
    assert.strictEqual((await api('GET', '/admin/admin.js')).status, 404);
    const home = await api('GET', '/');
    assert.ok(!String(home.data).includes(process.env.ADMIN_PATH), 'trang game không lộ đường dẫn admin');
    for (const p of ['/', '/js/game.js', '/js/api.js', '/api/public/config']) {
      const r = await api('GET', p);
      assert.ok(!String(typeof r.data === 'string' ? r.data : JSON.stringify(r.data)).includes(code), 'không lộ mã ở ' + p);
    }
  });

  await step('Bảo mật: API quản trị bị giấu (404 như trang không tồn tại); không tải được mã nguồn / dữ liệu / cấu hình máy chủ', async () => {
    const a = await api('GET', '/api/admin/me', undefined, { raw: true });
    const b = await api('GET', '/api/khong-ton-tai', undefined, { raw: true });
    assert.strictEqual(a.status, 404); assert.deepStrictEqual(a.data, b.data);
    assert.strictEqual((await api('POST', '/api/admin/login', { username: 'boss', password: 'x' }, { raw: true })).status, 404);
    for (const p of ['/server/env.js', '/server/coupons.js', '/data/hlw2026.db', '/data/secrets.json', '/.env', '/.git/config', '/package.json', '/scripts/selftest.js',
      '/js/../../server/env.js', '/assets/..%2f..%2fserver%2fenv.js', ADMIN + '/../../data/secrets.json', ADMIN + '/..%2f..%2fdata%2fsecrets.json']) {
      const r = await api('GET', p, undefined, { raw: true });
      assert.strictEqual(r.status, 404, p + ' -> ' + r.status);
    }
    const home = await api('GET', '/');
    for (const p of ['/', '/js/game.js', '/js/api.js', '/js/art.js', '/shared/engine.js']) {
      const r = await api('GET', p);
      assert.ok(!String(r.data).includes(process.env.ADMIN_PATH) && !/api\/admin|INTEGRATION_SECRET|APP_SECRET|COUPON_API_KEY/.test(String(r.data)), 'lộ thông tin quản trị ở ' + p);
    }
    assert.ok(home.headers.get('content-security-policy'));
  });

  await step('Bảo mật: người chơi KHÔNG tự chọn được mốc / mức giảm giá (gửi kèm tier, discount, score đều bị bỏ qua)', async () => {
    const tk = (await api('POST', '/api/auth/guest', { key: sec.randomToken(24) })).data.accessToken;
    const st = await api('POST', '/api/game/start', { engine: Engine.VERSION, tier: 'hosting', discount: 99 }, { token: tk });
    backdate(st.data.sessionId, 9000);
    const r = await api('POST', '/api/game/finish', { sid: st.data.sessionId, base: 0, ev: [], gt: 3000, reason: 'quit', score: 9999, tierId: 'hosting', discount: 99, coupon: { discount: 99 } }, { token: tk });
    assert.strictEqual(r.data.result.score, 0);
    assert.strictEqual(r.data.result.award.status, 'none');
    assert.strictEqual(db.get('SELECT COUNT(*) n FROM coupons WHERE session_id = ?', st.data.sessionId).n, 0);
    // mức giảm của mọi voucher đã cấp đều đúng cấu hình máy chủ
    const cfgTiers = settings.current().tiers;
    for (const c of db.all('SELECT tier_id, discount FROM coupons')) assert.strictEqual(c.discount, cfgTiers.find((t) => t.id === c.tier_id).discount);
  });

  await step('Nhúng Portal: trang game cho phép portal.inet.vn nhúng (iframe); trang quản trị KHÔNG cho ai nhúng', async () => {
    const g = await api('GET', '/');
    const csp = g.headers.get('content-security-policy');
    assert.ok(/frame-ancestors[^;]*https:\/\/portal\.inet\.vn/.test(csp), csp);
    assert.ok(!g.headers.get('x-frame-options'), 'game không được gửi X-Frame-Options');
    const a = await api('GET', ADMIN + '/');
    assert.ok(/frame-ancestors 'none'/.test(a.headers.get('content-security-policy')));
    assert.strictEqual(a.headers.get('x-frame-options'), 'DENY');
    // tham số userId trên URL không có tác dụng (chỉ nhận token Portal có chữ ký)
    const h = await api('GET', '/?userId=KH999&token=gia-mao');
    assert.strictEqual(h.status, 200);
    assert.strictEqual((await api('POST', '/api/auth/portal', { token: 'gia-mao' })).status, 401);
  });

  let cookie, csrf;
  await step('Admin: sai mật khẩu bị từ chối; đăng nhập đúng -> bắt đổi mật khẩu lần đầu', async () => {
    assert.strictEqual((await api('POST', '/api/admin/login', { username: 'boss', password: 'sai' })).status, 401);
    const r = await api('POST', '/api/admin/login', { username: 'boss', password: 'Pumpkin2026Night' });
    assert.strictEqual(r.status, 200);
    cookie = r.headers.get('set-cookie').split(';')[0];
    csrf = r.data.admin.csrf;
    assert.ok(/HttpOnly/.test(r.headers.get('set-cookie')) && /SameSite=Strict/.test(r.headers.get('set-cookie')));
    assert.strictEqual((await api('GET', '/api/admin/stats', undefined, { cookie })).status, 403);
    const pw = await api('POST', '/api/admin/password', { current: 'Pumpkin2026Night', next: 'NewPassword2026x' }, { cookie, csrf });
    assert.strictEqual(pw.status, 200, JSON.stringify(pw.data));
  });

  await step('Admin: thao tác ghi thiếu CSRF token -> 403', async () => {
    const r = await api('PUT', '/api/admin/settings', { settings: settings.current() }, { cookie });
    assert.strictEqual(r.status, 403);
  });

  await step('Admin: thống kê có đủ chỉ số', async () => {
    const r = await api('GET', '/api/admin/stats?all=1&test=1', undefined, { cookie });
    assert.strictEqual(r.status, 200);
    const k = r.data.kpi;
    assert.ok(k.players >= 2 && k.sessions >= 6, JSON.stringify(k));
    assert.ok(r.data.coupons.find((c) => c.id === 'email').issued === 2);
    assert.ok(Array.isArray(r.data.funnel) && r.data.funnel.length === 7);
  });

  await step('Admin: lưu cấu hình hợp lệ tạo phiên bản mới; cấu hình sai bị chặn', async () => {
    const s = JSON.parse(JSON.stringify(settings.current()));
    s.turns.max = 5;
    const ok = await api('PUT', '/api/admin/settings', { settings: s, note: 'test' }, { cookie, csrf });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.data));
    assert.strictEqual(ok.data.settings.turns.max, 5);
    const bad = JSON.parse(JSON.stringify(s));
    bad.campaign.end = '2020-01-01T00:00:00+07:00';
    const r = await api('PUT', '/api/admin/settings', { settings: bad }, { cookie, csrf });
    assert.strictEqual(r.status, 400);
  });

  await step('Admin: phân quyền — tài khoản "Chỉ xem" không được sửa cấu hình', async () => {
    const c = await api('POST', '/api/admin/admins', { username: 'viewer1', role: 'viewer' }, { cookie, csrf });
    assert.strictEqual(c.status, 200);
    const l = await api('POST', '/api/admin/login', { username: 'viewer1', password: c.data.tempPassword });
    const vc = l.headers.get('set-cookie').split(';')[0];
    const vcsrf = l.data.admin.csrf;
    await api('POST', '/api/admin/password', { current: c.data.tempPassword, next: 'ViewerPass2026x' }, { cookie: vc, csrf: vcsrf });
    assert.strictEqual((await api('GET', '/api/admin/stats', undefined, { cookie: vc })).status, 200);
    assert.strictEqual((await api('PUT', '/api/admin/settings', { settings: settings.current() }, { cookie: vc, csrf: vcsrf })).status, 403);
    const list = await api('GET', '/api/admin/coupons?all=1&test=1', undefined, { cookie: vc });
    assert.ok(list.data.rows[0].code.includes('****'), 'viewer chỉ thấy mã đã che');
    assert.strictEqual((await api('POST', '/api/admin/coupons/' + couponId + '/code', {}, { cookie: vc, csrf: vcsrf })).status, 403);
  });

  await step('Admin: danh sách coupon luôn che mã (kể cả quản lý); xem mã đầy đủ phải bấm riêng và được ghi nhật ký', async () => {
    const list = await api('GET', '/api/admin/coupons?all=1&test=1', undefined, { cookie });
    assert.ok(list.data.rows.length >= 2);
    assert.ok(list.data.rows.every((r) => !r.code || (r.code.includes('****') && r.code !== code)), 'không có mã đầy đủ trong danh sách');
    assert.ok(!JSON.stringify(list.data).includes(code));
    const pl = await api('GET', '/api/admin/players/' + db.get('SELECT player_id FROM coupons WHERE id = ?', couponId).player_id, undefined, { cookie });
    assert.ok(!JSON.stringify(pl.data).includes(code), 'chi tiết người chơi cũng che mã');
    assert.strictEqual((await api('POST', '/api/admin/coupons/' + couponId + '/code', {}, { cookie })).status, 403, 'thiếu CSRF');
    const r = await api('POST', '/api/admin/coupons/' + couponId + '/code', {}, { cookie, csrf });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.code, code);
    assert.ok(db.get("SELECT COUNT(*) n FROM audit_log WHERE action = 'coupon_view_code'").n >= 1);
  });

  await step('Admin: danh sách người chơi, chi tiết, xuất CSV', async () => {
    const r = await api('GET', '/api/admin/players?test=1', undefined, { cookie });
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.rows.length >= 2);
    const d = await api('GET', '/api/admin/players/' + r.data.rows[0].id, undefined, { cookie });
    assert.strictEqual(d.status, 200);
    const csv = await api('GET', '/api/admin/export/players?test=1', undefined, { cookie });
    assert.strictEqual(csv.status, 200);
    assert.ok(String(csv.data).includes('ID người chơi'));
  });

  await step('Admin: mô phỏng độ khó chạy được', async () => {
    const r = await api('POST', '/api/admin/simulate', { games: 50 }, { cookie, csrf });
    assert.strictEqual(r.status, 200);
    assert.ok(r.data.results.average.median > 0);
  });

  console.log(results.join('\n'));
  console.log('\nKẾT QUẢ: ' + passed + ' bài kiểm tra đạt.');
  server.close();
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => {
  console.log(results.join('\n'));
  console.error('\nTHẤT BẠI:', e && e.message);
  try { server.close(); db.close(); } catch (x) { /* bỏ qua */ }
  process.exit(1);
});
