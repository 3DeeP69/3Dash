// ===========================================================================
// ENTERTAINMENT SHIELD — the single source of truth for ad / clutter blocking.
//
// Three layers, all handed to the native web views (Tauri child webview on
// Windows, Android WebView via the TurdWeb plugin) when a site is opened:
//   1. NETWORK  — host + path rules. Native code answers matching requests
//                 with an empty 204 before they ever leave the device.
//   2. SCRIPT   — runs at document-start in every page: strips ad payloads
//                 out of the site's own JSON (YouTube adPlacements, TikTok
//                 isAd items), fast-forwards anything that slips through,
//                 keeps every link inside the same view, and blocks
//                 "open in the app" redirects.
//   3. COSMETIC — CSS that removes ad slots, app nags, cookie walls, login
//                 pop-ups and splash/loading screens. Re-applied if the page
//                 tries to remove it.
// ===========================================================================

/* ---------------------------------------------------------------- network */
// Matched against the request host as a suffix ("doubleclick.net" also hits
// "ad.doubleclick.net").
export const BLOCK_HOSTS = [
  // Google ad + tracking stack (also serves YouTube ads)
  "doubleclick.net","googlesyndication.com","googleadservices.com","googletagservices.com",
  "googletagmanager.com","google-analytics.com","adservice.google.com","pagead2.googlesyndication.com",
  "imasdk.googleapis.com","2mdn.net","admob.com","adsense.com",
  // Ad exchanges / SSPs
  "adnxs.com","adsrvr.org","amazon-adsystem.com","criteo.com","criteo.net","taboola.com","outbrain.com",
  "rubiconproject.com","pubmatic.com","openx.net","casalemedia.com","indexww.com","smartadserver.com",
  "teads.tv","yieldmo.com","sharethrough.com","3lift.com","bidswitch.net","media.net","moatads.com",
  "adform.net","advertising.com","adcolony.com","applovin.com","unityads.unity3d.com","inmobi.com",
  "springserve.com","spotxchange.com","spotx.tv","innovid.com","flashtalking.com","serving-sys.com",
  // Measurement / beacons
  "scorecardresearch.com","quantserve.com","quantcount.com","chartbeat.com","hotjar.com","mouseflow.com",
  "fullstory.com","segment.io","mixpanel.com","branch.io","app.link","adjust.com","appsflyer.com",
  "kochava.com","sentry-cdn.com","newrelic.com","nr-data.net","bat.bing.com","clarity.ms",
  "connect.facebook.net","ads-twitter.com","static.ads-twitter.com","ads.linkedin.com","snap.licdn.com",
  // TikTok ads + telemetry (feed still loads without these)
  "ads.tiktok.com","analytics.tiktok.com","business-api.tiktok.com","ads-api.tiktok.com",
  "analytics-sg.tiktok.com","mcs.tiktokw.us","mcs-va.tiktokv.com","log.byteoversea.com",
  // Twitch ad + telemetry endpoints
  "ads.twitch.tv","edge.ads.twitch.tv","spade.twitch.tv","countess.twitch.tv","pubads.g.doubleclick.net",
  // Reddit ads + telemetry
  "alb.reddit.com","events.reddit.com","events.redditmedia.com","ads.reddit.com",
  // SoundCloud promoted audio
  "promoted.soundcloud.com","ads.soundcloud.com","eventlogger.soundcloud.com",
];

// Matched as substrings of host+path ("www.youtube.com/pagead/…").
export const BLOCK_PATHS = [
  "youtube.com/pagead/","youtube.com/api/stats/ads","youtube.com/get_midroll_","youtube.com/ptracking",
  "youtube.com/youtubei/v1/log_event","youtube.com/api/stats/atr","youtube.com/generate_204",
  "youtube.com/pcs/activeview","youtube.com/csi_204","googlevideo.com/initplayback?*&oad",
  "tiktok.com/api/ad/","tiktok.com/web/report",
  "twitch.tv/v1/ads","reddit.com/api/ads","reddit.com/svc/shreddit/events","soundcloud.com/me/ads",
  "/ads.js","/ad_status.js","/adsbygoogle","/prebid","/pagead.js","/adframe",
];

/* ---------------------------------------------------------------- cosmetic */
// One rule per selector: a selector the engine doesn't know only drops itself, not the whole list.
const HIDE = s=> s.map(sel=> sel + "{display:none!important}").join("\n");

const COMMON_CSS = HIDE([
  // cookie / consent walls
  "#onetrust-consent-sdk","#onetrust-banner-sdk",".fc-consent-root","#CybotCookiebotDialog",".qc-cmp2-container",
  "[id^='sp_message_container']","[class*='cookie-banner']","[class*='CookieBanner']","[aria-label*='cookie' i][role='dialog']",
  // smart-app banners, "open in app" bars
  "[class*='smart-banner']","[class*='SmartBanner']","[class*='app-banner']","[class*='AppBanner']",
  "[class*='open-in-app']","[class*='OpenInApp']","[class*='xpromo']","[class*='download-app']","[class*='DownloadApp']",
  // generic ad containers
  ".adsbygoogle","ins.adsbygoogle","[id^='google_ads_iframe']","[id^='div-gpt-ad']","iframe[src*='doubleclick.net']",
  "iframe[src*='googlesyndication']","[data-ad-slot]","[data-google-query-id]",
]) + "\nhtml,body{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.18) transparent}";

/* Per-site rules. clean:true rules only apply in Clean mode (the "ugly stuff"
   that is not an ad: upsells, footers, nag dialogs). */
export const SITE_RULES = {
  youtube: {
    css: HIDE([
      // ads
      "#masthead-ad","ytd-ad-slot-renderer","ytd-in-feed-ad-layout-renderer","ytd-banner-promo-renderer",
      "ytd-promoted-sparkles-web-renderer","ytd-promoted-video-renderer","ytd-display-ad-renderer",
      "ytd-compact-promoted-video-renderer","ytd-action-companion-ad-renderer","ytd-player-legacy-desktop-watch-ads-renderer",
      "ytd-statement-banner-renderer","ytd-search-pyv-renderer","ytd-carousel-ad-renderer","ytd-ads-engagement-panel-content-renderer",
      "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-ads']","#player-ads","#panels > ytd-ads-engagement-panel-content-renderer",
      "ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer)","ytd-rich-section-renderer:has(ytd-statement-banner-renderer)",
      ".ytp-ad-module",".ytp-ad-overlay-container",".ytp-ad-image-overlay",".ytp-suggested-action","ytm-promoted-sparkles-web-renderer",
      "ad-slot-renderer","ytm-companion-ad-renderer","ytd-merch-shelf-renderer","#offer-module",
      // anti-adblock wall
      "ytd-enforcement-message-view-model","tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)",
    ]),
    clean: HIDE([
      "ytd-mealbar-promo-renderer","yt-mealbar-promo-renderer","ytd-popup-container tp-yt-paper-dialog:has(#sign-in-button)",
      "ytd-guide-signin-promo-renderer","#guide-content #footer","ytd-consent-bump-v2-lightbox","tp-yt-iron-overlay-backdrop",
      "ytd-premium-yva-upsell-renderer","ytd-reel-shelf-renderer[is-ad]","#related ytd-movie-renderer","ytm-mealbar-promo-renderer",
      "ytm-statement-banner-renderer","ytm-paid-content-overlay-renderer",".ytp-paid-content-overlay",
    ]) + "\nhtml{background:#0f0f0f!important}",
  },
  tiktok: {
    css: HIDE([
      "[data-e2e='recommend-list-item-container']:has([data-e2e*='ad-tag'])","[class*='DivAdBadge']","[class*='AdTag']",
      "div[class*='DivItemContainer']:has([class*='AdLabel'])",
    ]),
    clean: HIDE([
      "[class*='DivBottomContainer']:has(a[href*='download'])","[class*='DivPromotion']","[class*='DivAppPromotion']",
      "[class*='DivOpenAppContainer']","[class*='BottomBanner']","[data-e2e='top-get-app']","[data-e2e='bottom-get-app']",
      "[class*='DivKeyboardShortcut']","[class*='DivGetAppContainer']","[class*='DivDownloadApp']","[class*='DownloadBanner']",
      "[class*='DivLoginModal']","[id^='login-modal']","[class*='DivModalMask']:has([data-e2e='login-modal'])","[data-e2e='login-modal']",
      "[class*='DivCoinsMenu']","[class*='TUXModal']:has([data-e2e*='login'])","[class*='DivFooter']","[class*='LoadingContainer']",
      "[class*='DivLoadingWrapper']","[class*='SplashScreen']",
    ]) + "\nhtml,body{overflow:auto!important}",
  },
  twitch: {
    css: HIDE([
      "[data-test-selector='sad-overlay']","[data-a-target='video-ad-banner']","[data-test-selector='ad-banner-default-text']",
      ".stream-display-ad__wrapper","[class*='stream-display-ad']","[data-a-target='video-ad-countdown']",
    ]),
    clean: HIDE([
      "[aria-label='Get Ad-Free for Twitch']",
      "[data-test-selector='turbo-upsell']","[data-a-target='prime-offers-icon']",".top-nav__prime","[data-target='consent-banner']",
      "[class*='upsell']",".consent-banner",
    ]),
  },
  reddit: {
    css: HIDE([
      "shreddit-ad-post","shreddit-comments-page-ad","shreddit-dynamic-ad-link","shreddit-sidebar-ad","[slot='ad']",
      ".promotedlink","[data-testid='ad-post']","faceplate-tracker[source='ad']","div.promoted-tag","article:has([data-promoted='true'])",
    ]),
    clean: HIDE([
      "xpromo-app-selector","shreddit-experience-tree xpromo-nsfw-blocking-modal","xpromo-untagged-content-blocking-modal",
      "#xpromo-bottom-sheet","[bundlename='bottom_bar_xpromo']","shreddit-async-loader[bundlename*='xpromo']",
      "faceplate-dialog:has(auth-flow-modal)","reddit-cookie-banner","[slot='get-app']","a[href*='://reddit.app.link']",
    ]),
  },
  soundcloud: {
    css: HIDE([".sidebarModule.ads",".l-ads",".adBanner","[class*='audibleTile']",".mobileApps"]),
    clean: HIDE([".playlistGoPlusUpsell",".sc-go-plus",".l-footer",".announcements",".upsellBanner","[class*='upsell']","#app-banner"]),
  },
};

/* ---------------------------------------------------------------- page script
   Serialized into a string and injected at document-start. It must be fully
   self-contained (no closures over this module). */
function pageScript(CFG){
  if(window.__turdShield) return; window.__turdShield = true;
  const site = CFG.site, clean = CFG.clean;
  const stat = { blocked:0, pruned:0, skipped:0 };
  const report = ()=>{ try{ document.documentElement.dataset.turdBlocked = stat.pruned + stat.skipped; }catch(e){} };

  /* --- keep every link in this view, never bounce out to an app --------- */
  const APP_SCHEMES = /^(intent|market|snssdk\d*|tiktok|musically|vnd\.youtube|youtube|twitch|reddit|soundcloud|fb|instagram|itms-apps?):/i;
  const sameView = url=>{
    if(!url) return; const s = String(url);
    if(APP_SCHEMES.test(s)){
      // intent:// links often carry the real web URL as a fallback
      const fb = /S\.browser_fallback_url=([^;]+)/.exec(s); if(fb){ try{ location.assign(decodeURIComponent(fb[1])); }catch(e){} }
      return;
    }
    try{ location.assign(new URL(s, location.href).href); }catch(e){}
  };
  try{
    const realOpen = window.open;
    // sign-in pop-ups must stay real pop-ups (they post the result back to this page)
    const AUTH = /^https:\/\/(accounts\.google\.com|appleid\.apple\.com|login\.live\.com|login\.microsoftonline\.com|id\.twitch\.tv|accounts\.snapchat\.com|discord\.com\/oauth2|([\w.]*\.)?facebook\.com\/(v[\d.]+\/)?dialog\/oauth|(api\.)?(twitter|x)\.com\/.*oauth)/i;
    window.open = function(url){
      if(url && url !== "about:blank"){
        let abs = String(url); try{ abs = new URL(abs, location.href).href; }catch(e){}
        if(AUTH.test(abs)) return realOpen.apply(this, arguments);
        sameView(url); return window;
      }
      return realOpen.apply(this, arguments);
    };
  }catch(e){}
  document.addEventListener("click", e=>{
    const a = e.target && e.target.closest && e.target.closest("a[href]"); if(!a) return;
    const href = a.getAttribute("href") || "";
    if(APP_SCHEMES.test(href)){ e.preventDefault(); e.stopPropagation(); sameView(href); return; }
    if(a.target && a.target !== "_self" && !/^javascript:/i.test(href)){ a.target = "_self"; }
  }, true);
  // swallow "open the app?" page redirects
  try{
    const assign = Location.prototype.assign, replace = Location.prototype.replace;
    Location.prototype.assign = function(u){ if(APP_SCHEMES.test(String(u))) return sameView(u); return assign.call(this,u); };
    Location.prototype.replace = function(u){ if(APP_SCHEMES.test(String(u))) return sameView(u); return replace.call(this,u); };
  }catch(e){}

  /* --- JSON pruning: remove ad payloads from the site's own data ---------- */
  const PRUNE = {
    youtube: ["adPlacements","playerAds","adSlots","adBreakHeartbeatParams","adSafetyReason","adInferredBlockingStatus"],
  };
  const keys = PRUNE[site] || [];
  const pruneObj = (o, depth)=>{
    if(!o || typeof o !== "object" || depth > 6) return o;
    for(const k of keys){ if(k in o){ try{ delete o[k]; stat.pruned++; }catch(e){} } }
    if(site === "youtube"){
      // promoted shelves inside browse / search / next responses
      for(const k in o){ const v = o[k];
        if(Array.isArray(v)){
          for(let i = v.length - 1; i >= 0; i--){ const it = v[i];
            if(it && typeof it === "object" && (it.adSlotRenderer || it.promotedSparklesWebRenderer || it.searchPyvRenderer ||
               (it.richItemRenderer && it.richItemRenderer.content && it.richItemRenderer.content.adSlotRenderer) ||
               it.compactPromotedVideoRenderer || it.statementBannerRenderer && clean)){ v.splice(i,1); stat.pruned++; }
          }
        }
        if(v && typeof v === "object") pruneObj(v, depth+1);
      }
    }
    if(site === "tiktok"){
      const list = o.itemList || o.item_list || o.items;
      if(Array.isArray(list)){
        for(let i = list.length - 1; i >= 0; i--){ const it = list[i];
          if(it && (it.isAd || it.is_ad || it.adAuthorization || (it.adInfo && Object.keys(it.adInfo).length) || it.commerceInfo && it.commerceInfo.adSource)){ list.splice(i,1); stat.pruned++; }
        }
      }
    }
    if(site === "reddit" && Array.isArray(o.children)){
      for(let i = o.children.length - 1; i >= 0; i--){ const c = o.children[i]; if(c && c.data && (c.data.promoted || c.data.is_ad)){ o.children.splice(i,1); stat.pruned++; } }
    }
    return o;
  };
  if(keys.length || site === "tiktok" || site === "reddit"){
    const jp = JSON.parse;
    JSON.parse = function(){ const r = jp.apply(this, arguments); try{ pruneObj(r,0); report(); }catch(e){} return r; };
    try{
      const rj = Response.prototype.json;
      Response.prototype.json = function(){ return rj.apply(this, arguments).then(r=>{ try{ pruneObj(r,0); report(); }catch(e){} return r; }); };
    }catch(e){}
    if(site === "youtube"){
      // ytInitialPlayerResponse / ytInitialData are assigned by inline <script>s
      for(const name of ["ytInitialPlayerResponse","ytInitialData","playerResponse"]){
        let val;
        try{ Object.defineProperty(window, name, { configurable:true, get(){ return val; }, set(v){ val = pruneObj(v,0); report(); } }); }catch(e){}
      }
    }
  }

  /* --- fast-forward anything that slips through (YouTube video ads) ------- */
  if(site === "youtube"){
    const tick = ()=>{
      const player = document.querySelector(".html5-video-player");
      if(player && player.classList.contains("ad-showing")){
        const v = player.querySelector("video");
        if(v){ v.muted = true; if(isFinite(v.duration) && v.duration > 0) v.currentTime = v.duration; v.playbackRate = 16; }
        const skip = player.querySelector(".ytp-skip-ad-button,.ytp-ad-skip-button,.ytp-ad-skip-button-modern,[id^='skip-button'] button");
        if(skip) skip.click();
        stat.skipped++; report();
      }
      // anti-adblock wall: close it and resume
      const wall = document.querySelector("ytd-enforcement-message-view-model");
      if(wall){ const dlg = wall.closest("tp-yt-paper-dialog"); if(dlg) dlg.remove(); const v = document.querySelector("video"); if(v && v.paused) v.play().catch(()=>{}); }
    };
    setInterval(tick, 250);
  }
  /* --- Twitch: stitched ad breaks are muted and covered, not shown -------- */
  if(site === "twitch"){
    let cover = null, wasMuted = null;
    setInterval(()=>{
      const ad = document.querySelector("[data-a-target='video-ad-label'],[data-a-target='video-ad-countdown'],.video-player__ad-info-container");
      const v = document.querySelector("video");
      if(ad && v){
        if(wasMuted === null){ wasMuted = v.muted; v.muted = true; }
        if(!cover){ const host = v.closest("[data-a-target='video-player']") || v.parentElement;
          cover = document.createElement("div"); cover.textContent = "Ad break muted · stream resumes automatically";
          cover.style.cssText = "position:absolute;inset:0;z-index:9999;display:grid;place-items:center;background:#0b0410;color:#c9b6ff;font:600 15px system-ui;letter-spacing:.5px";
          host.style.position = host.style.position || "relative"; host.appendChild(cover); stat.skipped++; report(); }
      }else if(cover){ cover.remove(); cover = null; if(v && wasMuted !== null) v.muted = wasMuted; wasMuted = null; }
    }, 400);
  }

  /* --- cosmetic layer: inject + keep alive -------------------------------- */
  const css = CFG.css;
  const install = ()=>{
    if(!css) return;
    let st = document.getElementById("__turd_shield_css");
    if(!st){ st = document.createElement("style"); st.id = "__turd_shield_css"; st.textContent = css; }
    const host = document.head || document.documentElement;
    if(host && st.parentNode !== host) host.appendChild(st);
  };
  install();
  // at document-start <html> may not exist yet, so watch the document itself
  new MutationObserver(()=>{ const st = document.getElementById("__turd_shield_css"); if(!st || (document.head && st.parentNode !== document.head)) install(); })
    .observe(document, { childList:true, subtree:true });
  document.addEventListener("DOMContentLoaded", install);

  /* --- clean mode: text-matched nags the class names can't catch ---------- */
  if(clean){
    const NAG = /^(get (the )?app|open (in )?app|open tiktok|use app|download( the)? app|continue in app|open reddit app|switch to the app|try ad-free|get ad-free.*)$/i;
    const sweep = ()=>{
      for(const el of document.querySelectorAll("a,button,[role='button']")){
        const t = (el.textContent || "").trim();
        if(t.length < 40 && NAG.test(t)){ el.style.setProperty("display","none","important"); }
      }
      // un-stick pages that lock scrolling behind a hidden modal
      const b = document.body; if(b && getComputedStyle(b).overflow === "hidden" && !document.fullscreenElement) b.style.setProperty("overflow","auto","important");
    };
    setInterval(sweep, 2000); document.addEventListener("DOMContentLoaded", sweep);
  }
  // remove the iOS/Android smart-app-banner meta so the OS never offers the app
  document.addEventListener("DOMContentLoaded", ()=>{ document.querySelectorAll("meta[name='apple-itunes-app'],meta[name='google-play-app'],link[rel='manifest']").forEach(m=>m.remove()); });
}

/* ---------------------------------------------------------------- builders */
export function cssFor(site, { shield=true, clean=true }={}){
  if(!shield) return "";
  const r = SITE_RULES[site] || {};
  return [COMMON_CSS, r.css || "", clean ? (r.clean || "") : ""].join("\n");
}
/** The document-start script for a site, ready to hand to a native web view. */
export function scriptFor(site, opts={}){
  const { shield=true, clean=true } = opts;
  if(!shield) return "";
  const cfg = { site, clean, css: cssFor(site, opts) };
  return `;(${pageScript.toString()})(${JSON.stringify(cfg)});`;
}
/** Network rules in the shape both native sides take. */
export const networkRules = ()=>({ hosts: BLOCK_HOSTS, paths: BLOCK_PATHS });
/** Same matcher the native sides implement (used by the demo + tests). */
export function isBlocked(url){
  let u; try{ u = new URL(url); }catch(e){ return false; }
  const h = u.hostname.toLowerCase();
  if(BLOCK_HOSTS.some(d=> h === d || h.endsWith("." + d))) return true;
  const hp = h + u.pathname + u.search;
  return BLOCK_PATHS.some(p=> !p.includes("*") ? hp.includes(p) : p.split("*").every(part=> hp.includes(part)));
}
