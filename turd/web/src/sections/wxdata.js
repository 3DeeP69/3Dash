// ===========================================================================
// Weather data layer — shared by the Weather section and the Home briefing.
// Keyless sources, all CORS-friendly from a browser / webview:
//   Open-Meteo forecast + air quality + geocoding, NWS alerts (US), BigDataCloud reverse geocode.
// Results are cached for offline use and so Home never waits on the network.
// ===========================================================================
import { LS } from "./util.js";

export const DEFAULT_LOC = { lat:34.9889, lon:-90.0126, name:"Southaven, MS", mode:"default" };
const TTL = 10*60*1000;

export const units = ()=> LS.get("turd_wx_units","F");
export const setUnits = u=> LS.set("turd_wx_units",u);
export const getLoc = ()=> LS.get("turd_wx_loc",null);
export const setLoc = l=> LS.set("turd_wx_loc",l);
export const places = ()=> LS.get("turd_wx_places",[]);
export const setPlaces = p=> LS.set("turd_wx_places",p.slice(0,8));
export const cached = ()=> LS.get("turd_wx_cache",null);

/* WMO code → [label, kind] */
const W = {0:["Clear","clear"],1:["Mainly clear","clear"],2:["Partly cloudy","partly"],3:["Overcast","cloud"],
  45:["Fog","fog"],48:["Rime fog","fog"],51:["Light drizzle","rain"],53:["Drizzle","rain"],55:["Heavy drizzle","rain"],
  56:["Freezing drizzle","rain"],57:["Freezing drizzle","rain"],61:["Light rain","rain"],63:["Rain","rain"],65:["Heavy rain","rain"],
  66:["Freezing rain","rain"],67:["Freezing rain","rain"],71:["Light snow","snow"],73:["Snow","snow"],75:["Heavy snow","snow"],
  77:["Snow grains","snow"],80:["Light showers","rain"],81:["Showers","rain"],82:["Violent showers","storm"],
  85:["Snow showers","snow"],86:["Heavy snow showers","snow"],95:["Thunderstorm","storm"],96:["Storm with hail","storm"],99:["Severe storm + hail","storm"]};
export const wmo = c=> W[c] || ["Unknown","cloud"];

/* ------------------------------------------------------------ location */
export function gps(timeout=7000){
  return new Promise(res=>{
    if(!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(p=>res({lat:+p.coords.latitude.toFixed(4),lon:+p.coords.longitude.toFixed(4)}),()=>res(null),
      {timeout, maximumAge:15*60*1000, enableHighAccuracy:false});
  });
}
export async function reverseName(lat,lon,http=fetch){
  try{
    const r=await http(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    const d=await r.json();
    const town=d.city||d.locality||d.principalSubdivision;
    const st=(d.principalSubdivisionCode||"").split("-").pop();
    if(town) return st && d.countryCode==="US" ? `${town}, ${st}` : `${town}${d.countryName?", "+d.countryName:""}`;
  }catch(e){}
  return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
}
export async function search(q,http=fetch){
  const r=await http(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`);
  const d=await r.json();
  return (d.results||[]).map(p=>({lat:p.latitude,lon:p.longitude,
    name:`${p.name}${p.admin1?", "+p.admin1:""}${p.country_code&&p.country_code!=="US"?" · "+p.country_code:""}`, mode:"fixed"}));
}
/* Resolve the active location: saved fixed place → GPS → default. */
export async function resolveLoc(http=fetch, {fresh=false}={}){
  const saved=getLoc();
  if(saved && saved.mode==="fixed") return saved;
  if(saved && saved.mode==="gps" && !fresh) return saved;
  const g=await gps();
  if(g){ const l={...g, name:await reverseName(g.lat,g.lon,http), mode:"gps"}; setLoc(l); return l; }
  return saved || DEFAULT_LOC;
}

/* ------------------------------------------------------------ fetch */
export async function load(http=fetch, {force=false, loc=null}={}){
  const u=units();
  const c=cached();
  const L = loc || await resolveLoc(http);
  if(!force && c && c.units===u && Math.abs(c.loc.lat-L.lat)<0.01 && Math.abs(c.loc.lon-L.lon)<0.01 && Date.now()-c.t<TTL) return c;

  const imp=u==="F";
  const fq=`https://api.open-meteo.com/v1/forecast?latitude=${L.lat}&longitude=${L.lon}`+
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,dew_point_2m,weather_code,is_day,cloud_cover,precipitation,`+
      `pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,uv_index`+
    `&hourly=temperature_2m,precipitation_probability,weather_code,is_day&forecast_hours=25`+
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,precipitation_sum,wind_speed_10m_max`+
    `&forecast_days=7&timezone=auto&timeformat=unixtime`+
    (imp?`&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch`:`&wind_speed_unit=kmh`);
  const aq=`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${L.lat}&longitude=${L.lon}&current=us_aqi,pm2_5,pm10,ozone&timezone=auto`;
  const al=`https://api.weather.gov/alerts/active?point=${L.lat},${L.lon}`;

  const [f,a,n]=await Promise.allSettled([
    http(fq).then(r=>{ if(!r.ok) throw new Error("wx "+r.status); return r.json(); }),
    http(aq).then(r=>r.json()),
    http(al,{headers:{Accept:"application/geo+json"}}).then(r=>r.ok?r.json():{features:[]}),
  ]);
  if(f.status!=="fulfilled"){
    if(c) return {...c, stale:true};
    throw f.reason;
  }
  const out={ t:Date.now(), units:u, loc:L, data:f.value,
    aqi: a.status==="fulfilled" ? a.value.current||null : null,
    alerts: n.status==="fulfilled" ? (n.value.features||[]).map(x=>({
      event:x.properties.event, severity:x.properties.severity, headline:x.properties.headline,
      ends:x.properties.ends||x.properties.expires, desc:(x.properties.description||"").slice(0,900),
      instruction:(x.properties.instruction||"").slice(0,500)})) : [] };
  LS.set("turd_wx_cache",out);
  return out;
}

/* ------------------------------------------------------------ derived briefing (used by Home) */
export function brief(w){
  if(!w) return null;
  const d=w.data, c=d.current, [label,kind]=wmo(c.weather_code);
  const U=w.units==="F"?"°F":"°C";
  // next rain in the coming 12h
  let rain=null;
  const now=Date.now();
  for(let i=0;i<Math.min(25,d.hourly.time.length);i++){
    const t=d.hourly.time[i]*1000; if(t<now-30*60e3) continue;
    if(t-now>12*3600e3) break;
    if((d.hourly.precipitation_probability[i]||0)>=50){ rain={t, p:d.hourly.precipitation_probability[i]}; break; }
  }
  return {
    temp:Math.round(c.temperature_2m), feels:Math.round(c.apparent_temperature), U, label, kind, isDay:!!c.is_day,
    hi:Math.round(d.daily.temperature_2m_max[0]), lo:Math.round(d.daily.temperature_2m_min[0]),
    wind:Math.round(c.wind_speed_10m), windU:w.units==="F"?"mph":"km/h",
    rain, alerts:w.alerts||[], aqi:w.aqi?.us_aqi ?? null, loc:w.loc.name, t:w.t, stale:!!w.stale,
    uv: d.daily.uv_index_max?.[0] ?? null,
    next: d.hourly.time.map((t,i)=>({t:t*1000, v:Math.round(d.hourly.temperature_2m[i]), c:d.hourly.weather_code[i], day:!!d.hourly.is_day[i], p:d.hourly.precipitation_probability[i]||0}))
      .filter(h=>h.t>now-30*60e3).filter((_,i)=>i%2===0).slice(0,6),
  };
}
export const fmtHour = t=> new Date(t).toLocaleTimeString([], {hour:"numeric"});
