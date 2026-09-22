/* =====================================================================
   BRAIN LEVEL — one math level shared by EVERY game in the arcade
   ---------------------------------------------------------------------
   Drop-in: <script src="brain.js"></script>, placed AFTER math-bank.js
   (and story-bank.js) when the page has them. Works on pages with no
   MathBank at all (the arcade main screen, the shop): then it only
   stores and reports the level.

   THE LADDER climbs past 2nd grade on purpose (Lennon already knows his
   tables). Each rung maps to a MathBank tier and a hand-picked set of
   MathBank families, so "Level 5" means the same thing in every game.

   CLIMBING RULE
     up    8 right out of his last 10 answers at this level -> next level
     down  a BAD RUN (6 wrong out of the last 8) drops ONE level, and:
           - he never drops below (highest level reached this session - 1),
             so a run of wrong answers costs at most one level
           - at the level he started this session on, one bad run only
             "wobbles" (warning, no drop); it takes a second bad run
     A session is a stretch of play with no gap longer than 3 hours, so
     walking from one game to the next is the same session.

   MATHBANK HOOK (math-bank.js itself is never edited)
     MathBank.ask(tier, opts)
       - opts.only or opts.rawTier given -> passed through UNCHANGED
         (reading, spelling, vocab rooms depend on this)
       - opts.brain === false           -> passed through unchanged
       - otherwise -> the question comes from the brain level's tier and
         families. opts.exclude / short / maxAns / minAns still apply; if
         the level cannot satisfy maxAns (tiny door plates) it falls back
         to the original call so nothing ever overflows.
     MathBank.record(ok, kind)
       - still feeds the bank's own adaptive tier, AND feeds the brain.
         Reading / spelling / vocab / science / logic kinds are tallied
         but never move the MATH level.

   API  window.Brain
     level()        -> 1..8
     name()         -> "Times tables to 10"
     progress()     -> { level, name, right, need, of, pct, next, max, wobble }
     record(ok, skill) -> feed an answer (skill = family id, optional)
     tierForMath()  -> MathBank tier (1..6) for this level
     families()     -> MathBank family ids for this level
     ladder()       -> the whole ladder [{ n, name, tier, fams }]
     set(n)         -> grown-up override (starts a fresh session there)
     reset()        -> back to the default start level, history wiped
     onChange(fn)   -> fn({ type:"up"|"down"|"wobble"|"progress"|"set"|"reset"|"sync", level, name, progress })
                       returns an unsubscribe function
     hookMathBank() -> (re)attach to MathBank; safe to call repeatedly
   Set window.BRAIN_NO_TOAST = true before this script to silence the
   small "LEVEL UP" banner it shows by itself.
   ===================================================================== */
(function () {
  "use strict";
  if (typeof window === "undefined") return;
  if (window.Brain && window.Brain.__v === 1) { try { window.Brain.hookMathBank(); } catch (e) { } return; }

  var KEY = "mdBrain.v1";
  var START_LEVEL = 3;            // he already knows his tables to 5; start at "to 10"
  var WINDOW = 10, NEED = 8;      // 8 right out of the last 10 -> level up
  var BAD_OF = 8, BAD_WRONG = 6;  // 6 wrong out of the last 8 -> a bad run
  var SESSION_GAP = 3 * 60 * 60 * 1000;

  /* ---------------- the ladder ---------------- */
  var LADDER = [
    null,
    { n: 1, name: "Adding & taking away", tier: 2,
      fams: ["add2", "sub2", "addChain", "bond", "missingAddend", "missingSubtrahend", "tenMore", "seqAdd", "seqSub", "coins", "wordDiffThen"],
      short: ["add2", "sub2", "addChain", "bond", "missingAddend", "missingSubtrahend", "tenMore", "seqAdd", "seqSub"] },
    { n: 2, name: "Times tables to 5", tier: 1,
      fams: ["mulTable", "missingFactor", "arrayGrid", "wordGroups", "mulBy10", "square", "seqAdd"],
      short: ["mulTable", "missingFactor", "mulBy10", "square", "seqAdd"] },
    { n: 3, name: "Times tables to 10", tier: 3,
      fams: ["mulTable", "missingFactor", "arrayGrid", "wordGroups", "square", "mulBy10", "compare", "costTotal"],
      short: ["mulTable", "missingFactor", "square", "mulBy10"] },
    { n: 4, name: "Times tables to 12 + sharing", tier: 4,
      fams: ["mulTable", "missingFactor", "divExact", "share", "timesAsMany", "factorPair", "arrayGrid", "unitRate"],
      short: ["mulTable", "missingFactor", "divExact", "timesAsMany"] },
    { n: 5, name: "Two-digit times one-digit + remainders", tier: 4,
      fams: ["mul2x1", "divRemainder", "wordRemainder", "costTotal", "wordCompare", "divExact"],
      short: ["mul2x1", "divExact", "missingFactor", "timesAsMany"] },
    { n: 6, name: "Fractions of a set + two-step problems", tier: 5,
      fams: ["fracOfSet", "fracMulti", "wordTwoStep", "wordDiffThen", "unitRate", "wordCompare"],
      short: ["mul2x1", "divExact", "missingFactor", "seqDouble"] },
    { n: 7, name: "Two-digit times two-digit + long division", tier: 6,
      fams: ["mul2x2", "divExact", "divRemainder", "unitRate", "factorPair", "wordRemainder"],
      short: ["mul2x2", "divExact", "missingFactor", "mul2x1"] },
    { n: 8, name: "Mixed challenge", tier: 6,
      fams: ["mul2x2", "mul2x1", "divRemainder", "divExact", "missingFactor", "compare", "fracMulti", "unitRate",
             "wordTwoStep", "wordDiffThen", "wordRemainder", "wordCompare", "elapsed", "measure", "share",
             "square", "factorPair", "round", "subChain", "seqDouble", "change", "area"],
      short: ["mul2x2", "mul2x1", "divExact", "missingFactor", "square", "round", "subChain", "seqDouble"] }
  ];
  var MAX = LADDER.length - 1;

  /* kinds that belong to story-bank.js (reading/spelling/etc): never move the math level */
  var NON_MATH = { reading: 1, spellEasy: 1, spellHard: 1, vocabEasy: 1, vocabHard: 1, science: 1,
                   oddOneOut: 1, riddle: 1, pattern: 1, letterSeq: 1, spelling: 1, spell: 1, vocab: 1, logic: 1 };

  /* ---------------- state ---------------- */
  function fresh() {
    return { v: 1, level: START_LEVEL, start: START_LEVEL, peak: START_LEVEL, wobble: false,
             hist: [], right: 0, wrong: 0, other: { right: 0, wrong: 0 }, last: 0, ups: [] };
  }
  function clampLevel(n) { n = Math.round(Number(n)); return isFinite(n) ? Math.max(1, Math.min(MAX, n)) : START_LEVEL; }
  function load() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (e) { s = null; }
    if (!s || typeof s !== "object") return fresh();
    var d = fresh();
    d.level = clampLevel(s.level);
    d.start = clampLevel(s.start == null ? d.level : s.start);
    d.peak = clampLevel(s.peak == null ? d.level : s.peak);
    d.wobble = !!s.wobble;
    d.hist = Array.isArray(s.hist) ? s.hist.filter(function (x) { return x === 0 || x === 1; }).slice(-WINDOW) : [];
    d.right = Math.max(0, s.right | 0); d.wrong = Math.max(0, s.wrong | 0);
    if (s.other && typeof s.other === "object") { d.other.right = Math.max(0, s.other.right | 0); d.other.wrong = Math.max(0, s.other.wrong | 0); }
    d.last = Number(s.last) || 0;
    d.ups = Array.isArray(s.ups) ? s.ups.slice(-30) : [];
    return d;
  }
  var S = load();
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode: play on without saving */ } }

  /* a new session starts after a long break: the level he walks in with is his floor anchor */
  function touchSession() {
    var now = Date.now();
    if (!S.last || now - S.last > SESSION_GAP) { S.start = S.level; S.peak = S.level; S.wobble = false; }
    S.last = now;
  }

  /* ---------------- listeners ---------------- */
  var subs = [];
  function emit(type) {
    var ev = { type: type, level: S.level, name: LADDER[S.level].name, progress: progress() };
    subs.slice().forEach(function (fn) { try { fn(ev); } catch (e) { /* a bad listener never breaks the game */ } });
    if (type === "up" || type === "down") toast(type);
  }
  function onChange(fn) {
    if (typeof fn !== "function") return function () { };
    subs.push(fn);
    return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  }
  /* another tab / the game in an iframe changed the level: stay in step */
  try {
    window.addEventListener("storage", function (e) {
      if (e.key !== KEY) return;
      var before = S.level; S = load();
      emit(S.level !== before ? "sync" : "progress");
    });
  } catch (e) { }
  /* back-button / tab-switch return: the page may have been frozen while another game played */
  function refresh() { var before = S.level; S = load(); emit(S.level !== before ? "sync" : "progress"); return S.level; }
  try {
    window.addEventListener("pageshow", function (e) { if (e.persisted) refresh(); });
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") refresh(); });
  } catch (e) { }

  /* ---------------- reading the level ---------------- */
  function level() { return S.level; }
  function name() { return LADDER[S.level].name; }
  function tierForMath() { return LADDER[S.level].tier; }
  function families() { return LADDER[S.level].fams.slice(); }
  function progress() {
    var right = 0; for (var i = 0; i < S.hist.length; i++) right += S.hist[i];
    var max = S.level >= MAX;
    return { level: S.level, name: LADDER[S.level].name, right: right, need: NEED, of: WINDOW,
             answered: S.hist.length, pct: max ? 1 : Math.min(1, right / NEED), max: max,
             next: max ? null : LADDER[S.level + 1].name, wobble: S.wobble,
             totalRight: S.right, totalWrong: S.wrong };
  }
  function ladder() { return LADDER.slice(1).map(function (l) { return { n: l.n, name: l.name, tier: l.tier, fams: l.fams.slice() }; }); }

  /* ---------------- the climbing rule ---------------- */
  function record(ok, skill) {
    ok = !!ok;
    try {
      touchSession();
      if (skill && NON_MATH[skill]) {
        ok ? S.other.right++ : S.other.wrong++;
        save(); return S.level;
      }
      ok ? S.right++ : S.wrong++;
      S.hist.push(ok ? 1 : 0);
      if (S.hist.length > WINDOW) S.hist = S.hist.slice(-WINDOW);

      var right = 0; for (var i = 0; i < S.hist.length; i++) right += S.hist[i];
      var tail = S.hist.slice(-BAD_OF), wrongTail = 0;
      for (var j = 0; j < tail.length; j++) wrongTail += tail[j] ? 0 : 1;

      var type = "progress";
      // five right in a row after a wobble: the warning is forgiven
      if (S.wobble && S.hist.length >= 5 && S.hist.slice(-5).join("") === "11111") S.wobble = false;
      if (ok && right >= NEED && S.level < MAX) {
        S.level++; S.hist = []; S.wobble = false;
        if (S.level > S.peak) S.peak = S.level;
        S.ups.push({ t: Date.now(), level: S.level });
        if (S.ups.length > 30) S.ups = S.ups.slice(-30);
        type = "up";
      } else if (!ok && tail.length >= BAD_OF && wrongTail >= BAD_WRONG) {
        var floor = Math.max(1, S.peak - 1);
        S.hist = [];
        if (S.level <= floor) {
          type = "wobble";                                   // already as low as he can go this session
        } else if (S.level === S.start && S.peak === S.start && !S.wobble) {
          S.wobble = true; type = "wobble";                  // first bad run at his start level: warning only
        } else {
          S.level--; S.wobble = false; type = "down";
        }
      }
      save();
      emit(type);
    } catch (e) { /* never let bookkeeping break a game */ }
    return S.level;
  }

  function set(n) {
    S.level = clampLevel(n); S.start = S.level; S.peak = S.level; S.wobble = false; S.hist = []; S.last = Date.now();
    save(); emit("set"); return S.level;
  }
  function reset() { S = fresh(); S.last = Date.now(); save(); emit("reset"); return S.level; }

  /* ---------------- a tiny self-contained level-up banner ---------------- */
  function toast(type) {
    if (window.BRAIN_NO_TOAST) return;
    try {
      if (!document.body) return;
      var el = document.getElementById("mdBrainToast");
      if (!el) {
        el = document.createElement("div");
        el.id = "mdBrainToast";
        el.style.cssText = "position:fixed;left:50%;top:44px;transform:translateX(-50%) scale(.9);z-index:10000;" +
          "pointer-events:none;opacity:0;transition:opacity .25s,transform .25s;max-width:92vw;text-align:center;" +
          "font:900 16px/1.25 'Avenir Next','Trebuchet MS',Verdana,sans-serif;color:#2a1f00;background:#ffd23f;" +
          "border:3px solid #fff3b0;border-radius:14px;padding:9px 16px;box-shadow:0 6px 24px rgba(0,0,0,.5);";
        document.body.appendChild(el);
      }
      el.textContent = type === "up"
        ? "\u{1F9E0} BRAIN LEVEL UP! Level " + S.level + ": " + LADDER[S.level].name
        : "\u{1F9E0} Practice time: Level " + S.level + ": " + LADDER[S.level].name;
      el.style.background = type === "up" ? "#ffd23f" : "#8fe9ff";
      el.style.opacity = "1"; el.style.transform = "translateX(-50%) scale(1)";
      clearTimeout(toast._t);
      toast._t = setTimeout(function () { el.style.opacity = "0"; el.style.transform = "translateX(-50%) scale(.9)"; }, 2600);
    } catch (e) { }
  }

  /* ---------------- MathBank hook (no edits to math-bank.js) ---------------- */
  function bank() {
    try { if (typeof MathBank !== "undefined" && MathBank) return MathBank; } catch (e) { }
    return window.MathBank || null;
  }
  function hookMathBank() {
    var MB = bank();
    if (!MB || typeof MB.ask !== "function" || typeof MB.record !== "function") return false;
    if (MB.__brainHooked) return true;
    var origAsk = MB.ask, origRecord = MB.record;

    function known(list) {
      var fams = null;
      try { fams = MB.families; } catch (e) { fams = null; }
      if (!Array.isArray(fams)) return list.slice();
      return list.filter(function (k) { return fams.indexOf(k) !== -1; });
    }

    MB.ask = function (tier, opts) {
      var o = opts || {};
      var forced = (o.only && o.only.length) || o.rawTier || o.brain === false;
      if (forced) return origAsk.call(MB, tier, opts);
      try {
        var L = LADDER[S.level];
        var pool = known(o.short ? L.short : L.fams);
        if (pool.length < 1) return origAsk.call(MB, tier, opts);
        if (o.exclude && o.exclude.length) {
          var f = pool.filter(function (k) { return o.exclude.indexOf(k) === -1; });
          if (f.length >= 1) pool = f;
        }
        var mine = {};
        for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) mine[k] = o[k];
        mine.only = pool; mine.rawTier = true; delete mine.exclude; delete mine.short;
        var r = origAsk.call(MB, L.tier, mine);
        // a small plate (maxAns) that this level cannot fit: fall back to the caller's own request
        if (!r || (typeof r.a === "number" && ((o.maxAns && r.a > o.maxAns) || (o.minAns && r.a < o.minAns)))) {
          return origAsk.call(MB, tier, opts);
        }
        r.brainLevel = S.level;
        return r;
      } catch (e) {
        return origAsk.call(MB, tier, opts);
      }
    };
    MB.record = function (ok, kind) {
      var out;
      try { out = origRecord.apply(MB, arguments); } finally { record(ok, kind); }
      return out;
    };
    MB.__brainHooked = true;
    MB.__brainOrigAsk = origAsk;
    MB.__brainOrigRecord = origRecord;
    return true;
  }

  window.Brain = {
    __v: 1,
    level: level, name: name, progress: progress, record: record,
    tierForMath: tierForMath, families: families, ladder: ladder,
    set: set, reset: reset, refresh: refresh, onChange: onChange, hookMathBank: hookMathBank
  };

  touchSession(); save();
  /* hook now if math-bank.js is already on the page, else try again once the page is parsed */
  if (!hookMathBank()) {
    try {
      document.addEventListener("DOMContentLoaded", hookMathBank);
      window.addEventListener("load", hookMathBank);
    } catch (e) { }
  }
})();
