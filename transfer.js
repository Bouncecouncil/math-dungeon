/* =====================================================================
   TRANSFER — move one kid's whole arcade save between devices by hand
   ---------------------------------------------------------------------
   Drop-in: <script src="transfer.js"></script>. No dependencies, no
   network, no account, no server. Every read and write is wrapped, so a
   browser with storage blocked still loads this file and still renders
   the arcade; make() just reports that there is nothing to move.

   WHY A CODE AND NOT A LOGIN
   Progress lives in localStorage, which is per-browser. The iPad and the
   iPhone each keep their own collection. This turns the whole save into
   one printable string that can be read off one screen and typed (or
   copied / AirDropped / texted) into the other.

   API  window.Transfer
     keys()            -> the canonical progress key list (array of strings)
     scan()            -> { keys:[...], bytes:n, present:n } what is here now
     make()            -> a formatted code string, or "" when nothing is saved
     inspect(code)     -> { ok, reason?, message?, summary?, data? }
                          PURE: reads and validates, never writes anything.
                          summary = kid-plain counts for the confirm screen
     apply(code)       -> { ok, reason?, message?, written:[...], summary? }
                          Validates EVERYTHING first. One bad character and
                          nothing at all is written. On success the previous
                          save is stashed first, so undo() can walk it back.
     summarize()       -> kid-plain counts for THIS device
     canUndo()         -> true when a stash from a previous apply() exists
     undoInfo()        -> { ok, when, summary } about that stash
     undo()            -> put the pre-apply save back exactly as it was

   THE CODE
     MD1-XXXXX-XXXXX-...  Crockford base32 (no I, L, O or U, so 1/l/I and
     0/O cannot be confused), grouped in fives. A 32-bit FNV-1a checksum
     over the UNCOMPRESSED bytes rides inside, so a flipped character, a
     dropped group or a truncated paste is refused, not half-eaten.

   HOW IT IS BUILT
     {key: rawStringValue, ...}  ->  JSON  ->  UTF-8  ->  LZSS  ->  frame
     (version + length + checksum)  ->  base32  ->  groups of five.
     Values are carried as OPAQUE STRINGS. This file knows no game's data
     shape, so a game changing its save format cannot break the transfer.
   ===================================================================== */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (window.Transfer && window.Transfer.__v === 1) return;

  /* ---------------------------------------------------------------
     1. THE KEYS
     Confirmed by grepping every game file in this folder, not from
     memory. The explicit list is the contract; the prefix sweep is
     the safety net that picks up a key a game adds later.
     --------------------------------------------------------------- */
  var KEYS = [
    /* shared arcade spine */
    "mdWallet.v1",            /* coins, owned shop items, equipped slots  (wallet.js)      */
    "mdBrain.v1",             /* brain level, history, level-ups          (brain.js)       */
    "mathDungeonChar",        /* chosen hero        (index.html, math-dungeon-3d, shop)    */
    "mathDungeonSeen.v1",     /* anti-repeat question bag                 (math-bank.js)   */
    "mathDungeonAdapt.v1",    /* adaptive difficulty offset               (math-bank.js)   */
    /* the dungeon adventure */
    "mathDungeonBest",        /* best run                    (math-dungeon-3d.html)        */
    "mathDungeonDiff",        /* difficulty choice           (math-dungeon-3d.html)        */
    "mathDungeonView",        /* camera view                 (math-dungeon-3d.html)        */
    "mathDungeonCamTilt",     /* camera tilt                 (math-dungeon-3d.html)        */
    "mathDungeonWeap",        /* weapon pick                 (character-picker.html)       */
    "mathDungeonSword",       /* sword pick                  (sword-picker.html)           */
    /* pokemon sudoku: the collection */
    "pokeDex.v1",             /* every pokemon caught + the order          */
    "pokeCards.v1",           /* binder: lifetime copies + grade ladder    */
    "poke_type.v1",           /* type / binder view state                  */
    "poke_snd",               /* sound preference                          */
    /* the other rooms */
    "detBest",                /* detective room best                       */
    "snake_best", "snake_mute",
    "mm_best", "mm_book", "mm_prefs", "mm_mute",
    "potion_coins", "potion_unlocked", "potion_upgrades", "potion_mute",
    "crate_done", "crate_snd",
    "riddle_last", "riddle_mute",
    "rune_mute"
  ];
  /* any future key a game adds under one of these prefixes comes along too */
  var PREFIXES = ["mdWallet", "mdBrain", "mathDungeon", "poke", "snake_", "mm_",
                  "potion_", "crate_", "riddle_", "rune_", "det"];
  var BACKUP_KEY = "mdTransferBackup.v1";   /* our own stash: never transferred */

  var MAX_KEYS = 200;                 /* a sane ceiling on a pasted code   */
  var MAX_KEY_LEN = 80;
  var MAX_VALUE_LEN = 400000;         /* one value                         */
  var MAX_TOTAL = 2000000;            /* whole payload, uncompressed       */

  /* ---------------------------------------------------------------
     2. GUARDED STORAGE  (Safari private mode throws on every call)
     --------------------------------------------------------------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); return true; } catch (e) { return false; } }
  function lsKeys() {
    var out = [];
    try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k !== null) out.push(k); } }
    catch (e) { return []; }
    return out;
  }
  function storageWorks() {
    try { var p = "__mdt" + Date.now(); localStorage.setItem(p, "1"); localStorage.removeItem(p); return true; }
    catch (e) { return false; }
  }

  function isOurKey(k) {
    if (typeof k !== "string" || !k || k.length > MAX_KEY_LEN) return false;
    if (k === BACKUP_KEY) return false;
    if (KEYS.indexOf(k) !== -1) return true;
    for (var i = 0; i < PREFIXES.length; i++) if (k.indexOf(PREFIXES[i]) === 0) return true;
    return false;
  }

  /* every key we know about right now, canonical order first */
  function allKeys() {
    var out = KEYS.slice(), seen = {}, i;
    for (i = 0; i < out.length; i++) seen[out[i]] = 1;
    var live = lsKeys();
    for (i = 0; i < live.length; i++) {
      if (!seen[live[i]] && isOurKey(live[i])) { out.push(live[i]); seen[live[i]] = 1; }
    }
    return out;
  }

  /* ---------------------------------------------------------------
     3. UTF-8  (no TextEncoder dependency: older iPad Safari)
     --------------------------------------------------------------- */
  function utf8Encode(str) {
    var out = [], i, c, c2;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length &&
               (c2 = str.charCodeAt(i + 1)) >= 0xDC00 && c2 <= 0xDFFF) {
        var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00); i++;
        out.push(0xF0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      } else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return out;
  }
  function utf8Decode(bytes) {
    var out = "", i = 0, n = bytes.length, b, cp;
    while (i < n) {
      b = bytes[i++];
      if (b < 0x80) cp = b;
      else if (b < 0xE0) { if (i >= n) return null; cp = ((b & 31) << 6) | (bytes[i++] & 63); }
      else if (b < 0xF0) { if (i + 1 >= n) return null; cp = ((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63); }
      else { if (i + 2 >= n) return null; cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63); }
      if (cp > 0xFFFF) { cp -= 0x10000; out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 1023)); }
      else out += String.fromCharCode(cp);
    }
    return out;
  }

  /* ---------------------------------------------------------------
     4. LZSS  — small, synchronous, no library. JSON full of repeated
        key names and id patterns squeezes hard.
        Token stream: a flag byte carries 8 flags, LSB first.
          flag 0 -> one literal byte
          flag 1 -> [len-MIN][offsetHi][offsetLo]  (3 bytes)
        MIN 4 / MAX 259, offset 1..65535, so a match always pays.
     --------------------------------------------------------------- */
  var MIN_MATCH = 4, MAX_MATCH = 259, MAX_OFF = 65535, CHAIN = 96;

  function lzCompress(src) {
    var n = src.length, out = [], pos = 0;
    var head = {}, prev = new Int32Array(n > 0 ? n : 1);
    var flagAt = -1, flagBit = 8, i;
    function key4(p) { return src[p] << 24 | src[p + 1] << 16 | src[p + 2] << 8 | src[p + 3]; }
    function pushFlag(bit) {
      if (flagBit === 8) { flagAt = out.length; out.push(0); flagBit = 0; }
      if (bit) out[flagAt] |= (1 << flagBit);
      flagBit++;
    }
    while (pos < n) {
      var bestLen = 0, bestOff = 0;
      if (pos + MIN_MATCH <= n) {
        var h = key4(pos), cand = head[h], walked = 0;
        while (cand !== undefined && cand >= 0 && walked < CHAIN) {
          var off = pos - cand;
          if (off > MAX_OFF) break;
          if (src[cand + bestLen] === src[pos + bestLen]) {   /* cheap reject */
            var l = 0, cap = Math.min(MAX_MATCH, n - pos);
            while (l < cap && src[cand + l] === src[pos + l]) l++;
            if (l > bestLen) { bestLen = l; bestOff = off; if (l >= cap) break; }
          }
          cand = prev[cand]; walked++;
        }
      }
      if (bestLen >= MIN_MATCH) {
        pushFlag(1);
        out.push(bestLen - MIN_MATCH, (bestOff >> 8) & 255, bestOff & 255);
      } else {
        bestLen = 1;
        pushFlag(0);
        out.push(src[pos]);
      }
      /* index every position we just consumed, so later matches can find them */
      for (i = 0; i < bestLen; i++) {
        var p = pos + i;
        if (p + MIN_MATCH <= n) { var hk = key4(p); prev[p] = (head[hk] === undefined ? -1 : head[hk]); head[hk] = p; }
      }
      pos += bestLen;
    }
    return out;
  }

  function lzDecompress(src, expectLen) {
    var out = new Array(expectLen), o = 0, i = 0, n = src.length;
    var flags = 0, flagsLeft = 0;
    while (o < expectLen) {
      if (flagsLeft === 0) {
        if (i >= n) return null;
        flags = src[i++]; flagsLeft = 8;
      }
      var isMatch = flags & 1; flags >>= 1; flagsLeft--;
      if (isMatch) {
        if (i + 2 >= n) return null;
        var len = src[i] + MIN_MATCH; i++;
        var off = (src[i] << 8) | src[i + 1]; i += 2;
        if (off <= 0 || off > o) return null;          /* points outside output */
        if (o + len > expectLen) return null;          /* would overrun          */
        var from = o - off;
        for (var j = 0; j < len; j++) out[o++] = out[from + j];
      } else {
        if (i >= n) return null;
        out[o++] = src[i++];
      }
    }
    if (o !== expectLen) return null;
    return out;
  }

  /* ---------------------------------------------------------------
     5. CHECKSUM — FNV-1a 32-bit over the uncompressed bytes
     --------------------------------------------------------------- */
  function fnv1a(bytes) {
    var h = 0x811c9dc5;
    for (var i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  /* ---------------------------------------------------------------
     6. BASE32 (Crockford) — no I, L, O or U. 1/I/l and 0/O collapse
        on the way in, so a kid reading a screen cannot get it wrong.
     --------------------------------------------------------------- */
  var ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  var UNALPHA = (function () {
    var m = {}, i;
    for (i = 0; i < ALPHA.length; i++) { m[ALPHA.charAt(i)] = i; }
    m["I"] = 1; m["L"] = 1; m["O"] = 0;        /* the classic look-alikes */
    return m;                                   /* U is not a code letter at all */
  })();

  function b32Encode(bytes) {
    var out = "", bits = 0, val = 0, i;
    for (i = 0; i < bytes.length; i++) {
      val = (val << 8) | bytes[i]; bits += 8;
      while (bits >= 5) { out += ALPHA.charAt((val >>> (bits - 5)) & 31); bits -= 5; }
    }
    if (bits > 0) out += ALPHA.charAt((val << (5 - bits)) & 31);
    return out;
  }
  function b32Decode(str) {
    var out = [], bits = 0, val = 0, i, c, d;
    for (i = 0; i < str.length; i++) {
      c = str.charAt(i);
      d = UNALPHA[c];
      if (d === undefined) return null;
      val = (val << 5) | d; bits += 5;
      if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
    }
    return out;
  }

  /* ---------------------------------------------------------------
     7. FRAME  [ver:1][len:4 BE][sum:4 BE][lz bytes...]
     --------------------------------------------------------------- */
  var VER = 1, PREFIX = "MD1", GROUP = 5;

  function be32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function rd32(b, at) { return (((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3]) >>> 0; }

  function group(s) {
    var parts = [];
    for (var i = 0; i < s.length; i += GROUP) parts.push(s.substr(i, GROUP));
    return PREFIX + "-" + parts.join("-");
  }
  /* strip everything that is not a code character: spaces, dashes, newlines,
     the MD1 prefix, and a stray "MD1-" a kid pasted twice */
  function tidy(raw) {
    var s = String(raw == null ? "" : raw).toUpperCase();
    s = s.replace(/[^0-9A-Z]/g, "");
    var had = false;
    while (s.indexOf(PREFIX) === 0) { s = s.slice(PREFIX.length); had = true; }
    return { body: s, prefixed: had };
  }

  /* ---------------------------------------------------------------
     8. READ THIS DEVICE
     --------------------------------------------------------------- */
  function collect() {
    var ks = allKeys(), data = {}, bytes = 0, present = 0, hit = [];
    for (var i = 0; i < ks.length; i++) {
      var v = lsGet(ks[i]);
      if (v === null) continue;
      if (typeof v !== "string") v = String(v);
      if (v.length > MAX_VALUE_LEN) continue;         /* absurd: skip, never truncate */
      data[ks[i]] = v; present++; bytes += ks[i].length + v.length; hit.push(ks[i]);
    }
    return { data: data, keys: hit, bytes: bytes, present: present };
  }

  /* ---------------------------------------------------------------
     9. KID-PLAIN SUMMARY — how many pokemon, how many coins, what
        level. Every reach into a save shape is wrapped, because a
        game may legitimately change it; a summary that cannot be read
        just says "some" instead of breaking the panel.
     --------------------------------------------------------------- */
  function countKeys(o) { var n = 0, k; for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) n++; return n; }

  function summarize(data) {
    var s = { pokemon: null, cards: null, coins: null, level: null, hero: null, items: null, keys: 0 };
    try { s.keys = countKeys(data); } catch (e) { }
    try {
      var d = JSON.parse(data["pokeDex.v1"] || "null");
      if (d && d.caught && typeof d.caught === "object") s.pokemon = countKeys(d.caught);
    } catch (e) { }
    try {
      var c = JSON.parse(data["pokeCards.v1"] || "null");
      if (c && c.cards && typeof c.cards === "object") {
        var tot = 0, k;
        for (k in c.cards) if (Object.prototype.hasOwnProperty.call(c.cards, k)) {
          var n = Number(c.cards[k] && c.cards[k].c); if (isFinite(n) && n > 0) tot += n;
        }
        s.cards = tot;
      }
    } catch (e) { }
    try {
      var w = JSON.parse(data["mdWallet.v1"] || "null");
      if (w) {
        if (isFinite(Number(w.coins))) s.coins = Math.max(0, Math.floor(Number(w.coins)));
        if (Object.prototype.toString.call(w.owned) === "[object Array]") s.items = w.owned.length;
      }
    } catch (e) { }
    try {
      var b = JSON.parse(data["mdBrain.v1"] || "null");
      if (b && isFinite(Number(b.level))) s.level = Math.floor(Number(b.level));
    } catch (e) { }
    try { if (typeof data["mathDungeonChar"] === "string" && data["mathDungeonChar"]) s.hero = data["mathDungeonChar"]; } catch (e) { }
    return s;
  }

  /* ---------------------------------------------------------------
     10. MAKE
     --------------------------------------------------------------- */
  function make() {
    try {
      var got = collect();
      if (got.present === 0) return "";
      var json = JSON.stringify(got.data);
      var raw = utf8Encode(json);
      if (raw.length > MAX_TOTAL) return "";
      var lz = lzCompress(raw);
      var frame = [VER].concat(be32(raw.length), be32(fnv1a(raw)), lz);
      var code = group(b32Encode(frame));
      /* belt and braces: a code this device cannot read back is not a code */
      var back = inspect(code);
      if (!back.ok) return "";
      return code;
    } catch (e) { return ""; }
  }

  /* ---------------------------------------------------------------
     11. INSPECT — the whole validator. Writes NOTHING, ever.
         Every failure carries a message a 7-year-old can act on.
     --------------------------------------------------------------- */
  var MSG = {
    empty:    "Paste the code from the other device first.",
    chars:    "That does not look like one of our codes. It should start with MD1.",
    tooshort: "That code is too short. Some of it is missing, so copy the whole thing.",
    unpack:   "That code did not open. A letter is wrong, or a piece is missing.",
    version:  "That code came from a different version of the arcade.",
    broken:   "That code is damaged. Something got typed wrong or cut off. Nothing was changed.",
    shape:    "That code opened, but what is inside is not a save file.",
    big:      "That code is too big to be one of ours.",
    nothing:  "That code has no games in it."
  };

  function fail(reason) { return { ok: false, reason: reason, message: MSG[reason] || MSG.broken }; }

  function inspect(code) {
    try {
      var t = tidy(code), s = t.body;
      if (!s && !t.prefixed) return fail("empty");
      if (!t.prefixed) return fail("chars");       /* every real code starts MD1 */
      if (!s) return fail("tooshort");
      if (!/^[0-9A-Z]+$/.test(s)) return fail("chars");
      for (var ci = 0; ci < s.length; ci++) if (UNALPHA[s.charAt(ci)] === undefined) return fail("chars");
      if (s.length < 16) return fail("tooshort");

      var bytes = b32Decode(s);
      if (!bytes || bytes.length < 9) return fail("tooshort");
      if (bytes[0] !== VER) return fail("version");

      var len = rd32(bytes, 1), sum = rd32(bytes, 5);
      if (!isFinite(len) || len <= 0) return fail("broken");
      if (len > MAX_TOTAL) return fail("big");

      var body = bytes.slice(9);
      var raw = lzDecompress(body, len);
      if (!raw) return fail("unpack");
      if (fnv1a(raw) !== sum) return fail("broken");

      var json = utf8Decode(raw);
      if (json === null) return fail("broken");

      var obj;
      try { obj = JSON.parse(json); } catch (e) { return fail("broken"); }
      if (!obj || typeof obj !== "object" || Object.prototype.toString.call(obj) === "[object Array]") return fail("shape");

      /* every entry must be a plain string under a key we recognise */
      var clean = {}, n = 0, k;
      for (k in obj) {
        if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
        if (typeof k !== "string" || !k || k.length > MAX_KEY_LEN) return fail("shape");
        if (typeof obj[k] !== "string") return fail("shape");
        if (obj[k].length > MAX_VALUE_LEN) return fail("shape");
        if (!isOurKey(k)) return fail("shape");
        clean[k] = obj[k]; n++;
        if (n > MAX_KEYS) return fail("big");
      }
      if (n === 0) return fail("nothing");

      return { ok: true, data: clean, keys: Object.keys(clean), summary: summarize(clean) };
    } catch (e) { return fail("broken"); }
  }

  /* ---------------------------------------------------------------
     12. APPLY — validate the whole thing, stash the old save, then
         write. Nothing is written until every check has passed.
     --------------------------------------------------------------- */
  function apply(code) {
    var look = inspect(code);
    if (!look.ok) return look;
    if (!storageWorks()) {
      return { ok: false, reason: "nostorage",
               message: "This browser will not let the arcade save anything, so the code cannot be used here." };
    }
    try {
      /* stash EVERY key we are about to touch plus everything we own now,
         with null meaning "was not there", so undo is exact */
      var touch = {}, i, k;
      var mine = allKeys();
      for (i = 0; i < mine.length; i++) touch[mine[i]] = 1;
      for (i = 0; i < look.keys.length; i++) touch[look.keys[i]] = 1;

      var before = {};
      for (k in touch) if (Object.prototype.hasOwnProperty.call(touch, k)) before[k] = lsGet(k);

      var stash = JSON.stringify({ v: 1, t: Date.now(), data: before, summary: summarize(collect().data) });
      if (!lsSet(BACKUP_KEY, stash)) {
        return { ok: false, reason: "nobackup",
                 message: "There is no room to save a backup first, so nothing was changed. Free up some space and try again." };
      }

      /* write: the code is the truth. A key the code does not carry but
         this device has is cleared, so the two devices really do match. */
      var written = [], cleared = [];
      for (k in touch) {
        if (!Object.prototype.hasOwnProperty.call(touch, k)) continue;
        if (Object.prototype.hasOwnProperty.call(look.data, k)) { if (lsSet(k, look.data[k])) written.push(k); }
        else if (before[k] !== null) { lsDel(k); cleared.push(k); }
      }
      return { ok: true, written: written, cleared: cleared, summary: look.summary };
    } catch (e) {
      return { ok: false, reason: "broken", message: MSG.broken };
    }
  }

  /* ---------------------------------------------------------------
     13. UNDO
     --------------------------------------------------------------- */
  function readStash() {
    try {
      var s = JSON.parse(lsGet(BACKUP_KEY) || "null");
      if (!s || typeof s !== "object" || !s.data || typeof s.data !== "object") return null;
      return s;
    } catch (e) { return null; }
  }
  function canUndo() { return !!readStash(); }
  function undoInfo() {
    var s = readStash();
    if (!s) return { ok: false };
    return { ok: true, when: Number(s.t) || 0, summary: s.summary || null };
  }
  function undo() {
    var s = readStash();
    if (!s) return { ok: false, reason: "none", message: "There is nothing to undo on this device." };
    try {
      var restored = [], k, v;
      for (k in s.data) {
        if (!Object.prototype.hasOwnProperty.call(s.data, k)) continue;
        if (!isOurKey(k)) continue;
        v = s.data[k];
        if (v === null || v === undefined) lsDel(k);
        else if (typeof v === "string") { lsSet(k, v); }
        else continue;
        restored.push(k);
      }
      lsDel(BACKUP_KEY);
      return { ok: true, restored: restored };
    } catch (e) {
      return { ok: false, reason: "broken", message: "The undo did not finish. Nothing else was changed." };
    }
  }

  /* --------------------------------------------------------------- */
  window.Transfer = {
    __v: 1,
    keys: function () { return KEYS.slice(); },
    scan: function () { var g = collect(); return { keys: g.keys, bytes: g.bytes, present: g.present }; },
    make: make,
    inspect: inspect,
    apply: apply,
    summarize: function () { try { return summarize(collect().data); } catch (e) { return summarize({}); } },
    canUndo: canUndo,
    undoInfo: undoInfo,
    undo: undo,
    storageWorks: storageWorks,
    backupKey: BACKUP_KEY
  };
})();
