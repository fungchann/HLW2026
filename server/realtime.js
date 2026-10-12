'use strict';
/*
 * Đẩy số liệu realtime cho trang Admin bằng Server-Sent Events (SSE).
 * - "activity": dòng sự kiện trực tiếp (ai vừa đạt mốc nào, coupon nào vừa cấp...)
 * - "tick": báo dashboard tải lại số liệu (gộp lại tối đa 1 lần / 2 giây)
 */
const clients = new Set();
let tickTimer = null;
const recent = [];

function write(res, event, data) {
  try { res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n'); } catch (e) { /* client đã đóng */ }
}

function subscribe(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 4000\n\n');
  write(res, 'hello', { recent: recent.slice(-30) });
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { /* bỏ qua */ } }, 20000);
  const c = { res, ping };
  clients.add(c);
  req.on('close', () => { clearInterval(ping); clients.delete(c); });
}

function tick() {
  if (tickTimer) return;
  tickTimer = setTimeout(() => {
    tickTimer = null;
    for (const c of clients) write(c.res, 'tick', { at: Date.now() });
  }, 2000);
}

// item: { type, text, playerId, ext, test, at }
function activity(item) {
  item.at = item.at || Date.now();
  recent.push(item);
  if (recent.length > 100) recent.shift();
  for (const c of clients) write(c.res, 'activity', item);
  tick();
}

function count() { return clients.size; }

module.exports = { subscribe, tick, activity, count };
