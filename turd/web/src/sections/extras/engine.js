// ===========================================================================
// EXTRAS ENGINE: resolves the newest official build of an item, downloads it
// through the native bridge (resume + SHA-256 check), installs or opens it,
// and keeps per-item state for the UI. In a plain browser there is no native
// side, so it hands back the official links instead of pretending to install.
//
// Native API: window.TURD_NATIVE (src/native.js). See NATIVE.md for the calls.
// ===========================================================================
import { WINGET } from "./winget.js";

const KEY = "turd_xtr_state";
const OLLAMA = "http://127.0.0.1:11434";

export function createEngine({ LS, http, toast, onChange }){
  const N = window.TURD_NATIVE || null, X = N && N.extras;
  const native = !!X;
  const plat = N ? (N.platform==="android" ? "and" : "win") : (/Android/i.test(navigator.userAgent) ? "and" : "win");
  const nhttp = (N && N.http) || http || ((u,o)=>fetch(u,o));
  let st = LS.get(KEY, {});
  const save = ()=>{ LS.set(KEY, st); onChange && onChange(); };
  const set = (id, patch)=>{ st[id] = { ...(st[id]||{}), ...patch, t:Date.now() }; save(); };
  const speed = {};   // id → {t, got, bps}

  if(N && N.on) N.on("extras:progress", p=>{
    if(!p || !p.id) return;
    const s = st[p.id] || {}, now = performance.now(), sp = speed[p.id] || (speed[p.id] = { t:now, got:p.received||0, bps:0 });
    if(now - sp.t > 800){ sp.bps = 0.6*sp.bps + 0.4*((p.received - sp.got)/((now-sp.t)/1000)); sp.t=now; sp.got=p.received; }
    st[p.id] = { ...s, st: p.state==="verifying" ? "verifying" : (s.st==="done" ? "done" : "active"), got:p.received, total:p.total||s.total, line:p.line||s.line };
    onChange && onChange(p.id);
  });

  /* ---------------------------------------------------------- resolvers */
  // Kiwix: ask the official OPDS catalog for the newest build of this ZIM.
  async function resolveZim(it){
    const out = { url:it.zim.url, name:it.zim.file, size:it.mb*1048576, sha256:null, fresh:false };
    try{
      const r = await nhttp(`https://library.kiwix.org/catalog/v2/entries?name=${encodeURIComponent(it.zim.name)}&count=5`);
      if(r.ok){
        const xml = new DOMParser().parseFromString(await r.text(), "application/xml");
        const link = [...xml.querySelectorAll("entry link")].find(l=>/x-zim/.test(l.getAttribute("type")||"") || /\.zim(\.meta4)?$/.test(l.getAttribute("href")||""));
        if(link){ const href = link.getAttribute("href").replace(/\.meta4$/,"");
          out.url = href; out.name = href.split("/").pop(); out.size = +(link.getAttribute("length")||out.size); out.fresh = true; }
      }
    }catch(e){}
    try{ const r = await nhttp(out.url + ".sha256"); if(r.ok){ const m = /\b([a-f0-9]{64})\b/i.exec(await r.text()); if(m) out.sha256 = m[1].toLowerCase(); } }catch(e){}
    return out;
  }
  // Hugging Face: size + SHA-256 straight from the repo's LFS metadata.
  async function resolveGguf(it){
    const out = { url:it.hf.url, name:it.hf.file, size:it.mb*1048576, sha256:null };
    try{
      const r = await nhttp(`https://huggingface.co/api/models/${it.hf.repo}/tree/main`);
      const f = (await r.json()).find(x=>x.path===it.hf.file);
      if(f && f.lfs){ out.sha256 = f.lfs.oid; out.size = f.lfs.size || f.size; }
    }catch(e){}
    return out;
  }
  // F-Droid: newest suggested build of a package.
  async function resolveFdroid(pkg){
    try{ const r = await nhttp(`https://f-droid.org/api/v1/packages/${pkg}`);
      if(r.ok){ const j = await r.json(); const vc = j.suggestedVersionCode || (j.packages && j.packages[0] && j.packages[0].versionCode);
        if(vc) return `https://f-droid.org/repo/${pkg}_${vc}.apk`; } }catch(e){}
    return null;
  }

  /* ---------------------------------------------------------- links for the browser preview */
  const play = pkg => `https://play.google.com/store/apps/details?id=${pkg}`;
  const fdPage = pkg => `https://f-droid.org/packages/${pkg}/`;
  function links(it, p=plat){
    const L = [];
    if(it.kind==="zim") L.push({ label:"Download .zim", url:it.zim.url, main:1 }, { label:"Torrent", url:it.zim.url+".torrent" });
    if(it.kind==="gguf") L.push({ label:"Download .gguf", url:it.hf.url, main:1 }, { label:"Model page", url:`https://huggingface.co/${it.hf.repo}` });
    if(it.kind==="ollama") L.push({ label:"Model page", url:`https://ollama.com/library/${it.ollama.split(":")[0]}`, main:1 });
    if(it.kind==="app" && p==="win" && it.win){
      const w = it.win.wg && WINGET[it.win.wg];
      if(w) L.push({ label:"Official installer", url:w.url, main:1 });
      if(it.win.url) L.push({ label:"Download", url:it.win.url, main:!w });
      if(it.win.page) L.push({ label:"Official page", url:it.win.page, main:!w && !it.win.url });
    }
    if(it.kind==="app" && p==="and" && it.and){
      const a = it.and;
      if(a.apk) L.push({ label:"APK", url:a.apk, main:1 });
      if(a.fd) L.push({ label:"F-Droid", url:fdPage(a.pkg), main:!a.apk });
      if(a.play) L.push({ label:"Play Store", url:play(a.pkg), main:!a.apk && !a.fd });
      if(a.page) L.push({ label:"Official page", url:a.page, main:!L.length });
    }
    return L;
  }
  const wingetCmd = it => it.win && it.win.wg ? `winget install --id ${it.win.wg} -e` : it.kind==="ollama" ? `ollama pull ${it.ollama}` : null;
  const available = (it, p=plat)=> it.both || (p==="win" ? !!it.win : !!it.and);

  /* ---------------------------------------------------------- native install */
  async function dl(id, { url, name, sha256, size }){
    set(id, { st:"active", got:0, total:size||0, url, file:name, sha:sha256||null, err:null, line:sha256?"SHA-256 will be verified":"" });
    const r = await X.download({ id, url, name, sha256: sha256 || undefined, dir: LS.get("turd_xtr_dir", null) || undefined });
    set(id, { st:"done", got:r.size, total:r.size, path:r.path, verified: r.verified!==undefined ? !!r.verified : !!sha256, line:"" });
    return r;
  }

  async function install(it, p=plat){
    if(!native) return { links:links(it,p) };
    const id = it.id;
    try{
      if(it.kind==="zim"){ set(id,{st:"resolving"}); const r = await resolveZim(it); await dl(id, r); set(id,{ version:r.name }); toast(`${it.name} ready`); return {ok:1}; }
      if(it.kind==="gguf"){ set(id,{st:"resolving"}); await dl(id, await resolveGguf(it)); toast(`${it.name} saved: load it in PocketPal, Maid, LM Studio or Jan`); return {ok:1}; }
      if(it.kind==="ollama") return pullOllama(it);
      if(it.kind==="app" && p==="win") return installWin(it);
      if(it.kind==="app" && p==="and") return installAnd(it);
    }catch(e){ set(id,{ st:"error", err:String(e && e.message || e) }); toast(`${it.name}: ${String(e && e.message || e).slice(0,80)}`); return { error:e }; }
  }

  async function installWin(it){
    const w = it.win || {}, id = it.id, wg = w.wg && WINGET[w.wg];
    if(w.wg && X.winget){
      set(id,{ st:"active", line:"winget install "+w.wg, got:0, total:0 });
      const r = await X.winget(w.wg).catch(e=>({ ok:false, err:String(e) }));
      if(r && r.ok){ set(id,{ st:"installed", line:"", version:wg && wg.v }); toast(it.name+" installed"); return {ok:1}; }
      set(id,{ line:"winget unavailable, using the verified installer" });
    }
    const url = wg ? wg.url : w.url;
    if(!url){ N.openExternal(w.page); set(id,{st:null}); return { opened:w.page }; }
    const name = decodeURIComponent(url.split("/").filter(s=>s && s!=="download").pop()).replace(/[^\w.\-+]/g,"_");
    await dl(id, { url, name, sha256: wg && wg.sha, size:(it.win.mb||0)*1048576 });
    if(w.zip || (wg && wg.t==="zip")){ const u = await X.unzip(id); set(id,{ st:"installed", dir:u.dir, line:"" }); toast(`${it.name} unpacked`); return {ok:1}; }
    if(wg && wg.t==="portable"){ set(id,{ st:"installed" }); return {ok:1}; }
    await X.open(id); set(id,{ st:"installed", line:"" }); toast(`${it.name}: finish in the installer window`); return {ok:1};
  }

  async function installAnd(it){
    const a = it.and || {}, id = it.id;
    let apk = null;
    if(a.fd){ set(id,{st:"resolving"}); apk = await resolveFdroid(a.pkg); }
    if(!apk && a.apk) apk = a.apk;
    if(apk){
      await dl(id, { url:apk, name:a.pkg+".apk", size:(a.mb||0)*1048576 });
      set(id,{ line:"Android checks the app signature during install" });
      await X.open(id); set(id,{ st:"installed", line:"" }); return {ok:1};
    }
    const url = a.play ? play(a.pkg) : a.page;
    await N.openExternal(a.play ? `market://details?id=${a.pkg}` : url).catch(()=>N.openExternal(url));
    set(id,{st:null}); return { opened:url };
  }

  /* ---------------------------------------------------------- Ollama */
  async function ollamaUp(){
    try{ const r = await fetch(OLLAMA+"/api/tags", { signal:AbortSignal.timeout(1500) }); if(r.ok) return (await r.json()).models||[]; }catch(e){}
    if(N){ try{ const r = await nhttp(OLLAMA+"/api/tags"); if(r.ok) return (await r.json()).models||[]; }catch(e){} }
    return null;
  }
  async function pullOllama(it){
    const id = it.id;
    set(id,{ st:"active", got:0, total:it.mb*1048576, line:"ollama pull "+it.ollama });
    try{
      const r = await fetch(OLLAMA+"/api/pull", { method:"POST", body:JSON.stringify({ model:it.ollama, stream:true }) });
      if(!r.ok || !r.body) throw new Error("ollama "+r.status);
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
      for(;;){ const { value, done } = await rd.read(); if(done) break;
        buf += dec.decode(value, { stream:true }); let i;
        while((i = buf.indexOf("\n"))>=0){ const line = buf.slice(0,i); buf = buf.slice(i+1); if(!line.trim()) continue;
          const j = JSON.parse(line); if(j.error) throw new Error(j.error);
          st[id] = { ...st[id], st:"active", got:j.completed||st[id].got, total:j.total||st[id].total, line:j.status||"" }; onChange && onChange(id);
          if(j.status==="success"){ set(id,{ st:"installed", line:"" }); toast(it.name+" ready in Ollama"); } } }
      return {ok:1};
    }catch(e){
      if(!N) throw e;
      // CORS-free fallback without live progress
      set(id,{ line:"pulling (no live progress)…" });
      const r = await nhttp(OLLAMA+"/api/pull", { method:"POST", body:JSON.stringify({ model:it.ollama, stream:false }) });
      const j = await r.json(); if(j.status!=="success") throw new Error(j.error||"pull failed");
      set(id,{ st:"installed", line:"" }); return {ok:1};
    }
  }
  async function removeOllama(it){ await fetch(OLLAMA+"/api/delete", { method:"DELETE", body:JSON.stringify({ model:it.ollama }) }).catch(()=>nhttp(OLLAMA+"/api/delete",{ method:"DELETE", body:JSON.stringify({ model:it.ollama }) })); }

  /* ---------------------------------------------------------- housekeeping */
  async function remove(it){
    if(it.kind==="ollama") await removeOllama(it);
    else if(X) await X.remove(it.id).catch(()=>{});
    delete st[it.id]; save();
  }
  async function cancel(it){ if(X) await X.cancel(it.id).catch(()=>{}); set(it.id,{ st:"paused" }); }
  async function open(it){ if(X) return X.open(it.id); }

  // reconcile with what's actually on disk / installed (runs on mount)
  async function sync(items){
    if(X){
      try{ const files = await X.list({ partial:true }); const have = new Set();
        for(const f of files){ have.add(f.id); const s = st[f.id]||{};
          st[f.id] = { ...s, path:f.path, got:f.size, total:s.total||f.size, st: f.partial ? (s.st==="active" ? "active" : "paused") : (s.st==="installed" ? "installed" : "done") }; }
        for(const [id,s] of Object.entries(st)) if(!have.has(id) && (s.st==="done" || s.st==="paused" || s.st==="active")) delete st[id];
      }catch(e){}
      try{
        const ids = items.filter(i=>i.kind==="app").map(i=> plat==="and" ? i.and && i.and.pkg : i.win && i.win.wg).filter(Boolean);
        const inst = await X.isInstalled(ids);
        for(const it of items){ if(it.kind!=="app") continue; const k = plat==="and" ? it.and && it.and.pkg : it.win && it.win.wg;
          if(k && inst[k]) st[it.id] = { ...(st[it.id]||{}), st:"installed", version:inst[k] };
          else if(k && st[it.id] && st[it.id].st==="installed" && inst[k]===null) delete st[it.id]; }
      }catch(e){}
    }
    const models = await ollamaUp();
    if(models) for(const it of items.filter(i=>i.kind==="ollama")){
      const has = models.some(m=>m.name===it.ollama || m.name===it.ollama+":latest" || m.model===it.ollama);
      if(has) st[it.id] = { ...(st[it.id]||{}), st:"installed" }; else if(st[it.id] && st[it.id].st==="installed") delete st[it.id];
    }
    save();
    return { ollama: !!models, models: models||[] };
  }

  return { native, plat, state:id=>st[id]||null, all:()=>st, speed:id=>speed[id]&&speed[id].bps||0,
    install, remove, cancel, open, sync, links, wingetCmd, available, ollamaUp,
    info: ()=> X ? X.info({ dir: LS.get("turd_xtr_dir", null) || undefined }).catch(()=>null) : (navigator.storage && navigator.storage.estimate ? navigator.storage.estimate().then(e=>({ freeBytes:e.quota-e.usage, web:1 })).catch(()=>null) : Promise.resolve(null)),
    dirs: ()=> X && X.dirs ? X.dirs().catch(()=>[]) : Promise.resolve([]),
    pickDir: ()=> X && X.pickDir ? X.pickDir().catch(()=>null) : Promise.resolve(null),
    launch: it=> X && plat==="and" && it.and ? X.launch(it.and.pkg) : null,
    openExternal: url=> N ? N.openExternal(url) : window.open(url, "_blank", "noopener"),
    // random-access source for a downloaded ZIM (reader)
    zimSource: async (it)=>{
      if(!X) return null;
      if(X.readRange){ const s = st[it.id]||{}; return { name:s.file||it.zim.file, size:s.total||s.got, read: async(o,n)=>{ // the bridge caps one call at 16 MB
        const one = (o,n)=>X.readRange(it.id,o,n).then(b=>b instanceof Uint8Array?b:new Uint8Array(b)), MAX = 16*1048576;
        if(n<=MAX) return one(o,n);
        const out = new Uint8Array(n); for(let k=0;k<n;k+=MAX) out.set(await one(o+k, Math.min(MAX,n-k)), k); return out; } }; }
      if(X.fileUrl){ const { urlSource } = await import("./zim.js"); return urlSource(await X.fileUrl(it.id), it.zim.file); }
      return null;
    },
  };
}
