// ゲームの進行。画面・キー・Date・Math.random に触らない（このままサーバーでも動かす）。
// 形は 設計図/設計図.md の5節。数値・名前・売場は全部 data（config と floors）から読む。
var Sim = (function () {
  'use strict';

  // ---- 乱数（mulberry32。状態は game.rngState に置くので、game を保存すれば続きから同じになる）
  function rand(game) {
    var a = (game.rngState = (game.rngState + 0x6D2B79F5) | 0);
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function pick(game, list) { return list[Math.floor(rand(game) * list.length)]; }

  // ---- 階ごとの作業用の配列（game に入れない。無ければ作り直す）
  var auxCache = new WeakMap();
  function aux(f) {
    var a = auxCache.get(f);
    if (a) return a;
    var n = f.cols * f.rows, zid = new Array(n), zoneById = {};
    f.zones.forEach(function (z) { zoneById[z.id] = z; });
    for (var y = 0; y < f.rows; y++) for (var x = 0; x < f.cols; x++) zid[y * f.cols + x] = f.cells[y][x];
    a = { zid: zid, zoneById: zoneById, dist: new Int32Array(n), queue: new Int32Array(n), mark: new Uint8Array(n) };
    auxCache.set(f, a);
    return a;
  }

  function blocked(f, cx, cy) {
    return cx < 0 || cy < 0 || cx >= f.cols || cy >= f.rows || !f.walk[cy * f.cols + cx];
  }
  function cellCenter(f, i) {
    return { x: (i % f.cols + 0.5) * f.cellM, y: (Math.floor(i / f.cols) + 0.5) * f.cellM };
  }
  function cellIndex(f, x, y) {
    var cx = Math.floor(x / f.cellM), cy = Math.floor(y / f.cellM);
    return blocked(f, cx, cy) ? -1 : cy * f.cols + cx;
  }

  // 歩けるマスのかたまりの数（4方向）。grid は 1 = 通れる
  function countComponents(f, grid) {
    var a = aux(f), mark = a.mark, q = a.queue, cols = f.cols, rows = f.rows, n = cols * rows, count = 0;
    mark.fill(0);
    for (var s = 0; s < n; s++) {
      if (!grid[s] || mark[s]) continue;
      count++;
      var head = 0, tail = 0;
      q[tail++] = s; mark[s] = 1;
      while (head < tail) {
        var i = q[head++], x = i % cols;
        if (x > 0 && grid[i - 1] && !mark[i - 1]) { mark[i - 1] = 1; q[tail++] = i - 1; }
        if (x < cols - 1 && grid[i + 1] && !mark[i + 1]) { mark[i + 1] = 1; q[tail++] = i + 1; }
        if (i >= cols && grid[i - cols] && !mark[i - cols]) { mark[i - cols] = 1; q[tail++] = i - cols; }
        if (i < n - cols && grid[i + cols] && !mark[i + cols]) { mark[i + cols] = 1; q[tail++] = i + cols; }
      }
    }
    return count;
  }

  // 中心をそのマスの真ん中に置いても体（半径 r）が歩けないマスに重ならないマス
  function computeWide(f, r) {
    var c = f.cellM, k = Math.ceil(r / c + 0.5), offs = [];
    for (var dy = -k; dy <= k; dy++) for (var dx = -k; dx <= k; dx++) {
      var nx = Math.max(0, Math.abs(dx) * c - c / 2), ny = Math.max(0, Math.abs(dy) * c - c / 2);
      if (Math.hypot(nx, ny) < r) offs.push([dx, dy]);
    }
    var w = new Uint8Array(f.cols * f.rows);
    for (var y = 0; y < f.rows; y++) for (var x = 0; x < f.cols; x++) {
      var ok = 1;
      for (var j = 0; j < offs.length; j++) if (blocked(f, x + offs[j][0], y + offs[j][1])) { ok = 0; break; }
      w[y * f.cols + x] = ok;
    }
    return w;
  }

  // ---- 棚：section の zone ごとに config.fixtures のルールで並べる
  function bodyR(config) { return Math.max(config.player.radiusM, config.zombie.radiusM); }

  function fixtureKind(cfg, zone) {
    for (var key in cfg.byName) if (zone.name.indexOf(key) >= 0) return cfg.byName[key];
    return cfg.default;
  }

  function zoneFixtureCells(f, zone, kind, cfg) {
    var a = aux(f), cols = f.cols, b = zone.bbox, out = [];
    function interior(x, y) { // zone の外周1マスを空ける
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= cols || yy >= f.rows || a.zid[yy * cols + xx] !== zone.id) return false;
      }
      return true;
    }
    if (kind === 'racks') {
      var r = cfg.racks, horiz = b.w >= b.h;
      var u0 = horiz ? b.x0 : b.y0, u1 = horiz ? b.x1 : b.y1, v0 = horiz ? b.y0 : b.x0, v1 = horiz ? b.y1 : b.x1;
      var row = function (v, m, ok) { // m = 両端に空けるマス
        var seg = [];
        for (var u = u0 + m; u <= u1 - m + 1; u++) {
          var x = horiz ? u : v, y = horiz ? v : u;
          if (u <= u1 - m && (u - u0 - m) % (r.runCells + r.breakCells) < r.runCells && ok(x, y)) seg.push(y * cols + x);
          else if (seg.length) { out.push(seg); seg = []; }
        }
      };
      for (var v = v0 + 1 + r.gapCells; v <= v1 - 1 - r.gapCells; v += r.gapCells + 1) row(v, 1, interior);
      // 小さくて1列も入らない売場は、外周を空けずに中央へ1列だけ
      if (!out.length) row(Math.round((v0 + v1) / 2), 0, function (x, y) { return a.zid[y * cols + x] === zone.id; });
    } else if (kind === 'counter') {
      var all = [];
      for (var cy = b.y0; cy <= b.y1; cy++) for (var cx = b.x0; cx <= b.x1; cx++) if (interior(cx, cy)) all.push(cy * cols + cx);
      if (all.length) out.push(all);
    } else if (kind === 'tables') {
      for (var ty = b.y0 + 1; ty + 1 <= b.y1 - 1; ty += 3) for (var tx = b.x0 + 1; tx + 1 <= b.x1 - 1; tx += 3) {
        if (interior(tx, ty) && interior(tx + 1, ty) && interior(tx, ty + 1) && interior(tx + 1, ty + 1))
          out.push([ty * cols + tx, ty * cols + tx + 1, (ty + 1) * cols + tx, (ty + 1) * cols + tx + 1]);
      }
    }
    return out;
  }

  function placeFixtures(f, config) {
    var cfg = config.fixtures, fixtures = [];
    var walkComps = countComponents(f, f.walk), wideComps = countComponents(f, computeWide(f, bodyR(config)));
    f.zones.forEach(function (zone) {
      if (zone.type !== config.rules.fixtureZoneType || !zone.bbox) return;
      var kind = fixtureKind(cfg, zone);
      zoneFixtureCells(f, zone, kind, cfg).forEach(function (cells) {
        cells.forEach(function (i) { f.walk[i] = 0; });
        // 歩けるマスがつながったままか、体の通れるマスが分かれないかを確かめ、だめなら外す
        if (countComponents(f, f.walk) > walkComps || countComponents(f, computeWide(f, bodyR(config))) > wideComps) {
          cells.forEach(function (i) { f.walk[i] = 1; });
          return;
        }
        var x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
        cells.forEach(function (i) {
          var x = i % f.cols, y = Math.floor(i / f.cols);
          x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
        });
        // shortcut: counter の形が四角でないときも外接の四角で返す。形の違う売場が出たら cells も返す
        fixtures.push({ x: x0 * f.cellM, y: y0 * f.cellM, w: (x1 - x0 + 1) * f.cellM, h: (y1 - y0 + 1) * f.cellM, kind: kind, zoneId: zone.id });
      });
    });
    return fixtures;
  }

  function buildFloor(id, src, config) {
    var walkTypes = config.rules.walkTypes;
    var zones = src.zones.map(function (z) { return Object.assign({}, z); });
    var f = { id: id, name: src.name, cols: src.cols, rows: src.rows, cellM: src.cellM, zones: zones, cells: src.cells };
    var a = aux(f), n = f.cols * f.rows, sum = {};
    f.walk = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
      var z = a.zoneById[a.zid[i]], x = i % f.cols, y = Math.floor(i / f.cols);
      if (!z) continue;
      if (walkTypes.indexOf(z.type) >= 0) f.walk[i] = 1;
      var s = sum[z.id] || (sum[z.id] = { n: 0, sx: 0, sy: 0, x0: x, y0: y, x1: x, y1: y });
      s.n++; s.sx += x; s.sy += y;
      s.x0 = Math.min(s.x0, x); s.y0 = Math.min(s.y0, y); s.x1 = Math.max(s.x1, x); s.y1 = Math.max(s.y1, y);
    }
    zones.forEach(function (z) {
      var s = sum[z.id];
      if (!s) return;
      z.cx = (s.sx / s.n + 0.5) * f.cellM; // zone の中心（m）
      z.cy = (s.sy / s.n + 0.5) * f.cellM;
      z.bbox = { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, w: s.x1 - s.x0 + 1, h: s.y1 - s.y0 + 1 };
    });
    f.fixtures = placeFixtures(f, config);
    f.wide = computeWide(f, bodyR(config));
    f.links = [];
    return f;
  }

  // 中心をそのマスに置けるマスのうち、点にいちばん近い物（zoneId があればその zone の中を先に探す）
  function nearestWide(f, x, y, zoneId) {
    var a = aux(f), best = -1, bestD = Infinity, bestIn = false;
    for (var i = 0; i < f.wide.length; i++) {
      if (!f.wide[i]) continue;
      var inZone = a.zid[i] === zoneId, c = cellCenter(f, i), d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
      if ((inZone && !bestIn) || (inZone === bestIn && d < bestD)) { best = i; bestD = d; bestIn = inZone; }
    }
    return best;
  }

  // 階のつながり：種類ごとに各階の zone を中心の x の順に並べ、同じ順番どうしをつなぐ
  function buildLinks(floors, ids, config) {
    config.rules.linkTypes.forEach(function (type) {
      var lists = ids.map(function (id) {
        return floors[id].zones.filter(function (z) { return z.type === type && z.bbox; }).sort(function (p, q) { return p.cx - q.cx; });
      });
      ids.forEach(function (id, fi) {
        lists[fi].forEach(function (zone, k) {
          // shortcut: 1つ上の階を先に、無ければ1つ下の階へつなぐ。3階より多くなったら上と下を選べるようにする
          var ti = fi + 1 < ids.length && lists[fi + 1][k] ? fi + 1 : fi - 1;
          if (ti < 0 || !lists[ti][k]) return;
          var to = floors[ids[ti]], toZone = lists[ti][k], i = nearestWide(to, toZone.cx, toZone.cy, toZone.id);
          if (i < 0) return;
          var c = cellCenter(to, i);
          floors[id].links.push({ zoneId: zone.id, toFloor: to.id, toZoneId: toZone.id, x: c.x, y: c.y });
        });
      });
    });
  }

  function linkFor(f, zoneId) {
    for (var i = 0; i < f.links.length; i++) if (f.links[i].zoneId === zoneId) return f.links[i];
    return null;
  }

  // スタート地点から歩いて届くマス（階のつながりもたどる）。{floorId: Uint8Array}
  function reachableFrom(game, floorId, start) {
    var seen = {}, q = [[floorId, start]];
    Object.keys(game.floors).forEach(function (id) { seen[id] = new Uint8Array(game.floors[id].cols * game.floors[id].rows); });
    seen[floorId][start] = 1;
    while (q.length) {
      var it = q.pop(), f = game.floors[it[0]], i = it[1], cols = f.cols, x = i % cols;
      var link = linkFor(f, aux(f).zid[i]);
      if (link) {
        var j = cellIndex(game.floors[link.toFloor], link.x, link.y);
        if (j >= 0 && !seen[link.toFloor][j]) { seen[link.toFloor][j] = 1; q.push([link.toFloor, j]); }
      }
      var nb = [x > 0 ? i - 1 : -1, x < cols - 1 ? i + 1 : -1, i - cols, i + cols];
      for (var k = 0; k < 4; k++) {
        var n = nb[k];
        if (n >= 0 && n < f.wide.length && f.wide[n] && !seen[it[0]][n]) { seen[it[0]][n] = 1; q.push([it[0], n]); }
      }
    }
    return seen;
  }

  function cellsWhere(game, test) {
    var out = [];
    Object.keys(game.floors).forEach(function (id) {
      var f = game.floors[id], a = aux(f);
      for (var i = 0; i < f.wide.length; i++) if (f.wide[i] && test(f, i, a.zoneById[a.zid[i]])) out.push({ floor: id, i: i });
    });
    return out;
  }

  function createGame(data, opts) {
    var config = data.config, ids = Object.keys(data.floors), floors = {};
    var seed = (opts && opts.seed) >>> 0;
    ids.forEach(function (id) { floors[id] = buildFloor(id, data.floors[id], config); });
    buildLinks(floors, ids, config);
    var game = {
      time: 0, seed: seed, rngState: seed | 0, config: config, status: 'playing', floors: floors,
      players: [], zombies: [], key: null, exit: null, events: []
    };
    var P = config.player, Z = config.zombie, R = config.rules;

    // ゾンビ：各階に perFloor 体
    var zid = 0;
    ids.forEach(function (id) {
      var f = floors[id], list = cellsWhere(game, function (ff) { return ff === f; });
      for (var k = 0; k < Z.perFloor && list.length; k++) {
        var c = cellCenter(f, pick(game, list).i);
        game.zombies.push({ id: 'z' + (zid++), floor: id, x: c.x, y: c.y, r: Z.radiusM, hp: Z.hp, maxHp: Z.hp,
          facing: rand(game) * Math.PI * 2, state: 'wander', hurtT: 0, hitT: 0, lostT: 0, turnT: 0, wdir: rand(game) * Math.PI * 2 });
      }
    });

    // スタート地点：aisle から。ゾンビから spawnMinDistM 以上離す（無ければ aisle のどこか）
    var aisles = cellsWhere(game, function (f, i, z) { return z.type === R.startZoneType; });
    var far = aisles.filter(function (s) {
      var c = cellCenter(floors[s.floor], s.i);
      return game.zombies.every(function (z) { return z.floor !== s.floor || Math.hypot(z.x - c.x, z.y - c.y) >= Z.spawnMinDistM; });
    });
    var start = pick(game, far.length ? far : aisles), sc = cellCenter(floors[start.floor], start.i);

    (opts && opts.players || []).forEach(function (p) {
      game.players.push({ id: p.id, name: p.name, color: p.color, floor: start.floor, x: sc.x, y: sc.y, r: P.radiusM,
        hp: P.hp, maxHp: P.hp, hasKey: false, facing: 0, attackT: 0, hurtT: 0, alive: true, escaped: false });
    });

    // 鍵：section のうちスタート地点から歩いて届くマス
    var reach = reachableFrom(game, start.floor, start.i);
    var keyCell = pick(game, cellsWhere(game, function (f, i, z) { return z.type === R.keyZoneType && reach[f.id][i]; }));
    var kc = cellCenter(floors[keyCell.floor], keyCell.i);
    game.key = { floor: keyCell.floor, x: kc.x, y: kc.y, holder: null };

    var ef = floors[config.exit.floor];
    var ez = ef && ef.zones.filter(function (z) { return z.type === config.exit.zoneType && z.bbox; })[0];
    game.exit = ez ? { floor: ef.id, zoneId: ez.id, x: ez.cx, y: ez.cy } : null;
    return game;
  }

  // ---- 当たり判定：円とマス目
  // 歩けないマスから押し出す。押し出しが残っていれば true
  function resolveWalls(f, e, push) {
    var c = f.cellM, r = e.r, hit = false;
    var x0 = Math.floor((e.x - r) / c), x1 = Math.floor((e.x + r) / c), y0 = Math.floor((e.y - r) / c), y1 = Math.floor((e.y + r) / c);
    for (var cy = y0; cy <= y1; cy++) for (var cx = x0; cx <= x1; cx++) {
      if (!blocked(f, cx, cy)) continue;
      var px = Math.max(cx * c, Math.min(e.x, cx * c + c)), py = Math.max(cy * c, Math.min(e.y, cy * c + c));
      var dx = e.x - px, dy = e.y - py, d2 = dx * dx + dy * dy;
      if (d2 >= (r - 1e-7) * (r - 1e-7)) continue;
      hit = true;
      if (!push || d2 < 1e-12) continue;
      var d = Math.sqrt(d2);
      e.x += dx / d * (r - d); e.y += dy / d * (r - d);
    }
    return hit;
  }
  function moveAxis(f, e, dx, dy) {
    var ox = e.x, oy = e.y;
    e.x += dx; e.y += dy;
    for (var k = 0; k < 4 && resolveWalls(f, e, true); k++);
    if (resolveWalls(f, e, false)) { e.x = ox; e.y = oy; } // 角で押し出しきれないときは動かない
  }
  function moveCircle(f, e, dx, dy) {
    var n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (f.cellM * 0.4)));
    for (var k = 0; k < n; k++) { moveAxis(f, e, dx / n, 0); moveAxis(f, e, 0, dy / n); }
  }

  function canSee(f, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, n = Math.ceil(Math.hypot(dx, dy) / (f.cellM * 0.5));
    for (var k = 1; k < n; k++) {
      if (blocked(f, Math.floor((ax + dx * k / n) / f.cellM), Math.floor((ay + dy * k / n) / f.cellM))) return false;
    }
    return true;
  }

  // プレイヤーのマスからの歩く距離（4方向）。届かないマスは -1
  function distanceMap(f, targets) {
    var a = aux(f), dist = a.dist, q = a.queue, cols = f.cols, n = cols * f.rows, head = 0, tail = 0;
    dist.fill(-1);
    targets.forEach(function (p) {
      var i = cellIndex(f, p.x, p.y);
      if (i >= 0 && dist[i] < 0) { dist[i] = 0; q[tail++] = i; }
    });
    while (head < tail) {
      var i = q[head++], x = i % cols, d = dist[i] + 1;
      if (x > 0 && f.walk[i - 1] && dist[i - 1] < 0) { dist[i - 1] = d; q[tail++] = i - 1; }
      if (x < cols - 1 && f.walk[i + 1] && dist[i + 1] < 0) { dist[i + 1] = d; q[tail++] = i + 1; }
      if (i >= cols && f.walk[i - cols] && dist[i - cols] < 0) { dist[i - cols] = d; q[tail++] = i - cols; }
      if (i < n - cols && f.walk[i + cols] && dist[i + cols] < 0) { dist[i + cols] = d; q[tail++] = i + cols; }
    }
    return dist;
  }

  // 距離のマップを下る向き（斜めは両側が歩けるときだけ）
  function descend(f, dist, e) {
    var cx = Math.floor(e.x / f.cellM), cy = Math.floor(e.y / f.cellM), here = dist[cy * f.cols + cx];
    if (here < 0) return null;
    var best = null, bestD = here;
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      var x = cx + dx, y = cy + dy;
      if (blocked(f, x, y) || (dx && dy && (blocked(f, cx + dx, cy) || blocked(f, cx, cy + dy)))) continue;
      var d = dist[y * f.cols + x];
      if (d >= 0 && d < bestD) { bestD = d; best = { x: (x + 0.5) * f.cellM, y: (y + 0.5) * f.cellM }; }
    }
    return best && Math.atan2(best.y - e.y, best.x - e.x);
  }

  function activePlayers(game, floorId) {
    return game.players.filter(function (p) { return p.alive && !p.escaped && (!floorId || p.floor === floorId); });
  }

  function promptFor(game, playerId) {
    var p = game.players.filter(function (q) { return q.id === playerId; })[0];
    if (!p || !p.alive || p.escaped || game.status !== 'playing') return null;
    var L = game.config.labels, k = game.key;
    if (!k.holder && k.floor === p.floor && Math.hypot(k.x - p.x, k.y - p.y) <= game.config.interact.pickupM)
      return { action: 'pickup', label: L.pickup };
    var z = zoneAt(game, p.floor, p.x, p.y);
    if (!z) return null;
    if (game.exit && p.floor === game.exit.floor && z.id === game.exit.zoneId)
      return p.hasKey ? { action: 'exit', label: L.exit } : { action: 'locked', label: L.locked };
    var link = linkFor(game.floors[p.floor], z.id);
    if (link) return { action: 'move', label: L.move.replace('{floor}', game.floors[link.toFloor].name.split(' ')[0]), toFloor: link.toFloor };
    return null;
  }

  function interact(game, p) {
    var pr = promptFor(game, p.id);
    if (!pr) return;
    if (pr.action === 'pickup') {
      game.key.holder = p.id; p.hasKey = true;
      game.events.push({ type: 'pickup', playerId: p.id });
    } else if (pr.action === 'exit') {
      p.escaped = true;
      game.events.push({ type: 'escape', playerId: p.id });
    } else if (pr.action === 'move') {
      var link = linkFor(game.floors[p.floor], zoneAt(game, p.floor, p.x, p.y).id), from = p.floor;
      p.floor = link.toFloor; p.x = link.x; p.y = link.y;
      game.events.push({ type: 'move', playerId: p.id, from: from, to: p.floor });
    }
  }

  function attack(game, p) {
    var A = game.config.attack, f = game.floors[p.floor], half = A.arcDeg * Math.PI / 360;
    p.attackT = A.cooldownSec;
    game.zombies.slice().forEach(function (z) {
      if (z.floor !== p.floor) return;
      var dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy);
      if (d > A.rangeM + z.r + p.r) return;
      var diff = Math.atan2(dy, dx) - p.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (d > 1e-6 && Math.abs(diff) > half) return;
      z.hp -= A.damage; z.hurtT = 0.2; z.state = 'chase'; z.lostT = 0;
      if (d > 1e-6) moveCircle(f, z, dx / d * A.knockbackM, dy / d * A.knockbackM);
      game.events.push({ type: 'hit', playerId: p.id, zombieId: z.id, hp: Math.max(0, z.hp) });
      if (z.hp <= 0) {
        game.zombies.splice(game.zombies.indexOf(z), 1);
        game.events.push({ type: 'zombieDown', playerId: p.id, zombieId: z.id });
      }
    });
  }

  function hurt(game, p, z) {
    p.hp = Math.max(0, p.hp - game.config.zombie.damage); p.hurtT = 0.3;
    game.events.push({ type: 'hurt', playerId: p.id, zombieId: z.id, hp: p.hp });
    if (p.hp > 0) return;
    p.alive = false;
    if (p.hasKey) { p.hasKey = false; game.key.holder = null; game.key.floor = p.floor; game.key.x = p.x; game.key.y = p.y; }
    game.events.push({ type: 'death', playerId: p.id });
  }

  function updateZombies(game, dt) {
    var Z = game.config.zombie, distByFloor = {};
    game.zombies.forEach(function (z) {
      var f = game.floors[z.floor], targets = activePlayers(game, z.floor);
      z.hurtT = Math.max(0, z.hurtT - dt); z.hitT = Math.max(0, z.hitT - dt);
      var seen = null, seenD = Infinity;
      targets.forEach(function (p) {
        var d = Math.hypot(p.x - z.x, p.y - z.y);
        if (d <= Z.sightM && d < seenD && canSee(f, z.x, z.y, p.x, p.y)) { seen = p; seenD = d; }
      });
      var dir = null, speed = Z.wanderSpeedMps;
      if (seen) { z.state = 'chase'; z.lostT = 0; }
      else if (z.state === 'chase' && (z.lostT += dt) >= Z.loseSec) z.state = 'wander';
      if (z.state === 'chase' && targets.length) {
        speed = Z.chaseSpeedMps;
        if (seen) dir = Math.atan2(seen.y - z.y, seen.x - z.x);
        else {
          if (!distByFloor[z.floor]) distByFloor[z.floor] = distanceMap(f, targets);
          dir = descend(f, distByFloor[z.floor], z);
        }
      } else {
        z.state = 'wander';
        if ((z.turnT -= dt) <= 0) {
          z.wdir = rand(game) * Math.PI * 2;
          z.turnT = Z.wanderTurnSec[0] + rand(game) * (Z.wanderTurnSec[1] - Z.wanderTurnSec[0]);
        }
        dir = z.wdir;
      }
      if (dir === null) return;
      var ox = z.x, oy = z.y, step = speed * dt;
      moveCircle(f, z, Math.cos(dir) * step, Math.sin(dir) * step);
      z.facing = dir;
      if (z.state === 'wander' && Math.hypot(z.x - ox, z.y - oy) < step * 0.3) z.turnT = 0; // 壁に当たったら向きを変える
    });

    // ゾンビどうし・プレイヤーとの重なりを押し離し、触れたプレイヤーにダメージ
    for (var i = 0; i < game.zombies.length; i++) {
      var z = game.zombies[i], f = game.floors[z.floor];
      for (var j = i + 1; j < game.zombies.length; j++) {
        var o = game.zombies[j];
        if (o.floor !== z.floor) continue;
        var dx = o.x - z.x, dy = o.y - z.y, d = Math.hypot(dx, dy), m = z.r + o.r - d;
        if (m > 0 && d > 1e-6) { moveCircle(f, z, -dx / d * m / 2, -dy / d * m / 2); moveCircle(f, o, dx / d * m / 2, dy / d * m / 2); }
      }
      activePlayers(game, z.floor).forEach(function (p) {
        var dx = z.x - p.x, dy = z.y - p.y, d = Math.hypot(dx, dy), m = z.r + p.r - d;
        if (m > 0 && d > 1e-6) moveCircle(f, z, dx / d * m, dy / d * m);
        if (d <= z.r + p.r + 0.1 && z.hitT <= 0 && p.alive) { z.hitT = Z.hitCooldownSec; hurt(game, p, z); }
      });
    }
  }

  function step(game, inputs, dt) {
    game.events = [];
    if (game.status !== 'playing') return;
    dt = Math.min(dt, 0.1);
    game.time += dt;
    var speed = game.config.player.speedMps;
    activePlayers(game).forEach(function (p) {
      var inp = (inputs && inputs[p.id]) || {}, f = game.floors[p.floor];
      p.attackT = Math.max(0, p.attackT - dt); p.hurtT = Math.max(0, p.hurtT - dt);
      var mx = +inp.mx || 0, my = +inp.my || 0, len = Math.hypot(mx, my);
      if (len > 1) { mx /= len; my /= len; }
      if (len > 0.01) { p.facing = Math.atan2(my, mx); moveCircle(f, p, mx * speed * dt, my * speed * dt); }
      if (inp.interact) interact(game, p);
      if (inp.attack && p.attackT <= 0 && !p.escaped) attack(game, p);
    });
    updateZombies(game, dt);
    var holder = game.players.filter(function (p) { return p.id === game.key.holder; })[0];
    if (holder) { game.key.floor = holder.floor; game.key.x = holder.x; game.key.y = holder.y; }
    if (!activePlayers(game).length) game.status = game.players.some(function (p) { return p.escaped; }) ? 'escaped' : 'dead';
  }

  function zoneAt(game, floorId, x, y) {
    var f = game.floors[floorId];
    if (!f) return null;
    var cx = Math.floor(x / f.cellM), cy = Math.floor(y / f.cellM);
    if (cx < 0 || cy < 0 || cx >= f.cols || cy >= f.rows) return null;
    return aux(f).zoneById[f.cells[cy][cx]] || null;
  }

  return { createGame: createGame, step: step, promptFor: promptFor, zoneAt: zoneAt,
    _internal: { canSee: canSee, reachableFrom: reachableFrom, countComponents: countComponents, cellIndex: cellIndex } };
})();

if (typeof module !== 'undefined') module.exports = Sim; else window.Sim = Sim;
