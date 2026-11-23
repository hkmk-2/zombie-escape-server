// サーバーとのやり取り（設計図10節・11節）。受ける：room start s face error。送る：char ready start in。
(function () {
  // http(s) で開いた時だけサーバーにつなぐ。file:// の時は手元だけの1人の部屋（screens.js）
  function online() { return typeof location !== 'undefined' && /^https?:$/.test(location.protocol); }
  function roomParam() { var m = /[?&]room=([a-z0-9]+)/.exec(location.search); return m ? m[1] : ''; }
  function inviteUrl(room) { return location.origin + location.pathname + '?room=' + room; }

  // on(msg) に受けた物を渡す。onClose() はこちらから閉じた時は呼ばない
  function connect(config, room, name, on, onClose) {
    var q = '?name=' + encodeURIComponent(name || '') + (room ? '&room=' + encodeURIComponent(room) : '');
    var ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + config.net.wsPath + q), closed = false;
    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m && typeof m.t === 'string') on(m);
    };
    ws.onclose = function () { if (!closed && onClose) onClose(); };
    return {
      send: function (m) { if (ws.readyState === 1) ws.send(JSON.stringify(m)); },
      close: function () { closed = true; ws.close(); }
    };
  }

  // 前の位置を残してから書きこむ（設計図9節の補間。render.js が prev と今の位置を alpha で混ぜる）
  function keep(prev, e) {
    var p = prev.get(e);
    if (!p) { p = {}; prev.set(e, p); }
    p.floor = e.floor; p.x = e.x; p.y = e.y;
  }

  // s を、start の seed と players で作った手元の game に書きこむ。z は自分の階のゾンビだけなので、届いた物で置き換える
  function apply(game, s, prev) {
    var P = {}, Z = {}, i;
    game.players.forEach(function (q) { P[q.id] = q; });
    game.zombies.forEach(function (q) { Z[q.id] = q; });
    (s.p || []).forEach(function (a) {
      var q = P[a[0]];
      if (!q) return;
      keep(prev, q);
      q.floor = a[1]; q.x = a[2]; q.y = a[3]; q.facing = a[4]; q.hp = a[5]; q.hasKey = a[6]; q.alive = a[7]; q.escaped = a[8];
      q.attackT = a[9]; q.hurtT = a[10]; q.abilityT = a[11] || 0; q.abilityCd = a[12] || 0;
    });
    var zs = [];
    (s.z || []).forEach(function (a) {
      var q = Z[a[0]] || { id: a[0], r: game.config.zombie.radiusM };
      if (Z[a[0]]) keep(prev, q);
      q.floor = a[1]; q.x = a[2]; q.y = a[3]; q.facing = a[4]; q.hp = a[5]; q.hurtT = a[6];
      zs.push(q);
    });
    game.zombies.length = 0;
    for (i = 0; i < zs.length; i++) game.zombies.push(zs[i]);
    if (s.k) { game.key.floor = s.k[0]; game.key.x = s.k[1]; game.key.y = s.k[2]; game.key.holder = s.k[3]; }
    game.events = s.e || [];
    if (typeof s.time === 'number') game.time = s.time;
    if (s.st) game.status = s.st;
  }

  var Net = { online: online, roomParam: roomParam, inviteUrl: inviteUrl, connect: connect, apply: apply, keep: keep };
  if (typeof module !== 'undefined') module.exports = Net; else window.Net = Net;
})();
