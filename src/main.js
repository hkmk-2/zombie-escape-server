// プレイ → 結果 のキャンバスの2つの画面（設計図11節）。トップ・一覧・作成・待機の部屋は screens.js の HTML。
// 手元（file:// の1人の部屋）は 1/30秒の固定の刻みで Sim.step、サーバーの時は届いた s を書きこんで描く。
(function () {
  var STEP = 1 / 30;
  var data = window.GAME_DATA;
  var canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  var screen = 'off', game = null, button = null, acc = 0, last = 0;
  var me = null, net = null, snapAt = 0, sent = null, sentAt = 0, pend = { interact: false, attack: false, ability: false };
  // step の前の位置（キャラクターごとに {floor, x, y} を1つだけ作って使い回す）。render.js が alpha で今の位置と混ぜる
  var prev = new WeakMap();
  function keep(e) { Net.keep(prev, e); }

  // ウィンドウに合わせて 1280×720 を同じ比で拡大・縮小し、devicePixelRatio でぼやけないようにする
  var scale = 1, dpr = 1;
  function fit() {
    scale = Math.min(window.innerWidth / Render.W, window.innerHeight / Render.H);
    dpr = Math.min(window.devicePixelRatio || 1, data.config.render.maxDpr);
    var w = Math.floor(Render.W * scale), h = Math.floor(Render.H * scale);
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    scale = w / Render.W;
  }
  window.addEventListener('resize', fit);
  fit();

  function begin(seed, players, meId) {
    game = Sim.createGame(data, { seed: seed, players: players });
    me = meId; prev = new WeakMap();
    Render.reset(); Input.clear(); Input.enable(true);
    acc = 0; screen = 'play'; sent = null;
    if (window.Screens) Screens.hideAll();
  }

  // 手元だけ。players は createGame の形 {id,name,color,body,hair,shirt,hp,carry,ability}
  function startLocal(players) {
    net = null;
    begin((Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0, players, players[0].id);
  }
  // サーバー。conn は Net.connect の戻り値
  function startNet(seed, players, meId, conn) { net = conn; begin(seed, players, meId); snapAt = last; }
  function snapshot(s) {
    if (!game || screen !== 'play' || !net) return;
    Net.apply(game, s, prev);
    Render.addEvents(game, me);
    snapAt = last;
  }

  // 結果の「もう一度」：待機の部屋へ戻る
  function again() { screen = 'off'; Input.enable(false); if (window.Screens) Screens.show('wait'); }
  window.addEventListener('keydown', function (e) { if (screen === 'result' && (e.code === 'Enter' || e.code === 'NumpadEnter')) again(); });
  canvas.addEventListener('pointerdown', function (e) {
    if (!button) return;
    var r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
    if (x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h) again();
  });

  // 入力は変わった時と、押した瞬間の物がある時だけ、多くて net.inputHz 回/秒で送る（押した瞬間の物はたまったまま次に送る）
  function sendInput(t) {
    var i = Input.read();
    pend.interact = pend.interact || i.interact; pend.attack = pend.attack || i.attack; pend.ability = pend.ability || i.ability;
    var moved = !sent || sent.mx !== i.mx || sent.my !== i.my;
    if (!(moved || pend.interact || pend.attack || pend.ability) || t - sentAt < 1000 / data.config.net.inputHz) return;
    net.send({ t: 'in', mx: i.mx, my: i.my, interact: pend.interact, attack: pend.attack, ability: pend.ability });
    sent = i; sentAt = t; pend.interact = pend.attack = pend.ability = false;
  }

  function frame(t) {
    var dt = last ? Math.min(0.25, (t - last) / 1000) : 0; // 0.25：タブを戻した時に追いつこうとしすぎない
    last = t;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    button = null;
    if (screen === 'play') {
      var alpha;
      if (net) {
        sendInput(t);
        alpha = Math.min(1, (t - snapAt) / (1000 / data.config.net.snapshotHz));
      } else {
        acc += dt;
        while (acc >= STEP && game.status === 'playing') {
          var inputs = {}; inputs[me] = Input.read();
          game.players.forEach(keep); game.zombies.forEach(keep);
          Sim.step(game, inputs, STEP);
          Render.addEvents(game, me);
          acc -= STEP;
        }
        alpha = acc / STEP;
      }
      if (game.status !== 'playing') { screen = 'result'; Input.enable(false); }
      else Render.drawPlay(ctx, game, dt, alpha, prev, me);
    }
    if (screen === 'result') button = Render.drawResult(ctx, game);
    canvas.style.cursor = button ? 'pointer' : 'default';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.Main = { startLocal: startLocal, startNet: startNet, snapshot: snapshot, playing: function () { return screen !== 'off'; } };
})();
