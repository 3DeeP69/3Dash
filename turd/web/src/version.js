// ===========================================================================
// T.U.R.D. VERSION: owned by the "App releases and versions" thread.
// Classic script, loaded just before core.js. Shows which build is installed:
//   · a version line under the login form
//   · "vX.Y.Z" next to the T.U.R.D. wordmark in the status bar
// Tapping either opens "What's new" for this build.
// In the Windows/Android apps the number comes from the installed app itself
// (TURD_NATIVE.info().version), so it can never lie about what's installed.
//
// Do not hand-edit VERSION/DATE: run  node turd/releases/stamp-version.mjs X.Y.Z
// ===========================================================================
(function(){
  "use strict";
  var VERSION = "1.2.0";
  var DATE = "2026-10-22";
  var NOTES = [
    "Device sync between the PC and the Fold4",
    "\"Hey T.U.R.D.\" hands-free voice, offline",
    "Play tab: launch Steam, Epic and GOG games, plus Now Playing",
    "Home: PC status card, and a Fold4 status strip on the PC",
    "\"Before you go\" recap when you log out",
    "Quick Drop: send links, notes and files between your devices",
    "Wi-Fi scanner fixed; chat finds your PC by itself; Wake PC",
    "Entertainment \"handler error\" fixed; new deep-space login"
  ];

  var info = { version: VERSION, web: VERSION, date: DATE, notes: NOTES, platform: "web" };
  window.TURD_VERSION = info;

  var css = document.createElement("style");
  css.textContent =
    ".turd-ver{font-family:var(--mono,monospace);font-size:10px;letter-spacing:2px;color:var(--ink-dim,#8aa);opacity:.7;" +
      "background:none;border:0;cursor:pointer;text-transform:uppercase;padding:6px 4px;transition:opacity .2s,color .2s}" +
    ".turd-ver:hover,.turd-ver:focus-visible{outline:none;opacity:1;color:var(--accent,#3bf)}" +
    "#login .turd-ver{position:absolute;left:0;right:0;bottom:calc(14px + env(safe-area-inset-bottom,0px));margin:auto;width:max-content;z-index:2}" +
    "#status .turd-ver{font-size:9px;padding:2px 6px;margin-left:4px;opacity:.6;pointer-events:auto;vertical-align:middle}" +
    ".turd-ver-pop{position:fixed;z-index:60;left:50%;bottom:56px;transform:translateX(-50%);width:min(360px,calc(100vw - 32px));" +
      "background:rgba(4,10,22,.94);border:1px solid rgba(var(--accent-rgb,59,180,255),.45);border-radius:10px;padding:16px 18px;" +
      "font-family:var(--mono,monospace);font-size:12px;color:var(--ink,#dfe);box-shadow:0 0 30px rgba(0,0,0,.6)}" +
    ".turd-ver-pop h4{margin:0 0 4px;font-size:13px;letter-spacing:3px;color:var(--accent,#3bf)}" +
    ".turd-ver-pop .d{opacity:.6;font-size:10px;letter-spacing:1px;margin-bottom:10px}" +
    ".turd-ver-pop ul{margin:0;padding-left:16px;line-height:1.7}" +
    ".turd-ver-pop .warn{margin-top:10px;color:#ffc93c;font-size:11px}" +
    "@media(max-width:420px){#status .turd-ver{display:none}}";
  (document.head || document.documentElement).appendChild(css);

  function label(){ return "v" + info.version; }

  function pop(){
    var old = document.querySelector(".turd-ver-pop");
    if (old) { old.remove(); return; }
    var p = document.createElement("div");
    p.className = "turd-ver-pop";
    p.setAttribute("role", "dialog");
    var h = document.createElement("h4"); h.textContent = "T.U.R.D. " + label();
    var d = document.createElement("div"); d.className = "d";
    d.textContent = info.date + " · " + info.platform + (info.web !== info.version ? " · web " + info.web : "");
    var ul = document.createElement("ul");
    info.notes.forEach(function(n){ var li = document.createElement("li"); li.textContent = n; ul.appendChild(li); });
    p.appendChild(h); p.appendChild(d); p.appendChild(ul);
    if (info.web && info.web !== info.version) {
      var w = document.createElement("div"); w.className = "warn";
      w.textContent = "App and web files differ. Reinstall the latest build from the releases thread.";
      p.appendChild(w);
    }
    document.body.appendChild(p);
    setTimeout(function(){
      document.addEventListener("pointerdown", function close(e){
        if (!p.contains(e.target)) { p.remove(); document.removeEventListener("pointerdown", close, true); }
      }, true);
    }, 0);
  }

  function badge(where){
    var b = document.createElement("button");
    b.type = "button"; b.className = "turd-ver"; b.dataset.where = where;
    b.title = "Installed build. Tap for what's new.";
    b.addEventListener("click", function(e){ e.stopPropagation(); pop(); });
    return b;
  }

  function place(){
    var login = document.getElementById("login");
    if (login && !login.querySelector(".turd-ver")) login.appendChild(badge("login"));
    var brand = document.getElementById("brand");
    var status = document.getElementById("status");
    if (status && !status.querySelector(".turd-ver")) {
      var b = badge("status");
      if (brand && brand.nextSibling) status.insertBefore(b, brand.nextSibling); else status.appendChild(b);
    }
    var all = document.querySelectorAll(".turd-ver");
    for (var i = 0; i < all.length; i++) {
      var t = (all[i].dataset.where === "login" ? "T.U.R.D. " : "") + label() + (all[i].dataset.where === "login" ? " · " + info.date : "");
      if (all[i].textContent !== t) all[i].textContent = t;
    }
  }

  function start(){
    place();
    // core re-renders parts of the HUD; keep the badge present without a MutationObserver storm
    var n = 0, iv = setInterval(function(){ place(); if (++n > 20) clearInterval(iv); }, 1500);
    var N = window.TURD_NATIVE;
    if (N && N.info) {
      Promise.resolve().then(function(){ return N.info(); }).then(function(r){
        if (r && r.version) {
          info.version = String(r.version).replace(/^v/, "");
          info.platform = r.platform || N.platform || info.platform;
          place();
        }
      }).catch(function(){});
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
