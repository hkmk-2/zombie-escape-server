// みんなで遊ぶサーバー（設計図10節）。node server/server.js
var http = require('http');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var WebSocketServer = require('ws').WebSocketServer;
var ROOT = path.join(__dirname, '..');
var DATA = require(path.join(ROOT, 'data', 'data.js'));
var Sim = require(path.join(ROOT, 'src', 'sim.js'));
var N = DATA.config.net;
var CH = DATA.config.character;
var ABILITIES = DATA.config.abilities;
var FACE_PREFIX = 'data:image/jpeg;base64,'; // 設計図11節：face は JPEG の data URL か null

var rooms = new Map();

function roundN(v) { var m = Math.pow(10, N.decimals); return Math.round(v * m) / m; }
function send(c, msg) { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); }
function clampAxis(v) { return typeof v === 'number' && isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0; }

function newRoomId() {
  var id;
  do {
    id = '';
    for (var i = 0; i < N.roomIdLen; i++) id += N.roomIdChars[crypto.randomInt(N.roomIdChars.length)];
  } while (rooms.has(id));
  return id;
}

function cleanName(raw, no) {
  var s = Array.from(String(raw || '').trim()).slice(0, N.nameMaxLen).join('');
  return s || N.defaultName.replace('{n}', no);
}

// キャラクターを選んだ後は char.name、選ぶ前はつないだ時の名前
function nameOf(c) { return c.char ? c.char.name : c.name; }

function pickId(v, list) { return list.some(function (x) { return x.id === v; }) ? v : list[0].id; }
function clampRange(v, r, max) {
  if (typeof v !== 'number' || !isFinite(v)) v = r.default;
  v = r.min + Math.round((v - r.min) / r.step) * r.step;
  return Math.max(r.min, Math.min(max, v));
}

// 外から来た char を config の範囲に切る。知らない項目は捨てる。face は別に返す
function cleanChar(raw, c) {
  var body = pickId(raw.body, CH.bodies);
  var bodyDef = CH.bodies.filter(function (b) { return b.id === body; })[0];
  var name = Array.from(String(typeof raw.name === 'string' ? raw.name : '').trim()).slice(0, CH.nameMaxLen).join('');
  var face = raw.face;
  var faceOk = typeof face === 'string' && face.length <= CH.faceMaxBytes && face.indexOf(FACE_PREFIX) === 0 &&
    /^[A-Za-z0-9+/=]*$/.test(face.slice(FACE_PREFIX.length));
  return {
    char: { name: name || c.name, body: body, hair: pickId(raw.hair, CH.looks.hair), shirt: pickId(raw.shirt, CH.looks.shirt),
      hp: clampRange(raw.hp, CH.hp, CH.hp.max),
      carry: clampRange(raw.carry, CH.carry, Math.min(CH.carry.max, bodyDef.carryMax || CH.carry.max)),
      ability: pickId(raw.ability, ABILITIES) },
    face: faceOk ? face : null
  };
}

function sendRoom(room) {
  var players = room.clients.map(function (c) { return { id: c.id, name: nameOf(c), ready: c.ready, char: c.char }; });
  room.clients.forEach(function (c) {
    send(c, { t: 'room', room: room.id, you: c.id, host: room.hostId, status: room.status, players: players });
  });
}

function startGame(room) {
  var seed = crypto.randomInt(0x100000000);
  var players = room.clients.map(function (c, i) {
    return Object.assign({}, c.char, { id: c.id, name: nameOf(c), color: N.colors[i % N.colors.length] });
  });
  room.game = Sim.createGame(DATA, { seed: seed, players: players });
  room.status = 'playing';
  room.events = [];
  room.ticks = 0;
  room.clients.forEach(function (c) { c.input = { mx: 0, my: 0, interact: false, attack: false, ability: false }; send(c, { t: 'start', seed: seed, players: players }); });
  sendRoom(room);
  sendSnapshot(room);
}

function sendSnapshot(room) {
  var g = room.game, k = g.key;
  var p = g.players.map(function (q) {
    return [q.id, q.floor, roundN(q.x), roundN(q.y), roundN(q.facing), roundN(q.hp), q.hasKey, q.alive, q.escaped, roundN(q.attackT), roundN(q.hurtT), roundN(q.abilityT), roundN(q.abilityCd)];
  });
  var byId = {};
  g.players.forEach(function (q) { byId[q.id] = q; });
  var e = room.events;
  room.events = [];
  room.clients.forEach(function (c) {
    var me = byId[c.id];
    var z = g.zombies.filter(function (q) { return me && q.floor === me.floor; })
      .map(function (q) { return [q.id, q.floor, roundN(q.x), roundN(q.y), roundN(q.facing), roundN(q.hp), roundN(q.hurtT)]; });
    send(c, { t: 's', time: roundN(g.time), st: g.status, p: p, z: z, k: [k.floor, roundN(k.x), roundN(k.y), k.holder], e: e });
  });
}

function tickRoom(room) {
  var inputs = {};
  room.clients.forEach(function (c) {
    inputs[c.id] = { mx: c.input.mx, my: c.input.my, interact: c.input.interact, attack: c.input.attack, ability: c.input.ability };
    c.input.interact = false;
    c.input.attack = false;
    c.input.ability = false;
  });
  Sim.step(room.game, inputs, 1 / N.stepHz);
  Array.prototype.push.apply(room.events, room.game.events);
  room.ticks++;
  if (room.game.status !== 'playing') {
    sendSnapshot(room);
    room.status = 'ended';
    sendRoom(room);
    room.clients.forEach(function (c) { c.ready = false; });
    room.status = 'waiting';
    sendRoom(room);
  } else if (room.ticks % Math.round(N.stepHz / N.snapshotHz) === 0) sendSnapshot(room);
}

function tickAll() {
  rooms.forEach(function (room) {
    if (room.status !== 'playing') return;
    try { tickRoom(room); } catch (err) {
      // 1つの部屋のエラーで全体を止めない。その部屋だけ閉じる
      console.error('部屋 ' + room.id + ' のエラー:', err);
      rooms.delete(room.id);
      room.clients.forEach(function (c) { c.ws.close(1011); });
    }
  });
}

function onMessage(room, c, buf) {
  var now = Date.now();
  if (now - c.winStart >= 1000) { c.winStart = now; c.count = 0; }
  if (++c.count > N.maxMsgPerSec) { c.ws.close(1008); return; }
  if (buf.length > N.maxCharBytes) return;
  var m;
  try { m = JSON.parse(buf.toString('utf8')); } catch (err) { return; }
  if (!m || typeof m !== 'object') return;
  if (m.t !== 'char' && buf.length > N.maxMsgBytes) return;
  if (m.t === 'in') {
    c.input.mx = clampAxis(m.mx);
    c.input.my = clampAxis(m.my);
    if (m.interact === true) c.input.interact = true;
    if (m.attack === true) c.input.attack = true;
    if (m.ability === true) c.input.ability = true;
  } else if (m.t === 'char') {
    if (room.status === 'playing' || !m.char || typeof m.char !== 'object') return;
    var r = cleanChar(m.char, c);
    c.char = r.char;
    sendRoom(room);
    if (r.face !== c.face) {
      c.face = r.face;
      room.clients.forEach(function (o) { send(o, { t: 'face', id: c.id, face: c.face }); });
    }
  } else if (m.t === 'ready') {
    if (room.status === 'playing') return;
    c.ready = m.ready === true;
    sendRoom(room);
  } else if (m.t === 'start') {
    var allReady = room.clients.every(function (o) { return o.char && o.ready; });
    if (c.id === room.hostId && (room.status === 'waiting' || room.status === 'ended') && allReady) startGame(room);
  }
}

function onLeave(room, c) {
  var i = room.clients.indexOf(c);
  if (i < 0) return;
  room.clients.splice(i, 1);
  if (!room.clients.length) { rooms.delete(room.id); return; }
  if (room.hostId === c.id) room.hostId = room.clients[0].id;
  sendRoom(room);
}

function onConnection(ws, req) {
  ws.on('error', function () {});
  var q = new URL(req.url, 'http://x').searchParams;
  var reject = function (code) { ws.send(JSON.stringify({ t: 'error', code: code })); ws.close(); };
  var room, roomId = q.get('room');
  if (roomId) {
    room = rooms.get(roomId);
    if (!room) return reject('noRoom');
    if (room.clients.length >= N.maxPlayers) return reject('full');
    if (room.status === 'playing') return reject('busy');
  } else {
    room = { id: newRoomId(), status: 'waiting', hostId: null, clients: [], game: null, seq: 0, events: [], ticks: 0 };
    rooms.set(room.id, room);
  }
  room.seq++;
  var c = { id: 'p' + room.seq, name: cleanName(q.get('name'), room.seq), ws: ws, winStart: Date.now(), count: 0,
    input: { mx: 0, my: 0, interact: false, attack: false, ability: false }, char: null, face: null, ready: false };
  room.clients.push(c);
  if (!room.hostId) room.hostId = c.id;
  ws.on('message', function (buf) {
    try { onMessage(room, c, buf); } catch (err) { console.error('受信のエラー:', err); }
  });
  ws.on('close', function () { onLeave(room, c); });
  sendRoom(room);
  room.clients.forEach(function (o) { if (o !== c && o.face) send(c, { t: 'face', id: o.id, face: o.face }); });
}

function serveFile(req, res) {
  var notFound = function () { res.writeHead(404); res.end(); };
  if (req.method !== 'GET' || req.url.indexOf('..') >= 0) return notFound();
  var p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname).slice(1); } catch (err) { return notFound(); }
  if (p.indexOf('..') >= 0) return notFound();
  if (p === '') p = N.serveFiles[0];
  var ok = N.serveFiles.indexOf(p) >= 0 || N.serveDirs.some(function (d) { return p.indexOf(d) === 0 && p.indexOf('/', d.length) < 0 && p.length > d.length; });
  if (!ok) return notFound();
  fs.readFile(path.join(ROOT, p), function (err, body) {
    if (err) return notFound();
    res.writeHead(200, { 'Content-Type': N.mime[path.extname(p)] || 'application/octet-stream' });
    res.end(body);
  });
}

function start(port) {
  var server = http.createServer(function (req, res) {
    if (req.method === 'GET' && req.url === N.healthPath) { res.writeHead(200); return res.end('ok'); }
    serveFile(req, res);
  });
  var wss = new WebSocketServer({ server: server, path: N.wsPath, maxPayload: Math.max(N.maxMsgBytes, N.maxCharBytes) });
  wss.on('connection', onConnection);
  var timer = setInterval(tickAll, 1000 / N.stepHz);
  server.on('close', function () { clearInterval(timer); wss.clients.forEach(function (ws) { ws.terminate(); }); });
  return new Promise(function (resolve) { server.listen(port, function () { resolve(server); }); });
}

module.exports = { start: start, rooms: rooms };
if (require.main === module) {
  start(Number(process.env.PORT) || N.defaultPort).then(function (s) { console.log('サーバー起動: ポート ' + s.address().port); });
}
