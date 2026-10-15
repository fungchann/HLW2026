'use strict';
/* Khung HTTP tối giản: router, đọc JSON, cookie, file tĩnh, header bảo mật. */
const fs = require('fs');
const path = require('path');
const env = require('./env');

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handler });
  }
  get(p, h) { this.add('GET', p, h); }
  post(p, h) { this.add('POST', p, h); }
  put(p, h) { this.add('PUT', p, h); }
  del(p, h) { this.add('DELETE', p, h); }
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: r.handler, params };
    }
    return pathMatched ? { methodNotAllowed: true } : null;
  }
}

// Có tin tiêu đề do reverse proxy (nginx) gắn vào không: bật TRUST_PROXY, HOẶC kết nối đến từ chính máy chủ
// (nginx chạy cùng máy). Người ngoài kết nối thẳng vào cổng Node thì KHÔNG được tin -> không giả IP / HTTPS được.
function fromProxy(req) {
  if (env.TRUST_PROXY) return true;
  const ra = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ra === '127.0.0.1' || ra === '::1';
}

function clientIp(req) {
  if (fromProxy(req)) {
    // X-Real-IP do nginx tự đặt = địa chỉ thật. Với X-Forwarded-For lấy phần tử CUỐI (do nginx thêm vào);
    // phần tử đầu là do trình duyệt gửi lên, giả mạo được.
    if (req.headers['x-real-ip']) return String(req.headers['x-real-ip']).trim();
    const xf = req.headers['x-forwarded-for'];
    if (xf) { const parts = String(xf).split(',').map((x) => x.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  }
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function isHttps(req) {
  if (req.socket.encrypted) return true;
  return fromProxy(req) && String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
}

function readBody(req, limit) {
  limit = limit || 256 * 1024;
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'too_large', 'Dữ liệu gửi lên quá lớn')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit) {
  const ct = String(req.headers['content-type'] || '');
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  if (!/application\/json|text\/plain/.test(ct)) throw new HttpError(415, 'bad_content_type', 'Yêu cầu phải là JSON');
  try {
    const v = JSON.parse(raw.toString('utf8'));
    if (!v || typeof v !== 'object') throw new Error('x');
    req.rawBody = raw;
    return v;
  } catch (e) { throw new HttpError(400, 'bad_json', 'JSON không hợp lệ'); }
}

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

function setCookie(res, name, value, opts) {
  opts = opts || {};
  let c = name + '=' + encodeURIComponent(value) + '; Path=' + (opts.path || '/');
  if (opts.maxAge !== undefined) c += '; Max-Age=' + Math.floor(opts.maxAge);
  if (opts.httpOnly !== false) c += '; HttpOnly';
  c += '; SameSite=' + (opts.sameSite || 'Strict');
  if (opts.secure) c += '; Secure';
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}

function send(res, status, body, headers) {
  if (res.headersSent) return;
  res.writeHead(status, Object.assign({ 'Content-Length': Buffer.byteLength(body) }, headers || {}));
  res.end(body);
}

function json(res, status, obj, headers) {
  send(res, status, JSON.stringify(obj), Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, headers || {}));
}

// ------------------------------------------------------------ header bảo mật
function frameAncestors() {
  return env.PORTAL_ORIGINS.length ? "'self' " + env.PORTAL_ORIGINS.join(' ') : "'self'";
}

function baseHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function cspFor(kind) {
  const fonts = 'https://fonts.googleapis.com';
  const common = "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'self'; " +
    "img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; " +
    "font-src 'self' https://fonts.gstatic.com; script-src 'self'; style-src 'self' 'unsafe-inline' " + fonts + '; ';
  if (kind === 'game') return common + 'frame-ancestors ' + frameAncestors();
  return common + "frame-ancestors 'none'";
}

// ------------------------------------------------------------ file tĩnh
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8'
};

function serveFile(req, res, file, opts) {
  opts = opts || {};
  let st;
  try { st = fs.statSync(file); } catch (e) { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const etag = 'W/"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'ETag': etag,
    'Last-Modified': st.mtime.toUTCString(),
    'Cache-Control': opts.cache || (ext === '.html' ? 'no-cache' : (/\.(png|jpe?g|webp|gif|avif|mp3|ogg|wav|m4a|woff2?)$/.test(ext) ? 'public, max-age=86400' : 'no-cache'))
  };
  if (opts.csp) headers['Content-Security-Policy'] = opts.csp;
  if (opts.frameDeny) headers['X-Frame-Options'] = 'DENY';
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  headers['Content-Length'] = st.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

// Trả file trong thư mục root, chặn path traversal (../) và file ẩn.
function serveStatic(req, res, root, relPath, opts) {
  let rel;
  try { rel = decodeURIComponent(relPath); } catch (e) { return false; }
  if (rel.includes('\0')) return false;
  const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (file !== root && !file.startsWith(root + path.sep)) return false;
  if (path.basename(file).startsWith('.')) return false;
  return serveFile(req, res, file, opts);
}

module.exports = {
  HttpError, Router, clientIp, isHttps, readBody, readJson, parseCookies, setCookie, send, json,
  baseHeaders, cspFor, serveFile, serveStatic
};
