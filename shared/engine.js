/*
 * HLW Engine — bộ máy game dùng chung cho TRÌNH DUYỆT và SERVER.
 *
 * Nguyên tắc chống gian lận: server không tin điểm số do trình duyệt gửi lên.
 * Trình duyệt chỉ gửi danh sách thao tác [thời điểm, ô] ; server dùng chính file
 * này, cùng seed + cấu hình đã lưu khi bắt đầu lượt, để tái hiện (replay) toàn bộ
 * ván chơi và tự tính điểm.
 *
 * Vì vậy mọi phép tính ở đây phải TẤT ĐỊNH (deterministic):
 *   - không dùng Math.random / Date.now
 *   - không dùng hàm siêu việt (sin, pow, exp...) có thể lệch giữa các trình duyệt
 *   - chỉ dùng + - * / và làm tròn về số nguyên mili-giây
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HLWEngine = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = 7;
  var HOLES = 9;

  // Mốc thời gian hiển thị (ms). rise/sink chỉ là hiệu ứng; ko = thời gian vật phẩm
  // hiện mặt "bị hạ gục" trước khi lặn hẳn. holeRest = khoảng nghỉ tối thiểu của 1 ô.
  var TIMING = { rise: 140, sink: 170, ko: 460, holeRest: 90, boom: 650 };

  var ITEM_ORDER = ['pumpkin', 'pumpkinCloth', 'pumpkinIron', 'ghost', 'virus', 'potion', 'candy'];
  var BOSS_TYPES = ['boss', 'bossArmor'];
  // Mọi vật phẩm xuất hiện với CÙNG thời gian nổi. Vật phẩm cần đập nhiều lần được "giữ lại"
  // thêm hitHoldMs sau mỗi cú đập trúng (tính từ cú đập đầu tiên) để kịp đập tiếp.
  // Boss xuất hiện lâu hơn một chút để người chơi kịp nhận ra.
  var BOSS_DUR_FACTOR = 160;
  var BOSS_HOLD_FACTOR = 250; // mỗi cú đập trúng boss giữ boss lại lâu gấp 2,5 lần vật phẩm thường
  var BOMB_SKINS_L1 = ['cloth', 'iron'];
  var BOMB_SKINS_L2 = ['cloth', 'iron', 'potion'];

  // ---------------------------------------------------------------- RNG
  // mulberry32 — chỉ dùng phép toán số nguyên 32-bit, kết quả giống nhau trên mọi engine JS.
  function createRng(seed) {
    var a = seed | 0;
    function next() {
      a = (a + 0x6D2B79F5) | 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    }
    return {
      next: next,
      // số nguyên trong [0, n) ; n <= 2^20 để phép nhân luôn chính xác
      int: function (n) { return Math.floor(next() * n / 4294967296); },
      chance: function (permille) { return Math.floor(next() * 1000 / 4294967296) < permille; }
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lerpRound(a, b, e) { return Math.round(a + (b - a) * e); }

  // ---------------------------------------------------------------- Độ khó
  // Độ khó tăng theo THỜI GIAN CHƠI (không tính lúc tạm dừng) với đường cong smoothstep:
  // tăng chậm lúc đầu, nhanh dần ở giữa, chậm lại khi gần đỉnh -> cảm giác "từ từ".
  // Sau rampSeconds là giai đoạn "tăng ca": bom dày thêm từng nấc để ván chơi không kéo dài vô hạn.
  function difficultyAt(cfg, t) {
    var d = cfg.difficulty;
    var ramp = d.rampSeconds * 1000;
    var x = ramp > 0 ? clamp(t / ramp, 0, 1) : 1;
    var e = x * x * (3 - 2 * x);
    var interval = lerpRound(d.spawnIntervalStart, d.spawnIntervalEnd, e);
    var upTime = lerpRound(d.upTimeStart, d.upTimeEnd, e);
    var maxActive = lerpRound(d.maxActiveStart, d.maxActiveEnd, e);
    var bomb = d.bombRateStart + (d.bombRateEnd - d.bombRateStart) * e;
    var overtime = 0;
    if (t > ramp && d.overtimeEverySeconds > 0) {
      overtime = Math.floor((t - ramp) / (d.overtimeEverySeconds * 1000));
      if (overtime > 0) {
        var cap = Math.max(d.bombRateCap, d.bombRateEnd);
        bomb = Math.min(cap, d.bombRateEnd + overtime * d.overtimeBombStep);
        upTime = Math.max(Math.round(d.upTimeEnd * 0.75), Math.round(d.upTimeEnd * (100 - 3 * overtime) / 100));
        interval = Math.max(Math.round(d.spawnIntervalEnd * 0.8), Math.round(d.spawnIntervalEnd * (100 - 2 * overtime) / 100));
      }
    }
    if (t < d.bombGraceSeconds * 1000) bomb = 0;
    var level = 1 + Math.floor(t / (Math.max(5, d.levelSeconds) * 1000));
    var burstPct = lerpRound(d.burstChanceStart | 0, d.burstChanceEnd | 0, e);
    var burstMax = lerpRound(Math.max(2, d.burstMaxStart | 0), Math.max(2, d.burstMaxEnd | 0), e);
    var bombLingerPct = 100 + lerpRound(0, d.bombLingerPct | 0, e);
    return {
      e: e,
      burstPct: clamp(burstPct, 0, 100),
      burstMax: clamp(burstMax, 2, 6),
      bombLingerPct: clamp(bombLingerPct, 100, 200),
      interval: Math.max(150, interval),
      upTime: Math.max(350, upTime),
      maxActive: clamp(maxActive, 1, HOLES),
      bombPermille: clamp(Math.round(bomb * 10), 0, 900),
      level: level > 99 ? 99 : level,
      overtime: overtime
    };
  }

  function itemWeight(item, e) {
    var w0 = item.weight || 0;
    var w1 = (item.weightEnd === undefined || item.weightEnd === null) ? w0 : item.weightEnd;
    var w = lerpRound(w0, w1, e);
    return w > 0 ? w : 0;
  }

  // ---------------------------------------------------------------- Lịch xuất hiện
  // Lịch được sinh hoàn toàn từ seed + cfg, KHÔNG phụ thuộc thao tác người chơi.
  function Spawner(seed, cfg) {
    this.cfg = cfg;
    this.rng = createRng(seed);
    this.spawns = [];
    this.byHole = [];
    this.holeFreeAt = [];
    for (var i = 0; i < HOLES; i++) { this.byHole.push([]); this.holeFreeAt.push(0); }
    this.live = [];
    this.nextAt = Math.max(200, cfg.difficulty.firstSpawnMs | 0);
    this.lastHole = -1;
    this.generatedUntil = -1;
    this.bossIndex = 0;
    var R0 = rules(cfg);
    this.rushAt = R0.rushEvery > 0 ? R0.rushFirst : -1;
    this.lastGood = 0;            // lần gần nhất có vật phẩm đập được (không tính bom) trồi lên
    this.streakEnd = 0;           // hết "đợt dồn" -> 1 nhịp nghỉ ngắn rồi sang đợt mới
  }

  var RUSH_DUR_FACTOR = 135;
  function rules(cfg) {
    var d = cfg.difficulty, b = cfg.boss || {}, bo = cfg.bombs || {};
    return {
      hold: clamp(d.hitHoldMs | 0 || 750, 200, 3000),
      bossOn: !!b.enabled,
      bossFirst: Math.max(2, b.firstLevel | 0),
      bossEvery: Math.max(1, b.everyLevels | 0),
      disguise1: Math.max(1, bo.disguiseLevel | 0 || 3),
      disguise2: Math.max(1, bo.disguiseLevel2 | 0 || 5),
      disguisePct: clamp(bo.disguisePct | 0, 0, 100),
      // Nhịp xuất hiện: không để quá "gap" ms không có vật phẩm (giữ được combo); xen kẽ nhịp nghỉ ngắn "breath" ms
      gap: clamp(Math.round(Math.max(300, cfg.combo && cfg.combo.windowMs | 0 || 1500) * 0.75), 500, 1500),
      breath: clamp(Math.round(Math.max(300, cfg.combo && cfg.combo.windowMs | 0 || 1500) * 0.87), 600, 1800),
      // "Tràn đồng": thỉnh thoảng cả 9 ô cùng trồi lên
      rushFirst: Math.max(1000, (d.rushFirstSeconds | 0) * 1000),
      rushEvery: Math.max(0, (d.rushEverySeconds | 0) * 1000),
      rushBombMax: clamp(d.rushBombMax | 0, 0, 4)
    };
  }

  Spawner.prototype._pickType = function (D) {
    var cfg = this.cfg, r = this.rng, i;
    var bombOn = cfg.items.bomb && cfg.items.bomb.enabled;
    var bombRoll = r.int(1000);
    if (bombOn && bombRoll < D.bombPermille) return 'bomb';
    var total = 0, weights = [];
    for (i = 0; i < ITEM_ORDER.length; i++) {
      var it = cfg.items[ITEM_ORDER[i]];
      var w = (it && it.enabled) ? itemWeight(it, D.e) : 0;
      weights.push(w); total += w;
    }
    if (total <= 0) return 'pumpkin';
    var pick = r.int(total);
    for (i = 0; i < ITEM_ORDER.length; i++) {
      if (pick < weights[i]) return ITEM_ORDER[i];
      pick -= weights[i];
    }
    return 'pumpkin';
  };

  Spawner.prototype.generateUntil = function (tLimit) {
    var guard = 0;
    while (this.nextAt <= tLimit && guard < 20000) { this._step(); guard++; }
    if (tLimit > this.generatedUntil) this.generatedUntil = tLimit;
  };

  Spawner.prototype._step = function () {
    var cfg = this.cfg, r = this.rng, t = this.nextAt;
    var D = difficultyAt(cfg, t);
    var R = rules(cfg);
    var live = this.live, n = 0, i;
    for (i = 0; i < live.length; i++) if (live[i] > t) live[n++] = live[i];
    live.length = n;

    // Đợt tràn đồng: tung vật phẩm ra MỌI ô đang trống (cần ít nhất 6 ô). Chưa đủ ô thì hoãn đợt tràn
    // đồng 1,5 giây và vẫn sinh vật phẩm bình thường -> không bao giờ để bàn chơi đứng chờ.
    if (this.rushAt >= 0 && t >= this.rushAt) {
      var rushHoles = [];
      for (i = 0; i < HOLES; i++) if (this.holeFreeAt[i] <= t) rushHoles.push(i);
      if (rushHoles.length < 6) this.rushAt = t + 1500;
    }
    if (this.rushAt >= 0 && t >= this.rushAt) {
      var bombs = 0;
      for (var ri = 0; ri < rushHoles.length; ri++) {
        var rh = rushHoles[ri];
        var rt = this._pickType(D), tries = 0;
        while (rt === 'bomb' && bombs >= R.rushBombMax && tries++ < 6) rt = this._pickType(D);
        if (rt === 'bomb' && bombs >= R.rushBombMax) rt = 'pumpkin';
        var rskin = null;
        if (rt === 'bomb') {
          bombs++;
          if (D.level >= R.disguise1 && r.int(100) < R.disguisePct) {
            var rsk = D.level >= R.disguise2 ? BOMB_SKINS_L2 : BOMB_SKINS_L1;
            rskin = rsk[r.int(rsk.length)];
          }
        }
        var rhp = rt === 'bomb' ? 1 : clamp(cfg.items[rt] ? (cfg.items[rt].hp | 0) : 1, 1, 5);
        var rdur = Math.round(D.upTime * (rt === 'bomb' ? D.bombLingerPct : RUSH_DUR_FACTOR) / 100);
        var rs = { id: this.spawns.length, hole: rh, type: rt, at: t, dur: rdur, hp: rhp, level: D.level, rush: 1 };
        if (rskin) rs.skin = rskin;
        this.spawns.push(rs);
        this.byHole[rh].push(rs);
        this.holeFreeAt[rh] = t + rdur + (rhp - 1) * R.hold + TIMING.ko + TIMING.holeRest;
        live.push(t + rdur);
        if (rt !== 'bomb') this.lastGood = t;
      }
      var rj = Math.round(R.rushEvery * 15 / 100);
      this.rushAt = t + R.rushEvery - rj + r.int(2 * rj + 1);
      this.nextAt = t + Math.min(rdur + 200, R.gap);
      return;
    }

    // quá lâu không có vật phẩm đập được -> ra ngay (kể cả khi đã đủ số vật phẩm tối đa trên bàn)
    var overdue = t - this.lastGood >= R.gap;
    if (n >= D.maxActive && !overdue) {
      var minEnd = live[0];
      for (i = 1; i < n; i++) if (live[i] < minEnd) minEnd = live[i];
      this.nextAt = Math.max(t + 1, Math.min(minEnd + 60 + r.int(160), this.lastGood + R.gap));
      return;
    }

    var free = [];
    for (var h = 0; h < HOLES; h++) if (this.holeFreeAt[h] <= t) free.push(h);
    if (!free.length) {
      var soonest = this.holeFreeAt[0];
      for (i = 1; i < HOLES; i++) if (this.holeFreeAt[i] < soonest) soonest = this.holeFreeAt[i];
      this.nextAt = Math.max(t + 1, soonest);
      return;
    }
    // tránh xuất hiện lại đúng ô vừa dùng nếu còn lựa chọn khác
    if (free.length > 1 && free.indexOf(this.lastHole) >= 0) free.splice(free.indexOf(this.lastHole), 1);

    // Nhiều vật phẩm cùng lúc: xác suất & số lượng tăng dần theo độ khó
    var group = 1;
    if (r.int(100) < D.burstPct) group = 2 + r.int(Math.max(1, D.burstMax - 1));
    group = Math.max(1, Math.min(group, Math.max(1, D.maxActive - n), free.length));

    for (var g = 0; g < group; g++) {
      var idx = r.int(free.length);
      var hole = free[idx];
      free.splice(idx, 1);
      var type = null, skin = null;
      if (g === 0 && R.bossOn && D.level >= R.bossFirst + this.bossIndex * R.bossEvery) {
        type = BOSS_TYPES[this.bossIndex % 2];
        if (!(cfg.items[type] && cfg.items[type].enabled)) type = null;
        this.bossIndex++;
      }
      if (!type) type = this._pickType(D);
      // đang "đói" vật phẩm: con đầu tiên của nhóm không được là bom
      for (var rp = 0; g === 0 && overdue && type === 'bomb' && rp < 4; rp++) type = this._pickType(D);
      if (g === 0 && overdue && type === 'bomb') type = 'pumpkin';
      if (type === 'bomb' && D.level >= R.disguise1 && r.int(100) < R.disguisePct) {
        var skins = D.level >= R.disguise2 ? BOMB_SKINS_L2 : BOMB_SKINS_L1;
        skin = skins[r.int(skins.length)];
      }
      var isBoss = type.indexOf('boss') === 0;
      var hp = type === 'bomb' ? 1 : clamp(cfg.items[type] ? (cfg.items[type].hp | 0) : 1, 1, isBoss ? 10 : 5);
      var dur = D.upTime;
      if (type === 'bomb') dur = Math.round(D.upTime * D.bombLingerPct / 100);
      else if (isBoss) dur = Math.round(D.upTime * BOSS_DUR_FACTOR / 100);
      var s = { id: this.spawns.length, hole: hole, type: type, at: t, dur: dur, hp: hp, level: D.level };
      if (skin) s.skin = skin;
      this.spawns.push(s);
      this.byHole[hole].push(s);
      // giữ ô trống đủ lâu cho phần "giữ lại" khi đập nhiều lần + hiệu ứng hạ gục
      var hold = isBoss ? Math.round(R.hold * BOSS_HOLD_FACTOR / 100) : R.hold;
      this.holeFreeAt[hole] = t + dur + (hp - 1) * hold + TIMING.ko + TIMING.holeRest;
      live.push(t + dur);
      n++;
      this.lastHole = hole;
      if (type !== 'bomb') this.lastGood = t;
    }

    var jit = Math.round(D.interval * clamp(cfg.difficulty.jitterPct | 0, 0, 60) / 100);
    var next = t + D.interval - jit + r.int(2 * jit + 1);
    // Nhịp: dồn liên tục 6–10 giây (khoảng cách tối đa R.gap), rồi 1 nhịp nghỉ ngắn R.breath
    var limit = R.gap;
    if (t >= this.streakEnd) {
      if (this.streakEnd > 0) limit = R.breath;
      this.streakEnd = t + 6000 + r.int(4001);
    }
    if (next > t + limit) next = t + limit;
    this.nextAt = next > t ? next : t + 1;
  };

  // ---------------------------------------------------------------- Ván chơi
  // Cấp búa theo chuỗi combo hiện có: 0 = Sấm Sét, 1 = Băng Long, 2 = Hỏa Long, 3 = Kim Cang
  function hammerLevel(cfg, combo) {
    var h = cfg.combo.hammer && cfg.combo.hammer.length === 3 ? cfg.combo.hammer : [3, 5, 8];
    return combo >= h[2] ? 3 : combo >= h[1] ? 2 : combo >= h[0] ? 1 : 0;
  }
  // % điểm cộng thêm của từng cấp búa (số nguyên, làm tròn xuống -> tất định)
  function hammerBonus(cfg, level, base) {
    var b = cfg.combo.hammerBonus && cfg.combo.hammerBonus.length === 3 ? cfg.combo.hammerBonus : [50, 100, 150];
    return level > 0 ? Math.floor(base * (b[level - 1] | 0) / 100) : 0;
  }

  function comboBonus(cfg, combo) {
    var table = cfg.combo.bonus;
    if (!table || !table.length || combo <= 0) return 0;
    return table[combo < table.length ? combo : table.length - 1] | 0;
  }

  function Game(seed, cfg) {
    this.cfg = cfg;
    this.seed = seed;
    this.spawner = new Spawner(seed, cfg);
    this.grace = clamp(cfg.difficulty.graceMs | 0, 0, 200);
    this.windowMs = Math.max(300, cfg.combo.windowMs | 0);
    this.maxStrikes = Math.max(1, cfg.bombs.strikes | 0);
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.lastHitAt = -1;
    this.strikes = 0;
    this.dead = false;
    this.deathAt = -1;
    this.lastT = 0;
    this.taps = 0; this.hits = 0; this.kills = 0; this.misses = 0; this.bombsHit = 0;
    this.killsByType = {};
    this.pointsBase = 0; this.pointsCombo = 0;
    this.hitCount = [];   // theo id spawn
    this.endAt = [];      // thời điểm bị hạ / nổ (theo id spawn)
    this.firstHitAt = [];
    this.reactions = [];
    this.tapTimes = [];
    this.maxTapRate = 0;
    this.ptr = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    this.until = [];      // thời điểm vật phẩm lặn (sau khi được "giữ lại")
    this.hold = rules(cfg).hold;
    this.idleMs = cfg.rules && cfg.rules.idleMs > 0 ? cfg.rules.idleMs : 0;
    this.lastAct = 0;     // lần thao tác gần nhất (tính cả đập trượt)
    this.idle = false;
    this.idleAt = -1;
    this.maxMs = cfg.rules && cfg.rules.maxMs > 0 ? cfg.rules.maxMs : 0;
    this.timeUp = false;
  }

  Game.prototype.endOf = function (s) {
    var u = this.until[s.id];
    return u === undefined ? s.at + s.dur : u;
  };

  // Tự kết thúc khi người chơi không thao tác quá idleMs (tính theo thời gian game).
  Game.prototype.checkIdle = function (t) {
    if (this.dead || this.idle) return this.idle;
    // hết thời gian lượt chơi: kết thúc đúng tại mốc maxMs (dùng chung cơ chế với "không thao tác")
    if (this.maxMs && t >= this.maxMs) { this.idle = true; this.timeUp = true; this.idleAt = this.maxMs; return true; }
    if (!this.idleMs) return false;
    if (t - this.lastAct > this.idleMs) {
      this.idle = true; this.idleAt = this.lastAct + this.idleMs;
      if (this.maxMs && this.idleAt > this.maxMs) { this.idleAt = this.maxMs; this.timeUp = true; }
    }
    return this.idle;
  };
  Game.prototype.over = function () { return this.dead || this.idle; };

  // Tìm vật phẩm đang ở ô `hole` tại thời điểm t (mỗi ô chỉ có tối đa 1 vật phẩm).
  Game.prototype.spawnAt = function (hole, t) {
    this.spawner.generateUntil(t);
    var list = this.spawner.byHole[hole];
    var p = this.ptr[hole];
    while (p + 1 < list.length && list[p + 1].at <= t) p++;
    this.ptr[hole] = p;
    var s = list[p];
    if (!s || s.at > t) return null;
    if (t > this.endOf(s) + this.grace) return null;
    var end = this.endAt[s.id];
    if (end !== undefined && end <= t) return null;
    return s;
  };

  Game.prototype.isComboAlive = function (t) {
    return this.lastHitAt >= 0 && t - this.lastHitAt <= this.windowMs;
  };

  // Xử lý 1 lần đập. t: mili-giây (số nguyên) tính từ lúc bắt đầu ván, hole: 0..8
  Game.prototype.tap = function (t, hole) {
    if (this.dead || this.idle) return { kind: 'ignored', t: t, hole: hole };
    if (t < this.lastT) t = this.lastT;
    if (this.checkIdle(t)) return { kind: 'ignored', t: t, hole: hole, idle: true };
    this.lastT = t;
    this.lastAct = t;
    this.taps++;

    var tt = this.tapTimes;
    tt.push(t);
    while (tt.length && tt[0] <= t - 1000) tt.shift();
    if (tt.length > this.maxTapRate) this.maxTapRate = tt.length;

    var s = this.spawnAt(hole, t);
    if (!s) { this.misses++; return { kind: 'miss', t: t, hole: hole }; }

    if (s.type === 'bomb') {
      this.endAt[s.id] = t;
      this.bombsHit++;
      this.strikes++;
      this.combo = 0;
      this.lastHitAt = -1;
      if (this.strikes >= this.maxStrikes) { this.dead = true; this.deathAt = t; }
      return { kind: 'bomb', t: t, hole: hole, spawn: s, strikes: this.strikes, dead: this.dead };
    }

    if (this.lastHitAt >= 0 && t - this.lastHitAt > this.windowMs) this.combo = 0;
    this.lastHitAt = t;
    this.hits++;
    var c = (this.hitCount[s.id] || 0) + 1;
    this.hitCount[s.id] = c;
    if (c === 1) { this.firstHitAt[s.id] = t; this.reactions.push(t - s.at); }

    if (c >= s.hp) {
      this.endAt[s.id] = t;
      this.kills++;
      // búa đang cầm lúc đập (tính theo chuỗi combo TRƯỚC cú hạ gục này)
      var hl = hammerLevel(this.cfg, this.combo);
      this.combo++;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
      var item = this.cfg.items[s.type];
      var base = item ? (item.points | 0) : 0;
      var bonus = comboBonus(this.cfg, this.combo);
      var hb = hammerBonus(this.cfg, hl, base);
      this.score += base + bonus + hb;
      this.pointsBase += base;
      this.pointsCombo += bonus;
      this.pointsHammer = (this.pointsHammer || 0) + hb;
      this.killsByType[s.type] = (this.killsByType[s.type] || 0) + 1;
      return { kind: 'kill', t: t, hole: hole, spawn: s, base: base, bonus: bonus, hammer: hb, hammerLevel: hl, points: base + bonus + hb, combo: this.combo, hitNo: c };
    }
    var hold = s.type.indexOf('boss') === 0 ? Math.round(this.hold * BOSS_HOLD_FACTOR / 100) : this.hold;
    if (t + hold > this.endOf(s)) this.until[s.id] = t + hold;
    return { kind: 'hit', t: t, hole: hole, spawn: s, hitNo: c, left: s.hp - c, combo: this.combo };
  };

  Game.prototype.stateOf = function (s) {
    return { hits: this.hitCount[s.id] || 0, endAt: this.endAt[s.id], until: this.endOf(s) };
  };

  Game.prototype.level = function (t) { return difficultyAt(this.cfg, t).level; };

  // Tổng kết ván chơi (dùng cho server lưu trữ và phân tích chống gian lận).
  Game.prototype.summary = function (endT) {
    if (!this.dead && !this.idle) this.checkIdle(Math.max(endT | 0, this.lastT));
    var end = this.dead ? this.deathAt : (this.idle ? this.idleAt : Math.max(endT | 0, this.lastT));
    var shown = 0, bombsShown = 0, escaped = 0, i, s;
    var spawns = this.spawner.spawns;
    for (i = 0; i < spawns.length; i++) {
      s = spawns[i];
      if (s.at > end) break;
      if (s.type === 'bomb') { bombsShown++; continue; }
      shown++;
      if (this.endAt[s.id] === undefined && this.endOf(s) < end) escaped++;
    }
    var r = this.reactions.slice().sort(function (a, b) { return a - b; });
    function q(p) { return r.length ? r[Math.min(r.length - 1, Math.floor(r.length * p))] : null; }
    return {
      score: this.score,
      maxCombo: this.maxCombo,
      kills: this.kills,
      hits: this.hits,
      taps: this.taps,
      misses: this.misses,
      bombsHit: this.bombsHit,
      strikes: this.strikes,
      dead: this.dead,
      idle: this.idle,
      timeUp: this.timeUp,
      endT: end,
      level: difficultyAt(this.cfg, end).level,
      itemsShown: shown,
      bombsShown: bombsShown,
      escaped: escaped,
      killsByType: this.killsByType,
      pointsBase: this.pointsBase,
      pointsCombo: this.pointsCombo,
      reactionMedian: q(0.5),
      reactionP10: q(0.1),
      reactionCount: r.length,
      maxTapRate: this.maxTapRate
    };
  };

  // Tái hiện ván chơi từ log thao tác. events: [[t, hole], ...] theo thứ tự thời gian.
  function replay(seed, cfg, events, endT) {
    var g = new Game(seed, cfg);
    for (var i = 0; i < events.length && !g.over(); i++) g.tap(events[i][0], events[i][1]);
    return { game: g, summary: g.summary(endT) };
  }

  // ---------------------------------------------------------------- Mốc điểm
  // tiers: [{id, score, reward, ...}] ; trả về mốc đã đạt + mốc tiếp theo
  function tierStatus(tiers, score) {
    var list = (tiers || []).filter(function (x) { return x && x.enabled !== false; })
      .slice().sort(function (a, b) { return a.score - b.score; });
    var reached = null, reachedReward = null, next = null, nextReward = null;
    for (var i = 0; i < list.length; i++) {
      var tr = list[i];
      if (score >= tr.score) { reached = tr; if (tr.reward) reachedReward = tr; }
      else {
        if (!next) next = tr;
        if (!nextReward && tr.reward) nextReward = tr;
      }
    }
    return {
      reached: reached,
      reachedReward: reachedReward,
      next: next,
      nextReward: nextReward,
      need: nextReward ? nextReward.score - score : 0
    };
  }

  // ---------------------------------------------------------------- Mô phỏng (cho trang Admin)
  // Mô hình người chơi giả lập để ƯỚC LƯỢNG độ khó. Không dùng cho tính điểm thật.
  var PROFILES = {
    casual: { label: 'Phổ thông', react: 560, reactSd: 150, tapGap: 200, accuracy: 0.88, focus: 0.86, bombBase: 0.05, bombSpeed: 0.12 },
    average: { label: 'Trung bình', react: 460, reactSd: 120, tapGap: 170, accuracy: 0.92, focus: 0.92, bombBase: 0.035, bombSpeed: 0.09 },
    skilled: { label: 'Giỏi', react: 370, reactSd: 90, tapGap: 145, accuracy: 0.95, focus: 0.96, bombBase: 0.02, bombSpeed: 0.06 }
  };

  var NEIGHBORS = [[1, 3], [0, 2, 4], [1, 5], [0, 4, 6], [1, 3, 5, 7], [2, 4, 8], [3, 7], [4, 6, 8], [5, 7]];

  function simulateOne(cfg, profile, seed, opts) {
    opts = opts || {};
    var maxT = (opts.maxSeconds || 900) * 1000;
    var thresholds = opts.thresholds || [];
    var pr = createRng(seed ^ 0x5bd1e995);
    function rand() { return pr.next() / 4294967296; }
    function gauss() { // xấp xỉ chuẩn bằng tổng 4 biến đều (không dùng hàm siêu việt)
      return (rand() + rand() + rand() + rand() - 2) * 1.732;
    }
    var g = new Game(seed, cfg);
    var sp = g.spawner;
    var busy = 0, idx = 0;
    var reachedAt = thresholds.map(function () { return null; });
    function feed(t, hole) {
      var res = g.tap(Math.round(t), hole);
      if (res.kind === 'kill') {
        for (var k = 0; k < thresholds.length; k++) {
          if (reachedAt[k] === null && g.score >= thresholds[k]) reachedAt[k] = res.t;
        }
      }
      return res;
    }
    while (!g.over()) {
      sp.generateUntil(sp.generatedUntil + 2000);
      if (idx >= sp.spawns.length) continue;
      var s = sp.spawns[idx++];
      if (s.at > maxT) break;
      var D = difficultyAt(cfg, s.at);
      var crowd = 0; // số vật phẩm cùng lúc làm tăng sai sót
      for (var j = Math.max(0, idx - 8); j < idx - 1; j++) {
        var o = sp.spawns[j];
        if (o.at + o.dur > s.at) crowd++;
      }
      var react = Math.max(170, profile.react + gauss() * profile.reactSd);
      if (s.type === 'bomb') {
        var pBomb = profile.bombBase + profile.bombSpeed * D.e + 0.02 * D.overtime + 0.006 * crowd + (s.skin ? 0.08 : 0);
        if (rand() < pBomb) {
          var tb = Math.max(busy, s.at + react * 0.8);
          if (tb <= s.at + s.dur) { feed(tb, s.hole); busy = tb + profile.tapGap; }
        }
        continue;
      }
      if (rand() > profile.focus - 0.02 * crowd) continue;
      var start = Math.max(busy, s.at + react);
      if (start > s.at + s.dur - 40) continue; // không kịp -> bỏ qua (cú đập đầu sẽ "giữ" vật phẩm lại)
      var t = start;
      for (var k2 = 0; k2 < s.hp && !g.over(); k2++) {
        var hole = s.hole;
        if (rand() > profile.accuracy) {
          var nb = NEIGHBORS[s.hole];
          hole = nb[Math.floor(rand() * nb.length)];
        }
        feed(t, hole);
        t += profile.tapGap;
      }
      busy = t - profile.tapGap * 0.4;
    }
    var sum = g.summary(g.dead ? g.deathAt : Math.min(maxT, g.lastT));
    return { score: sum.score, maxCombo: sum.maxCombo, endT: sum.endT, dead: sum.dead, reachedAt: reachedAt };
  }

  function simulate(cfg, profile, games, opts) {
    opts = opts || {};
    var base = opts.seed || 12345;
    var res = [];
    for (var i = 0; i < games; i++) res.push(simulateOne(cfg, profile, (base + i * 7919) | 0, opts));
    var scores = res.map(function (x) { return x.score; }).sort(function (a, b) { return a - b; });
    var durs = res.map(function (x) { return x.endT; }).sort(function (a, b) { return a - b; });
    function pct(arr, p) { return arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] : 0; }
    var th = opts.thresholds || [];
    var reach = th.map(function (thr, k) {
      var times = res.filter(function (x) { return x.reachedAt[k] !== null; }).map(function (x) { return x.reachedAt[k]; }).sort(function (a, b) { return a - b; });
      return { score: thr, rate: res.length ? times.length / res.length : 0, medianTime: times.length ? pct(times, 0.5) : null };
    });
    var total = 0;
    for (var m = 0; m < scores.length; m++) total += scores[m];
    return {
      games: games,
      scores: scores,
      mean: games ? Math.round(total / games) : 0,
      median: pct(scores, 0.5), p25: pct(scores, 0.25), p75: pct(scores, 0.75), p90: pct(scores, 0.9),
      medianDuration: pct(durs, 0.5), p90Duration: pct(durs, 0.9),
      reach: reach
    };
  }

  return {
    VERSION: VERSION,
    HOLES: HOLES,
    TIMING: TIMING,
    ITEM_ORDER: ITEM_ORDER,
    BOSS_TYPES: BOSS_TYPES,
    PROFILES: PROFILES,
    createRng: createRng,
    difficultyAt: difficultyAt,
    comboBonus: comboBonus,
    hammerLevel: hammerLevel,
    hammerBonus: hammerBonus,
    Spawner: Spawner,
    Game: Game,
    replay: replay,
    tierStatus: tierStatus,
    simulate: simulate,
    simulateOne: simulateOne
  };
}));
