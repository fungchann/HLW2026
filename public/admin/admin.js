/* Trang quản trị Halloween iNET 2026 (SPA thuần, không phụ thuộc thư viện ngoài). */
(function () {
  'use strict';
  var Charts = window.HLWCharts, Engine = window.HLWEngine;
  var $ = function (id) { return document.getElementById(id); };
  var view = $('view');

  var S = {
    me: null, csrf: null, env: {}, meta: null, route: '',
    range: null, test: false, es: null, lastStats: null,
    settings: null, draft: null, settingsVersion: 0, presets: {}, history: [],
    feed: [], tickTimer: null
  };
  var ROLE_RANK = { viewer: 1, manager: 2, superadmin: 3 };
  function can(role) { return S.me && ROLE_RANK[S.me.role] >= ROLE_RANK[role]; }

  // ================================================================ tiện ích
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtNum(n, d) { return Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: d === undefined ? 0 : d }); }
  function fmtPct(r) { return (Number(r || 0) * 100).toLocaleString('vi-VN', { maximumFractionDigits: 1 }) + '%'; }
  var TZ = 'Asia/Ho_Chi_Minh';
  function fmtDT(ms) {
    if (!ms) return '—';
    return new Date(ms).toLocaleString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' });
  }
  function fmtDay(day) { var p = String(day).split('-'); return p[2] + '/' + p[1]; }
  function fmtDur(ms) { var s = Math.round((ms || 0) / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function vnDay(ms) { return new Date(ms + 7 * 3600e3).toISOString().slice(0, 10); }
  function addDays(day, n) { var d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function toLocalInput(iso) { var ms = Date.parse(iso); return isFinite(ms) ? new Date(ms + 7 * 3600e3).toISOString().slice(0, 16) : ''; }
  function fromLocalInput(v) { var ms = Date.parse(v + ':00+07:00'); return isFinite(ms) ? new Date(ms).toISOString() : null; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }

  var DEVICE = { mobile: 'Điện thoại', desktop: 'Máy tính', tablet: 'Máy tính bảng' };
  var REASON = { bomb: 'Trúng bom', quit: 'Chủ động kết thúc', idle: 'Không thao tác (tự kết thúc)', time: 'Hết thời gian lượt chơi', timeout: 'Bỏ dở (quá thời gian chờ)', replaced: 'Bỏ dở (mở lượt mới)', invalid: 'Gian lận / không hợp lệ' };
  var AWARD = { issued: 'Đã cấp', pending: 'Đang tạo mã', held: 'Chờ duyệt', owned: 'Đã sở hữu', sold_out: 'Hết hạn mức', none: 'Không đạt', invalid: 'Không hợp lệ', revoked: 'Đã thu hồi' };
  var CSTATUS = { pending: 'Đang tạo mã', issued: 'Hiệu lực', held: 'Chờ duyệt', redeemed: 'Đã dùng', revoked: 'Đã thu hồi', active: 'Hiệu lực', expired: 'Hết hạn' };
  var FLAG = { slow_clock: 'Đồng hồ chậm bất thường', fast_reaction: 'Phản xạ quá nhanh', tap_rate: 'Tốc độ đập bất thường', too_precise: 'Chính xác bất thường',
    sparse_sync: 'Thiếu dữ liệu đồng bộ', invalid: 'Dữ liệu không hợp lệ', no_bomb_hit: 'Không trúng bom nào',
    clock_ahead: 'Đồng hồ game chạy nhanh hơn thật', clock_backwards: 'Đồng hồ game chạy lùi', batch_too_large: 'Gửi quá nhiều thao tác một lúc',
    bad_event: 'Dữ liệu thao tác sai định dạng', event_order: 'Thứ tự thao tác bất thường', event_future: 'Thao tác ở thời điểm chưa tới', tap_flood: 'Đập dồn dập (auto click)',
    bot_synthetic: 'Thao tác giả lập bằng script/tiện ích', bot_webdriver: 'Trình duyệt điều khiển tự động (Selenium/Playwright...)',
    bot_unfocused: 'Trang game không được chọn mà vẫn có thao tác (trợ lý AI bấm hộ)', bot_mouse_jump: 'Chuột nhảy cóc (AI/script điều khiển chuột)' };
  var ACTION = {
    login: 'Đăng nhập', login_failed: 'Đăng nhập thất bại', password_change: 'Đổi mật khẩu', settings_save: 'Lưu cấu hình', settings_restore: 'Khôi phục cấu hình',
    coupon_revoke: 'Thu hồi coupon', coupon_approve: 'Duyệt coupon', coupon_redeem: 'Đánh dấu coupon đã dùng', coupon_retry: 'Tạo lại mã coupon',
    coupon_redeem_bulk: 'Nhập danh sách coupon đã dùng', pool_import: 'Nhập kho mã coupon', player_ban: 'Khoá người chơi', player_unban: 'Mở khoá người chơi',
    player_turns: 'Điều chỉnh lượt chơi', export: 'Xuất dữ liệu', data_purge_test: 'Xoá dữ liệu test', data_reset_all: 'Xoá toàn bộ dữ liệu',
    backup_download: 'Tải bản sao lưu', admin_create: 'Tạo tài khoản quản trị', admin_role: 'Đổi vai trò', admin_disable: 'Khoá tài khoản quản trị',
    admin_enable: 'Mở khoá tài khoản quản trị', admin_reset_password: 'Cấp lại mật khẩu', test_play: 'Chơi thử', coupon_view_code: 'Xem mã coupon'
  };
  function tierName(id) {
    var t = S.meta && S.meta.tiers.find(function (x) { return x.id === id; });
    return t ? (t.short || t.label) : (id || '—');
  }

  // ================================================================ API
  function api(method, path, body) {
    var headers = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET' && S.csrf) headers['X-CSRF-Token'] = S.csrf;
    return fetch(path, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' })
      .then(function (res) {
        return res.text().then(function (t) {
          var data = null;
          try { data = t ? JSON.parse(t) : null; } catch (e) { data = null; }
          if (!res.ok) {
            var err = new Error((data && data.message) || ('Lỗi ' + res.status));
            err.status = res.status; err.code = data && data.error; err.data = data;
            if (res.status === 401 && path !== 'api/admin/login') showLogin();
            if (err.code === 'must_change_password') showPwChange();
            throw err;
          }
          return data;
        });
      }, function () { var e = new Error('Không kết nối được máy chủ'); e.status = 0; throw e; });
  }

  // ================================================================ thông báo, hộp thoại, ngăn kéo
  function toast(msg, kind) {
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, kind === 'bad' ? 6000 : 3500);
  }

  // dialog({title, html, fields:[{name,label,type,placeholder,value}], confirm, danger, onSubmit(values) -> Promise})
  function dialog(o) {
    var wrap = $('dialog'), form = $('dialog-form');
    $('dialog-title').textContent = o.title;
    var body = '';
    if (o.html) body += o.html;
    if (o.text) body += '<p>' + esc(o.text) + '</p>';
    (o.fields || []).forEach(function (f, i) {
      var id = 'dlg-f' + i;
      var input = f.type === 'textarea'
        ? '<textarea id="' + id + '" name="' + f.name + '" placeholder="' + esc(f.placeholder || '') + '" rows="' + (f.rows || 5) + '">' + esc(f.value || '') + '</textarea>'
        : f.type === 'select'
          ? '<select id="' + id + '" name="' + f.name + '">' + f.options.map(function (op) { return '<option value="' + esc(op[0]) + '"' + (op[0] === f.value ? ' selected' : '') + '>' + esc(op[1]) + '</option>'; }).join('') + '</select>'
          : '<input id="' + id + '" name="' + f.name + '" type="' + (f.type || 'text') + '" placeholder="' + esc(f.placeholder || '') + '" value="' + esc(f.value || '') + '" autocomplete="off">';
      body += '<label class="field"><span>' + esc(f.label) + '</span>' + input + (f.hint ? '<small>' + esc(f.hint) + '</small>' : '') + '</label>';
    });
    $('dialog-body').innerHTML = body;
    $('dialog-error').textContent = '';
    var acts = $('dialog-actions');
    acts.innerHTML = '';
    var cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = o.cancelText || 'Huỷ';
    cancel.onclick = close;
    acts.appendChild(cancel);
    var ok = null;
    if (o.confirm !== false) {
      ok = document.createElement('button');
      ok.type = 'submit'; ok.className = 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'); ok.textContent = o.confirm || 'Xác nhận';
      acts.appendChild(ok);
    }
    function close() { wrap.hidden = true; form.onsubmit = null; document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    form.onsubmit = function (e) {
      e.preventDefault();
      if (!ok || !o.onSubmit) { close(); return; }
      var vals = {};
      (o.fields || []).forEach(function (f, i) { vals[f.name] = $('dlg-f' + i).value; });
      ok.classList.add('is-loading');
      Promise.resolve(o.onSubmit(vals)).then(function (keep) {
        ok.classList.remove('is-loading');
        if (keep !== true) close();
      }).catch(function (err) {
        ok.classList.remove('is-loading');
        $('dialog-error').textContent = err.message;
      });
    };
    wrap.hidden = false;
    setTimeout(function () { var f = form.querySelector('input, textarea, select') || ok || cancel; f.focus(); }, 30);
  }
  function confirmBox(title, text, onOk, opts) {
    dialog(Object.assign({ title: title, text: text, confirm: 'Đồng ý', onSubmit: onOk }, opts || {}));
  }
  function showSecret(title, text, secret) {
    dialog({ title: title, html: '<p>' + esc(text) + '</p><div class="secret-box">' + esc(secret) + '</div>', confirm: false, cancelText: 'Đã ghi lại' });
  }

  function openDrawer(title, html) {
    $('drawer-title').textContent = title;
    $('drawer-body').innerHTML = html;
    $('drawer').hidden = false;
    return $('drawer-body');
  }
  function closeDrawer() { $('drawer').hidden = true; }
  document.addEventListener('click', function (e) { if (e.target.closest('[data-close-drawer]')) closeDrawer(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('drawer').hidden && $('dialog').hidden) closeDrawer(); });

  // ================================================================ giao diện sáng/tối
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t); else document.documentElement.removeAttribute('data-theme');
    var dark = t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches);
    $('btn-theme').textContent = dark ? 'Giao diện sáng' : 'Giao diện tối';
  }
  var savedTheme = null;
  try { savedTheme = localStorage.getItem('hlw_admin_theme'); } catch (e) { /* bỏ qua */ }
  applyTheme(savedTheme);
  $('btn-theme').addEventListener('click', function () {
    var dark = document.documentElement.getAttribute('data-theme') === 'dark' || (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var next = dark ? 'light' : 'dark';
    try { localStorage.setItem('hlw_admin_theme', next); } catch (e) { /* bỏ qua */ }
    applyTheme(next);
    rerenderCharts();
  });

  // ================================================================ đăng nhập
  function showLogin() {
    stopStream();
    $('shell').hidden = true; $('pwchange').hidden = true; $('login').hidden = false;
    setTimeout(function () { $('lg-user').focus(); }, 30);
  }
  function showPwChange() {
    $('shell').hidden = true; $('login').hidden = true; $('pwchange').hidden = false;
    setTimeout(function () { $('pw-cur').focus(); }, 30);
  }
  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('lg-submit');
    $('lg-error').textContent = '';
    btn.classList.add('is-loading');
    api('POST', 'api/admin/login', { username: $('lg-user').value, password: $('lg-pass').value }).then(function (d) {
      btn.classList.remove('is-loading');
      $('lg-pass').value = '';
      S.csrf = d.admin.csrf;
      if (d.admin.mustChange) { S.me = d.admin; showPwChange(); return; }
      return start();
    }).catch(function (err) { btn.classList.remove('is-loading'); $('lg-error').textContent = err.message; });
  });
  $('pw-form').addEventListener('submit', function (e) {
    e.preventDefault();
    $('pw-error').textContent = '';
    if ($('pw-new').value !== $('pw-new2').value) { $('pw-error').textContent = 'Hai mật khẩu mới không khớp.'; return; }
    api('POST', 'api/admin/password', { current: $('pw-cur').value, next: $('pw-new').value }).then(function () {
      ['pw-cur', 'pw-new', 'pw-new2'].forEach(function (id) { $(id).value = ''; });
      toast('Đã đổi mật khẩu', 'good');
      return start();
    }).catch(function (err) { $('pw-error').textContent = err.message; });
  });
  $('btn-logout').addEventListener('click', function () {
    api('POST', 'api/admin/logout', {}).catch(function () {}).then(function () { S.me = null; S.csrf = null; showLogin(); });
  });
  $('btn-menu').addEventListener('click', function () {
    var open = $('side').classList.toggle('open');
    this.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  function start() {
    return api('GET', 'api/admin/me').then(function (d) {
      S.me = d.admin; S.csrf = d.admin.csrf; S.env = d.env || {};
      if (S.me.mustChange) { showPwChange(); return; }
      return api('GET', 'api/admin/overview-meta').then(function (meta) {
        S.meta = meta;
        if (!S.range) {
          S.range = meta.status.status === 'upcoming' ? { preset: 'all' } : { preset: 'campaign' };
          S.test = meta.status.status === 'upcoming';
        }
        $('login').hidden = true; $('pwchange').hidden = true; $('shell').hidden = false;
        $('me-box').innerHTML = '<b>' + esc(S.me.username) + '</b><small>' + esc(S.me.roleLabel) + '</small>';
        Array.prototype.forEach.call(document.querySelectorAll('[data-role]'), function (a) { a.hidden = !can(a.getAttribute('data-role')); });
        paintTop();
        startStream();
        route();
      });
    }).catch(function (e) { if (e.status !== 401 && e.code !== 'must_change_password') { showLogin(); $('lg-error').textContent = e.message; } });
  }

  function paintTop() {
    var st = S.meta.status, c = S.meta.campaign, pill = $('camp-pill');
    var now = Date.now(), label, cls;
    if (c.maintenance) { label = 'Đang bảo trì'; cls = 'bad'; }
    else if (st.status === 'upcoming') { label = 'Sắp diễn ra · còn ' + Math.ceil((st.start - now) / 86400e3) + ' ngày'; cls = 'info'; }
    else if (st.status === 'live') { label = 'Đang diễn ra'; cls = 'good'; }
    else { label = 'Đã kết thúc'; cls = 'plain'; }
    pill.className = 'pill ' + cls;
    pill.textContent = label;
    var warn = [];
    if (c.testMode) warn.push('<b>Chế độ test đang BẬT</b>: người chơi có thể chơi ngoài thời gian chương trình (dữ liệu được gắn cờ test, không tính vào thống kê chính). Hãy tắt trong Cấu hình trước khi chạy thật.');
    if (c.testMode && S.meta.coupons.provider !== 'mock') warn.push('Nguồn mã coupon đang là <b>' + esc(S.meta.coupons.provider) + '</b> — lượt chơi test cũng sẽ lấy mã thật.');
    if (S.env.devSecrets) warn.push('Máy chủ đang dùng <b>secret tự sinh cho môi trường dev</b>. Production phải khai báo APP_SECRET, PORTAL_JWT_SECRET, INTEGRATION_SECRET trong .env.');
    if (S.env.demoLogin) warn.push('<b>Đăng nhập chơi thử (demo)</b> đang bật — đặt ALLOW_DEMO_LOGIN=false ở production.');
    var w = $('env-warn');
    w.hidden = !warn.length;
    w.innerHTML = warn.join('<br>');
  }

  // ================================================================ realtime
  function startStream() {
    stopStream();
    if (!window.EventSource) return;
    var es = new EventSource('api/admin/stream');
    S.es = es;
    es.addEventListener('open', function () { $('live-pill').classList.add('on'); });
    es.addEventListener('error', function () { $('live-pill').classList.remove('on'); });
    es.addEventListener('hello', function (e) {
      $('live-pill').classList.add('on');
      try { S.feed = (JSON.parse(e.data).recent || []).slice().reverse(); } catch (x) { S.feed = []; }
      paintFeed();
    });
    es.addEventListener('activity', function (e) {
      var item;
      try { item = JSON.parse(e.data); } catch (x) { return; }
      S.feed.unshift(item);
      S.feed = S.feed.slice(0, 100);
      paintFeed(true);
    });
    es.addEventListener('tick', function () {
      if (S.route === 'dashboard') {
        clearTimeout(S.tickTimer);
        S.tickTimer = setTimeout(function () { loadDashboard(true); }, 600);
      }
    });
  }
  function stopStream() { if (S.es) { S.es.close(); S.es = null; } $('live-pill').classList.remove('on'); }

  function paintFeed(isNew) {
    var ul = $('feed');
    if (!ul) return;
    var items = S.feed.filter(function (f) { return S.test || !f.test; }).slice(0, 60);
    if (!items.length) { ul.innerHTML = '<li><time></time><span class="hint">Chưa có hoạt động nào. Dữ liệu sẽ tự xuất hiện khi người chơi tham gia.</span></li>'; return; }
    ul.innerHTML = items.map(function (f, i) {
      var t = new Date(f.at).toLocaleTimeString('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return '<li class="k-' + esc(f.type) + (isNew && i === 0 ? ' new' : '') + '"><time>' + t + '</time><span>' + esc(f.text) + (f.test ? '<em class="test-tag">(test)</em>' : '') + '</span></li>';
    }).join('');
  }

  // ================================================================ định tuyến
  var PAGES = {
    dashboard: { title: 'Tổng quan', render: pageDashboard },
    players: { title: 'Người chơi', render: pagePlayers },
    sessions: { title: 'Lượt chơi', render: pageSessions },
    coupons: { title: 'Coupon', render: pageCoupons },
    settings: { title: 'Cấu hình game', render: pageSettings },
    simulate: { title: 'Mô phỏng độ khó', render: pageSimulate },
    integration: { title: 'Tích hợp Portal', render: pageIntegration },
    audit: { title: 'Nhật ký thao tác', render: pageAudit },
    admins: { title: 'Tài khoản & dữ liệu', render: pageAdmins, role: 'superadmin' }
  };
  function route() {
    if (!S.me) return;
    var name = (location.hash.replace(/^#\/?/, '').split('?')[0]) || 'dashboard';
    if (!PAGES[name] || (PAGES[name].role && !can(PAGES[name].role))) name = 'dashboard';
    if (S.route === 'settings' && name !== 'settings' && isDirty() && !confirm('Cấu hình có thay đổi chưa lưu. Rời trang?')) {
      history.replaceState(null, '', '#/settings');
      return;
    }
    S.route = name;
    $('page-title').textContent = PAGES[name].title;
    document.title = PAGES[name].title + ' — Quản trị Halloween iNET 2026';
    Array.prototype.forEach.call(document.querySelectorAll('#nav a'), function (a) {
      if (a.getAttribute('data-page') === name) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    $('side').classList.remove('open');
    closeDrawer();
    Charts.hideTip();
    view.innerHTML = '';
    view.classList.remove('loading');
    PAGES[name].render();
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', function (e) { if (S.route === 'settings' && isDirty()) { e.preventDefault(); e.returnValue = ''; } });

  // ================================================================ bộ lọc thời gian
  function rangeQuery() {
    var r = S.range, q = [];
    if (r.preset === 'all') q.push('all=1');
    else {
      var from, to;
      if (r.preset === 'campaign') { from = vnDay(Date.parse(S.meta.campaign.start)); to = vnDay(Date.parse(S.meta.campaign.end)); }
      else if (r.preset === 'today') { from = to = vnDay(Date.now()); }
      else if (r.preset === '7d') { to = vnDay(Date.now()); from = addDays(to, -6); }
      else { from = r.from; to = r.to; }
      if (from) q.push('from=' + from);
      if (to) q.push('to=' + to);
    }
    if (S.test) q.push('test=1');
    return q.join('&');
  }

  function filterBar(extra, noRange) {
    var r = S.range;
    var presets = [['campaign', 'Toàn chiến dịch'], ['today', 'Hôm nay'], ['7d', '7 ngày'], ['all', 'Tất cả'], ['custom', 'Tuỳ chọn']];
    if (noRange) return '<div class="filters" id="filters"><label class="check"><input type="checkbox" id="f-test"' + (S.test ? ' checked' : '') + '> Gồm dữ liệu test</label>' + (extra || '') + '</div>';
    return '<div class="filters" id="filters">' +
      '<div class="seg" role="group" aria-label="Khoảng thời gian">' + presets.map(function (p) {
        return '<button type="button" data-preset="' + p[0] + '" aria-pressed="' + (r.preset === p[0]) + '">' + p[1] + '</button>';
      }).join('') + '</div>' +
      '<label class="field" ' + (r.preset === 'custom' ? '' : 'hidden') + ' id="f-from-wrap"><span>Từ ngày</span><input type="date" id="f-from" value="' + esc(r.from || '') + '"></label>' +
      '<label class="field" ' + (r.preset === 'custom' ? '' : 'hidden') + ' id="f-to-wrap"><span>Đến ngày</span><input type="date" id="f-to" value="' + esc(r.to || '') + '"></label>' +
      '<label class="check"><input type="checkbox" id="f-test"' + (S.test ? ' checked' : '') + '> Gồm dữ liệu test</label>' +
      (extra || '') + '</div>';
  }

  function bindFilterBar(onChange) {
    Array.prototype.forEach.call(document.querySelectorAll('#filters [data-preset]'), function (b) {
      b.addEventListener('click', function () {
        S.range.preset = b.getAttribute('data-preset');
        if (S.range.preset === 'custom' && !S.range.from) { S.range.to = vnDay(Date.now()); S.range.from = addDays(S.range.to, -6); }
        Array.prototype.forEach.call(document.querySelectorAll('#filters [data-preset]'), function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        $('f-from-wrap').hidden = $('f-to-wrap').hidden = S.range.preset !== 'custom';
        $('f-from').value = S.range.from || ''; $('f-to').value = S.range.to || '';
        onChange();
      });
    });
    if ($('f-from')) $('f-from').addEventListener('change', function () { S.range.from = this.value; onChange(); });
    if ($('f-to')) $('f-to').addEventListener('change', function () { S.range.to = this.value; onChange(); });
    $('f-test').addEventListener('change', function () { S.test = this.checked; paintFeed(); onChange(); });
  }

  // ================================================================ thẻ biểu đồ có chế độ xem bảng
  var chartRegistry = [];
  function chartCard(id, title, desc) {
    return '<section class="card" id="card-' + id + '"><div class="card-head"><div><h2>' + esc(title) + '</h2>' + (desc ? '<p>' + esc(desc) + '</p>' : '') +
      '</div><div class="card-tools"><button class="btn btn-sm btn-ghost" type="button" data-table-toggle="' + id + '" aria-pressed="false">Xem bảng</button></div></div>' +
      '<div class="callout-slot" id="callout-' + id + '"></div><div class="chart" id="chart-' + id + '"></div><div class="chart-table" id="table-' + id + '" hidden></div></section>';
  }
  function drawChart(id, draw, table) {
    chartRegistry = chartRegistry.filter(function (c) { return c.id !== id; });
    chartRegistry.push({ id: id, draw: draw });
    var box = $('chart-' + id);
    if (!box) return;
    draw(box);
    var tb = $('table-' + id);
    tb.innerHTML = table ? tableHtml(table.head, table.rows) : '';
    var btn = document.querySelector('[data-table-toggle="' + id + '"]');
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener('click', function () {
        var on = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.textContent = on ? 'Xem biểu đồ' : 'Xem bảng';
        $('chart-' + id).hidden = on;
        $('table-' + id).hidden = !on;
      });
    }
  }
  function tableHtml(head, rows) {
    if (!rows.length) return '<p class="hint">Không có dữ liệu.</p>';
    return '<div class="table-wrap"><table class="t"><thead><tr>' + head.map(function (h, i) { return '<th' + (i ? ' class="num"' : '') + '>' + esc(h) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c, i) { return '<td' + (i ? ' class="num"' : '') + '>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
  }
  function rerenderCharts() {
    chartRegistry.forEach(function (c) { var box = $('chart-' + c.id); if (box && document.body.contains(box)) c.draw(box); });
  }
  window.addEventListener('resize', debounce(rerenderCharts, 200));

  // ================================================================ TỔNG QUAN
  function pageDashboard() {
    chartRegistry = [];
    view.innerHTML = filterBar('<div class="grow"></div><button class="btn btn-sm" type="button" id="btn-refresh">Làm mới</button>') + '<div id="dash" class="view" style="padding:0"></div>';
    bindFilterBar(function () { loadDashboard(false); });
    $('btn-refresh').addEventListener('click', function () { loadDashboard(false); });
    loadDashboard(false);
  }

  function loadDashboard(silent) {
    var dash = $('dash');
    if (!dash) return;
    if (!silent) dash.classList.add('loading');
    return api('GET', 'api/admin/stats?' + rangeQuery()).then(function (d) {
      S.lastStats = d;
      dash.classList.remove('loading');
      renderDashboard(d);
    }).catch(function (e) { dash.classList.remove('loading'); toast(e.message, 'bad'); });
  }

  function kpi(label, value, sub, hero) {
    return '<div class="kpi' + (hero ? ' hero' : '') + '"><div class="kpi-label">' + esc(label) + '</div><div class="kpi-value">' + value + '</div>' + (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
  }

  function renderDashboard(d) {
    var dash = $('dash'), k = d.kpi;
    var top = d.top || {};
    var html = '<div class="kpis">' +
      kpi('Người chơi', fmtNum(k.players), 'Đang chơi: <b>' + fmtNum(d.live) + '</b>', true) +
      kpi('Lượt chơi', fmtNum(k.sessions), fmtNum(k.done) + ' lượt đã kết thúc', true) +
      kpi('TB lượt / người', fmtNum(k.perPlayer, 2)) +
      kpi('Điểm trung bình', fmtNum(k.avgScore, 1), 'Thời lượng TB ' + fmtDur(k.avgMs)) +
      kpi('Điểm cao nhất', fmtNum(k.maxScore), top.score ? 'ID ' + esc(top.score.ext_id) + ' · ' + fmtDT(top.score.started_at) : '—') +
      kpi('Combo cao nhất', 'x' + fmtNum(k.maxCombo), top.combo ? 'ID ' + esc(top.combo.ext_id) : '—') +
      kpi('Tỷ lệ chết vì bom', fmtPct(k.bombRate), fmtNum(k.bombDeaths) + ' / ' + fmtNum(k.ended) + ' lượt kết thúc') +
      kpi('Người chơi quay lại', fmtPct(k.returningRate), fmtNum(k.returning) + ' người chơi ≥ 2 ngày · ' + fmtPct(k.returningGapRate) + ' quay lại sau ≥ 30 phút') +
      kpi('Từng hết lượt', fmtNum(k.noTurnsPlayers), fmtNum(k.noTurnsTimes) + ' lần bấm khi hết lượt') +
      kpi('Lượt nghi gian lận', fmtNum(k.suspicious), fmtNum(k.invalid) + ' lượt không hợp lệ') +
      '</div>';

    html += '<div class="section-title">Mốc điểm &amp; voucher</div><div class="grid-2">' +
      chartCard('tiers', 'Số người chơi đạt mốc', 'Tính theo điểm cao nhất của mỗi người trong khoảng thời gian') +
      '<section class="card"><div class="card-head"><div><h2>Coupon đã cấp theo mốc</h2><p>Đã cấp → xem mã → sao chép → bấm đăng ký → sử dụng</p></div></div><div id="coupon-table"></div></section>' +
      '</div>';
    html += '<div class="grid-2">' +
      chartCard('clicks', 'Lượt click "Đăng ký ngay" theo dịch vụ', 'Mỗi voucher dẫn tới trang đăng ký dịch vụ tương ứng') +
      chartCard('funnel', 'Phễu chuyển đổi', 'Số người ở từng bước') +
      '</div>';
    html += '<div class="section-title">Thời gian chơi</div><div class="grid-2">' +
      chartCard('days', 'Lượt chơi theo ngày', 'Giờ Việt Nam') +
      chartCard('heat', 'Khung giờ chơi', 'Số lượt bắt đầu theo ngày × giờ') +
      '</div>';
    html += '<div class="section-title">Hành vi chơi</div><div class="grid-2">' +
      chartCard('hist', 'Phân bố điểm số', 'Mỗi cột 50 điểm, vạch dọc là các mốc quà') +
      chartCard('reasons', 'Lý do kết thúc lượt', 'Bao gồm cả lượt bỏ dở') +
      '</div>';
    html += '<div class="grid-3">' +
      chartCard('devices', 'Thiết bị', 'Theo số lượt chơi') +
      chartCard('os', 'Hệ điều hành', 'Theo số lượt chơi') +
      chartCard('browsers', 'Trình duyệt', 'Theo số lượt chơi') +
      '</div>';
    html += '<div class="grid-2">' +
      chartCard('retention', 'Số ngày tham gia của mỗi người', 'Người chơi quay lại ở các ngày khác nhau') +
      '<section class="card"><div class="card-head"><div><h2>Hoạt động trực tiếp</h2><p>Cập nhật realtime</p></div></div><ul class="feed" id="feed"></ul></section>' +
      '</div>';
    dash.innerHTML = html;

    // --- mốc điểm
    var tr = d.tierReach;
    drawChart('tiers', function (box) {
      Charts.bars(box, { items: tr.map(function (t) { return { label: t.score + ' điểm' + (t.reward ? ' · ' + (t.short || t.label) : ''), value: t.players, note: fmtNum(t.sessions) + ' lượt đạt' }; }), unit: 'người', allowZero: true });
    }, { head: ['Mốc', 'Số người đạt', 'Số lượt đạt', 'Dừng chủ động ở mốc'], rows: tr.map(function (t) { return [t.score + ' · ' + (t.reward ? t.short : 'không quà'), fmtNum(t.players), fmtNum(t.sessions), fmtNum(t.quits)]; }) });

    // --- bảng coupon
    var cps = d.coupons;
    var tot = cps.reduce(function (a, c) { ['issued', 'revealed', 'copied', 'clicks', 'redeemed', 'held'].forEach(function (k2) { a[k2] = (a[k2] || 0) + c[k2]; }); return a; }, {});
    $('coupon-table').innerHTML = '<div class="table-wrap"><table class="t"><thead><tr><th>Mốc</th><th class="num">Đã cấp</th><th class="num">Xem mã</th><th class="num">Copy</th><th class="num">Click ĐK</th><th class="num">Đã dùng</th><th class="num">Hạn mức</th></tr></thead><tbody>' +
      cps.map(function (c) {
        return '<tr><td class="cell-tier"><b>' + esc(c.short || c.label) + '</b><br><span class="hint">' + esc(c.product) + '</span>' + (c.held ? ' <span class="tag warn">' + c.held + ' chờ duyệt</span>' : '') + '</td><td class="num">' + fmtNum(c.issued) + '</td><td class="num">' + fmtNum(c.revealed) +
          '</td><td class="num">' + fmtNum(c.copied) + '</td><td class="num">' + fmtNum(c.clicks) + '</td><td class="num">' + fmtNum(c.redeemed) + '</td><td class="num">' + (c.quota ? fmtNum(c.issued) + '/' + fmtNum(c.quota) : '∞') + '</td></tr>';
      }).join('') +
      '<tr><td><b>Tổng</b></td><td class="num"><b>' + fmtNum(tot.issued) + '</b></td><td class="num">' + fmtNum(tot.revealed) + '</td><td class="num">' + fmtNum(tot.copied) + '</td><td class="num">' + fmtNum(tot.clicks) + '</td><td class="num">' + fmtNum(tot.redeemed) + '</td><td></td></tr>' +
      '</tbody></table></div>';

    // --- click theo dịch vụ
    var best = cps.slice().sort(function (a, b) { return b.clicks - a.clicks; })[0];
    $('callout-clicks').innerHTML = best && best.clicks ? '<div class="callout">Dịch vụ được click nhiều nhất: <b>' + esc(best.product || best.label) + '</b> — ' + fmtNum(best.clicks) + ' lượt (' + fmtNum(best.clickPlayers) + ' người)</div>' : '';
    drawChart('clicks', function (box) {
      Charts.bars(box, { items: cps.map(function (c) { return { label: c.product || c.label, value: c.clicks, note: fmtNum(c.clickPlayers) + ' người' }; }), emphasize: 'max', unit: 'lượt click' });
    }, { head: ['Dịch vụ', 'Lượt click', 'Số người click', 'Trang đích'], rows: cps.map(function (c) { return [c.product || c.label, fmtNum(c.clicks), fmtNum(c.clickPlayers), c.url]; }) });

    // --- phễu
    drawChart('funnel', function (box) { Charts.funnel(box, { steps: d.funnel }); },
      { head: ['Bước', 'Số người', '% so với bước đầu'], rows: d.funnel.map(function (f) { return [f.label, fmtNum(f.n), d.funnel[0].n ? fmtPct(f.n / d.funnel[0].n) : '—']; }) });

    // --- theo ngày
    var days = d.byDay;
    var peakDay = days.slice().sort(function (a, b) { return b.sessions - a.sessions; })[0];
    $('callout-days').innerHTML = peakDay ? '<div class="callout">Ngày đông nhất: <b>' + fmtDay(peakDay.day) + '</b> — ' + fmtNum(peakDay.sessions) + ' lượt, ' + fmtNum(peakDay.players) + ' người chơi</div>' : '';
    drawChart('days', function (box) {
      Charts.columns(box, { items: days.map(function (x) { return { label: fmtDay(x.day), value: x.sessions, tip: fmtDay(x.day) + ' · ' + fmtNum(x.players) + ' người chơi' }; }), unit: 'lượt' });
    }, { head: ['Ngày', 'Lượt chơi', 'Người chơi', 'Điểm TB'], rows: days.map(function (x) { return [fmtDay(x.day), fmtNum(x.sessions), fmtNum(x.players), fmtNum(x.avg_score, 1)]; }) });

    // --- heatmap
    var dayList = Array.from(new Set(d.byDayHour.map(function (x) { return x.day; }))).sort();
    var hours = []; for (var h = 0; h < 24; h++) hours.push(String(h));
    var rows, values;
    if (dayList.length && dayList.length <= 14) {
      rows = dayList.map(fmtDay);
      values = dayList.map(function (day) { return hours.map(function (hh) { var c = d.byDayHour.find(function (x) { return x.day === day && x.hour === +hh; }); return c ? c.n : 0; }); });
    } else {
      var WD = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
      var order = [1, 2, 3, 4, 5, 6, 0];
      rows = order.map(function (w) { return WD[w]; });
      values = order.map(function () { return hours.map(function () { return 0; }); });
      d.byDayHour.forEach(function (x) { var wd = new Date(x.day + 'T00:00:00Z').getUTCDay(); values[order.indexOf(wd)][x.hour] += x.n; });
    }
    var peakHour = d.byHour.slice().sort(function (a, b) { return b.n - a.n; })[0];
    $('callout-heat').innerHTML = peakHour ? '<div class="callout">Giờ cao điểm: <b>' + peakHour.hour + 'h – ' + (peakHour.hour + 1) + 'h</b> — ' + fmtNum(peakHour.n) + ' lượt</div>' : '';
    drawChart('heat', function (box) { Charts.heatmap(box, { rows: rows, cols: hours, values: values }); },
      { head: ['Giờ', 'Lượt chơi'], rows: d.byHour.map(function (x) { return [x.hour + 'h – ' + (x.hour + 1) + 'h', fmtNum(x.n)]; }) });

    // --- histogram
    var bins = d.histogram.map(function (b) { return { x0: b.b, value: b.n, label: b.b >= 1500 ? '≥ 1500' : b.b + ' – ' + (b.b + 49) }; });
    if (bins.length) {
      var maxB = bins[bins.length - 1].x0, filled = [];
      for (var x0 = 0; x0 <= maxB; x0 += 50) { var f = bins.find(function (b) { return b.x0 === x0; }); filled.push(f || { x0: x0, value: 0, label: x0 + ' – ' + (x0 + 49) }); }
      bins = filled;
    }
    drawChart('hist', function (box) {
      Charts.histogram(box, { bins: bins, step: 50, markers: S.meta.tiers.filter(function (t) { return t.enabled; }).map(function (t) { return { x: t.score, label: String(t.score) }; }) });
    }, { head: ['Khoảng điểm', 'Số lượt'], rows: bins.map(function (b) { return [b.label, fmtNum(b.value)]; }) });

    // --- lý do kết thúc
    var reasonOrder = ['bomb', 'time', 'quit', 'idle', 'timeout', 'replaced', 'invalid'];
    var reasons = reasonOrder.map(function (r, i) { var x = d.endReasons.find(function (e) { return e.reason === r; }); return { label: REASON[r], value: x ? x.n : 0, slot: i + 1 }; });
    drawChart('reasons', function (box) { Charts.stack(box, { segments: reasons }); },
      { head: ['Lý do', 'Số lượt'], rows: reasons.map(function (r) { return [r.label, fmtNum(r.value)]; }) });

    // --- thiết bị
    var devOrder = ['mobile', 'desktop', 'tablet'];
    var devs = devOrder.map(function (k2, i) { var x = d.devices.find(function (e) { return e.device === k2; }); return { label: DEVICE[k2], value: x ? x.sessions : 0, players: x ? x.players : 0, slot: i + 1 }; });
    var devTop = devs.slice().sort(function (a, b) { return b.value - a.value; })[0];
    $('callout-devices').innerHTML = devTop && devTop.value ? '<div class="callout"><b>' + esc(devTop.label) + '</b> chiếm nhiều nhất</div>' : '';
    drawChart('devices', function (box) { Charts.stack(box, { segments: devs }); },
      { head: ['Thiết bị', 'Lượt chơi', 'Người chơi'], rows: devs.map(function (x) { return [x.label, fmtNum(x.value), fmtNum(x.players)]; }) });
    drawChart('os', function (box) { Charts.bars(box, { items: d.os.map(function (x) { return { label: x.name, value: x.sessions }; }), unit: 'lượt' }); },
      { head: ['Hệ điều hành', 'Lượt chơi'], rows: d.os.map(function (x) { return [x.name, fmtNum(x.sessions)]; }) });
    drawChart('browsers', function (box) { Charts.bars(box, { items: d.browsers.map(function (x) { return { label: x.name, value: x.sessions }; }), unit: 'lượt' }); },
      { head: ['Trình duyệt', 'Lượt chơi'], rows: d.browsers.map(function (x) { return [x.name, fmtNum(x.sessions)]; }) });

    // --- quay lại
    drawChart('retention', function (box) {
      Charts.bars(box, { items: d.activeDays.map(function (x) { return { label: x.d + ' ngày', value: x.players }; }), unit: 'người' });
    }, { head: ['Số ngày tham gia', 'Số người'], rows: d.activeDays.map(function (x) { return [x.d + ' ngày', fmtNum(x.players)]; }) });

    paintFeed();
  }

  // ================================================================ bảng có phân trang dùng chung
  function listPage(o) {
    // o: { id, endpoint, columns:[{key,label,sort,num,render}], filtersHtml, bindFilters(reload), params(), onRow(row), exportKind, emptyText }
    var st = { page: 1, sort: o.defaultSort, dir: 'desc' };
    view.innerHTML = filterBar(o.filtersHtml || '', o.noRange) + '<section class="card"><div id="' + o.id + '-table"></div></section>';
    function reload(resetPage) {
      if (resetPage) st.page = 1;
      var q = rangeQuery() + '&page=' + st.page + '&sort=' + encodeURIComponent(st.sort) + '&dir=' + st.dir + (o.params ? o.params() : '');
      var box = $(o.id + '-table');
      box.classList.add('loading');
      api('GET', o.endpoint + '?' + q).then(function (d) {
        box.classList.remove('loading');
        var head = o.columns.map(function (c) {
          var sortAttr = c.sort ? ' class="sortable' + (c.num ? ' num' : '') + '" data-sort="' + c.sort + '"' + (st.sort === c.sort ? ' aria-sort="' + (st.dir === 'asc' ? 'ascending' : 'descending') + '"' : '') : (c.num ? ' class="num"' : '');
          return '<th' + sortAttr + ' scope="col">' + esc(c.label) + '</th>';
        }).join('');
        var body = d.rows.length ? d.rows.map(function (r, i) {
          return '<tr class="' + (o.onRow ? 'clickable' : '') + '" data-i="' + i + '"' + (o.onRow ? ' tabindex="0"' : '') + '>' + o.columns.map(function (c) {
            var v = c.render ? c.render(r) : esc(r[c.key]);
            return '<td' + (c.num ? ' class="num"' : '') + '>' + v + '</td>';
          }).join('') + '</tr>';
        }).join('') : '<tr class="empty-row"><td colspan="' + o.columns.length + '">' + esc(o.emptyText || 'Không có dữ liệu phù hợp') + '</td></tr>';
        var pages = Math.max(1, Math.ceil(d.total / d.size));
        box.innerHTML = '<div class="table-wrap"><table class="t"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>' +
          '<div class="pager"><span>' + fmtNum(d.total) + ' dòng · trang ' + d.page + '/' + pages + '</span><span class="btns">' +
          '<button class="btn btn-sm" type="button" data-pg="prev"' + (d.page <= 1 ? ' disabled' : '') + '>Trước</button>' +
          '<button class="btn btn-sm" type="button" data-pg="next"' + (d.page >= pages ? ' disabled' : '') + '>Sau</button></span></div>';
        Array.prototype.forEach.call(box.querySelectorAll('th[data-sort]'), function (th) {
          th.addEventListener('click', function () {
            var s = th.getAttribute('data-sort');
            if (st.sort === s) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.sort = s; st.dir = 'desc'; }
            reload(true);
          });
        });
        box.querySelector('[data-pg="prev"]').addEventListener('click', function () { st.page--; reload(); });
        box.querySelector('[data-pg="next"]').addEventListener('click', function () { st.page++; reload(); });
        if (o.onRow) Array.prototype.forEach.call(box.querySelectorAll('tbody tr[data-i]'), function (tr) {
          var row = d.rows[+tr.getAttribute('data-i')];
          tr.addEventListener('click', function (e) { if (!e.target.closest('button, a')) o.onRow(row); });
          tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') o.onRow(row); });
        });
        if (o.afterRender) o.afterRender(box, d);
      }).catch(function (e) { box.classList.remove('loading'); box.innerHTML = '<p class="form-error">' + esc(e.message) + '</p>'; });
    }
    bindFilterBar(function () { reload(true); });
    if (o.bindFilters) o.bindFilters(function () { reload(true); });
    var ex = $('btn-export');
    if (ex) ex.addEventListener('click', function () { window.location.href = 'api/admin/export/' + o.exportKind + '?' + rangeQuery(); });
    reload(true);
    return { reload: reload };
  }

  function couponTags(list) {
    if (!list || !list.length) return '<span class="hint">—</span>';
    return '<span class="tags">' + list.map(function (c) {
      var cls = c.status === 'redeemed' ? 'good' : c.status === 'held' ? 'warn' : 'info';
      return '<span class="tag ' + cls + '">' + esc(tierName(c.tier)) + (c.status === 'redeemed' ? ' ✓' : '') + '</span>';
    }).join('') + '</span>';
  }

  // ================================================================ NGƯỜI CHƠI
  function pagePlayers() {
    var extra = '<label class="field grow"><span>Tìm ID người chơi</span><input type="search" id="f-q" placeholder="Nhập ID..."></label>' +
      '<label class="field"><span>Lọc</span><select id="f-filter"><option value="">Tất cả</option><option value="coupon">Đã nhận voucher</option><option value="nocoupon">Chưa có voucher</option>' +
      '<option value="redeemed">Đã dùng coupon</option><option value="returning">Quay lại ≥ 2 ngày</option><option value="flagged">Có lượt nghi ngờ</option><option value="banned">Đang bị khoá</option></select></label>' +
      '<label class="field"><span>Điểm cao nhất</span><select id="f-min"><option value="0">Mọi mức</option>' + S.meta.tiers.filter(function (t) { return t.enabled; }).map(function (t) { return '<option value="' + t.score + '">≥ ' + t.score + '</option>'; }).join('') + '</select></label>' +
      (can('manager') ? '<button class="btn btn-sm" type="button" id="btn-export">Xuất CSV</button>' : '');
    var lp = listPage({
      id: 'players', endpoint: 'api/admin/players', defaultSort: 'last_play_at', exportKind: 'players', noRange: true,
      filtersHtml: extra,
      params: function () { return '&q=' + encodeURIComponent($('f-q').value.trim()) + '&filter=' + $('f-filter').value + '&minScore=' + $('f-min').value; },
      bindFilters: function (reload) {
        $('f-q').addEventListener('input', debounce(reload, 350));
        $('f-filter').addEventListener('change', reload);
        $('f-min').addEventListener('change', reload);
      },
      columns: [
        { key: 'extId', label: 'ID người chơi', sort: 'ext_id', render: function (r) { return '<b class="id-cell">' + esc(r.extId) + '</b>' + (r.test ? ' <span class="tag">test</span>' : '') + (r.banned ? ' <span class="tag bad">khoá</span>' : '') + (r.flagged ? ' <span class="tag warn">nghi ngờ ' + r.flagged + '</span>' : ''); } },
        { key: 'firstPlayAt', label: 'Lần đầu chơi', sort: 'first_play_at', render: function (r) { return '<span class="nowrap">' + fmtDT(r.firstPlayAt) + '</span>'; } },
        { key: 'lastPlayAt', label: 'Lần chơi gần nhất', sort: 'last_play_at', render: function (r) { return '<span class="nowrap">' + fmtDT(r.lastPlayAt) + '</span>'; } },
        { key: 'sessions', label: 'Tổng lượt', sort: 'total_sessions', num: true, render: function (r) { return fmtNum(r.sessions); } },
        { key: 'bestScore', label: 'Điểm cao nhất', sort: 'best_score', num: true, render: function (r) { return fmtNum(r.bestScore); } },
        { key: 'avgScore', label: 'Điểm TB', sort: 'avg_score', num: true, render: function (r) { return fmtNum(r.avgScore); } },
        { key: 'bestCombo', label: 'Combo cao nhất', sort: 'best_combo', num: true, render: function (r) { return 'x' + fmtNum(r.bestCombo); } },
        { key: 'coupons', label: 'Voucher đã nhận', sort: 'coupons', render: function (r) { return couponTags(r.coupons); } },
        { key: 'clicks', label: 'Sản phẩm đã click', sort: 'clicks', render: function (r) { return r.clicks.length ? r.clicks.map(function (c) { return esc(tierName(c.tier)) + ' ×' + c.n; }).join('<br>') : '<span class="hint">—</span>'; } },
        { key: 'redeemed', label: 'Conversion', render: function (r) { return r.redeemed ? '<span class="tag good">Đã dùng ' + r.redeemed + '</span>' : '<span class="hint">—</span>'; } }
      ],
      onRow: function (r) { openPlayer(r.id); }
    });
    S.reloadList = lp.reload;
  }

  function openPlayer(id) {
    var body = openDrawer('Người chơi', '<p class="hint">Đang tải...</p>');
    api('GET', 'api/admin/players/' + id).then(function (d) {
      var p = d.player;
      $('drawer-title').textContent = 'Người chơi ' + p.extId;
      var html = '<dl class="dl">' +
        dd('ID người chơi', esc(p.extId) + (p.test ? ' (test)' : '')) + dd('Lần đầu vào game', fmtDT(p.createdAt)) + dd('Lần đầu chơi', fmtDT(p.firstPlayAt)) +
        dd('Lần chơi gần nhất', fmtDT(p.lastPlayAt)) + dd('Tổng lượt', fmtNum(p.sessions)) + dd('Điểm cao nhất', fmtNum(p.bestScore)) +
        dd('Điểm trung bình', fmtNum(p.avgScore)) + dd('Combo cao nhất', 'x' + p.bestCombo) + dd('Chết vì bom', fmtNum(p.bombDeaths)) +
        dd('Số ngày tham gia', fmtNum(p.activeDays)) + dd('Thiết bị gần nhất', DEVICE[p.device] || '—') +
        dd('Lượt hiện có', p.turns.turns + '/' + p.turns.max + (p.turns.bonus ? ' +' + p.turns.bonus + ' thưởng' : '')) +
        dd('Trạng thái', p.banned ? '<span class="tag bad">Đang bị khoá</span> ' + esc(p.banReason || '') : (p.lockedUntil ? '<span class="tag warn">Tạm khoá đến ' + fmtDT(p.lockedUntil) + '</span> (gian lận liên tiếp)' : '<span class="tag good">Bình thường</span>')) +
        '</dl>';
      if (can('manager')) {
        html += '<div class="actions-row">' +
          (p.banned || p.lockedUntil ? '<button class="btn btn-sm" type="button" id="pl-unban">Mở khoá</button>' : '<button class="btn btn-sm btn-danger" type="button" id="pl-ban">Khoá khỏi chương trình</button>') +
          '<button class="btn btn-sm" type="button" id="pl-refill">Hồi đầy lượt</button><button class="btn btn-sm" type="button" id="pl-bonus">Tặng thêm lượt</button></div>';
      }
      html += '<h3>Voucher (' + d.coupons.length + ')</h3>' + couponMiniTable(d.coupons);
      html += '<h3>Lượt chơi gần đây (' + d.sessions.length + ')</h3>' + sessionMiniTable(d.sessions);
      html += '<h3>Click "Đăng ký ngay" (' + d.clicks.length + ')</h3>' + (d.clicks.length ? tableHtml(['Thời gian', 'Dịch vụ', 'Nguồn'], d.clicks.map(function (c) { return [fmtDT(c.created_at), tierName(c.tier_id), c.source || '—']; })) : '<p class="hint">Chưa click.</p>');
      body.innerHTML = html;
      bindCouponActions(body, function () { openPlayer(id); });
      bindSessionRows(body);
      var reload = function () { openPlayer(id); if (S.reloadList) S.reloadList(); };
      if ($('pl-ban')) $('pl-ban').addEventListener('click', function () {
        dialog({ title: 'Khoá người chơi ' + p.extId, text: 'Người chơi sẽ không thể đăng nhập vào game. Coupon đã cấp vẫn giữ nguyên (thu hồi riêng nếu cần).',
          fields: [{ name: 'reason', label: 'Lý do (hiển thị cho người chơi)', placeholder: 'vd: Sử dụng công cụ gian lận' }], confirm: 'Khoá', danger: true,
          onSubmit: function (v) { return api('POST', 'api/admin/players/' + id + '/ban', { banned: true, reason: v.reason }).then(function () { toast('Đã khoá người chơi'); reload(); }); } });
      });
      if ($('pl-unban')) $('pl-unban').addEventListener('click', function () {
        api('POST', 'api/admin/players/' + id + '/ban', { banned: false }).then(function () { toast('Đã mở khoá'); reload(); }).catch(function (e) { toast(e.message, 'bad'); });
      });
      if ($('pl-refill')) $('pl-refill').addEventListener('click', function () {
        api('POST', 'api/admin/players/' + id + '/turns', { action: 'refill' }).then(function () { toast('Đã hồi đầy lượt'); reload(); }).catch(function (e) { toast(e.message, 'bad'); });
      });
      if ($('pl-bonus')) $('pl-bonus').addEventListener('click', function () {
        dialog({ title: 'Tặng thêm lượt chơi', fields: [{ name: 'amount', label: 'Số lượt (âm để trừ)', type: 'number', value: '1' }], confirm: 'Tặng',
          onSubmit: function (v) { return api('POST', 'api/admin/players/' + id + '/turns', { action: 'bonus', amount: Number(v.amount) }).then(function () { toast('Đã cập nhật lượt'); reload(); }); } });
      });
    }).catch(function (e) { body.innerHTML = '<p class="form-error">' + esc(e.message) + '</p>'; });
  }
  function dd(k, v) { return '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>'; }

  function couponMiniTable(list) {
    if (!list.length) return '<p class="hint">Chưa có voucher.</p>';
    return '<div class="table-wrap"><table class="t"><thead><tr><th>Mốc</th><th>Mã</th><th>Trạng thái</th><th>Ngày cấp</th><th>Đã dùng</th>' + (can('manager') ? '<th></th>' : '') + '</tr></thead><tbody>' +
      list.map(function (c) {
        return '<tr><td>' + esc(tierName(c.tierId)) + (c.test ? ' <span class="tag">test</span>' : '') + '</td><td class="nowrap">' + codeCell(c) +
          '</td><td>' + statusTag(c.displayStatus) + '</td><td class="nowrap">' + fmtDT(c.createdAt) + '</td><td class="nowrap">' + (c.redeemedAt ? fmtDT(c.redeemedAt) + (c.redeemRef ? '<br><span class="hint">' + esc(c.redeemRef) + '</span>' : '') : '—') + '</td>' +
          (can('manager') ? '<td class="nowrap">' + couponActionButtons(c) + '</td>' : '') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }
  function statusTag(st) {
    var cls = { active: 'info', issued: 'info', redeemed: 'good', held: 'warn', pending: 'warn', revoked: 'bad', expired: '' }[st] || '';
    return '<span class="tag ' + cls + '">' + esc(CSTATUS[st] || st) + '</span>';
  }
  function codeCell(c) {
    if (!c.code) return '<span class="hint">' + esc(c.error || '—') + '</span>';
    return '<code data-code="' + c.id + '">' + esc(c.code) + '</code>' +
      (can('manager') ? ' <button class="btn btn-sm btn-ghost" type="button" data-reveal="' + c.id + '" title="Hiện mã đầy đủ (được ghi vào nhật ký)">Hiện</button>' : '');
  }
  function bindReveal(root) {
    Array.prototype.forEach.call(root.querySelectorAll('[data-reveal]'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = btn.getAttribute('data-reveal');
        var el = root.querySelector('[data-code="' + id + '"]');
        if (btn.getAttribute('data-shown')) {
          if (el) el.textContent = el.getAttribute('data-masked');
          btn.removeAttribute('data-shown'); btn.textContent = 'Hiện';
          return;
        }
        btn.disabled = true;
        api('POST', 'api/admin/coupons/' + id + '/code', {}).then(function (r) {
          if (el) { el.setAttribute('data-masked', el.textContent); el.textContent = r.code; }
          btn.setAttribute('data-shown', '1'); btn.textContent = 'Ẩn';
          // tự che lại sau 20 giây
          setTimeout(function () { if (btn.getAttribute('data-shown')) btn.click(); }, 20000);
        }).catch(function (err) { toast(err.message, 'bad'); }).then(function () { btn.disabled = false; });
      });
    });
  }
  function couponActionButtons(c) {
    var b = '';
    if (c.status === 'held') b += '<button class="btn btn-sm" type="button" data-cact="approve" data-id="' + c.id + '">Duyệt</button> ';
    if (c.status === 'pending') b += '<button class="btn btn-sm" type="button" data-cact="retry" data-id="' + c.id + '">Tạo lại mã</button> ';
    if (c.status === 'issued') b += '<button class="btn btn-sm" type="button" data-cact="redeem" data-id="' + c.id + '">Đã dùng</button> ';
    if (c.status !== 'revoked' && c.status !== 'redeemed') b += '<button class="btn btn-sm btn-ghost" type="button" data-cact="revoke" data-id="' + c.id + '">Thu hồi</button>';
    return b;
  }
  function bindCouponActions(root, after) {
    bindReveal(root);
    Array.prototype.forEach.call(root.querySelectorAll('[data-cact]'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var act = btn.getAttribute('data-cact'), id = btn.getAttribute('data-id');
        var run = function (extra) { return api('POST', 'api/admin/coupons/' + id + '/action', Object.assign({ action: act }, extra || {})).then(function () { toast('Đã cập nhật coupon'); after(); }); };
        if (act === 'revoke') dialog({ title: 'Thu hồi coupon #' + id, text: 'Người chơi sẽ không còn thấy coupon này. Nếu mã đã được tạo trên hệ thống billing, hãy vô hiệu hoá mã ở đó nữa.', fields: [{ name: 'reason', label: 'Lý do' }], confirm: 'Thu hồi', danger: true, onSubmit: function (v) { return run({ reason: v.reason }); } });
        else if (act === 'redeem') dialog({ title: 'Đánh dấu coupon #' + id + ' đã sử dụng', fields: [{ name: 'ref', label: 'Mã đơn hàng (nếu có)' }], confirm: 'Xác nhận', onSubmit: function (v) { return run({ ref: v.ref }); } });
        else run().catch(function (err) { toast(err.message, 'bad'); });
      });
    });
  }

  function sessionMiniTable(list) {
    if (!list.length) return '<p class="hint">Chưa có lượt chơi.</p>';
    return '<div class="table-wrap"><table class="t"><thead><tr><th>Bắt đầu</th><th class="num">Điểm</th><th class="num">Combo</th><th class="num">Thời lượng</th><th>Kết thúc</th><th>Voucher</th><th>Cờ</th></tr></thead><tbody>' +
      list.map(function (s) {
        return '<tr class="clickable" data-sid="' + esc(s.id) + '" tabindex="0"><td class="nowrap">' + fmtDT(s.started_at) + (s.is_test ? ' <span class="tag">test</span>' : '') + '</td><td class="num">' + fmtNum(s.score) + '</td><td class="num">x' + s.max_combo +
          '</td><td class="num">' + fmtDur(s.game_ms) + '</td><td>' + (s.status === 'active' ? '<span class="tag info">Đang chơi</span>' : esc(REASON[s.end_reason] || s.end_reason || '')) + '</td><td>' + esc(AWARD[s.award_status] || '—') + (s.tier_id ? ' · ' + esc(tierName(s.tier_id)) : '') +
          '</td><td>' + flagTags(s.flags) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }
  function flagTags(flags) {
    if (!flags || !flags.length) return '<span class="hint">—</span>';
    return '<span class="tags">' + flags.map(function (f) { return '<span class="tag ' + (f.code === 'invalid' ? 'bad' : 'warn') + '" title="' + esc(FLAG[f.detail] || f.detail || '') + '">' + esc(f.code === 'invalid' && FLAG[f.detail] ? FLAG[f.detail] : (FLAG[f.code] || f.code)) + '</span>'; }).join('') + '</span>';
  }
  function bindSessionRows(root) {
    Array.prototype.forEach.call(root.querySelectorAll('tr[data-sid]'), function (tr) {
      tr.addEventListener('click', function () { openSession(tr.getAttribute('data-sid')); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') openSession(tr.getAttribute('data-sid')); });
    });
  }

  // ================================================================ LƯỢT CHƠI
  function pageSessions() {
    var extra = '<label class="field grow"><span>Tìm ID người chơi / mã lượt</span><input type="search" id="f-q" placeholder="Nhập ID..."></label>' +
      '<label class="field"><span>Lý do kết thúc</span><select id="f-reason"><option value="">Tất cả</option>' + Object.keys(REASON).map(function (k) { return '<option value="' + k + '">' + REASON[k] + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>Mốc đạt</span><select id="f-tier"><option value="">Tất cả</option>' + S.meta.tiers.filter(function (t) { return t.reward; }).map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.short || t.label) + '</option>'; }).join('') + '</select></label>' +
      '<label class="check"><input type="checkbox" id="f-flag"> Chỉ lượt nghi ngờ</label>' +
      '<label class="check"><input type="checkbox" id="f-active"> Đang chơi</label>' +
      (can('manager') ? '<button class="btn btn-sm" type="button" id="btn-export">Xuất CSV</button>' : '');
    var lp = listPage({
      id: 'sessions', endpoint: 'api/admin/sessions', defaultSort: 'started_at', exportKind: 'sessions', filtersHtml: extra,
      params: function () {
        return '&q=' + encodeURIComponent($('f-q').value.trim()) + '&reason=' + $('f-reason').value + '&tier=' + encodeURIComponent($('f-tier').value) +
          ($('f-flag').checked ? '&flagged=1' : '') + ($('f-active').checked ? '&status=active' : '');
      },
      bindFilters: function (reload) {
        $('f-q').addEventListener('input', debounce(reload, 350));
        ['f-reason', 'f-tier', 'f-flag', 'f-active'].forEach(function (id) { $(id).addEventListener('change', reload); });
      },
      columns: [
        { key: 'started_at', label: 'Bắt đầu', sort: 'started_at', render: function (r) { return '<span class="nowrap">' + fmtDT(r.started_at) + '</span>' + (r.is_test ? ' <span class="tag">test</span>' : ''); } },
        { key: 'ext_id', label: 'Người chơi', render: function (r) { return '<b>' + esc(r.ext_id) + '</b>'; } },
        { key: 'score', label: 'Điểm', sort: 'score', num: true, render: function (r) { return fmtNum(r.score); } },
        { key: 'max_combo', label: 'Combo', sort: 'max_combo', num: true, render: function (r) { return 'x' + r.max_combo; } },
        { key: 'game_ms', label: 'Thời lượng', sort: 'game_ms', num: true, render: function (r) { return fmtDur(r.game_ms); } },
        { key: 'level', label: 'Level', num: true },
        { key: 'end_reason', label: 'Kết thúc', render: function (r) { return r.status === 'active' ? '<span class="tag info">Đang chơi</span>' : esc(REASON[r.end_reason] || r.end_reason || ''); } },
        { key: 'award_status', label: 'Voucher', render: function (r) { return esc(AWARD[r.award_status] || '—') + (r.tier_id ? '<br><span class="hint">' + esc(tierName(r.tier_id)) + '</span>' : ''); } },
        { key: 'device', label: 'Thiết bị', render: function (r) { return esc(DEVICE[r.device] || r.device || '') + '<br><span class="hint">' + esc((r.os || '') + ' · ' + (r.browser || '')) + '</span>'; } },
        { key: 'flags', label: 'Cờ', render: function (r) { return flagTags(r.flags); } }
      ],
      onRow: function (r) { openSession(r.id); }
    });
    S.reloadList = lp.reload;
  }

  function openSession(id) {
    var body = openDrawer('Lượt chơi', '<p class="hint">Đang tải...</p>');
    api('GET', 'api/admin/sessions/' + encodeURIComponent(id)).then(function (d) {
      var s = d.session, sum = d.summary || {}, an = d.analysis || {};
      $('drawer-title').textContent = 'Lượt chơi của ' + s.extId;
      var acc = sum.taps ? Math.round(100 * sum.hits / sum.taps) + '%' : '—';
      var html = '<dl class="dl">' +
        dd('Mã lượt', '<code>' + esc(s.id) + '</code>') + dd('Người chơi', '<button class="btn-link" type="button" id="ses-player">' + esc(s.extId) + '</button>') +
        dd('Bắt đầu', fmtDT(s.startedAt)) + dd('Kết thúc', fmtDT(s.endedAt)) + dd('Thời lượng chơi', fmtDur(s.gameMs)) +
        dd('Trạng thái', s.status === 'active' ? 'Đang chơi' : esc(REASON[s.endReason] || s.endReason || s.status)) +
        dd('Điểm (server tính)', '<b>' + fmtNum(s.score) + '</b>') + dd('Combo cao nhất', 'x' + s.maxCombo) + dd('Level', s.level) +
        dd('Voucher', esc(AWARD[s.awardStatus] || '—') + (s.tierId ? ' · ' + esc(tierName(s.tierId)) : '')) +
        dd('Thiết bị', esc((DEVICE[s.device] || s.device || '') + ' · ' + (s.os || '') + ' · ' + (s.browser || ''))) + dd('IP', esc(s.ip || '—')) +
        dd('Phiên bản cấu hình', 'v' + s.settingsVersion) + dd('Dữ liệu test', s.test ? 'Có' : 'Không') +
        '</dl>';
      html += '<h3>Chỉ số ván chơi</h3><dl class="dl">' +
        dd('Số lần đập', fmtNum(sum.taps)) + dd('Đập trúng', fmtNum(sum.hits) + ' (' + acc + ')') + dd('Hạ gục', fmtNum(sum.kills)) +
        dd('Vật phẩm xuất hiện', fmtNum(sum.itemsShown)) + dd('Để lọt', fmtNum(sum.escaped)) + dd('Bom xuất hiện / trúng', fmtNum(sum.bombsShown) + ' / ' + fmtNum(sum.bombsHit)) +
        dd('Điểm gốc / thưởng combo', fmtNum(sum.pointsBase) + ' / ' + fmtNum(sum.pointsCombo)) +
        dd('Phản xạ trung vị', sum.reactionMedian ? sum.reactionMedian + ' ms' : '—') + dd('Phản xạ nhanh nhất 10%', sum.reactionP10 ? sum.reactionP10 + ' ms' : '—') +
        dd('Tốc độ đập tối đa', fmtNum(sum.maxTapRate) + ' lần/giây') + dd('Tỷ lệ đồng hồ game/thật', an.ratio !== undefined ? an.ratio : '—') + dd('Số lần đồng bộ', fmtNum(s.syncs)) +
        '</dl>';
      html += '<h3>Phân tích chống gian lận</h3>' + (an.flags && an.flags.length ? '<ul>' + an.flags.map(function (f) { return '<li><b>' + esc(FLAG[f.code] || f.code) + '</b> — ' + esc(FLAG[f.detail] || f.detail || '') + '</li>'; }).join('') + '</ul>' : '<p class="hint">Không phát hiện bất thường.</p>') +
        (an.info && an.info.length ? '<p class="hint">Ghi chú: ' + an.info.map(function (f) { return esc((FLAG[f.code] || f.code) + ' (' + (f.detail || '') + ')'); }).join(', ') + '</p>' : '');
      if (sum.killsByType) {
        var names = { pumpkin: 'Bí ngô', pumpkinCloth: 'Bí nón vải', pumpkinIron: 'Bí nón sắt', ghost: 'Ma', virus: 'Virus', potion: 'Nồi thuốc độc', candy: 'Kẹo' };
        html += '<h3>Vật phẩm đã hạ</h3>' + tableHtml(['Loại', 'Số lượng'], Object.keys(sum.killsByType).map(function (k) { return [names[k] || k, fmtNum(sum.killsByType[k])]; }));
      }
      body.innerHTML = html;
      $('ses-player').addEventListener('click', function () { openPlayer(s.playerId); });
    }).catch(function (e) { body.innerHTML = '<p class="form-error">' + esc(e.message) + '</p>'; });
  }

  // ================================================================ COUPON
  function pageCoupons() {
    var extra = '<label class="field grow"><span>Tìm mã coupon / ID người chơi</span><input type="search" id="f-q" placeholder="Nhập chính xác mã hoặc ID..."></label>' +
      '<label class="field"><span>Mốc</span><select id="f-tier"><option value="">Tất cả</option>' + S.meta.tiers.filter(function (t) { return t.reward; }).map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.short || t.label) + '</option>'; }).join('') + '</select></label>' +
      '<label class="field"><span>Trạng thái</span><select id="f-status"><option value="">Tất cả</option><option value="issued">Hiệu lực</option><option value="held">Chờ duyệt</option><option value="pending">Đang tạo mã</option><option value="redeemed">Đã dùng</option><option value="revoked">Đã thu hồi</option></select></label>' +
      (can('manager') ? '<button class="btn btn-sm" type="button" id="btn-export">Xuất CSV</button><button class="btn btn-sm" type="button" id="btn-bulk">Nhập mã đã dùng</button>' : '');
    var poolHtml = '<section class="card" id="pool-card"><div class="card-head"><div><h2>Kho mã coupon</h2><p>Dùng khi nguồn mã = "Kho mã nhập sẵn": hệ thống lấy lần lượt từng mã cho người đạt mốc</p></div>' +
      (can('manager') ? '<div class="card-tools"><button class="btn btn-sm" type="button" id="btn-pool">Nhập mã vào kho</button></div>' : '') + '</div><div id="pool-body"></div></section>';
    var lp = listPage({
      id: 'coupons', endpoint: 'api/admin/coupons', defaultSort: 'created_at', exportKind: 'coupons', filtersHtml: extra,
      params: function () { return '&q=' + encodeURIComponent($('f-q').value.trim()) + '&tier=' + encodeURIComponent($('f-tier').value) + '&status=' + $('f-status').value; },
      bindFilters: function (reload) {
        $('f-q').addEventListener('input', debounce(reload, 400));
        ['f-tier', 'f-status'].forEach(function (id) { $(id).addEventListener('change', reload); });
      },
      columns: [
        { key: 'id', label: '#', num: true },
        { key: 'extId', label: 'Người chơi', render: function (r) { return '<button class="btn-link" type="button" data-player="' + r.playerId + '">' + esc(r.extId) + '</button>' + (r.test ? ' <span class="tag">test</span>' : ''); } },
        { key: 'tierId', label: 'Mốc', sort: 'tier_id', render: function (r) { return esc(tierName(r.tierId)); } },
        { key: 'code', label: 'Mã', render: function (r) { return '<span class="nowrap">' + codeCell(r) + '</span>'; } },
        { key: 'status', label: 'Trạng thái', sort: 'status', render: function (r) { return statusTag(r.displayStatus); } },
        { key: 'createdAt', label: 'Ngày cấp', sort: 'created_at', render: function (r) { return '<span class="nowrap">' + fmtDT(r.createdAt) + '</span>'; } },
        { key: 'revealedAt', label: 'Xem / copy', render: function (r) { return (r.revealedAt ? '<span class="tag info">Đã xem</span> ' : '') + (r.copiedAt ? '<span class="tag info">Đã copy</span>' : '') || '<span class="hint">—</span>'; } },
        { key: 'redeemedAt', label: 'Đã dùng', sort: 'redeemed_at', render: function (r) { return r.redeemedAt ? fmtDT(r.redeemedAt) + (r.redeemRef ? '<br><span class="hint">' + esc(r.redeemRef) + '</span>' : '') : '<span class="hint">—</span>'; } },
        { key: 'act', label: '', render: function (r) { return can('manager') ? couponActionButtons(r) : ''; } }
      ],
      afterRender: function (box) {
        bindCouponActions(box, function () { lp.reload(); });
        Array.prototype.forEach.call(box.querySelectorAll('[data-player]'), function (b) { b.addEventListener('click', function () { openPlayer(b.getAttribute('data-player')); }); });
      }
    });
    S.reloadList = lp.reload;
    view.insertAdjacentHTML('beforeend', poolHtml);
    loadPool();
    if ($('btn-pool')) $('btn-pool').addEventListener('click', function () {
      dialog({
        title: 'Nhập mã vào kho', text: 'Dán danh sách mã (mỗi dòng 1 mã, hoặc phân cách bằng dấu phẩy). Mã trùng sẽ được bỏ qua. Mã được mã hoá khi lưu.',
        fields: [
          { name: 'tierId', label: 'Mốc voucher', type: 'select', options: S.meta.tiers.filter(function (t) { return t.reward; }).map(function (t) { return [t.id, t.short || t.label]; }) },
          { name: 'codes', label: 'Danh sách mã', type: 'textarea', rows: 8 }
        ],
        confirm: 'Nhập kho',
        onSubmit: function (v) { return api('POST', 'api/admin/pool/import', v).then(function (r) { toast('Đã thêm ' + r.added + ' mã · trùng ' + r.dup + ' · sai định dạng ' + r.bad); loadPool(); }); }
      });
    });
    if ($('btn-bulk')) $('btn-bulk').addEventListener('click', function () {
      dialog({
        title: 'Nhập danh sách coupon đã sử dụng', text: 'Dùng khi hệ thống billing chưa gọi webhook tự động: dán danh sách mã đã được dùng để tính conversion.',
        fields: [{ name: 'codes', label: 'Danh sách mã', type: 'textarea', rows: 8 }, { name: 'ref', label: 'Ghi chú / nguồn (tuỳ chọn)', placeholder: 'vd: Báo cáo billing 31/10' }],
        confirm: 'Cập nhật',
        onSubmit: function (v) { return api('POST', 'api/admin/coupons/redeem-bulk', v).then(function (r) { toast('Đã đánh dấu ' + r.ok + ' mã · không tìm thấy ' + r.notFound + ' · bỏ qua ' + r.skipped); lp.reload(); }); }
      });
    });
  }
  function loadPool() {
    api('GET', 'api/admin/pool').then(function (d) {
      var rows = S.meta.tiers.filter(function (t) { return t.reward; }).map(function (t) {
        var p = d.pool.find(function (x) { return x.tier_id === t.id; }) || { total: 0, free: 0 };
        return [t.short || t.label, fmtNum(p.total), fmtNum(p.free), fmtNum(p.total - p.free)];
      });
      $('pool-body').innerHTML = (S.meta.coupons.provider !== 'pool' ? '<p class="hint">Nguồn mã hiện tại: <b>' + esc(S.meta.coupons.provider) + '</b>. Kho mã chỉ được dùng khi chọn "Kho mã nhập sẵn" trong Cấu hình.</p>' : '') +
        tableHtml(['Mốc', 'Tổng mã', 'Còn trống', 'Đã cấp'], rows);
    }).catch(function () {});
  }

  // ================================================================ CẤU HÌNH
  function isDirty() { return S.draft && S.settings && JSON.stringify(S.draft) !== JSON.stringify(S.settings); }

  function getPath(obj, path) { return path.split('.').reduce(function (o, k) { return o === undefined || o === null ? undefined : o[k]; }, obj); }
  function setPath(obj, path, val) {
    var ks = path.split('.'), o = obj;
    for (var i = 0; i < ks.length - 1; i++) o = o[ks[i]];
    o[ks[ks.length - 1]] = val;
  }

  function pageSettings() {
    view.innerHTML = '<p class="hint">Đang tải cấu hình...</p>';
    api('GET', 'api/admin/settings').then(function (d) {
      S.settings = d.settings; S.settingsVersion = d.version; S.presets = d.presets; S.history = d.history; S.couponApi = d.env.couponApi;
      if (!S.draft || !isDirtyAgainst(d.settings)) S.draft = clone(d.settings);
      renderSettings();
    }).catch(function (e) { view.innerHTML = '<p class="form-error">' + esc(e.message) + '</p>'; });
  }
  function isDirtyAgainst(s) { return S.draft && JSON.stringify(S.draft) !== JSON.stringify(s); }

  function inp(path, label, type, opts) {
    opts = opts || {};
    var v = getPath(S.draft, path);
    var dis = can('manager') ? '' : ' disabled';
    var attrs = ' data-path="' + path + '" data-type="' + type + '"' + dis;
    var control;
    if (type === 'bool') return '<label class="check' + (opts.wide ? ' wide' : '') + '"><input type="checkbox"' + attrs + (v ? ' checked' : '') + '> ' + esc(label) + (opts.hint ? ' <span class="hint">— ' + esc(opts.hint) + '</span>' : '') + '</label>';
    if (type === 'dt') control = '<input type="datetime-local"' + attrs + ' value="' + esc(toLocalInput(v)) + '">';
    else if (type === 'lines') control = '<textarea' + attrs + ' rows="' + (opts.rows || 4) + '">' + esc((v || []).join('\n')) + '</textarea>';
    else if (type === 'select') control = '<select' + attrs + '>' + opts.options.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(v) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select>';
    else control = '<input type="' + (type === 'int' || type === 'num' ? 'number' : (type === 'url' ? 'url' : 'text')) + '"' + attrs + ' value="' + esc(v === undefined || v === null ? '' : v) + '"' +
      (opts.min !== undefined ? ' min="' + opts.min + '"' : '') + (opts.max !== undefined ? ' max="' + opts.max + '"' : '') + (opts.step ? ' step="' + opts.step + '"' : (type === 'num' ? ' step="any"' : '')) + '>';
    return '<label class="field' + (opts.wide ? ' wide' : '') + '"><span>' + esc(label) + '</span>' + control + (opts.hint ? '<small>' + esc(opts.hint) + '</small>' : '') + '</label>';
  }

  function section(id, title, desc, inner) {
    return '<section class="card form-section" id="sec-' + id + '"><div class="card-head"><div><h2>' + esc(title) + '</h2>' + (desc ? '<p>' + esc(desc) + '</p>' : '') + '</div></div>' + inner + '</section>';
  }

  var ITEM_NAMES = { pumpkin: 'Bí thường', pumpkinCloth: 'Bí nón vải (2 đập)', pumpkinIron: 'Bí nón sắt (3 đập)', ghost: 'Ma', virus: 'Virus', potion: 'Nồi thuốc độc', candy: 'Kẹo', bomb: 'Bom', boss: 'Boss khổng lồ', bossArmor: 'Boss giáp sắt' };

  function renderSettings() {
    var d = S.draft, man = can('manager');
    var html = '<div class="settings-layout"><div class="form-section">';
    html += section('campaign', 'Chiến dịch', 'Thời gian tính theo giờ Việt Nam (UTC+7)', '<div class="form-grid">' +
      inp('campaign.name', 'Tên chiến dịch', 'str') + inp('campaign.title', 'Tiêu đề trên game', 'str') + inp('campaign.subtitle', 'Dòng phụ', 'str', { wide: true }) +
      inp('campaign.start', 'Bắt đầu', 'dt') + inp('campaign.end', 'Kết thúc', 'dt') + inp('campaign.periodText', 'Thời gian hiển thị trong Hướng dẫn', 'str', { hint: 'vd: 26/10 – 31/10/2026' }) + inp('campaign.portalUrl', 'Link Portal (khi chưa đăng nhập)', 'url') +
      inp('campaign.testMode', 'Chế độ test: cho phép chơi ngoài thời gian chương trình', 'bool', { wide: true, hint: 'dữ liệu chơi ngoài thời gian được gắn cờ test' }) +
      inp('campaign.maintenance', 'Tạm khoá game (bảo trì)', 'bool', { wide: true }) + inp('campaign.maintenanceMessage', 'Thông báo bảo trì', 'str', { wide: true }) + '</div>');
    html += section('turns', 'Lượt chơi', 'Lượt và quyền nhận coupon chỉ được tính ở máy chủ', '<div class="form-grid">' +
      inp('turns.max', 'Số lượt tối đa', 'int', { min: 1, max: 50 }) + inp('turns.regenMinutes', 'Thời gian hồi 1 lượt (phút)', 'num', { min: 0.5 }) + inp('turns.maxSeconds', 'Thời gian tối đa mỗi lượt (giây)', 'int', { min: 0, max: 3600, hint: '300 = 5 phút; 0 = không giới hạn' }) +
      inp('bombs.strikes', 'Số lần trúng bom thì thua', 'int', { min: 1, max: 10 }) + '</div>');
    html += section('bombs', 'Bom hoá trang', 'Bom đội mũ để người chơi dễ nhầm với bí. Level tính theo "Mỗi level kéo dài" ở mục Độ khó.', '<div class="form-grid">' +
      inp('bombs.disguiseLevel', 'Từ level xuất hiện bom đội nón vải / nón sắt', 'int', { min: 1, max: 99 }) +
      inp('bombs.disguiseLevel2', 'Từ level xuất hiện thêm bom giả nồi thuốc độc', 'int', { min: 1, max: 99 }) +
      inp('bombs.disguisePct', 'Tỷ lệ bom được hoá trang (%)', 'int', { min: 0, max: 100, hint: 'trong tổng số bom xuất hiện' }) + '</div>');
    var bossRows = ['boss', 'bossArmor'].map(function (k) {
      return '<tr><td>' + esc(ITEM_NAMES[k]) + '</td><td><input type="text" data-path="items.' + k + '.label" data-type="str" value="' + esc(d.items[k].label) + '"' + (man ? '' : ' disabled') + '></td>' +
        '<td><input type="number" min="0" data-path="items.' + k + '.points" data-type="int" value="' + esc(d.items[k].points) + '"' + (man ? '' : ' disabled') + '></td>' +
        '<td><input type="number" min="1" max="10" data-path="items.' + k + '.hp" data-type="int" value="' + esc(d.items[k].hp) + '"' + (man ? '' : ' disabled') + '></td></tr>';
    }).join('');
    html += section('boss', 'Boss', 'Boss xuất hiện xen kẽ: boss bí khổng lồ trước, rồi boss giáp sắt, lặp lại theo chu kỳ level. Số lần đập tối đa 10.',
      '<div class="form-grid">' + inp('boss.enabled', 'Bật boss', 'bool', { wide: true }) +
      inp('boss.firstLevel', 'Boss đầu tiên ở level', 'int', { min: 2, max: 99 }) + inp('boss.everyLevels', 'Sau đó cứ mỗi (level) lại có 1 boss', 'int', { min: 1, max: 50 }) + '</div>' +
      '<div class="table-wrap"><table class="t item-table"><thead><tr><th>Boss</th><th>Tên hiển thị</th><th>Điểm</th><th>Số lần đập</th></tr></thead><tbody>' + bossRows + '</tbody></table></div>');
    var bonus = d.combo.bonus;
    var bonusInputs = '';
    for (var i = 2; i < bonus.length; i++) bonusInputs += inp('combo.bonus.' + i, 'Combo x' + i + (i === bonus.length - 1 ? ' trở lên' : ''), 'int', { min: 0 });
    html += section('combo', 'Combo', 'Chuỗi bị ngắt nếu khoảng cách giữa 2 cú đập trúng lớn hơn thời gian combo', '<div class="form-grid">' +
      inp('combo.windowMs', 'Thời gian giữ combo (ms)', 'int', { min: 300, max: 10000, hint: '1500 = 1,5 giây' }) + bonusInputs +
      inp('combo.hammer.0', 'Combo nhận Búa Băng Long', 'int', { min: 2, max: 99 }) + inp('combo.hammer.1', 'Combo nhận Búa Hỏa Long', 'int', { min: 2, max: 99 }) + inp('combo.hammer.2', 'Combo nhận Búa Kim Cang', 'int', { min: 2, max: 99 }) +
      inp('combo.hammerBonus.0', 'Búa Băng Long: cộng thêm (% điểm vật phẩm)', 'int', { min: 0, max: 500 }) + inp('combo.hammerBonus.1', 'Búa Hỏa Long: cộng thêm (%)', 'int', { min: 0, max: 500 }) + inp('combo.hammerBonus.2', 'Búa Kim Cang: cộng thêm (%)', 'int', { min: 0, max: 500 }) +
      (man ? '<div class="field"><span>Số mức thưởng</span><div class="actions-row"><button class="btn btn-sm" type="button" id="cb-add">+ Thêm mức</button><button class="btn btn-sm" type="button" id="cb-del"' + (bonus.length <= 3 ? ' disabled' : '') + '>− Bớt mức</button></div></div>' : '') + '</div>');
    var itemRows = ['pumpkin', 'pumpkinCloth', 'pumpkinIron', 'ghost', 'virus', 'potion', 'candy'].map(function (k) {
      return '<tr><td><label class="check"><input type="checkbox" data-path="items.' + k + '.enabled" data-type="bool"' + (d.items[k].enabled ? ' checked' : '') + (man ? '' : ' disabled') + '> ' + esc(ITEM_NAMES[k]) + '</label></td>' +
        '<td><input type="text" data-path="items.' + k + '.label" data-type="str" value="' + esc(d.items[k].label) + '"' + (man ? '' : ' disabled') + '></td>' +
        ['points', 'hp', 'weight', 'weightEnd'].map(function (f) { return '<td><input type="number" min="0" data-path="items.' + k + '.' + f + '" data-type="int" value="' + esc(d.items[k][f]) + '"' + (man ? '' : ' disabled') + '></td>'; }).join('') +
        '<td class="num" data-share="' + k + '"></td></tr>';
    }).join('');
    html += section('items', 'Vật phẩm', 'Tỷ lệ xuất hiện là trọng số tương đối; thay đổi dần từ "đầu game" sang "cuối game" theo độ khó', '<div class="table-wrap"><table class="t item-table"><thead><tr><th>Bật</th><th>Tên hiển thị</th><th>Điểm</th><th>Số lần đập</th><th>Tỷ lệ đầu</th><th>Tỷ lệ cuối</th><th class="num">% đầu → cuối</th></tr></thead><tbody>' + itemRows +
      '<tr><td><label class="check"><input type="checkbox" data-path="items.bomb.enabled" data-type="bool"' + (d.items.bomb.enabled ? ' checked' : '') + (man ? '' : ' disabled') + '> Bom</label></td><td><input type="text" data-path="items.bomb.label" data-type="str" value="' + esc(d.items.bomb.label) + '"' + (man ? '' : ' disabled') + '></td><td colspan="5" class="hint">Tỷ lệ bom chỉnh ở mục Độ khó</td></tr>' +
      '</tbody></table></div>');
    var D = d.difficulty;
    html += section('difficulty', 'Độ khó', 'Tăng dần theo thời gian chơi (đường cong mượt). Sau giai đoạn tăng tốc, bom tiếp tục dày thêm từng nấc để ván chơi không kéo dài vô hạn.',
      '<div class="form-grid">' + inp('difficulty.preset', 'Mức có sẵn', 'select', { options: [['easy', 'Dễ'], ['normal', 'Thường'], ['hard', 'Khó'], ['custom', 'Tuỳ chỉnh']] }) +
      inp('difficulty.rampSeconds', 'Thời gian tăng tốc tới mức khó nhất (giây)', 'int') + inp('difficulty.levelSeconds', 'Mỗi level kéo dài (giây)', 'int') +
      inp('difficulty.spawnIntervalStart', 'Khoảng cách xuất hiện lúc đầu (ms)', 'int') + inp('difficulty.spawnIntervalEnd', 'Khoảng cách xuất hiện lúc khó nhất (ms)', 'int') +
      inp('difficulty.upTimeStart', 'Thời gian nổi lúc đầu (ms)', 'int') + inp('difficulty.upTimeEnd', 'Thời gian nổi lúc khó nhất (ms)', 'int') +
      inp('difficulty.maxActiveStart', 'Tối đa cùng lúc (đầu)', 'int', { min: 1, max: 9 }) + inp('difficulty.maxActiveEnd', 'Tối đa cùng lúc (khó nhất)', 'int', { min: 1, max: 9 }) +
      inp('difficulty.bombRateStart', 'Tỷ lệ bom đầu (%)', 'num') + inp('difficulty.bombRateEnd', 'Tỷ lệ bom khó nhất (%)', 'num') + inp('difficulty.bombRateCap', 'Tỷ lệ bom tối đa khi kéo dài (%)', 'num') +
      inp('difficulty.overtimeEverySeconds', 'Sau đó, tăng bom mỗi (giây)', 'int') + inp('difficulty.overtimeBombStep', 'Mỗi nấc tăng thêm (%)', 'num') +
      inp('difficulty.bombGraceSeconds', 'Không có bom trong (giây đầu)', 'int') + inp('difficulty.firstSpawnMs', 'Vật phẩm đầu tiên sau (ms)', 'int') +
      inp('difficulty.jitterPct', 'Độ ngẫu nhiên nhịp xuất hiện (%)', 'int') + inp('difficulty.graceMs', 'Bù trễ khi đập (ms)', 'int', { hint: 'cho phép đập trúng muộn một chút' }) +
      inp('difficulty.hitHoldMs', 'Giữ lại sau mỗi cú đập trúng (ms)', 'int', { min: 200, max: 3000, hint: 'mọi vật phẩm nổi lên bằng nhau; bí nhiều máu chỉ được giữ thêm khi đã bị đập' }) +
      inp('difficulty.bombLingerPct', 'Bom nổi lâu hơn ở cuối game (%)', 'int', { min: 0, max: 100, hint: 'tăng dần từ 0 tới mức này' }) +
      inp('difficulty.burstChanceStart', 'Tỷ lệ hiện nhiều ô cùng lúc — đầu (%)', 'int', { min: 0, max: 100 }) + inp('difficulty.burstChanceEnd', 'Tỷ lệ hiện nhiều ô cùng lúc — khó nhất (%)', 'int', { min: 0, max: 100 }) +
      inp('difficulty.burstMaxStart', 'Số ô cùng lúc tối đa — đầu', 'int', { min: 2, max: 6 }) + inp('difficulty.burstMaxEnd', 'Số ô cùng lúc tối đa — khó nhất', 'int', { min: 2, max: 6 }) +
      inp('difficulty.rushFirstSeconds', 'Đợt tràn đồng 9 ô đầu tiên sau (giây)', 'int', { min: 1, max: 600 }) + inp('difficulty.rushEverySeconds', 'Sau đó cứ mỗi (giây) lại tràn đồng', 'int', { min: 0, max: 600, hint: '0 = tắt' }) +
      inp('difficulty.rushBombMax', 'Số bom tối đa trong 1 đợt tràn đồng', 'int', { min: 0, max: 4 }) +
      '</div><div class="grid-2" id="diff-preview"></div><p class="hint">Xem tỷ lệ người chơi đạt từng mốc với cấu hình đang soạn tại mục <a href="#/simulate">Mô phỏng độ khó</a>.</p>');
    var tiersHtml = d.tiers.map(function (t, idx) {
      var p = 'tiers.' + idx + '.';
      return '<div class="tier-row"><div class="tier-row-head"><b>' + esc(t.label || t.id) + '</b>' + (man ? '<button class="btn btn-sm btn-ghost" type="button" data-del-tier="' + idx + '">Xoá mốc</button>' : '') + '</div>' +
        inp(p + 'id', 'Mã mốc', 'str', { hint: 'không đổi sau khi đã chạy' }) + inp(p + 'score', 'Điểm tối thiểu', 'int') + inp(p + 'enabled', 'Bật', 'bool') + inp(p + 'reward', 'Có voucher', 'bool') +
        inp(p + 'label', 'Tên voucher', 'str') + inp(p + 'short', 'Tên ngắn', 'str') + inp(p + 'product', 'Dịch vụ áp dụng', 'str') + inp(p + 'discount', 'Giảm (%)', 'int', { min: 0, max: 100 }) +
        inp(p + 'prefix', 'Tiền tố mã (mock)', 'str') + inp(p + 'quota', 'Hạn mức phát hành (0 = không giới hạn)', 'int', { min: 0 }) +
        inp(p + 'url', 'URL trang đăng ký dịch vụ', 'url', { wide: true, hint: 'Nút "Đăng ký ngay" mở link này (tự thêm UTM nếu bật)' }) + '</div>';
    }).join('');
    html += section('tiers', 'Mốc điểm & voucher', 'Mỗi lượt chơi nhận voucher của mốc cao nhất đạt được (trừ khi đã sở hữu)', '<div class="form-section">' + tiersHtml +
      (man ? '<div><button class="btn btn-sm" type="button" id="tier-add">+ Thêm mốc</button></div>' : '') + '</div>');
    html += section('coupons', 'Coupon', 'Hạn dùng, nguồn mã và quy tắc cấp', '<div class="form-grid">' +
      inp('coupons.expiresAt', 'Hạn sử dụng coupon', 'dt') +
      inp('coupons.provider', 'Nguồn mã coupon', 'select', { options: [['mock', 'Mã giả lập (chạy thử)'], ['pool', 'Kho mã nhập sẵn'], ['http', 'API hệ thống billing' + (S.couponApi ? '' : ' (chưa cấu hình .env)')]] }) +
      inp('coupons.maxPerTierPerPlayer', 'Số voucher tối đa / mốc / người', 'int', { min: 0, hint: '0 = không giới hạn (đạt mốc là nhận)' }) +
      inp('coupons.codeParam', 'Tham số gắn mã vào URL đăng ký', 'str', { hint: 'vd: coupon → ?coupon=MÃ (để trống nếu không dùng)' }) +
      inp('coupons.fallbackToLowerTier', 'Nếu đã có voucher mốc cao nhất, tự cấp voucher mốc thấp hơn chưa có', 'bool', { wide: true }) +
      inp('coupons.holdSuspicious', 'Giữ coupon chờ duyệt khi lượt chơi bị nghi gian lận', 'bool', { wide: true }) +
      inp('coupons.utm', 'Tự thêm UTM (utm_source=inet_portal&utm_medium=minigame...) vào link đăng ký', 'bool', { wide: true }) + '</div>');
    html += section('messages', 'Lời chúc & thông báo', 'Mỗi dòng một câu; hệ thống chọn ngẫu nhiên', '<div class="form-grid">' +
      inp('messages.congrats', 'Chúc mừng khi nhận voucher', 'lines', { wide: true, rows: 6 }) + inp('messages.encourage', 'Động viên khi chưa đạt mốc', 'lines', { wide: true }) +
      inp('messages.owned', 'Khi đã sở hữu voucher của mốc', 'lines', { wide: true, rows: 2 }) + inp('messages.gameOver', 'Tiêu đề Game Over', 'lines', { wide: true, rows: 3 }) + '</div>');
    html += section('features', 'Tính năng & chống gian lận', null, '<div class="form-grid">' +
      inp('features.leaderboard', 'Bật bảng vàng (top 10, ẩn bớt ID)', 'bool', { wide: true }) + inp('features.resumeSession', 'Cho phép chơi tiếp lượt dang dở khi tải lại trang', 'bool', { wide: true }) +
      inp('antiCheat.minMedianReactionMs', 'Cảnh báo nếu phản xạ trung vị < (ms)', 'int') + inp('antiCheat.maxTapRate', 'Nghi auto click nếu đập > (lần/giây) và gần như không trượt', 'int') +
      inp('antiCheat.slowClockRatio', 'Cảnh báo nếu đồng hồ game/thật <', 'num', { step: '0.01' }) + inp('antiCheat.abandonMinutes', 'Tự kết thúc lượt bỏ dở sau (phút)', 'int') +
      inp('antiCheat.idleSeconds', 'Tự kết thúc lượt khi không thao tác (giây)', 'int', { min: 0, max: 600, hint: '0 = tắt' }) +
      inp('antiCheat.autoBanAfter', 'Tạm khoá khi gian lận liên tiếp (số lượt)', 'int', { min: 0, max: 100, hint: '0 = không tạm khoá' }) + inp('antiCheat.lockHours', 'Thời gian tạm khoá (giờ)', 'int', { min: 1, max: 720 }) +
      inp('antiCheat.blockSuspicious', 'Chặn ngay lượt có dấu hiệu gian lận / auto click (huỷ điểm, không cấp coupon, báo cho người chơi)', 'bool', { wide: true }) + '</div>');
    html += '</div>';
    // cột phải
    html += '<aside class="settings-nav">' +
      '<section class="card"><div class="card-head"><div><h2>Phiên bản v' + S.settingsVersion + '</h2><p>Lượt đang chơi giữ cấu hình lúc bắt đầu</p></div></div>' +
      (man ? '<label class="field"><span>Ghi chú thay đổi</span><input type="text" id="set-note" maxlength="200" placeholder="vd: Tăng tỷ lệ bom"></label><p class="hint" id="dirty-flag"></p>' +
        '<div class="actions-row" style="margin-top:10px"><button class="btn btn-primary" type="button" id="set-save">Lưu cấu hình</button><button class="btn" type="button" id="set-reset">Hoàn tác</button></div>' +
        '<div class="actions-row" style="margin-top:10px"><button class="btn btn-sm" type="button" id="set-test">Chơi thử (tài khoản test)</button></div>' : '<p class="hint">Tài khoản "Chỉ xem" không thể sửa cấu hình.</p>') +
      '<p class="form-error" id="set-error"></p></section>' +
      '<section class="card"><div class="card-head"><div><h2>Lịch sử thay đổi</h2></div></div><ul class="history">' + S.history.map(function (h) {
        return '<li class="' + (h.version === S.settingsVersion ? 'current' : '') + '"><div><b>v' + h.version + '</b> · ' + esc(h.admin_name || '') + '<small>' + fmtDT(h.created_at) + (h.note ? ' · ' + esc(h.note) : '') + '</small></div>' +
          (man && h.version !== S.settingsVersion ? '<button class="btn btn-sm btn-ghost" type="button" data-restore="' + h.version + '">Khôi phục</button>' : '') + '</li>';
      }).join('') + '</ul></section></aside></div>';
    view.innerHTML = html;
    bindSettings();
    updateShares();
    drawDifficultyPreview();
    updateDirty();
  }

  function bindSettings() {
    Array.prototype.forEach.call(view.querySelectorAll('[data-path]'), function (el) {
      el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', function () {
        var type = el.getAttribute('data-type'), path = el.getAttribute('data-path'), v;
        if (type === 'bool') v = el.checked;
        else if (type === 'int') v = el.value === '' ? '' : Math.round(Number(el.value));
        else if (type === 'num') v = el.value === '' ? '' : Number(el.value);
        else if (type === 'dt') v = fromLocalInput(el.value) || getPath(S.draft, path);
        else if (type === 'lines') v = el.value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        else v = el.value;
        setPath(S.draft, path, v);
        if (path === 'difficulty.preset' && S.presets[v]) {
          Object.assign(S.draft.difficulty, S.presets[v], { preset: v });
          renderSettings();
          return;
        }
        if (path.indexOf('difficulty.') === 0 && path !== 'difficulty.preset' && S.draft.difficulty.preset !== 'custom') {
          S.draft.difficulty.preset = 'custom';
          var sel = view.querySelector('[data-path="difficulty.preset"]');
          if (sel) sel.value = 'custom';
        }
        if (path.indexOf('items.') === 0) updateShares();
        if (path.indexOf('difficulty.') === 0) drawDifficultyPreviewDebounced();
        updateDirty();
      });
    });
    var add = $('cb-add'), del = $('cb-del');
    if (add) add.addEventListener('click', function () { var b = S.draft.combo.bonus; b.push(b[b.length - 1] || 0); renderSettings(); });
    if (del) del.addEventListener('click', function () { if (S.draft.combo.bonus.length > 3) { S.draft.combo.bonus.pop(); renderSettings(); } });
    var ta = $('tier-add');
    if (ta) ta.addEventListener('click', function () {
      var max = S.draft.tiers.reduce(function (m, t) { return Math.max(m, t.score); }, 0);
      S.draft.tiers.push({ id: 'tier' + (S.draft.tiers.length + 1), score: max + 250, enabled: true, reward: true, label: 'Voucher mới', short: 'Mới', product: '', discount: 10, url: '', prefix: 'HLW', quota: 0 });
      renderSettings();
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-del-tier]'), function (b) {
      b.addEventListener('click', function () {
        var idx = +b.getAttribute('data-del-tier');
        confirmBox('Xoá mốc "' + (S.draft.tiers[idx].label || '') + '"?', 'Coupon đã cấp của mốc này vẫn được giữ. Thay đổi chỉ có hiệu lực sau khi bấm Lưu.', function () { S.draft.tiers.splice(idx, 1); renderSettings(); });
      });
    });
    var save = $('set-save');
    if (save) save.addEventListener('click', function () {
      $('set-error').textContent = '';
      save.classList.add('is-loading');
      api('PUT', 'api/admin/settings', { settings: S.draft, note: $('set-note').value }).then(function (r) {
        save.classList.remove('is-loading');
        toast('Đã lưu cấu hình v' + r.version, 'good');
        S.draft = null;
        return api('GET', 'api/admin/overview-meta').then(function (m) { S.meta = m; paintTop(); pageSettings(); });
      }).catch(function (e) {
        save.classList.remove('is-loading');
        $('set-error').textContent = e.data && e.data.errors ? e.data.errors.join(' ') : e.message;
      });
    });
    var reset = $('set-reset');
    if (reset) reset.addEventListener('click', function () { S.draft = clone(S.settings); renderSettings(); });
    var test = $('set-test');
    if (test) test.addEventListener('click', function () {
      var w = window.open('about:blank', '_blank');
      api('POST', 'api/admin/test-token', {}).then(function (r) {
        if (w) { w.opener = null; w.location = location.origin + r.url; } else window.location.href = r.url;
        toast('Đã mở game bằng tài khoản test ' + r.player + (isDirty() ? ' (lưu ý: thay đổi chưa lưu sẽ chưa áp dụng)' : ''));
      }).catch(function (e) { if (w) w.close(); toast(e.message, 'bad'); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('[data-restore]'), function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-restore');
        confirmBox('Khôi phục cấu hình v' + v + '?', 'Hệ thống tạo một phiên bản mới với nội dung của v' + v + '.', function () {
          return api('POST', 'api/admin/settings/restore/' + v, {}).then(function (r) {
            toast('Đã khôi phục thành v' + r.version, 'good');
            S.draft = null;
            return api('GET', 'api/admin/overview-meta').then(function (m) { S.meta = m; paintTop(); pageSettings(); });
          });
        });
      });
    });
  }

  function updateDirty() {
    var f = $('dirty-flag');
    if (f) { f.textContent = isDirty() ? 'Có thay đổi chưa lưu' : 'Không có thay đổi'; f.className = 'hint' + (isDirty() ? ' dirty' : ''); }
  }

  function updateShares() {
    var keys = ['pumpkin', 'pumpkinCloth', 'pumpkinIron', 'ghost', 'virus', 'potion', 'candy'];
    var it = S.draft.items;
    var t0 = 0, t1 = 0;
    keys.forEach(function (k) { if (it[k].enabled) { t0 += Number(it[k].weight) || 0; t1 += Number(it[k].weightEnd) || 0; } });
    keys.forEach(function (k) {
      var cell = view.querySelector('[data-share="' + k + '"]');
      if (!cell) return;
      if (!it[k].enabled) { cell.textContent = 'tắt'; return; }
      cell.textContent = (t0 ? Math.round(100 * (Number(it[k].weight) || 0) / t0) : 0) + '% → ' + (t1 ? Math.round(100 * (Number(it[k].weightEnd) || 0) / t1) : 0) + '%';
    });
  }

  function curveData(cfg, maxS) {
    var xs = [], iv = [], up = [], act = [], bomb = [];
    for (var s = 0; s <= maxS; s += 5) {
      var D = Engine.difficultyAt(cfg, s * 1000);
      xs.push(s); iv.push(D.interval); up.push(D.upTime); act.push(D.maxActive); bomb.push(D.bombPermille / 10);
    }
    return { xs: xs, iv: iv, up: up, act: act, bomb: bomb };
  }
  function safeCfg() {
    var d = clone(S.draft.difficulty);
    Object.keys(d).forEach(function (k) { if (k !== 'preset') d[k] = Number(d[k]) || 0; });
    var idle = Number(S.draft.antiCheat && S.draft.antiCheat.idleSeconds) || 0;
    return { difficulty: d, items: S.draft.items, combo: S.draft.combo, bombs: S.draft.bombs, boss: S.draft.boss, rules: { idleMs: idle > 0 ? idle * 1000 : 0 } };
  }
  function drawDifficultyPreview() {
    var box = $('diff-preview');
    if (!box) return;
    box.innerHTML = '<div><div class="hint">Khoảng cách giữa 2 lần xuất hiện (ms)</div><div id="dp-1"></div></div><div><div class="hint">Thời gian vật phẩm nổi (ms)</div><div id="dp-2"></div></div>' +
      '<div><div class="hint">Số vật phẩm tối đa cùng lúc</div><div id="dp-3"></div></div><div><div class="hint">Tỷ lệ bom (%)</div><div id="dp-4"></div></div>';
    var c = curveData(safeCfg(), 300);
    Charts.line($('dp-1'), { x: c.xs, values: c.iv, unit: 'ms' });
    Charts.line($('dp-2'), { x: c.xs, values: c.up, unit: 'ms', color: 'var(--s3)' });
    Charts.line($('dp-3'), { x: c.xs, values: c.act, color: 'var(--s7)', minMax: 6 });
    Charts.line($('dp-4'), { x: c.xs, values: c.bomb, unit: '%', color: 'var(--s8)', minMax: 50 });
  }
  var drawDifficultyPreviewDebounced = debounce(drawDifficultyPreview, 250);

  // ================================================================ MÔ PHỎNG
  function pageSimulate() {
    if (!S.settings) { view.innerHTML = '<p class="hint">Đang tải cấu hình...</p>'; api('GET', 'api/admin/settings').then(function (d) { S.settings = d.settings; S.settingsVersion = d.version; S.presets = d.presets; S.history = d.history; S.couponApi = d.env.couponApi; if (S.route === 'simulate') pageSimulate(); }).catch(function (e) { toast(e.message, 'bad'); }); return; }
    var usingDraft = S.draft && isDirty();
    view.innerHTML = '<section class="card prose"><div class="card-head"><div><h2>Mô phỏng độ khó</h2><p>Ước lượng bằng người chơi giả lập trên chính bộ máy game — dùng để so sánh khi chỉnh thông số</p></div>' +
      '<div class="card-tools"><label class="field"><span>Số ván / nhóm</span><select id="sim-n"><option>200</option><option selected>400</option><option>800</option></select></label><button class="btn btn-primary" type="button" id="sim-run">Chạy mô phỏng</button></div></div>' +
      '<p>Cấu hình dùng để mô phỏng: <b>' + (usingDraft ? 'bản đang soạn (chưa lưu)' : 'bản đang áp dụng v' + (S.settingsVersion || '')) + '</b>. ' +
      'Ba nhóm người chơi giả lập có phản xạ, độ chính xác và xác suất lỡ tay đập bom khác nhau. Đây là <b>ước lượng tương đối</b> — hãy đối chiếu với số liệu thật ở trang Tổng quan sau khi cho người thật chơi thử.</p>' +
      '<div id="sim-out"></div></section><section class="card"><div class="card-head"><div><h2>Đường cong độ khó</h2><p>Theo thời gian chơi (giây)</p></div></div><div class="grid-2" id="diff-preview"></div></section>';
    var ensure = S.settings ? Promise.resolve() : api('GET', 'api/admin/settings').then(function (d) { S.settings = d.settings; S.settingsVersion = d.version; S.presets = d.presets; S.history = d.history; });
    ensure.then(function () {
      if (!S.draft) S.draft = clone(S.settings);
      drawDifficultyPreview();
      $('sim-run').addEventListener('click', runSimulation);
      runSimulation();
    });
  }

  function runSimulation() {
    var btn = $('sim-run'), out = $('sim-out');
    if (!btn) return;
    btn.classList.add('is-loading');
    var cfg = safeCfg();
    var n = Number($('sim-n').value);
    var tiers = S.draft.tiers.filter(function (t) { return t.enabled; }).sort(function (a, b) { return a.score - b.score; });
    var th = tiers.map(function (t) { return Number(t.score); });
    var keys = Object.keys(Engine.PROFILES), results = {};
    var i = 0;
    function next() {
      if (i >= keys.length) { btn.classList.remove('is-loading'); paint(); return; }
      var k = keys[i++];
      results[k] = Engine.simulate(cfg, Engine.PROFILES[k], n, { thresholds: th, seed: 20261026 });
      setTimeout(next, 10);
    }
    function paint() {
      var head = '<tr><th>Nhóm người chơi</th><th class="num">Điểm TB</th><th class="num">Trung vị</th><th class="num">Top 10%</th><th class="num">Thời lượng TB*</th>' +
        tiers.map(function (t) { return '<th class="num">Đạt ' + t.score + '</th>'; }).join('') + '</tr>';
      var rows = keys.map(function (k) {
        var r = results[k];
        return '<tr><td><b>' + esc(Engine.PROFILES[k].label) + '</b></td><td class="num">' + fmtNum(r.mean) + '</td><td class="num">' + fmtNum(r.median) + '</td><td class="num">' + fmtNum(r.p90) +
          '</td><td class="num">' + fmtDur(r.medianDuration) + '</td>' + r.reach.map(function (x) { return '<td class="num">' + fmtPct(x.rate) + (x.medianTime ? '<br><span class="hint">sau ' + fmtDur(x.medianTime) + '</span>' : '') + '</td>'; }).join('') + '</tr>';
      }).join('');
      out.innerHTML = '<div class="table-wrap"><table class="t sim-table"><thead>' + head + '</thead><tbody>' + rows + '</tbody></table></div>' +
        '<p class="hint">* trung vị thời lượng một ván. "Đạt X" = tỷ lệ ván chơi chạm mốc X (nếu chơi tới khi trúng bom), kèm thời điểm trung vị chạm mốc. Thực tế người chơi có thể dừng sớm để chọn voucher.</p>';
    }
    setTimeout(next, 20);
  }

  // ================================================================ TÍCH HỢP PORTAL
  function pageIntegration() {
    var origin = location.origin;
    view.innerHTML = '<section class="card prose"><div class="card-head"><div><h2>Nhúng game vào Portal iNET</h2><p>Chi tiết đầy đủ trong docs/TICH-HOP-PORTAL.md</p></div></div>' +
      '<h3>1. Portal sinh token đăng nhập (phía server của Portal)</h3>' +
      '<p>Token là JWT ký HS256 bằng <code class="code">PORTAL_JWT_SECRET</code> (chỉ Portal backend và game server biết). Nội dung tối thiểu:</p>' +
      '<pre class="snippet">{ "sub": "&lt;mã khách hàng&gt;", "iat": &lt;unix giây&gt;, "exp": &lt;iat + 600&gt;, "jti": "&lt;chuỗi ngẫu nhiên&gt;" }</pre>' +
      '<p>Không đưa tên/email vào token — chỉ cần mã khách hàng. <code class="code">jti</code> giúp chống dùng lại token (mỗi token dùng 1 lần).</p>' +
      '<h3>2. Gắn iframe</h3><pre class="snippet">&lt;iframe src="' + esc(origin) + '/#token=JWT_VUA_SINH"\n        allow="clipboard-write; autoplay; fullscreen"\n        style="width:100%;height:100vh;border:0"\n        title="Halloween iNET 2026"&gt;&lt;/iframe&gt;</pre>' +
      '<p>Đặt token sau dấu <b>#</b> để token không bị gửi kèm request hay ghi vào log. Nếu iframe dùng <code class="code">sandbox</code>, cần thêm: <code class="code">allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox</code>.</p>' +
      '<h3>3. Cấu hình phía game (.env)</h3><pre class="snippet">PORTAL_JWT_SECRET=...        # trùng với Portal\nPORTAL_ORIGINS=https://portal.inet.vn   # chỉ Portal được nhúng game\nPUBLIC_URL=' + esc(origin) + '\nALLOW_DEMO_LOGIN=false</pre>' +
      '<h3>4. Thống kê có xem được khi nhúng vào Portal không?</h3><p><b>Có.</b> Iframe chỉ hiển thị game; mọi lượt chơi, điểm, coupon, click đều được gửi về máy chủ game này và ghi vào cơ sở dữ liệu của nó. Trang quản trị đọc trực tiếp từ cơ sở dữ liệu đó nên số liệu hiển thị realtime, bất kể game được mở trong Portal hay ở đâu.</p>' +
      '<h3>5. Báo coupon đã sử dụng (để tính conversion)</h3><p>Hệ thống billing gọi <code class="code">POST ' + esc(origin) + '/api/integration/coupon-redeemed</code> với body <code class="code">{"code":"...","orderId":"..."}</code>, header <code class="code">X-HLW-Timestamp</code> (unix giây) và <code class="code">X-HLW-Signature: sha256=HMAC_SHA256(INTEGRATION_SECRET, timestamp + "." + body)</code>. Có thể kiểm tra mã trước khi áp dụng qua <code class="code">/api/integration/coupon-check</code>. Nếu chưa tích hợp được, dùng nút "Nhập mã đã dùng" ở trang Coupon.</p>' +
      '</section>';
  }

  // ================================================================ NHẬT KÝ
  function pageAudit() {
    var page = 1;
    view.innerHTML = '<section class="card"><div class="card-head"><div><h2>Nhật ký thao tác quản trị</h2><p>Mọi thao tác đăng nhập, sửa cấu hình, xử lý coupon/người chơi, xuất dữ liệu đều được ghi lại</p></div></div><div id="audit-body"></div></section>';
    function load() {
      api('GET', 'api/admin/audit?page=' + page).then(function (d) {
        var pages = Math.max(1, Math.ceil(d.total / 100));
        $('audit-body').innerHTML = '<div class="table-wrap"><table class="t"><thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th><th>IP</th></tr></thead><tbody>' +
          (d.rows.length ? d.rows.map(function (r) {
            var detail = '';
            if (r.detail) { try { var o = JSON.parse(r.detail); detail = o.changes ? o.changes.map(function (c) { return c.path + ': ' + JSON.stringify(c.from) + ' → ' + JSON.stringify(c.to); }).join('\n') : JSON.stringify(o); } catch (e) { detail = r.detail; } }
            return '<tr><td class="nowrap">' + fmtDT(r.created_at) + '</td><td>' + esc(r.admin_name || '—') + '</td><td>' + (r.action === 'login_failed' ? '<span class="tag bad">' : '<span class="tag">') + esc(ACTION[r.action] || r.action) + '</span></td><td>' + esc(r.target || '') +
              '</td><td><span class="hint" style="white-space:pre-wrap">' + esc(detail.slice(0, 600)) + '</span></td><td class="nowrap">' + esc(r.ip || '') + '</td></tr>';
          }).join('') : '<tr class="empty-row"><td colspan="6">Chưa có thao tác nào</td></tr>') +
          '</tbody></table></div><div class="pager"><span>' + fmtNum(d.total) + ' dòng · trang ' + page + '/' + pages + '</span><span class="btns"><button class="btn btn-sm" type="button" id="au-prev"' + (page <= 1 ? ' disabled' : '') + '>Trước</button><button class="btn btn-sm" type="button" id="au-next"' + (page >= pages ? ' disabled' : '') + '>Sau</button></span></div>';
        $('au-prev').onclick = function () { page--; load(); };
        $('au-next').onclick = function () { page++; load(); };
      }).catch(function (e) { $('audit-body').innerHTML = '<p class="form-error">' + esc(e.message) + '</p>'; });
    }
    load();
  }

  // ================================================================ TÀI KHOẢN & DỮ LIỆU
  function pageAdmins() {
    view.innerHTML = '<section class="card"><div class="card-head"><div><h2>Tài khoản quản trị</h2><p>Chỉ xem: xem số liệu (mã coupon bị che) · Quản lý: sửa cấu hình, xử lý coupon & người chơi, xuất dữ liệu · Quản trị cao nhất: thêm quản lý tài khoản & dữ liệu</p></div>' +
      '<div class="card-tools"><button class="btn btn-sm btn-primary" type="button" id="ad-new">Thêm tài khoản</button></div></div><div id="ad-body"></div></section>' +
      '<section class="card"><div class="card-head"><div><h2>Dữ liệu</h2><p>Các thao tác dưới đây được ghi nhật ký</p></div></div><div class="actions-row">' +
      '<a class="btn" href="api/admin/backup">Tải bản sao lưu cơ sở dữ liệu</a>' +
      '<button class="btn" type="button" id="ad-purge">Xoá dữ liệu test</button>' +
      '<button class="btn btn-danger" type="button" id="ad-reset">Xoá toàn bộ dữ liệu người chơi</button></div>' +
      '<p class="hint" style="margin-top:10px">Nên "Xoá dữ liệu test" ngay trước khi mở chương trình chính thức. Cấu hình game, tài khoản quản trị và kho mã coupon không bị ảnh hưởng.</p></section>';
    function load() {
      api('GET', 'api/admin/admins').then(function (d) {
        $('ad-body').innerHTML = '<div class="table-wrap"><table class="t"><thead><tr><th>Tên đăng nhập</th><th>Vai trò</th><th>Trạng thái</th><th>Đăng nhập gần nhất</th><th></th></tr></thead><tbody>' + d.rows.map(function (a) {
          var self = a.id === S.me.id;
          return '<tr><td><b>' + esc(a.username) + '</b>' + (self ? ' <span class="tag info">bạn</span>' : '') + '</td><td>' + (self ? esc(d.roles[a.role]) : '<select data-role-id="' + a.id + '">' + Object.keys(d.roles).map(function (r) { return '<option value="' + r + '"' + (r === a.role ? ' selected' : '') + '>' + esc(d.roles[r]) + '</option>'; }).join('') + '</select>') +
            '</td><td>' + (a.disabled ? '<span class="tag bad">Đã khoá</span>' : '<span class="tag good">Hoạt động</span>') + (a.must_change ? ' <span class="tag warn">chờ đổi mật khẩu</span>' : '') + (a.locked_until && a.locked_until > Date.now() ? ' <span class="tag warn">tạm khoá</span>' : '') +
            '</td><td class="nowrap">' + fmtDT(a.last_login_at) + '</td><td class="nowrap">' + (self ? '' : '<button class="btn btn-sm" type="button" data-reset-id="' + a.id + '">Cấp lại mật khẩu</button> <button class="btn btn-sm btn-ghost" type="button" data-toggle-id="' + a.id + '" data-disabled="' + a.disabled + '">' + (a.disabled ? 'Mở khoá' : 'Khoá') + '</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
        Array.prototype.forEach.call(document.querySelectorAll('[data-role-id]'), function (s) {
          s.addEventListener('change', function () { api('POST', 'api/admin/admins/' + s.getAttribute('data-role-id'), { action: 'role', role: s.value }).then(function () { toast('Đã đổi vai trò'); }).catch(function (e) { toast(e.message, 'bad'); load(); }); });
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-reset-id]'), function (b) {
          b.addEventListener('click', function () {
            api('POST', 'api/admin/admins/' + b.getAttribute('data-reset-id'), { action: 'reset' }).then(function (r) { showSecret('Mật khẩu tạm thời', 'Gửi mật khẩu này cho người dùng qua kênh an toàn. Họ sẽ phải đổi khi đăng nhập.', r.tempPassword); load(); }).catch(function (e) { toast(e.message, 'bad'); });
          });
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-toggle-id]'), function (b) {
          b.addEventListener('click', function () {
            api('POST', 'api/admin/admins/' + b.getAttribute('data-toggle-id'), { action: b.getAttribute('data-disabled') === '1' ? 'enable' : 'disable' }).then(function () { load(); }).catch(function (e) { toast(e.message, 'bad'); });
          });
        });
      }).catch(function (e) { $('ad-body').innerHTML = '<p class="form-error">' + esc(e.message) + '</p>'; });
    }
    load();
    $('ad-new').addEventListener('click', function () {
      dialog({ title: 'Thêm tài khoản quản trị', fields: [{ name: 'username', label: 'Tên đăng nhập', hint: '3–32 ký tự: chữ, số, . _ -' }, { name: 'role', label: 'Vai trò', type: 'select', value: 'viewer', options: [['viewer', 'Chỉ xem'], ['manager', 'Quản lý'], ['superadmin', 'Quản trị cao nhất']] }],
        confirm: 'Tạo', onSubmit: function (v) { return api('POST', 'api/admin/admins', v).then(function (r) { load(); setTimeout(function () { showSecret('Đã tạo tài khoản ' + r.username, 'Mật khẩu tạm thời (chỉ hiển thị một lần). Người dùng sẽ phải đổi khi đăng nhập lần đầu.', r.tempPassword); }, 50); }); } });
    });
    $('ad-purge').addEventListener('click', function () {
      dialog({ title: 'Xoá dữ liệu test', text: 'Xoá mọi người chơi/lượt chơi/coupon/sự kiện được gắn cờ test (chơi thử, chơi ngoài thời gian chương trình).', fields: [{ name: 'confirm', label: 'Nhập "XOA TEST" để xác nhận' }], confirm: 'Xoá', danger: true,
        onSubmit: function (v) { return api('POST', 'api/admin/data/purge-test', v).then(function (r) { toast('Đã xoá dữ liệu test (' + r.removedPlayers + ' người chơi test)', 'good'); }); } });
    });
    $('ad-reset').addEventListener('click', function () {
      dialog({ title: 'Xoá TOÀN BỘ dữ liệu người chơi', text: 'Không thể hoàn tác. Hãy tải bản sao lưu trước. Xoá người chơi, lượt chơi, coupon, sự kiện (giữ cấu hình, tài khoản quản trị, kho mã).', fields: [{ name: 'confirm', label: 'Nhập "XOA TOAN BO" để xác nhận' }], confirm: 'Xoá vĩnh viễn', danger: true,
        onSubmit: function (v) { return api('POST', 'api/admin/data/reset', v).then(function () { toast('Đã xoá toàn bộ dữ liệu người chơi', 'good'); }); } });
    });
  }

  // ================================================================ khởi động
  start();
}());
