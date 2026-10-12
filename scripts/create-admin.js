'use strict';
/*
 * Tạo mới (hoặc cấp lại mật khẩu cho) tài khoản quản trị từ dòng lệnh.
 *   npm run create-admin -- <username> [viewer|manager|superadmin]
 * Mật khẩu tạm thời được in ra màn hình; người dùng bắt buộc đổi ở lần đăng nhập đầu tiên.
 */
const env = require('../server/env');
const db = require('../server/db');
db.open(env.DB_PATH);
const sec = require('../server/security');

const username = String(process.argv[2] || '').trim();
const role = process.argv[3] || 'superadmin';
if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(username) || !['viewer', 'manager', 'superadmin'].includes(role)) {
  console.log('Cách dùng: npm run create-admin -- <username> [viewer|manager|superadmin]');
  process.exit(1);
}
const pass = sec.randomToken(9) + 'Aa1';
const existing = db.get('SELECT id FROM admins WHERE username = ?', username);
if (existing) {
  db.run('UPDATE admins SET pass_hash = ?, role = ?, must_change = 1, disabled = 0, failed_count = 0, locked_until = NULL WHERE id = ?', sec.hashPassword(pass), role, existing.id);
  db.run('DELETE FROM admin_sessions WHERE admin_id = ?', existing.id);
  console.log('Đã cấp lại mật khẩu cho "' + username + '" (vai trò: ' + role + ')');
} else {
  db.run('INSERT INTO admins (username, pass_hash, role, must_change, created_at) VALUES (?, ?, ?, 1, ?)', username, sec.hashPassword(pass), role, Date.now());
  console.log('Đã tạo tài khoản "' + username + '" (vai trò: ' + role + ')');
}
db.run('INSERT INTO audit_log (admin_name, action, target, ip, created_at) VALUES (?, ?, ?, ?, ?)', 'cli', existing ? 'admin_reset_password' : 'admin_create', username, 'cli', Date.now());
console.log('Mật khẩu tạm thời: ' + pass);
console.log('Đăng nhập tại /admin và đổi mật khẩu ngay.');
db.close();
