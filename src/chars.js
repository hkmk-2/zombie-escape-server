// キャラクターの保存（設計図11節）。保存先は localStorage（キーは config.character.storageKey）。
// 値は全部 config.character と config.abilities の範囲に切る。Node でも読める（tests/chars.test.js）。
(function () {
  function find(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }

  // 数を範囲 {min, max, step} に切る。数でなければ default
  function num(v, r, max) {
    var hi = max == null ? r.max : Math.min(r.max, max), st = r.step || 1;
    v = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(v)) v = r.default;
    v = r.min + Math.round((v - r.min) / st) * st;
    return Math.max(r.min, Math.min(hi, v));
  }

  function newId() { return 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36); }

  // 知らない項目を捨て、全部の値を config の範囲に切った新しいオブジェクトを返す。名前が空の時は name が ''
  function clean(config, c) {
    var C = config.character, L = C.looks;
    c = c && typeof c === 'object' ? c : {};
    var body = find(C.bodies, c.body) || C.bodies[0];
    var face = typeof c.face === 'string' && c.face.indexOf('data:image/jpeg;base64,') === 0 && c.face.length <= C.faceMaxBytes ? c.face : null;
    return {
      id: typeof c.id === 'string' && c.id ? c.id.slice(0, 40) : newId(),
      name: Array.from(String(c.name == null ? '' : c.name).trim()).slice(0, C.nameMaxLen).join(''),
      body: body.id,
      hair: (find(L.hair, c.hair) || L.hair[0]).id,
      shirt: (find(L.shirt, c.shirt) || L.shirt[0]).id,
      face: face,
      hp: num(c.hp, C.hp),
      carry: num(c.carry, C.carry, body.carryMax),
      ability: (find(config.abilities, c.ability) || config.abilities[0]).id
    };
  }

  function save(storage, config, list) { storage.setItem(config.character.storageKey, JSON.stringify(list)); }

  // 保存した一覧。1人もいない時だけ presets を入れて保存する
  function load(storage, config) {
    var list;
    try { list = JSON.parse(storage.getItem(config.character.storageKey) || '[]'); } catch (e) { list = []; }
    if (!Array.isArray(list)) list = [];
    list = list.map(function (c) { return clean(config, c); }).filter(function (c) { return c.name; });
    if (!list.length) {
      list = config.character.presets.map(function (p) { return clean(config, p); });
      save(storage, config, list);
    }
    return list;
  }

  // 同じ id があれば置き換え、無ければ最後に足す。名前が空なら保存しないで null
  function put(storage, config, c) {
    var list = load(storage, config), d = clean(config, c);
    if (!d.name) return null;
    var i = list.findIndex(function (q) { return q.id === d.id; });
    if (i >= 0) list[i] = d; else list.push(d);
    save(storage, config, list);
    return d;
  }

  // 消したあとの一覧（0人になったら次の load で presets が入る）
  function remove(storage, config, id) {
    var list = load(storage, config).filter(function (q) { return q.id !== id; });
    save(storage, config, list);
    return list;
  }

  // 画像を中央で正方形に切り faceSize に縮めた JPEG の data URL にする。faceMaxBytes を超えたら画質を下げる（ブラウザだけ）
  function makeFace(file, config) {
    var C = config.character;
    return new Promise(function (ok, ng) {
      if (!file || !/^image\//.test(file.type)) return ng(new Error('notImage'));
      var url = URL.createObjectURL(file), im = new Image();
      im.onerror = function () { URL.revokeObjectURL(url); ng(new Error('notImage')); };
      im.onload = function () {
        URL.revokeObjectURL(url);
        var s = Math.min(im.naturalWidth, im.naturalHeight), c = document.createElement('canvas');
        c.width = c.height = C.faceSize;
        c.getContext('2d').drawImage(im, (im.naturalWidth - s) / 2, (im.naturalHeight - s) / 2, s, s, 0, 0, C.faceSize, C.faceSize);
        for (var q = 0.9; q > 0.05; q -= 0.1) {
          var d = c.toDataURL('image/jpeg', q);
          if (d.length <= C.faceMaxBytes) return ok(d);
        }
        ng(new Error('tooBig'));
      };
      im.src = url;
    });
  }

  var Chars = { clean: clean, load: load, save: save, put: put, remove: remove, makeFace: makeFace, find: find };
  if (typeof module !== 'undefined') module.exports = Chars; else window.Chars = Chars;
})();
