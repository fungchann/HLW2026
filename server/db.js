'use strict';
/*
 * SQLite tích hợp sẵn trong Node.js (node:sqlite) — không cần cài thêm thư viện.
 * Toàn bộ API là đồng bộ; vì Node chạy 1 luồng nên mỗi request xử lý trọn vẹn,
 * không bị chen ngang giữa "kiểm tra" và "ghi" (tránh race condition khi cấp coupon).
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

let conn = null;
const stmts = new Map();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  ext_id TEXT NOT NULL UNIQUE,
  is_test INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  first_play_at INTEGER,
  last_play_at INTEGER,
  turns INTEGER NOT NULL,
  turns_at INTEGER NOT NULL,
  bonus_turns INTEGER NOT NULL DEFAULT 0,
  total_sessions INTEGER NOT NULL DEFAULT 0,
  done_sessions INTEGER NOT NULL DEFAULT 0,
  sum_score INTEGER NOT NULL DEFAULT 0,
  best_score INTEGER NOT NULL DEFAULT 0,
  best_combo INTEGER NOT NULL DEFAULT 0,
  bomb_deaths INTEGER NOT NULL DEFAULT 0,
  flagged_sessions INTEGER NOT NULL DEFAULT 0,
  device_last TEXT,
  banned INTEGER NOT NULL DEFAULT 0,
  ban_reason TEXT
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  device TEXT,
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_player ON auth_tokens(player_id);
CREATE INDEX IF NOT EXISTS idx_auth_exp ON auth_tokens(expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  player_id INTEGER NOT NULL,
  is_test INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  end_reason TEXT,
  seed INTEGER NOT NULL,
  cfg_json TEXT NOT NULL,
  settings_ver INTEGER,
  engine_ver INTEGER,
  started_at INTEGER NOT NULL,
  last_sync_at INTEGER NOT NULL,
  ended_at INTEGER,
  game_ms INTEGER NOT NULL DEFAULT 0,
  ev_txt TEXT NOT NULL DEFAULT '',
  ev_count INTEGER NOT NULL DEFAULT 0,
  sync_txt TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  max_combo INTEGER NOT NULL DEFAULT 0,
  kills INTEGER NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 0,
  taps INTEGER NOT NULL DEFAULT 0,
  bombs_hit INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  tier_id TEXT,
  award_status TEXT,
  coupon_id INTEGER,
  summary_json TEXT,
  flags_json TEXT,
  suspicious INTEGER NOT NULL DEFAULT 0,
  device TEXT, os TEXT, browser TEXT, ip TEXT,
  day TEXT, hour INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sess_player ON sessions(player_id, started_at);
CREATE INDEX IF NOT EXISTS idx_sess_status ON sessions(status, last_sync_at);
CREATE INDEX IF NOT EXISTS idx_sess_started ON sessions(started_at);

CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL,
  session_id TEXT UNIQUE,
  tier_id TEXT NOT NULL,
  is_test INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  provider TEXT,
  code_enc TEXT,
  code_hash TEXT UNIQUE,
  label TEXT, product TEXT, discount INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revealed_at INTEGER,
  copied_at INTEGER,
  redeemed_at INTEGER,
  redeem_ref TEXT,
  revoked_at INTEGER,
  revoke_reason TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_coupon_player ON coupons(player_id, tier_id);
CREATE INDEX IF NOT EXISTS idx_coupon_created ON coupons(created_at);

CREATE TABLE IF NOT EXISTS coupon_pool (
  id INTEGER PRIMARY KEY,
  tier_id TEXT NOT NULL,
  code_enc TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  coupon_id INTEGER,
  added_at INTEGER NOT NULL,
  assigned_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pool_free ON coupon_pool(tier_id, coupon_id);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  player_id INTEGER,
  is_test INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL,
  tier_id TEXT,
  session_id TEXT,
  source TEXT,
  device TEXT,
  created_at INTEGER NOT NULL,
  day TEXT, hour INTEGER
);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, created_at);
CREATE INDEX IF NOT EXISTS idx_events_player ON events(player_id, type);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  must_change INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER,
  ip TEXT,
  ua TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  admin_id INTEGER,
  admin_name TEXT,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS settings_history (
  version INTEGER PRIMARY KEY,
  json TEXT NOT NULL,
  admin_name TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS used_jti (
  jti TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
`;

function open(file) {
  if (conn) return conn;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  conn = new DatabaseSync(file);
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  conn.exec(SCHEMA);
  // nâng cấp: cột tạm khoá chơi (gian lận liên tiếp)
  const cols = conn.prepare('PRAGMA table_info(players)').all().map((c) => c.name);
  if (!cols.includes('locked_until')) conn.exec('ALTER TABLE players ADD COLUMN locked_until INTEGER NOT NULL DEFAULT 0');
  return conn;
}

function stmt(sql) {
  let s = stmts.get(sql);
  if (!s) { s = conn.prepare(sql); stmts.set(sql, s); }
  return s;
}

function run(sql, ...params) { return stmt(sql).run(...params); }
function get(sql, ...params) { return stmt(sql).get(...params); }
function all(sql, ...params) { return stmt(sql).all(...params); }
function exec(sql) { return conn.exec(sql); }

// Chạy fn trong 1 transaction (đồng bộ). Lồng nhau thì dùng savepoint.
let depth = 0;
function tx(fn) {
  const sp = 'sp' + depth;
  conn.exec(depth === 0 ? 'BEGIN IMMEDIATE' : 'SAVEPOINT ' + sp);
  depth++;
  try {
    const r = fn();
    depth--;
    conn.exec(depth === 0 ? 'COMMIT' : 'RELEASE ' + sp);
    return r;
  } catch (e) {
    depth--;
    try { conn.exec(depth === 0 ? 'ROLLBACK' : 'ROLLBACK TO ' + sp + '; RELEASE ' + sp); } catch (e2) { /* bỏ qua */ }
    throw e;
  }
}

function metaGet(key) {
  const r = get('SELECT value FROM meta WHERE key = ?', key);
  return r ? r.value : null;
}
function metaSet(key, value) {
  run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

function close() {
  if (conn) { conn.close(); conn = null; stmts.clear(); }
}

module.exports = { open, run, get, all, exec, tx, metaGet, metaSet, close, get conn() { return conn; } };
