/* =====================================================================
   HOME BUTTON — every game page carries a small home button that goes
   back to the arcade's main screen (index.html). Hidden when the page is
   running inside the dungeon (embed=1), because the dungeon has its own
   way back. Also picks up the hero chosen on the main screen: if a page
   was opened without ?hero=, it reloads once with the saved hero so every
   game shows the same character.

   PLACEMENT (fixed 2026-09-26): it used to float dead-centre at the top
   of the screen, where it sat directly on top of the games' own HUD and
   covered the timer on an iPhone. Every game except the two helpers lays
   its HUD out as a flex row with id="hud", so the button now DOCKS INTO
   that row as an ordinary chip and can never overlap anything. Where
   there is no usable HUD (the multiply and subtract helpers, or a HUD
   that is hidden on a start screen), it falls back to floating, and
   picks the first corner whose centre is not already covered by a
   control, re-checking on resize and orientation change.
   ===================================================================== */
(function () {
  "use strict";
  var qs;
  try { qs = new URLSearchParams(location.search); } catch (e) { return; }
  if (qs.get("embed") === "1") return;
  if (/math-dungeon-3d/.test(location.pathname)) return;  // the dungeon links home from its own title screen

  // carry the hero the kid picked on the main screen into this game
  var HEROES = ["knight", "wizard", "ninja", "robot", "explorer", "dragon"];
  var saved = null;
  try { saved = localStorage.getItem("mathDungeonChar"); } catch (e) { saved = null; }
  if (!qs.get("hero") && saved && HEROES.indexOf(saved) >= 0) {
    qs.set("hero", saved);
    try { location.replace(location.pathname + "?" + qs.toString() + location.hash); return; } catch (e) { /* keep going */ }
  }

  var SIZE = 34, btn = null;

  function build() {
    var a = document.createElement("a");
    a.id = "mdHomeBtn";
    a.href = "index.html";
    a.title = "Back to all the games";
    a.setAttribute("aria-label", "Back to all the games");
    a.textContent = "\u{1F3E0}";
    return a;
  }

  /* looks like one of the game's own HUD chips */
  function styleDocked(a) {
    a.style.cssText = [
      "position:static", "flex:0 0 auto", "order:-1", "margin:0",
      "width:" + SIZE + "px", "height:" + SIZE + "px", "border-radius:50%",
      "display:inline-flex", "align-items:center", "justify-content:center",
      "font-size:17px", "line-height:1", "text-decoration:none",
      "background:rgba(8,12,34,.72)", "border:2px solid rgba(255,210,63,.55)",
      "box-shadow:0 2px 6px rgba(0,0,0,.45)", "z-index:5"
    ].join(";");
  }

  function styleFloating(a, spot) {
    var css = [
      "position:fixed", "z-index:2147483000",   /* above the games' own start overlays */
      "width:" + SIZE + "px", "height:" + SIZE + "px", "border-radius:50%",
      "display:flex", "align-items:center", "justify-content:center",
      "font-size:17px", "line-height:1", "text-decoration:none",
      "background:rgba(8,12,34,.86)", "border:2px solid rgba(255,210,63,.6)",
      "box-shadow:0 3px 10px rgba(0,0,0,.5)", "opacity:.92"
    ];
    css.push(spot.top != null ? "top:" + spot.top + "px" : "bottom:" + spot.bottom + "px");
    css.push(spot.left != null ? "left:" + spot.left + "px" : "right:" + spot.right + "px");
    a.style.cssText = css.join(";");
  }

  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width < SIZE || r.height < 12) return false;
    var cs = window.getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  }

  /* every leaf a child can actually SEE: text or a control whose own centre is
     the topmost thing at that spot, so anything hidden behind a start overlay
     is correctly ignored */
  function visibleLeaves() {
    var list = [], all;
    try { all = document.querySelectorAll("*"); } catch (e) { return list; }
    for (var i = 0; i < all.length; i++) {
      var n = all[i];
      if (n === btn || btn.contains(n) || n.contains(btn)) continue;
      var interactive = /^(BUTTON|INPUT|SELECT|CANVAS|IMG|VIDEO)$/.test(n.tagName);
      if (!interactive && (n.children.length || !n.textContent.trim())) continue;
      var r = n.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.bottom < 0 || r.top > window.innerHeight) continue;
      if (r.width > window.innerWidth * 0.9 && r.height > window.innerHeight * 0.9) continue;
      var top;
      try { top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); } catch (e) { continue; }
      if (!top) continue;
      if (top !== n && !n.contains(top) && top !== btn && !btn.contains(top)) continue;
      list.push(r);
    }
    return list;
  }

  /* would a tap actually land on this button, or is a game overlay on top? */
  function hittable() {
    if (!btn) return false;
    var r = btn.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    var el;
    try { el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); } catch (e) { return false; }
    return !!el && (el === btn || btn.contains(el));
  }

  function hits(r, leaves) {
    for (var i = 0; i < leaves.length; i++) {
      var b = leaves[i];
      if (!(r.right <= b.left || r.left >= b.right || r.bottom <= b.top || r.top >= b.bottom)) return true;
    }
    return false;
  }

  function place() {
    if (!btn) return;
    var hud = document.getElementById("hud");
    if (hud && visible(hud)) {
      styleDocked(btn);
      if (btn.parentNode !== hud) hud.insertBefore(btn, hud.firstChild);
      var dr = btn.getBoundingClientRect();
      if (hittable() && !hits(dr, visibleLeaves())) return;   /* docked, reachable, covering nothing */
      btn.remove();                                           /* an overlay or the game art is on top: float */
    }
    if (btn.parentNode !== document.body) document.body.appendChild(btn);
    var pad = 6;
    var spots = [
      { top: pad, left: pad }, { top: pad, right: pad },
      { bottom: pad, left: pad }, { bottom: pad, right: pad },
      { top: Math.round(window.innerHeight / 2 - SIZE / 2), left: pad },
      { top: Math.round(window.innerHeight / 2 - SIZE / 2), right: pad }
    ];
    /* straight under the game's HUD bar is nearly always open ground, and the
       HUD is exactly what this button used to land on, so try there first */
    var bar = document.getElementById("hud");
    if (bar) {
      var bb = bar.getBoundingClientRect();
      if (bb.height > 0 && bb.bottom + SIZE + pad < window.innerHeight) {
        spots.unshift({ top: Math.round(bb.bottom) + pad, left: pad },
                      { top: Math.round(bb.bottom) + pad, right: pad });
      }
    }
    var leaves = visibleLeaves();
    for (var i = 0; i < spots.length; i++) {
      styleFloating(btn, spots[i]);
      var r = btn.getBoundingClientRect();
      if (hittable() && !hits(r, leaves)) return;
    }
    styleFloating(btn, spots[0]);   // nothing was free: first choice, still reachable
  }

  function init() {
    if (document.getElementById("mdHomeBtn")) return;
    btn = build();
    document.body.appendChild(btn);
    place();
    var t;
    function again() { clearTimeout(t); t = setTimeout(place, 120); }
    window.addEventListener("resize", again);
    window.addEventListener("orientationchange", again);
    /* start screens, win panels and dex overlays open and close on taps */
    document.addEventListener("click", again, true);
    document.addEventListener("touchend", again, true);
    setTimeout(place, 400); setTimeout(place, 1200);

    /* Self-correcting watch. Every game here draws its own screens, so rather
       than hard-coding each layout we simply keep asking the only question
       that matters: would a tap land on this button? The expensive scan only
       runs when the answer is no, or when the HUD has moved. */
    window.__mdHomePlace = place;          /* test hook: re-place on demand */
    var lastBar = "";
    setInterval(function () {
      if (!btn) return;
      var bar = document.getElementById("hud");
      var sig = bar ? JSON.stringify(bar.getBoundingClientRect()) : "";
      var moved = sig !== lastBar;
      lastBar = sig;
      if (!hittable() || moved) place();
    }, 700);
  }

  if (document.body) init();
  else document.addEventListener("DOMContentLoaded", init);
})();
