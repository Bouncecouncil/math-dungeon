/* =====================================================================
   HERO LOOK — what the kid's character actually looks like.

   Will, 2026-10-01: "we need an option to customize the character.
   Lennon has brown skin and curly hair"

   The arcade already remembers WHICH hero he picked (mathDungeonChar:
   knight / wizard / ninja / robot / explorer / dragon). This file
   remembers what that hero LOOKS LIKE, so he can put himself in the
   game, and it is shared by every game so the same face walks through
   all of them.

   Storage: localStorage "mathDungeonLook.v1"
     { skin: "<hex>", hair: "<style id>", hairColor: "<hex>", outfit: "<hex>" }

   For the human heroes, skin and hair are drawn. For BEEP-9 the robot
   and Lil' Dragon, "skin" is the body colour and hair is skipped: a
   dragon has no curls. Every game must tolerate that.

   Nothing here draws a whole character. Each game owns its own sprite,
   because the dungeon's 3D hero, the mine cart rider and the flat
   canvas sprites are genuinely different things. What this file gives
   them is the agreed palette, the saved choice, and one helper that
   paints hair on top of a head so curly hair looks the same everywhere.
   ===================================================================== */
(function () {
  "use strict";

  var KEY = "mathDungeonLook.v1";

  /* A real range, not three tokens. Ordered light to deep so the row
     reads naturally; Lennon's own tone is in here, not approximated. */
  var SKINS = [
    { id: "porcelain", hex: "#F6DCC4", name: "Porcelain" },
    { id: "sand",      hex: "#EFC9A0", name: "Sand" },
    { id: "honey",     hex: "#DFA874", name: "Honey" },
    { id: "caramel",   hex: "#C08552", name: "Caramel" },
    { id: "chestnut",  hex: "#9C6239", name: "Chestnut" },
    { id: "cocoa",     hex: "#78462A", name: "Cocoa" },
    { id: "espresso",  hex: "#573021", name: "Espresso" },
    { id: "ebony",     hex: "#3D2117", name: "Ebony" }
  ];

  var HAIRS = [
    { id: "curly",   name: "Curly" },
    { id: "coils",   name: "Tight coils" },
    { id: "afro",    name: "Afro" },
    { id: "fade",    name: "Short fade" },
    { id: "braids",  name: "Braids" },
    { id: "locs",    name: "Locs" },
    { id: "straight",name: "Straight" },
    { id: "buzz",    name: "Buzz cut" },
    { id: "none",    name: "None" }
  ];

  var HAIR_COLORS = [
    { id: "black",   hex: "#241A14", name: "Black" },
    { id: "darkbrn", hex: "#3A2419", name: "Dark brown" },
    { id: "brown",   hex: "#5B3A21", name: "Brown" },
    { id: "auburn",  hex: "#7E3B1E", name: "Auburn" },
    { id: "ginger",  hex: "#B5581F", name: "Ginger" },
    { id: "blond",   hex: "#D9A441", name: "Blond" },
    { id: "silver",  hex: "#BFC4CC", name: "Silver" },
    { id: "blue",    hex: "#2E7CC4", name: "Blue" },
    { id: "green",   hex: "#2F9E63", name: "Green" },
    { id: "pink",    hex: "#D8558F", name: "Pink" }
  ];

  var OUTFITS = [
    { id: "red",    hex: "#D8453C", name: "Red" },
    { id: "orange", hex: "#E8803A", name: "Orange" },
    { id: "gold",   hex: "#E9B53C", name: "Gold" },
    { id: "green",  hex: "#49A85C", name: "Green" },
    { id: "teal",   hex: "#2FA7A0", name: "Teal" },
    { id: "blue",   hex: "#3D7BD0", name: "Blue" },
    { id: "purple", hex: "#8A5BC8", name: "Purple" },
    { id: "pink",   hex: "#DD6AA2", name: "Pink" },
    { id: "slate",  hex: "#7A8699", name: "Slate" },
    { id: "white",  hex: "#EDEFF3", name: "White" }
  ];

  /* The old sprites were a pale face in a grey tunic. That stays the
     fallback ONLY for a save that predates this file; the picker opens
     on it and he changes it in two taps. */
  /* Will, 2026-10-02: Lennon is the default. Brown skin, curly hair, on
     every device from the first tap, before anyone opens the picker. The
     picker still changes all of it in two taps. */
  var DEFAULT = { skin: "#78462A", hair: "curly", hairColor: "#241A14", outfit: "#3D7BD0" };

  function clone(o) { var r = {}, k; for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k]; return r; }
  function isHex(v) { return typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v); }
  function knownHair(v) { for (var i = 0; i < HAIRS.length; i++) if (HAIRS[i].id === v) return true; return false; }

  var cache = null, listeners = [];

  function get() {
    if (cache) return clone(cache);
    var look = clone(DEFAULT);
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && typeof o === "object") {
          if (isHex(o.skin)) look.skin = o.skin;
          if (isHex(o.hairColor)) look.hairColor = o.hairColor;
          if (isHex(o.outfit)) look.outfit = o.outfit;
          if (knownHair(o.hair)) look.hair = o.hair;
        }
      }
    } catch (e) { /* storage blocked or corrupt: the default is a valid look */ }
    cache = look;
    return clone(look);
  }

  function set(partial) {
    var look = get();
    if (partial && typeof partial === "object") {
      if (isHex(partial.skin)) look.skin = partial.skin;
      if (isHex(partial.hairColor)) look.hairColor = partial.hairColor;
      if (isHex(partial.outfit)) look.outfit = partial.outfit;
      if (knownHair(partial.hair)) look.hair = partial.hair;
    }
    cache = look;
    try { localStorage.setItem(KEY, JSON.stringify(look)); } catch (e) { /* unsaved, still live this session */ }
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](clone(look)); } catch (e) { } }
    return clone(look);
  }

  function reset() { cache = null; try { localStorage.removeItem(KEY); } catch (e) { } return get(); }
  function onChange(fn) { if (typeof fn === "function") listeners.push(fn); }

  /* Heroes that are not people. Skin becomes body colour, hair is skipped. */
  var NON_HUMAN = { robot: 1, dragon: 1 };
  function isHuman(heroId) { return !NON_HUMAN[heroId]; }

  /* ---------------------------------------------------------------
     drawHair — paint hair on top of a head that a game has already
     drawn. (cx, cy) is the CENTRE of the head and r is its radius, so
     a game only has to know where its own head is.
     Everything is plain canvas paths: no images, nothing to load.
     --------------------------------------------------------------- */
  function drawHair(ctx, cx, cy, r, style, color) {
    if (!ctx || !r || style === "none") return;
    style = knownHair(style) ? style : "fade";
    color = isHex(color) ? color : DEFAULT.hairColor;
    ctx.save();
    ctx.fillStyle = color;

    function puff(x, y, rad) { ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill(); }
    function cap(top) {           /* the skull cap every style sits on */
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.02, Math.PI, Math.PI * 2);
      ctx.lineTo(cx + r * 1.02, cy - r * (top || 0.05));
      ctx.lineTo(cx - r * 1.02, cy - r * (top || 0.05));
      ctx.closePath();
      ctx.fill();
    }

    if (style === "curly" || style === "coils" || style === "afro") {
      var spread = style === "afro" ? 1.42 : (style === "coils" ? 1.14 : 1.26);
      var puffR  = style === "coils" ? r * 0.22 : r * 0.30;
      var ring   = style === "afro" ? 11 : 9;
      cap(0.02);
      for (var i = 0; i < ring; i++) {
        var a = Math.PI + (Math.PI * i) / (ring - 1);
        puff(cx + Math.cos(a) * r * spread * 0.86, cy + Math.sin(a) * r * spread * 0.86, puffR);
      }
      /* a second, tighter row so it reads as volume rather than a halo */
      for (var j = 0; j < ring - 2; j++) {
        var b = Math.PI + (Math.PI * (j + 0.5)) / (ring - 2);
        puff(cx + Math.cos(b) * r * spread * 0.55, cy + Math.sin(b) * r * spread * 0.55, puffR * 0.84);
      }
    } else if (style === "fade" || style === "buzz") {
      cap(style === "buzz" ? -0.04 : 0.04);
    } else if (style === "straight") {
      cap(0.06);
      ctx.beginPath();
      ctx.moveTo(cx - r * 1.02, cy - r * 0.04);
      ctx.quadraticCurveTo(cx - r * 1.16, cy + r * 0.95, cx - r * 0.72, cy + r * 1.02);
      ctx.lineTo(cx - r * 0.60, cy - r * 0.04);
      ctx.closePath(); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + r * 1.02, cy - r * 0.04);
      ctx.quadraticCurveTo(cx + r * 1.16, cy + r * 0.95, cx + r * 0.72, cy + r * 1.02);
      ctx.lineTo(cx + r * 0.60, cy - r * 0.04);
      ctx.closePath(); ctx.fill();
    } else if (style === "braids" || style === "locs") {
      cap(0.03);
      var n = style === "braids" ? 5 : 7;
      var len = style === "braids" ? r * 1.25 : r * 1.55;
      for (var k = 0; k < n; k++) {
        var t = n === 1 ? 0.5 : k / (n - 1);
        var x = cx + (t - 0.5) * r * 1.9;
        ctx.beginPath();
        ctx.lineWidth = r * (style === "braids" ? 0.26 : 0.18);
        ctx.strokeStyle = color;
        ctx.lineCap = "round";
        ctx.moveTo(x, cy - r * 0.1);
        ctx.quadraticCurveTo(x + (t - 0.5) * r * 0.5, cy + len * 0.6, x + (t - 0.5) * r * 0.9, cy + len);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* Seed the save the first time any game loads, so every game's "has he
     picked a look yet" check is true and he is drawn as himself from the
     start. A wipe (master reset) clears it; the next load seeds it again. */
  (function seed(){
    try { if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, JSON.stringify(clone(DEFAULT))); } catch (e) { /* storage blocked: get() still serves DEFAULT */ }
  })();

  window.HeroLook = {
    KEY: KEY,
    SKINS: SKINS, HAIRS: HAIRS, HAIR_COLORS: HAIR_COLORS, OUTFITS: OUTFITS,
    DEFAULT: clone(DEFAULT),
    get: get, set: set, reset: reset, onChange: onChange,
    isHuman: isHuman, drawHair: drawHair
  };
})();
