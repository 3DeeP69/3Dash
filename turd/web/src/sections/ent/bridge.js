// ===========================================================================
// ENTERTAINMENT BRIDGE — one API over the three places T.U.R.D. runs:
//   tauri    Windows app. Real sites in Tauri child web views (WebView2),
//            laid exactly over the viewer area; ad requests killed natively.
//   android  Capacitor app. Real sites in native Android WebViews via the
//            TurdWeb plugin (packaging/entertainment/android).
//   web      Browser preview. Sites refuse to be framed here, so the viewer
//            uses embed players / the demo instead (see entertainment.js).
//
// Every method resolves; failures are reported, never thrown at the UI.
// ===========================================================================

const tauriInvoke = ()=>{
  const T = window.__TAURI_INTERNALS__ || (window.__TAURI__ && window.__TAURI__.core);
  return T && typeof T.invoke === "function" ? (cmd, args)=>T.invoke(cmd, args) : null;
};
const capPlugin = ()=>{
  const C = window.Capacitor;
  if(!C || !C.isNativePlatform || !C.isNativePlatform()) return null;
  try{ return (C.Plugins && C.Plugins.TurdWeb) || (C.registerPlugin && C.registerPlugin("TurdWeb")) || null; }catch(e){ return null; }
};

export function platform(){
  if(tauriInvoke()) return "tauri";
  if(capPlugin()) return "android";
  return "web";
}
export const isNative = ()=> platform() !== "web";

// Takes a thunk so a synchronous throw inside the native bridge is caught too.
const safe = fn=>{
  let p; try{ p = fn(); }catch(e){ p = Promise.reject(e); }
  return Promise.resolve(p).then(v=>({ ok:true, v }), e=>{
    const msg = String(e && (e.message || e.errorMessage) || e);
    console.warn("[ent] native call failed:", msg); return { ok:false, e:msg };
  });
};

export function createBridge(){
  const kind = platform();

  if(kind === "tauri"){
    const inv = tauriInvoke();
    return {
      kind,
      // Tauri uses logical (CSS) pixels for child web view bounds.
      open: o=> safe(()=>inv("ent_open", { req:o })),
      bounds: (id, r)=> safe(()=>inv("ent_bounds", { id, x:r.x, y:r.y, w:r.w, h:r.h })),
      show: (id, r)=> safe(()=>inv("ent_show", { id, x:r.x, y:r.y, w:r.w, h:r.h })),
      hide: id=> safe(()=>inv("ent_hide", { id })),
      hideAll: ()=> safe(()=>inv("ent_hide_all")),
      nav: (id, action, url)=> safe(()=>inv("ent_nav", { id, action, url:url||null })),
      close: id=> safe(()=>inv("ent_close", { id })),
      state: ()=> safe(()=>inv("ent_state")).then(r=> r.ok ? r.v : null),
      rules: rules=> safe(()=>inv("ent_rules", { rules })),
      onBack: ()=> ()=>{},          // Windows has no hardware back button
    };
  }

  if(kind === "android"){
    const P = capPlugin();
    return {
      kind,
      open: o=> safe(()=>P.open(o)),
      bounds: (id, r)=> safe(()=>P.bounds({ id, ...r })),
      show: (id, r)=> safe(()=>P.show({ id, ...r })),
      hide: id=> safe(()=>P.hide({ id })),
      hideAll: ()=> safe(()=>P.hideAll()),
      nav: (id, action, url)=> safe(()=>P.nav({ id, action, url:url||"" })),
      close: id=> safe(()=>P.close({ id })),
      state: ()=> safe(()=>P.state()).then(r=> r.ok ? r.v : null),
      rules: rules=> safe(()=>P.rules({ rules })),
      // hardware back while a site has no history left → leave the viewer
      // The plugin object Capacitor injects returns {remove} directly, @capacitor/core returns a
      // promise of it; accept both.
      onBack: fn=>{
        let h = null;
        try{ const r = P.addListener("backAtRoot", fn); if(r && typeof r.then === "function") r.then(x=>h=x, ()=>{}); else h = r; }catch(e){}
        return ()=>{ try{ h && h.remove && h.remove(); }catch(e){} };
      },
    };
  }

  // browser preview: no native views
  const noop = ()=> Promise.resolve({ ok:false, e:"web" });
  return { kind, open:noop, bounds:noop, show:noop, hide:noop, hideAll:noop, nav:noop, close:noop,
    state:()=>Promise.resolve(null), rules:noop, onBack:()=>()=>{} };
}
