'use strict';
/*
 * Đọc biến môi trường từ file .env (nếu có). Mọi bí mật (secret, API key) CHỈ nằm ở đây,
 * không bao giờ được gửi xuống trình duyệt.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') process.loadEnvFile(envFile);

const E = process.env;
const isProd = E.NODE_ENV === 'production';
const DATA_DIR = path.resolve(ROOT, E.DATA_DIR || 'data');

function bool(v, def) {
  if (v === undefined || v === '') return def;
  return /^(1|true|yes|on)$/i.test(String(v));
}
function list(v) {
  return String(v || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

// Nếu chưa khai báo secret trong .env: tự sinh ngẫu nhiên NGAY TRÊN MÁY CHỦ và lưu vào data/secrets.json
// (quyền 600, không bao giờ rời máy chủ). Muốn chia sẻ PORTAL_JWT_SECRET cho Portal thì khai báo trong .env.
function devSecrets() {
  const legacy = path.join(DATA_DIR, 'dev-secrets.json');
  const f = fs.existsSync(legacy) ? legacy : path.join(DATA_DIR, 'secrets.json');
  let s = {};
  try { s = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { /* chưa có */ }
  let changed = false;
  for (const k of ['APP_SECRET', 'PORTAL_JWT_SECRET', 'INTEGRATION_SECRET']) {
    if (!s[k]) { s[k] = crypto.randomBytes(32).toString('base64url'); changed = true; }
  }
  if (changed) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(f, JSON.stringify(s, null, 2), { mode: 0o600 });
  }
  return s;
}

const missing = ['APP_SECRET', 'PORTAL_JWT_SECRET', 'INTEGRATION_SECRET'].filter((k) => !E[k] || E[k].length < 32);
let secrets = {};
if (missing.length) {
  secrets = devSecrets();
  console.log('[env] Dùng secret tự sinh lưu tại data/ cho: ' + missing.join(', '));
}
const pick = (k) => (E[k] && E[k].length >= 32 ? E[k] : secrets[k]);

const config = {
  ROOT,
  DATA_DIR,
  isProd,
  PORT: parseInt(E.PORT || '8080', 10),
  HOST: E.HOST || '0.0.0.0',
  PUBLIC_URL: (E.PUBLIC_URL || '').replace(/\/$/, ''),
  DB_PATH: path.resolve(ROOT, E.DB_PATH || path.join(DATA_DIR, 'hlw2026.db')),
  TRUST_PROXY: bool(E.TRUST_PROXY, false),

  APP_SECRET: pick('APP_SECRET'),
  PORTAL_JWT_SECRET: pick('PORTAL_JWT_SECRET'),
  PORTAL_JWT_AUDIENCE: E.PORTAL_JWT_AUDIENCE || '',
  PORTAL_TOKEN_MAX_TTL: parseInt(E.PORTAL_TOKEN_MAX_TTL || '86400', 10),
  PORTAL_ORIGINS: list(E.PORTAL_ORIGINS || (isProd ? '' : 'http://localhost:*')),
  INTEGRATION_SECRET: pick('INTEGRATION_SECRET'),
  COUPON_ENC_KEY: E.COUPON_ENC_KEY || '',

  COUPON_API_URL: E.COUPON_API_URL || '',
  COUPON_API_KEY: E.COUPON_API_KEY || '',
  COUPON_API_TIMEOUT: parseInt(E.COUPON_API_TIMEOUT || '8000', 10),

  ALLOW_DEMO_LOGIN: bool(E.ALLOW_DEMO_LOGIN, !isProd),
  // Đăng nhập không qua Portal: mỗi trình duyệt tự có 1 tài khoản người chơi THẬT (không gắn cờ test)
  GUEST_LOGIN: bool(E.GUEST_LOGIN, false),
  // Đường dẫn trang quản trị (khó đoán). Chỉ chữ, số, gạch ngang.
  ADMIN_PATH: String(E.ADMIN_PATH || 'hlw-admin-quantri128').replace(/[^A-Za-z0-9_-]/g, '') || 'hlw-admin-quantri128',
  PLAYER_TOKEN_TTL_H: parseFloat(E.PLAYER_TOKEN_TTL_H || '12'),
  ADMIN_SESSION_TTL_H: parseFloat(E.ADMIN_SESSION_TTL_H || '12'),
  ADMIN_IP_ALLOWLIST: list(E.ADMIN_IP_ALLOWLIST),
  ADMIN_BOOTSTRAP_USER: E.ADMIN_BOOTSTRAP_USER || '',
  ADMIN_BOOTSTRAP_PASSWORD: E.ADMIN_BOOTSTRAP_PASSWORD || '',
  COOKIE_SECURE: bool(E.COOKIE_SECURE, isProd),
  usingDevSecrets: missing.length > 0
};

module.exports = config;
