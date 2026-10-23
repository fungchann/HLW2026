'use strict';
/*
 * API quản trị. Bảo vệ bằng:
 *  - cookie phiên HttpOnly + SameSite=Strict (+Secure khi chạy HTTPS)
 *  - CSRF token bắt buộc cho mọi thao tác ghi
 *  - phân quyền: viewer (chỉ xem) < manager (chỉnh cấu hình, xử lý coupon/người chơi) < superadmin (quản lý tài khoản, dữ liệu)
 *  - khoá tài khoản sau nhiều lần đăng nhập sai, giới hạn tần suất theo IP, (tuỳ chọn) danh sách IP được phép
 *  - nhật ký thao tác (audit log)
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');
const env = require('./env');
const sec = require('./security');
const settings = require('./settings');
const players = require('./players');
const coupons = require('./coupons');
const game = require('./game');
const stats = require('./stats');
const realtime = require('./realtime');
const util = require('./util');
const Engine = require('../shared/engine');
const { HttpError, readJson, json, send, parseCookies, setCookie, clientIp, isHttps } = require('./http');

const COOKIE = 'sid';
// cookie đăng nhập chỉ được gửi kèm khi ở trong đường dẫn quản trị bí mật
const COOKIE_PATH = '/' + env.ADMIN_PATH + '/';
const ROLES = { viewer: 1, manager: 2, superadmin: 3 };
const ROLE_LABEL = { viewer: 'Chỉ xem', manager: 'Quản lý', superadmin: 'Quản trị cao nhất' };

// ------------------------------------------------------------ khởi tạo tài khoản đầu tiên
function bootstrap() {
  resetFromEnv();
  const n = db.get('SELECT COUNT(*) n FROM admins').n;
  if (n > 0) return;
  let user = env.ADMIN_BOOTSTRAP_USER || 'admin';
  let pass = env.ADMIN_BOOTSTRAP_PASSWORD;
  let generated = false;
  if (pass && sec.passwordProblems(pass, user).length) {
    console.warn('[admin] ADMIN_BOOTSTRAP_PASSWORD không đạt yêu cầu (' + sec.passwordProblems(pass, user).join(' ') + ') — sẽ sinh mật khẩu ngẫu nhiên.');
    pass = '';
  }
  if (!pass) {
    pass = sec.randomToken(9) + 'Aa1';
    generated = true;
  }
  db.run('INSERT INTO admins (username, pass_hash, role, must_change, created_at) VALUES (?, ?, ?, ?, ?)',
    user, sec.hashPassword(pass), 'superadmin', 1, Date.now());
  if (generated) {
    const f = path.join(env.DATA_DIR, 'INITIAL_ADMIN_PASSWORD.txt');
    fs.writeFileSync(f, 'Tài khoản admin đầu tiên\nUsername: ' + user + '\nPassword: ' + pass +
      '\n\nĐăng nhập tại /admin, đổi mật khẩu ngay và XOÁ file này.\n', { mode: 0o600 });
    console.log('[admin] Đã tạo tài khoản "' + user + '". Mật khẩu tạm lưu tại: ' + f);
  } else {
    console.log('[admin] Đã tạo tài khoản "' + user + '" từ biến môi trường ADMIN_BOOTSTRAP_*');
  }
}

// Cấp tài khoản admin mới / cấp lại mật khẩu bằng biến môi trường ADMIN_RESET_USER (khi không chạy được lệnh trên máy chủ).
// Mỗi giá trị chỉ chạy 1 lần (khởi động lại không cấp lại). Mật khẩu tạm ghi vào data/ADMIN_<tên>_PASSWORD.txt (quyền 600),
// bắt buộc đổi ở lần đăng nhập đầu. Vai trò: ADMIN_RESET_ROLE (mặc định superadmin).
function resetFromEnv() {
  const user = String(env.ADMIN_RESET_USER || '').trim();
  if (!user) return;
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(user)) { console.warn('[admin] ADMIN_RESET_USER không hợp lệ (3–32 ký tự chữ/số/._-)'); return; }
  const role = ['viewer', 'manager', 'superadmin'].includes(env.ADMIN_RESET_ROLE) ? env.ADMIN_RESET_ROLE : 'superadmin';
  const mark = 'admin_reset:' + user + ':' + (env.ADMIN_RESET_TAG || '1');
  if (db.metaGet(mark)) return;
  const pass = sec.randomToken(9) + 'Aa1';
  const ex = db.get('SELECT id FROM admins WHERE username = ?', user);
  if (ex) {
    db.run('UPDATE admins SET pass_hash = ?, role = ?, must_change = 1, disabled = 0, failed_count = 0, locked_until = NULL WHERE id = ?', sec.hashPassword(pass), role, ex.id);
    db.run('DELETE FROM admin_sessions WHERE admin_id = ?', ex.id);
  } else {
    db.run('INSERT INTO admins (username, pass_hash, role, must_change, created_at) VALUES (?, ?, ?, 1, ?)', user, sec.hashPassword(pass), role, Date.now());
  }
  const f = path.join(env.DATA_DIR, 'ADMIN_' + user + '_PASSWORD.txt');
  fs.writeFileSync(f, ['Tài khoản quản trị' + (ex ? ' (cấp lại mật khẩu)' : ' mới'), 'Username: ' + user, 'Password: ' + pass, 'Vai trò: ' + role,
    'Trang quản trị: /' + env.ADMIN_PATH + '/', '', 'Đăng nhập, đổi mật khẩu ngay rồi XOÁ file này.', ''].join('\n'), { mode: 0o600 });
  db.run('INSERT INTO audit_log (admin_name, action, target, ip, created_at) VALUES (?, ?, ?, ?, ?)', 'env', ex ? 'admin_reset_password' : 'admin_create', user, 'server', Date.now());
  db.metaSet(mark, String(Date.now()));
  console.log('[admin] ' + (ex ? 'Đã cấp lại mật khẩu' : 'Đã tạo tài khoản') + ' "' + user + '". Mật khẩu tạm lưu tại: ' + f);
}

// ------------------------------------------------------------ xác thực
function ipAllowed(ip) {
  if (!env.ADMIN_IP_ALLOWLIST.length) return true;
  return env.ADMIN_IP_ALLOWLIST.some((rule) => {
    if (rule.endsWith('*')) return ip.startsWith(rule.slice(0, -1));
    return ip === rule;
  });
}

function sessionFrom(req) {
  const tok = parseCookies(req)[COOKIE];
  if (!tok || tok.length > 100) return null;
  const row = db.get('SELECT * FROM admin_sessions WHERE token_hash = ?', sec.sha256(tok));
  if (!row || row.expires_at < Date.now()) return null;
  const admin = db.get('SELECT * FROM admins WHERE id = ?', row.admin_id);
  if (!admin || admin.disabled) return null;
  if (!row.last_seen_at || row.last_seen_at < Date.now() - 60000) db.run('UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?', Date.now(), row.token_hash);
  return { session: row, admin };
}

function requireAdmin(req, minRole, opts) {
  opts = opts || {};
  if (!ipAllowed(clientIp(req))) throw new HttpError(403, 'ip_denied', 'IP của bạn không được phép truy cập trang quản trị');
  const ctx = sessionFrom(req);
  if (!ctx) throw new HttpError(401, 'unauthorized', 'Vui lòng đăng nhập');
  if (ROLES[ctx.admin.role] < ROLES[minRole || 'viewer']) throw new HttpError(403, 'forbidden', 'Tài khoản của bạn không có quyền thực hiện thao tác này');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const csrf = String(req.headers['x-csrf-token'] || '');
    if (!sec.safeEqual(csrf, ctx.session.csrf)) throw new HttpError(403, 'csrf', 'Phiên làm việc không hợp lệ, vui lòng tải lại trang');
    const origin = req.headers.origin;
    if (origin && env.PUBLIC_URL && origin !== env.PUBLIC_URL) throw new HttpError(403, 'origin', 'Nguồn yêu cầu không hợp lệ');
  }
  if (ctx.admin.must_change && !opts.allowMustChange) throw new HttpError(403, 'must_change_password', 'Bạn cần đổi mật khẩu trước khi tiếp tục');
  req.admin = ctx.admin;
  req.adminSession = ctx.session;
  return ctx.admin;
}

function audit(req, action, target, detail) {
  db.run('INSERT INTO audit_log (admin_id, admin_name, action, target, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    req.admin ? req.admin.id : null, req.admin ? req.admin.username : (detail && detail.username) || null, action,
    target === undefined || target === null ? null : String(target).slice(0, 200),
    detail ? JSON.stringify(detail).slice(0, 4000) : null, clientIp(req), Date.now());
}

function publicAdmin(a, session) {
  return { id: a.id, username: a.username, role: a.role, roleLabel: ROLE_LABEL[a.role], mustChange: !!a.must_change, csrf: session ? session.csrf : undefined };
}

async function login(req, res) {
  const ip = clientIp(req);
  if (!ipAllowed(ip)) throw new HttpError(403, 'ip_denied', 'IP của bạn không được phép truy cập trang quản trị');
  const rl = sec.rateLimit('adminlogin:' + ip, 10, 15 * 60000);
  if (!rl.ok) throw new HttpError(429, 'rate_limited', 'Đăng nhập sai quá nhiều lần, thử lại sau ' + Math.ceil(rl.retryAfter / 60) + ' phút');
  const body = await readJson(req, 8 * 1024);
  const username = String(body.username || '').trim().slice(0, 64);
  const password = String(body.password || '').slice(0, 200);
  const a = db.get('SELECT * FROM admins WHERE username = ?', username);
  const now = Date.now();
  const fail = (msg) => {
    db.run('INSERT INTO audit_log (admin_name, action, ip, created_at) VALUES (?, ?, ?, ?)', username, 'login_failed', ip, now);
    throw new HttpError(401, 'bad_credentials', msg || 'Sai tên đăng nhập hoặc mật khẩu');
  };
  if (!a) { sec.burnPasswordCheck(password); fail(); }
  if (a.disabled) { sec.burnPasswordCheck(password); fail(); }
  if (a.locked_until && a.locked_until > now) fail('Tài khoản tạm khoá do đăng nhập sai nhiều lần. Thử lại sau ' + Math.ceil((a.locked_until - now) / 60000) + ' phút');
  if (!sec.verifyPassword(password, a.pass_hash)) {
    const fc = a.failed_count + 1;
    db.run('UPDATE admins SET failed_count = ?, locked_until = ? WHERE id = ?', fc >= 5 ? 0 : fc, fc >= 5 ? now + 15 * 60000 : null, a.id);
    fail();
  }
  db.run('UPDATE admins SET failed_count = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', now, a.id);
  const token = sec.randomToken(32);
  const csrf = sec.randomToken(24);
  const exp = now + env.ADMIN_SESSION_TTL_H * 3600 * 1000;
  db.run('INSERT INTO admin_sessions (token_hash, admin_id, csrf, created_at, expires_at, last_seen_at, ip, ua) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    sec.sha256(token), a.id, csrf, now, exp, now, ip, String(req.headers['user-agent'] || '').slice(0, 200));
  setCookie(res, COOKIE, token, { maxAge: env.ADMIN_SESSION_TTL_H * 3600, secure: env.COOKIE_SECURE || isHttps(req), sameSite: 'Strict', path: COOKIE_PATH });
  req.admin = a;
  audit(req, 'login');
  json(res, 200, { admin: publicAdmin(a, { csrf }) });
}

function logout(req, res) {
  const tok = parseCookies(req)[COOKIE];
  if (tok) db.run('DELETE FROM admin_sessions WHERE token_hash = ?', sec.sha256(tok));
  setCookie(res, COOKIE, '', { maxAge: 0, secure: env.COOKIE_SECURE || isHttps(req), sameSite: 'Strict', path: COOKIE_PATH });
  json(res, 200, { ok: true });
}

// ------------------------------------------------------------ helpers
function rangeFrom(query) {
  const s = settings.current();
  const parse = (v, endOfDay) => {
    if (!v) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return endOfDay ? util.vnDayEnd(v) : util.vnDayStart(v);
    const n = Date.parse(v);
    return Number.isFinite(n) ? n : null;
  };
  let from = parse(query.get('from'), false);
  let to = parse(query.get('to'), true);
  if (from === null) from = query.get('all') === '1' ? 0 : Date.parse(s.campaign.start);
  if (to === null) to = query.get('all') === '1' ? 8640000000000000 : Date.parse(s.campaign.end);
  return { from, to, test: query.get('test') === '1' };
}

function pageArgs(query, sortable, defSort) {
  const page = Math.max(1, util.toInt(query.get('page'), 1));
  const size = Math.min(200, Math.max(10, util.toInt(query.get('size'), 50)));
  let sort = query.get('sort');
  if (!sortable[sort]) sort = defSort;
  const dir = query.get('dir') === 'asc' ? 'ASC' : 'DESC';
  return { page, size, offset: (page - 1) * size, orderBy: sortable[sort] + ' ' + dir + ', id ' + dir, sort, dir };
}

function canSeeCodes(admin) { return ROLES[admin.role] >= ROLES.manager; }

// ------------------------------------------------------------ người chơi
const PLAYER_SORT = {
  ext_id: 'ext_id', first_play_at: 'first_play_at', last_play_at: 'last_play_at', total_sessions: 'total_sessions',
  best_score: 'best_score', avg_score: '(CASE WHEN done_sessions > 0 THEN sum_score * 1.0 / done_sessions ELSE 0 END)',
  best_combo: 'best_combo', coupons: 'coupon_count', clicks: 'click_count', flagged: 'flagged_sessions'
};

function listPlayers(query) {
  const a = pageArgs(query, PLAYER_SORT, 'last_play_at');
  const where = ['total_sessions > 0'];
  const params = [];
  const q = (query.get('q') || '').trim();
  if (q) { where.push('ext_id LIKE ?'); params.push('%' + q.replace(/[%_]/g, '') + '%'); }
  if (query.get('test') !== '1') where.push('is_test = 0');
  const f = query.get('filter');
  if (f === 'coupon') where.push('coupon_count > 0');
  else if (f === 'nocoupon') where.push('coupon_count = 0');
  else if (f === 'flagged') where.push('flagged_sessions > 0');
  else if (f === 'banned') where.push('banned = 1');
  else if (f === 'redeemed') where.push('redeemed_count > 0');
  else if (f === 'returning') where.push('(SELECT COUNT(DISTINCT day) FROM sessions s WHERE s.player_id = v.id) >= 2');
  const minScore = util.toInt(query.get('minScore'), 0);
  if (minScore > 0) { where.push('best_score >= ?'); params.push(minScore); }
  const base = `FROM (SELECT p.*,
      (SELECT COUNT(*) FROM coupons c WHERE c.player_id = p.id AND c.status != 'revoked') coupon_count,
      (SELECT COUNT(*) FROM coupons c WHERE c.player_id = p.id AND c.status = 'redeemed') redeemed_count,
      (SELECT COUNT(*) FROM events e WHERE e.player_id = p.id AND e.type = 'register_click') click_count
    FROM players p) v WHERE ` + where.join(' AND ');
  const total = db.get('SELECT COUNT(*) n ' + base, ...params).n;
  const rows = db.all('SELECT * ' + base + ' ORDER BY ' + a.orderBy + ' LIMIT ? OFFSET ?', ...params, a.size, a.offset);
  const ids = rows.map((r) => r.id);
  const couponMap = {}, clickMap = {};
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    for (const c of db.all(`SELECT player_id, tier_id, status FROM coupons WHERE status != 'revoked' AND player_id IN (${ph})`, ...ids)) {
      (couponMap[c.player_id] = couponMap[c.player_id] || []).push({ tier: c.tier_id, status: c.status });
    }
    for (const e of db.all(`SELECT player_id, tier_id, COUNT(*) n FROM events WHERE type = 'register_click' AND player_id IN (${ph}) GROUP BY player_id, tier_id`, ...ids)) {
      (clickMap[e.player_id] = clickMap[e.player_id] || []).push({ tier: e.tier_id, n: e.n });
    }
  }
  return {
    total, page: a.page, size: a.size, sort: a.sort, dir: a.dir.toLowerCase(),
    rows: rows.map((r) => ({
      id: r.id, extId: r.ext_id, test: !!r.is_test, firstPlayAt: r.first_play_at, lastPlayAt: r.last_play_at,
      sessions: r.total_sessions, done: r.done_sessions, bestScore: r.best_score,
      avgScore: r.done_sessions ? Math.round(r.sum_score / r.done_sessions) : 0, bestCombo: r.best_combo,
      coupons: couponMap[r.id] || [], clicks: clickMap[r.id] || [], redeemed: r.redeemed_count,
      flagged: r.flagged_sessions, banned: !!r.banned, device: r.device_last
    }))
  };
}

function playerDetail(id, admin) {
  const p = players.getById(id);
  if (!p) throw new HttpError(404, 'not_found', 'Không tìm thấy người chơi');
  const s = settings.current();
  const st = players.turnState(p, s);
  const sessions = db.all('SELECT id, status, end_reason, started_at, ended_at, game_ms, score, max_combo, kills, taps, bombs_hit, level, tier_id, award_status, suspicious, flags_json, device, os, browser, is_test FROM sessions WHERE player_id = ? ORDER BY started_at DESC LIMIT 200', id);
  const cps = db.all('SELECT * FROM coupons WHERE player_id = ? ORDER BY created_at DESC', id).map((c) => couponRow(c, admin));
  const clicks = db.all("SELECT tier_id, source, created_at FROM events WHERE player_id = ? AND type = 'register_click' ORDER BY created_at DESC LIMIT 100", id);
  const days = db.get('SELECT COUNT(DISTINCT day) n FROM sessions WHERE player_id = ?', id).n;
  return {
    player: {
      id: p.id, extId: p.ext_id, test: !!p.is_test, createdAt: p.created_at, firstPlayAt: p.first_play_at, lastPlayAt: p.last_play_at,
      sessions: p.total_sessions, done: p.done_sessions, bestScore: p.best_score, bestCombo: p.best_combo,
      avgScore: p.done_sessions ? Math.round(p.sum_score / p.done_sessions) : 0, bombDeaths: p.bomb_deaths,
      flagged: p.flagged_sessions, banned: !!p.banned, banReason: p.ban_reason, lockedUntil: p.locked_until > Date.now() ? p.locked_until : 0, device: p.device_last, activeDays: days,
      turns: players.publicTurns(st)
    },
    sessions: sessions.map((x) => Object.assign(x, { flags: x.flags_json ? JSON.parse(x.flags_json).flags : [], flags_json: undefined })),
    coupons: cps,
    clicks
  };
}

// ------------------------------------------------------------ lượt chơi
const SESSION_SORT = { started_at: 's.started_at', score: 's.score', max_combo: 's.max_combo', game_ms: 's.game_ms', taps: 's.taps' };
function listSessions(query) {
  const a = pageArgs(query, SESSION_SORT, 'started_at');
  a.orderBy = a.orderBy.replace(', id ', ', s.rowid ');
  const where = [];
  const params = [];
  const r = rangeFrom(query);
  where.push('s.started_at BETWEEN ? AND ?'); params.push(r.from, r.to);
  if (!r.test) where.push('s.is_test = 0');
  const q = (query.get('q') || '').trim();
  if (q) { where.push('(p.ext_id LIKE ? OR s.id = ?)'); params.push('%' + q.replace(/[%_]/g, '') + '%', q); }
  const reason = query.get('reason');
  if (reason && /^[a-z]+$/.test(reason)) { where.push('s.end_reason = ?'); params.push(reason); }
  const status = query.get('status');
  if (status === 'active') where.push("s.status = 'active'");
  if (query.get('flagged') === '1') where.push('s.suspicious = 1');
  const tier = query.get('tier');
  if (tier) { where.push('s.tier_id = ?'); params.push(tier); }
  const base = 'FROM sessions s JOIN players p ON p.id = s.player_id WHERE ' + where.join(' AND ');
  const total = db.get('SELECT COUNT(*) n ' + base, ...params).n;
  const rows = db.all(`SELECT s.id, s.player_id, p.ext_id, s.status, s.end_reason, s.started_at, s.ended_at, s.game_ms, s.score, s.max_combo,
      s.kills, s.taps, s.bombs_hit, s.level, s.tier_id, s.award_status, s.suspicious, s.flags_json, s.device, s.os, s.browser, s.is_test
    ${base} ORDER BY ${a.orderBy} LIMIT ? OFFSET ?`, ...params, a.size, a.offset);
  return {
    total, page: a.page, size: a.size, sort: a.sort, dir: a.dir.toLowerCase(),
    rows: rows.map((x) => Object.assign(x, { flags: x.flags_json ? JSON.parse(x.flags_json).flags : [], flags_json: undefined }))
  };
}

function sessionDetail(id) {
  const row = db.get('SELECT s.*, p.ext_id FROM sessions s JOIN players p ON p.id = s.player_id WHERE s.id = ?', id);
  if (!row) throw new HttpError(404, 'not_found', 'Không tìm thấy lượt chơi');
  const syncs = game.parseSync(row.sync_txt);
  return {
    session: {
      id: row.id, playerId: row.player_id, extId: row.ext_id, status: row.status, endReason: row.end_reason, test: !!row.is_test,
      startedAt: row.started_at, endedAt: row.ended_at, gameMs: row.game_ms, score: row.score, maxCombo: row.max_combo,
      kills: row.kills, hits: row.hits, taps: row.taps, bombsHit: row.bombs_hit, level: row.level, tierId: row.tier_id,
      awardStatus: row.award_status, couponId: row.coupon_id, suspicious: !!row.suspicious, settingsVersion: row.settings_ver,
      device: row.device, os: row.os, browser: row.browser, ip: row.ip, events: row.ev_count, syncs: syncs.length
    },
    summary: row.summary_json ? JSON.parse(row.summary_json) : null,
    analysis: row.flags_json ? JSON.parse(row.flags_json) : null,
    timeline: syncs.slice(0, 400)
  };
}

// ------------------------------------------------------------ coupon
function couponRow(c, admin) {
  const code = coupons.decryptSafe(c.code_enc);
  return {
    id: c.id, playerId: c.player_id, sessionId: c.session_id, tierId: c.tier_id, label: c.label, product: c.product, discount: c.discount,
    status: c.status, displayStatus: coupons.couponStatus(c), provider: c.provider, test: !!c.is_test,
    code: code ? coupons.maskCode(code) : null,
    hasCode: !!code,
    createdAt: c.created_at, expiresAt: c.expires_at, revealedAt: c.revealed_at, copiedAt: c.copied_at,
    redeemedAt: c.redeemed_at, redeemRef: c.redeem_ref, revokedAt: c.revoked_at, revokeReason: c.revoke_reason, error: c.error
  };
}

const COUPON_SORT = { created_at: 'c.created_at', tier_id: 'c.tier_id', status: 'c.status', redeemed_at: 'c.redeemed_at' };
function listCoupons(query, admin) {
  const a = pageArgs(query, COUPON_SORT, 'created_at');
  a.orderBy = a.orderBy.replace(', id ', ', c.id ');
  const where = [];
  const params = [];
  const r = rangeFrom(query);
  where.push('c.created_at BETWEEN ? AND ?'); params.push(r.from, r.to);
  if (!r.test) where.push('c.is_test = 0');
  const tier = query.get('tier');
  if (tier) { where.push('c.tier_id = ?'); params.push(tier); }
  const st = query.get('status');
  if (st && ['pending', 'issued', 'held', 'redeemed', 'revoked'].includes(st)) { where.push('c.status = ?'); params.push(st); }
  const q = (query.get('q') || '').trim();
  if (q) {
    where.push('(p.ext_id LIKE ? OR c.code_hash = ?)');
    params.push('%' + q.replace(/[%_]/g, '') + '%', sec.codeHash(q));
  }
  const base = 'FROM coupons c JOIN players p ON p.id = c.player_id WHERE ' + where.join(' AND ');
  const total = db.get('SELECT COUNT(*) n ' + base, ...params).n;
  const rows = db.all('SELECT c.*, p.ext_id ' + base + ' ORDER BY ' + a.orderBy + ' LIMIT ? OFFSET ?', ...params, a.size, a.offset);
  return { total, page: a.page, size: a.size, sort: a.sort, dir: a.dir.toLowerCase(), rows: rows.map((c) => Object.assign(couponRow(c, admin), { extId: c.ext_id })) };
}

// ------------------------------------------------------------ xuất CSV
function exportCsv(kind, query, admin) {
  const r = rangeFrom(query);
  const T = r.test ? 1 : 0;
  if (kind === 'players') {
    const rows = db.all(`SELECT p.*, (SELECT GROUP_CONCAT(tier_id, ' ') FROM coupons c WHERE c.player_id = p.id AND c.status != 'revoked') cps,
        (SELECT COUNT(*) FROM coupons c WHERE c.player_id = p.id AND c.status = 'redeemed') red,
        (SELECT GROUP_CONCAT(tier_id || ':' || n, ' ') FROM (SELECT tier_id, COUNT(*) n FROM events e WHERE e.player_id = p.id AND e.type = 'register_click' GROUP BY tier_id)) clk
      FROM players p WHERE total_sessions > 0 AND (is_test = 0 OR ? = 1) ORDER BY last_play_at DESC`, T);
    return util.toCsv([
      { label: 'ID người chơi', key: 'ext_id' }, { label: 'Lần đầu chơi', get: (x) => util.fmtVN(x.first_play_at) },
      { label: 'Lần chơi gần nhất', get: (x) => util.fmtVN(x.last_play_at) }, { label: 'Tổng số lượt', key: 'total_sessions' },
      { label: 'Điểm cao nhất', key: 'best_score' }, { label: 'Điểm trung bình', get: (x) => x.done_sessions ? Math.round(x.sum_score / x.done_sessions) : 0 },
      { label: 'Combo cao nhất', key: 'best_combo' }, { label: 'Voucher đã nhận', key: 'cps' }, { label: 'Sản phẩm đã click', key: 'clk' },
      { label: 'Coupon đã dùng (conversion)', key: 'red' }, { label: 'Lượt bị nghi ngờ', key: 'flagged_sessions' },
      { label: 'Bị khoá', get: (x) => x.banned ? 'Có' : '' }, { label: 'Thiết bị gần nhất', key: 'device_last' }, { label: 'Test', get: (x) => x.is_test ? 'Có' : '' }
    ], rows);
  }
  if (kind === 'sessions') {
    const rows = db.all(`SELECT s.*, p.ext_id FROM sessions s JOIN players p ON p.id = s.player_id
      WHERE s.started_at BETWEEN ? AND ? AND (s.is_test = 0 OR ? = 1) ORDER BY s.started_at DESC`, r.from, r.to, T);
    return util.toCsv([
      { label: 'Mã lượt', key: 'id' }, { label: 'ID người chơi', key: 'ext_id' }, { label: 'Bắt đầu', get: (x) => util.fmtVN(x.started_at) },
      { label: 'Kết thúc', get: (x) => util.fmtVN(x.ended_at) }, { label: 'Thời lượng (giây)', get: (x) => Math.round(x.game_ms / 1000) },
      { label: 'Điểm', key: 'score' }, { label: 'Combo cao nhất', key: 'max_combo' }, { label: 'Level', key: 'level' },
      { label: 'Số lần đập', key: 'taps' }, { label: 'Hạ gục', key: 'kills' }, { label: 'Trúng bom', key: 'bombs_hit' },
      { label: 'Lý do kết thúc', get: (x) => game.REASON_TEXT[x.end_reason] || x.status }, { label: 'Mốc đạt', key: 'tier_id' },
      { label: 'Kết quả voucher', key: 'award_status' }, { label: 'Nghi ngờ', get: (x) => x.suspicious ? 'Có' : '' },
      { label: 'Thiết bị', key: 'device' }, { label: 'HĐH', key: 'os' }, { label: 'Trình duyệt', key: 'browser' }, { label: 'Test', get: (x) => x.is_test ? 'Có' : '' }
    ], rows);
  }
  if (kind === 'coupons') {
    const rows = db.all(`SELECT c.*, p.ext_id FROM coupons c JOIN players p ON p.id = c.player_id
      WHERE c.created_at BETWEEN ? AND ? AND (c.is_test = 0 OR ? = 1) ORDER BY c.created_at DESC`, r.from, r.to, T);
    return util.toCsv([
      { label: 'ID coupon', key: 'id' }, { label: 'ID người chơi', key: 'ext_id' }, { label: 'Mốc', key: 'tier_id' }, { label: 'Voucher', key: 'label' },
      { label: 'Mã', get: (x) => { const c = coupons.decryptSafe(x.code_enc); return c ? (canSeeCodes(admin) ? c : coupons.maskCode(c)) : ''; } },
      { label: 'Trạng thái', key: 'status' }, { label: 'Ngày cấp', get: (x) => util.fmtVN(x.created_at) }, { label: 'Hạn dùng', get: (x) => util.fmtVN(x.expires_at) },
      { label: 'Đã xem mã', get: (x) => util.fmtVN(x.revealed_at) }, { label: 'Đã copy', get: (x) => util.fmtVN(x.copied_at) },
      { label: 'Đã dùng', get: (x) => util.fmtVN(x.redeemed_at) }, { label: 'Mã đơn hàng', key: 'redeem_ref' }, { label: 'Test', get: (x) => x.is_test ? 'Có' : '' }
    ], rows);
  }
  if (kind === 'clicks') {
    const rows = db.all(`SELECT e.*, p.ext_id FROM events e JOIN players p ON p.id = e.player_id
      WHERE e.type = 'register_click' AND e.created_at BETWEEN ? AND ? AND (e.is_test = 0 OR ? = 1) ORDER BY e.created_at DESC`, r.from, r.to, T);
    return util.toCsv([
      { label: 'Thời gian', get: (x) => util.fmtVN(x.created_at) }, { label: 'ID người chơi', key: 'ext_id' }, { label: 'Mốc / sản phẩm', key: 'tier_id' },
      { label: 'Nguồn', key: 'source' }, { label: 'Thiết bị', key: 'device' }
    ], rows);
  }
  throw new HttpError(404, 'not_found', 'Loại dữ liệu không hỗ trợ');
}

// ------------------------------------------------------------ định tuyến
function routes(router) {
  const R = (method, p, role, fn, opts) => router.add(method, p, async (req, res, params, query) => {
    requireAdmin(req, role, opts);
    const out = await fn(req, res, params, query);
    if (out !== undefined && !res.headersSent) json(res, 200, out);
  });

  router.post('/api/admin/login', login);
  router.post('/api/admin/logout', logout);
  R('GET', '/api/admin/me', 'viewer', (req) => ({ admin: publicAdmin(req.admin, req.adminSession), env: { prod: env.isProd, demoLogin: env.ALLOW_DEMO_LOGIN && env.isProd } }), { allowMustChange: true });
  R('POST', '/api/admin/password', 'viewer', async (req) => {
    const b = await readJson(req, 8 * 1024);
    const a = db.get('SELECT * FROM admins WHERE id = ?', req.admin.id);
    if (!sec.verifyPassword(String(b.current || ''), a.pass_hash)) throw new HttpError(400, 'bad_password', 'Mật khẩu hiện tại không đúng');
    const probs = sec.passwordProblems(b.next, a.username);
    if (probs.length) throw new HttpError(400, 'weak_password', probs.join(' '));
    db.run('UPDATE admins SET pass_hash = ?, must_change = 0 WHERE id = ?', sec.hashPassword(b.next), a.id);
    db.run('DELETE FROM admin_sessions WHERE admin_id = ? AND token_hash != ?', a.id, req.adminSession.token_hash);
    audit(req, 'password_change', a.username);
    return { ok: true };
  }, { allowMustChange: true });

  R('GET', '/api/admin/stream', 'viewer', (req, res) => { realtime.subscribe(req, res); });
  R('GET', '/api/admin/stats', 'viewer', (req, res, p, query) => stats.overview(rangeFrom(query)));
  R('GET', '/api/admin/overview-meta', 'viewer', () => {
    const s = settings.current();
    return { campaign: s.campaign, status: settings.campaignStatus(s), tiers: s.tiers, coupons: s.coupons, version: settings.version(), live: game.liveCount(), pool: coupons.poolStats() };
  });

  // Người chơi
  R('GET', '/api/admin/players', 'viewer', (req, res, p, query) => listPlayers(query));
  R('GET', '/api/admin/players/:id', 'viewer', (req, res, p) => playerDetail(util.toInt(p.id, 0), req.admin));
  R('POST', '/api/admin/players/:id/ban', 'manager', async (req, res, p) => {
    const b = await readJson(req);
    const id = util.toInt(p.id, 0);
    const reason = String(b.reason || '').slice(0, 200);
    db.run('UPDATE players SET banned = ?, ban_reason = ?, locked_until = 0 WHERE id = ?', b.banned ? 1 : 0, b.banned ? reason : null, id);
    if (b.banned) db.run('DELETE FROM auth_tokens WHERE player_id = ?', id);
    audit(req, b.banned ? 'player_ban' : 'player_unban', id, { reason });
    return { ok: true };
  });
  R('POST', '/api/admin/players/:id/turns', 'manager', async (req, res, p) => {
    const b = await readJson(req);
    const id = util.toInt(p.id, 0);
    const pl = players.getById(id);
    if (!pl) throw new HttpError(404, 'not_found', 'Không tìm thấy người chơi');
    if (b.action === 'refill') db.run('UPDATE players SET turns = ?, turns_at = ? WHERE id = ?', settings.current().turns.max, Date.now(), id);
    else if (b.action === 'bonus') db.run('UPDATE players SET bonus_turns = MIN(100, MAX(0, bonus_turns + ?)) WHERE id = ?', util.toInt(b.amount, 0), id);
    else throw new HttpError(400, 'bad_action', 'Thao tác không hợp lệ');
    audit(req, 'player_turns', id, { action: b.action, amount: b.amount });
    return { ok: true };
  });

  // Lượt chơi
  R('GET', '/api/admin/sessions', 'viewer', (req, res, p, query) => listSessions(query));
  R('GET', '/api/admin/sessions/:id', 'viewer', (req, res, p) => sessionDetail(p.id));

  // Coupon
  R('GET', '/api/admin/coupons', 'viewer', (req, res, p, query) => listCoupons(query, req.admin));
  R('POST', '/api/admin/coupons/:id/action', 'manager', async (req, res, p) => {
    const b = await readJson(req);
    const c = db.get('SELECT * FROM coupons WHERE id = ?', util.toInt(p.id, 0));
    if (!c) throw new HttpError(404, 'not_found', 'Không tìm thấy coupon');
    const now = Date.now();
    if (b.action === 'revoke') {
      if (c.status === 'redeemed') throw new HttpError(400, 'redeemed', 'Coupon đã được sử dụng, không thể thu hồi');
      db.run("UPDATE coupons SET status = 'revoked', revoked_at = ?, revoke_reason = ? WHERE id = ?", now, String(b.reason || '').slice(0, 200), c.id);
      db.run("UPDATE sessions SET award_status = 'revoked' WHERE id = ?", c.session_id);
    } else if (b.action === 'approve') {
      if (c.status !== 'held') throw new HttpError(400, 'not_held', 'Coupon không ở trạng thái chờ duyệt');
      db.run("UPDATE coupons SET status = 'pending' WHERE id = ?", c.id);
      db.run("UPDATE sessions SET award_status = 'issued' WHERE id = ?", c.session_id);
      await coupons.fulfill(c.id);
    } else if (b.action === 'redeem') {
      if (!['issued'].includes(c.status)) throw new HttpError(400, 'bad_status', 'Chỉ đánh dấu được coupon đang hiệu lực');
      coupons.markRedeemed(c, String(b.ref || 'admin').slice(0, 100), now);
    } else if (b.action === 'retry') {
      await coupons.fulfill(c.id, { force: true });
    } else throw new HttpError(400, 'bad_action', 'Thao tác không hợp lệ');
    audit(req, 'coupon_' + b.action, c.id, { reason: b.reason, ref: b.ref });
    realtime.tick();
    return { ok: true, coupon: couponRow(db.get('SELECT * FROM coupons WHERE id = ?', c.id), req.admin) };
  });
  R('POST', '/api/admin/coupons/:id/code', 'manager', (req, res, p) => {
    const c = db.get('SELECT id, code_enc FROM coupons WHERE id = ?', util.toInt(p.id, 0));
    if (!c || !c.code_enc) throw new HttpError(404, 'not_found', 'Không có mã');
    audit(req, 'coupon_view_code', c.id);
    return { code: coupons.decryptSafe(c.code_enc) };
  });
  R('POST', '/api/admin/coupons/redeem-bulk', 'manager', async (req) => {
    const b = await readJson(req, 1024 * 1024);
    const codes = String(b.codes || '').split(/[\s,;]+/).filter(Boolean).slice(0, 20000);
    let ok = 0, notFound = 0, skipped = 0;
    db.tx(() => {
      for (const code of codes) {
        const c = coupons.findByCode(code);
        if (!c) { notFound++; continue; }
        if (c.status !== 'issued') { skipped++; continue; }
        coupons.markRedeemed(c, String(b.ref || 'import').slice(0, 100));
        ok++;
      }
    });
    audit(req, 'coupon_redeem_bulk', null, { total: codes.length, ok, notFound, skipped });
    return { ok, notFound, skipped };
  });
  R('GET', '/api/admin/pool', 'viewer', () => ({ pool: coupons.poolStats() }));
  R('POST', '/api/admin/pool/import', 'manager', async (req) => {
    const b = await readJson(req, 2 * 1024 * 1024);
    const s = settings.current();
    if (!s.tiers.some((t) => t.id === b.tierId && t.reward)) throw new HttpError(400, 'bad_tier', 'Mốc voucher không hợp lệ');
    const codes = String(b.codes || '').split(/[\s,;]+/).filter(Boolean).slice(0, 50000);
    const r = coupons.importPool(b.tierId, codes);
    audit(req, 'pool_import', b.tierId, r);
    return r;
  });

  // Cấu hình
  R('GET', '/api/admin/settings', 'viewer', () => ({
    version: settings.version(), settings: settings.current(), presets: settings.DIFFICULTY_PRESETS,
    history: settings.history(30), status: settings.campaignStatus(), env: { couponApi: !!(env.COUPON_API_URL && env.COUPON_API_KEY) }
  }));
  R('PUT', '/api/admin/settings', 'manager', async (req) => {
    const b = await readJson(req, 256 * 1024);
    const before = settings.current();
    const r = settings.save(b.settings, req.admin.username, b.note);
    if (!r.ok) throw new HttpError(400, 'invalid_settings', r.errors.join(' '), { errors: r.errors });
    audit(req, 'settings_save', 'v' + r.version, { note: b.note, changes: diff(before, r.settings) });
    realtime.activity({ type: 'settings', text: req.admin.username + ' đã lưu cấu hình phiên bản v' + r.version });
    return { ok: true, version: r.version, settings: r.settings };
  });
  R('GET', '/api/admin/settings/version/:v', 'viewer', (req, res, p) => {
    const v = settings.getVersion(util.toInt(p.v, 0));
    if (!v) throw new HttpError(404, 'not_found', 'Không tìm thấy phiên bản');
    return v;
  });
  R('POST', '/api/admin/settings/restore/:v', 'manager', (req, res, p) => {
    const v = settings.getVersion(util.toInt(p.v, 0));
    if (!v) throw new HttpError(404, 'not_found', 'Không tìm thấy phiên bản');
    const r = settings.save(v.settings, req.admin.username, 'Khôi phục từ v' + v.version);
    if (!r.ok) throw new HttpError(400, 'invalid_settings', r.errors.join(' '));
    audit(req, 'settings_restore', 'v' + v.version, { newVersion: r.version });
    return { ok: true, version: r.version, settings: r.settings };
  });
  R('POST', '/api/admin/test-token', 'manager', (req) => {
    const t = players.issueTestToken(req.admin.username, req);
    audit(req, 'test_play', t.player.ext_id);
    return { url: '/#access=' + encodeURIComponent(t.token.token), player: t.player.ext_id };
  });
  R('POST', '/api/admin/simulate', 'viewer', async (req) => {
    const b = await readJson(req, 256 * 1024);
    const { settings: s } = settings.sanitize(b.settings || settings.current());
    const cfg = settings.gameConfig(s);
    const games = Math.min(600, Math.max(50, util.toInt(b.games, 300)));
    const thresholds = s.tiers.filter((t) => t.enabled).map((t) => t.score);
    const out = {};
    for (const k of Object.keys(Engine.PROFILES)) out[k] = Engine.simulate(cfg, Engine.PROFILES[k], games, { thresholds, seed: 20261026 });
    for (const k of Object.keys(out)) delete out[k].scores;
    return { thresholds, profiles: Engine.PROFILES, results: out };
  });

  // Nhật ký
  R('GET', '/api/admin/audit', 'viewer', (req, res, p, query) => {
    const page = Math.max(1, util.toInt(query.get('page'), 1));
    const total = db.get('SELECT COUNT(*) n FROM audit_log').n;
    const rows = db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100 OFFSET ?', (page - 1) * 100);
    return { total, page, rows };
  });

  // Tài khoản quản trị
  R('GET', '/api/admin/admins', 'superadmin', () => ({
    rows: db.all('SELECT id, username, role, disabled, must_change, created_at, last_login_at, locked_until FROM admins ORDER BY id'),
    roles: ROLE_LABEL
  }));
  R('POST', '/api/admin/admins', 'superadmin', async (req) => {
    const b = await readJson(req);
    const username = String(b.username || '').trim();
    if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username)) throw new HttpError(400, 'bad_username', 'Tên đăng nhập 3–32 ký tự (chữ, số, . _ -)');
    if (!ROLES[b.role]) throw new HttpError(400, 'bad_role', 'Vai trò không hợp lệ');
    if (db.get('SELECT 1 FROM admins WHERE username = ?', username)) throw new HttpError(400, 'exists', 'Tên đăng nhập đã tồn tại');
    const pass = sec.randomToken(9) + 'Aa1';
    db.run('INSERT INTO admins (username, pass_hash, role, must_change, created_at) VALUES (?, ?, ?, 1, ?)', username, sec.hashPassword(pass), b.role, Date.now());
    audit(req, 'admin_create', username, { role: b.role });
    return { ok: true, username, tempPassword: pass };
  });
  R('POST', '/api/admin/admins/:id', 'superadmin', async (req, res, p) => {
    const b = await readJson(req);
    const id = util.toInt(p.id, 0);
    const a = db.get('SELECT * FROM admins WHERE id = ?', id);
    if (!a) throw new HttpError(404, 'not_found', 'Không tìm thấy tài khoản');
    if (b.action === 'role') {
      if (!ROLES[b.role]) throw new HttpError(400, 'bad_role', 'Vai trò không hợp lệ');
      if (a.id === req.admin.id) throw new HttpError(400, 'self', 'Không thể tự đổi vai trò của chính mình');
      db.run('UPDATE admins SET role = ? WHERE id = ?', b.role, id);
      db.run('DELETE FROM admin_sessions WHERE admin_id = ?', id);
    } else if (b.action === 'disable' || b.action === 'enable') {
      if (a.id === req.admin.id) throw new HttpError(400, 'self', 'Không thể tự khoá tài khoản của chính mình');
      db.run('UPDATE admins SET disabled = ? WHERE id = ?', b.action === 'disable' ? 1 : 0, id);
      if (b.action === 'disable') db.run('DELETE FROM admin_sessions WHERE admin_id = ?', id);
    } else if (b.action === 'reset') {
      const pass = sec.randomToken(9) + 'Aa1';
      db.run('UPDATE admins SET pass_hash = ?, must_change = 1, failed_count = 0, locked_until = NULL WHERE id = ?', sec.hashPassword(pass), id);
      db.run('DELETE FROM admin_sessions WHERE admin_id = ?', id);
      audit(req, 'admin_reset_password', a.username);
      return { ok: true, tempPassword: pass };
    } else throw new HttpError(400, 'bad_action', 'Thao tác không hợp lệ');
    audit(req, 'admin_' + b.action, a.username, { role: b.role });
    return { ok: true };
  });

  // Xuất dữ liệu & quản lý dữ liệu
  router.get('/api/admin/export/:kind', (req, res, p, query) => {
    requireAdmin(req, 'manager');
    const csv = exportCsv(p.kind, query, req.admin);
    audit(req, 'export', p.kind);
    send(res, 200, csv, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="hlw2026-' + p.kind + '-' + util.vnParts(Date.now()).day + '.csv"',
      'Cache-Control': 'no-store'
    });
  });
  R('POST', '/api/admin/data/purge-test', 'superadmin', async (req) => {
    const b = await readJson(req);
    if (b.confirm !== 'XOA TEST') throw new HttpError(400, 'confirm', 'Nhập chính xác "XOA TEST" để xác nhận');
    const r = db.tx(() => {
      const ids = db.all('SELECT id FROM players WHERE is_test = 1').map((x) => x.id);
      db.run('DELETE FROM sessions WHERE is_test = 1');
      db.run('DELETE FROM coupons WHERE is_test = 1');
      db.run('DELETE FROM events WHERE is_test = 1');
      for (const id of ids) db.run('DELETE FROM auth_tokens WHERE player_id = ?', id);
      db.run('DELETE FROM players WHERE is_test = 1');
      // Người chơi thật nhưng chơi trong lúc bật chế độ test: chỉ xoá lượt/coupon test, giữ tài khoản, tính lại chỉ số
      recomputePlayers();
      return { players: ids.length };
    });
    audit(req, 'data_purge_test', null, r);
    realtime.tick();
    return { ok: true, removedPlayers: r.players };
  });
  R('POST', '/api/admin/data/reset', 'superadmin', async (req) => {
    const b = await readJson(req);
    if (b.confirm !== 'XOA TOAN BO') throw new HttpError(400, 'confirm', 'Nhập chính xác "XOA TOAN BO" để xác nhận');
    db.tx(() => {
      for (const t of ['sessions', 'coupons', 'events', 'auth_tokens', 'players', 'used_jti']) db.run('DELETE FROM ' + t);
      db.run('UPDATE coupon_pool SET coupon_id = NULL, assigned_at = NULL');
    });
    audit(req, 'data_reset_all');
    realtime.tick();
    return { ok: true };
  });
  router.get('/api/admin/backup', (req, res) => {
    requireAdmin(req, 'superadmin');
    const file = path.join(env.DATA_DIR, 'backup-' + Date.now() + '.db');
    db.exec("VACUUM INTO '" + file.replace(/'/g, "''") + "'");
    audit(req, 'backup_download');
    const data = fs.readFileSync(file);
    fs.unlinkSync(file);
    send(res, 200, data, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="hlw2026-backup-' + util.vnParts(Date.now()).day + '.db"',
      'Cache-Control': 'no-store'
    });
  });
}

function recomputePlayers() {
  db.run(`UPDATE players SET
    total_sessions = (SELECT COUNT(*) FROM sessions s WHERE s.player_id = players.id),
    done_sessions = (SELECT COUNT(*) FROM sessions s WHERE s.player_id = players.id AND s.status IN ('finished','abandoned','invalid')),
    sum_score = COALESCE((SELECT SUM(score) FROM sessions s WHERE s.player_id = players.id AND s.status IN ('finished','abandoned','invalid')), 0),
    best_score = COALESCE((SELECT MAX(score) FROM sessions s WHERE s.player_id = players.id AND s.status IN ('finished','abandoned')), 0),
    best_combo = COALESCE((SELECT MAX(max_combo) FROM sessions s WHERE s.player_id = players.id AND s.status IN ('finished','abandoned')), 0),
    bomb_deaths = (SELECT COUNT(*) FROM sessions s WHERE s.player_id = players.id AND s.end_reason = 'bomb'),
    flagged_sessions = (SELECT COUNT(*) FROM sessions s WHERE s.player_id = players.id AND s.suspicious = 1),
    first_play_at = (SELECT MIN(started_at) FROM sessions s WHERE s.player_id = players.id),
    last_play_at = (SELECT MAX(started_at) FROM sessions s WHERE s.player_id = players.id)`);
}

// So sánh 2 bản cấu hình -> danh sách đường dẫn thay đổi (cho nhật ký)
function diff(a, b, prefix, out) {
  out = out || [];
  prefix = prefix || '';
  const keys = new Set(Object.keys(a || {}).concat(Object.keys(b || {})));
  for (const k of keys) {
    const va = a ? a[k] : undefined, vb = b ? b[k] : undefined;
    const p = prefix ? prefix + '.' + k : k;
    if (va && vb && typeof va === 'object' && typeof vb === 'object' && !Array.isArray(va)) diff(va, vb, p, out);
    else if (JSON.stringify(va) !== JSON.stringify(vb)) out.push({ path: p, from: va, to: vb });
    if (out.length > 60) break;
  }
  return out;
}

module.exports = { bootstrap, routes, requireAdmin };
