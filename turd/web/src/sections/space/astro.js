// ===========================================================================
// SPACE · offline astronomy. Everything here is pure math: no network, no
// libraries, cheap enough for a potato. Accuracy is "naked-eye good" (sun and
// moon to a fraction of a degree, planets to ~1°, rise/set to a minute or two).
//   sunPos / moonPos / planets  → RA/Dec + alt/az for an observer
//   moonPhase / nextPhases       → illumination, age, next new/full moon
//   sunTimes                     → sunrise/sunset + civil/astro twilight
//   planetsTonight               → which planets are up after dark, and when
//   meteorShowers                → next showers with the moon's interference
//   auroraOdds                   → Kp needed to see the aurora from here
// ===========================================================================
const D2R = Math.PI/180, R2D = 180/Math.PI;
const sin = x=>Math.sin(x*D2R), cos = x=>Math.cos(x*D2R), tan = x=>Math.tan(x*D2R);
const asin = x=>Math.asin(x)*R2D, atan2 = (y,x)=>Math.atan2(y,x)*R2D, acos = x=>Math.acos(Math.max(-1,Math.min(1,x)))*R2D;
export const norm = a=>((a%360)+360)%360;
const jdN = t=> t/86400000 + 2440587.5 - 2451545.0;          // days since J2000.0
const obliq = n=> 23.439 - 0.0000004*n;

/* ecliptic (lon, lat) → equatorial RA/Dec, degrees */
function ecl2eq(lam, bet, n){
  const e=obliq(n);
  const ra = norm(atan2(sin(lam)*cos(e) - tan(bet)*sin(e), cos(lam)));
  const dec = asin(sin(bet)*cos(e) + cos(bet)*sin(e)*sin(lam));
  return { ra, dec };
}
/* local sidereal time, degrees */
export const lst = (t, lon)=> norm(280.46061837 + 360.98564736629*jdN(t) + lon);
/* RA/Dec → altitude/azimuth (azimuth from north, clockwise) */
export function altAz(ra, dec, t, lat, lon){
  const H = norm(lst(t,lon) - ra);
  const alt = asin(sin(lat)*sin(dec) + cos(lat)*cos(dec)*cos(H));
  const az = norm(atan2(sin(H), cos(H)*sin(lat) - tan(dec)*cos(lat)) + 180);
  return { alt, az };
}
export const compass = az=> ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"][Math.round(norm(az)/22.5)%16];

/* ------------------------------------------------------------ sun */
export function sunEcl(t){
  const n=jdN(t), L=norm(280.460+0.9856474*n), g=norm(357.528+0.9856003*n);
  return { lam: norm(L + 1.915*sin(g) + 0.020*sin(2*g)), g, n, R: 1.00014 - 0.01671*cos(g) - 0.00014*cos(2*g) };
}
export function sunPos(t, lat, lon){
  const s=sunEcl(t), q=ecl2eq(s.lam, 0, s.n);
  return { ...q, ...(lat==null?{}:altAz(q.ra,q.dec,t,lat,lon)) };
}
/* sub-solar point (for the day/night terminator on the ISS map) */
export function subSolar(t){
  const s=sunPos(t);
  return { lat: s.dec, lon: ((s.ra - lst(t,0) + 540) % 360) - 180 };
}

/* ------------------------------------------------------------ moon (truncated ELP, ~0.3°) */
export function moonEcl(t){
  const n=jdN(t);
  const L=norm(218.316+13.176396*n), M=norm(134.963+13.064993*n), F=norm(93.272+13.229350*n),
        D=norm(297.850+12.190749*n), Ms=norm(357.528+0.9856003*n);
  const lam = norm(L + 6.289*sin(M) + 1.274*sin(2*D-M) + 0.658*sin(2*D) + 0.214*sin(2*M) - 0.186*sin(Ms) - 0.114*sin(2*F)
               + 0.059*sin(2*D-2*M) + 0.057*sin(2*D-Ms-M) + 0.053*sin(2*D+M) + 0.046*sin(2*D-Ms) - 0.041*sin(Ms-M));
  const bet = 5.128*sin(F) + 0.281*sin(M+F) + 0.278*sin(M-F) + 0.173*sin(2*D-F);
  const km = 385001 - 20905*cos(M) - 3699*cos(2*D-M) - 2956*cos(2*D);
  return { lam, bet, km, n };
}
export function moonPos(t, lat, lon){
  const m=moonEcl(t), q=ecl2eq(m.lam, m.bet, m.n);
  const out={ ...q, km:m.km };
  if(lat!=null){ const a=altAz(q.ra,q.dec,t,lat,lon); a.alt -= 0.95*cos(a.alt); Object.assign(out,a); } // topocentric parallax
  return out;
}
const PHASES=["New moon","Waxing crescent","First quarter","Waxing gibbous","Full moon","Waning gibbous","Last quarter","Waning crescent"];
export function moonPhase(t=Date.now()){
  const s=sunEcl(t), m=moonEcl(t), el=norm(m.lam - s.lam);
  const illum=(1 - cos(acos(cos(m.bet)*cos(m.lam - s.lam))))/2;
  const age=el/360*29.530589;
  const idx=Math.round(el/45)%8;
  return { illum, age, elong:el, waxing:el<180, name:PHASES[idx], km:m.km };
}
/* time of the next moment the sun–moon elongation hits `target` degrees (0 new, 90 FQ, 180 full, 270 LQ) */
export function nextElong(target, from=Date.now()){
  const f=t=>{ let d=norm(moonEcl(t).lam - sunEcl(t).lam) - target; if(d>180) d-=360; if(d<-180) d+=360; return d; };
  let t=from, v=f(t);
  for(let i=0;i<24*31;i++){ const t2=t+3600e3, v2=f(t2); if(v<0 && v2>=0 && v2-v<90){ let a=t,b=t2; for(let k=0;k<30;k++){ const m=(a+b)/2; if(f(m)<0) a=m; else b=m; } return (a+b)/2; } t=t2; v=v2; }
  return null;
}
export const nextPhases = (from=Date.now())=>[
  { name:"New moon", t:nextElong(0,from) }, { name:"First quarter", t:nextElong(90,from) },
  { name:"Full moon", t:nextElong(180,from) }, { name:"Last quarter", t:nextElong(270,from) },
].filter(p=>p.t).sort((a,b)=>a.t-b.t);

/* ------------------------------------------------------------ rise / set / twilight */
// Find the crossings of altitude `h` for body fn(t)->{alt} within [t0, t0+span). 5-min scan + bisection.
function crossings(fn, h, t0, span=36*3600e3){
  const out=[]; let a=t0, va=fn(a).alt-h;
  for(let t=t0+300e3; t<=t0+span; t+=300e3){
    const vb=fn(t).alt-h;
    if((va<0)!==(vb<0)){ let lo=a, hi=t; for(let k=0;k<16;k++){ const m=(lo+hi)/2, vm=fn(m).alt-h; if((va<0)===(vm<0)) lo=m; else hi=m; }
      out.push({ t:(lo+hi)/2, rising: va<0 }); }
    a=t; va=vb;
  }
  return out;
}
export function sunTimes(lat, lon, t=Date.now()){
  const d=new Date(t); d.setHours(0,0,0,0); const t0=d.getTime();
  const sun=x=>sunPos(x,lat,lon);
  const pick=(h)=>{ const c=crossings(sun,h,t0,24*3600e3); return { rise:(c.find(x=>x.rising)||{}).t||null, set:(c.find(x=>!x.rising)||{}).t||null }; };
  const sr=pick(-0.833), civ=pick(-6), ast=pick(-18);
  return { sunrise:sr.rise, sunset:sr.set, dawn:civ.rise, dusk:civ.set, astroDawn:ast.rise, astroDusk:ast.set,
           dayLen: sr.rise&&sr.set ? sr.set-sr.rise : null };
}
export function moonTimes(lat, lon, t=Date.now()){
  const c=crossings(x=>moonPos(x,lat,lon), 0.125, t, 30*3600e3);
  return { rise:(c.find(x=>x.rising)||{}).t||null, set:(c.find(x=>!x.rising)||{}).t||null };
}
/* next stretch of darkness (sun below -12°) starting from t */
export function nextNight(lat, lon, t=Date.now()){
  const sun=x=>sunPos(x,lat,lon);
  if(sun(t).alt < -12){ const c=crossings(sun,-12,t,20*3600e3).find(x=>x.rising); return { start:t, end:c?c.t:t+8*3600e3, now:true }; }
  const c=crossings(sun,-12,t,40*3600e3); const s=c.find(x=>!x.rising); if(!s) return null;
  const e=c.find(x=>x.rising && x.t>s.t); return { start:s.t, end:e?e.t:s.t+9*3600e3, now:false };
}

/* ------------------------------------------------------------ planets (JPL approx. Keplerian elements, 1800–2050) */
// [a, e, I, L, longPeri, node] and per-century rates
const EL = {
  Mercury:[[0.38709927,0.20563593,7.00497902,252.25032350,77.45779628,48.33076593],[0.00000037,0.00001906,-0.00594749,149472.67411175,0.16047689,-0.12534081]],
  Venus:  [[0.72333566,0.00677672,3.39467605,181.97909950,131.60246718,76.67984255],[0.00000390,-0.00004107,-0.00078890,58517.81538729,0.00268329,-0.27769418]],
  Earth:  [[1.00000261,0.01671123,-0.00001531,100.46457166,102.93768193,0],[0.00000562,-0.00004392,-0.01294668,35999.37244981,0.32327364,0]],
  Mars:   [[1.52371034,0.09339410,1.84969142,-4.55343205,-23.94362959,49.55953891],[0.00001847,0.00007882,-0.00813131,19140.30268499,0.44441088,-0.29257343]],
  Jupiter:[[5.20288700,0.04838624,1.30439695,34.39644051,14.72847983,100.47390909],[-0.00011607,-0.00013253,-0.00183714,3034.74612775,0.21252668,0.20469106]],
  Saturn: [[9.53667594,0.05386179,2.48599187,49.95424423,92.59887831,113.66242448],[-0.00125060,-0.00050991,0.00193609,1222.49362201,-0.41897216,-0.28867794]],
};
export const PLANET_INFO = {
  Mercury:{ glyph:"☿", col:"#c9b9a6", note:"low in twilight, hard to catch" },
  Venus:  { glyph:"♀", col:"#fff3c4", note:"brightest thing after the moon" },
  Mars:   { glyph:"♂", col:"#ff7b54", note:"orange-red, steady" },
  Jupiter:{ glyph:"♃", col:"#ffe0a8", note:"very bright; binoculars show 4 moons" },
  Saturn: { glyph:"♄", col:"#f2d58a", note:"golden; any small scope shows the rings" },
};
function helio(name, n){
  const T=n/36525, [b,r]=EL[name], k=b.map((v,i)=>v+r[i]*T);
  const [a,e,I,L,wb,O]=k, w=wb-O; let M=norm(L-wb); if(M>180) M-=360;
  let E=M+R2D*e*sin(M); for(let i=0;i<6;i++){ E=E-(E-R2D*e*sin(E)-M)/(1-e*cos(E)); }
  const xp=a*(cos(E)-e), yp=a*Math.sqrt(1-e*e)*sin(E);
  return [ (cos(w)*cos(O)-sin(w)*sin(O)*cos(I))*xp + (-sin(w)*cos(O)-cos(w)*sin(O)*cos(I))*yp,
           (cos(w)*sin(O)+sin(w)*cos(O)*cos(I))*xp + (-sin(w)*sin(O)+cos(w)*cos(O)*cos(I))*yp,
           (sin(w)*sin(I))*xp + (cos(w)*sin(I))*yp ];
}
export function planetPos(name, t, lat, lon){
  const n=jdN(t), p=helio(name,n), E=helio("Earth",n);
  const x=p[0]-E[0], y=p[1]-E[1], z=p[2]-E[2], e=23.43928;
  const ye=y*cos(e)-z*sin(e), ze=y*sin(e)+z*cos(e);
  const ra=norm(atan2(ye,x)), dec=atan2(ze,Math.hypot(x,ye)), au=Math.hypot(x,y,z);
  return { ra, dec, au, ...(lat==null?{}:altAz(ra,dec,t,lat,lon)) };
}
/* what's up tonight: best altitude + time for each planet during darkness */
export function planetsTonight(lat, lon, t=Date.now()){
  const night=nextNight(lat,lon,t);
  return Object.keys(PLANET_INFO).map(name=>{
    const now=planetPos(name,t,lat,lon);
    let best=null;
    if(night){ for(let x=night.start; x<=night.end; x+=15*60e3){ const p=planetPos(name,x,lat,lon); if(!best || p.alt>best.alt) best={...p, t:x}; } }
    let up=null, down=null;
    if(night){ for(let x=night.start; x<=night.end; x+=10*60e3){ const a=planetPos(name,x,lat,lon).alt; if(a>10){ if(!up) up=x; down=x; } } }
    return { name, ...PLANET_INFO[name], now, best, up, down, visible: !!(best && best.alt>10) };
  });
}

/* ------------------------------------------------------------ meteor showers (IMO calendar, peaks repeat yearly) */
const SHOWERS = [
  ["Quadrantids",0,3,110,"short, sharp peak · best before dawn"],
  ["Lyrids",3,22,18,"occasional bright fireballs"],
  ["Eta Aquariids",4,6,40,"best in the hour before dawn"],
  ["Southern Delta Aquariids",6,30,25,"faint meteors · dark sky helps"],
  ["Perseids",7,12,100,"the big summer show · warm nights"],
  ["Draconids",9,8,10,"evening shower · sometimes bursts"],
  ["Orionids",9,21,20,"Halley's comet debris · fast meteors"],
  ["Taurids",10,5,5,"slow, bright fireballs"],
  ["Leonids",10,17,15,"fast meteors · best after midnight"],
  ["Geminids",11,14,150,"best shower of the year · visible from mid-evening"],
  ["Ursids",11,22,10,"modest · near the winter solstice"],
];
export function meteorShowers(t=Date.now(), n=4){
  const now=new Date(t), out=[];
  for(const yr of [now.getFullYear(), now.getFullYear()+1]) for(const [name,m,d,zhr,note] of SHOWERS){
    const peak=new Date(yr,m,d,2,0,0).getTime();
    if(peak < t-36*3600e3) continue;
    const ph=moonPhase(peak);
    out.push({ name, peak, zhr, note, moon:ph.illum, moonName:ph.name, days:Math.round((peak-t)/86400e3) });
  }
  return out.sort((a,b)=>a.peak-b.peak).slice(0,n);
}

/* ------------------------------------------------------------ aurora */
// Geomagnetic latitude (centred-dipole, IGRF-14 2025 pole) and the Kp at which the
// aurora's visibility line reaches this observer (NOAA view-line rule of thumb).
const POLE={ lat:80.8, lon:-72.6 };
export const geomagLat = (lat,lon)=> asin(sin(lat)*sin(POLE.lat) + cos(lat)*cos(POLE.lat)*cos(lon-POLE.lon));
export function auroraOdds(lat, lon, kp){
  const gm=Math.abs(geomagLat(lat,lon));
  const overhead=Math.max(0,(66.5-gm)/2.05), horizon=Math.max(0,(58.5-gm)/2.05), camera=Math.max(0,(56-gm)/2.05);
  const need=k=>Math.min(9,Math.ceil(k*3)/3);
  let verdict="Not tonight", level=0;
  if(kp!=null){
    if(kp>=overhead){ verdict="Likely overhead"; level=3; }
    else if(kp>=horizon){ verdict="Possible low on the north horizon"; level=2; }
    else if(kp>=camera){ verdict="Phone-camera chance, look north"; level=1; }
  }
  return { gm, needHorizon:need(horizon), needCamera:need(camera), needOverhead:need(overhead), verdict, level };
}

/* ------------------------------------------------------------ misc */
export const fmtKm = km=> km>=1e6? (km/1e6).toFixed(2)+"M km" : Math.round(km).toLocaleString()+" km";
export const LD_KM = 384400, AU_KM = 149597870.7;
