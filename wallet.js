/* =====================================================================
   WALLET — one coin purse shared by every game, plus the shop catalog
   ---------------------------------------------------------------------
   Drop-in: <script src="wallet.js"></script>. No dependencies. Saves to
   localStorage "mdWallet.v1" (every read and write in try/catch, so a
   private window just plays without saving).

   API  window.Wallet
     coins()              -> current total (integer, never below 0)
     add(n, why)          -> earn n coins; returns the new total
     spend(n, why)        -> pay up to n coins; NEVER goes below 0 and
                             NEVER blocks or throws; returns what was
                             actually paid (0..n)
     owned(id)            -> true if bought
     buy(id)              -> { ok, id, price, coins, short?, already?, reason? }
                             ok:false + short:N when he needs N more coins.
                             A new buy is equipped straight away.
     equip(slot, id)      -> equip an owned item; equip(slot, null) takes it off
     equipped(slot)       -> the equipped item object for "hat"|"cart"|"pet"|"trail", or null
     item(id)             -> one catalog item (a copy) or null
     items(slot?)         -> the catalog (copies) with .owned and .equipped flags
     slots()              -> [{ id, name, icon }] in shop order
     onChange(fn)         -> fn({ type, coins, n, why, id, slot }); returns an unsubscribe fn
     syncFrom(localCoins) -> for games that still keep their own coin count:
                             the FIRST call on a page only remembers the
                             number; every later call pushes the change
                             since the last call into the wallet (a rise is
                             add, a drop is spend). Returns the wallet total.
     resetSync(localCoins)-> re-anchor syncFrom (call after a game resets its
                             local count, so the reset is not counted)
     drawItem(ctx, id, x, y, size) -> paint an item on a 2D canvas, centred
                             at x,y. Hats sit ON x,y (the top of a head).
     history()            -> the last 40 earn/spend/buy lines (for grown-ups)

   Every item: { id, slot, name, price, emoji, colors:[hex...], desc }
     emoji  - the quick way to show it anywhere (HUD, a DOM label)
     colors - what a 3D game should tint with (cart paint, pet glow, trail)
     desc   - how it looks, for anyone drawing it by hand
   ===================================================================== */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (window.Wallet && window.Wallet.__v === 1) return;

  var KEY = "mdWallet.v1";
  var START_COINS = 55;    // the same 55 every game used to hand out per run

  /* ---------------- the catalog ---------------- */
  var SLOTS = [
    { id: "hat",   name: "Hero Hats",           icon: "\u{1F451}" },
    { id: "cart",  name: "Cart Paint",          icon: "\u{1F6D2}" },
    { id: "pet",   name: "Pets",                icon: "\u{1F409}" },
    { id: "trail", name: "Trails & Sparkles",   icon: "✨" }
  ];
  var CATALOG = [
    { id: "hat_party",   slot: "hat", name: "Party Hat",     price: 60,  emoji: "\u{1F973}", colors: ["#ff4fa3", "#ffd23f", "#4fc3ff"], desc: "A striped cone with a fluffy pom-pom on top." },
    { id: "hat_pirate",  slot: "hat", name: "Pirate Hat",    price: 90,  emoji: "\u{1F3F4}‍☠️", colors: ["#1b1b24", "#ffffff", "#d4a017"], desc: "A black tricorn with a white skull and gold trim." },
    { id: "hat_wizard",  slot: "hat", name: "Wizard Hat",    price: 120, emoji: "\u{1F9D9}", colors: ["#4b2ca8", "#ffd23f"], desc: "A tall floppy purple cone covered in gold stars." },
    { id: "hat_crown",   slot: "hat", name: "Royal Crown",   price: 150, emoji: "\u{1F451}", colors: ["#ffd23f", "#e0263b", "#2f8cff"], desc: "A gold crown with five points and red and blue jewels." },
    { id: "hat_viking",  slot: "hat", name: "Viking Helmet", price: 200, emoji: "\u{1FA96}", colors: ["#9aa7b8", "#f3ead2", "#6b4a2a"], desc: "A steel dome with two big curved horns." },

    { id: "cart_ice",     slot: "cart", name: "Ice Cart",     price: 180, emoji: "\u{1F9CA}", colors: ["#bff3ff", "#5fd0ff", "#ffffff"], desc: "Frosty blue sides with white icicles on the rim." },
    { id: "cart_lava",    slot: "cart", name: "Lava Cart",    price: 200, emoji: "\u{1F30B}", colors: ["#ff4d00", "#ffb800", "#3a0d00"], desc: "Glowing orange lava cracks on dark rock." },
    { id: "cart_gold",    slot: "cart", name: "Gold Cart",    price: 250, emoji: "\u{1FA99}", colors: ["#ffd23f", "#b8860b", "#fff3b0"], desc: "Shiny solid gold with a bright shine stripe." },
    { id: "cart_rainbow", slot: "cart", name: "Rainbow Cart", price: 300, emoji: "\u{1F308}", colors: ["#ff3b3b", "#ff9f1a", "#ffe03b", "#3ddc84", "#3b8bff", "#9b5cff"], desc: "Every colour of the rainbow in stripes." },

    { id: "pet_slime",  slot: "pet", name: "Bouncy Slime",  price: 180, emoji: "\u{1F7E2}", colors: ["#5be35b", "#2a9d2a"], desc: "A wobbly green blob with big happy eyes." },
    { id: "pet_bat",    slot: "pet", name: "Pet Bat",       price: 220, emoji: "\u{1F987}", colors: ["#5b3a8a", "#ff4fa3"], desc: "A little purple bat that flaps next to you." },
    { id: "pet_drone",  slot: "pet", name: "Robot Drone",   price: 400, emoji: "\u{1F916}", colors: ["#c8d3e6", "#4fc3ff"], desc: "A hovering silver drone with a blue light eye." },
    { id: "pet_dragon", slot: "pet", name: "Baby Dragon",   price: 500, emoji: "\u{1F432}", colors: ["#3ddc84", "#ff7a1a"], desc: "A tiny green dragon that puffs little flames." },

    { id: "trail_sparkle", slot: "trail", name: "Sparkles",       price: 80,  emoji: "✨",     colors: ["#fff3b0", "#ffd23f"], desc: "Gold twinkles pop behind you." },
    { id: "trail_bubble",  slot: "trail", name: "Bubbles",        price: 90,  emoji: "\u{1FAE7}", colors: ["#bff3ff", "#8fe9ff"], desc: "Shiny soap bubbles float up behind you." },
    { id: "trail_star",    slot: "trail", name: "Shooting Stars", price: 110, emoji: "⭐",     colors: ["#ffe03b", "#ffffff"], desc: "Little yellow stars streak behind you." },
    { id: "trail_fire",    slot: "trail", name: "Fire Trail",     price: 140, emoji: "\u{1F525}", colors: ["#ff4d00", "#ffb800"], desc: "Flickering flames follow your feet." },
    { id: "trail_rainbow", slot: "trail", name: "Rainbow Trail",  price: 160, emoji: "\u{1F308}", colors: ["#ff3b3b", "#ff9f1a", "#ffe03b", "#3ddc84", "#3b8bff", "#9b5cff"], desc: "A rainbow ribbon streams behind you." }
  ];
  var BY_ID = {};
  CATALOG.forEach(function (it) { BY_ID[it.id] = it; });
  function copy(it) {
    return { id: it.id, slot: it.slot, name: it.name, price: it.price, emoji: it.emoji, colors: it.colors.slice(), desc: it.desc };
  }

  /* ---------------- state ---------------- */
  function fresh() { return { v: 1, coins: START_COINS, earned: 0, spent: 0, owned: [], equipped: { hat: null, cart: null, pet: null, trail: null }, log: [] }; }
  function toInt(n) { n = Math.floor(Number(n)); return isFinite(n) && n > 0 ? n : 0; }
  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { s = null; }
    var d = fresh();
    if (!s || typeof s !== "object") return d;
    d.coins = Math.max(0, Math.floor(Number(s.coins)) || 0);
    d.earned = toInt(s.earned); d.spent = toInt(s.spent);
    d.owned = Array.isArray(s.owned) ? s.owned.filter(function (id) { return !!BY_ID[id]; }) : [];
    if (s.equipped && typeof s.equipped === "object") {
      SLOTS.forEach(function (sl) {
        var id = s.equipped[sl.id];
        d.equipped[sl.id] = (id && BY_ID[id] && BY_ID[id].slot === sl.id && d.owned.indexOf(id) !== -1) ? id : null;
      });
    }
    d.log = Array.isArray(s.log) ? s.log.slice(-40) : [];
    return d;
  }
  var W = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(W)); } catch (e) { /* private mode */ } }
  function note(line) { W.log.push({ t: Date.now(), line: String(line).slice(0, 80) }); if (W.log.length > 40) W.log = W.log.slice(-40); }

  var subs = [];
  function emit(ev) {
    ev.coins = W.coins;
    subs.slice().forEach(function (fn) { try { fn(ev); } catch (e) { } });
  }
  function onChange(fn) {
    if (typeof fn !== "function") return function () { };
    subs.push(fn);
    return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  }
  try {
    window.addEventListener("storage", function (e) { if (e.key === KEY) { W = load(); emit({ type: "sync" }); } });
  } catch (e) { }
  function refresh() { W = load(); emit({ type: "sync" }); return W.coins; }
  try {
    window.addEventListener("pageshow", function (e) { if (e.persisted) refresh(); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") refresh(); });
  } catch (e) { }

  /* ---------------- coins ---------------- */
  function coins() { return W.coins; }
  function add(n, why) {
    try {
      n = toInt(n); if (!n) return W.coins;
      W.coins += n; W.earned += n; note("+" + n + " " + (why || "")); save();
      emit({ type: "add", n: n, why: why || "" });
    } catch (e) { }
    return W.coins;
  }
  function spend(n, why) {
    var paid = 0;
    try {
      n = toInt(n); if (!n) return 0;
      paid = Math.min(W.coins, n);
      W.coins = Math.max(0, W.coins - n); W.spent += paid;
      note("-" + paid + " " + (why || "")); save();
      emit({ type: "spend", n: paid, why: why || "" });
    } catch (e) { }
    return paid;
  }

  /* ---------------- shop ---------------- */
  function owned(id) { return W.owned.indexOf(id) !== -1; }
  function buy(id) {
    var it = BY_ID[id];
    if (!it) return { ok: false, id: id, reason: "no such item" };
    if (owned(id)) return { ok: true, already: true, id: id, price: it.price, coins: W.coins };
    if (W.coins < it.price) return { ok: false, id: id, price: it.price, coins: W.coins, short: it.price - W.coins, reason: "not enough coins" };
    try {
      W.coins -= it.price; W.spent += it.price; W.owned.push(id); W.equipped[it.slot] = id;
      note("bought " + it.name + " (-" + it.price + ")"); save();
      emit({ type: "buy", id: id, slot: it.slot, n: it.price });
    } catch (e) { return { ok: false, id: id, reason: "save failed" }; }
    return { ok: true, id: id, price: it.price, coins: W.coins };
  }
  function equip(slot, id) {
    if (!W.equipped.hasOwnProperty(slot)) return false;
    if (id == null) { W.equipped[slot] = null; save(); emit({ type: "equip", slot: slot, id: null }); return true; }
    var it = BY_ID[id];
    if (!it || it.slot !== slot || !owned(id)) return false;
    W.equipped[slot] = id; save(); emit({ type: "equip", slot: slot, id: id });
    return true;
  }
  function equipped(slot) { var id = W.equipped[slot]; return id && BY_ID[id] ? copy(BY_ID[id]) : null; }
  function item(id) { return BY_ID[id] ? copy(BY_ID[id]) : null; }
  function items(slot) {
    return CATALOG.filter(function (it) { return !slot || it.slot === slot; }).map(function (it) {
      var c = copy(it); c.owned = owned(it.id); c.equipped = W.equipped[it.slot] === it.id; return c;
    });
  }
  function slots() { return SLOTS.map(function (s) { return { id: s.id, name: s.name, icon: s.icon }; }); }

  /* ---------------- syncFrom: for games that keep their own coin count ---------------- */
  var lastLocal = null;
  function syncFrom(localCoins) {
    var n = Math.floor(Number(localCoins));
    if (!isFinite(n)) return W.coins;
    if (lastLocal === null) { lastLocal = n; return W.coins; }
    var d = n - lastLocal; lastLocal = n;
    if (d > 0) add(d, "game"); else if (d < 0) spend(-d, "game");
    return W.coins;
  }
  function resetSync(localCoins) { var n = Math.floor(Number(localCoins)); lastLocal = isFinite(n) ? n : null; return W.coins; }

  /* ---------------- drawing (2D canvas) ---------------- */
  function drawItem(ctx, id, x, y, size) {
    var it = BY_ID[id]; if (!it || !ctx) return false;
    var s = size || 64, c = it.colors;
    try {
      ctx.save();
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      if (it.slot === "hat") drawHat(ctx, it.id, x, y, s, c);
      else if (it.slot === "cart") drawCart(ctx, x, y, s, c, it.id);
      else if (it.id === "pet_slime") drawSlime(ctx, x, y, s, c);
      else emojiAt(ctx, it.emoji, x, y, s);
      ctx.restore();
    } catch (e) { try { ctx.restore(); } catch (e2) { } return false; }
    return true;
  }
  function emojiAt(ctx, e, x, y, s) {
    ctx.font = Math.round(s) + "px 'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(e, x, y);
  }
  /* the slime has no good emoji, so it is drawn: a wobbly blob with big happy eyes */
  function drawSlime(ctx, x, y, s, c) {
    var w = s * 0.5, h = s * 0.42, b = y + h * 0.55;
    ctx.beginPath(); ctx.moveTo(x - w, b);
    ctx.bezierCurveTo(x - w * 1.05, y - h * 0.4, x - w * 0.45, y - h * 1.05, x, y - h);
    ctx.bezierCurveTo(x + w * 0.45, y - h * 1.05, x + w * 1.05, y - h * 0.4, x + w, b);
    ctx.closePath();
    var g = ctx.createLinearGradient(0, y - h, 0, b); g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
    ctx.fillStyle = g; ctx.fill(); outline(ctx, s);
    ctx.fillStyle = "rgba(255,255,255,.55)"; ctx.beginPath(); ctx.ellipse(x - w * 0.45, y - h * 0.45, w * 0.14, h * 0.2, -0.5, 0, Math.PI * 2); ctx.fill();
    [-1, 1].forEach(function (d) {
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x + d * w * 0.32, y - h * 0.05, s * 0.1, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#111"; ctx.beginPath(); ctx.arc(x + d * w * 0.32, y - h * 0.02, s * 0.05, 0, Math.PI * 2); ctx.fill();
    });
    ctx.strokeStyle = "#114411"; ctx.lineWidth = Math.max(2, s * 0.035);
    ctx.beginPath(); ctx.arc(x, y + h * 0.2, s * 0.1, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  }
  function outline(ctx, s) { ctx.lineWidth = Math.max(2, s * 0.045); ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.stroke(); }
  /* hats: x,y is the top-centre of the head; the hat rises above it */
  function drawHat(ctx, id, x, y, s, c) {
    var w = s, h;
    if (id === "hat_party") {
      h = s * 1.0;
      ctx.beginPath(); ctx.moveTo(x - w * 0.34, y); ctx.lineTo(x, y - h); ctx.lineTo(x + w * 0.34, y); ctx.closePath();
      ctx.fillStyle = c[0]; ctx.fill(); outline(ctx, s);
      ctx.save(); ctx.clip();
      ctx.strokeStyle = c[1]; ctx.lineWidth = s * 0.09;
      for (var i = 1; i < 5; i++) { ctx.beginPath(); ctx.moveTo(x - w, y - h * i / 5 + w * 0.3); ctx.lineTo(x + w, y - h * i / 5 - w * 0.3); ctx.stroke(); }
      ctx.restore();
      ctx.beginPath(); ctx.arc(x, y - h, s * 0.1, 0, Math.PI * 2); ctx.fillStyle = c[2]; ctx.fill(); outline(ctx, s);
    } else if (id === "hat_pirate") {
      h = s * 0.5;
      ctx.beginPath(); ctx.moveTo(x - w * 0.62, y - h * 0.05);
      ctx.quadraticCurveTo(x - w * 0.45, y - h * 1.25, x, y - h * 0.95);
      ctx.quadraticCurveTo(x + w * 0.45, y - h * 1.25, x + w * 0.62, y - h * 0.05);
      ctx.quadraticCurveTo(x, y + h * 0.18, x - w * 0.62, y - h * 0.05); ctx.closePath();
      ctx.fillStyle = c[0]; ctx.fill(); ctx.strokeStyle = c[2]; ctx.lineWidth = s * 0.05; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y - h * 0.55, s * 0.09, 0, Math.PI * 2); ctx.fillStyle = c[1]; ctx.fill();
      ctx.fillStyle = c[0]; ctx.fillRect(x - s * 0.05, y - h * 0.56, s * 0.03, s * 0.03); ctx.fillRect(x + s * 0.02, y - h * 0.56, s * 0.03, s * 0.03);
      ctx.strokeStyle = c[1]; ctx.lineWidth = s * 0.025;
      ctx.beginPath(); ctx.moveTo(x - s * 0.13, y - h * 0.3); ctx.lineTo(x + s * 0.13, y - h * 0.12); ctx.moveTo(x + s * 0.13, y - h * 0.3); ctx.lineTo(x - s * 0.13, y - h * 0.12); ctx.stroke();
    } else if (id === "hat_wizard") {
      h = s * 1.15;
      ctx.beginPath(); ctx.moveTo(x - w * 0.36, y - s * 0.05);
      ctx.quadraticCurveTo(x - w * 0.05, y - h * 0.6, x + w * 0.05, y - h);
      ctx.quadraticCurveTo(x + w * 0.35, y - h * 0.9, x + w * 0.28, y - h * 0.78);
      ctx.quadraticCurveTo(x + w * 0.2, y - h * 0.5, x + w * 0.36, y - s * 0.05); ctx.closePath();
      ctx.fillStyle = c[0]; ctx.fill(); outline(ctx, s);
      ctx.beginPath(); ctx.ellipse(x, y - s * 0.04, w * 0.55, s * 0.1, 0, 0, Math.PI * 2); ctx.fillStyle = c[0]; ctx.fill(); outline(ctx, s);
      star(ctx, x - s * 0.06, y - h * 0.35, s * 0.09, c[1]); star(ctx, x + s * 0.12, y - h * 0.62, s * 0.06, c[1]);
    } else if (id === "hat_crown") {
      h = s * 0.55;
      ctx.beginPath(); ctx.moveTo(x - w * 0.42, y);
      ctx.lineTo(x - w * 0.46, y - h); ctx.lineTo(x - w * 0.23, y - h * 0.55); ctx.lineTo(x, y - h * 1.1);
      ctx.lineTo(x + w * 0.23, y - h * 0.55); ctx.lineTo(x + w * 0.46, y - h); ctx.lineTo(x + w * 0.42, y); ctx.closePath();
      ctx.fillStyle = c[0]; ctx.fill(); outline(ctx, s);
      [[-0.46, -1], [0, -1.1], [0.46, -1]].forEach(function (p) { ctx.beginPath(); ctx.arc(x + w * p[0], y + h * p[1], s * 0.05, 0, Math.PI * 2); ctx.fillStyle = "#fff3b0"; ctx.fill(); });
      ctx.beginPath(); ctx.arc(x, y - h * 0.32, s * 0.08, 0, Math.PI * 2); ctx.fillStyle = c[1]; ctx.fill();
      ctx.beginPath(); ctx.arc(x - w * 0.24, y - h * 0.25, s * 0.055, 0, Math.PI * 2); ctx.fillStyle = c[2]; ctx.fill();
      ctx.beginPath(); ctx.arc(x + w * 0.24, y - h * 0.25, s * 0.055, 0, Math.PI * 2); ctx.fillStyle = c[2]; ctx.fill();
    } else if (id === "hat_viking") {
      h = s * 0.5;
      [-1, 1].forEach(function (d) {
        ctx.beginPath(); ctx.moveTo(x + d * w * 0.3, y - h * 0.45);
        ctx.quadraticCurveTo(x + d * w * 0.75, y - h * 0.5, x + d * w * 0.7, y - h * 1.6);
        ctx.quadraticCurveTo(x + d * w * 0.55, y - h * 0.8, x + d * w * 0.34, y - h * 0.8); ctx.closePath();
        ctx.fillStyle = c[1]; ctx.fill(); outline(ctx, s);
      });
      ctx.beginPath(); ctx.moveTo(x - w * 0.42, y); ctx.arc(x, y, w * 0.42, Math.PI, 0); ctx.closePath();
      ctx.fillStyle = c[0]; ctx.fill(); outline(ctx, s);
      ctx.fillStyle = c[2]; ctx.fillRect(x - w * 0.44, y - s * 0.07, w * 0.88, s * 0.1);
      ctx.fillStyle = "#e6ecf5"; [-0.3, -0.1, 0.1, 0.3].forEach(function (p) { ctx.beginPath(); ctx.arc(x + w * p, y - s * 0.02, s * 0.022, 0, Math.PI * 2); ctx.fill(); });
    }
  }
  function star(ctx, x, y, r, col) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  }
  /* carts: x,y is the centre of the cart body */
  function drawCart(ctx, x, y, s, c, id) {
    var w = s, h = s * 0.5;
    ctx.beginPath(); ctx.moveTo(x - w * 0.5, y - h * 0.5); ctx.lineTo(x + w * 0.5, y - h * 0.5);
    ctx.lineTo(x + w * 0.4, y + h * 0.5); ctx.lineTo(x - w * 0.4, y + h * 0.5); ctx.closePath();
    var g;
    if (id === "cart_rainbow") {
      g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      c.forEach(function (col, i) { g.addColorStop(i / (c.length - 1), col); });
    } else {
      g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2); g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
    }
    ctx.fillStyle = g; ctx.fill(); outline(ctx, s);
    ctx.save(); ctx.clip();
    if (id === "cart_lava") {
      ctx.strokeStyle = c[1]; ctx.lineWidth = s * 0.03;
      ctx.beginPath(); ctx.moveTo(x - w * 0.3, y - h * 0.4); ctx.lineTo(x - w * 0.15, y); ctx.lineTo(x - w * 0.25, y + h * 0.4);
      ctx.moveTo(x + w * 0.2, y - h * 0.45); ctx.lineTo(x + w * 0.05, y - h * 0.05); ctx.lineTo(x + w * 0.25, y + h * 0.35); ctx.stroke();
    } else if (id === "cart_ice") {
      ctx.fillStyle = c[2];
      for (var i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(x + i * w * 0.18 - s * 0.05, y - h * 0.5); ctx.lineTo(x + i * w * 0.18 + s * 0.05, y - h * 0.5); ctx.lineTo(x + i * w * 0.18, y - h * 0.15); ctx.fill(); }
    } else if (id === "cart_gold") {
      ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.fillRect(x - w * 0.5, y - h * 0.25, w, h * 0.12);
    }
    ctx.restore();
    ctx.fillStyle = "#2a2a33";
    [-0.26, 0.26].forEach(function (p) { ctx.beginPath(); ctx.arc(x + w * p, y + h * 0.58, s * 0.11, 0, Math.PI * 2); ctx.fill(); });
  }

  window.Wallet = {
    __v: 1,
    coins: coins, add: add, spend: spend,
    owned: owned, buy: buy, equip: equip, equipped: equipped,
    item: item, items: items, slots: slots, onChange: onChange,
    syncFrom: syncFrom, resetSync: resetSync, drawItem: drawItem, refresh: refresh,
    history: function () { return W.log.slice(); }
  };
  save();
})();
