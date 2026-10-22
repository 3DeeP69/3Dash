// ===========================================================================
// ENTERTAINMENT CATALOG — the apps on the launcher.
// url = desktop site (Windows), murl = mobile site (Android).
// warm = pre-loaded hidden in the background so opening is instant.
// demo = what the browser preview can show (native builds always load the
//        real site in a native web view).
// ===========================================================================

const svg = (body, vb="0 0 48 48")=>`<svg viewBox="${vb}" aria-hidden="true">${body}</svg>`;

export const GLYPHS = {
  youtube: svg(`<rect x="3" y="10" width="42" height="28" rx="9" fill="currentColor"/><path d="M20 17.5v13l11.5-6.5z" fill="#fff"/>`),
  tiktok: svg(`<g fill="none" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M26.5 7v22.5a7 7 0 1 1-7-7" stroke="#25f4ee" transform="translate(-1.6 -1.4)"/>
      <path d="M26.5 7c.6 5 4 8.4 9 8.8" stroke="#25f4ee" transform="translate(-1.6 -1.4)"/>
      <path d="M26.5 7v22.5a7 7 0 1 1-7-7" stroke="#fe2c55" transform="translate(1.6 1.4)"/>
      <path d="M26.5 7c.6 5 4 8.4 9 8.8" stroke="#fe2c55" transform="translate(1.6 1.4)"/>
      <path d="M26.5 7v22.5a7 7 0 1 1-7-7" stroke="#fff"/><path d="M26.5 7c.6 5 4 8.4 9 8.8" stroke="#fff"/></g>`),
  twitch: svg(`<path d="M10 6 7 13v26h9v5h5l5-5h7l9-9V6z" fill="currentColor"/><path d="M13 10h26v18l-5.5 5.5H26l-5 5v-5h-8z" fill="#0e0718"/>
      <rect x="22" y="15" width="3.6" height="10" rx="1" fill="currentColor"/><rect x="30.5" y="15" width="3.6" height="10" rx="1" fill="currentColor"/>`),
  reddit: svg(`<circle cx="24" cy="27" r="14.5" fill="currentColor"/><circle cx="35.5" cy="11.5" r="3.4" fill="currentColor"/>
      <path d="M24 13l3-7.5 8 3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
      <circle cx="18.6" cy="25.5" r="2.6" fill="#fff"/><circle cx="29.4" cy="25.5" r="2.6" fill="#fff"/>
      <path d="M17.6 31.6c3.6 3 9.2 3 12.8 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>`),
  soundcloud: svg(`<path d="M20 34V17.4a11 11 0 0 1 20.7 4.4A6.2 6.2 0 0 1 40 34z" fill="currentColor"/>
      ${[4,8,12,16].map((x,i)=>`<rect x="${x}" y="${24-i*2}" width="2.2" height="${10+i*2}" rx="1.1" fill="currentColor" opacity="${.55+i*.12}"/>`).join("")}`),
  web: svg(`<circle cx="24" cy="24" r="16" fill="none" stroke="currentColor" stroke-width="3"/><path d="M8 24h32M24 8c6 6 6 26 0 32M24 8c-6 6-6 26 0 32" fill="none" stroke="currentColor" stroke-width="2.4"/>`),
  add: svg(`<path d="M24 12v24M12 24h24" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>`),
};

export const APPS = [
  { id:"youtube", name:"YouTube", tagline:"Videos, no ads, no detours",
    url:"https://www.youtube.com/", murl:"https://m.youtube.com/",
    theme:{ accent:"#ff3341", accent2:"#a3000f", rgb:"255,51,65" }, warm:true, demo:"youtube" },
  { id:"tiktok", name:"TikTok", tagline:"For You feed, straight in",
    url:"https://www.tiktok.com/foryou", murl:"https://www.tiktok.com/foryou",
    theme:{ accent:"#25f4ee", accent2:"#fe2c55", rgb:"37,244,238" }, warm:true, demo:"tiktok" },
  { id:"twitch", name:"Twitch", tagline:"Live streams, ad breaks muted",
    url:"https://www.twitch.tv/", murl:"https://m.twitch.tv/",
    theme:{ accent:"#a970ff", accent2:"#5b1fd1", rgb:"169,112,255" }, warm:false, demo:"twitch" },
  { id:"reddit", name:"Reddit", tagline:"Front page without promos",
    url:"https://www.reddit.com/", murl:"https://www.reddit.com/",
    theme:{ accent:"#ff5a1f", accent2:"#c8260a", rgb:"255,90,31" }, warm:false, demo:null },
  { id:"soundcloud", name:"SoundCloud", tagline:"Music and mixes",
    url:"https://soundcloud.com/discover", murl:"https://m.soundcloud.com/",
    theme:{ accent:"#ff7a00", accent2:"#d13a00", rgb:"255,122,0" }, warm:false, demo:"soundcloud" },
];

/** Which site rules a custom URL should borrow, if it is one of the known sites. */
export function siteFor(url){
  try{
    const h = new URL(url).hostname;
    if(/(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(h)) return "youtube";
    if(/(^|\.)tiktok\.com$/.test(h)) return "tiktok";
    if(/(^|\.)twitch\.tv$/.test(h)) return "twitch";
    if(/(^|\.)reddit\.com$/.test(h)) return "reddit";
    if(/(^|\.)soundcloud\.com$/.test(h)) return "soundcloud";
  }catch(e){}
  return "web";
}

/** Theme for a custom tile: a stable hue from its host name. */
export function themeFor(url){
  let h = 0; for(const c of String(url)) h = (h*31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360, toRgb = (H,S,L)=>{ S/=100; L/=100; const k=n=>(n+H/30)%12, a=S*Math.min(L,1-L),
    f=n=>Math.round(255*(L-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1))))); return [f(0),f(8),f(4)]; };
  const [r,g,b] = toRgb(hue,90,62), [r2,g2,b2] = toRgb(hue,85,38), hex=(...v)=>"#"+v.map(x=>x.toString(16).padStart(2,"0")).join("");
  return { accent:hex(r,g,b), accent2:hex(r2,g2,b2), rgb:`${r},${g},${b}` };
}
