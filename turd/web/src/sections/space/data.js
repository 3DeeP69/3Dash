// ===========================================================================
// SPACE · data layer. Every feed is FREE and keyless (or uses NASA's public
// DEMO_KEY, swappable for your own free api.nasa.gov key). Each feed has
// fallbacks, a TTL, and a last-good copy in localStorage so the tab works
// offline and never shows an empty box once it has seen data once.
//   apod     NASA Astronomy Picture of the Day          api.nasa.gov
//   epic     NASA EPIC full-disk Earth, today            epic.gsfc.nasa.gov
//   crew     people in space now                         corquaid ISS API → LL2 → open-notify
//   neo      asteroid close approaches (60 days)         JPL SBDB CAD API → NeoWs
//   mars     latest rover raw images                     NASA raw-image feeds → Mars Photos API
//   launch   upcoming launches                           The Space Devs LL2 → RocketLaunch.live
//   swx      space weather: Kp, scales, wind, flares     NOAA SWPC
// All fetches go through ctx.http (native = CORS-free; web = fetch).
// ===========================================================================
import { LS } from "../util.js";

export const nasaKey = ()=> (LS.get("turd_sp_nasakey","")||"").trim() || "DEMO_KEY";
export const setNasaKey = k=> LS.set("turd_sp_nasakey", String(k||"").trim());
const online = ()=> typeof navigator==="undefined" || navigator.onLine!==false;
const timed = (p, ms=14000)=> Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),ms))]);
async function J(http, url, ms){ const r=await timed(http(url),ms); if(r.ok===false || (r.status && r.status>=400)) throw new Error("HTTP "+r.status); return r.json(); }

const inflight = new Map();
/* cache wrapper: fresh copy within ttl → network chain → last good copy (stale) → throw */
export async function feed(key, ttl, chain, http, {force=false}={}){
  const k="turd_sp_"+key, c=LS.get(k,null);
  if(c && !force && Date.now()-c.t < ttl) return { ...c, fresh:true };
  if(!online()){ if(c) return { ...c, stale:true, offline:true }; throw new Error("offline"); }
  if(inflight.has(key)) return inflight.get(key);
  const p=(async()=>{
    let err;
    for(const f of chain){ try{ const d=await f(http); if(d!=null){ const v={ t:Date.now(), d }; LS.set(k,v); return { ...v, fresh:true }; } }catch(e){ err=e; } }
    if(c) return { ...c, stale:true };
    throw err||new Error("no data");
  })().finally(()=>inflight.delete(key));
  inflight.set(key,p); return p;
}
export const peek = key=> LS.get("turd_sp_"+key, null);

/* ------------------------------------------------------------ APOD */
const apodShape = a=> a && a.title ? { date:a.date, title:a.title, text:a.explanation||"", type:a.media_type,
  url:a.url, hd:a.hdurl||a.url, thumb:a.thumbnail_url||null, by:(a.copyright||"").replace(/\s+/g," ").trim() } : null;
export const apod = (http, o={})=> feed("apod"+(o.date?"_"+o.date:""), o.date?365*86400e3:3*3600e3, [
  async h=> apodShape(await J(h, `https://api.nasa.gov/planetary/apod?api_key=${nasaKey()}&thumbs=true${o.date?"&date="+o.date:""}`)),
  async h=> o.date||nasaKey()==="DEMO_KEY" ? null : apodShape(await J(h, `https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY&thumbs=true`)),
], http, o);

/* ------------------------------------------------------------ EPIC Earth */
export const epic = (http,o)=> feed("epic", 6*3600e3, [
  async h=>{ const a=await J(h,"https://epic.gsfc.nasa.gov/api/natural"); const x=Array.isArray(a)&&a[a.length-1]; if(!x) return null;
    const [d]=x.date.split(" "), p=d.replace(/-/g,"/");
    return { date:x.date, caption:x.caption||"", lat:x.centroid_coordinates?.lat, lon:x.centroid_coordinates?.lon,
      thumb:`https://epic.gsfc.nasa.gov/archive/natural/${p}/thumbs/${x.image}.jpg`, img:`https://epic.gsfc.nasa.gov/archive/natural/${p}/jpg/${x.image}.jpg`, n:a.length }; },
], http, o);

/* ------------------------------------------------------------ people in space */
export const crew = (http,o)=> feed("crew", 6*3600e3, [
  async h=>{ const j=await J(h,"https://corquaid.github.io/international-space-station-APIs/JSON/people-in-space.json");
    if(!j || !Array.isArray(j.people)) return null;
    return { n:j.number||j.people.length, exp:j.iss_expedition||null, people:j.people.map(p=>({ name:p.name, craft:p.spacecraft||(p.iss?"ISS":""), role:p.position||"", agency:p.agency||"", flag:p.flag_code||"", since:p.launched?p.launched*1000:null, iss:!!p.iss })) }; },
  async h=>{ const j=await J(h,"https://ll.thespacedevs.com/2.2.0/astronaut/?in_space=true&limit=40&mode=list");
    const r=j&&j.results; if(!r||!r.length) return null;
    return { n:r.length, people:r.map(p=>({ name:p.name, craft:"", role:"", agency:p.agency?.abbrev||p.agency?.name||"", flag:"", since:null })) }; },
  async h=>{ const j=await J(h,"http://api.open-notify.org/astros.json"); if(!j||!j.people) return null;
    return { n:j.number, people:j.people.map(p=>({ name:p.name, craft:p.craft, role:"", agency:"", flag:"" })) }; },
], http, o);

/* ------------------------------------------------------------ asteroids */
const sizeFromH = H=> 1329/Math.sqrt(0.14)*Math.pow(10,-H/5)*1000;     // metres, albedo 0.14 guess
const MON={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
const cadDate = s=>{ const m=/^(\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})/.exec(s||""); return m?Date.UTC(+m[1],MON[m[2]],+m[3],+m[4],+m[5]):Date.parse(s); };
export const neo = (http,o)=> feed("neo", 6*3600e3, [
  async h=>{ const j=await J(h,"https://ssd-api.jpl.nasa.gov/cad.api?date-min=now&date-max=%2B60&dist-max=0.05&sort=date&diameter=true&fullname=true");
    if(!j || !Array.isArray(j.fields)) return null; const F=j.fields, ix=n=>F.indexOf(n);
    return (j.data||[]).slice(0,80).map(r=>{ const H=+r[ix("h")], D=+r[ix("diameter")];
      return { name:(r[ix("fullname")]||r[ix("des")]||"").trim(), t:cadDate(r[ix("cd")]), au:+r[ix("dist")], v:+r[ix("v_rel")],
        m: D>0 ? D*1000 : (isFinite(H)?sizeFromH(H):null), est:!(D>0) }; }); },
  async h=>{ const d=new Date(), s=d.toISOString().slice(0,10), e=new Date(d.getTime()+6*86400e3).toISOString().slice(0,10);
    const j=await J(h,`https://api.nasa.gov/neo/rest/v1/feed?start_date=${s}&end_date=${e}&api_key=${nasaKey()}`); if(!j||!j.near_earth_objects) return null;
    const out=[]; for(const day of Object.values(j.near_earth_objects)) for(const a of day){ const c=a.close_approach_data?.[0]; if(!c) continue;
      const dm=a.estimated_diameter?.meters; out.push({ name:a.name, t:c.epoch_date_close_approach, au:+c.miss_distance.astronomical, v:+c.relative_velocity.kilometers_per_second,
        m: dm?(dm.estimated_diameter_min+dm.estimated_diameter_max)/2:null, est:true, pha:!!a.is_potentially_hazardous_asteroid }); }
    return out.filter(a=>a.au<0.05).sort((a,b)=>a.t-b.t); },
], http, o);

/* ------------------------------------------------------------ Mars rover raw images */
const ROVERS = {
  perseverance:{ label:"Perseverance", chain:[
    async h=>{ const j=await J(h,"https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&num=40&page=0&order=sol+desc&extended=sample_type::full,");
      const a=j&&j.images; if(!a||!a.length) return null;
      return a.filter(x=>x.image_files).map(x=>({ id:x.imageid, sol:x.sol, t:Date.parse(x.date_taken_utc||x.date_received||""), cam:x.camera?.instrument||"", src:x.image_files.small||x.image_files.medium, full:x.image_files.large||x.image_files.full_res, title:x.title||"" })); },
  ]},
  curiosity:{ label:"Curiosity", chain:[
    async h=>{ const j=await J(h,"https://mars.nasa.gov/api/v1/raw_image_items/?order=sol%20desc,date_taken%20desc&per_page=40&page=0&condition_1=msl:mission&condition_2=full:sample_type");
      const a=j&&j.items; if(!a||!a.length) return null;
      return a.map(x=>({ id:x.id||x.imageid, sol:x.sol, t:Date.parse(x.date_taken||""), cam:x.instrument||"", src:x.https_url||x.url, full:x.https_url||x.url, title:x.title||"" })); },
    async h=>{ const j=await J(h,`https://api.nasa.gov/mars-photos/api/v1/rovers/curiosity/latest_photos?api_key=${nasaKey()}`);
      const a=j&&j.latest_photos; if(!a||!a.length) return null;
      return a.slice(0,40).map(x=>({ id:x.id, sol:x.sol, t:Date.parse(x.earth_date), cam:x.camera?.full_name||x.camera?.name||"", src:x.img_src, full:x.img_src, title:"" })); },
  ]},
};
export const roverList = ()=> Object.entries(ROVERS).map(([id,r])=>({ id, label:r.label }));
export const mars = (http, rover="perseverance", o)=> feed("mars_"+rover, 3*3600e3, ROVERS[rover]?.chain||[], http, o)
  .then(r=>({ ...r, d:(r.d||[]).filter(x=>x.src && /^https?:/.test(x.src)).map(x=>({ ...x, src:x.src.replace(/^http:/,"https:"), full:(x.full||x.src).replace(/^http:/,"https:") })).slice(0,36) }));

/* ------------------------------------------------------------ launches */
export const launches = (http,o)=> feed("launch", 60*60e3, [
  async h=>{ const j=await J(h,"https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=14&hide_recent_previous=true&mode=normal");
    const r=j&&j.results; if(!r||!r.length) return null;
    return r.map(x=>({ name:x.name, t:Date.parse(x.net), prec:x.net_precision?.abbrev||"", status:x.status?.abbrev||"", statusName:x.status?.name||"",
      who:x.launch_service_provider?.name||"", rocket:x.rocket?.configuration?.name||"", mission:x.mission?.name||"",
      desc:(x.mission?.description||"").slice(0,400), orbit:x.mission?.orbit?.abbrev||"", pad:x.pad?.name||"", where:x.pad?.location?.name||"",
      img:(typeof x.image==="string"?x.image:x.image?.thumbnail_url||x.image?.image_url)||"", live:!!x.webcast_live, link:x.slug?"https://spacelaunchnow.me/launch/"+x.slug:"" })); },
  async h=>{ const j=await J(h,"https://fdo.rocketlaunch.live/json/launches/next/5"); const r=j&&j.result; if(!r||!r.length) return null;
    return r.map(x=>({ name:x.name, t:(x.t0?Date.parse(x.t0):x.win_open?Date.parse(x.win_open):(x.sort_date*1000)), prec:x.t0||x.win_open?"":"Day", status:"", statusName:x.date_str||"",
      who:x.provider?.name||"", rocket:x.vehicle?.name||"", mission:x.missions?.[0]?.name||"", desc:(x.launch_description||"").slice(0,400), orbit:"",
      pad:x.pad?.name||"", where:[x.pad?.location?.name,x.pad?.location?.statename||x.pad?.location?.country].filter(Boolean).join(", "), img:"", live:false, link:x.slug?"https://www.rocketlaunch.live/launch/"+x.slug:"" })); },
], http, o).then(r=>({ ...r, d:(r.d||[]).filter(x=>isFinite(x.t)) }));

/* ------------------------------------------------------------ space weather (NOAA SWPC) */
// SWPC products are arrays-with-a-header-row; newer ones are arrays of objects. Accept both.
const rows = a=>{ if(!Array.isArray(a)||!a.length) return []; if(Array.isArray(a[0])){ const h=a[0]; return a.slice(1).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]]))); } return a; };
const kpOf = r=> +(r.Kp ?? r.kp ?? r.kp_index ?? r.estimated_kp);
const tOf = r=> Date.parse(((r.time_tag||r.TimeStamp||"")+"").replace(" ","T")+(/Z|[+-]\d\d:?\d\d$/.test(r.time_tag||"")?"":"Z"));
export const swx = (http,o)=> feed("swx", 20*60e3, [
  async h=>{
    const [kp, fc, sc, wind, mag, flare] = await Promise.allSettled([
      J(h,"https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json"),
      J(h,"https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json"),
      J(h,"https://services.swpc.noaa.gov/products/noaa-scales.json"),
      J(h,"https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json"),
      J(h,"https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json"),
      J(h,"https://services.swpc.noaa.gov/json/goes/primary/xray-flares-latest.json"),
    ]);
    const v=p=>p.status==="fulfilled"?p.value:null;
    const kpRows=rows(v(kp)).map(r=>({ t:tOf(r), kp:kpOf(r) })).filter(r=>isFinite(r.kp)&&isFinite(r.t));
    const fcRows=rows(v(fc)).map(r=>({ t:tOf(r), kp:kpOf(r), kind:r.observed||r.type||"" })).filter(r=>isFinite(r.kp)&&isFinite(r.t));
    const S=v(sc)||{}, sk=k=>S[k]?{ R:S[k].R, S:S[k].S, G:S[k].G, date:S[k].DateStamp }:null;
    const one=x=>Array.isArray(x)?(Array.isArray(x[0])?rows(x).pop():x[x.length-1]||x[0]):x;
    const w=one(v(wind)), m=one(v(mag)), f=one(v(flare));
    if(!kpRows.length && !fcRows.length && !S["0"]) return null;
    return { kp:kpRows.slice(-24), fc:fcRows.filter(r=>r.t>Date.now()-3*3600e3).slice(0,24),
      scales:{ now:sk("0"), d1:sk("1"), d2:sk("2"), d3:sk("3") },
      wind: w?+(w.WindSpeed??w.proton_speed??w.speed):null, bz: m?+(m.Bz??m.bz_gsm):null, bt: m?+(m.Bt??m.bt):null,
      flare: f?{ cls:f.max_class||f.current_class||"", cur:f.current_class||"", t:Date.parse(f.max_time||f.time_tag||"") }:null };
  },
], http, o);

/* NOAA scale text → colour */
export const gColor = g=>{ const n=+String(g??0).replace(/\D/g,"")||0; return ["#3ddc84","#c6e94a","#ffd23f","#ff9a1f","#ff4d4d","#c86bff"][Math.min(5,n)]; };
export const kpColor = k=> k>=9?"#c86bff":k>=8?"#ff4d4d":k>=7?"#ff7a3f":k>=6?"#ff9a1f":k>=5?"#ffd23f":k>=4?"#c6e94a":"#3ddc84";
export const kpG = k=> k>=9?"G5":k>=8?"G4":k>=7?"G3":k>=6?"G2":k>=5?"G1":"";
