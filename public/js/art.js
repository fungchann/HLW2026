/*
 * Hình vẽ SVG mặc định (placeholder) cho nhân vật, vật phẩm, mascot NÉT.
 * Khi có ảnh thiết kế riêng: khai báo đường dẫn trong /assets/assets.json — ảnh sẽ thay thế hình SVG tương ứng.
 */
(function (root) {
  'use strict';
  var INK = '#2b0f2e';
  var A = { overrides: {} };
  function src(u) { return encodeURI(String(u)).replace(/"/g, '%22'); }

  function svg(viewBox, body, cls) {
    return '<svg class="' + (cls || 'art') + '" viewBox="' + viewBox + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" ' +
      'stroke="' + INK + '" stroke-linejoin="round" stroke-linecap="round">' + body + '</svg>';
  }

  // ---------------------------------------------------------------- khuôn mặt dùng chung
  var FACE = {
    idle: function (y) {
      y = y || 0;
      return '<g class="f f-idle" transform="translate(0 ' + y + ')">' +
        '<path d="M60 100 L88 109" stroke-width="7" fill="none"/><path d="M140 100 L112 109" stroke-width="7" fill="none"/>' +
        '<ellipse cx="78" cy="122" rx="13" ry="15" fill="#fff" stroke-width="4"/><ellipse cx="122" cy="122" rx="13" ry="15" fill="#fff" stroke-width="4"/>' +
        '<circle cx="82" cy="125" r="6.5" fill="' + INK + '" stroke="none"/><circle cx="126" cy="125" r="6.5" fill="' + INK + '" stroke="none"/>' +
        '<circle cx="84.5" cy="122" r="2.2" fill="#fff" stroke="none"/><circle cx="128.5" cy="122" r="2.2" fill="#fff" stroke="none"/>' +
        '<path d="M70 146 Q100 178 130 146 Q100 159 70 146 Z" fill="#3b0b14" stroke-width="4"/>' +
        '<path d="M86 151 L90 161 L95 152.5 Z" fill="#fff" stroke-width="2"/><path d="M105 152.5 L110 161 L114 151 Z" fill="#fff" stroke-width="2"/>' +
        '</g>';
    },
    hit1: function (y) { // mắt lệch
      y = y || 0;
      return '<g class="f f-hit1" transform="translate(0 ' + y + ')">' +
        '<ellipse cx="76" cy="117" rx="16" ry="19" fill="#fff" stroke-width="4"/><circle cx="70" cy="112" r="7" fill="' + INK + '" stroke="none"/>' +
        '<ellipse cx="125" cy="129" rx="10" ry="11" fill="#fff" stroke-width="4"/><circle cx="129" cy="132" r="4.5" fill="' + INK + '" stroke="none"/>' +
        '<path d="M82 157 Q91 145 100 156 Q109 167 118 155" fill="none" stroke-width="5"/>' +
        '<path d="M141 95 q7 11 0 15 q-7 -4 0 -15z" fill="#7fd3ff" stroke-width="2.5"/>' +
        '</g>';
    },
    hit2: function (y) { // mắt xoắn ốc (choáng)
      y = y || 0;
      var sp = function (cx, cy) {
        return '<circle cx="' + cx + '" cy="' + cy + '" r="15" fill="#fff" stroke-width="4"/>' +
          '<path d="M' + (cx - 2) + ' ' + cy + ' a2 2 0 1 1 4 0 a4 4 0 1 1 -8 0 a6 6 0 1 1 12 0 a8 8 0 1 1 -16 0 a10 10 0 1 1 20 0" fill="none" stroke-width="3"/>';
      };
      return '<g class="f f-hit2" transform="translate(0 ' + y + ')">' + sp(78, 122) + sp(122, 122) +
        '<path d="M78 156 l8 -7 l8 7 l8 -7 l8 7 l8 -7 l8 7" fill="none" stroke-width="5"/></g>';
    },
    ko: function (y) { // mắt chữ X + lè lưỡi
      y = y || 0;
      return '<g class="f f-ko" transform="translate(0 ' + y + ')">' +
        '<path d="M67 111 L89 133 M89 111 L67 133" stroke-width="7.5"/><path d="M111 111 L133 133 M133 111 L111 133" stroke-width="7.5"/>' +
        '<path d="M73 146 Q100 180 127 146 Z" fill="#3b0b14" stroke-width="4"/>' +
        '<path d="M99 155 Q96 183 111 185 Q125 185 119 158 Z" fill="#ff6f91" stroke-width="4"/>' +
        '<path d="M109 163 L111 176" stroke="#d94a6c" stroke-width="2.5" fill="none"/></g>';
    }
  };

  // ---------------------------------------------------------------- thân các vật phẩm
  function pumpkinBody() {
    return '<path d="M93 72 C91 57 96 44 107 37 L115 44 C107 50 105 58 107 72 Z" fill="#5b8c2a" stroke-width="5"/>' +
      '<path d="M107 52 C121 39 137 43 141 54 C129 59 117 59 107 52 Z" fill="#7cb342" stroke-width="4"/>' +
      '<ellipse cx="65" cy="131" rx="47" ry="58" fill="#e8651b" stroke-width="5"/>' +
      '<ellipse cx="135" cy="131" rx="47" ry="58" fill="#e8651b" stroke-width="5"/>' +
      '<ellipse cx="100" cy="128" rx="45" ry="62" fill="#ff8a2a" stroke-width="5"/>' +
      '<ellipse cx="83" cy="96" rx="11" ry="21" fill="#ffc27d" stroke="none" opacity=".55" transform="rotate(-18 83 96)"/>' +
      '<path d="M32 118 Q36 150 52 170" fill="none" stroke="#c4500f" stroke-width="4"/><path d="M168 118 Q164 150 148 170" fill="none" stroke="#c4500f" stroke-width="4"/>';
  }

  var HAT_CLOTH = '<path d="M38 84 Q100 60 162 84 Q100 102 38 84 Z" fill="#552a86" stroke-width="5"/>' +
    '<path d="M62 80 C70 55 86 30 104 16 C112 9 127 9 133 17 C123 17 117 23 119 31 C125 47 133 64 139 80 Q100 90 62 80 Z" fill="#7b46b8" stroke-width="5"/>' +
    '<path d="M64 73 Q100 83 136 73 L139 81 Q100 92 62 81 Z" fill="#ff9f1c" stroke-width="3.5"/>' +
    '<rect x="92" y="72" width="16" height="13" rx="3" fill="#ffd23f" stroke-width="3.5"/>' +
    '<path d="M83 44 l15 -3 l3 14 l-15 3 z" fill="#9c6ad6" stroke-width="3"/>';

  function ironDome(dented) {
    var s = '<path d="M44 98 C44 52 70 30 100 30 C130 30 156 52 156 98 Z" fill="' + (dented ? '#8a93a6' : '#a3adbf') + '" stroke-width="5"/>' +
      '<path d="M66 54 Q74 43 87 38" stroke="#eef2f7" stroke-width="5" fill="none" opacity=".75"/>' +
      '<path d="M97 31 L103 31 L105 92 L95 92 Z" fill="#c9d0db" stroke="none" opacity=".75"/>' +
      '<rect x="37" y="88" width="126" height="19" rx="8" fill="#7d879a" stroke-width="5"' + (dented ? ' transform="rotate(-5 100 97)"' : '') + '/>';
    var rivets = [56, 78, 100, 122, 144];
    for (var i = 0; i < rivets.length; i++) {
      if (dented && i === 3) continue;
      s += '<circle cx="' + rivets[i] + '" cy="' + (dented ? 97 + (100 - rivets[i]) * 0.09 : 97) + '" r="3.6" fill="#e3e8ef" stroke-width="2"/>';
    }
    if (dented) {
      s += '<path d="M118 40 Q132 52 128 70 Q118 60 104 58 Q114 52 118 40 Z" fill="#5f677a" stroke-width="3.5"/>' +
        '<path d="M70 48 L80 60 L74 66 L84 76" fill="none" stroke-width="3"/>' +
        '<path d="M136 64 L146 70 L142 80" fill="none" stroke-width="3"/>';
    }
    return s;
  }

  function ghostBody() {
    return '<path d="M46 132 Q28 136 30 152 Q42 152 48 142" fill="#f6f3ff" stroke-width="5"/>' +
      '<path d="M154 132 Q172 136 170 152 Q158 152 152 142" fill="#f6f3ff" stroke-width="5"/>' +
      '<path d="M46 192 L46 104 C46 62 70 40 100 40 C130 40 154 62 154 104 L154 192 Q141 178 128 192 Q114 178 100 192 Q86 178 72 192 Q59 178 46 192 Z" fill="#f6f3ff" stroke-width="5"/>' +
      '<path d="M131 58 C146 72 149 94 147 120 L147 182 Q142 177 136 181 L136 112 C136 88 135 72 131 58 Z" fill="#dcd5f7" stroke="none"/>';
  }

  function ghostFace(state) {
    if (state === 'ko') {
      return '<g class="f f-ko"><path d="M72 88 L90 106 M90 88 L72 106" stroke-width="7"/><path d="M110 88 L128 106 M128 88 L110 106" stroke-width="7"/>' +
        '<path d="M82 120 Q100 146 118 120 Z" fill="#3b0b14" stroke-width="4"/><path d="M98 128 Q96 150 108 152 Q118 150 114 130 Z" fill="#ff6f91" stroke-width="3.5"/></g>';
    }
    return '<g class="f f-idle"><ellipse cx="81" cy="98" rx="9" ry="13" fill="' + INK + '" stroke="none"/><ellipse cx="119" cy="98" rx="9" ry="13" fill="' + INK + '" stroke="none"/>' +
      '<circle cx="84" cy="93" r="3" fill="#fff" stroke="none"/><circle cx="122" cy="93" r="3" fill="#fff" stroke="none"/>' +
      '<ellipse cx="68" cy="118" rx="8" ry="5" fill="#ffb3c8" stroke="none"/><ellipse cx="132" cy="118" rx="8" ry="5" fill="#ffb3c8" stroke="none"/>' +
      '<ellipse cx="100" cy="126" rx="9" ry="11" fill="#3b0b14" stroke-width="4"/></g>';
  }

  function virusBody() {
    var s = '';
    for (var i = 0; i < 10; i++) {
      var a = (i / 10) * Math.PI * 2 + 0.3;
      var x1 = 100 + Math.cos(a) * 50, y1 = 120 + Math.sin(a) * 50;
      var x2 = 100 + Math.cos(a) * 70, y2 = 120 + Math.sin(a) * 70;
      s += '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '" stroke-width="12"/>' +
        '<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '" stroke="#4f9a24" stroke-width="5"/>' +
        '<circle cx="' + x2.toFixed(1) + '" cy="' + y2.toFixed(1) + '" r="9" fill="#c4f25d" stroke-width="4.5"/>';
    }
    return s + '<circle cx="100" cy="120" r="54" fill="#7bd13b" stroke-width="5"/>' +
      '<circle cx="72" cy="150" r="8" fill="#5aa82a" stroke="none"/><circle cx="132" cy="96" r="6" fill="#5aa82a" stroke="none"/><circle cx="130" cy="150" r="4.5" fill="#5aa82a" stroke="none"/>' +
      '<ellipse cx="80" cy="88" rx="12" ry="7" fill="#c4f25d" stroke="none" opacity=".7" transform="rotate(-30 80 88)"/>';
  }

  function virusFace(state) {
    if (state === 'ko') {
      return '<g class="f f-ko"><path d="M70 104 L90 124 M90 104 L70 124" stroke-width="7"/><path d="M110 104 L130 124 M130 104 L110 124" stroke-width="7"/>' +
        '<path d="M80 138 Q100 164 120 138 Z" fill="#3b0b14" stroke-width="4"/><path d="M98 146 Q95 168 108 170 Q119 169 115 148 Z" fill="#ff6f91" stroke-width="3.5"/></g>';
    }
    return '<g class="f f-idle"><path d="M68 98 L92 108" stroke-width="7" fill="none"/><path d="M132 98 L108 108" stroke-width="7" fill="none"/>' +
      '<circle cx="82" cy="117" r="10" fill="#fff" stroke-width="4"/><circle cx="118" cy="117" r="10" fill="#fff" stroke-width="4"/>' +
      '<circle cx="84" cy="119" r="4.8" fill="' + INK + '" stroke="none"/><circle cx="116" cy="119" r="4.8" fill="' + INK + '" stroke="none"/>' +
      '<path d="M78 140 L86 134 L93 140 L100 134 L107 140 L114 134 L122 140 Q100 158 78 140 Z" fill="#3b0b14" stroke-width="4"/></g>';
  }

  function potionBody() {
    return '<path d="M52 178 L42 196 M148 178 L158 196" stroke-width="8" fill="none"/>' +
      '<path d="M34 112 Q30 188 100 190 Q170 188 166 112 Z" fill="#2d2838" stroke-width="5"/>' +
      '<path d="M142 126 Q152 160 130 178" stroke="#4d4760" stroke-width="7" fill="none"/>' +
      '<ellipse cx="100" cy="112" rx="70" ry="16" fill="#4a4458" stroke-width="5"/>' +
      '<ellipse cx="100" cy="110" rx="57" ry="10" fill="#79f04a" stroke="none"/>' +
      '<g class="bubbles"><circle class="bub b1" cx="80" cy="96" r="8" fill="#79f04a" stroke-width="4"/>' +
      '<circle class="bub b2" cx="114" cy="86" r="11" fill="#79f04a" stroke-width="4"/>' +
      '<circle class="bub b3" cx="97" cy="64" r="6" fill="#79f04a" stroke-width="3.5"/></g>';
  }

  function potionFace(state) {
    if (state === 'ko') {
      return '<g class="f f-ko"><path d="M64 134 L84 154 M84 134 L64 154" stroke="#ffe14d" stroke-width="7"/><path d="M116 134 L136 154 M136 134 L116 154" stroke="#ffe14d" stroke-width="7"/>' +
        '<path d="M86 164 Q100 182 114 164 Z" fill="#11101a" stroke="#ffe14d" stroke-width="3"/></g>';
    }
    return '<g class="f f-idle"><path d="M62 136 L90 144 L82 156 Q68 154 62 136 Z" fill="#ffe14d" stroke-width="3.5"/>' +
      '<path d="M138 136 L110 144 L118 156 Q132 154 138 136 Z" fill="#ffe14d" stroke-width="3.5"/>' +
      '<path d="M78 166 Q100 180 122 166" fill="none" stroke="#ffe14d" stroke-width="5"/></g>';
  }

  function candyBody() {
    return '<path d="M60 124 L18 92 Q8 124 18 156 Z" fill="#ff4f8b" stroke-width="5"/>' +
      '<path d="M140 124 L182 92 Q192 124 182 156 Z" fill="#ff4f8b" stroke-width="5"/>' +
      '<path d="M30 104 L44 120 M28 142 L44 128 M170 104 L156 120 M172 142 L156 128" stroke="#c2185b" stroke-width="3" fill="none"/>' +
      '<circle cx="100" cy="124" r="47" fill="#ffb347" stroke-width="5"/>' +
      '<path d="M68 90 Q92 100 96 172 M100 78 Q124 96 120 170 M136 96 Q146 120 140 150" stroke="#fff4dc" stroke-width="10" fill="none" opacity=".9"/>' +
      '<circle cx="100" cy="124" r="47" fill="none" stroke-width="5"/>';
  }

  function candyFace(state) {
    if (state === 'ko') {
      return '<g class="f f-ko"><path d="M78 108 L94 124 M94 108 L78 124" stroke-width="6.5"/><path d="M106 108 L122 124 M122 108 L106 124" stroke-width="6.5"/>' +
        '<path d="M86 134 Q100 156 114 134 Z" fill="#3b0b14" stroke-width="3.5"/><path d="M99 141 Q97 160 107 161 Q116 160 112 143 Z" fill="#ff6f91" stroke-width="3"/></g>';
    }
    return '<g class="f f-idle"><ellipse cx="86" cy="116" rx="6.5" ry="9" fill="' + INK + '" stroke="none"/><ellipse cx="114" cy="116" rx="6.5" ry="9" fill="' + INK + '" stroke="none"/>' +
      '<circle cx="88" cy="112" r="2.4" fill="#fff" stroke="none"/><circle cx="116" cy="112" r="2.4" fill="#fff" stroke="none"/>' +
      '<ellipse cx="74" cy="132" rx="7" ry="4.5" fill="#ff7aa8" stroke="none"/><ellipse cx="126" cy="132" rx="7" ry="4.5" fill="#ff7aa8" stroke="none"/>' +
      '<path d="M88 134 Q100 146 112 134" fill="none" stroke-width="5"/></g>';
  }

  function bombFuse() {
    return '<path d="M100 58 C100 42 112 31 125 31" fill="none" stroke-width="10"/>' +
      '<path d="M100 58 C100 42 112 31 125 31" fill="none" stroke="#c99a5b" stroke-width="5"/>' +
      '<g class="spark"><path d="M128 10 L132 22 L144 20 L135 29 L142 40 L129 34 L121 44 L121 31 L110 26 L122 23 Z" fill="#ffd23f" stroke="#ff6b1a" stroke-width="3"/>' +
      '<circle cx="127" cy="28" r="4" fill="#fff" stroke="none"/></g>';
  }
  function bombCore() {
    return '<circle cx="100" cy="128" r="60" fill="#2a2433" stroke-width="5"/>' +
      '<rect x="84" y="58" width="32" height="18" rx="4" fill="#5c5670" stroke-width="5"/>' +
      '<ellipse cx="74" cy="100" rx="17" ry="10" fill="#fff" stroke="none" opacity=".3" transform="rotate(-32 74 100)"/>' +
      '<path d="M64 112 L94 122 L89 135 Q70 135 64 112 Z" fill="#ff3b3b" stroke-width="4"/>' +
      '<path d="M136 112 L106 122 L111 135 Q130 135 136 112 Z" fill="#ff3b3b" stroke-width="4"/>' +
      '<rect x="76" y="148" width="48" height="17" rx="6" fill="#f3efe6" stroke-width="4"/>' +
      '<path d="M88 148 L88 165 M100 148 L100 165 M112 148 L112 165" stroke-width="3"/>';
  }
  function bombBody(skin) {
    if (skin === 'cloth') return bombCore() + '<g transform="translate(0 -14)">' + HAT_CLOTH + '</g>';
    if (skin === 'iron') return bombCore() + '<g transform="translate(0 -6)">' + ironDome(false) + '</g>';
    if (skin === 'potion') {
      return bombCore() +
        '<ellipse cx="100" cy="76" rx="58" ry="14" fill="#4a4458" stroke-width="5"/>' +
        '<ellipse cx="100" cy="74" rx="47" ry="8" fill="#79f04a" stroke="none"/>' +
        '<g class="bubbles"><circle class="bub b1" cx="84" cy="60" r="7" fill="#79f04a" stroke-width="3.5"/>' +
        '<circle class="bub b2" cx="114" cy="52" r="9" fill="#79f04a" stroke-width="3.5"/><circle class="bub b3" cx="98" cy="36" r="5" fill="#79f04a" stroke-width="3"/></g>';
    }
    return bombFuse() + bombCore();
  }

  // ---------------------------------------------------------------- boss
  function bossFace(state) {
    if (state === 'ko') return FACE.ko();
    if (state === 'hit1') {
      return '<g class="f f-hit1"><path d="M64 110 L90 136 M90 110 L64 136" stroke-width="8"/>' +
        '<path d="M136 112 L108 120 L114 134 Q130 132 136 112 Z" fill="#ff3b3b" stroke-width="4"/>' +
        '<path d="M70 156 q10 -10 20 0 t20 0 t20 0" fill="none" stroke-width="6"/>' +
        '<path d="M58 78 L70 94 L62 102 L74 116" fill="none" stroke-width="3.5"/><path d="M146 150 L134 160 L142 168" fill="none" stroke-width="3.5"/></g>';
    }
    return '<g class="f f-idle"><path d="M56 94 L92 112" stroke-width="10"/><path d="M144 94 L108 112" stroke-width="10"/>' +
      '<path d="M62 112 L92 121 L86 135 Q68 133 62 112 Z" fill="#ff3b3b" stroke-width="4"/>' +
      '<path d="M138 112 L108 121 L114 135 Q132 133 138 112 Z" fill="#ff3b3b" stroke-width="4"/>' +
      '<path d="M60 146 L72 138 L82 148 L92 138 L100 148 L108 138 L118 148 L128 138 L140 146 Q100 190 60 146 Z" fill="#3b0b14" stroke-width="4"/>' +
      '<path d="M72 146 L78 160 L84 148 Z M116 148 L122 160 L128 146 Z" fill="#fff" stroke-width="2"/></g>';
  }
  var HORNS = '<path d="M62 76 Q42 52 50 30 Q62 54 80 68 Z" fill="#8b1a1a" stroke-width="5"/><path d="M138 76 Q158 52 150 30 Q138 54 120 68 Z" fill="#8b1a1a" stroke-width="5"/>';
  var CHEST_ARMOR = '<g class="armor"><path d="M36 150 Q100 130 164 150 L158 184 Q100 202 42 184 Z" fill="#8a93a6" stroke-width="5"/>' +
    '<path d="M100 140 L100 194" stroke-width="3"/><circle cx="58" cy="160" r="3.5" fill="#e3e8ef" stroke-width="2"/><circle cx="142" cy="160" r="3.5" fill="#e3e8ef" stroke-width="2"/>' +
    '<circle cx="80" cy="178" r="3.5" fill="#e3e8ef" stroke-width="2"/><circle cx="120" cy="178" r="3.5" fill="#e3e8ef" stroke-width="2"/></g>';


  // ---------------------------------------------------------------- vật phẩm
  // state: idle | hit1 | hit2 | ko
  function itemSvg(type, skin) {
    var b = '';
    if (type === 'pumpkin') {
      b = pumpkinBody() + FACE.idle() + FACE.ko();
    } else if (type === 'pumpkinCloth') {
      b = pumpkinBody() + FACE.idle() + FACE.hit1() + FACE.ko() + '<g class="hat hat-cloth">' + HAT_CLOTH + '</g>';
    } else if (type === 'pumpkinIron') {
      b = pumpkinBody() + FACE.idle(2) + FACE.hit1() + FACE.hit2() + FACE.ko() +
        '<g class="hat hat-iron">' + ironDome(false) + '</g><g class="hat hat-iron-dent">' + ironDome(true) + '</g>';
    } else if (type === 'ghost') {
      b = ghostBody() + ghostFace('idle') + ghostFace('ko');
    } else if (type === 'virus') {
      b = virusBody() + virusFace('idle') + virusFace('ko');
    } else if (type === 'potion') {
      b = potionBody() + potionFace('idle') + potionFace('ko');
    } else if (type === 'candy') {
      b = candyBody() + candyFace('idle') + candyFace('ko');
    } else if (type === 'bomb') {
      b = bombBody(skin);
    } else if (type === 'boss') {
      b = HORNS + pumpkinBody() + bossFace('idle') + bossFace('hit1') + bossFace('ko');
    } else if (type === 'bossArmor') {
      b = pumpkinBody() + bossFace('idle') + bossFace('hit1') + bossFace('ko') +
        '<g class="hat hat-boss-armor">' + ironDome(false) + CHEST_ARMOR + '</g>';
    }
    return svg('0 0 200 200', b, 'art item-art');
  }

  var STATES = { pumpkin: ['idle', 'ko'], pumpkinCloth: ['idle', 'hit1', 'ko'], pumpkinIron: ['idle', 'hit1', 'hit2', 'ko'], ghost: ['idle', 'ko'], virus: ['idle', 'ko'], potion: ['idle', 'ko'], candy: ['idle', 'ko'], bomb: ['idle'], boss: ['idle', 'hit1', 'ko'], bossArmor: ['idle', 'hit1', 'ko'] };

  // Nếu có ảnh thiết kế (assets.json) thì dùng ảnh, ngược lại dùng SVG mặc định.
  A.item = function (type, skin) {
    var o = A.overrides.items && A.overrides.items[type + (skin ? '_' + skin : '')] || (A.overrides.items && A.overrides.items[type]);
    var extra = type.indexOf('boss') === 0 ? '<div class="boss-hp"><i></i></div>' : '';
    if (o && o.idle) {
      var html = '';
      var st = STATES[type] || ['idle'];
      for (var i = 0; i < st.length; i++) {
        var srcPath = o[st[i]] || o.idle;
        html += '<img class="f f-' + st[i] + '" src="' + src(srcPath) + '" alt="" draggable="false">';
      }
      return '<div class="art item-art img-art">' + html + '</div>' + extra;
    }
    return itemSvg(type, skin) + extra;
  };

  A.hat = function (kind) {
    var o = A.overrides.items;
    if (kind === 'cloth' && o && o.pumpkinCloth && o.pumpkinCloth.hat) return '<img class="art" src="' + src(o.pumpkinCloth.hat) + '" alt="">';
    if (kind === 'iron' && o && o.pumpkinIron && o.pumpkinIron.hat) return '<img class="art" src="' + src(o.pumpkinIron.hat) + '" alt="">';
    return svg('0 0 200 200', kind === 'cloth' ? HAT_CLOTH : ironDome(true), 'art');
  };

  A.icon = function (type) { // hình nhỏ dùng trong Hướng dẫn
    return A.item(type).replace('class="art item-art', 'class="art item-art icon-art');
  };

  // Búa: Sấm Sét (mặc định) / Băng Long / Hỏa Long / Kim Cang — đổi theo mốc combo trong cấu hình
  A.hammer = function () {
    return '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<path d="M22 90 L58 42" stroke="#2b0f2e" stroke-width="13" stroke-linecap="round"/>' +
      '<path class="hm-handle" d="M22 90 L58 42" stroke="#8a5a32" stroke-width="6" stroke-linecap="round"/>' +
      '<path d="M27 83 L32 77 M33 76 L38 70 M39 68 L44 62" stroke="#5a3418" stroke-width="2.5" stroke-linecap="round"/>' +
      '<g transform="rotate(37 62 32)">' +
      '<g class="hm-fire"><path d="M40 16 Q36 2 46 -6 Q46 6 54 8 Q52 -4 62 -12 Q62 2 70 6 Q72 -6 82 -8 Q78 4 86 14 Z" fill="#ff6b1a" stroke="#2b0f2e" stroke-width="3"/>' +
      '<path d="M50 16 Q50 6 56 2 Q58 10 64 10 Q66 2 72 0 Q70 10 76 16 Z" fill="#ffd23f" stroke="none"/></g>' +
      '<rect class="hm-head" x="34" y="16" width="58" height="32" rx="10" fill="#9aa7bd" stroke="#2b0f2e" stroke-width="5"/>' +
      '<rect class="hm-band" x="45" y="16" width="8" height="32" fill="#5d6b85" stroke="#2b0f2e" stroke-width="3"/>' +
      '<rect class="hm-band" x="73" y="16" width="8" height="32" fill="#5d6b85" stroke="#2b0f2e" stroke-width="3"/>' +
      '<path class="hm-bolt" d="M66 19 L57 33 L64 33 L58 46 L71 29 L64 29 L70 19 Z" fill="#ffd23f" stroke="#2b0f2e" stroke-width="2"/>' +
      '<g class="hm-ice"><path d="M38 22 L46 26 M42 18 L42 30 M80 36 L88 40 M84 32 L84 44" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round"/>' +
      '<path d="M36 46 L40 54 L44 46 M56 46 L60 56 L64 46 M76 46 L80 53 L84 46" fill="#dff6ff" stroke="#2b0f2e" stroke-width="2"/></g>' +
      '<g class="hm-armor"><path d="M34 22 L26 18 L34 28 Z M34 42 L26 46 L34 36 Z M92 22 L100 18 L92 28 Z M92 42 L100 46 L92 36 Z" fill="#cfd6e0" stroke="#2b0f2e" stroke-width="2.5"/>' +
      '<circle cx="49" cy="32" r="3" fill="#ffd23f" stroke="#2b0f2e" stroke-width="1.5"/><circle cx="77" cy="32" r="3" fill="#ffd23f" stroke="#2b0f2e" stroke-width="1.5"/></g>' +
      '</g></svg>';
  };

  A.fx = function (kind) {
    if (kind === 'bolt') {
      return '<svg viewBox="0 0 100 200" aria-hidden="true"><path d="M62 0 L34 86 L54 86 L30 200 L80 70 L58 70 L78 0 Z" fill="#fff7b0" stroke="#ffd23f" stroke-width="5" stroke-linejoin="round"/>' +
        '<path d="M64 6 L44 80 L60 80 L44 160" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/></svg>';
    }
    if (kind === 'ice') {
      return '<svg viewBox="0 0 120 120" aria-hidden="true">' +
        '<path d="M20 96 L30 40 L42 92 Z M38 98 L52 22 L66 96 Z M62 98 L78 34 L90 96 Z M84 98 L98 52 L106 96 Z" fill="#bdeeff" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" opacity=".92"/>' +
        '<path d="M52 30 L52 90 M30 48 L30 90 M78 42 L78 90" stroke="#ffffff" stroke-width="2" opacity=".8"/>' +
        '<g stroke="#ffffff" stroke-width="3" stroke-linecap="round"><path d="M18 22 L18 38 M10 30 L26 30 M12 24 L24 36 M24 24 L12 36"/><path d="M102 16 L102 30 M95 23 L109 23"/></g></svg>';
    }
    if (kind === 'fire') {
      return '<svg viewBox="0 0 120 130" aria-hidden="true">' +
        '<path d="M14 124 Q4 86 24 66 Q22 88 36 92 Q30 58 54 30 Q52 64 70 70 Q66 44 82 22 Q84 56 100 66 Q104 86 96 92 Q112 92 112 72 Q122 104 104 124 Z" fill="#ff5a1f" stroke="#2b0f2e" stroke-width="4" stroke-linejoin="round"/>' +
        '<path d="M32 124 Q26 100 40 88 Q42 104 54 104 Q50 80 64 64 Q66 88 80 92 Q82 76 92 70 Q98 100 86 124 Z" fill="#ffd23f"/>' +
        '<path d="M50 124 Q48 110 58 102 Q62 112 70 112 Q74 118 70 124 Z" fill="#fff4c2"/></svg>';
    }
    if (kind === 'star') {
      return '<svg viewBox="0 0 120 120" aria-hidden="true"><path d="M60 4 L70 44 L112 30 L80 60 L112 90 L70 76 L60 116 L50 76 L8 90 L40 60 L8 30 L50 44 Z" fill="#ffd23f" stroke="#2b0f2e" stroke-width="4" stroke-linejoin="round"/>' +
        '<path d="M60 30 L65 55 L90 60 L65 65 L60 90 L55 65 L30 60 L55 55 Z" fill="#fffbe6"/></svg>';
    }
    return '';
  };

  A.boom = function () {
    var pts = function (r1, r2, n, cx, cy) {
      var p = [];
      for (var i = 0; i < n * 2; i++) {
        var r = i % 2 ? r2 : r1, a = (i / (n * 2)) * Math.PI * 2;
        p.push((cx + Math.cos(a) * r).toFixed(1) + ',' + (cy + Math.sin(a) * r).toFixed(1));
      }
      return p.join(' ');
    };
    return svg('0 0 200 200',
      '<polygon points="' + pts(96, 52, 12, 100, 100) + '" fill="#ffd23f" stroke-width="5"/>' +
      '<polygon points="' + pts(66, 34, 10, 100, 100) + '" fill="#ff6b1a" stroke="none"/>' +
      '<circle cx="100" cy="100" r="26" fill="#fff3c4" stroke="none"/>' +
      '<text x="100" y="114" text-anchor="middle" font-family="Baloo 2, sans-serif" font-weight="800" font-size="40" fill="' + INK + '" stroke="#fff" stroke-width="2" paint-order="stroke">BÙM!</text>', 'art boom-art');
  };

  // ---------------------------------------------------------------- mascot NÉT (placeholder)
  A.mascot = function (mood) {
    mood = mood || 'idle';
    var o = A.overrides.mascot;
    if (o && (o[mood] || o.idle)) return '<img class="art mascot-img" src="' + src(o[mood] || o.idle) + '" alt="Mascot NÉT">';
    var eyes, mouth, extra = '';
    if (mood === 'happy') {
      eyes = '<path d="M84 132 Q96 116 108 132" fill="none" stroke-width="7"/><path d="M132 132 Q144 116 156 132" fill="none" stroke-width="7"/>';
      mouth = '<path d="M96 150 Q120 182 144 150 Z" fill="#3b0b14" stroke-width="5"/><path d="M110 164 Q120 176 130 164 Z" fill="#ff6f91" stroke="none"/>';
    } else if (mood === 'scared') {
      eyes = '<ellipse cx="96" cy="128" rx="17" ry="21" fill="#fff" stroke-width="5"/><ellipse cx="144" cy="128" rx="17" ry="21" fill="#fff" stroke-width="5"/>' +
        '<circle cx="96" cy="130" r="4" fill="' + INK + '" stroke="none"/><circle cx="144" cy="130" r="4" fill="' + INK + '" stroke="none"/>';
      mouth = '<path d="M104 166 q8 -8 16 0 t16 0" fill="none" stroke-width="5"/>';
      extra = '<path d="M176 100 q9 13 0 19 q-9 -6 0 -19z" fill="#7fd3ff" stroke-width="3"/>';
    } else if (mood === 'sad') {
      eyes = '<path d="M82 126 Q96 138 110 126" fill="none" stroke-width="7"/><path d="M130 126 Q144 138 158 126" fill="none" stroke-width="7"/>' +
        '<path d="M92 136 q-6 12 0 16 q6 -4 0 -16z" fill="#7fd3ff" stroke-width="3"/>';
      mouth = '<path d="M104 168 Q120 154 136 168" fill="none" stroke-width="6"/>';
    } else {
      eyes = '<ellipse cx="96" cy="128" rx="15" ry="19" fill="#fff" stroke-width="5"/><ellipse cx="144" cy="128" rx="15" ry="19" fill="#fff" stroke-width="5"/>' +
        '<circle cx="99" cy="132" r="8" fill="' + INK + '" stroke="none"/><circle cx="147" cy="132" r="8" fill="' + INK + '" stroke="none"/>' +
        '<circle cx="102" cy="128" r="3" fill="#fff" stroke="none"/><circle cx="150" cy="128" r="3" fill="#fff" stroke="none"/>';
      mouth = '<path d="M102 156 Q120 174 138 156" fill="none" stroke-width="6"/>';
    }
    var body =
      '<path d="M196 160 L222 122" stroke-width="12"/><path d="M196 160 L222 122" stroke="#a86b3c" stroke-width="6"/>' +
      '<rect x="200" y="92" width="44" height="32" rx="9" fill="#ff8a2a" stroke-width="6" transform="rotate(34 222 108)"/>' +
      '<path d="M58 236 Q66 252 86 250 L92 236 Z" fill="#1565c0" stroke-width="6"/><path d="M182 236 Q174 252 154 250 L148 236 Z" fill="#1565c0" stroke-width="6"/>' +
      '<path d="M44 160 C44 100 80 72 120 72 C160 72 196 100 196 160 C196 214 166 242 120 242 C74 242 44 214 44 160 Z" fill="#1e88e5" stroke-width="6"/>' +
      '<ellipse cx="120" cy="196" rx="50" ry="36" fill="#bbdefb" stroke="none"/>' +
      '<text x="120" y="210" text-anchor="middle" font-family="Baloo 2, sans-serif" font-weight="800" font-size="34" fill="#0d47a1" stroke="none">NÉT</text>' +
      '<path d="M44 170 Q24 176 28 196 Q42 194 48 184" fill="#1e88e5" stroke-width="6"/>' +
      '<path d="M58 88 Q120 62 182 88 Q120 104 58 88 Z" fill="#552a86" stroke-width="6"/>' +
      '<path d="M80 84 C88 58 104 30 124 14 C132 8 146 9 150 18 C140 18 136 25 138 33 C144 49 152 68 160 84 Q120 94 80 84 Z" fill="#7b46b8" stroke-width="6"/>' +
      '<path d="M82 76 Q120 86 158 76 L161 85 Q120 96 80 85 Z" fill="#ff9f1c" stroke-width="4"/>' +
      eyes + mouth + extra;
    return svg('0 0 250 260', body, 'art mascot-art mood-' + mood);
  };

  // ---------------------------------------------------------------- icon giao diện
  var ICONS = {
    fullscreen: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none"/>',
    exitFullscreen: '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" fill="none"/>',
    sound: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a4.5 4.5 0 0 1 0 7M18.5 6a8 8 0 0 1 0 12" fill="none"/>',
    mute: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6" fill="none"/>',
    pause: '<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    home: '<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
    replay: '<path d="M4 12a8 8 0 1 0 2.4-5.7" fill="none"/><path d="M4 4v5h5" fill="none"/>',
    book: '<path d="M4 5c3-1.5 6-1.5 8 0v14c-2-1.5-5-1.5-8 0zM20 5c-3-1.5-6-1.5-8 0v14c2-1.5 5-1.5 8 0z" fill="none"/>',
    ticket: '<path d="M3 8a2 2 0 0 0 0 4v0a2 2 0 0 1 0 4v2h18v-2a2 2 0 0 1 0-4 2 2 0 0 0 0-4V6H3z" fill="none"/><path d="M14 7v2M14 11v2M14 15v2" fill="none"/>',
    trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 20h8" fill="none"/>',
    close: '<path d="M6 6l12 12M18 6L6 18" fill="none"/>',
    copy: '<rect x="8" y="8" width="11" height="11" rx="2" fill="none"/><path d="M5 15V6a1 1 0 0 1 1-1h9" fill="none"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2" fill="none"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none"/>',
    gift: '<rect x="4" y="9" width="16" height="11" rx="1.5" fill="none"/><path d="M3 9h18M12 9v11M12 9c-2-4-6-4-6-1.5S10 9 12 9c2 0 6-1 6-1.5S14 5 12 9" fill="none"/>',
    clock: '<circle cx="12" cy="12" r="8.5" fill="none"/><path d="M12 7.5V12l3 2" fill="none"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z"/>',
    flame: '<path d="M12 21c4 0 7-2.7 7-6.6 0-3.7-2.7-5.6-4-9.4-1 2.4-2.3 3.4-3.5 3.9C11 6.6 10 4.6 8.6 3 8.7 7 5 9.3 5 14.4 5 18.3 8 21 12 21z"/>'
  };
  A.ui = function (name) {
    return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
  };

  root.HLWArt = A;
}(window));
