// ===========================================================================
// SPACE · ISS orbit. Pulls the station's two-line element set (TLE) once a day
// from any of three free, keyless mirrors, caches it, then does everything else
// ON DEVICE with SGP4 (satellite.js, bundled in web/vendor/satellite — MIT):
// live position, ground track and pass predictions keep working offline for
// days. A TLE ages ~1 km/day of error, so after a week we flag it as stale.
// ===========================================================================
import { LS } from "../util.js";
import { sunPos, compass } from "./astro.js";

const SAT_URL = new URL("../../../vendor/satellite/satellite.es.js", import.meta.url).href;
const K_TLE = "turd_sp_tle";
const TLE_TTL = 12*3600e3;
let SAT=null;
export async function lib(){ if(!SAT) SAT=await import(SAT_URL); return SAT; }

const timed = (p, ms=12000)=> Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")),ms))]);
const SOURCES = [
  async http=>{ const t=await (await timed(http("https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=tle"))).text();
    const l=t.trim().split(/\r?\n/).map(s=>s.trim()); const i=l.findIndex(s=>s.startsWith("1 25544")); return i>=0?{l1:l[i],l2:l[i+1],src:"CelesTrak"}:null; },
  async http=>{ const j=await (await timed(http("https://api.wheretheiss.at/v1/satellites/25544/tles"))).json(); return j&&j.line1?{l1:j.line1,l2:j.line2,src:"wheretheiss.at"}:null; },
  async http=>{ const j=await (await timed(http("https://tle.ivanstanojevic.me/api/tle/25544"))).json(); return j&&j.line1?{l1:j.line1,l2:j.line2,src:"TLE API"}:null; },
];
const valid = t=> t && /^1 25544/.test(t.l1||"") && /^2 25544/.test(t.l2||"");

/* TLE epoch → ms */
export function tleEpoch(l1){
  const yy=+l1.slice(18,20), day=+l1.slice(20,32), yr=yy<57?2000+yy:1900+yy;
  return Date.UTC(yr,0,1) + (day-1)*86400e3;
}
export const cachedTle = ()=>{ const c=LS.get(K_TLE,null); return valid(c)?c:null; };
export async function getTle(http, {force=false}={}){
  const c=cachedTle();
  if(c && !force && Date.now()-c.t < TLE_TTL) return c;
  if(typeof navigator!=="undefined" && navigator.onLine===false) return c;
  for(const s of SOURCES){ try{ const t=await s(http); if(valid(t)){ const v={...t, t:Date.now(), epoch:tleEpoch(t.l1)}; LS.set(K_TLE,v); return v; } }catch(e){} }
  return c;   // offline / all mirrors down → last good one (may be null)
}

let REC=null, RECKEY="";
async function satrec(tle){ const S=await lib(); if(RECKEY!==tle.l1){ REC=S.twoline2satrec(tle.l1,tle.l2); RECKEY=tle.l1; } return REC; }

/* position at time t → {lat, lon, alt km, speed km/s, eci} */
export function posAt(S, rec, t){
  const d=new Date(t), pv=S.propagate(rec,d); if(!pv || !pv.position) return null;
  const g=S.gstime(d), gd=S.eciToGeodetic(pv.position,g), v=pv.velocity;
  return { lat:S.degreesLat(gd.latitude), lon:S.degreesLong(gd.longitude), alt:gd.height,
           speed:Math.hypot(v.x,v.y,v.z), eci:pv.position, gmst:g };
}
export async function issNow(tle, t=Date.now()){ const S=await lib(), rec=await satrec(tle); return posAt(S,rec,t); }
export async function groundTrack(tle, t=Date.now(), back=40, fwd=95, stepMin=1){
  const S=await lib(), rec=await satrec(tle), pts=[];
  for(let m=-back; m<=fwd; m+=stepMin){ const p=posAt(S,rec,t+m*60e3); if(p) pts.push({lat:p.lat, lon:p.lon, m}); }
  return pts;
}

/* sun direction (ECI unit vector) for the shadow test */
function sunVec(t){ const s=sunPos(t), ra=s.ra*Math.PI/180, de=s.dec*Math.PI/180; return [Math.cos(de)*Math.cos(ra), Math.cos(de)*Math.sin(ra), Math.sin(de)]; }
function sunlit(eci, t){
  const s=sunVec(t), d=eci.x*s[0]+eci.y*s[1]+eci.z*s[2]; if(d>0) return true;
  const px=eci.x-d*s[0], py=eci.y-d*s[1], pz=eci.z-d*s[2]; return Math.hypot(px,py,pz) > 6378;
}

/* Pass predictions over the observer. Coarse step finds the passes, bisection
   refines AOS/LOS. "visible" = observer in darkness AND the ISS sunlit at
   some point above 10° — those are the ones you can actually see. */
export async function passes(tle, obs, {days=4, minEl=10, step=30}={}){
  const S=await lib(), rec=await satrec(tle);
  const og={ latitude:obs.lat*Math.PI/180, longitude:obs.lon*Math.PI/180, height:(obs.alt||100)/1000 };
  const look=t=>{ const d=new Date(t), pv=S.propagate(rec,d); if(!pv||!pv.position) return null;
    const la=S.ecfToLookAngles(og, S.eciToEcf(pv.position,S.gstime(d))); return { el:la.elevation*180/Math.PI, az:la.azimuth*180/Math.PI, eci:pv.position, km:la.rangeSat }; };
  const edge=(a,b)=>{ for(let k=0;k<14;k++){ const m=(a+b)/2, l=look(m); if(l && l.el>0) b=m; else a=m; } return b; };
  const out=[], t0=Date.now()-5*60e3, end=t0+days*86400e3;
  let prev=look(t0), t=t0;
  // yield to the UI every ~2000 steps so a potato never stutters
  let n=0;
  while(t<end){
    const t2=t+step*1000, cur=look(t2);
    if(prev && cur && prev.el<=0 && cur.el>0){
      const aos=edge(t,t2); let los=aos, max={el:-90}, tMax=aos, vis=false;
      for(let x=aos; x<aos+20*60e3; x+=10e3){ const l=look(x); if(!l || l.el<=0){ los=x; break; }
        if(l.el>max.el){ max=l; tMax=x; }
        if(l.el>=minEl && !vis && sunPos(x,obs.lat,obs.lon).alt < -6 && sunlit(l.eci,x)) vis=true; }
      if(max.el>=minEl){ const a=look(aos), b=look(los);
        out.push({ aos, los, tMax, maxEl:max.el, dur:(los-aos)/1000, azStart:a?a.az:0, azEnd:b?b.az:0, azMax:max.az,
                   from:compass(a?a.az:0), to:compass(b?b.az:0), at:compass(max.az), visible:vis, km:max.km }); }
      t=Math.max(t2, los); prev=look(t); continue;
    }
    prev=cur; t=t2;
    if(++n%2000===0) await new Promise(r=>setTimeout(r,0));
  }
  return out;
}
