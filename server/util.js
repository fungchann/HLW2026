'use strict';

const VN_OFFSET = 7 * 3600 * 1000;

// Ngày & giờ theo múi giờ Việt Nam (UTC+7) để thống kê.
function vnParts(ms) {
  const d = new Date(ms + VN_OFFSET);
  return { day: d.toISOString().slice(0, 10), hour: d.getUTCHours(), weekday: d.getUTCDay() };
}

// '2026-10-26' (giờ VN) -> mốc ms đầu ngày / cuối ngày
function vnDayStart(day) { return Date.parse(day + 'T00:00:00+07:00'); }
function vnDayEnd(day) { return Date.parse(day + 'T23:59:59.999+07:00'); }

function parseUA(ua, hint) {
  ua = String(ua || '');
  let device = 'desktop';
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Android(?!.*Mobile)/i.test(ua)) device = 'tablet';
  else if (/Mobi|iPhone|iPod|Android|BlackBerry|IEMobile|Opera Mini/i.test(ua)) device = 'mobile';
  // iPadOS 13+ tự nhận là Macintosh: dựa thêm vào gợi ý cảm ứng từ trình duyệt
  if (device === 'desktop' && /Macintosh/.test(ua) && hint && hint.touch && hint.device === 'tablet') device = 'tablet';

  let os = 'Khác';
  if (/Windows NT/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad|iPod/.test(ua) || (device === 'tablet' && /Macintosh/.test(ua))) os = 'iOS';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  let browser = 'Khác';
  if (/Zalo/i.test(ua)) browser = 'Zalo';
  else if (/FBAN|FBAV|FB_IAB/.test(ua)) browser = 'Facebook';
  else if (/coc_coc/i.test(ua)) browser = 'Cốc Cốc';
  else if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung';
  else if (/Firefox|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/CriOS|Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return { device, os, browser };
}

function pickRandom(arr) {
  if (!arr || !arr.length) return '';
  return arr[Math.floor(Math.random() * arr.length)];
}

function toInt(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Chống CSV/Formula injection khi mở bằng Excel
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toCsv(columns, rows) {
  const head = columns.map((c) => csvEscape(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvEscape(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','));
  return '﻿' + [head].concat(body).join('\r\n');
}

function fmtVN(ms) {
  if (!ms) return '';
  const d = new Date(ms + VN_OFFSET);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

module.exports = { VN_OFFSET, vnParts, vnDayStart, vnDayEnd, parseUA, pickRandom, toInt, toCsv, csvEscape, fmtVN };
