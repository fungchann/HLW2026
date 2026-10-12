/*
 * Âm thanh: mặc định tổng hợp bằng Web Audio (không cần file).
 * Khi có nhạc/hiệu ứng riêng: khai báo trong /assets/assets.json -> "audio" (mp3/ogg), file sẽ được dùng thay thế.
 */
(function (root) {
  'use strict';
  var S = {
    enabled: true,
    ctx: null,
    master: null,
    files: {},
    buffers: {},
    musicName: null,
    musicEl: null,
    seqTimer: null
  };

  try { S.enabled = localStorage.getItem('hlw_sound') !== 'off'; } catch (e) { /* bỏ qua */ }

  S.setFiles = function (files) { S.files = files || {}; };

  S.unlock = function () {
    if (S.ctx) { if (S.ctx.state === 'suspended') S.ctx.resume(); return; }
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    S.ctx = new AC();
    S.master = S.ctx.createGain();
    S.master.gain.value = S.enabled ? 0.9 : 0;
    S.master.connect(S.ctx.destination);
    Object.keys(S.files).forEach(function (k) { if (S.files[k] && k.indexOf('bgm') !== 0) load(k); });
  };

  function load(name) {
    var url = S.files[name];
    if (!url || S.buffers[name] || !S.ctx) return;
    S.buffers[name] = 'loading';
    fetch(url).then(function (r) { return r.arrayBuffer(); })
      .then(function (b) { return S.ctx.decodeAudioData(b); })
      .then(function (buf) { S.buffers[name] = buf; })
      .catch(function () { delete S.buffers[name]; });
  }

  S.setEnabled = function (on) {
    S.enabled = !!on;
    try { localStorage.setItem('hlw_sound', on ? 'on' : 'off'); } catch (e) { /* bỏ qua */ }
    if (S.master) S.master.gain.setTargetAtTime(on ? 0.9 : 0, S.ctx.currentTime, 0.03);
    if (S.musicEl) { if (on) S.musicEl.play().catch(function () {}); else S.musicEl.pause(); }
  };

  // ------------------------------------------------------------ tổng hợp âm
  function tone(o) {
    var c = S.ctx, t = c.currentTime + (o.delay || 0);
    var osc = c.createOscillator(), g = c.createGain();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f1, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.3, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    osc.connect(g); g.connect(o.dest || S.master);
    osc.start(t); osc.stop(t + o.dur + 0.02);
  }
  var noiseBuf = null;
  function noise(o) {
    var c = S.ctx, t = c.currentTime + (o.delay || 0);
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    var src = c.createBufferSource(); src.buffer = noiseBuf;
    var f = c.createBiquadFilter(); f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.f1 || 2000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + o.dur);
    var g = c.createGain();
    g.gain.setValueAtTime(o.vol || 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
    src.connect(f); f.connect(g); g.connect(S.master);
    src.start(t); src.stop(t + o.dur + 0.05);
  }

  var SFX = {
    click: function () { tone({ f1: 1200, f2: 900, dur: 0.05, type: 'triangle', vol: 0.15 }); },
    miss: function () { noise({ f1: 1800, f2: 500, dur: 0.08, vol: 0.12, filter: 'bandpass' }); },
    hit: function () { tone({ f1: 260, f2: 120, dur: 0.12, type: 'sine', vol: 0.45 }); noise({ f1: 3000, f2: 800, dur: 0.05, vol: 0.18 }); },
    kill: function (o) {
      var k = Math.min(12, (o && o.combo) || 1);
      var f = 520 * Math.pow(2, k / 12);
      tone({ f1: 220, f2: 90, dur: 0.12, type: 'sine', vol: 0.45 });
      tone({ f1: f, f2: f * 1.5, dur: 0.11, type: 'square', vol: 0.08, delay: 0.02 });
      tone({ f1: f * 2, dur: 0.18, type: 'triangle', vol: 0.12, delay: 0.05 });
    },
    bomb: function () {
      noise({ f1: 2400, f2: 120, dur: 0.75, vol: 0.7 });
      tone({ f1: 110, f2: 32, dur: 0.6, type: 'sine', vol: 0.7 });
      tone({ f1: 70, f2: 30, dur: 0.9, type: 'triangle', vol: 0.4, delay: 0.05 });
    },
    warn: function () {
      for (var i = 0; i < 3; i++) {
        tone({ f1: 880, dur: 0.12, type: 'square', vol: 0.1, delay: i * 0.26 });
        tone({ f1: 620, dur: 0.12, type: 'square', vol: 0.1, delay: i * 0.26 + 0.13 });
      }
    },
    count: function () { tone({ f1: 660, dur: 0.16, type: 'triangle', vol: 0.3 }); },
    go: function () { tone({ f1: 990, dur: 0.32, type: 'triangle', vol: 0.32 }); tone({ f1: 1485, dur: 0.32, type: 'sine', vol: 0.12 }); },
    level: function () { [523, 659, 784, 1047].forEach(function (f, i) { tone({ f1: f, dur: 0.14, type: 'triangle', vol: 0.18, delay: i * 0.07 }); }); },
    tier: function () { [784, 988, 1175, 1568, 1976].forEach(function (f, i) { tone({ f1: f, dur: 0.22, type: 'sine', vol: 0.16, delay: i * 0.06 }); }); },
    combo: function () { tone({ f1: 400, f2: 1600, dur: 0.25, type: 'sawtooth', vol: 0.06 }); },
    gameover: function () { [392, 370, 349, 330].forEach(function (f, i) { tone({ f1: f, f2: i === 3 ? f * 0.7 : f * 0.97, dur: i === 3 ? 0.9 : 0.32, type: 'sawtooth', vol: 0.09, delay: i * 0.34 }); }); },
    win: function () { [523, 659, 784, 1047, 784, 1047].forEach(function (f, i) { tone({ f1: f, dur: i > 3 ? 0.4 : 0.16, type: 'triangle', vol: 0.2, delay: i * 0.11 }); }); },
    reveal: function () { [880, 1320, 1760].forEach(function (f, i) { tone({ f1: f, dur: 0.18, type: 'sine', vol: 0.16, delay: i * 0.05 }); }); }
  };

  S.play = function (name, opts) {
    if (!S.enabled || !S.ctx) return;
    var buf = S.buffers[name];
    if (buf && buf !== 'loading') {
      var src = S.ctx.createBufferSource(); src.buffer = buf;
      var g = S.ctx.createGain(); g.gain.value = 0.8;
      src.connect(g); g.connect(S.master); src.start();
      return;
    }
    if (SFX[name]) { try { SFX[name](opts); } catch (e) { /* bỏ qua */ } }
  };

  // ------------------------------------------------------------ nhạc nền
  // Vòng nhạc "ma quái" đơn giản (Rê thứ) khi chưa có file nhạc riêng.
  var SONGS = {
    home: { bpm: 104, bass: [38, 38, 45, 45, 46, 46, 45, 41], lead: [62, 0, 65, 64, 62, 0, 57, 0, 58, 0, 57, 55, 57, 0, 0, 0], vol: 0.05 },
    game: { bpm: 140, bass: [38, 50, 38, 50, 46, 58, 45, 57], lead: [74, 72, 70, 69, 70, 0, 69, 67, 69, 0, 65, 0, 62, 64, 65, 67], vol: 0.045 }
  };
  function midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }

  S.music = function (name) {
    if (S.musicName === name) return;
    S.stopMusic();
    S.musicName = name;
    var file = S.files[name === 'home' ? 'bgmHome' : 'bgmGame'];
    if (file) {
      S.musicEl = new Audio(file);
      S.musicEl.loop = true;
      S.musicEl.volume = 0.5;
      if (S.enabled) S.musicEl.play().catch(function () {});
      return;
    }
    if (!S.ctx) return;
    var song = SONGS[name];
    if (!song) return;
    var step = 60 / song.bpm / 2, i = 0, next = S.ctx.currentTime + 0.1;
    var bus = S.ctx.createGain(); bus.gain.value = 1; bus.connect(S.master);
    S.musicBus = bus;
    function schedule() {
      while (next < S.ctx.currentTime + 0.4) {
        var b = song.bass[Math.floor(i / 2) % song.bass.length];
        if (i % 2 === 0) toneAt(midi(b), next, step * 1.8, 'triangle', song.vol * 1.6, bus);
        var l = song.lead[i % song.lead.length];
        if (l) toneAt(midi(l), next, step * 0.9, 'square', song.vol * 0.55, bus);
        next += step; i++;
      }
    }
    schedule();
    S.seqTimer = setInterval(schedule, 120);
  };
  function toneAt(f, t, dur, type, vol, dest) {
    var c = S.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.02);
  }

  S.stopMusic = function () {
    S.musicName = null;
    if (S.seqTimer) { clearInterval(S.seqTimer); S.seqTimer = null; }
    if (S.musicBus) { try { S.musicBus.gain.setTargetAtTime(0, S.ctx.currentTime, 0.05); } catch (e) { /* bỏ qua */ } S.musicBus = null; }
    if (S.musicEl) { S.musicEl.pause(); S.musicEl = null; }
  };

  root.HLWSound = S;
}(window));
