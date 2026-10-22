// ===========================================================================
// READER: Kiwix-style viewer for .zim files, right inside T.U.R.D.
// Pages render in a script-less sandboxed frame; images, CSS and links are
// pulled straight out of the ZIM, so it works fully offline.
// ===========================================================================
import { Zim, fileSource } from "./zim.js";

const esc = s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const BASE = "https://zim.invalid/";
const NIGHT = `html{filter:invert(.9) hue-rotate(180deg);background:#fff}
  img,video,picture,svg,[style*="background-image"],.mwe-math-fallback-image-inline,.mwe-math-fallback-image-display{filter:invert(1) hue-rotate(180deg)}`;
const FRAME_CSS = `html{scroll-behavior:smooth}body{margin:0 auto;max-width:980px;padding:18px 22px 60px;font:17px/1.6 -apple-system,"Segoe UI",Roboto,sans-serif}
  img{max-width:100%;height:auto}table{max-width:100%}a{cursor:pointer}::selection{background:#ffd447;color:#000}
  .turd-noimg{display:inline-block;min-width:24px;min-height:14px;background:#eee;border-radius:3px}`;

/* ---------------------------------------------------------- recent files (IndexedDB, Chromium file handles) */
const idb = (()=>{ let p; const db = ()=> p || (p = new Promise((res,rej)=>{ const r = indexedDB.open("turd_xtr",1);
  r.onupgradeneeded = ()=> r.result.createObjectStore("zims"); r.onsuccess = ()=>res(r.result); r.onerror = ()=>rej(r.error); }));
  const tx = (mode, fn)=> db().then(d=>new Promise((res,rej)=>{ const t=d.transaction("zims",mode), s=t.objectStore("zims"), q=fn(s); t.oncomplete=()=>res(q&&q.result); t.onerror=()=>rej(t.error); }));
  return { put:(k,v)=>tx("readwrite",s=>s.put(v,k)), all:()=>tx("readonly",s=>s.getAll()), del:k=>tx("readwrite",s=>s.delete(k)) };
})();
export async function recentZims(){ try{ return (await idb.all()||[]).sort((a,b)=>b.t-a.t); }catch(e){ return []; } }
export async function forgetZim(name){ try{ await idb.del(name); }catch(e){} }
export async function pickZim(){
  if(window.showOpenFilePicker){
    const [h] = await window.showOpenFilePicker({ types:[{ description:"Kiwix ZIM", accept:{ "application/octet-stream":[".zim"] } }] });
    const f = await h.getFile(); try{ await idb.put(f.name, { name:f.name, size:f.size, t:Date.now(), handle:h }); }catch(e){}
    return fileSource(f);
  }
  return new Promise((res,rej)=>{ const i=document.createElement("input"); i.type="file"; i.accept=".zim";
    i.onchange=()=> i.files[0] ? res(fileSource(i.files[0])) : rej(new Error("no file")); i.click(); });
}
export async function reopenRecent(rec){
  const h = rec.handle; if(!h) throw new Error("re-open the file");
  if((await h.queryPermission({mode:"read"}))!=="granted" && (await h.requestPermission({mode:"read"}))!=="granted") throw new Error("permission denied");
  rec.t = Date.now(); try{ await idb.put(rec.name, rec); }catch(e){}
  return fileSource(await h.getFile());
}

/* ---------------------------------------------------------- the viewer */
export function createReader(host, { toast, openExternal, onClose, LS }){
  let zim = null, cur = null, back = [], fwd = [], urls = [], navTok = 0;
  const night = ()=> LS.get("turd_xtr_night", true);
  host.innerHTML = `
    <div class="xr-bar">
      <button class="xr-b" data-a="close" title="Close book">✕</button>
      <button class="xr-b" data-a="back" title="Back">◀</button>
      <button class="xr-b" data-a="fwd" title="Forward">▶</button>
      <button class="xr-b" data-a="home" title="Main page">⌂</button>
      <button class="xr-b" data-a="rand" title="Random article">⤨</button>
      <div class="xr-q"><input placeholder="Search titles…" autocomplete="off" spellcheck="false"><div class="xr-sug" hidden></div></div>
      <button class="xr-b" data-a="night" title="Night mode">◐</button>
      <span class="xr-book"></span>
    </div>
    <div class="xr-stage"><iframe class="xr-frame" sandbox="allow-same-origin" referrerpolicy="no-referrer" title="Offline article"></iframe><div class="xr-busy" hidden><i></i><i></i><i></i></div></div>`;
  const $ = s=>host.querySelector(s), frame=$(".xr-frame"), q=$(".xr-q input"), sug=$(".xr-sug"), busy=$(".xr-busy");

  const revoke = ()=>{ urls.forEach(u=>URL.revokeObjectURL(u)); urls=[]; };
  const toPath = (href, from)=>{
    let u; try{ u = new URL(href, BASE + from.split("/").map(encodeURIComponent).join("/")); }catch(e){ return null; }
    if(u.origin+"/" !== BASE) return { ext:u.href };
    let p; try{ p = decodeURIComponent(u.pathname.slice(1)); }catch(e){ p = u.pathname.slice(1); }
    return { path:p, hash:u.hash };
  };

  async function go(path, hash, push=true){
    const tok = ++navTok; busy.hidden = false;
    try{
      let e = path ? await zim.byPath(path) : await zim.main();
      if(!e){ toast("not in this book: "+path); return; }
      e = await zim.follow(e);
      if(tok!==navTok) return;
      if(!/html/.test(e.mime||"")){
        const b = new Blob([await zim.data(e)], { type:e.mime||"application/octet-stream" }), u = URL.createObjectURL(b);
        if(/^image\//.test(e.mime)){ urls.push(u); frame.srcdoc = `<body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#111"><img src="${u}" style="max-width:100%"></body>`; }
        else { const a=document.createElement("a"); a.href=u; a.download=e.url.split("/").pop(); a.click(); setTimeout(()=>URL.revokeObjectURL(u),5000); }
        return;
      }
      if(push && cur) { back.push(cur); fwd = []; }
      cur = e.path;
      await render(e, hash, tok);
    }catch(err){ toast(String(err.message||err).slice(0,120)); }
    finally{ if(tok===navTok) busy.hidden = true; }
  }

  async function render(e, hash, tok){
    const doc = new DOMParser().parseFromString(await zim.text(e), "text/html");
    doc.querySelectorAll("script,iframe,object,embed,noscript").forEach(n=>n.remove());
    doc.querySelectorAll("[onclick],[onload],[onerror]").forEach(n=>{ n.removeAttribute("onclick"); n.removeAttribute("onload"); n.removeAttribute("onerror"); });
    // stylesheets → inline <style> pulled from the ZIM
    for(const l of [...doc.querySelectorAll('link[rel~="stylesheet"][href]')]){
      const r = toPath(l.getAttribute("href"), e.path); l.remove();
      if(r && r.path){ try{ const ce = await zim.byPath(r.path); if(ce){ const s = doc.createElement("style"); s.textContent = (await zim.text(ce)).replace(/url\([^)]*\)/g,"none"); doc.head.appendChild(s); } }catch(_){} }
    }
    const st = doc.createElement("style"); st.textContent = FRAME_CSS + (night() ? NIGHT : ""); doc.head.appendChild(st);
    // images: remember the ZIM path, fill in after the frame loads
    doc.querySelectorAll("img[src],source[srcset],img[srcset]").forEach(n=>{
      const src = n.getAttribute("src") || (n.getAttribute("srcset")||"").split(/[ ,]/)[0];
      const r = src && !/^data:/.test(src) ? toPath(src, e.path) : null;
      n.removeAttribute("srcset"); if(n.tagName==="SOURCE") { n.remove(); return; }
      if(r && r.path){ n.setAttribute("data-zp", r.path); n.removeAttribute("src"); n.classList.add("turd-noimg"); }
    });
    doc.querySelectorAll("a[href]").forEach(a=>a.removeAttribute("target"));
    if(tok!==navTok) return;
    revoke();
    $(".xr-book").textContent = (e.title||"") + " · " + (zim.meta.Title || zim.src.name);
    await new Promise(res=>{ frame.onload = res; frame.srcdoc = "<!doctype html>" + doc.documentElement.outerHTML; });
    const d = frame.contentDocument; if(!d) return;
    d.addEventListener("click", ev=>{
      const a = ev.target.closest && ev.target.closest("a[href]"); if(!a) return;
      ev.preventDefault();
      const href = a.getAttribute("href");
      if(href.startsWith("#")){ const t = d.getElementById(decodeURIComponent(href.slice(1))); t && t.scrollIntoView(); return; }
      const r = toPath(href, cur); if(!r) return;
      if(r.ext){ if(/^https?:/.test(r.ext)) openExternal(r.ext); return; }
      go(r.path, r.hash);
    });
    d.addEventListener("keydown", keys);
    if(hash){ const t = d.getElementById(decodeURIComponent(hash.slice(1))); t && t.scrollIntoView(); } else frame.contentWindow.scrollTo(0,0);
    // stream images in, a few at a time
    const imgs = [...d.querySelectorAll("img[data-zp]")]; let k = 0;
    const worker = async()=>{ while(k<imgs.length && tok===navTok){ const img = imgs[k++];
      try{ const ie = await zim.byPath(img.dataset.zp); if(!ie) continue; const fe = await zim.follow(ie);
        const u = URL.createObjectURL(new Blob([await zim.data(fe)], { type:fe.mime||"image/webp" })); urls.push(u);
        img.src = u; img.classList.remove("turd-noimg"); }catch(_){} } };
    Promise.all([worker(),worker(),worker(),worker()]);
  }

  /* ---------- search ---------- */
  let qt = 0, qn = 0, sel = -1, items = [], itemsQ = "";
  const showSug = (list, v)=>{ items = list; itemsQ = v; sel = -1;
    sug.innerHTML = list.length ? list.map((x,i)=>`<button data-i="${i}">${esc(x.title)}</button>`).join("") : `<div class="xr-none">No titles start with that</div>`;
    sug.hidden = false; };
  q.addEventListener("input", ()=>{ clearTimeout(qt); const v=q.value; if(!v.trim()){ sug.hidden=true; return; }
    const n = ++qn; qt = setTimeout(async()=>{ const r = await zim.search(v, 12).catch(()=>[]); if(q.value===v && n===qn) showSug(r, v); }, 120); });
  q.addEventListener("keydown", ev=>{
    if(ev.key==="ArrowDown"||ev.key==="ArrowUp"){ ev.preventDefault(); sel = Math.max(0, Math.min(items.length-1, sel + (ev.key==="ArrowDown"?1:-1)));
      sug.querySelectorAll("button").forEach((b,i)=>b.classList.toggle("on", i===sel)); }
    else if(ev.key==="Enter"){ ev.preventDefault(); clearTimeout(qt); qn++; const v = q.value;
      const pick = it=>{ if(it){ go(it.path); sug.hidden=true; q.blur(); } else if(v.trim()) toast("Nothing in this pack starts with \u201c"+v.trim()+"\u201d"); };
      if(itemsQ===v && items.length) pick(items[sel<0?0:sel]);
      else zim.search(v, 12).then(r=>{ items = r; itemsQ = v; pick(r[0]); }).catch(()=>pick(null)); }
    else if(ev.key==="Escape"){ sug.hidden=true; q.blur(); }
  });
  sug.addEventListener("mousedown", ev=>{ const b = ev.target.closest("button[data-i]"); if(!b) return; ev.preventDefault(); go(items[+b.dataset.i].path); sug.hidden=true; q.value=""; });
  q.addEventListener("blur", ()=> setTimeout(()=>sug.hidden=true, 150));

  function keys(ev){
    if(!host.isConnected || host.hidden) return;
    if(ev.altKey && ev.key==="ArrowLeft") act("back");
    if(ev.altKey && ev.key==="ArrowRight") act("fwd");
    if(ev.key==="/" && document.activeElement!==q){ ev.preventDefault(); q.focus(); }
  }
  async function act(a){
    if(a==="close") return onClose && onClose();
    if(!zim) return;
    if(a==="back" && back.length){ fwd.push(cur); go(back.pop(), null, false); }
    if(a==="fwd" && fwd.length){ back.push(cur); go(fwd.pop(), null, false); }
    if(a==="home") go(null);
    if(a==="rand"){ const e = await zim.random(); go(e.path); }
    if(a==="night"){ LS.set("turd_xtr_night", !night()); go(cur, null, false); }
  }
  host.querySelector(".xr-bar").addEventListener("click", ev=>{ const b = ev.target.closest("[data-a]"); if(b) act(b.dataset.a); });
  document.addEventListener("keydown", keys);

  return {
    async open(src, start){
      busy.hidden = false;
      try{ zim = await Zim.open(src); back=[]; fwd=[]; cur=null; await go(start||null); return zim; }
      catch(e){ busy.hidden = true; throw e; }
    },
    get zim(){ return zim; },
    destroy(){ navTok++; revoke(); document.removeEventListener("keydown", keys); },
  };
}
