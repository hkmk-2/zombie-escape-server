// タイトル → プレイ → 結果 の3つの画面と、1/30秒の固定の刻みのループ。
(function () {
  var STEP = 1 / 30;
  var data = window.GAME_DATA;
  var canvas = document.getElementById('game'), ctx = canvas.getContext('2d');
  var screen = 'title', game = null, button = null, acc = 0, last = 0;
  // step の前の位置（キャラクターごとに {floor, x, y} を1つだけ作って使い回す）。render.js が alpha で今の位置と混ぜる
  var prev = new WeakMap();
  function keep(e) {
    var p = prev.get(e);
    if (!p) { p = {}; prev.set(e, p); }
    p.floor = e.floor; p.x = e.x; p.y = e.y;
  }

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

  function start() {
    var seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
    game = Sim.createGame(data, { seed: seed, players: [{ id: 'p1', name: 'あなた' }] });
    Render.reset(); Input.clear();
    acc = 0; screen = 'play';
  }

  function press() { if (screen !== 'play') start(); }
  window.addEventListener('keydown', function (e) { if (e.code === 'Enter' || e.code === 'NumpadEnter') press(); });
  canvas.addEventListener('pointerdown', function (e) {
    if (!button) return;
    var r = canvas.getBoundingClientRect(), x = (e.clientX - r.left) / scale, y = (e.clientY - r.top) / scale;
    if (x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h) press();
  });

  function frame(t) {
    var dt = last ? Math.min(0.25, (t - last) / 1000) : 0; // 0.25：タブを戻した時に追いつこうとしすぎない
    last = t;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    button = null;
    if (screen === 'play') {
      acc += dt;
      while (acc >= STEP && game.status === 'playing') {
        var inputs = {}; inputs[game.players[0].id] = Input.read();
        game.players.forEach(keep); game.zombies.forEach(keep);
        Sim.step(game, inputs, STEP);
        Render.addEvents(game);
        acc -= STEP;
      }
      if (game.status !== 'playing') screen = 'result';
      else Render.drawPlay(ctx, game, dt, acc / STEP, prev);
    }
    if (screen === 'title') button = Render.drawTitle(ctx, data.config);
    if (screen === 'result') button = Render.drawResult(ctx, game);
    canvas.style.cursor = button ? 'pointer' : 'default';
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
