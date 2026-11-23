// 画面を描く。場面は GAME_DATA.sprites のドット絵を3倍にして描く（設計図.md の8節・9節）。
// 文字と上に重ねる物は 1280×720 の側に、設計図/見本-src.html の図3の寸法のまま描く。
(function () {
  var W = 1280, H = 720;
  var FONT = '"Hiragino Sans","Noto Sans JP",sans-serif';
  var fx = []; // 当たった時の輪（events から作る）
  var flash = 0; // ダメージを受けた時の赤い点滅の残り秒
  var SP = null; // 読みこんだドット絵 {img: {名前: canvas}, n: {名前: 種類の数}, ...}
  var missing = []; // 見つからなかった絵の名前（tests/smoke.test.js が 0 件を確かめる）
  var cache = typeof WeakMap !== 'undefined' ? new WeakMap() : null; // 階ごとの prep
  var moved = typeof WeakMap !== 'undefined' ? new WeakMap() : null; // キャラクターごとの {x, y, t}

  function font(size, weight) { return (weight || 700) + ' ' + size + 'px ' + FONT; }
  function colors(game) { return game.config.colors; } // 色は config.colors だけ

  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

  function dir(f) {
    if (typeof f === 'number') return { x: Math.cos(f), y: Math.sin(f) };
    if (f && (f.x || f.y)) { var l = Math.hypot(f.x, f.y); return { x: f.x / l, y: f.y / l }; }
    return { x: 0, y: 1 };
  }

  function newCanvas(w, h) { var c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  // 絵を from → swap → rows → flipX の順に解く（tools/preview_sprites.py と同じ）
  function resolve(S, name, seen) {
    var sp = S.sprites[name];
    if (!sp || seen.indexOf(name) >= 0) throw new Error('絵が無いか from が輪になっている: ' + name);
    if (Array.isArray(sp)) return sp.slice();
    var rows = resolve(S, sp.from, seen.concat(name));
    if (sp.swap) rows = rows.map(function (r) { return r.split('').map(function (c) { return sp.swap[c] || c; }).join(''); });
    for (var i in sp.rows || {}) rows[+i] = sp.rows[i];
    if (sp.flipX) rows = rows.map(function (r) { return r.split('').reverse().join(''); });
    return rows;
  }

  // 読みこみの時に1回だけ、全部の絵を小さいキャンバスにし、「名前.数字」の種類の数を数える
  function sprites() {
    if (SP) return SP;
    var S = window.GAME_DATA.sprites, img = {}, n = {};
    Object.keys(S.sprites).forEach(function (name) {
      var rows = resolve(S, name, []), w = rows[0].length, h = rows.length, c = newCanvas(w, h);
      var cx = c.getContext('2d'), id = cx.createImageData(w, h);
      rows.forEach(function (r, y) {
        for (var x = 0; x < w; x++) {
          var hex = S.palette[r[x]];
          if (!hex) continue;
          var v = parseInt(hex.slice(1), 16), o = (y * w + x) * 4;
          id.data[o] = v >> 16; id.data[o + 1] = (v >> 8) & 255; id.data[o + 2] = v & 255; id.data[o + 3] = 255;
        }
      });
      cx.putImageData(id, 0, 0);
      img[name] = c;
      var m = /^(.*)\.(\d+)$/.exec(name);
      if (m) n[m[1]] = Math.max(n[m[1]] || 0, +m[2] + 1);
    });
    SP = { img: img, n: n, art: S.artPxPerM, sw: S.screen[0], sh: S.screen[1], k: S.scale };
    return SP;
  }

  function img(name) { var c = SP.img[name]; if (!c && missing.indexOf(name) < 0) missing.push(name); return c; }

  // 「名前」か「名前.<i % 種類の数>」の絵
  function pick(base, i) {
    var n = SP.n[base];
    return img(n ? base + '.' + (((i % n) + n) % n) : base);
  }

  // 階ごとに1回だけ作る：床と壁を描いた大きいキャンバス・棚のマス・名前を置く所
  function prep(game, floorId) {
    var floor = game.floors[floorId];
    var p = cache && cache.get(floor);
    if (p) return p;
    var A = sprites(), cell = Math.round(floor.cellM * A.art), cols = floor.cols, rows = floor.rows;
    var M = Math.ceil(Math.max(A.sw, A.sh) / 2 / cell) + 1; // 画面の半分より広い外の余白（端でも外の絵が続く）
    var fs = (game.config.floorSprites && game.config.floorSprites[floorId]) || 'floor';
    var byId = {}, zi = {};
    floor.zones.forEach(function (z, i) { byId[z.id] = z; zi[z.id] = i; });
    function type(cx, cy) {
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return 'outside';
      var z = byId[floor.cells[cy][cx]];
      return z ? z.type : 'outside';
    }
    var big = newCanvas((cols + 2 * M) * cell, (rows + 2 * M) * cell), bctx = big.getContext('2d');
    var sum = {};
    for (var cy = -M; cy < rows + M; cy++) for (var cx = -M; cx < cols + M; cx++) {
      var t = type(cx, cy), im;
      if (t === 'outside') {
        var wall = false;
        for (var dy = -1; dy <= 1 && !wall; dy++) for (var dx = -1; dx <= 1; dx++) if (type(cx + dx, cy + dy) !== 'outside') { wall = true; break; }
        im = img(!wall ? 'outside' : type(cx, cy + 1) !== 'outside' ? 'wall.face' : 'wall.top');
      } else {
        im = t === 'aisle' || t === 'section' ? pick(fs + '.' + t, cx * 7 + cy * 13) : (img(t) || A.img.solid);
        var id = floor.cells[cy][cx], s = sum[id] || (sum[id] = { x: 0, y: 0, n: 0 });
        s.x += cx; s.y += cy; s.n++;
      }
      bctx.drawImage(im, (cx + M) * cell, (cy + M) * cell);
    }
    // 棚：fixture のマスごとに1枚。下の端をマスの下の端に合わせる
    var fix = [];
    (floor.fixtures || []).forEach(function (f) {
      var base = 'fixture.' + f.kind, v = base + '.v';
      // 縦に長い棚は「<kind>.v」の絵があればそれ（8×8 ではみ出さない）
      var im = pick(f.h > f.w && (SP.n[v] || SP.img[v]) ? v : base, zi[f.zoneId] || 0);
      if (!im) return;
      var c0 = Math.round(f.x / floor.cellM), r0 = Math.round(f.y / floor.cellM);
      var c1 = Math.round((f.x + f.w) / floor.cellM), r1 = Math.round((f.y + f.h) / floor.cellM);
      for (var cy = r0; cy < r1; cy++) for (var cx = c0; cx < c1; cx++) fix.push({ im: im, x: cx * cell, y: (cy + 1) * cell - im.height, foot: (cy + 1) * cell });
    });
    // 足もとの y の順に1回だけ並べ、同じ足もと・同じ絵で横に続くマスは1枚のキャンバスにまとめる（1フレームの drawImage を減らす）
    fix.sort(function (a, b) { return a.foot - b.foot || a.x - b.x; });
    var runs = [], fixH = 0;
    for (var i = 0; i < fix.length;) {
      var j = i + 1;
      while (j < fix.length && fix[j].foot === fix[i].foot && fix[j].im === fix[i].im && fix[j].x === fix[j - 1].x + cell) j++;
      var x0 = fix[i].x, rw = fix[j - 1].x + fix[j - 1].im.width - x0, rh = fix[i].im.height, rc = newCanvas(rw, rh), rctx = rc.getContext('2d');
      for (var q = i; q < j; q++) rctx.drawImage(fix[q].im, fix[q].x - x0, 0);
      runs.push({ im: rc, x: x0, y: fix[i].y, w: rw, h: rh, foot: fix[i].foot });
      i = j;
    }
    // 背が1マスの棚（はみ出さない縦の棚）は、同じ x で縦に続く物を1枚にまとめる。cells は1マスずつ描く時に使う
    var items = [], open = {};
    runs.forEach(function (r) {
      var c = r.h === cell && open[r.x + ',' + r.w];
      if (c && c.foot + cell === r.foot) { c.cells.push(r); c.foot = r.foot; c.h += cell; return; }
      c = { x: r.x, y: r.y, w: r.w, h: r.h, foot: r.foot, im: r.im, cells: [r] };
      if (r.h === cell) open[r.x + ',' + r.w] = c;
      items.push(c);
    });
    items.forEach(function (c) {
      if (c.cells.length < 2) { c.cells = null; } else {
        c.im = newCanvas(c.w, c.h);
        var cc = c.im.getContext('2d');
        c.cells.forEach(function (r) { cc.drawImage(r.im, 0, r.y - c.y); });
      }
      fixH = Math.max(fixH, c.h);
    });
    items.sort(function (a, b) { return a.foot - b.foot || a.x - b.x; });
    // 名前は重心にいちばん近い zone の中のマスに置く（L字の売場でも外に出ない）
    var labels = [];
    floor.zones.forEach(function (z) {
      var s = sum[z.id];
      if (!s || !/^(section|tenant|toilet|stairs|escalator|elevator)$/.test(z.type)) return;
      var gx = s.x / s.n, gy = s.y / s.n, best = null, bd = Infinity;
      for (var cy = 0; cy < rows; cy++) for (var cx = 0; cx < cols; cx++) {
        if (floor.cells[cy][cx] !== z.id) continue;
        var d = (cx - gx) * (cx - gx) + (cy - gy) * (cy - gy);
        if (d < bd) { bd = d; best = [cx, cy]; }
      }
      labels.push({ name: z.name, sign: z.type === 'section', x: (best[0] + 0.5) * floor.cellM, y: (best[1] + 0.5) * floor.cellM });
    });
    p = { big: big, M: M * cell, fix: items, fixH: fixH, labels: labels };
    if (cache) cache.set(floor, p);
    return p;
  }

  // キャラクターの絵：向きは facing にいちばん近い4方向。止まっている時は 0、歩いている時は 1 と 2 を config.anim.walkFrameSec ごとに
  function charSprite(kind, e, time, frameSec) {
    var f = e.facing, dx = 0, dy = 1; // dir() を呼ばない（フレームごとにオブジェクトを作らない）
    if (typeof f === 'number') { dx = Math.cos(f); dy = Math.sin(f); } else if (f && (f.x || f.y)) { dx = f.x; dy = f.y; }
    var side = Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
    var m = moved && moved.get(e);
    if (!m) { m = { x: e.x, y: e.y, t: -1 }; if (moved) moved.set(e, m); }
    if (m.x !== e.x || m.y !== e.y) { m.x = e.x; m.y = e.y; m.t = time; }
    var walking = time - m.t < 0.1; // 描く回数が進行の刻みより多くても、歩きの間は止まって見えない
    return img(kind + '.' + side + '.' + (walking ? 1 + Math.floor(time / frameSec) % 2 : 0));
  }

  // 文字は変わらない限り1回だけ小さいキャンバスに描いて使い回す（毎フレーム fillText しない）。
  // 寸法は図3のまま。s は画面の 1px あたりのキャンバスの px（devicePixelRatio × 拡大）で、変わったら作り直す
  var texts = {}, textS = 0;
  function textImg(kind, text, C, s) {
    if (s !== textS) { texts = {}; textS = s; }
    var id = kind + '|' + text, t = texts[id];
    if (t) return t;
    var size = { sign: 13, name: 13, hp: 14, place: 16, prompt: 18 }[kind];
    var c = newCanvas(1, 1), x = c.getContext('2d');
    x.font = font(size);
    var tw = x.measureText(text).width;
    // 箱：sign 左右10 高さ24 角4・place 左右16 高さ36 角18・prompt 左右20 高さ44 角22 枠2。name と hp は影のぶん4の余白
    var w = tw + { sign: 20, name: 8, hp: 8, place: 32, prompt: 40 }[kind], h = { sign: 24, name: 24, hp: 24, place: 36, prompt: 44 }[kind];
    c.width = Math.ceil(w * s); c.height = Math.ceil(h * s);
    x = c.getContext('2d'); x.scale(s, s);
    x.font = font(size); x.textBaseline = 'middle'; x.textAlign = kind === 'hp' ? 'left' : 'center';
    if (kind === 'sign') { rr(x, 0, 0, w, 24, 4); x.fillStyle = C.sign; x.fill(); x.fillStyle = C.signText; x.fillText(text, w / 2, 13); }
    if (kind === 'place') { rr(x, 0, 0, w, 36, 18); x.fillStyle = 'rgba(0,0,0,.55)'; x.fill(); x.fillStyle = '#fff'; x.fillText(text, w / 2, 19); }
    if (kind === 'prompt') {
      rr(x, 1, 1, w - 2, 42, 21); x.fillStyle = '#fff'; x.fill(); x.lineWidth = 2; x.strokeStyle = C.outline; x.stroke();
      x.fillStyle = C.outline; x.fillText(text, w / 2, 23);
    }
    if (kind === 'name' || kind === 'hp') {
      x.fillStyle = kind === 'hp' ? '#fff' : C.signText; x.shadowColor = '#000'; x.shadowBlur = 2; x.shadowOffsetY = 1;
      x.fillText(text, kind === 'hp' ? 4 : w / 2, 12 + (kind === 'hp' ? 0 : 1));
    }
    t = texts[id] = { c: c, w: c.width / s, h: c.height / s };
    return t;
  }

  function drawLabels(ctx, C, P, ox, oy, ppm, s) {
    for (var i = 0; i < P.labels.length; i++) {
      var l = P.labels[i], x = Math.round(ox + l.x * ppm), y = Math.round(oy + l.y * ppm);
      if (x < -300 || x > W + 300 || y < -30 || y > H + 30) continue;
      var t = textImg(l.sign ? 'sign' : 'name', l.name, C, s);
      ctx.drawImage(t.c, x - t.w / 2, y - 12, t.w, t.h);
    }
  }

  function blink(t) { return t > 0 && Math.floor(t * 20) % 2 === 0; }

  function drawHud(ctx, game, me, s) {
    var C = colors(game);
    // 体力のバー 240×20 角10 枠2 左24 上24
    var r = me.maxHp ? Math.max(0, me.hp) / me.maxHp : 0;
    rr(ctx, 24, 24, 240, 20, 10); ctx.fillStyle = C.hpBack; ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = C.hp; ctx.fillRect(24, 24, 240 * r, 20); ctx.restore();
    ctx.lineWidth = 2; ctx.strokeStyle = C.outline; rr(ctx, 25, 25, 238, 18, 9); ctx.stroke();
    var t = textImg('hp', '体力 ' + Math.max(0, Math.ceil(me.hp)), C, s);
    ctx.drawImage(t.c, 276 - 4, 35 - 12, t.w, t.h);
    // 鍵の枠 40×40 角8 枠2 左24 上56
    rr(ctx, 25, 57, 38, 38, 7); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.stroke();
    if (me.hasKey || (game.key && game.key.holder === me.id)) { // 鍵の絵を3倍で枠の中央に
      var kim = img('key');
      ctx.drawImage(kim, 44 - kim.width * 1.5, 76 - kim.height * 1.5, kim.width * 3, kim.height * 3);
    }
    // 場所 高さ36 左右16 角18 右24 上24 文字16
    var floor = game.floors[me.floor];
    var zone = Sim.zoneAt(game, me.floor, me.x, me.y);
    var text = String(floor.name).split(/[\s　]/)[0] + (zone ? '　' + zone.name : '');
    t = textImg('place', text, C, s);
    ctx.drawImage(t.c, W - 24 - t.w, 24, t.w, t.h);
    // 案内 高さ44 左右20 角22 枠2 下32 中央 文字18
    var pr = Sim.promptFor(game, me.id);
    if (pr) {
      t = textImg('prompt', pr.action === 'locked' ? pr.label : 'E：' + pr.label, C, s);
      ctx.drawImage(t.c, W / 2 - t.w / 2, H - 32 - 44, t.w, t.h);
    }
  }

  // フレームごとに配列やオブジェクトを作り直さないための使い回し
  var pool = [], dyn = [], extra = [], cur = { x: 0, y: 0 }, V = {};
  function byFoot(a, b) { return a.foot - b.foot; }
  function slot(n) { return pool[n] || (pool[n] = {}); }

  // 前の位置と今の位置を alpha で混ぜた位置を out に入れる。階が変わった時と snapM より大きく動いた時は混ぜない
  function blend(e, out) {
    var p = V.prev && V.prev.get(e);
    out.x = e.x; out.y = e.y;
    if (p && p.floor === e.floor && Math.hypot(e.x - p.x, e.y - p.y) <= V.snap) { out.x = p.x + (e.x - p.x) * V.a; out.y = p.y + (e.y - p.y) * V.a; }
    return out;
  }

  // キャラクターを n 番目に入れる。足もとの中央を画面の px の整数に置く（自分は画面の中央から動かない）
  function chr(kind, e, n) {
    var im = charSprite(kind, e, V.t, V.frameSec), b = blend(e, cur), o = slot(n), k = V.k;
    var fx0 = Math.round(b.x * V.ppm) - V.camX, fy = Math.round(b.y * V.ppm) + Math.round((e.r || 0) * V.ppm) - V.camY;
    o.im = blink(e.hurtT) ? null : im; o.sx = fx0 - Math.floor(im.width / 2) * k; o.sy = fy - im.height * k; o.w = im.width * k; o.h = im.height * k;
    o.foot = (b.y + (e.r || 0)) * V.art; o.shadow = true; o.fx = fx0; o.fy = fy;
    return n + 1;
  }

  function drawObj(ctx, o, k) {
    if (o.sx >= W || o.sy >= H || o.sx + o.w <= 0 || o.sy + o.h + 2 * k <= 0) return; // 画面の外は描かない（影は足もとの下に1ドット出る）
    if (o.shadow) { // 黒の半透明のだ円 幅12・高さ4（ドット）
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(o.fx - 4 * k, o.fy - 2 * k, 8 * k, k); ctx.fillRect(o.fx - 6 * k, o.fy - k, 12 * k, 2 * k); ctx.fillRect(o.fx - 4 * k, o.fy + k, 8 * k, k);
    }
    if (o.im) ctx.drawImage(o.im, o.sx, o.sy, o.im.width * k, o.im.height * k);
  }

  function drawPlay(ctx, game, dt, alpha, prev) {
    var A = sprites(), cfg = game.config, C = colors(game), me = game.players[0], P = prep(game, me.floor);
    var k = A.k, ppm = A.art * k, t = game.time, i;
    V.prev = prev; V.a = alpha == null ? 1 : alpha; V.snap = cfg.anim.snapM; V.t = t; V.frameSec = cfg.anim.walkFrameSec; V.k = k; V.ppm = ppm; V.art = A.art;
    // カメラ：自分の混ぜた位置を画面の px で追う（設計図9節）。世界は画面の 1px 単位で流れる
    blend(me, cur);
    var camX = V.camX = Math.round(cur.x * ppm) - Math.floor(A.sw / 2) * k, camY = V.camY = Math.round(cur.y * ppm) - Math.floor(A.sh / 2) * k;
    // 床と壁：整数ドットの分で上下左右に1ドット大きく切り出し、小数の分は3倍にして貼る位置でずらす（右の1pxは切れる）
    var bx = Math.floor(camX / k), by = Math.floor(camY / k);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(P.big, P.M + bx - 1, P.M + by - 1, A.sw + 2, A.sh + 2, (bx - 1) * k - camX, (by - 1) * k - camY, (A.sw + 2) * k, (A.sh + 2) * k);
    // 鍵・ゾンビ・プレイヤー（数が少ない）を足もとの y の順に並べる
    var n = 0, key = game.key;
    if (key && key.holder == null && key.floor === me.floor) {
      var kim = img('key'), o = slot(n++), bob = Math.floor(t * 3) % 2; // 上下に1ドット
      o.im = kim; o.shadow = false; o.foot = key.y * A.art + kim.height / 2; o.w = kim.width * k; o.h = kim.height * k;
      o.sx = (Math.round(key.x * A.art) - kim.width / 2) * k - camX; o.sy = (Math.round(key.y * A.art) - kim.height / 2 - bob) * k - camY;
    }
    for (i = 0; i < game.zombies.length; i++) { var z = game.zombies[i]; if (z.floor === me.floor && z.hp > 0) n = chr('zombie', z, n); }
    for (i = 0; i < game.players.length; i++) { var p = game.players[i]; if (p.floor === me.floor && p.alive && !p.escaped) n = chr('player', p, n); }
    dyn.length = n;
    for (i = 0; i < n; i++) dyn[i] = pool[i];
    dyn.sort(byFoot);
    // 棚は階ごとに並べた物を使い回す。画面の上の外は二分探索で飛ばし、下の外で止める。同じ足もとなら棚が先
    var F = P.fix, lo = 0, hi = F.length, top = camY / k, bottom = (camY + H) / k + P.fixH, j = 0;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (F[mid].foot <= top) lo = mid + 1; else hi = mid; }
    // 縦にまとめた棚の途中の足もとに、重なるキャラクターがいるフレームだけ、その棚を1マスずつ描く（重なり方を変えない）
    var f, d, e, x0, y0, xi = 0;
    extra.length = 0;
    for (i = lo; i < F.length && F[i].foot < bottom; i++) {
      f = F[i]; f.split = false;
      if (!f.cells) continue;
      x0 = f.x * k - camX; y0 = f.y * k - camY;
      for (j = 0; j < n && !f.split; j++) {
        d = dyn[j];
        f.split = d.foot < f.foot && d.foot >= f.cells[0].foot &&
          d.sx < x0 + f.w * k && d.sx + d.w > x0 && d.sy < y0 + f.h * k && d.sy + d.h + 2 * k > y0;
      }
      if (f.split) for (j = 0; j < f.cells.length; j++) extra.push(f.cells[j]);
    }
    extra.sort(byFoot);
    j = 0;
    for (i = lo; ;) {
      f = i < F.length && F[i].foot < bottom ? F[i] : null; d = j < n ? dyn[j] : null; e = xi < extra.length ? extra[xi] : null;
      if (f && f.split) { i++; continue; }
      if (e && (!f || e.foot < f.foot)) { f = e; }
      if (!f && !d) break;
      if (f && (!d || f.foot <= d.foot)) {
        if (f === e) xi++; else i++;
        x0 = f.x * k - camX; y0 = f.y * k - camY;
        if (x0 < W && x0 + f.w * k > 0 && y0 < H) ctx.drawImage(f.im, x0, y0, f.w * k, f.h * k);
      } else { j++; drawObj(ctx, d, k); }
    }

    // ここから 1280×720 の側。同じカメラの値で描く
    var ox = -camX, oy = -camY, s = (ctx.getTransform && ctx.getTransform().a) || 1;
    drawLabels(ctx, C, P, ox, oy, ppm, s);
    var atk = cfg.attack || {};
    for (i = 0; i < game.players.length; i++) {
      var q = game.players[i];
      if (q.floor !== me.floor || !q.alive || q.escaped || !(q.attackT > 0)) continue;
      blend(q, cur);
      var x = ox + cur.x * ppm, y = oy + cur.y * ppm; // 攻撃の弧
      var fd = dir(q.facing), a = Math.atan2(fd.y, fd.x), half = (atk.arcDeg || 90) / 2 * Math.PI / 180;
      ctx.globalAlpha = Math.min(1, q.attackT * 6) * 0.45;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, (atk.rangeM || 1.2) * ppm, a - half, a + half); ctx.closePath();
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.globalAlpha = 1;
    }
    // 当たった時の輪
    for (i = fx.length - 1; i >= 0; i--) if ((fx[i].t -= dt) <= 0) fx.splice(i, 1);
    for (i = 0; i < fx.length; i++) {
      var e = fx[i];
      if (e.floor !== me.floor) continue;
      ctx.globalAlpha = e.t / 0.25; ctx.lineWidth = 3; ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(ox + e.x * ppm, oy + e.y * ppm, 20 + (0.25 - e.t) * 80, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // ダメージを受けた時の赤い点滅（画面の縁）
    if (flash > 0) {
      flash -= dt;
      ctx.globalAlpha = Math.max(0, flash / 0.3) * 0.35; ctx.fillStyle = C.hp;
      ctx.fillRect(0, 0, W, 24); ctx.fillRect(0, H - 24, W, 24); ctx.fillRect(0, 0, 24, H); ctx.fillRect(W - 24, 0, 24, H);
      ctx.globalAlpha = 1;
    }
    drawHud(ctx, game, me, s);
  }

  // step のたびに空になる events を、描く物として残す
  function addEvents(game) {
    var me = game.players[0];
    (game.events || []).forEach(function (e) {
      if (e.type === 'hurt' && (e.playerId == null || e.playerId === me.id)) flash = 0.3;
      if (e.type !== 'hit') return; // hit に位置は無い。ゾンビの位置、倒して消えた時は殴ったプレイヤーの前
      var z = game.zombies.filter(function (q) { return q.id === e.zombieId; })[0];
      var p = game.players.filter(function (q) { return q.id === e.playerId; })[0], d = dir(p && p.facing), rm = game.config.attack.rangeM;
      var at = z || (p && { x: p.x + d.x * rm, y: p.y + d.y * rm, floor: p.floor });
      if (at) fx.push({ x: at.x, y: at.y, floor: at.floor, t: 0.25 });
    });
  }

  // 題名 40/56 白・説明 16/24 題名の下12・ボタン 高さ48 左右32 角24 文字18 題名との間32
  function drawCard(ctx, C, title, lines, button) {
    ctx.clearRect(0, 0, W, H); // 下は index.html の背景の色
    var top = H / 2 - (56 + lines.length * (24 + 12) + 32 + 48) / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.font = font(40); ctx.fillText(title, W / 2, top + 28);
    var y = top + 56;
    ctx.font = font(16, 400);
    lines.forEach(function (l) { y += 12; ctx.fillText(l, W / 2, y + 12); y += 24; });
    y += 32;
    ctx.font = font(18);
    var w = ctx.measureText(button).width + 64, b = { x: W / 2 - w / 2, y: y, w: w, h: 48 };
    rr(ctx, b.x, b.y, w, 48, 24); ctx.fillStyle = C.sign; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.fillText(button, W / 2, y + 24);
    return b; // ボタンの当たりの範囲（論理の座標）
  }

  function drawTitle(ctx, config) {
    return drawCard(ctx, colors({ config: config }), 'ゾンビ脱出（仮）',
      ['鍵を見つけて、エレベーターから脱出する', '移動：WASD・矢印　E：拾う・階を移る　スペース：たたく'], '始める');
  }

  function drawResult(ctx, game) {
    var s = Math.floor(game.time), t = 'かかった時間　' + Math.floor(s / 60) + '分' + (s % 60) + '秒';
    return drawCard(ctx, colors(game), game.status === 'escaped' ? '脱出成功' : 'ゲームオーバー', [t], 'もう一度');
  }

  var Render = { W: W, H: H, drawPlay: drawPlay, drawTitle: drawTitle, drawResult: drawResult, addEvents: addEvents, missing: missing, reset: function () { fx = []; flash = 0; } };
  if (typeof window !== 'undefined') window.Render = Render;
  if (typeof module !== 'undefined') module.exports = Render;
})();
