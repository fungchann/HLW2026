/*
 * Biểu đồ SVG tối giản cho trang Admin (không phụ thuộc thư viện ngoài).
 * Màu lấy từ biến CSS (--s1..--s8, --h100..--h700) để tự đổi theo giao diện sáng/tối.
 * Mọi nhãn chèn bằng textContent (dữ liệu có thể đến từ người dùng).
 */
(function (root) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var C = {};

  function el(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    if (attrs) for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function text(parent, x, y, str, attrs) {
    var t = el('text', Object.assign({ x: x, y: y }, attrs || {}), parent);
    t.textContent = str;
    return t;
  }
  // Ước lượng độ rộng nhãn (px) theo số ký tự, rồi cắt bớt nếu không vừa.
  function labelWidth(labels, total, minW, maxRatio) {
    var longest = labels.reduce(function (m, l) { return Math.max(m, String(l).length); }, 0);
    return Math.max(minW, Math.min(total * maxRatio, longest * 6.6 + 16));
  }
  function fitLabel(str, width) {
    var max = Math.max(4, Math.floor((width - 14) / 6.6));
    str = String(str);
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }
  function fmt(n) { return Number(n || 0).toLocaleString('vi-VN', { maximumFractionDigits: 1 }); }
  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var m = v / p;
    var n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return n * p;
  }
  function roundedTop(x, y, w, h, r) { // cột: bo 4px đầu dữ liệu, vuông ở đường gốc
    r = Math.min(r, w / 2, h);
    if (h <= 0) return '';
    return 'M' + x + ' ' + (y + h) + 'V' + (y + r) + 'Q' + x + ' ' + y + ' ' + (x + r) + ' ' + y + 'H' + (x + w - r) +
      'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + r) + 'V' + (y + h) + 'Z';
  }
  function roundedRight(x, y, w, h, r) { // thanh ngang: bo đầu phải
    r = Math.min(r, h / 2, w);
    if (w <= 0) return '';
    return 'M' + x + ' ' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ' ' + y + ' ' + (x + w) + ' ' + (y + r) + 'V' + (y + h - r) +
      'Q' + (x + w) + ' ' + (y + h) + ' ' + (x + w - r) + ' ' + (y + h) + 'H' + x + 'Z';
  }

  // ---------------------------------------------------------------- tooltip dùng chung
  var tip = null;
  function tooltip() {
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    return tip;
  }
  function showTip(evt, rows) {
    var t = tooltip();
    t.innerHTML = '';
    rows.forEach(function (r, i) {
      var line = document.createElement('div');
      line.className = i === 0 ? 'tip-value' : 'tip-label';
      if (r.color) {
        var k = document.createElement('i');
        k.className = 'tip-key';
        k.style.background = r.color;
        line.appendChild(k);
      }
      line.appendChild(document.createTextNode(r.text));
      t.appendChild(line);
    });
    t.style.display = 'block';
    var x = evt.clientX, y = evt.clientY;
    if (evt.type === 'focus' && evt.target.getBoundingClientRect) {
      var b = evt.target.getBoundingClientRect();
      x = b.left + b.width / 2; y = b.top;
    }
    var w = t.offsetWidth, h = t.offsetHeight;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 12));
    var top = y - h - 12 < 8 ? y + 16 : y - h - 12;
    t.style.transform = 'translate(' + left + 'px,' + top + 'px)';
  }
  function hideTip() { if (tip) tip.style.display = 'none'; }
  function bindTip(node, rowsFn) {
    node.setAttribute('tabindex', '0');
    node.addEventListener('pointermove', function (e) { showTip(e, rowsFn()); });
    node.addEventListener('pointerleave', hideTip);
    node.addEventListener('focus', function (e) { showTip(e, rowsFn()); });
    node.addEventListener('blur', hideTip);
  }
  C.hideTip = hideTip;

  function frame(container, height) {
    container.innerHTML = '';
    var w = Math.max(240, container.clientWidth || 600);
    var svg = el('svg', { viewBox: '0 0 ' + w + ' ' + height, width: '100%', height: height, class: 'chart-svg', role: 'img' }, container);
    return { svg: svg, w: w, h: height };
  }
  function empty(container, msg) {
    container.innerHTML = '';
    var d = document.createElement('div');
    d.className = 'chart-empty';
    d.textContent = msg || 'Chưa có dữ liệu trong khoảng thời gian này';
    container.appendChild(d);
  }

  // ---------------------------------------------------------------- thanh ngang
  // o: { items:[{label, value, note}], format, emphasize:'max', color:'var(--s1)', unit }
  C.bars = function (container, o) {
    var items = o.items || [];
    if (!items.length || items.every(function (i) { return !i.value; })) { if (!o.allowZero) return empty(container); }
    var rowH = 34, cw = container.clientWidth || 600;
    var labelW = labelWidth(items.map(function (i) { return i.label; }), cw, 64, 0.42);
    var f = frame(container, items.length * rowH + 8);
    var max = Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
    var maxIdx = -1;
    if (o.emphasize === 'max') items.forEach(function (it, i) { if (maxIdx < 0 || it.value > items[maxIdx].value) maxIdx = i; });
    var valW = 58, plotW = Math.max(40, f.w - labelW - valW - 8);
    items.forEach(function (it, i) {
      var y = i * rowH + 6;
      var g = el('g', { class: 'mark' }, f.svg);
      text(g, labelW - 10, y + 15, fitLabel(it.label, labelW), { 'text-anchor': 'end', class: 'c-label' });
      var bw = it.value > 0 ? Math.max(3, plotW * it.value / max) : 0;
      var color = o.emphasize === 'max' ? (i === maxIdx && it.value > 0 ? 'var(--s1)' : 'var(--deemph)') : (it.color || o.color || 'var(--s1)');
      el('rect', { x: labelW, y: y + 2, width: plotW, height: 18, fill: 'transparent' }, g);
      if (bw) el('path', { d: roundedRight(labelW, y + 2, bw, 18, 4), fill: color }, g);
      text(g, labelW + bw + 6, y + 15, (o.format || fmt)(it.value), { class: 'c-value' });
      bindTip(g, function () { return [{ text: (o.format || fmt)(it.value) + (o.unit ? ' ' + o.unit : '') }, { text: it.label + (it.note ? ' · ' + it.note : ''), color: color }]; });
    });
  };

  // ---------------------------------------------------------------- cột theo thời gian
  // o: { items:[{label, value, tip}], format, height }
  C.columns = function (container, o) {
    var items = o.items || [];
    if (!items.length) return empty(container);
    var H = o.height || 220, padL = 44, padB = 26, padT = 12;
    var f = frame(container, H);
    var max = niceMax(Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1])));
    var plotH = H - padB - padT, plotW = f.w - padL - 6;
    for (var k = 0; k <= 4; k++) {
      var gy = padT + plotH - plotH * k / 4;
      el('line', { x1: padL, x2: f.w - 6, y1: gy, y2: gy, class: k === 0 ? 'c-axis' : 'c-grid' }, f.svg);
      text(f.svg, padL - 6, gy + 4, fmt(max * k / 4), { 'text-anchor': 'end', class: 'c-tick' });
    }
    var band = plotW / items.length;
    var bw = Math.min(24, Math.max(2, band - 2));
    var every = Math.ceil(items.length / Math.max(1, Math.floor(plotW / 54)));
    items.forEach(function (it, i) {
      var x = padL + band * i + (band - bw) / 2;
      var h = plotH * it.value / max;
      var g = el('g', { class: 'mark' }, f.svg);
      el('rect', { x: padL + band * i, y: padT, width: band, height: plotH, fill: 'transparent' }, g);
      if (h > 0) el('path', { d: roundedTop(x, padT + plotH - h, bw, h, 4), fill: o.color || 'var(--s1)' }, g);
      if (i % every === 0) text(f.svg, x + bw / 2, H - 8, it.label, { 'text-anchor': 'middle', class: 'c-tick' });
      bindTip(g, function () { return [{ text: (o.format || fmt)(it.value) + (o.unit ? ' ' + o.unit : '') }, { text: it.tip || it.label }]; });
    });
  };

  // ---------------------------------------------------------------- histogram với vạch mốc
  // o: { bins:[{label, x0, value}], markers:[{x, label}], step }
  C.histogram = function (container, o) {
    var bins = o.bins || [];
    if (!bins.length) return empty(container);
    var H = o.height || 230, padL = 44, padB = 26, padT = 26;
    var f = frame(container, H);
    var max = niceMax(Math.max.apply(null, bins.map(function (b) { return b.value; }).concat([1])));
    var plotH = H - padB - padT, plotW = f.w - padL - 6;
    var x0 = bins[0].x0, x1 = bins[bins.length - 1].x0 + o.step;
    function sx(v) { return padL + plotW * (v - x0) / (x1 - x0); }
    for (var k = 0; k <= 4; k++) {
      var gy = padT + plotH - plotH * k / 4;
      el('line', { x1: padL, x2: f.w - 6, y1: gy, y2: gy, class: k === 0 ? 'c-axis' : 'c-grid' }, f.svg);
      text(f.svg, padL - 6, gy + 4, fmt(max * k / 4), { 'text-anchor': 'end', class: 'c-tick' });
    }
    bins.forEach(function (b, i) {
      var x = sx(b.x0) + 1, w = Math.max(1, sx(b.x0 + o.step) - sx(b.x0) - 2);
      var h = plotH * b.value / max;
      var g = el('g', { class: 'mark' }, f.svg);
      el('rect', { x: x, y: padT, width: w, height: plotH, fill: 'transparent' }, g);
      if (h > 0) el('path', { d: roundedTop(x, padT + plotH - h, w, h, Math.min(4, w / 2)), fill: 'var(--s1)' }, g);
      bindTip(g, function () { return [{ text: fmt(b.value) + ' lượt' }, { text: b.label + ' điểm' }]; });
      if (i % Math.ceil(bins.length / 8) === 0) text(f.svg, x + w / 2, H - 8, String(b.x0), { 'text-anchor': 'middle', class: 'c-tick' });
    });
    (o.markers || []).forEach(function (m) {
      if (m.x < x0 || m.x > x1) return;
      var x = sx(m.x);
      el('line', { x1: x, x2: x, y1: padT - 4, y2: padT + plotH, class: 'c-marker' }, f.svg);
      text(f.svg, x + 4, padT - 10, m.label, { class: 'c-marker-label' });
    });
  };

  // ---------------------------------------------------------------- heatmap (thang 1 màu)
  // o: { rows:[label], cols:[label], values:[[n]], rowTip, colTip }
  C.heatmap = function (container, o) {
    var rows = o.rows || [], cols = o.cols || [];
    if (!rows.length) return empty(container);
    var padL = 82, padT = 18, cellH = 22;
    var f = frame(container, padT + rows.length * (cellH + 2) + 34);
    var cellW = (f.w - padL - 4) / cols.length;
    var max = 0;
    o.values.forEach(function (r) { r.forEach(function (v) { if (v > max) max = v; }); });
    var steps = ['--h100', '--h200', '--h300', '--h400', '--h500', '--h600', '--h700'];
    function color(v) {
      if (!v) return 'var(--surface-2)';
      var i = Math.min(steps.length - 1, Math.floor((v / max) * (steps.length - 1) + 0.0001));
      return 'var(' + steps[i] + ')';
    }
    cols.forEach(function (c, j) { if (j % 3 === 0) text(f.svg, padL + cellW * j + cellW / 2, 12, c, { 'text-anchor': 'middle', class: 'c-tick' }); });
    rows.forEach(function (r, i) {
      var y = padT + i * (cellH + 2);
      text(f.svg, padL - 8, y + 15, r, { 'text-anchor': 'end', class: 'c-tick' });
      cols.forEach(function (c, j) {
        var v = o.values[i][j];
        var rect = el('rect', { x: padL + cellW * j + 1, y: y, width: Math.max(1, cellW - 2), height: cellH, rx: 3, fill: color(v), class: 'mark' }, f.svg);
        bindTip(rect, function () { return [{ text: fmt(v) + ' lượt chơi' }, { text: r + ' · ' + c + 'h–' + (Number(c) + 1) + 'h' }]; });
      });
    });
    // chú giải thang màu
    var ly = padT + rows.length * (cellH + 2) + 12, lx = padL;
    text(f.svg, lx - 8, ly + 9, 'Ít', { 'text-anchor': 'end', class: 'c-tick' });
    steps.forEach(function (s, i) { el('rect', { x: lx + i * 22, y: ly, width: 20, height: 10, rx: 2, fill: 'var(' + s + ')' }, f.svg); });
    text(f.svg, lx + steps.length * 22 + 4, ly + 9, 'Nhiều (' + fmt(max) + ')', { class: 'c-tick' });
  };

  // ---------------------------------------------------------------- thanh xếp chồng 100% (phần / tổng)
  // o: { segments:[{label, value}] }
  C.stack = function (container, o) {
    var segs = (o.segments || []).filter(function (s) { return s.value > 0; });
    container.innerHTML = '';
    if (!segs.length) return empty(container);
    var total = segs.reduce(function (a, s) { return a + s.value; }, 0);
    var f = frame(container, 34);
    var x = 0, gap = 2;
    var W = f.w - gap * (segs.length - 1);
    segs.forEach(function (s, i) {
      var w = Math.max(2, W * s.value / total);
      var color = 'var(--s' + (s.slot || i + 1) + ')';
      var g = el('g', { class: 'mark' }, f.svg);
      el('rect', { x: x, y: 4, width: w, height: 26, rx: i === 0 || i === segs.length - 1 ? 4 : 0, fill: color }, g);
      var pct = Math.round(100 * s.value / total);
      if (w > 46) text(g, x + w / 2, 22, pct + '%', { 'text-anchor': 'middle', class: 'c-inbar' });
      bindTip(g, function () { return [{ text: fmt(s.value) + ' (' + pct + '%)' }, { text: s.label, color: color }]; });
      x += w + gap;
    });
    var legend = document.createElement('ul');
    legend.className = 'legend';
    segs.forEach(function (s, i) {
      var li = document.createElement('li');
      var k = document.createElement('i');
      k.style.background = 'var(--s' + (s.slot || i + 1) + ')';
      li.appendChild(k);
      var name = document.createElement('span');
      name.textContent = s.label;
      li.appendChild(name);
      var v = document.createElement('b');
      v.textContent = fmt(s.value) + ' · ' + Math.round(100 * s.value / total) + '%';
      li.appendChild(v);
      legend.appendChild(li);
    });
    container.appendChild(legend);
  };

  // ---------------------------------------------------------------- phễu chuyển đổi (thang thứ bậc)
  C.funnel = function (container, o) {
    var steps = o.steps || [];
    if (!steps.length || !steps[0].n) return empty(container);
    var rowH = 40, cw = container.clientWidth || 600;
    var labelW = labelWidth(steps.map(function (s) { return s.label; }), cw, 80, 0.4);
    var f = frame(container, steps.length * rowH + 4);
    var first = steps[0].n || 1, plotW = Math.max(40, f.w - labelW - 104);
    var ramp = ['--h550', '--h500', '--h450', '--h400', '--h350', '--h300', '--h250'];
    steps.forEach(function (s, i) {
      var y = i * rowH + 4;
      var g = el('g', { class: 'mark' }, f.svg);
      text(g, labelW - 10, y + 19, fitLabel(s.label, labelW), { 'text-anchor': 'end', class: 'c-label' });
      var w = Math.max(s.n ? 3 : 0, plotW * s.n / first);
      el('rect', { x: labelW, y: y + 4, width: plotW, height: 22, fill: 'transparent' }, g);
      if (w) el('path', { d: roundedRight(labelW, y + 4, w, 22, 4), fill: 'var(' + ramp[Math.min(i, ramp.length - 1)] + ')' }, g);
      var prev = i ? steps[i - 1].n : 0;
      var conv = i && prev ? ' · ' + Math.round(100 * s.n / prev) + '% bước trước' : '';
      text(g, labelW + w + 6, y + 19, fmt(s.n) + ' (' + Math.round(100 * s.n / first) + '%)', { class: 'c-value' });
      bindTip(g, function () { return [{ text: fmt(s.n) + ' người' }, { text: s.label + ' · ' + Math.round(100 * s.n / first) + '% so với bước đầu' + conv }]; });
    });
  };

  // ---------------------------------------------------------------- đường (mô phỏng độ khó)
  // o: { x:[seconds], values:[], format, unit, color }
  C.line = function (container, o) {
    var H = o.height || 150, padL = 46, padB = 24, padT = 10;
    var f = frame(container, H);
    var xs = o.x, vs = o.values;
    var maxV = niceMax(Math.max.apply(null, vs.concat([o.minMax || 1])));
    var plotH = H - padB - padT, plotW = f.w - padL - 10;
    var maxX = xs[xs.length - 1] || 1;
    function sx(v) { return padL + plotW * v / maxX; }
    function sy(v) { return padT + plotH - plotH * v / maxV; }
    for (var k = 0; k <= 2; k++) {
      var gy = padT + plotH - plotH * k / 2;
      el('line', { x1: padL, x2: f.w - 10, y1: gy, y2: gy, class: k === 0 ? 'c-axis' : 'c-grid' }, f.svg);
      text(f.svg, padL - 6, gy + 4, (o.format || fmt)(maxV * k / 2), { 'text-anchor': 'end', class: 'c-tick' });
    }
    var tickEvery = maxX > 240 ? 60 : 30;
    for (var t = 0; t <= maxX; t += tickEvery) text(f.svg, sx(t), H - 6, t + 's', { 'text-anchor': 'middle', class: 'c-tick' });
    var d = vs.map(function (v, i) { return (i ? 'L' : 'M') + sx(xs[i]).toFixed(1) + ' ' + sy(v).toFixed(1); }).join(' ');
    el('path', { d: d, fill: 'none', stroke: o.color || 'var(--s1)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, f.svg);
    var last = vs.length - 1;
    el('circle', { cx: sx(xs[last]), cy: sy(vs[last]), r: 4, fill: o.color || 'var(--s1)', stroke: 'var(--surface)', 'stroke-width': 2 }, f.svg);
    // crosshair
    var cross = el('line', { y1: padT, y2: padT + plotH, class: 'c-cross', visibility: 'hidden' }, f.svg);
    var hit = el('rect', { x: padL, y: padT, width: plotW, height: plotH, fill: 'transparent' }, f.svg);
    hit.addEventListener('pointermove', function (e) {
      var r = f.svg.getBoundingClientRect();
      var px = (e.clientX - r.left) * (f.w / r.width);
      var tx = Math.max(0, Math.min(maxX, (px - padL) / plotW * maxX));
      var i = 0;
      for (var j = 0; j < xs.length; j++) if (Math.abs(xs[j] - tx) < Math.abs(xs[i] - tx)) i = j;
      cross.setAttribute('x1', sx(xs[i])); cross.setAttribute('x2', sx(xs[i])); cross.setAttribute('visibility', 'visible');
      showTip(e, [{ text: (o.format || fmt)(vs[i]) + (o.unit ? ' ' + o.unit : '') }, { text: 'Giây thứ ' + xs[i] }]);
    });
    hit.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); hideTip(); });
  };

  C.fmt = fmt;
  root.HLWCharts = C;
}(window));
