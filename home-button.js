/* =====================================================================
   HOME BUTTON — every game page carries a small 🏠 that goes back to the
   arcade's main screen (index.html). Hidden when the page is running
   inside the dungeon (embed=1), because the dungeon has its own way back.
   Also picks up the hero chosen on the main screen: if a page was opened
   without ?hero=, it reloads once with the saved hero so every game shows
   the same character.
   ===================================================================== */
(function () {
  "use strict";
  var qs;
  try { qs = new URLSearchParams(location.search); } catch (e) { return; }
  if (qs.get("embed") === "1") return;

  // carry the hero the kid picked on the main screen into this game
  var HEROES = ["knight", "wizard", "ninja", "robot", "explorer", "dragon"];
  var saved = null;
  try { saved = localStorage.getItem("mathDungeonChar"); } catch (e) { saved = null; }
  if (!qs.get("hero") && saved && HEROES.indexOf(saved) >= 0 && !/math-dungeon-3d/.test(location.pathname)) {
    qs.set("hero", saved);
    try { location.replace(location.pathname + "?" + qs.toString() + location.hash); return; } catch (e) { /* keep going */ }
  }

  function add() {
    if (document.getElementById("mdHomeBtn")) return;
    if (/math-dungeon-3d/.test(location.pathname)) return;   // the dungeon has a link on its own title screen
    var a = document.createElement("a");
    a.id = "mdHomeBtn";
    a.href = "index.html";
    a.title = "Back to all the games";
    a.setAttribute("aria-label", "Back to all the games");
    a.textContent = "\u{1F3E0}";
    a.style.cssText = [
      "position:fixed", "left:50%", "top:3px", "transform:translateX(-50%)", "z-index:9999",
      "width:36px", "height:36px", "border-radius:50%", "display:flex", "align-items:center",
      "justify-content:center", "font-size:18px", "text-decoration:none",
      "background:rgba(8,12,34,.82)", "border:2px solid rgba(255,210,63,.6)",
      "box-shadow:0 3px 10px rgba(0,0,0,.5)", "opacity:.85"
    ].join(";");
    document.body.appendChild(a);
  }
  if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
})();
