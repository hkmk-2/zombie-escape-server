// トップ・キャラクターの一覧・作成・待機の部屋の画面の切り替えと入力（設計図11節・図1〜図4）。
// 画面に出す名前は全部 textContent で入れる（innerHTML は使わない）。
(function () {
  var data = window.GAME_DATA, config = data.config, CH = config.character, store = window.localStorage;
  var T = { // 画面の文（図面にある物と、確かめ・エラーの文）
    needChar: '先にキャラクターを作ります', noRoom: 'この部屋はありません', full: 'この部屋は満員です', busy: 'この部屋はゲーム中です',
    closed: 'サーバーとの接続が切れました', nameReq: '名前を入れてください', notImage: '画像のファイルではありません', tooBig: '画像を小さくできませんでした',
    del: 'このキャラクターを消します', delYes: '消す', delNo: 'やめる', ready: '準備完了', unready: '準備を取り消す', host: 'ホスト', picking: '選択中',
    noChar: 'キャラクター未選択', count: '{n}人', members: '参加者　{n} / {max}（仮）', wait: '全員が準備完了になると、ホストが始められます（今は {r} / {n}）'
  };
  function f(s, v) { return s.replace(/\{(\w+)\}/g, function (_, k) { return v[k]; }); }
  function $(id) { return document.getElementById(id); }
  function q(root, sel) { return root.querySelector(sel); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function find(list, id) { return Chars.find(list, id); }

  var screens = ['top', 'list', 'edit', 'wait'], cur = 'top';
  function show(name) {
    cur = name;
    document.body.classList.remove('play');
    screens.forEach(function (s) { $(s).hidden = s !== name; });
    window.scrollTo(0, 0);
    ({ top: drawTop, list: drawList, edit: drawEdit, wait: drawWait })[name]();
  }
  function hideAll() { screens.forEach(function (s) { $(s).hidden = true; }); document.body.classList.add('play'); }

  // ドット絵の見本（プレイと同じ絵・下向きの立ち）。CSS で 3倍・6倍に出す
  function dot(c, canvas) {
    var im = Render.lookImg(c, 'down', 0);
    canvas = canvas || el('canvas', 'px dot');
    canvas.width = im.width; canvas.height = im.height;
    var x = canvas.getContext('2d'); x.clearRect(0, 0, im.width, im.height); x.drawImage(im, 0, 0);
    return canvas;
  }
  // 顔画像。無い時はドット絵の顔（絵の上の正方形）
  function face(c, box) {
    box = box || el('span', 'face');
    box.textContent = '';
    if (!c) { box.classList.add('none'); return box; }
    if (c.face) { var i = el('img'); i.src = c.face; i.alt = ''; box.appendChild(i); return box; }
    var im = Render.lookImg(c, 'down', 0), w = im.width, cv = el('canvas');
    cv.width = cv.height = w; cv.getContext('2d').drawImage(im, 0, 0, w, w, 0, 0, w, w);
    box.appendChild(cv);
    return box;
  }
  function ability(c) { return find(config.abilities, c.ability) || config.abilities[0]; }
  function stats(c) { return '体力 ' + c.hp + '　持てる量 ' + c.carry + '　' + (find(CH.bodies, c.body) || CH.bodies[0]).name; }
  function badge(text, cls) { return el('span', 'bdg' + (cls ? ' ' + cls : ''), text); }

  // キャラクターのカード（一覧と待機の部屋で使い回す）
  function card(c, wide) {
    var e = el('div', 'card' + (wide ? '' : ' w')), a = ability(c);
    e.tabIndex = 0;
    e.appendChild(face(c));
    e.appendChild(el('span', 'nm', c.name));
    e.appendChild(badge(a.name, a.type ? '' : 'g'));
    e.appendChild(el('span', 'st', stats(c)));
    return e;
  }

  // ---- 図1 トップ ----
  var note = '';
  function drawTop() {
    var none = !Chars.load(store, config).length; // load は0人の時 presets を入れるので、ふだんは false
    q($('top'), '.go').disabled = none;
    q($('top'), '.note').textContent = note || (none ? T.needChar : '');
  }
  q($('top'), '.go').onclick = function () { note = ''; enterRoom(); };
  q($('top'), '.chars').onclick = function () { note = ''; show('list'); };

  // ---- 図2 キャラクターの一覧 ----
  function drawList() {
    var list = Chars.load(store, config), box = q($('list'), '.cards');
    q($('list'), '.count').textContent = f(T.count, { n: list.length });
    box.textContent = '';
    list.forEach(function (c) {
      var e = card(c, true), x = el('button', 'x', '×');
      x.setAttribute('aria-label', T.delYes);
      e.appendChild(x); e.appendChild(dot(c));
      e.onclick = function () { editing = c; show('edit'); };
      e.onkeydown = function (ev) { if (ev.target === e && ev.key === 'Enter') e.onclick(); };
      x.onclick = function (ev) { ev.stopPropagation(); ask(e, c); };
      box.appendChild(e);
    });
  }
  // 消す前の確かめ（カードの上に出す。ブラウザの confirm は使わない）
  function ask(e, c) {
    var a = el('div', 'ask'), b = el('div', 'btns'), yes = el('button', 'btn s', T.delYes), no = el('button', 'btn s o', T.delNo);
    a.appendChild(el('div', 'st', T.del)); b.appendChild(yes); b.appendChild(no); a.appendChild(b);
    a.onclick = function (ev) { ev.stopPropagation(); };
    yes.onclick = function () { Chars.remove(store, config, c.id); if (picked === c.id) picked = null; drawList(); };
    no.onclick = function () { a.remove(); };
    e.appendChild(a); no.focus();
  }
  q($('list'), '.back').onclick = function () { show('top'); };
  q($('list'), '.add').onclick = function () { editing = null; show('edit'); };

  // ---- 図3 キャラクターの作成 ----
  var editing = null, draft = null, E = $('edit');
  function opts(sel, list) {
    sel.textContent = '';
    list.forEach(function (o) { var e = el('option', null, o.name); e.value = o.id; sel.appendChild(e); });
  }
  function swatches(box, list, key) {
    box.textContent = '';
    list.forEach(function (o) {
      var b = el('button', 'sw' + (draft[key] === o.id ? ' on' : ''));
      b.type = 'button'; b.title = o.name; b.setAttribute('aria-label', o.name);
      b.style.background = o.colors[Object.keys(o.colors)[0]];
      b.onclick = function () { draft[key] = o.id; refresh(); };
      box.appendChild(b);
    });
  }
  function range(inp, r) { inp.min = r.min; inp.max = r.max; inp.step = r.step || 1; }
  var dogs = CH.bodies.filter(function (b) { return b.carryMax; });
  q(E, '.f-name').textContent = '名前（必須・' + CH.nameMaxLen + '文字まで）';
  q(E, '.f-hp').textContent = '体力（仮 ' + CH.hp.min + '〜' + CH.hp.max + '）';
  q(E, '.f-carry').textContent = '持てる量（仮 ' + CH.carry.min + '〜' + CH.carry.max +
    dogs.map(function (b) { return '。' + b.name + 'は ' + b.carryMax + ' まで'; }).join('') + '）';
  q(E, '.name').maxLength = CH.nameMaxLen;
  range(q(E, '.hp'), CH.hp); range(q(E, '.carry'), CH.carry);
  opts(q(E, '.body'), CH.bodies); opts(q(E, '.ability'), config.abilities);

  function drawEdit() {
    draft = Chars.clean(config, editing || { name: '', hp: CH.hp.default, carry: CH.carry.default });
    q(E, '.name').value = draft.name;
    q(E, '.hp').value = draft.hp; q(E, '.carry').value = draft.carry;
    q(E, '.err').textContent = '';
    refresh();
  }
  // 入力を範囲に切って画面に戻す（名前はそのまま。空の時は保存で止める）
  function refresh() {
    var name = q(E, '.name').value;
    draft.body = q(E, '.body').value || draft.body;
    draft.ability = q(E, '.ability').value || draft.ability;
    var c = Chars.clean(config, { id: draft.id, name: 'x', body: draft.body, hair: draft.hair, shirt: draft.shirt, face: draft.face, hp: q(E, '.hp').value, carry: q(E, '.carry').value, ability: draft.ability });
    c.name = name; draft = c;
    q(E, '.body').value = c.body; q(E, '.ability').value = c.ability;
    swatches(q(E, '.hair'), CH.looks.hair, 'hair'); swatches(q(E, '.shirt'), CH.looks.shirt, 'shirt');
    q(E, '.desc').textContent = ability(c).desc;
    face(c, q(E, '.face')); dot(c, q(E, '.dot'));
    q(E, '.drop').disabled = !c.face;
  }
  function fix() { refresh(); q(E, '.hp').value = draft.hp; q(E, '.carry').value = draft.carry; }
  q(E, '.body').onchange = fix; q(E, '.ability').onchange = refresh;
  q(E, '.hp').onchange = fix; q(E, '.carry').onchange = fix;
  q(E, '.name').oninput = function () { q(E, '.err').textContent = ''; };
  q(E, '.pick').onclick = function () { q(E, '.file').click(); };
  q(E, '.drop').onclick = function () { draft.face = null; refresh(); };
  q(E, '.file').onchange = function () {
    var file = this.files[0]; this.value = '';
    if (!file) return;
    Chars.makeFace(file, config).then(function (d) { draft.face = d; q(E, '.err').textContent = ''; refresh(); },
      function (e) { q(E, '.err').textContent = T[e.message] || T.notImage; });
  };
  q(E, '.back').onclick = function () { show('list'); };
  q(E, '.save').onclick = function () {
    fix();
    var c = Chars.put(store, config, draft);
    if (!c) { q(E, '.err').textContent = T.nameReq; q(E, '.name').focus(); return; }
    show('list');
  };

  // ---- 図4 待機の部屋 ----
  // room = {id, you, host, status, players:[{id,name,ready,char}]}。file:// の時は手元だけの1人の部屋
  var room = null, conn = null, picked = null, faces = {}, W = $('wait'), msg = '';
  function mine() { return room && room.players.filter(function (p) { return p.id === room.you; })[0]; }
  function pickedChar() { return picked && find(Chars.load(store, config), picked); }
  function enterRoom() {
    var c = pickedChar();
    room = null; msg = ''; faces = {};
    if (!Net.online()) {
      room = { id: '', you: 'p1', host: 'p1', status: 'waiting', players: [{ id: 'p1', name: c ? c.name : '', ready: false, char: c || null }] };
      return show('wait');
    }
    conn = Net.connect(config, Net.roomParam(), c ? c.name : '', onMsg, function () {
      conn = null;
      if (Main.playing()) return;
      if (room) { msg = T.closed; drawWait(); } else { note = T.closed; show('top'); }
    });
  }
  function leave() { if (conn) conn.close(); conn = null; room = null; show('top'); }
  function onMsg(m) {
    if (m.t === 'error') {
      var text = T[m.code] || T.closed;
      if (!room) { note = text; if (conn) conn.close(); conn = null; show('top'); } else { msg = text; drawWait(); }
      return;
    }
    if (m.t === 'room') {
      var first = !room;
      room = { id: m.room, you: m.you, host: m.host, status: m.status, players: m.players || [] };
      if (first) { show('wait'); var c = pickedChar(); if (c) conn.send({ t: 'char', char: c }); }
      else if (cur === 'wait' && !Main.playing()) drawWait();
      return;
    }
    if (m.t === 'face') { faces[m.id] = typeof m.face === 'string' && m.face.indexOf('data:image/jpeg;base64,') === 0 ? m.face : null; if (cur === 'wait' && !Main.playing()) drawWait(); return; }
    if (m.t === 'start') {
      var by = {};
      (room ? room.players : []).forEach(function (p) { by[p.id] = p.char || {}; });
      var players = (m.players || []).map(function (p) {
        var c = by[p.id] || {};
        return { id: p.id, name: c.name || p.name, color: p.color, body: c.body, hair: c.hair, shirt: c.shirt, hp: c.hp, carry: c.carry, ability: c.ability };
      });
      Main.startNet(m.seed, players, room.you, conn);
      return;
    }
    if (m.t === 's') Main.snapshot(m);
  }

  function drawWait() {
    if (!room) return;
    var list = Chars.load(store, config), me = mine(), box = q(W, '.pick');
    if (picked && !find(list, picked)) picked = null;
    q(W, '.url').value = room.id ? Net.inviteUrl(room.id) : '';
    q(W, '.copy').disabled = !room.id;
    box.textContent = '';
    list.forEach(function (c) {
      var e = card(c, false);
      if (c.id === picked) e.classList.add('on');
      e.onclick = function () { choose(c); };
      e.onkeydown = function (ev) { if (ev.key === 'Enter') choose(c); };
      box.appendChild(e);
    });
    var who = q(W, '.who'), ready = 0, all = room.players.length;
    who.textContent = '';
    q(W, '.count').textContent = f(T.members, { n: all, max: config.net.maxPlayers });
    room.players.forEach(function (p) {
      var c = p.char, r = el('div', 'rowp'), bs = el('div', 'bdgs');
      if (p.ready) ready++;
      var fc = c && (p.id === room.you ? c : Object.assign({}, c, { face: faces[p.id] || null }));
      r.appendChild(face(fc));
      r.appendChild(el('span', 'nm', c ? c.name : p.name));
      r.appendChild(el('span', 'st', c ? ability(c).name + '・体力 ' + c.hp : T.noChar));
      if (p.id === room.host) bs.appendChild(badge(T.host, 'y'));
      bs.appendChild(p.ready ? badge(T.ready) : badge(T.picking, 'g'));
      r.appendChild(bs);
      who.appendChild(r);
    });
    q(W, '.msg').textContent = msg || f(T.wait, { r: ready, n: all });
    var rb = q(W, '.ready'), sb = q(W, '.start');
    rb.textContent = me && me.ready ? T.unready : T.ready;
    rb.disabled = !picked;
    sb.hidden = room.you !== room.host;
    sb.disabled = !(ready === all && room.players.every(function (p) { return p.char; }));
  }
  function choose(c) {
    picked = c.id;
    var me = mine();
    if (conn) conn.send({ t: 'char', char: c });
    else if (me) { me.char = c; me.name = c.name; }
    drawWait();
  }
  q(W, '.ready').onclick = function () {
    var me = mine();
    if (!me || !picked) return;
    if (conn) conn.send({ t: 'ready', ready: !me.ready });
    else { me.ready = !me.ready; drawWait(); }
  };
  q(W, '.start').onclick = function () {
    if (conn) return conn.send({ t: 'start' });
    var me = mine(), c = me.char;
    me.ready = false;
    Main.startLocal([{ id: me.id, name: c.name, color: config.net.colors[0], body: c.body, hair: c.hair, shirt: c.shirt, hp: c.hp, carry: c.carry, ability: c.ability }]);
  };
  q(W, '.copy').onclick = function () {
    var u = q(W, '.url');
    if (navigator.clipboard) navigator.clipboard.writeText(u.value).catch(function () { u.select(); });
    else u.select();
  };
  q(W, '.back').onclick = leave;

  window.Screens = { show: show, hideAll: hideAll };
  show('top');
})();
