'use strict';
/*
 * Halloween iNET 2026 — máy chủ game + trang quản trị.
 * Chạy: node server/index.js   (hoặc npm start)
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const env = require('./env');
const db = require('./db');
db.open(env.DB_PATH);

const Engine = require('../shared/engine');
const settings = require('./settings');
const players = require('./players');
const game = require('./game');
const coupons = require('./coupons');
const tracking = require('./tracking');
const admin = require('./admin');
const sec = require('./security');
const util = require('./util');
const { HttpError, Router, readJson, json, baseHeaders, cspFor, serveFile, serveStatic, clientIp, isHttps } = require('./http');

const PUBLIC = path.join(env.ROOT, 'public');
const SHARED = path.join(env.ROOT, 'shared');
const router = new Router();

settings.load();
settings.migrate();
admin.bootstrap();
const ADMIN_PREFIX = '/' + env.ADMIN_PATH + '/';

// ------------------------------------------------------------ API công khai cho game
function campaignInfo(s) {
  const st = settings.campaignStatus(s);
  return {
    name: s.campaign.name, title: s.campaign.title, subtitle: s.campaign.subtitle,
    start: st.start, end: st.end, status: st.status, testMode: s.campaign.testMode,
    maintenance: s.campaign.maintenance, maintenanceMessage: s.campaign.maintenance ? s.campaign.maintenanceMessage : '',
    portalUrl: s.campaign.portalUrl, periodText: s.campaign.periodText
  };
}

function guideInfo(s) {
  const items = {};
  for (const k of settings.ITEM_KEYS) {
    const it = s.items[k];
    items[k] = k === 'bomb' ? { enabled: it.enabled, label: it.label } : { enabled: it.enabled, label: it.label, points: it.points, hp: it.hp };
  }
  return {
    items,
    combo: s.combo,
    bombs: s.bombs,
    turns: s.turns,
    tiers: s.tiers.filter((t) => t.enabled).map((t) => ({ id: t.id, score: t.score, reward: t.reward, label: t.label, short: t.short, product: t.product, discount: t.discount, url: t.url })),
    couponExpiresAt: Date.parse(s.coupons.expiresAt),
    maxPerTier: s.coupons.maxPerTierPerPlayer,
    fallback: s.coupons.fallbackToLowerTier,
    codeParam: s.coupons.codeParam,
    utm: s.coupons.utm,
    features: s.features,
    gameOver: s.messages.gameOver,
    boss: s.boss,
    idleSeconds: s.antiCheat.idleSeconds,
    maxSeconds: s.turns.maxSeconds
  };
}

router.get('/api/public/config', (req, res) => {
  const s = settings.current();
  json(res, 200, {
    engine: Engine.VERSION,
    demo: env.ALLOW_DEMO_LOGIN,
    guest: env.GUEST_LOGIN,
    portalOrigins: env.PORTAL_ORIGINS.filter((o) => !o.includes('*')),
    campaign: campaignInfo(s)
  });
});

router.post('/api/auth/portal', async (req, res) => {
  const b = await readJson(req, 16 * 1024);
  const r = players.loginWithPortalToken(req, String(b.token || ''), b.device);
  json(res, 200, { accessToken: r.token.token, expiresAt: r.token.expiresAt });
});

router.post('/api/auth/demo', async (req, res) => {
  const b = await readJson(req, 4 * 1024);
  const r = players.loginDemo(req, b.id, b.device);
  json(res, 200, { accessToken: r.token.token, expiresAt: r.token.expiresAt });
});

router.post('/api/auth/guest', async (req, res) => {
  const b = await readJson(req, 4 * 1024);
  const r = players.loginGuest(req, b.key, b.device);
  json(res, 200, { accessToken: r.token.token, expiresAt: r.token.expiresAt });
});

router.get('/api/me', (req, res) => {
  const p = players.authenticate(req);
  const s = settings.current();
  const st = players.turnState(p, s);
  json(res, 200, {
    player: { id: players.maskId(p.ext_id), test: !!p.is_test, bestScore: p.best_score, bestCombo: p.best_combo, sessions: p.total_sessions },
    turns: players.publicTurns(st),
    owned: players.ownedTiers(p.id),
    campaign: campaignInfo(s),
    guide: guideInfo(s),
    active: s.features.resumeSession ? game.activeFor(p) : null,
    serverTime: Date.now()
  });
});

router.post('/api/game/start', async (req, res) => {
  const p = players.authenticate(req);
  const b = await readJson(req, 8 * 1024);
  try {
    json(res, 200, game.start(req, p, b));
  } catch (e) {
    if (e.code === 'no_turns') {
      const now = Date.now();
      const { day, hour } = util.vnParts(now);
      db.run('INSERT INTO events (player_id, is_test, type, created_at, day, hour) VALUES (?, ?, ?, ?, ?, ?)', p.id, p.is_test, 'no_turns', now, day, hour);
    }
    throw e;
  }
});

router.post('/api/game/sync', async (req, res) => {
  const p = players.authenticate(req);
  const b = await readJson(req, 128 * 1024);
  json(res, 200, game.sync(p, b));
});

router.post('/api/game/finish', async (req, res) => {
  const p = players.authenticate(req);
  const b = await readJson(req, 256 * 1024);
  json(res, 200, game.finish(p, b));
});

router.post('/api/game/abandon', async (req, res) => {
  const p = players.authenticate(req);
  const b = await readJson(req, 4 * 1024);
  json(res, 200, game.abandon(p, b));
});

router.get('/api/coupons', (req, res) => {
  const p = players.authenticate(req);
  json(res, 200, { coupons: coupons.listForPlayer(p.id) });
});

router.post('/api/coupons/:id/reveal', async (req, res, params) => {
  const p = players.authenticate(req);
  const rl = sec.rateLimit('reveal:' + p.id, 30, 60000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Thao tác quá nhanh');
  const r = await coupons.reveal(p.id, util.toInt(params.id, 0));
  if (r.error === 'not_found') throw new HttpError(404, 'not_found', 'Không tìm thấy coupon');
  if (r.error === 'held') throw new HttpError(409, 'held', 'Coupon đang được xác minh, vui lòng quay lại sau');
  if (r.error === 'pending') throw new HttpError(503, 'pending', 'Hệ thống đang tạo mã coupon, bạn thử lại sau ít giây nhé');
  json(res, 200, r);
});

router.post('/api/track', async (req, res) => {
  const p = players.authenticate(req);
  const b = await readJson(req, 4 * 1024);
  json(res, 200, tracking.track(p, b, req.playerDevice));
});

router.get('/api/leaderboard', (req, res) => {
  const p = players.authenticate(req);
  const s = settings.current();
  if (!s.features.leaderboard) throw new HttpError(404, 'disabled', 'Bảng xếp hạng chưa mở');
  const rows = db.all('SELECT ext_id, best_score, best_combo FROM players WHERE is_test = 0 AND banned = 0 AND best_score > 0 ORDER BY best_score DESC, best_combo DESC, first_play_at LIMIT 10');
  const rank = p.best_score > 0 ? db.get('SELECT COUNT(*) + 1 n FROM players WHERE is_test = 0 AND banned = 0 AND best_score > ?', p.best_score).n : null;
  json(res, 200, { top: rows.map((r) => ({ id: players.maskId(r.ext_id), score: r.best_score, combo: r.best_combo, me: r.ext_id === p.ext_id })), me: { rank, score: p.best_score } });
});

// ------------------------------------------------------------ tích hợp hệ thống billing (server-to-server, ký HMAC)
async function verifyIntegration(req) {
  const ip = clientIp(req);
  const rl = sec.rateLimit('integ:' + ip, 600, 60000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Quá nhiều yêu cầu');
  const body = await readJson(req, 64 * 1024);
  const ts = String(req.headers['x-hlw-timestamp'] || '');
  const sig = String(req.headers['x-hlw-signature'] || '').replace(/^sha256=/, '');
  if (!/^\d{10}$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw new HttpError(401, 'bad_timestamp', 'Timestamp không hợp lệ');
  const expected = sec.hmac(env.INTEGRATION_SECRET, ts + '.' + req.rawBody.toString('utf8'));
  if (!sec.safeEqual(expected, sig)) throw new HttpError(401, 'bad_signature', 'Chữ ký không hợp lệ');
  return body;
}

router.post('/api/integration/coupon-check', async (req, res) => {
  const b = await verifyIntegration(req);
  const c = coupons.findByCode(String(b.code || ''));
  if (!c) return json(res, 200, { valid: false, reason: 'not_found' });
  const p = players.getById(c.player_id);
  const st = coupons.couponStatus(c);
  const ownerOk = !b.customerId || (p && String(b.customerId) === p.ext_id);
  json(res, 200, {
    valid: st === 'active' && ownerOk && !c.is_test,
    status: st, ownerMatch: ownerOk, test: !!c.is_test,
    tier: c.tier_id, product: c.product, discountPercent: c.discount, expiresAt: c.expires_at ? new Date(c.expires_at).toISOString() : null
  });
});

router.post('/api/integration/coupon-redeemed', async (req, res) => {
  const b = await verifyIntegration(req);
  const c = coupons.findByCode(String(b.code || ''));
  if (!c) throw new HttpError(404, 'not_found', 'Không tìm thấy coupon');
  if (c.status === 'revoked') throw new HttpError(409, 'revoked', 'Coupon đã bị thu hồi');
  const at = b.redeemedAt ? Date.parse(b.redeemedAt) : Date.now();
  const changed = coupons.markRedeemed(c, b.orderId ? String(b.orderId).slice(0, 100) : null, Number.isFinite(at) ? at : Date.now());
  json(res, 200, { ok: true, alreadyRedeemed: !changed });
});

router.get('/healthz', (req, res) => json(res, 200, { ok: true, time: Date.now() }));

admin.routes(router);

// Trang game: điền tên miền thật vào thẻ chia sẻ (og:image phải là địa chỉ đầy đủ)
function siteOrigin(req) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!/^[a-z0-9.-]+(:[0-9]{1,5})?$/i.test(host)) return '';
  return (isHttps(req) ? 'https://' : 'http://') + host;
}
function serveIndex(req, res) {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').split('__ORIGIN__').join(siteOrigin(req));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Content-Security-Policy': cspFor('game'), 'Content-Length': Buffer.byteLength(html) });
  res.end(req.method === 'HEAD' ? undefined : html);
}

// ------------------------------------------------------------ phân phối request
const server = http.createServer(async (req, res) => {
  baseHeaders(req, res);
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return json(res, 400, { error: 'bad_url' }); }
  let pathname = url.pathname;
  try {
    // API quản trị CHỈ trả lời khi gọi qua đường dẫn bí mật (/<ADMIN_PATH>/api/admin/...).
    // Gọi thẳng /api/admin/... -> 404 giống hệt đường dẫn không tồn tại, không lộ là có trang quản trị.
    if (pathname.startsWith('/api/admin')) throw new HttpError(404, 'not_found', 'Không tìm thấy');
    if (pathname.startsWith(ADMIN_PREFIX + 'api/admin/')) pathname = pathname.slice(ADMIN_PREFIX.length - 1);
    if (pathname.startsWith('/api/') || pathname === '/healthz') {
      const m = router.match(req.method, pathname);
      if (!m) throw new HttpError(404, 'not_found', 'Không tìm thấy');
      if (m.methodNotAllowed) throw new HttpError(405, 'method_not_allowed', 'Phương thức không được hỗ trợ');
      await m.handler(req, res, m.params, url.searchParams);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Phương thức không được hỗ trợ');
    if (pathname === '/' || pathname === '/index.html') {
      serveIndex(req, res); return;
    } else if (pathname === ADMIN_PREFIX.slice(0, -1)) {
      res.writeHead(301, { Location: ADMIN_PREFIX }); res.end(); return;
    } else if (pathname === ADMIN_PREFIX || pathname === ADMIN_PREFIX + 'index.html') {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      if (serveFile(req, res, path.join(PUBLIC, 'admin', 'index.html'), { csp: cspFor('admin'), frameDeny: true })) return;
    } else if (pathname.startsWith(ADMIN_PREFIX)) {
      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      if (serveStatic(req, res, path.join(PUBLIC, 'admin'), pathname.slice(ADMIN_PREFIX.length - 1), { frameDeny: true })) return;
    } else if (pathname === '/shared/engine.js') {
      if (serveFile(req, res, path.join(SHARED, 'engine.js'))) return;
    } else if (/^\/(js|css|assets)\//.test(pathname)) {
      if (serveStatic(req, res, PUBLIC, pathname)) return;
    } else if (pathname === '/favicon.ico') {
      res.writeHead(204); res.end(); return;
    }
    throw new HttpError(404, 'not_found', 'Không tìm thấy trang');
  } catch (e) {
    if (!(e instanceof HttpError)) {
      console.error('[error]', req.method, pathname, e);
      e = new HttpError(500, 'server_error', 'Có lỗi xảy ra, vui lòng thử lại');
    }
    if (res.headersSent) { try { res.end(); } catch (x) { /* bỏ qua */ } return; }
    const body = Object.assign({ error: e.code, message: e.message }, e.extra || {});
    json(res, e.status, body, e.status === 429 && e.extra && e.extra.retryAfter ? { 'Retry-After': String(e.extra.retryAfter) } : undefined);
  }
});

// ------------------------------------------------------------ job định kỳ
setInterval(() => {
  try {
    game.sweepAbandoned();
    coupons.retryPending().catch((e) => console.error('[coupon retry]', e.message));
    const now = Date.now();
    db.run('DELETE FROM auth_tokens WHERE expires_at < ?', now - 3600000);
    db.run('DELETE FROM admin_sessions WHERE expires_at < ?', now);
    db.run('DELETE FROM used_jti WHERE expires_at < ?', now);
  } catch (e) { console.error('[jobs]', e); }
}, 30000).unref();

server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 65000;

server.listen(env.PORT, env.HOST, () => {
  console.log('[hlw2026] Game:  http://localhost:' + env.PORT + '/');
  console.log('[hlw2026] Admin: http://localhost:' + env.PORT + ADMIN_PREFIX);
  if (env.usingDevSecrets) console.log('[hlw2026] Đang dùng secret tự sinh cho môi trường DEV (data/dev-secrets.json). Production phải khai báo trong .env');
  if (env.ALLOW_DEMO_LOGIN) console.log('[hlw2026] Đăng nhập thử (demo) đang BẬT — nhớ tắt ở production (ALLOW_DEMO_LOGIN=false)');
});

function shutdown() {
  console.log('[hlw2026] Đang dừng...');
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

module.exports = server;
