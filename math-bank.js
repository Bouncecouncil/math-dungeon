/* =====================================================================
   MATH DUNGEON — PROBLEM ARSENAL
   ---------------------------------------------------------------------
   Replaces the old hand-rolled times-table generator, which shipped
   roughly five shapes (a x b, a / b, missing factor, "times as many",
   one word problem). A kid who has memorised the tables answers all of
   those from recall, so the game stopped being math and became typing.

   This bank has 40 problem FAMILIES across 6 difficulty tiers, an
   anti-repeat bag so the same exact problem does not come back for a
   long time, and an adaptive tier that climbs when he is right and
   backs off when he is wrong. It hunts for the edge of what he knows.

   Every family returns { q, a, kind, sig, hint }:
     q    - the question text (may contain safe HTML)
     a    - the answer, ALWAYS a positive integer (the choice builder
            in the game needs integers to make plausible distractors)
     kind - family id, used for tier tables and telemetry
     sig  - stable signature, used by the anti-repeat bag
     hint - one short line shown after a wrong answer

   Public API:
     MathBank.ask(tier, opts)   -> problem object
     MathBank.record(ok)        -> feed the adaptive tier
     MathBank.tierFor(base)     -> base tier + adaptive offset, clamped
     MathBank.stats()           -> { seen, streak, offset, byKind }
     MathBank.reset()           -> wipe the seen bag (new player)
   ===================================================================== */
const MathBank = (function () {
  "use strict";

  /* ---------- small helpers ---------- */
  const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const pk = a => a[Math.floor(Math.random() * a.length)];
  const shuf = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
  const money = c => (c >= 100 ? "$" + (c / 100).toFixed(2) : c + "¢");
  const clock = m => { const h = Math.floor(m / 60) % 12 || 12; const mm = String(m % 60).padStart(2, "0"); return h + ":" + mm; };
  const A = s => "<span class='accent'>" + s + "</span>";

  /* dungeon flavour so the word problems belong to THIS game */
  const THINGS = [
    { one: "gem",     many: "gems",     emo: "💎" },
    { one: "coin",    many: "coins",    emo: "🪙" },
    { one: "potion",  many: "potions",  emo: "🧪" },
    { one: "torch",   many: "torches",  emo: "🔥" },
    { one: "key",     many: "keys",     emo: "🗝️" },
    { one: "scroll",  many: "scrolls",  emo: "📜" },
    { one: "shield",  many: "shields",  emo: "🛡️" },
    { one: "arrow",   many: "arrows",   emo: "🏹" },
    { one: "skull",   many: "skulls",   emo: "💀" },
    { one: "crystal", many: "crystals", emo: "🔮" }
  ];
  const HOLDERS = [
    { one: "chest", many: "chests" }, { one: "sack", many: "sacks" },
    { one: "shelf", many: "shelves" }, { one: "crate", many: "crates" },
    { one: "vault", many: "vaults" }, { one: "pouch", many: "pouches" }
  ];
  const HEROES = ["heroes", "knights", "explorers", "wizards", "goblins", "dragons"];

  /* =================================================================
     THE FAMILIES
     Each is fn(t) where t = 1..6 difficulty. Higher t = bigger numbers
     and nastier regrouping, NOT a different concept, so a kid never
     meets a topic he has not seen at a lower tier first.
     ================================================================= */
  const F = {};

  /* ---- addition & subtraction ---- */
  F.add2 = t => {
    const hi = [19, 49, 99, 199, 499, 999][t - 1];
    const a = ri(hi > 99 ? 100 : 11, hi), b = ri(hi > 99 ? 100 : 11, hi);
    return { q: a + " + " + b + " = ?", a: a + b, hint: "Add the ones first, then the tens." };
  };
  F.sub2 = t => {
    const hi = [19, 49, 99, 199, 499, 999][t - 1];
    let a = ri(hi > 99 ? 120 : 12, hi), b = ri(2, hi - 1);
    if (b >= a) { const s = a; a = b + 1; b = s; }
    return { q: a + " − " + b + " = ?", a: a - b, hint: "Count up from the small number to the big one." };
  };
  F.addChain = t => {
    const hi = [9, 15, 25, 40, 60, 99][t - 1];
    const a = ri(3, hi), b = ri(3, hi), c = ri(3, hi);
    return { q: a + " + " + b + " + " + c + " = ?", a: a + b + c, hint: "Add two of them first, then add the third." };
  };
  F.subChain = t => {
    const a = ri([30, 50, 90, 150, 300, 600][t - 1] - 20, [30, 50, 90, 150, 300, 600][t - 1]);
    const b = ri(3, Math.floor(a / 3)), c = ri(3, Math.floor(a / 3));
    return { q: a + " − " + b + " − " + c + " = ?", a: a - b - c, hint: "Take away the first number, then take away the second." };
  };
  F.bond = t => {
    const target = t <= 2 ? 100 : pk([100, 100, 1000]);
    const a = target === 100 ? ri(11, 89) : ri(110, 890);
    return { q: a + " + ? = " + target, a: target - a, hint: "How far is it from " + a + " up to " + target + "?" };
  };
  F.missingAddend = t => {
    const hi = [15, 30, 60, 120, 250, 500][t - 1];
    const b = ri(4, hi), s = b + ri(4, hi);
    return { q: "? + " + b + " = " + s, a: s - b, hint: "Subtract to undo the addition: " + s + " − " + b + "." };
  };
  F.missingSubtrahend = t => {
    const hi = [20, 40, 80, 150, 300, 600][t - 1];
    const a = ri(12, hi), r = ri(2, a - 2);
    return { q: a + " − ? = " + r, a: a - r, hint: "What do you take off " + a + " to land on " + r + "?" };
  };

  /* ---- multiplication ---- */
  F.mulTable = t => {
    const pool = [[2, 3, 4, 5, 10], [2, 3, 4, 5, 6, 10], [3, 4, 6, 7, 8, 9], [6, 7, 8, 9, 12], [7, 8, 9, 11, 12], [7, 8, 9, 11, 12]][t - 1];
    const a = pk(pool), b = ri(t <= 2 ? 2 : 3, t >= 4 ? 12 : 10);
    return { q: a + " × " + b + " = ?", a: a * b, hint: a + " groups of " + b + "." };
  };
  F.mul2x1 = t => {
    const a = ri([11, 12, 13, 14, 21, 24][t - 1], [19, 24, 29, 39, 59, 89][t - 1]), b = ri(3, t >= 4 ? 9 : 7);
    return { q: a + " × " + b + " = ?", a: a * b, hint: "Split " + a + " into tens and ones, multiply each, then add." };
  };
  F.mul2x2 = t => {
    const a = ri(11, t >= 5 ? 39 : 25), b = ri(11, t >= 5 ? 29 : 19);
    return { q: a + " × " + b + " = ?", a: a * b, hint: "Break " + b + " into tens and ones and multiply twice." };
  };
  F.mulBy10 = t => {
    const a = ri(3, [9, 15, 30, 60, 99, 250][t - 1]), b = pk(t <= 2 ? [10, 10, 100] : [10, 100, 100, 1000]);
    return { q: a + " × " + b + " = ?", a: a * b, hint: "Multiplying by " + b + " just slides the digits along." };
  };
  F.square = t => {
    const a = ri(t <= 2 ? 2 : 4, [7, 9, 11, 13, 16, 20][t - 1]);
    return { q: a + " × " + a + " = ?", a: a * a, hint: "A square: " + a + " rows of " + a + "." };
  };
  F.missingFactor = t => {
    const b = ri(t <= 2 ? 2 : 4, t >= 4 ? 12 : 9), n = ri(3, t >= 4 ? 12 : 9);
    return { q: b + " × ? = " + (b * n), a: n, hint: "How many " + b + "s fit into " + (b * n) + "?" };
  };
  F.timesAsMany = t => {
    const g = ri(3, t >= 4 ? 12 : 9), n = ri(3, t >= 4 ? 12 : 9);
    return { q: (g * n) + " is how many times as many as " + g + "?", a: n, hint: "Divide: " + (g * n) + " ÷ " + g + "." };
  };

  /* ---- division ---- */
  F.divExact = t => {
    const b = ri(t <= 2 ? 2 : 4, t >= 4 ? 12 : 9), n = ri(3, [8, 9, 11, 14, 18, 24][t - 1]);
    return { q: (b * n) + " ÷ " + b + " = ?", a: n, hint: "Count how many groups of " + b + " make " + (b * n) + "." };
  };
  F.divRemainder = t => {
    const b = ri(3, t >= 4 ? 9 : 6), n = ri(3, [6, 8, 10, 12, 15, 20][t - 1]), r = ri(1, b - 1);
    return { q: (b * n + r) + " ÷ " + b + ". What is the " + A("REMAINDER") + " (the bit left over)?", a: r, hint: "Fill " + n + " groups of " + b + ", then count the leftovers." };
  };
  F.share = t => {
    const kids = ri(3, t >= 4 ? 9 : 6), each = ri(3, [6, 8, 10, 12, 15, 20][t - 1]), th = pk(THINGS), who = pk(HEROES);
    return { q: th.emo + " " + (kids * each) + " " + th.many + " are shared equally by " + A(kids + " " + who) + ". How many " + th.many + " does each one get?", a: each, hint: "Split " + (kids * each) + " into " + kids + " equal piles." };
  };
  F.unitRate = t => {
    const n = ri(3, t >= 4 ? 9 : 6), each = ri(3, [7, 9, 12, 15, 20, 30][t - 1]), th = pk(THINGS);
    return { q: th.emo + " " + n + " " + th.many + " cost " + A((n * each) + " gold") + " altogether. How much is " + A("ONE") + " " + th.one + "?", a: each, hint: "Divide the total by how many there are." };
  };

  /* ---- structure & number sense ---- */
  F.seqAdd = t => {
    const step = ri(t <= 2 ? 2 : 3, [5, 8, 12, 20, 25, 50][t - 1]), start = ri(1, 20);
    const s = [start, start + step, start + step * 2, start + step * 3];
    return { q: s.join(", ") + ", ? What comes " + A("next") + "?", a: start + step * 4, hint: "Each jump adds " + step + "." };
  };
  F.seqSub = t => {
    const step = ri(t <= 2 ? 2 : 3, [5, 7, 10, 15, 20, 30][t - 1]), start = step * 6 + ri(1, 15);
    const s = [start, start - step, start - step * 2, start - step * 3];
    return { q: s.join(", ") + ", ? What comes " + A("next") + "?", a: start - step * 4, hint: "Each jump takes away " + step + "." };
  };
  F.seqDouble = t => {
    const start = ri(1, t >= 4 ? 6 : 3);
    const s = [start, start * 2, start * 4, start * 8];
    return { q: s.join(", ") + ", ? What comes " + A("next") + "?", a: start * 16, hint: "Every number is double the one before it." };
  };
  F.placeValue = t => {
    const digits = [2, 3, 3, 4, 4, 5][t - 1];
    let n = ri(Math.pow(10, digits - 1), Math.pow(10, digits) - 1);
    const names = ["ones", "tens", "hundreds", "thousands", "ten-thousands"];
    const slot = ri(0, digits - 1);
    const d = Math.floor(n / Math.pow(10, slot)) % 10;
    return { q: "In the number " + A(n.toLocaleString("en-US")) + ", which digit is in the " + A(names[slot]) + " place?", a: d === 0 ? (n = n + Math.pow(10, slot) * 3, 3) : d, hint: "Count places from the right: ones, tens, hundreds..." };
  };
  F.round = t => {
    const to = t <= 2 ? 10 : pk([10, 100, 100, 1000]);
    const n = ri(to === 10 ? 12 : to === 100 ? 120 : 1200, to === 10 ? 99 : to === 100 ? 999 : 9999);
    return { q: "Round " + A(n.toLocaleString("en-US")) + " to the nearest " + A(to) + ".", a: Math.round(n / to) * to, hint: "Look at the digit just to the right: 5 or more rounds up." };
  };
  F.tenMore = t => {
    const step = pk(t <= 2 ? [10, 10, 100] : [10, 100, 1000]);
    const n = ri(step * 2, step * (t >= 4 ? 90 : 20));
    const up = Math.random() < 0.5;
    return { q: "What is " + A(step + (up ? " MORE" : " LESS")) + " than " + n.toLocaleString("en-US") + "?", a: up ? n + step : n - step, hint: "Only the " + (step === 10 ? "tens" : step === 100 ? "hundreds" : "thousands") + " digit changes." };
  };
  F.compare = t => {
    const mk = () => { const a = ri(3, t >= 4 ? 12 : 9), b = ri(3, t >= 4 ? 12 : 9); return { txt: a + " × " + b, v: a * b }; };
    let x = mk(), y = mk(), guard = 0;
    while (x.v === y.v && guard++ < 30) y = mk();
    const big = x.v > y.v ? x : y;
    return { q: "Which is " + A("BIGGER") + ": " + x.txt + " or " + y.txt + "? (answer with the bigger " + A("total") + ")", a: big.v, hint: "Work out both, then pick the larger total." };
  };
  F.factorPair = t => {
    const n = pk(t <= 2 ? [12, 16, 18, 20, 24] : t <= 4 ? [24, 30, 36, 40, 48, 56] : [48, 60, 72, 84, 96, 100]);
    const facs = []; for (let i = 2; i < n; i++) if (n % i === 0) facs.push(i);
    const f = pk(facs);
    return { q: "Which number times " + A(f) + " makes " + A(n) + "?", a: n / f, hint: n + " ÷ " + f + " gives the missing side." };
  };
  F.evenOddCount = t => {
    const lo = ri(1, 30), len = ri(6, [8, 10, 12, 14, 16, 20][t - 1]);
    const want = Math.random() < 0.5;
    let c = 0; for (let i = lo; i < lo + len; i++) if ((i % 2 === 0) === want) c++;
    return { q: "Count the " + A(want ? "EVEN" : "ODD") + " numbers from " + A(lo) + " to " + A(lo + len - 1) + ". How many are there?", a: c, hint: want ? "Even numbers end in 0, 2, 4, 6 or 8." : "Odd numbers end in 1, 3, 5, 7 or 9." };
  };

  /* ---- fractions ---- */
  F.fracOfSet = t => {
    const den = t <= 2 ? 2 : pk([2, 3, 4, 4, 5, 10].slice(0, t));
    const each = ri(2, [8, 10, 12, 15, 20, 25][t - 1]);
    const th = pk(THINGS);
    const names = { 2: "one half", 3: "one third", 4: "one quarter", 5: "one fifth", 10: "one tenth" };
    return { q: th.emo + " What is " + A(names[den] + " (1/" + den + ")") + " of " + A(den * each) + " " + th.many + "?", a: each, hint: "Split " + (den * each) + " into " + den + " equal parts and take one." };
  };
  const gcd = (a, b) => b ? gcd(b, a % b) : a;
  F.fracMulti = t => {
    const den = pk(t <= 3 ? [3, 4] : [3, 4, 5, 6, 8]);
    let num = ri(2, den - 1);
    // only ever show a fraction in lowest terms: "2/4 of 16" reads as a typo
    let guard = 0;
    while (gcd(num, den) !== 1 && guard++ < 12) num = ri(2, den - 1);
    if (gcd(num, den) !== 1) return F.fracOfSet(t);
    const each = ri(2, [6, 8, 10, 12, 15, 20][t - 1]);
    const th = pk(THINGS);
    return { q: th.emo + " What is " + A(num + "/" + den) + " of " + A(den * each) + " " + th.many + "?", a: num * each, hint: "One part is " + each + ", so take " + num + " of them." };
  };

  /* ---- money ---- */
  F.coins = t => {
    const q = ri(0, t >= 3 ? 3 : 2), d = ri(0, t >= 3 ? 4 : 3), n = ri(0, 3), pn = ri(0, 4);
    const tot = q * 25 + d * 10 + n * 5 + pn;
    if (tot === 0) return F.coins(t);
    const bits = []; if (q) bits.push(q + " quarter" + (q > 1 ? "s" : "")); if (d) bits.push(d + " dime" + (d > 1 ? "s" : ""));
    if (n) bits.push(n + " nickel" + (n > 1 ? "s" : "")); if (pn) bits.push(pn + " penn" + (pn > 1 ? "ies" : "y"));
    return { q: "🪙 " + A(bits.join(" + ")) + ". How many " + A("CENTS") + " altogether?", a: tot, hint: "Quarter 25, dime 10, nickel 5, penny 1." };
  };
  F.change = t => {
    const paid = pk(t <= 2 ? [100, 100, 200] : [100, 200, 500, 1000]);
    const cost = ri(15, paid - 10);
    return { q: "💰 You pay " + A(money(paid)) + " for something that costs " + A(money(cost)) + ". How much change in " + A("CENTS") + "?", a: paid - cost, hint: "Count up from " + money(cost) + " to " + money(paid) + "." };
  };
  F.costTotal = t => {
    const n = ri(3, t >= 4 ? 9 : 6), each = ri(5, [12, 15, 20, 30, 45, 75][t - 1]), th = pk(THINGS);
    return { q: th.emo + " Each " + th.one + " costs " + A(each + " gold") + ". How much for " + A(n + " " + th.many) + "?", a: n * each, hint: n + " lots of " + each + "." };
  };

  /* ---- time & measure ---- */
  F.toMinutes = t => {
    const h = ri(1, t >= 4 ? 8 : 4), m = pk([0, 5, 10, 15, 20, 30, 40, 45]);
    return { q: "⏰ How many " + A("MINUTES") + " are in " + A(h + " hour" + (h > 1 ? "s" : "") + (m ? " and " + m + " minutes" : "")) + "?", a: h * 60 + m, hint: "One hour is 60 minutes." };
  };
  F.elapsed = t => {
    const start = ri(8, 11) * 60 + pk([0, 5, 10, 15, 20, 30, 45]);
    const gap = t <= 2 ? pk([15, 20, 30, 45, 60]) : ri(20, [60, 75, 95, 130, 170, 220][t - 1]);
    return { q: "⏱️ The quest starts at " + A(clock(start)) + " and ends at " + A(clock(start + gap)) + ". How many " + A("MINUTES") + " long is it?", a: gap, hint: "Jump to the next whole hour first, then count on." };
  };
  F.measure = t => {
    const kind = pk([{ big: "metre", small: "cm", f: 100 }, { big: "kilogram", small: "grams", f: 1000 }, { big: "litre", small: "ml", f: 1000 }]);
    const b = ri(1, t >= 4 ? 9 : 4), s = kind.f === 100 ? ri(5, 95) : pk([50, 100, 250, 500, 750]);
    return { q: "📏 " + A(b + " " + kind.big + (b > 1 ? "s" : "") + " and " + s + " " + kind.small) + ". How many " + A(kind.small) + " in total?", a: b * kind.f + s, hint: "One " + kind.big + " is " + kind.f + " " + kind.small + "." };
  };

  /* ---- geometry ---- */
  F.perimeter = t => {
    const w = ri(3, [8, 10, 14, 20, 30, 45][t - 1]), h = ri(3, [8, 10, 14, 20, 30, 45][t - 1]);
    return { q: "⬜ A treasure room is " + A(w + " steps") + " long and " + A(h + " steps") + " wide. Walk " + A("all the way around") + ". How many steps?", a: 2 * (w + h), hint: "Two long sides plus two short sides." };
  };
  F.area = t => {
    const w = ri(3, [7, 9, 11, 15, 20, 25][t - 1]), h = ri(3, [7, 9, 11, 15, 20, 25][t - 1]);
    return { q: "⬛ A floor is " + A(w) + " tiles across and " + A(h) + " tiles down. How many " + A("tiles in all") + "?", a: w * h, hint: "Rows times columns." };
  };
  F.arrayGrid = t => {
    const r = ri(3, t >= 4 ? 12 : 8), c = ri(3, t >= 4 ? 12 : 8), th = pk(THINGS);
    return { q: th.emo + " " + A(r + " rows") + " of " + A(c + " " + th.many) + " are laid out on the floor. How many " + th.many + " altogether?", a: r * c, hint: "An array: multiply the rows by the columns." };
  };

  /* ---- word & multi-step (the real thinking) ---- */
  F.wordGroups = t => {
    const n = ri(3, t >= 4 ? 9 : 7), e = ri(3, [7, 9, 11, 12, 15, 20][t - 1]);
    const th = pk(THINGS), ho = pk(HOLDERS);
    return { q: th.emo + " " + A(n + " " + ho.many) + " each hold " + A(e + " " + th.many) + ". How many " + th.many + " in all?", a: n * e, hint: n + " groups of " + e + "." };
  };
  F.wordTwoStep = t => {
    const n = ri(3, t >= 4 ? 8 : 6), e = ri(3, [7, 9, 11, 12, 15, 20][t - 1]), c = ri(2, [8, 10, 14, 20, 30, 45][t - 1]);
    const th = pk(THINGS), ho = pk(HOLDERS);
    const plus = Math.random() < 0.6;
    return plus
      ? { q: th.emo + " " + A(n + " " + ho.many) + " of " + A(e + " " + th.many) + ", plus " + A(c + " loose " + th.many) + " on the floor. How many " + th.many + "?", a: n * e + c, hint: "Multiply first, then add the loose ones." }
      : { q: th.emo + " " + A(n + " " + ho.many) + " of " + A(e + " " + th.many) + ", but " + A(c > n * e ? 2 : c) + " were stolen. How many are left?", a: n * e - (c > n * e ? 2 : c), hint: "Multiply first, then take away." };
  };
  F.wordCompare = t => {
    const a = ri(4, [12, 18, 25, 40, 60, 90][t - 1]), mult = ri(2, t >= 4 ? 8 : 5);
    const th = pk(THINGS);
    return { q: th.emo + " A goblin has " + A(a + " " + th.many) + ". The dragon has " + A(mult + " times as many") + ". How many does the " + A("dragon") + " have?", a: a * mult, hint: mult + " lots of " + a + "." };
  };
  F.wordDiffThen = t => {
    const a = ri(20, [40, 60, 90, 140, 220, 350][t - 1]), b = ri(5, a - 5), d = ri(2, 6);
    const th = pk(THINGS);
    return { q: th.emo + " You had " + A(a + " " + th.many) + " and lost " + A(b) + ". Then you found " + A(d + " more") + ". How many now?", a: a - b + d, hint: "Take away first, then add what you found." };
  };
  F.wordRemainder = t => {
    const b = ri(3, t >= 4 ? 9 : 6), n = ri(3, [6, 8, 10, 12, 15, 20][t - 1]), r = ri(1, b - 1);
    const th = pk(THINGS), who = pk(HEROES);
    return { q: th.emo + " " + A(b * n + r + " " + th.many) + " are shared between " + A(n + " " + who) + " as evenly as possible. How many are " + A("LEFT OVER") + "?", a: r, hint: "Deal them out in equal rounds and see what will not go round again." };
  };

  /* the family table: which kinds live at which tier */
  const TIERS = {
    1: ["add2", "sub2", "addChain", "mulTable", "divExact", "missingFactor", "missingAddend",
        "seqAdd", "seqSub", "tenMore", "mulBy10", "square", "fracOfSet", "coins",
        "arrayGrid", "wordGroups", "evenOddCount", "bond", "toMinutes", "perimeter", "share"],
    2: ["add2", "sub2", "addChain", "mulTable", "divExact", "missingFactor", "missingAddend", "seqAdd", "seqSub", "placeValue", "round", "fracOfSet", "coins", "change", "perimeter", "area", "arrayGrid", "wordGroups", "toMinutes", "tenMore", "bond", "evenOddCount", "mulBy10", "square"],
    3: ["sub2", "addChain", "subChain", "mulTable", "mul2x1", "divExact", "divRemainder", "missingFactor", "missingAddend", "missingSubtrahend", "timesAsMany", "seqAdd", "seqSub", "seqDouble", "placeValue", "round", "compare", "fracOfSet", "fracMulti", "coins", "change", "costTotal", "perimeter", "area", "arrayGrid", "wordGroups", "wordTwoStep", "wordCompare", "toMinutes", "elapsed", "measure", "share", "mulBy10", "square", "factorPair", "bond", "evenOddCount"],
    4: ["addChain", "subChain", "mul2x1", "mul2x2", "divExact", "divRemainder", "missingFactor", "missingSubtrahend", "timesAsMany", "seqSub", "seqDouble", "placeValue", "round", "compare", "fracMulti", "fracOfSet", "change", "costTotal", "unitRate", "perimeter", "area", "arrayGrid", "wordTwoStep", "wordCompare", "wordDiffThen", "wordRemainder", "elapsed", "measure", "share", "square", "factorPair", "bond", "add2", "sub2"],
    5: ["mul2x1", "mul2x2", "divExact", "divRemainder", "missingFactor", "missingSubtrahend", "timesAsMany", "seqDouble", "seqSub", "round", "compare", "fracMulti", "change", "unitRate", "costTotal", "area", "perimeter", "wordTwoStep", "wordDiffThen", "wordRemainder", "wordCompare", "elapsed", "measure", "share", "square", "factorPair", "placeValue", "addChain", "subChain", "bond"],
    6: ["mul2x2", "mul2x1", "divRemainder", "divExact", "missingFactor", "compare", "fracMulti", "unitRate", "wordTwoStep", "wordDiffThen", "wordRemainder", "wordCompare", "elapsed", "measure", "share", "square", "factorPair", "round", "subChain", "seqDouble", "change", "area"]
  };

  /* =================================================================
     ANTI-REPEAT BAG
     Signature = kind + the actual numbers, so "7 x 8" is remembered
     even when it arrives dressed as a word problem. The last MEMORY
     signatures are kept in localStorage, so a kid who plays every day
     does not see the same problem twice in a week.
     ================================================================= */
  const MEMORY = 600;
  const KEY = "mathDungeonSeen.v1";
  let seen = [], seenSet = new Set();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    if (Array.isArray(raw)) { seen = raw.slice(-MEMORY); seenSet = new Set(seen); }
  } catch (e) { seen = []; seenSet = new Set(); }

  function remember(sig) {
    seen.push(sig); seenSet.add(sig);
    while (seen.length > MEMORY) seenSet.delete(seen.shift());
    try { localStorage.setItem(KEY, JSON.stringify(seen)); } catch (e) { /* private mode: run without persistence */ }
  }

  /* =================================================================
     ADAPTIVE TIER
     Three right in a row nudges difficulty up; two wrong nudges it
     down. Offset is clamped so the floor never gets babyish and the
     ceiling never becomes impossible.
     ================================================================= */
  const AKEY = "mathDungeonAdapt.v1";
  let offset = 0, upStreak = 0, downStreak = 0;
  const byKind = {};
  try {
    const a = JSON.parse(localStorage.getItem(AKEY) || "{}");
    if (a && typeof a.offset === "number") offset = Math.max(-1, Math.min(2, a.offset));
  } catch (e) { offset = 0; }

  function saveAdapt() { try { localStorage.setItem(AKEY, JSON.stringify({ offset: offset })); } catch (e) { } }

  function record(ok, kind) {
    if (kind) { const k = byKind[kind] = byKind[kind] || { ok: 0, no: 0 }; ok ? k.ok++ : k.no++; }
    // climbs after 2 in a row (was 3), can reach +3 (was +2), and at Hard or
    // above the offset never goes below 0, so a couple of misses cannot
    // drag him back down to baby questions
    const floor = diffBump > 0 ? 0 : -1;
    if (ok) { upStreak++; downStreak = 0; if (upStreak >= 2) { upStreak = 0; if (offset < 3) { offset++; saveAdapt(); } } }
    else { downStreak++; upStreak = 0; if (downStreak >= 2) { downStreak = 0; if (offset > floor) { offset--; saveAdapt(); } } }
  }

  /* Difficulty is a flat bump on top of the level's tier, chosen on the
     title screen and remembered. It moves the FLOOR: a kid who already
     knows his tables cold should never be handed tier 1 again. */
  let diffBump = 0;
  function setDifficulty(n) { diffBump = Math.max(0, Math.min(3, n | 0)); if (diffBump > 0 && offset < 0) offset = 0; return diffBump; }
  const difficulty = () => diffBump;
  const tierFor = base => Math.max(1, Math.min(6, (base || 1) + diffBump + offset));

  /* =================================================================
     ask(tier, opts)
       opts.exclude  - array of kinds to skip (pack questions exclude
                       nothing; the door lock excludes long word
                       problems so the text fits the door plate)
       opts.only     - array of kinds to draw from instead of the tier
       opts.maxAns   - cap the answer size (small UI plates)
       opts.short    - true = prefer families whose text is one line
     ================================================================= */
  const SHORT_KINDS = new Set(["add2", "sub2", "addChain", "subChain", "mulTable", "mul2x1", "mul2x2", "mulBy10", "square", "missingFactor", "missingAddend", "missingSubtrahend", "divExact", "timesAsMany", "bond", "tenMore", "seqAdd", "seqSub", "seqDouble", "round"]);

  function build(kind, t) {
    const fn = F[kind];
    if (!fn) return null;
    let r;
    try { r = fn(t); } catch (e) { return null; }
    if (!r) return null;
    // numeric: a positive integer the game can fake distractors for
    const okNum  = typeof r.a === "number" && isFinite(r.a) && r.a > 0 && Math.floor(r.a) === r.a;
    // word: the family ships its own options and the answer is one of them
    const okWord = typeof r.a === "string" && Array.isArray(r.choices) &&
                   r.choices.length >= 2 && r.choices.indexOf(r.a) !== -1 &&
                   new Set(r.choices).size === r.choices.length;
    if (!okNum && !okWord) return null;
    r.kind = kind;
    r.tier = t;
    r.sig = kind + "|" + r.q.replace(/<[^>]*>/g, "");
    return r;
  }

  function ask(baseTier, opts) {
    opts = opts || {};
    const t = opts.rawTier ? Math.max(1, Math.min(6, baseTier)) : tierFor(baseTier);
    let pool = (opts.only && opts.only.length) ? opts.only.slice() : (TIERS[t] || TIERS[3]).slice();
    if (opts.short) { const s = pool.filter(k => SHORT_KINDS.has(k)); if (s.length >= 4) pool = s; }
    if (opts.exclude && opts.exclude.length) {
      const ex = new Set(opts.exclude);
      const f = pool.filter(k => !ex.has(k));
      if (f.length >= 3) pool = f;
    }
    shuf(pool);

    let fallback = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      const kind = pool[attempt % pool.length];
      const r = build(kind, t);
      if (!r) continue;
      if (typeof r.a === "number") {
        if (opts.maxAns && r.a > opts.maxAns) { if (!fallback) fallback = r; continue; }
        if (opts.minAns && r.a < opts.minAns) { if (!fallback) fallback = r; continue; }
      }
      if (!fallback) fallback = r;
      if (!seenSet.has(r.sig)) { remember(r.sig); return r; }
    }
    // every candidate was recently seen (or capped): take the best we found
    // rather than lock up. Still remembered so it rotates out next time.
    if (fallback) { remember(fallback.sig); return fallback; }
    const last = build("mulTable", Math.min(3, t)) || { q: "6 × 7 = ?", a: 42, kind: "mulTable", tier: t, sig: "fallback", hint: "6 groups of 7." };
    remember(last.sig);
    return last;
  }

  /* Register a family from outside (story-bank.js uses this).
       kind   - id
       fn     - t => { q, a, choices?, hint }
       tiers  - array of tier numbers it belongs to (1..6)
       opts   - { short:true } to let the door lock pick it        */
  function addFamily(kind, fn, tiers, opts) {
    if (!kind || typeof fn !== "function") throw new Error("addFamily needs kind + fn");
    F[kind] = fn;
    (tiers || [1, 2, 3, 4, 5, 6]).forEach(t => {
      if (!TIERS[t]) TIERS[t] = [];
      if (TIERS[t].indexOf(kind) === -1) TIERS[t].push(kind);
    });
    if (opts && opts.short) SHORT_KINDS.add(kind);
    return kind;
  }

  function reset() {
    seen = []; seenSet = new Set(); offset = 0; upStreak = 0; downStreak = 0;
    try { localStorage.removeItem(KEY); localStorage.removeItem(AKEY); } catch (e) { }
  }

  return {
    ask: ask,
    addFamily: addFamily,
    /* strip a family out of every tier above maxTier: for reading-bank
       families that are trivial past the first levels */
    restrict: function (kind, maxTier) {
      for (const t in TIERS) if ((t | 0) > maxTier) TIERS[t] = TIERS[t].filter(k => k !== kind);
    },
    setDifficulty: setDifficulty, difficulty: difficulty,
    record: record,
    tierFor: tierFor,
    reset: reset,
    get families() { return Object.keys(F); },
    stats: () => ({ seen: seen.length, offset: offset, upStreak: upStreak, downStreak: downStreak, byKind: byKind, families: Object.keys(F).length })
  };
})();
if (typeof window !== "undefined") window.MathBank = MathBank;
