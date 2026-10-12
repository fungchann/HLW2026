'use strict';
/*
 * Sinh token đăng nhập giống như Portal iNET sẽ làm — dùng để thử luồng tích hợp ở máy local.
 *   npm run portal-token -- <mã khách hàng> [số giây hiệu lực, mặc định 600]
 * Token được ký bằng PORTAL_JWT_SECRET (trong .env, hoặc secret tự sinh ở data/dev-secrets.json khi chạy dev).
 */
const crypto = require('crypto');
const env = require('../server/env');
const sec = require('../server/security');

const sub = String(process.argv[2] || 'KH' + Math.floor(100000 + Math.random() * 900000));
const ttl = Math.max(30, parseInt(process.argv[3] || '600', 10));
const now = Math.floor(Date.now() / 1000);
const payload = { sub, iat: now, exp: now + ttl, jti: crypto.randomBytes(12).toString('base64url') };
if (env.PORTAL_JWT_AUDIENCE) payload.aud = env.PORTAL_JWT_AUDIENCE;
const token = sec.signJwt(payload, env.PORTAL_JWT_SECRET);
const base = env.PUBLIC_URL || ('http://localhost:' + env.PORT);
console.log('Payload :', JSON.stringify(payload));
console.log('Token   :', token);
console.log('Mở link :', base + '/#token=' + token);
console.log('(Token dùng 1 lần, hết hạn sau ' + ttl + ' giây)');
