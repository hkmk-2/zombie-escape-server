// キー入力。WASD・矢印で mx,my。E と スペースは押した瞬間の1回だけ true。
(function () {
  var down = {}, interact = false, attack = false;
  var MOVE = { KeyW: 1, KeyA: 1, KeyS: 1, KeyD: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1, Space: 1 };

  window.addEventListener('keydown', function (e) {
    if (MOVE[e.code]) e.preventDefault(); // 矢印とスペースでページを動かさない
    if (!e.repeat) {
      if (e.code === 'KeyE') interact = true;
      if (e.code === 'Space') attack = true;
    }
    down[e.code] = true;
  });
  window.addEventListener('keyup', function (e) { down[e.code] = false; });
  window.addEventListener('blur', function () { down = {}; });

  function axis(neg, pos) {
    return (down[pos[0]] || down[pos[1]] ? 1 : 0) - (down[neg[0]] || down[neg[1]] ? 1 : 0);
  }

  // 1回の step の分を返す。interact と attack は返したら消す
  function read() {
    var mx = axis(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    var my = axis(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    var l = Math.hypot(mx, my) || 1;
    var out = { mx: mx / l, my: my / l, interact: interact, attack: attack };
    interact = attack = false;
    return out;
  }

  window.Input = { read: read, clear: function () { interact = attack = false; } };
})();
