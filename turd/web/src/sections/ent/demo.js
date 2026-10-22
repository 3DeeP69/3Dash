// ===========================================================================
// BROWSER PREVIEW for the Entertainment viewer.
// The real sites refuse to load inside a web page (X-Frame-Options / CSP), so
// the preview uses each service's official embed player instead:
//   YouTube    search + trending through public Piped / Invidious mirrors,
//              playback through youtube-nocookie embeds
//   TikTok     paste a video link → TikTok's embed player
//   Twitch     channel name → Twitch's embed player
//   SoundCloud paste a track/playlist link → SoundCloud's widget
// The Windows and Android apps never use this file.
// ===========================================================================

let root = null, K = null, app = null, cb = {}, stack = [], idx = -1, ctl = null;

const PIPED = ["https://pipedapi.kavin.rocks","https://pipedapi.adminforge.de","https://api.piped.private.coffee"];
const INVID = ["https://inv.nadeko.net","https://invidious.nerdvpn.de","https://yewtu.be"];

async function firstOk(urls, map){
  for(const u of urls){
    try{
      const c = new AbortController(); const t = setTimeout(()=>c.abort(), 5000);
      const r = await fetch(u, { signal:c.signal }); clearTimeout(t);
      if(!r.ok) continue; const j = await r.json(); const out = map(j);
      if(out && out.length) return out;
    }catch(e){}
  }
  return null;
}
const ytId = s=>{ const m = /(?:youtu\.be\/|v=|\/embed\/|\/shorts\/|\/live\/)([\w-]{11})/.exec(s) || /^([\w-]{11})$/.exec(s.trim()); return m && m[1]; };
const dur = s=> !s || s < 0 ? "" : `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
const views = n=> !n ? "" : n >= 1e6 ? (n/1e6).toFixed(1)+"M views" : n >= 1e3 ? Math.round(n/1e3)+"K views" : n+" views";

async function ytSearch(q){
  const piped = await firstOk(PIPED.map(b=> q ? `${b}/search?q=${encodeURIComponent(q)}&filter=videos` : `${b}/trending?region=US`), j=>{
    const items = Array.isArray(j) ? j : j.items || [];
    return items.filter(v=>v.url && /watch\?v=/.test(v.url)).map(v=>({ id:ytId(v.url), title:v.title, ch:v.uploaderName, thumb:v.thumbnail, d:v.duration, v:v.views }));
  });
  if(piped) return piped;
  return firstOk(INVID.map(b=> q ? `${b}/api/v1/search?q=${encodeURIComponent(q)}&type=video` : `${b}/api/v1/trending?region=US`), j=>
    (Array.isArray(j) ? j : []).filter(v=>v.videoId).map(v=>({ id:v.videoId, title:v.title, ch:v.author,
      thumb:`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`, d:v.lengthSeconds, v:v.viewCount })));
}

/* ------------------------------------------------------------ pages */
function page(p, push=true){
  if(push){ stack = stack.slice(0, idx+1); stack.push(p); idx = stack.length-1; }
  if(ctl) ctl.abort(); ctl = new AbortController();
  const render = { ytHome, ytPlay, ttHome, ttPlay, twHome, twPlay, scHome, scPlay, native }[p.k];
  root.innerHTML = ""; render(p);
}
const note = ()=>`<div class="ed-note"><b>Browser preview.</b> In the Windows and Android app this opens the full ${K.esc(app.name)} site in an in-app view with the ad shield on.</div>`;

function ytHome(p){
  root.innerHTML = `<div class="ed ed-yt">
    <form class="ed-q"><input name="q" value="${K.esc(p.q||"")}" placeholder="Search YouTube" autocomplete="off"><button class="btn">Search</button></form>
    <div class="ed-paste">or paste a YouTube link</div>
    <div class="ed-grid" id="edGrid">${Array.from({length:8},()=>`<div class="ed-card sk"><i></i><b></b><b></b></div>`).join("")}</div>${note()}</div>`;
  const f = root.querySelector("form");
  f.onsubmit = e=>{ e.preventDefault(); const q = f.q.value.trim(); const id = ytId(q); if(id) return page({ k:"ytPlay", id, title:"" }); page({ k:"ytHome", q }); };
  cb.onTitle && cb.onTitle(p.q ? `Search: ${p.q}` : "YouTube · Trending");
  const sig = ctl.signal;
  ytSearch(p.q).then(list=>{
    if(sig.aborted) return; const g = root.querySelector("#edGrid"); if(!g) return;
    if(!list){ g.innerHTML = `<div class="ed-empty">The public YouTube mirrors used by the preview are unreachable right now. Paste a YouTube link above to play it, or open the Windows / Android app for the full site.</div>`; return; }
    g.innerHTML = list.slice(0, 24).map(v=>`<button class="ed-card" data-id="${v.id}" data-t="${K.esc(v.title)}">
      <span class="ed-th"><img loading="lazy" src="${K.esc(v.thumb)}" alt=""><em>${dur(v.d)}</em></span>
      <b>${K.esc(v.title)}</b><span>${K.esc(v.ch||"")}${v.v?" · "+views(v.v):""}</span></button>`).join("");
    g.onclick = e=>{ const c = e.target.closest("[data-id]"); if(c) page({ k:"ytPlay", id:c.dataset.id, title:c.dataset.t }); };
  });
}
function ytPlay(p){
  root.innerHTML = `<div class="ed ed-play"><div class="ed-player"><iframe allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen
    src="https://www.youtube-nocookie.com/embed/${p.id}?autoplay=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3"></iframe></div>
    <div class="ed-ptitle">${K.esc(p.title||"")}</div>${note()}</div>`;
  cb.onTitle && cb.onTitle(p.title || "YouTube");
  cb.onRecent && cb.onRecent(`https://www.youtube.com/watch?v=${p.id}`, p.title);
}
function linkHome(p, { label, re, k }){
  root.innerHTML = `<div class="ed ed-link"><div class="ed-big">${K.esc(label)}</div>
    <form class="ed-q"><input name="q" placeholder="${K.esc(p.ph)}" autocomplete="off"><button class="btn">Play</button></form>${note()}</div>`;
  const f = root.querySelector("form");
  f.onsubmit = e=>{ e.preventDefault(); const v = f.q.value.trim(); const m = re(v); if(m) page({ k, v:m }); else K.toast("That doesn't look like a " + app.name + " link"); };
  cb.onTitle && cb.onTitle(app.name);
}
const frame = (src, cls="")=>`<div class="ed ed-play ${cls}"><div class="ed-player"><iframe allow="autoplay; encrypted-media; fullscreen" allowfullscreen src="${src}"></iframe></div>${note()}</div>`;
function ttHome(p){ linkHome({ ph:"Paste a TikTok video link" }, { label:"Paste a TikTok link to play it here", k:"ttPlay", re:v=>(/\/video\/(\d{8,})/.exec(v)||/^(\d{8,})$/.exec(v)||[])[1] }); }
function ttPlay(p){ root.innerHTML = frame(`https://www.tiktok.com/player/v1/${p.v}?autoplay=1&loop=1&music_info=1&description=1&rel=0`, "tall"); cb.onTitle && cb.onTitle("TikTok"); cb.onRecent && cb.onRecent(`https://www.tiktok.com/@/video/${p.v}`, "TikTok video"); }
function twHome(p){ linkHome({ ph:"Channel name, e.g. shroud" }, { label:"Watch a Twitch channel", k:"twPlay", re:v=>(/twitch\.tv\/([\w]{3,25})/.exec(v)||/^([\w]{3,25})$/.exec(v)||[])[1] }); }
function twPlay(p){ root.innerHTML = frame(`https://player.twitch.tv/?channel=${encodeURIComponent(p.v)}&parent=${encodeURIComponent(location.hostname||"localhost")}&autoplay=true&muted=false`); cb.onTitle && cb.onTitle(p.v + " · Twitch"); cb.onRecent && cb.onRecent(`https://www.twitch.tv/${p.v}`, p.v); }
function scHome(p){ linkHome({ ph:"Paste a SoundCloud track or playlist link" }, { label:"Play something from SoundCloud", k:"scPlay", re:v=>/soundcloud\.com\/.+/.test(v) ? v : null }); }
function scPlay(p){ root.innerHTML = frame(`https://w.soundcloud.com/player/?url=${encodeURIComponent(p.v)}&auto_play=true&visual=true&show_comments=false&hide_related=true`); cb.onTitle && cb.onTitle("SoundCloud"); cb.onRecent && cb.onRecent(p.v, "SoundCloud"); }
function native(){
  root.innerHTML = `<div class="ed ed-native"><div class="ed-big">${K.esc(app.name)} opens in the app</div>
    <p>${K.esc(app.name)} doesn't allow itself to be shown inside a web page, so the browser preview can't load it. In the Windows and Android builds it opens right here, full site, logged in, ad shield on.</p>
    <a class="btn" href="${K.esc(app.url)}" target="_blank" rel="noopener">Open ${K.esc(new URL(app.url).hostname.replace(/^www\./,""))} in a new tab</a></div>`;
  cb.onTitle && cb.onTitle(app.name);
}

/* ------------------------------------------------------------ api */
export function mount(vp, a, url, k, callbacks){
  K = k; app = a; cb = callbacks || {}; stack = []; idx = -1;
  root = document.createElement("div"); root.className = "ed-root"; vp.appendChild(root);
  const boot = vp.querySelector(".ent-boot"); if(boot) setTimeout(()=>boot.classList.add("gone"), 60);
  const kind = a.demo || (["youtube","tiktok","twitch","soundcloud"].includes(a.site) ? a.site : null);
  if(kind === "youtube"){ const id = url && ytId(url); if(id) return page({ k:"ytPlay", id }); const q = url && /search_query=([^&]+)/.exec(url); return page({ k:"ytHome", q: q ? decodeURIComponent(q[1].replace(/\+/g," ")) : "" }); }
  if(kind === "tiktok"){ const m = url && /\/video\/(\d+)/.exec(url); return page(m ? { k:"ttPlay", v:m[1] } : { k:"ttHome" }); }
  if(kind === "twitch"){ const m = url && /twitch\.tv\/(\w{3,25})$/.exec(url); return page(m ? { k:"twPlay", v:m[1] } : { k:"twHome" }); }
  if(kind === "soundcloud"){ return page(url && /soundcloud\.com\/[^/]+\/[^/?]+/.test(url) && !/\/discover|\/search/.test(url) ? { k:"scPlay", v:url } : { k:"scHome" }); }
  page({ k:"native" });
}
export function nav(k){
  if(!root) return;
  if(k === "back" && idx > 0){ idx--; page(stack[idx], false); }
  else if(k === "forward" && idx < stack.length-1){ idx++; page(stack[idx], false); }
  else if(k === "reload" && stack[idx]) page(stack[idx], false);
  else if(k === "home" && stack[0]) page(stack[0]);
}
export function unmount(){ if(ctl) ctl.abort(); if(root) root.remove(); root = null; }
