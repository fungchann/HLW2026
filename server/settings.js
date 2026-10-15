'use strict';
/*
 * Cấu hình game (chỉnh trong trang Admin > Cấu hình). Mỗi lần lưu tạo một phiên bản mới
 * trong bảng settings_history để có thể khôi phục. Lượt chơi đang diễn ra giữ nguyên
 * bản cấu hình lúc bắt đầu (snapshot) nên đổi cấu hình không làm hỏng ván đang chơi.
 */
const db = require('./db');

const DIFFICULTY_PRESETS = {
    // Hiệu chỉnh bằng mô phỏng (Admin > Mô phỏng độ khó). v3: đầu game đã ra 4–5 con cùng lúc + đợt tràn đồng 9 ô; bom dày nhanh hơn ở cuối để giữ tỷ lệ đạt mốc hợp lý.
  easy: {
    burstChanceStart: 55, burstChanceEnd: 60, burstMaxStart: 4, burstMaxEnd: 5, hitHoldMs: 850, bombLingerPct: 15,
    rushFirstSeconds: 8, rushEverySeconds: 26, rushBombMax: 1,
    rampSeconds: 150, firstSpawnMs: 800,
    spawnIntervalStart: 1900, spawnIntervalEnd: 600,
    upTimeStart: 1500, upTimeEnd: 800,
    maxActiveStart: 5, maxActiveEnd: 5,
    bombRateStart: 12, bombRateEnd: 30, bombRateCap: 45,
    overtimeEverySeconds: 20, overtimeBombStep: 3,
    bombGraceSeconds: 4, levelSeconds: 15, jitterPct: 25, graceMs: 90
  },
  normal: {
    burstChanceStart: 55, burstChanceEnd: 62, burstMaxStart: 4, burstMaxEnd: 5, hitHoldMs: 750, bombLingerPct: 15,
    rushFirstSeconds: 8, rushEverySeconds: 28, rushBombMax: 2,
    rampSeconds: 140, firstSpawnMs: 800,
    spawnIntervalStart: 1800, spawnIntervalEnd: 560,
    upTimeStart: 1500, upTimeEnd: 760,
    maxActiveStart: 5, maxActiveEnd: 5,
    bombRateStart: 18, bombRateEnd: 40, bombRateCap: 55,
    overtimeEverySeconds: 15, overtimeBombStep: 3,
    bombGraceSeconds: 3, levelSeconds: 15, jitterPct: 25, graceMs: 80
  },
  hard: {
    burstChanceStart: 55, burstChanceEnd: 65, burstMaxStart: 4, burstMaxEnd: 6, hitHoldMs: 650, bombLingerPct: 15,
    rushFirstSeconds: 8, rushEverySeconds: 30, rushBombMax: 2,
    rampSeconds: 120, firstSpawnMs: 800,
    spawnIntervalStart: 1650, spawnIntervalEnd: 500,
    upTimeStart: 1400, upTimeEnd: 720,
    maxActiveStart: 5, maxActiveEnd: 6,
    bombRateStart: 20, bombRateEnd: 42, bombRateCap: 58,
    overtimeEverySeconds: 15, overtimeBombStep: 3,
    bombGraceSeconds: 3, levelSeconds: 15, jitterPct: 25, graceMs: 70
  }
};

function defaults() {
  return {
    campaign: {
      name: 'Halloween iNET 2026',
      title: 'ĐẬP BÍ NGÔ',
      subtitle: 'Săn voucher Halloween cùng NÉT',
      start: '2026-10-26T00:00:00+07:00',
      end: '2026-10-31T23:59:59+07:00',
      testMode: false,
      maintenance: false,
      maintenanceMessage: 'Trò chơi đang bảo trì, bạn quay lại sau ít phút nhé!',
      portalUrl: 'https://portal.inet.vn',
      periodText: '26/10 – 31/10/2026'
    },
    turns: { max: 3, regenMinutes: 10 },
    combo: { windowMs: 1500, bonus: [0, 0, 2, 3, 4, 5], hammer: [3, 5, 8] },
    bombs: { strikes: 2, disguiseLevel: 3, disguiseLevel2: 5, disguisePct: 40 },
    boss: { enabled: true, firstLevel: 4, everyLevels: 3 },
    items: {
      pumpkin: { enabled: true, label: 'Bí Bắp', points: 10, hp: 1, weight: 46, weightEnd: 34 },
      pumpkinCloth: { enabled: true, label: 'Bí Pháp Sư', points: 20, hp: 2, weight: 10, weightEnd: 18 },
      pumpkinIron: { enabled: true, label: 'Bí Hộ Pháp', points: 30, hp: 3, weight: 4, weightEnd: 12 },
      ghost: { enabled: true, label: 'Hồn Nhiên', points: 5, hp: 1, weight: 10, weightEnd: 9 },
      virus: { enabled: true, label: 'Độc Nhãn', points: 5, hp: 1, weight: 10, weightEnd: 9 },
      potion: { enabled: true, label: 'Vạc Ma Thuật', points: 5, hp: 1, weight: 10, weightEnd: 9 },
      candy: { enabled: true, label: 'Đường Phép', points: 5, hp: 1, weight: 10, weightEnd: 9 },
      boss: { enabled: true, label: 'Bí Đại Vương', points: 50, hp: 5, weight: 0, weightEnd: 0 },
      bossArmor: { enabled: true, label: 'Bí Thiết Giáp', points: 100, hp: 10, weight: 0, weightEnd: 0 },
      bomb: { enabled: true, label: 'Bom' }
    },
    difficulty: Object.assign({ preset: 'normal' }, DIFFICULTY_PRESETS.normal),
    tiers: [
      {
        id: 't100', score: 100, enabled: true, reward: false,
        label: 'Mốc 100', short: 'Mốc 100', product: '', discount: 0,
        url: '', prefix: '', quota: 0
      },
      {
        id: 'email', score: 200, enabled: true, reward: true,
        label: 'Voucher Email tên miền 20%', short: 'Email 20%', product: 'Email tên miền', discount: 20,
        url: 'https://inet.vn/email', prefix: 'HLWEM', quota: 0
      },
      {
        id: 'cloud', score: 450, enabled: true, reward: true,
        label: 'Voucher Cloud Server 35%', short: 'Cloud 35%', product: 'Cloud Server, Cloud VPS Storage', discount: 35,
        url: 'https://inet.vn/cloud-server', prefix: 'HLWCL', quota: 0
      },
      {
        id: 'hosting', score: 700, enabled: true, reward: true,
        label: 'Voucher Hosting 40%', short: 'Hosting 40%', product: 'Hosting', discount: 40,
        url: 'https://inet.vn/hosting', prefix: 'HLWHO', quota: 0
      }
    ],
    coupons: {
      expiresAt: '2026-10-31T23:59:59+07:00',
      provider: 'mock',
      maxPerTierPerPlayer: 0, // 0 = không giới hạn: đạt mốc nào nhận voucher mốc đó, mỗi lượt chơi 1 voucher
      fallbackToLowerTier: false,
      holdSuspicious: false,
      codeParam: '',
      utm: true
    },
    messages: {
      congrats: [
        'Tay đập thần sầu! Voucher này xứng đáng thuộc về bạn.',
        'Bí ngô đã đầu hàng vô điều kiện. Chúc mừng bạn!',
        'NÉT phải ngả mũ thán phục — bạn vừa săn được quà xịn!',
        'Một đêm Halloween quá đỉnh! Phần thưởng đã sẵn sàng.',
        'Đập đâu trúng đó! Voucher đã nằm gọn trong túi bạn.',
        'Lũ bí ngô run rẩy trước cây búa của bạn. Quà đây!',
        'Phong độ hủy diệt! Mời bạn nhận voucher.',
        'Chính xác như thuật toán, nhanh như cáp quang. Chúc mừng!'
      ],
      encourage: [
        'Suýt chút nữa thôi! Thử lại một ván nhé?',
        'Bí ngô vẫn còn cười nhạo bạn kìa — phục thù thôi!',
        'Khởi động vậy là đủ ấm tay rồi, ván sau bứt phá nào!',
        'NÉT tin bạn sẽ làm tốt hơn ở lượt tiếp theo!',
        'Một chút nữa là chạm mốc quà rồi, cố lên!'
      ],
      owned: [
        'Bạn đã sở hữu voucher này rồi. Thử dừng ở mốc khác để săn thêm quà nhé!'
      ],
      gameOver: [
        'BÙM! Trúng bom rồi!',
        'Ối dồi ôi, bom nổ tung!',
        'Bom không phải để đập đâu!'
      ]
    },
    features: { leaderboard: false, resumeSession: true },
    antiCheat: { minMedianReactionMs: 170, maxTapRate: 22, slowClockRatio: 0.85, abandonMinutes: 10, idleSeconds: 10, blockSuspicious: true, autoBanAfter: 3, lockHours: 24 }
  };
}

// ------------------------------------------------------------ chuẩn hoá & kiểm tra
const ITEM_KEYS = ['pumpkin', 'pumpkinCloth', 'pumpkinIron', 'ghost', 'virus', 'potion', 'candy', 'boss', 'bossArmor', 'bomb'];

function int(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
function num(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}
function str(v, max, def) {
  if (v === undefined || v === null) return def;
  return String(v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}
function bool(v, def) { return typeof v === 'boolean' ? v : def; }
function isoDate(v, def) {
  const s = str(v, 40, '');
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : def;
}
function url(v, def) {
  const s = str(v, 500, '');
  if (!s) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return def;
    return u.toString();
  } catch (e) { return def; }
}
function list(v, maxItems, maxLen, def) {
  if (!Array.isArray(v)) return def;
  const out = v.map((x) => str(x, maxLen, '')).filter(Boolean).slice(0, maxItems);
  return out.length ? out : def;
}

// Nhận bản cấu hình từ Admin, trả về bản đã làm sạch + danh sách lỗi.
function sanitize(input) {
  const D = defaults();
  const src = input && typeof input === 'object' ? input : {};
  const errors = [];
  const out = {};

  const c = src.campaign || {};
  out.campaign = {
    name: str(c.name, 80, D.campaign.name) || D.campaign.name,
    title: str(c.title, 60, D.campaign.title) || D.campaign.title,
    subtitle: str(c.subtitle, 120, D.campaign.subtitle),
    start: isoDate(c.start, D.campaign.start),
    end: isoDate(c.end, D.campaign.end),
    testMode: bool(c.testMode, D.campaign.testMode),
    maintenance: bool(c.maintenance, D.campaign.maintenance),
    maintenanceMessage: str(c.maintenanceMessage, 200, D.campaign.maintenanceMessage),
    portalUrl: url(c.portalUrl, D.campaign.portalUrl),
    periodText: str(c.periodText, 60, D.campaign.periodText)
  };
  if (Date.parse(out.campaign.end) <= Date.parse(out.campaign.start)) errors.push('Thời gian kết thúc phải sau thời gian bắt đầu.');

  const tu = src.turns || {};
  out.turns = { max: int(tu.max, 1, 50, D.turns.max), regenMinutes: num(tu.regenMinutes, 0.5, 1440, D.turns.regenMinutes) };

  const co = src.combo || {};
  let bonus = Array.isArray(co.bonus) ? co.bonus.slice(0, 20).map((x) => int(x, 0, 1000, 0)) : D.combo.bonus;
  if (bonus.length < 2) bonus = D.combo.bonus;
  bonus[0] = 0;
  let hammer = Array.isArray(co.hammer) && co.hammer.length === 3 ? co.hammer.map((x, i) => int(x, 2, 99, D.combo.hammer[i])) : D.combo.hammer;
  if (!(hammer[0] < hammer[1] && hammer[1] < hammer[2])) errors.push('Mốc combo nâng cấp búa phải tăng dần (băng < lửa < kim cang).');
  out.combo = { windowMs: int(co.windowMs, 300, 10000, D.combo.windowMs), bonus, hammer };

  const sb = src.bombs || {};
  out.bombs = {
    strikes: int(sb.strikes, 1, 10, D.bombs.strikes),
    disguiseLevel: int(sb.disguiseLevel, 1, 99, D.bombs.disguiseLevel),
    disguiseLevel2: int(sb.disguiseLevel2, 1, 99, D.bombs.disguiseLevel2),
    disguisePct: int(sb.disguisePct, 0, 100, D.bombs.disguisePct)
  };
  const bo = src.boss || {};
  out.boss = {
    enabled: bool(bo.enabled, D.boss.enabled),
    firstLevel: int(bo.firstLevel, 2, 99, D.boss.firstLevel),
    everyLevels: int(bo.everyLevels, 1, 50, D.boss.everyLevels)
  };

  const it = src.items || {};
  out.items = {};
  for (const k of ITEM_KEYS) {
    const d = D.items[k];
    const s = it[k] || {};
    if (k === 'bomb') {
      out.items.bomb = { enabled: bool(s.enabled, d.enabled), label: str(s.label, 40, d.label) || d.label };
      continue;
    }
    out.items[k] = {
      enabled: bool(s.enabled, d.enabled),
      label: str(s.label, 40, d.label) || d.label,
      points: int(s.points, 0, 1000, d.points),
      hp: int(s.hp, 1, k.indexOf('boss') === 0 ? 10 : 5, d.hp),
      weight: int(s.weight, 0, 1000, d.weight),
      weightEnd: int(s.weightEnd, 0, 1000, d.weightEnd)
    };
  }
  const anyItem = ITEM_KEYS.some((k) => k !== 'bomb' && k.indexOf('boss') !== 0 && out.items[k].enabled && (out.items[k].weight > 0 || out.items[k].weightEnd > 0));
  if (!anyItem) errors.push('Cần bật ít nhất 1 vật phẩm (không tính Bom) có tỷ lệ xuất hiện > 0.');

  const di = src.difficulty || {};
  const dd = D.difficulty;
  out.difficulty = {
    preset: ['easy', 'normal', 'hard', 'custom'].includes(di.preset) ? di.preset : 'custom',
    rampSeconds: int(di.rampSeconds, 10, 1800, dd.rampSeconds),
    firstSpawnMs: int(di.firstSpawnMs, 200, 5000, dd.firstSpawnMs),
    spawnIntervalStart: int(di.spawnIntervalStart, 150, 5000, dd.spawnIntervalStart),
    spawnIntervalEnd: int(di.spawnIntervalEnd, 150, 5000, dd.spawnIntervalEnd),
    upTimeStart: int(di.upTimeStart, 350, 6000, dd.upTimeStart),
    upTimeEnd: int(di.upTimeEnd, 350, 6000, dd.upTimeEnd),
    maxActiveStart: int(di.maxActiveStart, 1, 9, dd.maxActiveStart),
    maxActiveEnd: int(di.maxActiveEnd, 1, 9, dd.maxActiveEnd),
    bombRateStart: num(di.bombRateStart, 0, 90, dd.bombRateStart),
    bombRateEnd: num(di.bombRateEnd, 0, 90, dd.bombRateEnd),
    bombRateCap: num(di.bombRateCap, 0, 90, dd.bombRateCap),
    overtimeEverySeconds: int(di.overtimeEverySeconds, 0, 600, dd.overtimeEverySeconds),
    overtimeBombStep: num(di.overtimeBombStep, 0, 20, dd.overtimeBombStep),
    bombGraceSeconds: int(di.bombGraceSeconds, 0, 60, dd.bombGraceSeconds),
    levelSeconds: int(di.levelSeconds, 5, 300, dd.levelSeconds),
    jitterPct: int(di.jitterPct, 0, 60, dd.jitterPct),
    graceMs: int(di.graceMs, 0, 200, dd.graceMs),
    burstChanceStart: int(di.burstChanceStart, 0, 100, dd.burstChanceStart),
    burstChanceEnd: int(di.burstChanceEnd, 0, 100, dd.burstChanceEnd),
    burstMaxStart: int(di.burstMaxStart, 2, 6, dd.burstMaxStart),
    burstMaxEnd: int(di.burstMaxEnd, 2, 6, dd.burstMaxEnd),
    hitHoldMs: int(di.hitHoldMs, 200, 3000, dd.hitHoldMs),
    bombLingerPct: int(di.bombLingerPct, 0, 100, dd.bombLingerPct),
    rushFirstSeconds: int(di.rushFirstSeconds, 1, 600, dd.rushFirstSeconds),
    rushEverySeconds: int(di.rushEverySeconds, 0, 600, dd.rushEverySeconds),
    rushBombMax: int(di.rushBombMax, 0, 4, dd.rushBombMax)
  };

  const tiersIn = Array.isArray(src.tiers) ? src.tiers.slice(0, 8) : D.tiers;
  const seen = new Set();
  out.tiers = [];
  for (const t of tiersIn) {
    if (!t || typeof t !== 'object') continue;
    const id = str(t.id, 24, '').replace(/[^a-z0-9_-]/gi, '').toLowerCase();
    if (!id || seen.has(id)) { errors.push('Mã mốc điểm bị trống hoặc trùng: "' + (t.id || '') + '"'); continue; }
    seen.add(id);
    const reward = bool(t.reward, false);
    const tier = {
      id,
      score: int(t.score, 1, 1000000, 0),
      enabled: bool(t.enabled, true),
      reward,
      label: str(t.label, 80, id) || id,
      short: str(t.short, 30, '') || str(t.label, 30, id),
      product: str(t.product, 120, ''),
      discount: int(t.discount, 0, 100, 0),
      url: url(t.url, ''),
      prefix: str(t.prefix, 12, '').replace(/[^A-Z0-9]/gi, '').toUpperCase(),
      quota: int(t.quota, 0, 10000000, 0)
    };
    if (reward && !tier.url) errors.push('Mốc "' + tier.label + '" chưa có URL đăng ký sản phẩm.');
    out.tiers.push(tier);
  }
  out.tiers.sort((a, b) => a.score - b.score);
  for (let i = 1; i < out.tiers.length; i++) {
    if (out.tiers[i].score === out.tiers[i - 1].score) errors.push('Hai mốc điểm không được trùng số điểm (' + out.tiers[i].score + ').');
  }
  if (!out.tiers.some((t) => t.reward && t.enabled)) errors.push('Cần ít nhất 1 mốc điểm có voucher.');

  const cp = src.coupons || {};
  out.coupons = {
    expiresAt: isoDate(cp.expiresAt, D.coupons.expiresAt),
    provider: ['mock', 'pool', 'http'].includes(cp.provider) ? cp.provider : D.coupons.provider,
    maxPerTierPerPlayer: int(cp.maxPerTierPerPlayer, 0, 100, D.coupons.maxPerTierPerPlayer),
    fallbackToLowerTier: bool(cp.fallbackToLowerTier, D.coupons.fallbackToLowerTier),
    holdSuspicious: bool(cp.holdSuspicious, D.coupons.holdSuspicious),
    codeParam: str(cp.codeParam, 30, '').replace(/[^a-z0-9_-]/gi, ''),
    utm: bool(cp.utm, D.coupons.utm)
  };

  const m = src.messages || {};
  out.messages = {
    congrats: list(m.congrats, 40, 160, D.messages.congrats),
    encourage: list(m.encourage, 40, 160, D.messages.encourage),
    owned: list(m.owned, 20, 200, D.messages.owned),
    gameOver: list(m.gameOver, 20, 60, D.messages.gameOver)
  };

  const f = src.features || {};
  out.features = { leaderboard: bool(f.leaderboard, D.features.leaderboard), resumeSession: bool(f.resumeSession, D.features.resumeSession) };

  const ac = src.antiCheat || {};
  out.antiCheat = {
    minMedianReactionMs: int(ac.minMedianReactionMs, 0, 1000, D.antiCheat.minMedianReactionMs),
    maxTapRate: int(ac.maxTapRate, 5, 40, D.antiCheat.maxTapRate),
    slowClockRatio: num(ac.slowClockRatio, 0.3, 1, D.antiCheat.slowClockRatio),
    abandonMinutes: int(ac.abandonMinutes, 2, 120, D.antiCheat.abandonMinutes),
    idleSeconds: int(ac.idleSeconds, 0, 600, D.antiCheat.idleSeconds),
    blockSuspicious: bool(ac.blockSuspicious, D.antiCheat.blockSuspicious),
    autoBanAfter: int(ac.autoBanAfter, 0, 100, D.antiCheat.autoBanAfter),
    lockHours: int(ac.lockHours, 1, 720, D.antiCheat.lockHours)
  };
  return { settings: out, errors };
}

// ------------------------------------------------------------ lưu trữ
let cache = null;

function load() {
  if (cache) return cache;
  const row = db.get('SELECT version, json FROM settings_history ORDER BY version DESC LIMIT 1');
  if (row) {
    // Chạy lại sanitize để bản cũ luôn có đủ trường mới (khi nâng cấp code).
    cache = { version: row.version, settings: sanitize(JSON.parse(row.json)).settings };
  } else {
    const s = defaults();
    db.run('INSERT INTO settings_history (version, json, admin_name, note, created_at) VALUES (1, ?, ?, ?, ?)',
      JSON.stringify(s), 'system', 'Cấu hình mặc định', Date.now());
    cache = { version: 1, settings: s };
  }
  return cache;
}

// Nâng cấp 1 lần khi lên phiên bản game v2: tắt chế độ test, mở chương trình từ hôm nay (nếu ngày bắt đầu
// còn ở tương lai), áp độ khó mới. Admin có thể chỉnh lại bất kỳ lúc nào trong Cấu hình.
function migrate() {
  migrateV2();
  migrateV3();
  migrateTapRate();
}
// Ngưỡng tốc độ đập cũ (15 lần/giây) bắt nhầm người chơi bằng bàn phím -> nâng lên 22
function migrateTapRate() {
  if (db.metaGet('mig_taprate22')) return;
  const next = JSON.parse(JSON.stringify(load().settings));
  if (next.antiCheat.maxTapRate < 22) {
    next.antiCheat.maxTapRate = 22;
    const r = save(next, 'system', 'Nâng ngưỡng tốc độ đập lên 22 lần/giây (người chơi bàn phím bị bắt nhầm)');
    if (!r.ok) console.error('[settings] migrate tap rate failed', r.errors);
  }
  db.metaSet('mig_taprate22', String(Date.now()));
}
function migrateV2() {
  if (db.metaGet('mig_v2_live')) return;
  const cur = load().settings;
  const next = JSON.parse(JSON.stringify(cur));
  next.campaign.testMode = false;
  const now = Date.now();
  if (Date.parse(next.campaign.start) > now) {
    const day = new Date(now + 7 * 3600e3).toISOString().slice(0, 10);
    next.campaign.start = day + 'T00:00:00+07:00';
  }
  next.difficulty = Object.assign({ preset: 'normal' }, DIFFICULTY_PRESETS.normal);
  next.coupons.maxPerTierPerPlayer = 0;
  const r = save(next, 'system', 'Nâng cấp game v2: chạy thật, boss, bom hoá trang, xuất hiện theo nhóm');
  if (!r.ok) console.error('[settings] migrate failed', r.errors);
  db.metaSet('mig_v2_live', String(now));
}

// Nâng cấp 1 lần lên v3: tên vật phẩm mới, búa theo combo 3/5/8, nhiều vật phẩm từ đầu + tràn đồng 9 ô.
const OLD_LABELS = { pumpkin: 'Bí ngô', pumpkinCloth: 'Bí nón vải', pumpkinIron: 'Bí nón sắt', ghost: 'Ma', virus: 'Virus', potion: 'Nồi thuốc độc', candy: 'Kẹo', boss: 'Boss bí khổng lồ', bossArmor: 'Boss bí giáp sắt' };
function migrateV3() {
  if (db.metaGet('mig_v3')) return;
  const cur = load().settings;
  const next = JSON.parse(JSON.stringify(cur));
  const D = defaults();
  for (const k of Object.keys(OLD_LABELS)) if (next.items[k] && next.items[k].label === OLD_LABELS[k]) next.items[k].label = D.items[k].label;
  next.combo.hammer = D.combo.hammer.slice();
  next.campaign.periodText = next.campaign.periodText || D.campaign.periodText;
  const preset = DIFFICULTY_PRESETS[next.difficulty.preset] ? next.difficulty.preset : 'normal';
  next.difficulty = Object.assign({ preset }, DIFFICULTY_PRESETS[preset]);
  const r = save(next, 'system', 'Nâng cấp game v3: tên vật phẩm mới, búa combo 3/5/8, nhiều vật phẩm từ đầu, tràn đồng 9 ô');
  if (!r.ok) console.error('[settings] migrate v3 failed', r.errors);
  db.metaSet('mig_v3', String(Date.now()));
}

function current() { return load().settings; }
function version() { return load().version; }

function save(input, adminName, note) {
  const { settings, errors } = sanitize(input);
  if (errors.length) return { ok: false, errors };
  const v = version() + 1;
  db.run('INSERT INTO settings_history (version, json, admin_name, note, created_at) VALUES (?, ?, ?, ?, ?)',
    v, JSON.stringify(settings), adminName || '', str(note, 200, ''), Date.now());
  cache = { version: v, settings };
  return { ok: true, version: v, settings };
}

function history(limit) {
  return db.all('SELECT version, admin_name, note, created_at FROM settings_history ORDER BY version DESC LIMIT ?', limit || 50);
}

function getVersion(v) {
  const row = db.get('SELECT version, json, admin_name, note, created_at FROM settings_history WHERE version = ?', v);
  if (!row) return null;
  return { version: row.version, settings: sanitize(JSON.parse(row.json)).settings, admin_name: row.admin_name, note: row.note, created_at: row.created_at };
}

// Phần cấu hình gameplay gửi xuống trình duyệt & lưu kèm mỗi lượt chơi (snapshot).
function gameConfig(s) {
  s = s || current();
  return {
    items: s.items,
    difficulty: s.difficulty,
    combo: s.combo,
    bombs: s.bombs,
    boss: s.boss,
    rules: { idleMs: s.antiCheat.idleSeconds > 0 ? s.antiCheat.idleSeconds * 1000 : 0 }
  };
}

function rewardTiers(s) {
  return (s || current()).tiers.filter((t) => t.enabled && t.reward).sort((a, b) => a.score - b.score);
}

function campaignStatus(s, now) {
  s = s || current();
  now = now || Date.now();
  const start = Date.parse(s.campaign.start);
  const end = Date.parse(s.campaign.end);
  let status = 'live';
  if (now < start) status = 'upcoming';
  else if (now > end) status = 'ended';
  return { status, start, end, testMode: s.campaign.testMode, maintenance: s.campaign.maintenance };
}

function invalidate() { cache = null; }

module.exports = {
  DIFFICULTY_PRESETS, ITEM_KEYS, defaults, sanitize, load, migrate, current, version, save, history, getVersion,
  gameConfig, rewardTiers, campaignStatus, invalidate
};
