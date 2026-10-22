// ===========================================================================
// ENTERTAINMENT · PLAY — the games installed on your PC as cover tiles.
// Data comes from the T.U.R.D. server running on the PC (server/games.js):
// on the PC the app talks to it locally, on the phone over the home network
// with the same login as chat. Launching from the phone starts the game on
// the PC. Admin only; every launch lands in the admin log.
// ===========================================================================

let up = null;   // ../../uplink.js (optional, like the PC status card)
const loadUplink = ()=> up ??= import("../../uplink.js").then(m=>m.default||m).catch(()=>null);
const http = (...a)=> (window.TURD_HTTP || fetch)(...a);

const SRC = { steam:"Steam", epic:"Epic", gog:"GOG", pc:"PC" };
let K, root, ep = "", tok = "", data = null, filter = "all", q = "", busy = false, alive = false, onTheme = null;

const ago = t=>{ if(!t) return ""; const s = (Date.now()-t)/1000; if(s < 3600) return "played just now"; if(s < 86400) return `played ${Math.round(s/3600)}h ago`;
  const d = Math.round(s/86400); return d < 60 ? `played ${d} day${d>1?"s":""} ago` : `played ${new Date(t).toLocaleDateString([], { month:"short", year:"numeric" })}`; };
const hue = s=>{ let h = 0; for(const c of s) h = (h*31 + c.charCodeAt(0)) >>> 0; return h % 360; };
const initials = n=> n.replace(/[^A-Za-z0-9 ]/g," ").split(/\s+/).filter(Boolean).slice(0,3).map(w=>w[0]).join("").toUpperCase() || "?";
const artUrl = (g, kind)=> `${ep}/api/games/art?id=${encodeURIComponent(g.id)}&kind=${kind}&token=${encodeURIComponent(tok)}`;
// Local Steam cache first, Steam's public image CDN second (free, no key), generated art last.
function artSrcs(g, kind){
  const out = [];
  if(g.art && g.art[kind]) out.push(artUrl(g, kind));
  if(g.cdn) out.push(g.cdn + (kind === "portrait" ? "library_600x900_2x.jpg" : kind === "hero" ? "library_hero.jpg" : kind === "logo" ? "logo.png" : "header.jpg"));
  return out;
}
function img(g, kind, cls){
  const s = artSrcs(g, kind); if(!s.length) return "";
  return `<img class="${cls}" alt="" loading="lazy" decoding="async" src="${K.esc(s[0])}" data-alt="${K.esc(s.slice(1).join("|"))}">`;
}
// walk the fallback list on error, then reveal the generated tile underneath
function wireImgs(el){
  el.querySelectorAll("img[data-alt]").forEach(im=>{
    im.addEventListener("load", ()=> im.classList.add("ok"), { once:false });
    im.addEventListener("error", ()=>{ const rest = (im.dataset.alt||"").split("|").filter(Boolean);
      if(rest.length){ im.dataset.alt = rest.slice(1).join("|"); im.src = rest[0]; } else im.remove(); });
  });
}

/* ------------------------------------------------------------ data */
async function load(refresh){
  const u = await loadUplink(); if(!u) return { state:"nolink" };
  try{ if(u.ensureEndpoint) await u.ensureEndpoint(); }catch(e){}
  ep = (u.endpoint && u.endpoint()) || ""; tok = (u.token && u.token()) || "";
  if(!ep) return { state:"nolink" };
  if(!tok) return { state:"nologin" };
  const ctl = new AbortController(), to = setTimeout(()=>ctl.abort(), 12000);
  try{
    const r = await http(ep + "/api/games" + (refresh ? "?refresh=1" : ""), { headers:{ authorization:"Bearer " + tok }, cache:"no-store", signal:ctl.signal });
    if(r.status === 404) return { state:"old" };
    if(r.status === 401 || r.status === 403) return { state:"denied" };
    const j = await r.json(); if(!j.ok) return { state:"denied" };
    try{ localStorage.setItem("turd_games_last", JSON.stringify(j)); }catch(e){}
    return { state:"ok", d:j };
  }catch(e){
    let last = null; try{ last = JSON.parse(localStorage.getItem("turd_games_last")||"null"); }catch(_){}
    return { state:"offline", d:last };
  }finally{ clearTimeout(to); }
}

/* ------------------------------------------------------------ render */
function cover(g, i){
  const h = hue(g.name);
  return `<button class="gm-card" data-id="${K.esc(g.id)}" style="--h:${h};--i:${i}" title="${K.esc(g.name)}">
    <span class="gm-art"><span class="gm-gen"><b>${K.esc(initials(g.name))}</b><em>${K.esc(g.name)}</em></span>${img(g, "portrait", "gm-img")}</span>
    <span class="gm-name">${K.esc(g.name)}</span>
    <span class="gm-meta">${SRC[g.source]||g.source}${g.lastPlayed ? " · " + ago(g.lastPlayed).replace("played ","") : ""}</span>
  </button>`;
}
function message(title, body, extra=""){
  root.innerHTML = `<div class="gm-msg"><b>${title}</b><p>${body}</p>${extra}</div>`;
}
function render(res){
  if(!alive) return;
  const isAdmin = K.session && K.session.role === "admin";
  if(!isAdmin && res.state !== "nolink") return message("Games are admin only", "Log in as an admin to see and launch the games on your PC.");
  if(res.state === "nolink") return message("Link this device to your PC",
    "Games come from the T.U.R.D. app running on your PC. On the PC this happens by itself. On your phone, open <b>Chat</b> and link it to your PC's address (the same link chat uses), then come back here.");
  if(res.state === "nologin") return message("Log in to your PC", "Log in with your T.U.R.D. admin account (the one on your PC) to see your games.");
  if(res.state === "denied") return message("Admin clearance needed", "This account can't see the PC's games. Log in as an admin.");
  if(res.state === "old") return message("Update the PC app", "The T.U.R.D. app on your PC is older than this one. Update it and your games show up here.");
  data = res.d;
  if(!data){ return message("Your PC isn't reachable", "Is the PC on and the T.U.R.D. app running?", `<button class="btn" id="gmRetry">Try again</button>`); }
  const offline = res.state === "offline";
  const games = data.games || [];
  if(!games.length){
    const why = data.platform && data.platform !== "win32" ? `This server runs on ${K.esc(data.platform)}, not on your gaming PC. Games show up when the T.U.R.D. app on your Windows PC hosts the server.`
      : "No Steam, Epic or GOG games were found on this PC. Install one, or add any game below.";
    return message("No games found", why, data.local ? addForm() : "");
  }
  const hero = games[0];
  const shown = games.filter(g=> (filter === "all" || g.source === filter) && (!q || g.name.toLowerCase().includes(q)));
  const sources = [...new Set(games.map(g=>g.source))];
  const remote = !data.local;
  // keep controller/keyboard focus on the same game across re-renders (rescan, after a launch)
  const fe = root.contains(document.activeElement) ? document.activeElement : null;
  const keep = fe && (fe.dataset.play ? "[data-play]" : fe.dataset.id ? `.gm-card[data-id="${CSS.escape(fe.dataset.id)}"]` : null);
  root.innerHTML = `
    <div class="gm-hero" data-id="${K.esc(hero.id)}" style="--h:${hue(hero.name)}">
      <div class="gm-hero-bg">${img(hero, "hero", "gm-hero-img")}</div>
      <div class="gm-hero-txt">
        <span class="gm-k">${offline ? "Offline · last known library" : hero.lastPlayed ? "Jump back in" : "Ready to play"}</span>
        <div class="gm-hero-logo">${img(hero, "logo", "gm-logo")}<h2>${K.esc(hero.name)}</h2></div>
        <span class="gm-sub">${K.esc(ago(hero.lastPlayed) || (SRC[hero.source]||""))}${remote ? ` · starts on ${K.esc(data.host)}` : ""}</span>
        <button class="gm-play" data-play="${K.esc(hero.id)}" ${offline?"disabled":""}><i>▶</i>${remote ? "Play on PC" : "Play"}</button>
      </div>
    </div>
    <div class="gm-bar">
      <div class="gm-tabs">${["all", ...sources].map(s=>`<button class="${s===filter?"on":""}" data-f="${s}">${s === "all" ? `All <span>${games.length}</span>` : SRC[s]||s}</button>`).join("")}</div>
      <input class="gm-q" id="gmQ" placeholder="Find a game" value="${K.esc(q)}" autocomplete="off" spellcheck="false">
      <button class="ent-ib" id="gmRefresh" title="Rescan the PC">⟳</button>
    </div>
    <div class="gm-grid" id="gmGrid">${shown.map(cover).join("") || `<p class="gm-none">No games match.</p>`}</div>
    ${data.local ? `<details class="gm-addwrap"><summary>Add a game that isn't on Steam, Epic or GOG</summary>${addForm()}</details>` : ""}`;
  wireImgs(root);
  if(keep) root.querySelector(keep)?.focus({ preventScroll:true });
  if(onTheme) onTheme(hero);
}
function addForm(){
  return `<form class="gm-add" id="gmAdd"><input name="name" placeholder="Name, e.g. Minecraft" required maxlength="60">
    <input name="exe" placeholder="Full path, e.g. C:\\Games\\Minecraft\\launcher.exe" required><button class="btn">Add</button></form>`;
}

/* ------------------------------------------------------------ actions */
async function play(id){
  if(busy || !data) return; const g = (data.games||[]).find(x=>x.id===id); if(!g) return;
  busy = true;
  const remote = !data.local;
  const ov = document.createElement("div"); ov.className = "gm-launch"; ov.style.setProperty("--h", hue(g.name));
  ov.innerHTML = `<div class="gm-launch-art"><span class="gm-gen"><b>${K.esc(initials(g.name))}</b></span>${img(g, "portrait", "gm-img")}</div>
    <div class="gm-launch-t"><b>${K.esc(g.name)}</b><span id="gmLs">${remote ? `Starting on ${K.esc(data.host)}…` : "Starting…"}</span></div>`;
  // the library scrolls, so pin the overlay to what's on screen and hold the scroll while it shows
  ov.style.top = root.scrollTop + "px"; ov.style.height = root.clientHeight + "px"; root.style.overflowY = "hidden";
  root.appendChild(ov); wireImgs(ov);
  let msg, ok = false;
  try{
    const r = await http(ep + "/api/games/launch", { method:"POST", headers:{ authorization:"Bearer " + tok, "content-type":"application/json" }, body:JSON.stringify({ id }) });
    const j = await r.json().catch(()=>({}));
    ok = !!j.ok; msg = ok ? (remote ? `Running on ${data.host}` : "Launched") : (j.error || `failed (${r.status})`);
  }catch(e){ msg = "Couldn't reach your PC"; }
  const ls = ov.querySelector("#gmLs"); if(ls){ ls.textContent = msg; ls.classList.add(ok ? "ok" : "bad"); }
  ov.classList.add(ok ? "done" : "fail");
  setTimeout(()=>{ ov.classList.add("out"); setTimeout(()=>{ ov.remove(); root.style.overflowY = ""; busy = false; if(ok) refresh(false); }, 400); }, ok ? 1600 : 2600);
}
async function refresh(force){ render(await load(force)); }

/* ------------------------------------------------------------ api */
export async function mountPlay(el, ctx, opts={}){
  K = ctx; root = el; alive = true; onTheme = opts.onTheme || null; busy = false;
  root.innerHTML = `<div class="gm-loading"><i></i><i></i><i></i><span>Reading your game library…</span></div>`;
  root.onclick = e=>{
    const p = e.target.closest("[data-play]"); if(p){ play(p.dataset.play); return; }
    const c = e.target.closest(".gm-card"); if(c){ play(c.dataset.id); return; }
    const f = e.target.closest("[data-f]"); if(f){ filter = f.dataset.f; render({ state:"ok", d:data }); return; }
    if(e.target.closest("#gmRefresh")){ refresh(true); return; }
    if(e.target.closest("#gmRetry")){ refresh(true); }
  };
  root.oninput = e=>{
    if(e.target.id !== "gmQ") return; q = e.target.value.trim().toLowerCase();
    const grid = root.querySelector("#gmGrid"); if(!grid) return;
    const shown = (data.games||[]).filter(g=> (filter === "all" || g.source === filter) && (!q || g.name.toLowerCase().includes(q)));
    grid.innerHTML = shown.map(cover).join("") || `<p class="gm-none">No games match.</p>`; wireImgs(grid);
  };
  root.onsubmit = async e=>{
    if(e.target.id !== "gmAdd") return; e.preventDefault();
    const f = e.target, r = await http(ep + "/api/games/custom", { method:"POST", headers:{ authorization:"Bearer " + tok, "content-type":"application/json" },
      body:JSON.stringify({ name:f.name.value, exe:f.exe.value }) }).catch(()=>null);
    const j = r ? await r.json().catch(()=>({})) : {};
    K.toast(j.ok ? `${f.name.value} added` : (j.error || "Couldn't add that game")); if(j.ok) refresh(true);
  };
  await refresh(false);
  return ()=>{ alive = false; if(root){ root.onclick = root.oninput = root.onsubmit = null; } };
}
