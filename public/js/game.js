/*
 * Halloween iNET 2026 — logic giao diện người chơi.
 * Điểm số hiển thị ở đây chỉ để phản hồi tức thì; điểm chính thức do SERVER tính lại từ log thao tác.
 */
(function () {
  'use strict';
  var E = window.HLWEngine, Art = window.HLWArt, Sound = window.HLWSound, API = window.HLWApi;
  var T = E.TIMING;
  var $ = function (id) { return document.getElementById(id); };
  var app = $('app');

  var App = { cfg: null, me: null, assets: {}, skew: 0, ticker: null, refreshing: false, lastRefresh: 0 };
  var G = { state: 'idle', holes: [], events: [], acked: 0 };

  // ================================================================ tiện ích
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtNum(n) { return Number(n || 0).toLocaleString('vi-VN'); }
  var TZ = { timeZone: 'Asia/Ho_Chi_Minh' };
  function fmtDate(ms) { return new Date(ms).toLocaleDateString('vi-VN', Object.assign({ day: '2-digit', month: '2-digit', year: 'numeric' }, TZ)); }
  function fmtTime(ms) { return new Date(ms).toLocaleTimeString('vi-VN', Object.assign({ hour: '2-digit', minute: '2-digit' }, TZ)); }
  function fmtClock(ms) {
    ms = Math.max(0, ms);
    var s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
    var mm = (m < 10 ? '0' : '') + m, ss = (x < 10 ? '0' : '') + x;
    return h ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  }
  function fmtCountdown(ms) {
    var s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400);
    return (d ? d + ' ngày ' : '') + fmtClock((s % 86400) * 1000);
  }
  function fmtDur(ms) { var s = Math.round((ms || 0) / 1000); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
  function now() { return Date.now() + App.skew; }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function setScreen(name) { app.dataset.screen = name; }
  // Chạy lại hiệu ứng CSS mà KHÔNG ép trình duyệt tính lại bố cục ngay (void offsetWidth gây giật khi bấm nhanh)
  function restartClass(el, cls) {
    el.classList.remove(cls);
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add(cls); }); });
  }
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function track(type, extra) {
    if (!API.token) return;
    API.post('/api/track', Object.assign({ type: type }, extra || {})).catch(function () {});
  }

  function deviceInfo() {
    var touch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    var ua = navigator.userAgent || '';
    var minSide = Math.min(screen.width, screen.height);
    var device = 'desktop';
    if (/Mobi|iPhone|iPod|Android.+Mobile/i.test(ua)) device = 'mobile';
    else if (touch && (/iPad|Android|Tablet/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1))) device = 'tablet';
    else if (touch && minSide < 600) device = 'mobile';
    return { device: device, touch: touch, w: screen.width, h: screen.height, dpr: window.devicePixelRatio || 1 };
  }

  // ================================================================ thông báo nhanh (toast)
  function toast(title, sub, kind, icon) {
    var wrap = $('toasts');
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.innerHTML = Art.ui(icon || (kind === 'bad' ? 'close' : 'gift')) + '<div><div>' + esc(title) + '</div>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</div>';
    wrap.appendChild(el);
    while (wrap.children.length > 3) wrap.removeChild(wrap.firstChild);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 300); }, sub ? 3600 : 2400);
  }

  // ================================================================ hộp thoại
  var modalStack = [];
  var lastFocus = null;
  function openModal(id) {
    var m = $(id);
    if (!m.hidden && modalStack.indexOf(id) >= 0) return;
    if (!modalStack.length) lastFocus = document.activeElement;
    m.hidden = false;
    modalStack = modalStack.filter(function (x) { return x !== id; });
    modalStack.push(id);
    setTimeout(function () {
      var f = m.querySelector('button:not([disabled]), a[href], input');
      if (f) f.focus({ preventScroll: true });
    }, 30);
  }
  function closeModal(id) {
    var m = $(id);
    if (!m || m.hidden) return;
    m.hidden = true;
    modalStack = modalStack.filter(function (x) { return x !== id; });
    if (!modalStack.length && lastFocus && lastFocus.focus) { try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* bỏ qua */ } }
  }
  var CLOSABLE = { 'md-guide': 1, 'md-coupons': 1, 'md-board': 1 };
  document.addEventListener('click', function (e) {
    var c = e.target.closest('[data-close]');
    if (c) { closeModal(c.closest('.modal').id); Sound.play('click'); return; }
    if (e.target.classList && e.target.classList.contains('modal') && CLOSABLE[e.target.id]) closeModal(e.target.id);
  });
  document.addEventListener('keydown', function (e) {
    if (!modalStack.length) return;
    var top = $(modalStack[modalStack.length - 1]);
    if (e.key === 'Escape' && CLOSABLE[top.id]) { closeModal(top.id); return; }
    if (e.key === 'Tab') { // giữ focus bên trong hộp thoại
      var f = Array.prototype.filter.call(top.querySelectorAll('button:not([disabled]), a[href], input, [tabindex]:not([tabindex="-1"])'), function (x) { return x.offsetParent !== null; });
      if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });

  function showMessage(o) {
    $('msg-title').textContent = o.title || '';
    $('msg-text').textContent = o.text || '';
    var m = document.querySelector('#md-msg .msg-mascot');
    m.innerHTML = Art.mascot(o.mood || 'idle');
    var box = $('msg-actions');
    box.innerHTML = '';
    (o.actions && o.actions.length ? o.actions : [{ label: 'Đã hiểu', cls: 'btn-primary' }]).forEach(function (a) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn ' + (a.cls || 'btn-primary');
      b.textContent = a.label;
      b.addEventListener('click', function () {
        Sound.play('click');
        if (!a.keep) closeModal('md-msg');
        if (a.onClick) a.onClick();
      });
      box.appendChild(b);
    });
    openModal('md-msg');
  }

  // ================================================================ tài nguyên thiết kế (ảnh, nhạc)
  function loadAssets() {
    return fetch('/assets/assets.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (a) {
      a = a || {};
      App.assets = a;
      Art.overrides = a;
      Sound.setFiles(a.audio || {});
      // Màn dọc (điện thoại) dùng ảnh mobile, màn ngang dùng ảnh PC; tự đổi khi xoay máy / đổi cỡ cửa sổ
      var bg = a.background || {};
      var portrait = window.matchMedia ? matchMedia('(max-aspect-ratio: 1/1)') : null;
      function applyBg() {
        var mobile = !!(portrait && portrait.matches);
        var home = (mobile && bg.homeMobile) || bg.home;
        var game = (mobile && bg.gameMobile) || bg.game;
        app.style.setProperty('--bg-home', home ? 'url("' + encodeURI(home) + '")' : 'none');
        app.style.setProperty('--bg-game', game ? 'url("' + encodeURI(game) + '")' : 'none');
        app.classList.toggle('has-bg-home', !!home);
        app.classList.toggle('home-art', !!home);
        app.classList.toggle('has-bg-game', !!game);
      }
      applyBg();
      if (portrait) { if (portrait.addEventListener) portrait.addEventListener('change', applyBg); else if (portrait.addListener) portrait.addListener(applyBg); }
      var urls = [];
      (function walk(o) {
        if (!o || typeof o !== 'object') return;
        Object.keys(o).forEach(function (k) { var v = o[k]; if (typeof v === 'string' && /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(v)) urls.push(v); else walk(v); });
      })({ items: a.items, mascot: a.mascot });
      urls.forEach(function (u) { var im = new Image(); im.src = u; });
    }).catch(function () { /* không có assets.json -> dùng hình mặc định */ });
  }

  function paintMascots() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-mascot]'), function (el) { el.innerHTML = Art.mascot(el.getAttribute('data-mascot')); });
  }

  // ================================================================ âm thanh
  function paintSoundButtons() {
    ['btn-sound', 'btn-sound2'].forEach(function (id) {
      var b = $(id);
      if (!b) return;
      b.innerHTML = Art.ui(Sound.enabled ? 'sound' : 'mute');
      b.setAttribute('aria-pressed', Sound.enabled ? 'true' : 'false');
      b.setAttribute('aria-label', Sound.enabled ? 'Tắt âm thanh' : 'Bật âm thanh');
    });
  }
  function toggleSound() {
    Sound.unlock();
    Sound.setEnabled(!Sound.enabled);
    paintSoundButtons();
    if (Sound.enabled) { Sound.play('click'); Sound.music(app.dataset.screen === 'play' ? 'game' : 'home'); }
    track(Sound.enabled ? 'sound_on' : 'sound_off');
  }
  $('btn-sound').addEventListener('click', toggleSound);

  // Toàn màn hình (máy tính, Android, iPad). iPhone Safari không hỗ trợ toàn màn hình cho trang web -> ẩn nút.
  // Khi nhúng trong Portal, thẻ iframe cần có allow="fullscreen" thì nút mới hoạt động.
  (function setupFullscreen() {
    var de = document.documentElement, btn = $('btn-fs');
    var req = de.requestFullscreen || de.webkitRequestFullscreen;
    var enabled = document.fullscreenEnabled || document.webkitFullscreenEnabled;
    if (!btn || !req || !enabled) return;
    function isFs() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
    function paint() {
      btn.innerHTML = Art.ui(isFs() ? 'exitFullscreen' : 'fullscreen');
      btn.setAttribute('aria-label', isFs() ? 'Thoát toàn màn hình' : 'Toàn màn hình');
      btn.title = btn.getAttribute('aria-label');
    }
    btn.hidden = false;
    paint();
    btn.addEventListener('click', function () {
      Sound.unlock(); Sound.play('click');
      if (isFs()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      try { var p = req.call(de); if (p && p.catch) p.catch(function () { toast('Trình duyệt không cho phép toàn màn hình ở đây', null, 'bad'); }); } catch (e) { toast('Trình duyệt không cho phép toàn màn hình ở đây', null, 'bad'); }
    });
    document.addEventListener('fullscreenchange', paint);
    document.addEventListener('webkitfullscreenchange', paint);
  })();
  $('btn-sound2').addEventListener('click', toggleSound);
  // trình duyệt chỉ cho phát âm thanh sau thao tác đầu tiên của người dùng
  document.addEventListener('pointerdown', function first() {
    Sound.unlock();
    if (app.dataset.screen === 'home') Sound.music('home');
    document.removeEventListener('pointerdown', first);
  }, { once: true });

  // ================================================================ đăng nhập
  function readLaunchParams() {
    var hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    var query = new URLSearchParams(location.search);
    var out = { token: hash.get('token') || query.get('token'), access: hash.get('access') };
    if (out.token || out.access) {
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* bỏ qua */ }
    }
    return out;
  }

  function loginPortal(token) {
    return API.post('/api/auth/portal', { token: token, device: deviceInfo() }).then(function (d) {
      API.setToken(d.accessToken);
      return enterHome();
    });
  }

  function refreshMe() {
    return API.get('/api/me').then(function (me) {
      App.me = me;
      App.skew = me.serverTime - Date.now();
      return me;
    });
  }

  function guestKey() {
    var k = null;
    try { k = localStorage.getItem('hlw_guest'); } catch (e) { /* bỏ qua */ }
    if (!k || !/^[A-Za-z0-9_-]{22,64}$/.test(k)) {
      var a = new Uint8Array(24);
      crypto.getRandomValues(a);
      k = btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      try { localStorage.setItem('hlw_guest', k); } catch (e) { /* bỏ qua */ }
    }
    return k;
  }
  function loginGuest() {
    return API.post('/api/auth/guest', { key: guestKey(), device: deviceInfo() }).then(function (d) {
      API.setToken(d.accessToken);
      return enterHome(true);
    }).catch(function (e) { showGate(e.message, e.status === 0); });
  }

  function enterHome(noRetry) {
    return refreshMe().then(function () { showHome(); }, function (e) {
      if (e.status === 401 && App.cfg && App.cfg.guest && !noRetry) { API.setToken(null); return loginGuest(); }
      if (e.status === 401 || e.status === 403) { API.setToken(null); showGate(e.message); return; }
      showGate(e.message || 'Không kết nối được máy chủ trò chơi.', true);
    });
  }

  function showGate(message, retry) {
    setScreen('gate');
    var c = App.cfg ? App.cfg.campaign : null;
    $('gate-title').textContent = c ? c.name : 'Halloween iNET';
    $('gate-text').textContent = message || 'Vui lòng đăng nhập Portal iNET để tham gia trò chơi.';
    var portal = $('gate-portal');
    if (c && c.portalUrl) portal.href = c.portalUrl;
    portal.onclick = null;
    portal.textContent = 'Đến Portal iNET';
    if (retry) {
      portal.textContent = 'Thử lại';
      portal.href = '#';
      portal.onclick = function (e) { e.preventDefault(); location.reload(); };
    }
  }

  // Portal có thể gửi token qua postMessage thay vì đặt trên URL.
  window.addEventListener('message', function (ev) {
    if (!App.cfg || (App.cfg.portalOrigins || []).indexOf(ev.origin) < 0) return;
    var d = ev.data;
    if (d && d.type === 'hlw:token' && typeof d.token === 'string') {
      loginPortal(d.token).catch(function (err) { showGate(err.message); });
    }
  });

  // ================================================================ trang chủ
  function canPlayNow() {
    var me = App.me, c = me.campaign;
    if (c.maintenance && !me.player.test) return { ok: false, text: c.maintenanceMessage || 'Trò chơi đang bảo trì.' };
    if (c.status !== 'live' && !c.testMode && !me.player.test) {
      return c.status === 'upcoming'
        ? { ok: false, html: 'Sự kiện bắt đầu sau <b>' + fmtCountdown(c.start - now()) + '</b>', upcoming: true }
        : { ok: false, text: 'Sự kiện đã kết thúc. Cảm ơn bạn đã tham gia cùng iNET!' };
    }
    return { ok: true };
  }

  function showHome() {
    closeAllPlayOverlays();
    setScreen('home');
    var me = App.me, c = me.campaign;
    $('t-title').textContent = c.title || 'ĐẬP BÍ NGÔ';
    if (App.assets.logo) $('t-title').innerHTML = '<img src="' + esc(encodeURI(App.assets.logo)) + '" alt="' + esc(c.title) + '">';
    $('t-sub').textContent = c.subtitle || '';
    paintHomeStats();
    $('btn-board').hidden = !(me.guide.features && me.guide.features.leaderboard);
    var isTest = me.player.test || (c.testMode && c.status !== 'live');
    $('test-ribbon').hidden = !isTest;
    paintSoundButtons();
    updateHomeTick();
    clearInterval(App.ticker);
    App.ticker = setInterval(updateHomeTick, 1000);
    if (Sound.ctx) Sound.music('home');
    if (me.active && me.active.sessionId) promptResume(me.active);
  }

  function paintHomeStats() {
    var me = App.me, t = me.turns;
    $('h-best').textContent = fmtNum(me.player.bestScore);
    $('h-combo').textContent = 'x' + (me.player.bestCombo || 0);
    $('h-turns').textContent = t.turns + '/' + t.max + (t.bonus ? ' +' + t.bonus : '');
    $('h-regen').textContent = t.nextAt && t.nextAt > now() ? '+1 sau ' + fmtClock(t.nextAt - now()) : '';
  }

  function updateHomeTick() {
    if (app.dataset.screen !== 'home' || !App.me) return;
    var me = App.me, t = me.turns, c = me.campaign;
    var total = t.turns + (t.bonus || 0);
    $('h-turns').textContent = t.turns + '/' + t.max + (t.bonus ? ' +' + t.bonus : '');
    var regen = '';
    if (t.nextAt) {
      var left = t.nextAt - now();
      if (left <= 0) { maybeRefresh(); regen = 'Đang hồi...'; }
      else regen = '+1 sau ' + fmtClock(left);
    }
    $('h-regen').textContent = regen;

    var st = canPlayNow();
    var status = $('camp-status');
    var btn = $('btn-start');
    status.classList.toggle('is-live', st.ok && c.status === 'live');
    if (!st.ok) {
      if (st.html) status.innerHTML = st.html; else status.textContent = st.text;
      btn.disabled = true;
      btn.textContent = st.upcoming ? 'Sắp diễn ra' : 'Bắt đầu';
      if (st.upcoming && c.start - now() <= 0) maybeRefresh();
      return;
    }
    if (c.status === 'live') status.innerHTML = 'Diễn ra đến <b>' + fmtTime(c.end) + ' ' + fmtDate(c.end) + '</b>';
    else status.innerHTML = 'Đang mở <b>chơi thử</b> — dữ liệu không tính vào kết quả chính thức';
    if (total <= 0) {
      btn.disabled = true;
      btn.textContent = t.nextAt ? 'Hồi lượt sau ' + fmtClock(t.nextAt - now()) : 'Hết lượt';
    } else {
      btn.disabled = false;
      btn.textContent = 'Bắt đầu';
    }
  }

  function maybeRefresh() {
    if (App.refreshing || Date.now() - App.lastRefresh < 5000) return;
    App.refreshing = true;
    App.lastRefresh = Date.now();
    refreshMe().then(function () { App.refreshing = false; updateHomeTick(); }, function () { App.refreshing = false; });
  }

  $('btn-start').addEventListener('click', function () { startGame(); });
  $('btn-guide').addEventListener('click', function () { Sound.unlock(); Sound.play('click'); openGuide(); });
  $('btn-coupons').addEventListener('click', function () { Sound.unlock(); Sound.play('click'); openCoupons(); });
  $('btn-board').addEventListener('click', function () { Sound.unlock(); Sound.play('click'); openLeaderboard(); });

  function promptResume(a) {
    if (a.engine !== E.VERSION) return;
    showMessage({
      title: 'Lượt chơi đang dang dở',
      text: 'Bạn còn một lượt chơi chưa kết thúc (' + fmtNum(a.score) + ' điểm). Chơi tiếp hay kết thúc để nhận kết quả?',
      mood: 'idle',
      actions: [
        { label: 'Chơi tiếp', cls: 'btn-primary', onClick: function () { resumeSession(a); } },
        { label: 'Kết thúc lượt này', cls: 'btn-ghost', onClick: function () { abandonSession(a); } }
      ]
    });
  }

  function resumeSession(a) {
    Sound.unlock();
    App.me.active = null;
    setupGame(a, a);
    runCountdown(true).then(beginPlay);
  }

  function abandonSession(a) {
    App.me.active = null;
    API.post('/api/game/abandon', { sid: a.sessionId }).then(function (d) {
      G.lastSid = a.sessionId;
      showResult(d.result, 'quit');
    }).catch(function (e) { toast(e.message, null, 'bad'); });
  }

  // ================================================================ bàn chơi
  var HOLE_BACK = '<svg class="hole-back" viewBox="0 0 200 80" aria-hidden="true">' +
    '<ellipse cx="100" cy="40" rx="97" ry="37" fill="#5a3322" stroke="#2b0f2e" stroke-width="4"/>' +
    '<ellipse cx="100" cy="42" rx="84" ry="28" fill="#140402"/><ellipse cx="100" cy="38" rx="68" ry="17" fill="#260a04"/>' +
    '<path d="M22 22 l5 -11 l3 10 l5 -13 l2 13" fill="#3f8a1c" stroke="#2b0f2e" stroke-width="2.5" stroke-linejoin="round"/>' +
    '<path d="M160 14 l4 -10 l3 9 l5 -11 l2 12" fill="#3f8a1c" stroke="#2b0f2e" stroke-width="2.5" stroke-linejoin="round"/></svg>';
  var HOLE_FRONT = '<svg class="hole-front" viewBox="0 0 200 40" aria-hidden="true">' +
    '<path d="M3 0 A97 37 0 0 0 197 0 L184 2 A84 28 0 0 1 16 2 Z" fill="#6b3d27" stroke="#2b0f2e" stroke-width="4" stroke-linejoin="round"/>' +
    '<ellipse cx="54" cy="24" rx="7" ry="4" fill="#8a5a3c" stroke="#2b0f2e" stroke-width="2"/><ellipse cx="140" cy="27" rx="9" ry="4.5" fill="#8a5a3c" stroke="#2b0f2e" stroke-width="2"/>' +
    '<path d="M98 33 l3 -9 l3 8 l4 -10 l2 11" fill="#3f8a1c" stroke="#2b0f2e" stroke-width="2.2" stroke-linejoin="round"/></svg>';
  $('hammer').innerHTML = Art.hammer();
  var HAMMER_SKINS = [{ key: '', name: 'Búa Sấm Sét' }, { key: 'ice', name: 'Búa Băng Long' }, { key: 'fire', name: 'Búa Hỏa Long' }, { key: 'armor', name: 'Búa Kim Cang' }];
  function hammerLevels() {
    var h = G.cfg && G.cfg.combo && G.cfg.combo.hammer;
    return h && h.length === 3 ? h : [3, 5, 8];
  }
  function hammerSizes() {
    return window.matchMedia && matchMedia('(max-width: 600px)').matches ? [104, 122, 140, 160] : [128, 152, 176, 204];
  }
  function setHammerSkin(level) {
    if ((G.hammerSkin || 0) === level) return;
    var up = level > (G.hammerSkin || 0);
    G.hammerSkin = level;
    var hm = $('hammer');
    hm.setAttribute('data-skin', level ? HAMMER_SKINS[level].key : '');
    G.hammerW = hammerSizes()[level] || hammerSizes()[0];
    if (up && level) restartClass(hm, 'hm-up');
  }
  $('btn-pause').innerHTML = Art.ui('pause');

  function buildBoard() {
    if (G.holes.length) return;
    var board = $('board');
    for (var i = 0; i < E.HOLES; i++) {
      var el = document.createElement('div');
      el.className = 'hole';
      el.setAttribute('data-i', i);
      el.innerHTML = HOLE_BACK + '<div class="clip"><div class="item" data-state="idle"></div></div>' + HOLE_FRONT + '<div class="fx"></div>';
      board.appendChild(el);
      G.holes.push({ el: el, item: el.querySelector('.item'), fx: el.querySelector('.fx'), ptr: 0, spawnId: -1, state: null, ty: null, shown: false });
    }
  }

  function resetHoles() {
    G.holes.forEach(function (H) {
      H.ptr = 0; H.spawnId = -1; H.state = null; H.ty = null; H.shown = false;
      H.item.innerHTML = '';
      H.item.style.transform = 'translate3d(-50%,101%,0)';
      H.fx.innerHTML = '';
    });
  }

  function setupGame(data, resume) {
    var tm = $('g-time'); tm.hidden = true; tm.removeAttribute('data-s'); tm.classList.remove('low');
    G.sid = data.sessionId;
    G.lastSid = data.sessionId;
    G.cfg = data.cfg;
    G.tiers = (data.tiers || []).slice().sort(function (a, b) { return a.score - b.score; });
    G.owned = data.owned || {};
    G.game = new E.Game(data.seed, data.cfg);
    G.events = [];
    G.acked = 0;
    G.lastTapT = 0;
    G.baseGt = 0;
    if (resume) {
      (resume.events || []).forEach(function (ev) { G.game.tap(ev[0], ev[1]); G.events.push([ev[0], ev[1]]); });
      G.acked = G.events.length;
      G.lastTapT = G.events.length ? G.events[G.events.length - 1][0] : 0;
      G.baseGt = resume.gt || G.lastTapT;
    }
    G.level = G.game.level(G.baseGt);
    G.comboShown = 0;
    setHammerSkin(0);
    $('g-idle').hidden = true;
    G.crossed = {};
    G.tiers.forEach(function (t) { if (G.game.score >= t.score) G.crossed[t.id] = true; });
    G.state = 'ready';
    buildBoard();
    resetHoles();
    $('g-score').textContent = fmtNum(G.game.score);
    $('g-level').textContent = 'LV ' + G.level;
    $('g-combo').classList.remove('on');
    $('g-banner').innerHTML = '';
    renderLives();
    renderTierbar();
    updateTierbar();
    clearInterval(App.ticker);
    setScreen('play');
    app.classList.remove('is-playing');
    $('test-ribbon').hidden = !data.test;
    Sound.music('game');
    render(G.baseGt);
  }

  function renderLives() {
    var n = G.cfg.bombs.strikes, used = G.game.strikes, html = '';
    for (var i = 0; i < n; i++) html += '<span class="life' + (i < used ? ' used' : '') + '">' + Art.item('bomb') + '</span>';
    $('g-lives').innerHTML = html;
    $('g-lives').title = 'Trúng bom ' + n + ' lần là thua';
  }

  function renderTierbar() {
    var tiers = G.tiers.filter(function (t) { return t.score > 0; });
    var max = tiers.length ? tiers[tiers.length - 1].score : 1;
    G.tierMax = max;
    $('g-tiermarks').innerHTML = tiers.map(function (t, i) {
      var name = t.reward ? ' ' + String(t.short || t.label).split(' ')[0] : '';
      return '<div class="tier-mark' + (t.reward ? ' reward' : '') + (i === tiers.length - 1 ? ' last' : '') + '" data-id="' + esc(t.id) +
        '" style="left:' + (t.score / max * 100).toFixed(2) + '%" title="' + esc(t.reward ? t.label : 'Mốc ' + t.score) + '"><span>' + t.score + '<em>' + esc(name) + '</em></span></div>';
    }).join('');
  }

  // true nếu người chơi đã nhận đủ số voucher cho phép của mốc (0 = không giới hạn)
  function ownedFull(id) {
    var m = App.me ? App.me.guide.maxPerTier : 0;
    return m > 0 && (G.owned[id] || 0) >= m;
  }

  function updateTierbar() {
    var score = G.game.score;
    $('g-tierfill').style.transform = 'scaleX(' + Math.min(1, score / (G.tierMax || 1)).toFixed(4) + ')';
    Array.prototype.forEach.call($('g-tiermarks').children, function (m) {
      var id = m.getAttribute('data-id');
      var t = G.tiers.find(function (x) { return x.id === id; });
      m.classList.toggle('reached', !!t && score >= t.score);
      m.classList.toggle('owned', !!t && t.reward && ownedFull(id));
    });
  }

  // ---------------------------------------------------------------- đồng hồ & vòng lặp vẽ
  function gameNow() { return (G.pausedAt !== null && G.pausedAt !== undefined ? G.pausedAt : performance.now()) - G.t0; }

  function easeOut(x) { return 1 - (1 - x) * (1 - x) * (1 - x); }
  function easeIn(x) { return x * x * x; }

  function visualState(s, hits) {
    if (s.type === 'pumpkinCloth') return hits >= 1 ? 'hit1' : 'idle';
    if (s.type === 'pumpkinIron') return hits >= 2 ? 'hit2' : (hits === 1 ? 'hit1' : 'idle');
    if (s.type === 'boss' || s.type === 'bossArmor') return hits >= Math.ceil(s.hp / 2) ? 'hit1' : 'idle';
    return 'idle';
  }

  function render(t) {
    var sp = G.game.spawner;
    sp.generateUntil(t + 300);
    for (var h = 0; h < G.holes.length; h++) {
      var H = G.holes[h];
      var list = sp.byHole[h];
      var p = H.ptr;
      while (p + 1 < list.length && list[p + 1].at <= t) p++;
      H.ptr = p;
      var s = list[p];
      var vis = !!s && s.at <= t, y = 0, state = 'idle';
      if (vis) {
        var st = G.game.stateOf(s);
        if (st.endAt !== undefined) {
          if (s.type === 'bomb') vis = false;
          else {
            var k = t - st.endAt;
            state = 'ko';
            if (k > T.ko) vis = false;
            else if (k > T.ko - 190) y = easeIn((k - (T.ko - 190)) / 190);
          }
        } else {
          var end = st.until;
          if (t > end) vis = false;
          else {
            var up = t - s.at;
            if (up < T.rise) y = 1 - easeOut(up / T.rise);
            else if (t > end - T.sink) y = easeIn((t - (end - T.sink)) / T.sink);
            state = visualState(s, st.hits);
          }
        }
      }
      if (!vis) {
        if (H.shown) { H.item.style.transform = 'translate3d(-50%,101%,0)'; H.shown = false; H.ty = null; }
        continue;
      }
      if (H.spawnId !== s.id) {
        H.spawnId = s.id;
        H.item.innerHTML = Art.item(s.type, s.skin);
        H.item.setAttribute('data-type', s.type);
        if (s.skin) H.item.setAttribute('data-skin', s.skin); else H.item.removeAttribute('data-skin');
        H.state = null;
        H.hpShown = -1;
        if (s.type.indexOf('boss') === 0) {
          banner('BOSS!', ((G.cfg.items[s.type] && G.cfg.items[s.type].label) || 'Boss') + ' — đập ' + s.hp + ' cái!', true);
          Sound.play('warn');
        }
        if (s.rush && G.rushShown !== s.at) {
          G.rushShown = s.at;
          banner('TRÀN ĐỒNG!', 'Cả 9 ô cùng trồi lên — đập nhanh nào!', false, 'rush');
          Sound.play('combo');
        }
      }
      if (s.type.indexOf('boss') === 0 && st && H.hpShown !== st.hits) {
        var bar = H.item.querySelector('.boss-hp i');
        if (bar) bar.style.transform = 'scaleX(' + Math.max(0, (s.hp - st.hits) / s.hp).toFixed(3) + ')';
        H.hpShown = st.hits;
      }
      if (H.state !== state) { H.item.setAttribute('data-state', state); H.state = state; }
      var ty = (y * 101).toFixed(1);
      if (H.ty !== ty) { H.item.style.transform = 'translate3d(-50%,' + ty + '%,0)'; H.ty = ty; }
      H.shown = true;
    }
  }

  function frame() {
    if (G.state !== 'playing') return;
    G.lastFrameAt = performance.now();
    var t = gameNow();
    render(t);
    if ($('g-combo').classList.contains('on') && !G.game.isComboAlive(t)) {
      $('g-combo').classList.remove('on');
      G.comboShown = 0;
    }
    if (G.hammerSkin && !G.game.isComboAlive(t)) setHammerSkin(0);
    // đồng hồ đếm ngược thời gian lượt chơi
    if (G.game.maxMs) {
      var remain = G.game.maxMs - t;
      if (remain <= 0) { onIdleEnd(G.game.maxMs); return; }
      var rs = Math.ceil(remain / 1000), te = $('g-time');
      if (te.getAttribute('data-s') !== String(rs)) {
        te.setAttribute('data-s', rs);
        te.hidden = false;
        te.textContent = Math.floor(rs / 60) + ':' + ('0' + (rs % 60)).slice(-2);
        te.classList.toggle('low', rs <= 10);
        if (rs <= 10) Sound.play('count');
      }
    }
    if (G.game.idleMs) {
      var left = G.game.idleMs - (t - G.game.lastAct);
      var idleEl = $('g-idle');
      if (left <= 0) { onIdleEnd(t); return; }
      if (left <= 5000) {
        var sec = Math.ceil(left / 1000);
        if (idleEl.getAttribute('data-sec') !== String(sec)) {
          idleEl.hidden = false;
          idleEl.setAttribute('data-sec', sec);
          idleEl.innerHTML = '<b>Bạn còn đó không?</b><span>Lượt chơi tự kết thúc sau <em>' + sec + '</em> giây nếu không thao tác</span>';
          Sound.play('count');
        }
      } else if (!idleEl.hidden) { idleEl.hidden = true; idleEl.removeAttribute('data-sec'); }
    }
    var lv = G.game.level(t);
    if (lv > G.level) {
      G.level = lv;
      $('g-level').textContent = 'LV ' + lv;
      banner('LEVEL ' + lv, pick(['Bí ngô tăng tốc!', 'Bom xuất hiện nhiều hơn!', 'Cẩn thận nhé!', 'Tay nhanh hơn nữa nào!', 'Đêm Halloween còn dài!']));
      Sound.play('level');
    }
    G.raf = requestAnimationFrame(frame);
  }

  function banner(big, small, warn, extra) {
    var b = $('g-banner');
    b.className = 'banner' + (warn ? ' warn' : '') + (extra ? ' ' + extra : '');
    b.innerHTML = '<div class="b-in"><b>' + esc(big) + '</b>' + (small ? '<span>' + esc(small) + '</span>' : '') + '</div>';
  }

  // ---------------------------------------------------------------- bắt đầu
  function startGame() {
    if (G.starting) return;
    closeModal('md-msg');
    if (App.me) App.me.active = null;
    Sound.unlock();
    Sound.play('click');
    var btn = $('btn-start');
    if (botProbe()) {
      showMessage({ title: 'Không thể bắt đầu', text: 'Hệ thống phát hiện trình duyệt đang bị điều khiển bởi công cụ tự động hoặc trợ lý AI. Vui lòng tắt các công cụ/tiện ích này rồi tải lại trang để chơi.', mood: 'sad' });
      return;
    }
    Bot.reported = false; Bot.jumps = 0; Bot.mouseTaps = 0; Bot.moves = 0; Bot.unfocused = 0; Bot.tapX = Bot.tapY = null;
    G.starting = true;
    btn.classList.add('is-loading');
    API.post('/api/game/start', { engine: E.VERSION, device: deviceInfo(), bot: Bot.reason || undefined }).then(function (data) {
      App.me.turns = data.turns;
      setupGame(data, null);
      return runCountdown(false).then(beginPlay);
    }).catch(function (e) {
      if (e.code === 'no_turns') {
        if (e.data && e.data.nextAt) App.me.turns.nextAt = e.data.nextAt;
        App.me.turns.turns = 0;
        toast('Bạn đã hết lượt chơi', e.data && e.data.nextAt ? 'Lượt mới sẽ hồi sau ' + fmtClock(e.data.nextAt - now()) : null, 'bad', 'clock');
        maybeRefresh();
      } else if (e.code === 'reload') {
        showMessage({ title: 'Có phiên bản mới', text: e.message, actions: [{ label: 'Tải lại trang', onClick: function () { location.reload(); } }] });
      } else if (e.status === 401) {
        authLost(e);
      } else {
        showMessage({ title: 'Chưa thể bắt đầu', text: e.message, mood: 'sad' });
      }
    }).then(function () {
      G.starting = false;
      btn.classList.remove('is-loading');
    });
  }

  function runCountdown(fast) {
    var el = $('g-count');
    var d = fast ? 520 : 760;
    var seq = ['3', '2', '1'];
    var i = 0;
    return new Promise(function (resolve) {
      function next() {
        if (i < seq.length) {
          el.innerHTML = '<b>' + seq[i] + '</b>';
          Sound.play('count');
          i++;
          setTimeout(next, d);
        } else if (i === seq.length) {
          el.innerHTML = '<b class="go">ĐẬP!</b>';
          Sound.play('go');
          i++;
          setTimeout(next, fast ? 280 : 420);
        } else {
          el.innerHTML = '';
          resolve();
        }
      }
      next();
    });
  }

  function beginPlay() {
    if (G.state !== 'ready' && G.state !== 'paused') return;
    G.t0 = performance.now() - G.baseGt;
    G.pausedAt = null;
    G.state = 'playing';
    app.classList.add('is-playing');
    holeRects = null;
    showHammerReady();
    clearInterval(G.syncTimer);
    G.syncTimer = setInterval(function () { sync(false); }, 3000);
    sync(false);
    startFrames();
  }

  // Trình duyệt có thể ngừng vẽ khung hình mà không báo ẩn trang (vd: iframe bị cuộn khuất màn hình).
  // Khi đó tự tạm dừng để người chơi không bị mất vật phẩm "vô hình".
  function startFrames() {
    G.lastFrameAt = performance.now();
    G.raf = requestAnimationFrame(frame);
    clearInterval(G.watchdog);
    G.watchdog = setInterval(function () {
      if (G.state === 'playing' && performance.now() - G.lastFrameAt > 800) pauseGame(true);
    }, 300);
  }

  // ---------------------------------------------------------------- đập
  var KEYMAP = {
    Numpad7: 0, Numpad8: 1, Numpad9: 2, Numpad4: 3, Numpad5: 4, Numpad6: 5, Numpad1: 6, Numpad2: 7, Numpad3: 8,
    Digit7: 0, Digit8: 1, Digit9: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit1: 6, Digit2: 7, Digit3: 8,
    KeyQ: 0, KeyW: 1, KeyE: 2, KeyA: 3, KeyS: 4, KeyD: 5, KeyZ: 6, KeyX: 7, KeyC: 8
  };

  function eventGameTime(ts) {
    var nowT = gameNow();
    var t = nowT;
    if (ts && ts > 0) {
      var diff = performance.now() - ts;
      if (diff >= 0 && diff < 1000) t = ts - G.t0;
    }
    t = Math.round(Math.min(t, nowT));
    if (t < G.lastTapT) t = G.lastTapT;
    if (t < 0) t = 0;
    return t;
  }

  // ================================================================ phát hiện máy/AI chơi hộ
  // Bất kỳ dấu hiệu nào dưới đây -> báo máy chủ huỷ lượt ngay (máy chủ chỉ dùng tín hiệu này để HUỶ, không bao giờ để cộng điểm).
  //  synthetic : thao tác do script/tiện ích tạo ra (sự kiện không phải từ người dùng thật)
  //  webdriver : trình duyệt đang bị điều khiển bằng công cụ tự động (Selenium, Playwright, Puppeteer...)
  //  unfocused : thao tác đến trong khi trang game KHÔNG được chọn (người dùng đang ở khung chat của trợ lý AI,
  //              AI tự bấm vào trang) — người thật bấm vào trang thì trang luôn được chọn
  //  mouse_jump: chuột "nhảy cóc" thẳng tới đúng ô mà không có đường di chuyển (AI/script bấm theo toạ độ)
  var Bot = { reason: null, reported: false, tapX: null, tapY: null, moves: 0, jumps: 0, mouseTaps: 0, unfocused: 0 };
  function botProbe() {
    if (Bot.reason) return Bot.reason;
    try { if (navigator.webdriver) return (Bot.reason = 'webdriver'); } catch (e) { /* bỏ qua */ }
    return null;
  }
  function botDetected(reason) {
    if (!Bot.reason) Bot.reason = reason;
    if (G.state !== 'playing' || Bot.reported) return;
    Bot.reported = true;
    sync(false);
  }
  document.addEventListener('pointermove', function (e) { if (e.pointerType === 'mouse') Bot.moves++; }, { passive: true });
  function checkTap(e) {
    // trang không được chọn mà vẫn nhận cú đập -> có thứ khác đang bấm hộ
    var focused = true;
    try { focused = document.hasFocus(); } catch (x) { /* bỏ qua */ }
    if (!focused && ++Bot.unfocused >= 3) { botDetected('unfocused'); return; }
    if (e.pointerType !== 'mouse') return;
    // chỉ xét những lần CHUYỂN sang ô khác (đập liên tiếp tại chỗ thì người thật cũng không cần di chuột).
    // Người thật kéo chuột qua nhiều điểm; script/AI bấm theo toạ độ thì "dịch chuyển tức thời" (0–1 sự kiện di chuyển)
    var far = Bot.tapX === null || Math.abs(e.clientX - Bot.tapX) > 40 || Math.abs(e.clientY - Bot.tapY) > 40;
    if (far) { Bot.mouseTaps++; if (Bot.moves <= 1) Bot.jumps++; }
    Bot.moves = 0; Bot.tapX = e.clientX; Bot.tapY = e.clientY;
    if (Bot.jumps >= 4 && Bot.jumps / Bot.mouseTaps >= 0.6) botDetected('mouse_jump');
  }
  setInterval(function () { if (G.state === 'playing' && botProbe()) botDetected(Bot.reason); }, 1500);

  function tapHole(h, ts) {
    if (G.state !== 'playing') return;
    var t = eventGameTime(ts);
    G.lastTapT = t;
    G.events.push([t, h]);
    var r = G.game.tap(t, h);
    onTapResult(r, G.holes[h], t);
  }

  var board = $('board');
  board.addEventListener('pointerdown', function (e) {
    if (G.state !== 'playing') return;
    var holeEl = e.target.closest('.hole');
    if (!holeEl) return;
    e.preventDefault();
    if (!e.isTrusted) { botDetected('synthetic'); return; }
    checkTap(e);
    Sound.unlock();
    swingHammer(e.clientX, e.clientY, e.pointerType);
    tapHole(+holeEl.getAttribute('data-i'), e.timeStamp);
  }, { passive: false });
  board.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  var hammer = $('hammer');
  // đặt cán búa ngay vị trí con trỏ; búa to lên theo combo nên tính theo kích thước hiện tại
  function placeHammer(x, y) {
    var w = G.hammerW || hammerSizes()[0];
    hammer.style.transform = 'translate(' + Math.round(x - w * 0.24) + 'px,' + Math.round(y - w * 0.89) + 'px)';
  }
  board.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse') return;
    hammer.classList.add('mouse');
    placeHammer(e.clientX, e.clientY);
  });
  // búa luôn hiện trong lúc chơi (kể cả khi chơi bằng bàn phím); chuột rời bàn chơi thì búa đứng yên tại chỗ
  function showHammerReady() {
    if (hammer.classList.contains('mouse')) return;
    var c = holeCenter(4);
    placeHammer(c[0] + c[2] * 0.12, c[1] - c[3] * 0.05);
    hammer.classList.add('mouse');
  }

  // Toạ độ tâm các ô được ghi nhớ sẵn (chỉ đo lại khi đổi cỡ màn hình) để mỗi lần bấm phím không phải đo bố cục
  var holeRects = null;
  function holeCenter(i) {
    if (!holeRects) holeRects = G.holes.map(function (H) { var r = H.el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height]; });
    return holeRects[i];
  }
  window.addEventListener('resize', function () { holeRects = null; });
  window.addEventListener('orientationchange', function () { holeRects = null; });

  function swingHammer(x, y, type) {
    if (type === 'mouse') {
      placeHammer(x, y);
      hammer.classList.add('swing');
      clearTimeout(G.swingT);
      G.swingT = setTimeout(function () { hammer.classList.remove('swing'); }, 90);
    } else {
      hammer.classList.remove('mouse');
      placeHammer(x, y);
      hammer.classList.add('swing');
      restartClass(hammer, 'touch');
      clearTimeout(G.swingT);
      G.swingT = setTimeout(function () { hammer.classList.remove('swing'); }, 90);
    }
  }

  document.addEventListener('keydown', function (e) {
    if (G.state === 'playing') {
      if (KEYMAP[e.code] !== undefined && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        if (!e.isTrusted) { botDetected('synthetic'); return; }
        try { if (!document.hasFocus() && ++Bot.unfocused >= 3) { botDetected('unfocused'); return; } } catch (x) { /* bỏ qua */ }
        tapHole(KEYMAP[e.code], e.timeStamp);
        var hc = holeCenter(KEYMAP[e.code]);
        swingHammer(hc[0], hc[1], 'mouse');
      } else if (e.code === 'Escape' || e.code === 'Space' || e.code === 'KeyP') {
        e.preventDefault();
        pauseGame(false);
      }
    }
  });

  // ---------------------------------------------------------------- hiệu ứng
  var PCOLORS = {
    pumpkin: ['#ff8a2a', '#ffb35c', '#e8651b'], pumpkinCloth: ['#ff8a2a', '#7b46b8', '#ffb35c'], pumpkinIron: ['#ff8a2a', '#a3adbf', '#ffb35c'],
    ghost: ['#f6f3ff', '#dcd5f7'], virus: ['#7bd13b', '#c4f25d'], potion: ['#79f04a', '#4a4458'], candy: ['#ff4f8b', '#ffb347', '#fff4dc']
  };
  var liveParticles = 0;
  function particles(H, type, n) {
    if (reduceMotion) n = Math.min(n, 4);
    if (liveParticles > 60) return;
    var colors = PCOLORS[type] || PCOLORS.pumpkin;
    for (var i = 0; i < n; i++) {
      var p = document.createElement('i');
      var star = i % 3 === 0;
      p.className = 'pt' + (star ? ' star' : (type === 'pumpkin' || type === 'pumpkinCloth' || type === 'pumpkinIron' ? '' : ' goo'));
      var ang = rand(-Math.PI, 0) + rand(-0.4, 0.4);
      var dist = rand(36, 90);
      p.style.setProperty('--dx', (Math.cos(ang) * dist).toFixed(0) + 'px');
      p.style.setProperty('--dy', (Math.sin(ang) * dist + rand(10, 40)).toFixed(0) + 'px');
      p.style.setProperty('--rot', rand(-200, 200).toFixed(0) + 'deg');
      p.style.setProperty('--s', (star ? rand(14, 20) : rand(8, 14)).toFixed(0) + 'px');
      p.style.setProperty('--c', pick(colors));
      p.style.setProperty('--y', rand(30, 50).toFixed(0) + '%');
      H.fx.appendChild(p);
      liveParticles++;
      setTimeout(function (el) { el.remove(); liveParticles--; }.bind(null, p), 680);
    }
  }
  function floatPoints(H, base, bonus, hb, hl) {
    var d = document.createElement('div');
    d.className = 'float-pts';
    d.innerHTML = '<b>+' + base + '</b>' + (hb ? '<small class="fp-hammer fp-h' + hl + '">+' + hb + ' búa</small>' : '') + (bonus ? '<small>+' + bonus + ' combo</small>' : '');
    H.fx.appendChild(d);
    setTimeout(function () { d.remove(); }, 950);
  }
  function flyHat(H, kind) {
    var d = document.createElement('div');
    d.className = 'fly-hat' + (Math.random() < 0.5 ? ' right' : '');
    d.innerHTML = Art.hat(kind);
    H.fx.appendChild(d);
    setTimeout(function () { d.remove(); }, 860);
  }
  function squash(H) {
    var art = H.item.firstElementChild;
    if (!art || !art.animate) return;
    art.animate([
      { transform: 'scale(1.18, .8)' }, { transform: 'scale(.94, 1.08)' }, { transform: 'scale(1, 1)' }
    ], { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
  }
  // Hiệu ứng theo búa đang cầm, chỉ ở ô vừa đập: Sấm Sét = tia chớp, Băng Long = đóng băng, Hỏa Long = lửa đốt, Kim Cang = chấn động vàng
  function hammerFx(H) {
    var lv = G.hammerSkin || 0, fx = H.fx, els = [], ms = 650;
    function add(cls, html) { var d = document.createElement('div'); d.className = 'hfx ' + cls; if (html) d.innerHTML = html; fx.appendChild(d); els.push(d); return d; }
    if (lv === 1) {
      add('hfx-ice', Art.fx('ice'));
      H.item.classList.add('frozen');
      clearTimeout(H.fxT);
      H.fxT = setTimeout(function () { H.item.classList.remove('frozen'); }, 520);
    } else if (lv === 2) {
      add('hfx-fire', Art.fx('fire'));
      for (var i = 0; i < 5; i++) {
        var e = add('hfx-ember');
        e.style.setProperty('--x', rand(20, 78).toFixed(0) + '%');
        e.style.setProperty('--dx', rand(-30, 30).toFixed(0) + 'px');
      }
      H.item.classList.add('burning');
      clearTimeout(H.fxT);
      H.fxT = setTimeout(function () { H.item.classList.remove('burning'); }, 560);
      ms = 720;
    } else if (lv === 3) {
      add('hfx-ring');
      add('hfx-star', Art.fx('star'));
      if (!reduceMotion) restartClass(H.el, 'jolt');
    } else {
      add('hfx-flash');
      add('hfx-bolt', Art.fx('bolt'));
      ms = 420;
    }
    setTimeout(function () { els.forEach(function (d) { d.remove(); }); }, ms);
  }
  function puff(H) {
    var d = document.createElement('i');
    d.className = 'puff';
    d.style.setProperty('--x', '50%');
    d.style.setProperty('--y', '62%');
    H.fx.appendChild(d);
    setTimeout(function () { d.remove(); }, 400);
  }
  function boom(H) {
    var d = document.createElement('div');
    d.className = 'boom';
    d.innerHTML = Art.boom();
    H.fx.appendChild(d);
    for (var i = 0; i < 3; i++) {
      var s = document.createElement('i');
      s.className = 'smoke';
      s.style.setProperty('--x', rand(10, 60).toFixed(0) + '%');
      s.style.setProperty('--y', rand(10, 50).toFixed(0) + '%');
      H.fx.appendChild(s);
      setTimeout(function (el) { el.remove(); }.bind(null, s), 950);
    }
    setTimeout(function () { d.remove(); }, 700);
    if (!reduceMotion) restartClass(app, 'shake');
    setTimeout(function () { app.classList.remove('shake'); }, 460);
    restartClass($('g-flash'), 'on');
    if (navigator.vibrate) { try { navigator.vibrate([70, 40, 140]); } catch (e) { /* bỏ qua */ } }
  }

  var PRAISE = { 20: 'Huyền thoại!', 30: 'Không thể cản!' };
  function updateCombo(t) {
    var c = G.game.combo, el = $('g-combo'), hl = hammerLevels();
    setHammerSkin(c >= hl[2] ? 3 : c >= hl[1] ? 2 : c >= hl[0] ? 1 : (G.hammerSkin && c > 0 ? G.hammerSkin : 0));
    if (c < 2) return;
    el.classList.add('on');
    el.setAttribute('data-tier', c >= 20 ? 4 : c >= hl[2] ? 3 : c >= hl[0] ? 2 : 1);
    if (c !== G.comboShown) {
      $('g-combo-n').textContent = 'x' + c;
      restartClass($('g-combo-n'), 'pop');
      var hi = hl.indexOf(c);
      var hbp = (G.cfg.combo.hammerBonus || [50, 100, 150])[hi];
      var praise = hi >= 0 ? HAMMER_SKINS[hi + 1].name + ' +' + hbp + '% điểm!' : (PRAISE[c] || (c > 30 && c % 10 === 0 ? 'Combo x' + c + '!' : ''));
      if (praise) {
        var pr = $('g-combo-praise');
        pr.textContent = praise;
        restartClass(pr, 'pop');
        Sound.play('combo');
      }
      G.comboShown = c;
    }
    restartComboTimer(G.cfg.combo.windowMs - (t - G.game.lastHitAt));
  }
  function restartComboTimer(ms) {
    var bar = $('g-combo-bar');
    if (G.comboAnim) G.comboAnim.cancel();
    if (!bar.animate) return;
    G.comboAnim = bar.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: Math.max(50, ms), easing: 'linear', fill: 'forwards' });
  }

  function onTapResult(r, H, t) {
    if (r.kind === 'miss') { puff(H); Sound.play('miss'); return; }
    if (r.kind === 'ignored') return;
    if (r.kind === 'bomb') {
      boom(H);
      Sound.play('bomb');
      renderLives();
      $('g-combo').classList.remove('on');
      G.comboShown = 0;
      setHammerSkin(0);
      if (r.dead) { onDeath(t); return; }
      var left = G.cfg.bombs.strikes - r.strikes;
      setTimeout(function () { Sound.play('warn'); }, 300);
      banner('CẢNH BÁO!', 'Trúng thêm ' + left + ' quả bom nữa là thua!', true);
      var lives = $('g-lives').children;
      if (lives[r.strikes - 1]) restartClass(lives[r.strikes - 1], 'warn');
      return;
    }
    squash(H);
    var type = r.spawn.type;
    if (r.kind === 'hit') {
      Sound.play('hit');
      particles(H, 'pumpkinIron', 3);
      if (type === 'pumpkinCloth' && r.hitNo === 1) flyHat(H, 'cloth');
      if (type === 'pumpkinIron' && r.hitNo === 2) flyHat(H, 'iron');
      updateCombo(t);
      hammerFx(H);
      return;
    }
    // hạ gục
    Sound.play('kill', { combo: r.combo });
    particles(H, type, type.indexOf('pumpkin') === 0 ? 9 : 7);
    floatPoints(H, r.base, r.bonus, r.hammer, r.hammerLevel);
    if (type === 'pumpkinCloth' && r.hitNo === 1) flyHat(H, 'cloth');
    var sc = $('g-score');
    sc.textContent = fmtNum(G.game.score);
    restartClass(sc, 'bump');
    updateCombo(t);
    hammerFx(H);
    updateTierbar();
    checkTiers();
  }

  function checkTiers() {
    var score = G.game.score;
    G.tiers.forEach(function (t) {
      if (G.crossed[t.id] || score < t.score) return;
      G.crossed[t.id] = true;
      if (!t.reward) { toast('Vượt mốc ' + t.score + ' điểm!', 'Cố lên, quà đang ở phía trước', 'good', 'star'); return; }
      Sound.play('tier');
      if (ownedFull(t.id)) toast('Đã vượt mốc ' + (t.short || t.label), 'Bạn đã sở hữu voucher này rồi', 'good', 'check');
      else toast('Mở khóa ' + t.label + '!', 'Tạm dừng → Kết thúc ngay để nhận, hoặc chơi tiếp để săn mốc cao hơn', 'good', 'gift');
    });
  }

  // ---------------------------------------------------------------- đồng bộ với server
  function sync(paused, opts) {
    if (!G.sid) return Promise.resolve();
    if (G.syncing) { G.syncQueued = { paused: paused, opts: opts }; return Promise.resolve(); }
    G.syncing = true;
    var batch = G.events.slice(G.acked, G.acked + 700);
    var body = { sid: G.sid, base: G.acked, ev: batch, gt: Math.floor(gameNow()), paused: !!paused };
    if (Bot.reason) body.bot = Bot.reason;
    return API.post('/api/game/sync', body, { keepalive: !!(opts && opts.keepalive) }).then(function (d) {
      if (d.ended) { serverEnded(d.result); return; }
      if (d.acked > G.acked) G.acked = d.acked;
    }).catch(function (e) {
      if (e.code === 'resync' && e.data && e.data.acked !== undefined) G.acked = e.data.acked;
      else if (e.status === 401) authLost(e);
    }).then(function () {
      G.syncing = false;
      var q = G.syncQueued;
      G.syncQueued = null;
      if (q && G.sid) sync(q.paused, q.opts);
    });
  }

  function serverEnded(result) {
    if (G.state === 'ended') return;
    stopLoop();
    G.state = 'ended';
    G.sid = null;
    closeModal('ov-pause');
    showResult(result, 'server');
  }

  function stopLoop() {
    cancelAnimationFrame(G.raf);
    clearInterval(G.syncTimer);
    clearInterval(G.watchdog);
    app.classList.remove('is-playing');
    hammer.classList.remove('mouse');
  }

  function finishToServer(reason, gt) {
    var attempt = 0;
    function flush() {
      if (G.events.length - G.acked <= 700) return Promise.resolve();
      return sync(true).then(function () { return G.events.length - G.acked > 700 ? sleep(300).then(flush) : null; });
    }
    function send() {
      return API.post('/api/game/finish', { sid: G.sid, base: G.acked, ev: G.events.slice(G.acked), gt: Math.floor(gt), reason: reason, bot: Bot.reason || undefined })
        .then(function (d) { G.sid = null; return d.result; })
        .catch(function (e) {
          if (e.code === 'resync' && e.data && e.data.acked !== undefined) { G.acked = e.data.acked; return send(); }
          if ((e.status === 0 || e.status >= 500 || e.status === 429) && attempt < 8) {
            attempt++;
            $('go-sending').textContent = 'Mất kết nối, đang thử gửi lại kết quả (' + attempt + ')...';
            return sleep(Math.min(8000, 900 * attempt)).then(send);
          }
          throw e;
        });
    }
    var wait = G.syncing ? sleep(400) : Promise.resolve();
    return wait.then(flush).then(send);
  }

  // ---------------------------------------------------------------- tạm dừng
  function predictAward(score) {
    var guide = App.me.guide;
    var tiers = G.tiers.filter(function (t) { return t.reward; }).sort(function (a, b) { return b.score - a.score; });
    var eligible = tiers.filter(function (t) { return score >= t.score; });
    if (!eligible.length) return { status: 'none' };
    var cands = guide.fallback ? eligible : [eligible[0]];
    for (var i = 0; i < cands.length; i++) {
      if (!ownedFull(cands[i].id)) return { status: 'issue', tier: cands[i] };
    }
    return { status: 'owned', tier: eligible[0] };
  }

  function pauseGame(auto) {
    if (G.state !== 'playing') return;
    G.pausedAt = performance.now();
    G.state = 'paused';
    stopLoop();
    if (G.comboAnim) G.comboAnim.pause();
    sync(true, { keepalive: !!auto });
    G.syncTimer = setInterval(function () { sync(true); }, 20000);
    var score = G.game.score;
    $('p-score').textContent = fmtNum(score);
    var pa = predictAward(score), ts = E.tierStatus(G.tiers, score), html;
    if (pa.status === 'issue') html = 'Kết thúc ngay, bạn nhận: <b>' + esc(pa.tier.label) + '</b>';
    else if (pa.status === 'owned') html = 'Bạn đã có <b>' + esc(pa.tier.label) + '</b> — kết thúc lúc này sẽ không nhận thêm voucher.';
    else html = 'Chưa đạt mốc quà.';
    if (ts.nextReward) html += '<br>Còn <b>' + fmtNum(ts.need) + ' điểm</b> nữa để mở khóa ' + esc(ts.nextReward.short || ts.nextReward.label) + '.';
    $('p-award').innerHTML = html;
    $('p-main').hidden = false;
    $('p-confirm').hidden = true;
    paintSoundButtons();
    openModal('ov-pause');
  }

  function resumeGame() {
    if (G.state !== 'paused') return;
    Sound.play('click');
    closeModal('ov-pause');
    G.state = 'resuming';
    runCountdown(true).then(function () {
      if (G.state !== 'resuming') return;
      G.t0 += performance.now() - G.pausedAt;
      G.pausedAt = null;
      G.state = 'playing';
      app.classList.add('is-playing');
      if (G.comboAnim) G.comboAnim.play();
      clearInterval(G.syncTimer);
      G.syncTimer = setInterval(function () { sync(false); }, 3000);
      sync(false);
      startFrames();
    });
  }

  $('btn-pause').addEventListener('click', function () { Sound.play('click'); pauseGame(false); });
  $('btn-resume').addEventListener('click', resumeGame);
  $('btn-quit').addEventListener('click', function () {
    Sound.play('click');
    var pa = predictAward(G.game.score);
    $('p-confirm-text').textContent = 'Kết thúc lượt chơi với ' + fmtNum(G.game.score) + ' điểm' +
      (pa.status === 'issue' ? ' và nhận ' + pa.tier.label + '?' : '?');
    $('p-main').hidden = true;
    $('p-confirm').hidden = false;
    $('btn-quit-yes').focus();
  });
  $('btn-quit-no').addEventListener('click', function () { $('p-main').hidden = false; $('p-confirm').hidden = true; $('btn-resume').focus(); });
  $('btn-quit-yes').addEventListener('click', function () {
    if (G.state !== 'paused') return;
    var btn = this;
    btn.classList.add('is-loading');
    G.state = 'ending';
    clearInterval(G.syncTimer);
    var gt = gameNow();
    finishToServer('quit', gt).then(function (res) {
      btn.classList.remove('is-loading');
      closeModal('ov-pause');
      G.state = 'ended';
      showResult(res, 'quit');
    }).catch(function (e) {
      btn.classList.remove('is-loading');
      G.state = 'paused';
      if (e.status === 401) authLost(e); else toast('Chưa gửi được kết quả', e.message, 'bad');
    });
  });

  document.addEventListener('visibilitychange', function () { if (document.hidden && G.state === 'playing') pauseGame(true); });
  window.addEventListener('pagehide', function () { if (G.state === 'playing') pauseGame(true); });
  window.addEventListener('blur', function () { if (G.state === 'playing') pauseGame(true); });

  // ---------------------------------------------------------------- không thao tác quá lâu
  function onIdleEnd(t) {
    if (G.state !== 'playing') return;
    G.state = 'ending';
    stopLoop();
    $('g-idle').hidden = true;
    var timeUp = G.game.maxMs && t >= G.game.maxMs - 50;
    if (timeUp) banner('HẾT GIỜ!', 'Lượt chơi đã đủ ' + Math.round(G.game.maxMs / 60000) + ' phút', true);
    else banner('HẾT GIỜ CHỜ', 'Bạn không thao tác trong ' + Math.round(G.game.idleMs / 1000) + ' giây', true);
    var gt = Math.max(t, gameNow());
    finishToServer('quit', gt).then(function (res) {
      G.state = 'ended';
      showResult(res, timeUp ? 'time' : 'idle');
    }).catch(function (e) {
      G.state = 'ended';
      if (e.status === 401) authLost(e); else showMessage({ title: 'Chưa gửi được kết quả', text: e.message, mood: 'sad', actions: [{ label: 'Về trang chủ', onClick: goHome }] });
    });
  }

  // ---------------------------------------------------------------- thua (trúng bom)
  function onDeath(t) {
    G.state = 'ending';
    stopLoop();
    $('g-idle').hidden = true;
    render(t);
    setTimeout(function () { Sound.play('gameover'); }, 550);
    var titles = (App.me && App.me.guide && App.me.guide.gameOver) || ['BÙM! Trúng bom rồi!', 'Ối dồi ôi, bom nổ tung!', 'Bom không phải để đập đâu!'];
    var shown = new Promise(function (r) {
      setTimeout(function () {
        $('go-title').textContent = pick(titles);
        $('go-sending').textContent = 'Đang tính điểm...';
        $('ov-gameover').hidden = false;
        r();
      }, 650);
    });
    var minShow = sleep(2500);
    Promise.all([finishToServer('bomb', Math.max(t, gameNow())), shown, minShow]).then(function (arr) {
      $('ov-gameover').hidden = true;
      G.state = 'ended';
      showResult(arr[0], 'bomb');
    }).catch(function (e) {
      $('ov-gameover').hidden = true;
      G.state = 'ended';
      if (e.status === 401) authLost(e);
      else showMessage({ title: 'Chưa gửi được kết quả', text: (e.message || '') + ' Kết quả của bạn vẫn được hệ thống ghi nhận khi kết nối ổn định trở lại.', mood: 'sad', actions: [{ label: 'Về trang chủ', onClick: goHome }] });
    });
  }

  function closeAllPlayOverlays() {
    ['ov-pause', 'md-result'].forEach(closeModal);
    $('ov-gameover').hidden = true;
    $('g-count').innerHTML = '';
  }

  // ================================================================ kết quả
  function registerUrl(tier, code) {
    var u;
    try { u = new URL(tier.url); } catch (e) { return null; }
    var g = App.me.guide;
    if (g.utm) {
      u.searchParams.set('utm_source', 'inet_portal');
      u.searchParams.set('utm_medium', 'minigame');
      u.searchParams.set('utm_campaign', 'halloween2026');
      u.searchParams.set('utm_content', tier.id);
    }
    if (g.codeParam && code) u.searchParams.set(g.codeParam, code);
    return u.toString();
  }

  function openRegister(tier, code, source) {
    var url = tier && registerUrl(tier, code);
    if (!url) { toast('Chưa có đường dẫn đăng ký cho voucher này', null, 'bad'); return; }
    var a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    track('register_click', { tierId: tier.id, source: source, sessionId: G.lastSid });
  }

  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    }
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    }
    return Promise.resolve(fallback());
  }

  // Nút "Nhận coupon": lần 1 gọi API hiện mã, lần 2 sao chép mã.
  function bindCodeButton(btn, coupon, onReveal) {
    function paintCode() {
      btn.className = 'code-btn';
      btn.innerHTML = '<span class="code">' + esc(coupon.code) + '</span><small>Chạm để sao chép</small>';
      btn.setAttribute('aria-label', 'Sao chép mã ' + coupon.code);
    }
    if (coupon.code) paintCode();
    btn.addEventListener('click', function () {
      if (btn.classList.contains('is-loading')) return;
      if (!coupon.code) {
        btn.classList.add('is-loading');
        API.post('/api/coupons/' + coupon.id + '/reveal', {}).then(function (d) {
          coupon.code = d.coupon.code;
          coupon.revealed = true;
          btn.classList.remove('is-loading');
          paintCode();
          Sound.play('reveal');
          if (onReveal) onReveal(coupon.code);
        }).catch(function (e) {
          btn.classList.remove('is-loading');
          toast(e.message, null, 'bad');
        });
        return;
      }
      copyText(coupon.code).then(function (ok) {
        if (ok) {
          btn.classList.add('copied');
          btn.querySelector('small').textContent = 'Đã sao chép ✓';
          Sound.play('click');
          track('coupon_copy', { couponId: coupon.id, tierId: coupon.tierId });
          setTimeout(function () { btn.classList.remove('copied'); var s = btn.querySelector('small'); if (s) s.textContent = 'Chạm để sao chép'; }, 2200);
        } else {
          var sel = window.getSelection(), range = document.createRange();
          range.selectNodeContents(btn.querySelector('.code'));
          sel.removeAllRanges(); sel.addRange(range);
          toast('Hãy nhấn giữ mã để sao chép', null, 'bad', 'copy');
        }
      });
    });
  }

  // metaText: dòng thứ 2 (mặc định "HSD: dd/mm/yyyy")
  function voucherHtml(tier, cls, statusText, statusCls, expiresAt, metaText) {
    var pct = tier.discount ? '<div class="v-pct">' + tier.discount + '%<small>GIẢM</small></div>' : '<div class="v-pct">' + Art.ui('gift') + '</div>';
    var name = tier.product ? 'Voucher đăng ký mới / gia hạn / nâng cấp dịch vụ ' + tier.product : (tier.label || 'Voucher');
    var meta = metaText || (expiresAt ? 'HSD: ' + fmtDate(expiresAt) : '');
    return '<div class="voucher ' + (cls || '') + '">' + pct +
      '<div><div class="v-name">' + esc(name) + '</div>' + (meta ? '<div class="v-meta">' + esc(meta) + '</div>' : '') + '</div>' +
      (statusText ? '<span class="v-status ' + (statusCls || '') + '">' + esc(statusText) + '</span>' : '') + '</div>';
  }

  function showResult(res, how) {
    closeAllPlayOverlays();
    var me = App.me;
    me.player.bestScore = res.best.score;
    me.player.bestCombo = res.best.combo;
    me.owned = res.owned;
    me.turns = res.turns;
    var aw = res.award || {}, tier = aw.tier, cp = aw.coupon;
    var won = aw.status === 'issued' || aw.status === 'pending' || aw.status === 'held';
    var cheat = aw.status === 'invalid';
    var mood = won ? 'happy' : (how === 'bomb' || cheat ? 'sad' : 'idle');
    var expires = (cp && cp.expiresAt) || me.guide.couponExpiresAt;
    var h = '<div class="res-mascot">' + Art.mascot(mood) + '</div>';
    h += '<h2 class="res-title" id="res-title">' + esc(cheat ? 'Phát hiện chơi hộ / gian lận!' : (res.message || (won ? 'Chúc mừng bạn!' : 'Cố lên nhé!'))) + '</h2>';
    h += '<div class="res-score"><span>Điểm</span><b>' + fmtNum(res.score) + '</b>' + (res.newBest ? '<em class="badge-best">Kỷ lục mới!</em>' : '') + '</div>';
    h += '<div class="res-stats"><span>Combo x' + res.maxCombo + '</span><span>Level ' + res.level + '</span><span>' + fmtDur(res.durationMs) + '</span></div>';
    if (res.endReason === 'time') h += '<p class="res-note">Hết thời gian lượt chơi (' + Math.round(((G.cfg && G.cfg.rules && G.cfg.rules.maxMs) || 300000) / 60000) + ' phút). Điểm được tính đến lúc hết giờ.</p>';
    if (res.endReason === 'idle') h += '<p class="res-note">Lượt chơi tự kết thúc vì bạn không thao tác trong ' + Math.round(((G.cfg && G.cfg.rules && G.cfg.rules.idleMs) || 10000) / 1000) + ' giây.</p>';
    if (aw.status === 'invalid') {
      h += '<div class="res-block"><b>Lượt chơi đã bị huỷ</b>Hệ thống phát hiện thao tác bất thường (công cụ tự động, trợ lý AI chơi hộ, tiện ích điều khiển trình duyệt, can thiệp dữ liệu hoặc tốc độ không phải của người chơi). Kết quả không được ghi nhận và không được nhận voucher.' +
        (res.lockedUntil ? '<br><b>Bạn đã gian lận nhiều lượt liên tiếp nên tạm thời chưa thể chơi đến ' + fmtTime(res.lockedUntil) + ' ' + fmtDate(res.lockedUntil) + '.</b>' : (res.banned ? '<br><b>Tài khoản của bạn đã bị khoá khỏi chương trình.</b>' : ' Gian lận nhiều lượt liên tiếp, bạn sẽ bị tạm khoá chơi 1 ngày.')) + '</div>';
    } else if (won && tier) {
      h += voucherHtml(tier, '', aw.status === 'held' ? 'Đang xác minh' : '', aw.status === 'held' ? 's-held' : '', expires);
      if (aw.status === 'held') {
        h += '<p class="res-note">Voucher đang được xác minh. Mã sẽ xuất hiện trong "Coupon của tôi" sau khi hoàn tất.</p>';
      } else {
        h += '<div class="res-actions"><button class="btn btn-primary" id="res-claim" type="button">' + Art.ui('ticket') + 'Nhận coupon</button>' +
          '<button class="btn btn-gold" id="res-register" type="button">' + Art.ui('external') + 'Đăng ký ngay</button></div>';
      }
    } else if (aw.status === 'owned' && tier) {
      h += voucherHtml(tier, 'muted', 'Đã sở hữu', 's-redeemed', null);
      h += '<div class="res-actions"><button class="btn btn-gold" id="res-register" type="button">' + Art.ui('external') + 'Đăng ký ngay</button></div>';
    } else if (aw.status === 'sold_out' && tier) {
      h += '<p class="res-next">Rất tiếc, <b>' + esc(tier.label) + '</b> đã được trao hết. Hãy thử sức ở mốc khác nhé!</p>';
    }
    if (res.next && aw.status !== 'invalid') {
      var prog = Math.min(1, Math.max(0, res.score / res.next.score));
      h += '<div class="res-next">Còn <b>' + fmtNum(res.next.need) + ' điểm</b> nữa để mở khóa <b>voucher ' + esc(res.next.short || res.next.label) + '</b>' +
        '<div class="mini-bar"><i style="transform:scaleX(' + prog.toFixed(3) + ')"></i></div></div>';
    }
    var tt = res.turns || me.turns, total = tt.turns + (tt.bonus || 0);
    var turnsText = total > 0 ? 'Chơi tiếp (còn ' + total + ' lượt)' : (tt.nextAt ? 'Hết lượt — hồi sau ' + fmtClock(tt.nextAt - now()) : 'Hết lượt');
    h += '<div class="res-icons"><button class="round-btn primary" id="res-replay" type="button" title="' + esc(turnsText) + '" aria-label="' + esc(turnsText) + '"' + (total > 0 ? '' : ' disabled') + '><span class="disc">' + Art.ui('replay') + '</span>' +
      (total > 0 ? '<i class="turn-badge">' + total + '</i>' : '') + '</button>' +
      '<button class="round-btn" id="res-home" type="button" title="Về trang chủ" aria-label="Về trang chủ"><span class="disc">' + Art.ui('home') + '</span></button></div>';
    if (res.banned || res.lockedUntil) h = h.replace('id="res-replay" type="button"', 'id="res-replay" type="button" disabled');
    var body = $('res-body');
    body.innerHTML = h;
    setScreen('home');
    paintHomeStats();
    clearInterval(App.ticker);
    openModal('md-result');
    Sound.music('home');
    if (won) Sound.play('win');

    var claim = $('res-claim');
    var currentCode = cp && cp.code;
    if (claim && cp) bindCodeButton(claim, cp, function (code) { currentCode = code; });
    var reg = $('res-register');
    if (reg) reg.addEventListener('click', function () { Sound.play('click'); openRegister(tier, currentCode, 'result'); });
    $('res-replay').addEventListener('click', function () {
      closeModal('md-result');
      showHome();
      startGame();
    });
    $('res-home').addEventListener('click', function () { Sound.play('click'); goHome(); });
  }

  function goHome() {
    closeModal('md-result');
    closeModal('md-msg');
    refreshMe().then(showHome, showHome);
  }

  // ================================================================ hướng dẫn
  var ITEM_ORDER = ['pumpkin', 'pumpkinCloth', 'pumpkinIron', 'ghost', 'virus', 'potion', 'candy'];
  function openGuide() {
    var g = App.me.guide, c = App.me.campaign;
    track('guide_open');
    // Ô vật phẩm: tên ở trên (căn giữa), dưới là hình + thông tin (đập mấy lần, điểm)
    function card(cls, type, name, icon, lines) {
      return '<div class="item-card' + (cls ? ' ' + cls : '') + '"' + (type ? ' data-type="' + type + '"' : '') + '><b class="ic-name">' + esc(name) + '</b>' +
        '<div class="ic-body">' + icon + '<div class="ic-info">' + lines.map(function (l) { return '<span>' + esc(l) + '</span>'; }).join('') + '</div></div></div>';
    }
    function pts(it) { return (it.hp > 1 ? ['Đập ' + it.hp + ' lần'] : []).concat(['+' + it.points + ' điểm']); }
    var items = ITEM_ORDER.filter(function (k) { return g.items[k] && g.items[k].enabled; }).map(function (k) {
      return card('', k, g.items[k].label, Art.icon(k), pts(g.items[k]));
    }).join('');
    if (g.boss && g.boss.enabled) {
      ['boss', 'bossArmor'].forEach(function (k) {
        var it = g.items[k];
        if (it && it.enabled) items += card('boss', k, it.label, Art.icon(k).replace('<div class="boss-hp"><i></i></div>', ''), pts(it));
      });
    }
    // Bom đặc biệt nên để cuối cùng
    if (g.items.bomb && g.items.bomb.enabled) items += card('danger', 'bomb', g.items.bomb.label, Art.icon('bomb'), ['Không', 'được đập!']);
    var hl = (g.combo && g.combo.hammer && g.combo.hammer.length === 3) ? g.combo.hammer : [3, 5, 8];
    var hbn = (g.combo && g.combo.hammerBonus && g.combo.hammerBonus.length === 3) ? g.combo.hammerBonus : [50, 100, 150];
    var hammers = [1, 2, 3].map(function (lv) {
      return card('hammer-card', '', HAMMER_SKINS[lv].name, '<div class="hammer-ico hm-skin" data-skin="' + HAMMER_SKINS[lv].key + '">' + Art.hammer() + '</div>', ['Combo x' + hl[lv - 1], '+' + hbn[lv - 1] + '% điểm']);
    }).join('');
    var rewards = g.tiers.filter(function (t) { return t.reward; }).sort(function (a, b) { return a.score - b.score; });
    var tierRows = rewards.map(function (t) {
      return '<tr><td><b>' + fmtNum(t.score) + ' điểm</b></td><td>Giảm <b>' + t.discount + '%</b> khi đăng ký mới / gia hạn / nâng cấp dịch vụ ' + esc(t.product || '') + '</td></tr>';
    }).join('');
    var html =
      '<section><h3>1. Cách chơi</h3><ul>' +
      '<li>Bạn hãy dùng chiếc búa sấm sét của Thor để đập hội bí ngô và đám quái Halloween đang quậy phá.</li>' +
      '<li>Đập trúng liên tiếp để giữ combo và nhận thêm điểm; chậm tay hoặc trúng bom sẽ mất chuỗi.</li>' +
      '<li>Mỗi tài khoản có tối đa ' + g.turns.max + ' lượt, mỗi ' + g.turns.regenMinutes + ' phút hồi sinh 1 lượt chơi.</li>' +
      '<li><span class="kb-row"><span>Trên máy tính có thể chơi bằng <b>chuột</b> hoặc <b>bàn phím số 1–9</b> (numpad): mỗi phím ứng với 1 ô đúng vị trí như hình.</span>' +
        '<span class="kb-pad" aria-hidden="true">' + [7, 8, 9, 4, 5, 6, 1, 2, 3].map(function (n) { return '<i>' + n + '</i>'; }).join('') + '</span></span></li></ul></section>' +
      '<section><h3>2. Vật phẩm &amp; điểm</h3><div class="items-grid">' + items + '</div>' +
      '<p class="guide-warn">⚠️ Bom có thể hóa trang trà trộn vào vật phẩm, hãy tinh mắt chú ý</p>' +
      '<p class="guide-sub">🔥 Giữ combo để nâng cấp búa — búa càng xịn, điểm càng <b>nhân lên</b>!</p><div class="items-grid hammers-grid">' + hammers + '</div></section>' +
      '<section><h3>3. Thể lệ nhận voucher</h3><table class="tier-table"><tbody>' + tierRows + '</tbody></table></section>' +
      '<section><h3>4. Lưu ý</h3><ul>' +
      '<li>Chương trình diễn ra từ ' + esc(c.periodText || (fmtDate(c.start) + ' – ' + fmtDate(c.end))) + '.</li>' +
      (g.maxSeconds ? '<li>Mỗi lượt chơi tối đa ' + (g.maxSeconds % 60 ? g.maxSeconds + ' giây' : (g.maxSeconds / 60) + ' phút') + '.</li>' : '') +
      (g.idleSeconds ? '<li>Không thao tác trong ' + g.idleSeconds + ' giây khi đang chơi sẽ tự kết thúc lượt.</li>' : '') +
      '<li>Mỗi voucher dùng 1 lần, hạn dùng đến ' + fmtTime(g.couponExpiresAt) + ' ngày ' + fmtDate(g.couponExpiresAt) + '.</li></ul></section>';
    $('guide-body').innerHTML = html;
    openModal('md-guide');
  }

  // ================================================================ coupon của tôi
  var STATUS_TEXT = { active: 'Chưa sử dụng', redeemed: 'Đã sử dụng', expired: 'Hết hạn', held: 'Đang xác minh', pending: 'Đang tạo mã', revoked: 'Đã thu hồi' };
  // Chỉ hiện 3 voucher mới nhất; mã hiện thẳng trên voucher (tự lấy mã cho voucher chưa xem), nút Đăng ký đặt cạnh
  var CP_SHOW = 3;
  function openCoupons() {
    track('coupons_open');
    var body = $('cp-body');
    body.innerHTML = '<p class="cp-empty">Đang tải...</p>';
    openModal('md-coupons');
    var g = App.me.guide;
    var rewards = g.tiers.filter(function (t) { return t.reward; }).sort(function (a, b) { return a.score - b.score; });
    API.get('/api/coupons').then(function (d) {
      var list = d.coupons.slice().sort(function (a, b) { return (b.createdAt - a.createdAt) || (b.id - a.id); }).slice(0, CP_SHOW);
      return Promise.all(list.map(function (c) {
        if (c.code || !(c.status === 'active' || c.status === 'redeemed' || c.status === 'pending')) return c;
        return API.post('/api/coupons/' + c.id + '/reveal', {}).then(function (r) { return Object.assign(c, r.coupon); }, function () { return c; });
      }));
    }).then(function (list) {
      if (!list.length) {
        var first = rewards[0];
        body.innerHTML = '<p class="cp-empty">Bạn chưa có voucher nào.' + (first ? ' Đạt <b>' + first.score + ' điểm</b> để nhận voucher đầu tiên!' : '') + '</p>';
        return;
      }
      var html = '<div class="cp-list">' + list.map(function (c) {
        var t = rewards.find(function (x) { return x.id === c.tierId; }) || { id: c.tierId, discount: c.discount, product: c.product, url: c.url };
        var st = c.status, off = st !== 'active';
        var codeHtml = c.code
          ? '<button class="cp-code" type="button" data-copy="' + c.id + '" title="Chạm để sao chép">' + esc(c.code) + '</button>'
          : '<span class="cp-code is-wait">' + esc(STATUS_TEXT[st] || 'Đang tạo mã') + '</span>';
        var desc = 'Đăng ký mới / gia hạn / nâng cấp dịch vụ ' + (t.product || c.product || '') + (st === 'redeemed' ? ' · đã sử dụng' : st === 'expired' ? ' · đã hết hạn' : '');
        var got = '<span class="cp-time" title="Thời điểm nhận voucher">' + fmtTime(c.createdAt) + ' ' + fmtDate(c.createdAt) + '</span>';
        return '<div class="cp-row"><div class="voucher cp-voucher' + (off ? ' muted' : '') + '">' + got +
          '<div class="v-pct">' + (t.discount || c.discount || 0) + '%<small>GIẢM</small></div>' +
          '<div class="cp-main">' + codeHtml + '<div class="v-meta">' + esc(desc) + '</div></div></div>' +
          '<button class="btn btn-gold cp-reg" type="button" data-reg="' + c.id + '"' + (st === 'active' ? '' : ' disabled') + '>Đăng ký</button></div>';
      }).join('') + '</div><p class="cp-hsd">HSD: ' + fmtTime(g.couponExpiresAt) + ' ' + fmtDate(g.couponExpiresAt) + '</p>';
      body.innerHTML = html;
      list.forEach(function (c) {
        var cb = body.querySelector('[data-copy="' + c.id + '"]');
        if (cb) cb.addEventListener('click', function () {
          copyText(c.code).then(function (ok) {
            if (!ok) return;
            cb.classList.add('copied');
            Sound.play('click');
            toast('Đã sao chép mã ' + c.code, null, 'good', 'check');
            track('coupon_copy', { couponId: c.id, tierId: c.tierId });
            setTimeout(function () { cb.classList.remove('copied'); }, 1600);
          });
        });
        var reg = body.querySelector('[data-reg="' + c.id + '"]');
        if (reg) reg.addEventListener('click', function () {
          var t = rewards.find(function (x) { return x.id === c.tierId; }) || { id: c.tierId, url: c.url };
          openRegister(t, c.code, 'coupons');
        });
      });
    }).catch(function (e) { body.innerHTML = '<p class="cp-empty">' + esc(e.message) + '</p>'; });
  }

  // ================================================================ bảng vàng
  function openLeaderboard() {
    track('leaderboard_open');
    var body = $('lb-body');
    body.innerHTML = '<p class="cp-empty">Đang tải...</p>';
    openModal('md-board');
    API.get('/api/leaderboard').then(function (d) {
      if (!d.top.length) { body.innerHTML = '<p class="cp-empty">Chưa có ai ghi danh. Hãy là người đầu tiên!</p>'; return; }
      body.innerHTML = '<ol class="lb-list">' + d.top.map(function (r, i) {
        return '<li class="' + (r.me ? 'me' : '') + '"><span class="lb-rank">' + (i + 1) + '</span><span>' + esc(r.id) + (r.me ? ' (bạn)' : '') + '</span><b>' + fmtNum(r.score) + '</b></li>';
      }).join('') + '</ol>' + (d.me.rank ? '<p class="res-note">Hạng của bạn: <b>#' + d.me.rank + '</b> với ' + fmtNum(d.me.score) + ' điểm.</p>' : '');
    }).catch(function (e) { body.innerHTML = '<p class="cp-empty">' + esc(e.message) + '</p>'; });
  }

  // ================================================================ lỗi phiên đăng nhập
  function authLost(e) {
    stopLoop();
    G.state = 'idle';
    API.setToken(null);
    closeAllPlayOverlays();
    showGate((e && e.message) || 'Phiên đăng nhập đã hết hạn, vui lòng tải lại trang Portal.');
  }

  // ================================================================ khởi động
  // ================================================================ chống thu phóng trên điện thoại
  // Safari iOS bỏ qua user-scalable=no nên phải chặn bằng sự kiện: chạm nhanh 2 lần, chụm 2 ngón, dblclick.
  (function noZoom() {
    var FORM = /^(INPUT|TEXTAREA|SELECT)$/;
    var lastEnd = 0, lx = -999, ly = -999;
    document.addEventListener('touchend', function (e) {
      var now = Date.now(), t = e.changedTouches && e.changedTouches[0];
      var x = t ? t.clientX : 0, y = t ? t.clientY : 0;
      // 2 lần chạm nhanh gần cùng 1 chỗ = cử chỉ phóng to của Safari -> chặn lần thứ 2
      if (now - lastEnd < 400 && Math.abs(x - lx) < 60 && Math.abs(y - ly) < 60 && !FORM.test(e.target.tagName) && e.cancelable) e.preventDefault();
      lastEnd = now; lx = x; ly = y;
    }, { passive: false });
    document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1 && e.cancelable) e.preventDefault(); }, { passive: false });
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (t) { document.addEventListener(t, function (e) { e.preventDefault(); }, { passive: false }); });
    document.addEventListener('dblclick', function (e) { if (!FORM.test(e.target.tagName)) e.preventDefault(); }, { passive: false });
    // Trên bàn chơi: chặn luôn hành vi mặc định của chạm (đập vẫn nhận qua pointerdown)
    var bd = $('board');
    if (bd) bd.addEventListener('touchstart', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
    // Lỡ bị phóng to (cài đặt trợ năng, trang Portal bên ngoài...): ép trình duyệt trả về 100%
    var vv = window.visualViewport, meta = $('meta-vp');
    if (vv && meta) {
      var base = meta.getAttribute('content'), busy = false;
      vv.addEventListener('resize', function () {
        if (busy || vv.scale <= 1.02) return;
        busy = true;
        meta.setAttribute('content', base.replace('maximum-scale=1', 'maximum-scale=1.01'));
        setTimeout(function () { meta.setAttribute('content', base); busy = false; }, 60);
      });
    }
  })();

  function boot() {
    Array.prototype.forEach.call(document.querySelectorAll('.icon-btn.close'), function (b) { b.innerHTML = Art.ui('close'); });
    paintMascots();
    paintSoundButtons();
    var launch = readLaunchParams();
    if (window.parent !== window) { try { window.parent.postMessage({ type: 'hlw:ready' }, '*'); } catch (e) { /* bỏ qua */ } }
    Promise.all([loadAssets(), API.get('/api/public/config')]).then(function (arr) {
      App.cfg = arr[1];
      paintMascots();
      if (launch.access) { API.setToken(launch.access); return enterHome(); }
      if (launch.token) return loginPortal(launch.token).catch(function (e) { API.setToken(null); showGate(e.message); });
      if (API.token) return enterHome();
      if (App.cfg.guest) return loginGuest();
      showGate();
    }).catch(function () {
      showGate('Không kết nối được máy chủ trò chơi. Vui lòng thử lại sau ít phút.', true);
    });
  }

  boot();
}());
