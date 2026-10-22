// ===========================================================================
// FIELD TOOLS: offline utilities that only need the device itself.
// Morse translator (sound + light), SOS strobe, compass, sun & moon,
// unit converter, weather math, battery runtime, CPR metronome.
// ===========================================================================
import { toMorse, fromMorse, UNITS, TEMP, windChill, heatIndex, dewPoint, sunTimes, moonPhase, moonName } from "./guide.js";

const esc = s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtT = d => d instanceof Date ? d.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" }) : d==="day" ? "sun up all day" : "sun down all day";
const r1 = (n,d=1)=> (Math.round(n*10**d)/10**d).toLocaleString();

export const TOOLS = [
  { id:"morse", name:"Morse code", sub:"type → dots · play as sound or light" },
  { id:"sos", name:"SOS light", sub:"full-screen strobe · signal or flashlight" },
  { id:"compass", name:"Compass", sub:"device sensor · no signal needed" },
  { id:"sun", name:"Sun & moon", sub:"sunrise, sunset, daylight, moon phase" },
  { id:"units", name:"Unit converter", sub:"length, weight, volume, temp, pressure…" },
  { id:"wx", name:"Weather math", sub:"wind chill · heat index · dew point" },
  { id:"power", name:"Battery runtime", sub:"how long will my power last?" },
  { id:"cpr", name:"CPR metronome", sub:"110 beats per minute, sound + flash" },
];

/* ---------------------------------------------------------- audio */
let AC = null;
const ac = ()=> AC || (AC = new (window.AudioContext || window.webkitAudioContext)());
function tone(t0, dur, f=700){ const a=ac(), o=a.createOscillator(), g=a.createGain(); o.frequency.value=f; o.type="sine";
  g.gain.setValueAtTime(0,t0); g.gain.linearRampToValueAtTime(.35,t0+.005); g.gain.setValueAtTime(.35,t0+dur-.005); g.gain.linearRampToValueAtTime(0,t0+dur);
  o.connect(g).connect(a.destination); o.start(t0); o.stop(t0+dur+.02); }
// Morse timings in units: dot 1, dash 3, gap 1, letter 3, word 7
function schedule(code, wpm){ const u = 1.2/wpm, out=[]; let t=0;
  for(const ch of code){ if(ch==="."){ out.push([t,u]); t+=2*u; } else if(ch==="-"){ out.push([t,3*u]); t+=4*u; } else if(ch===" "){ t+=2*u; } else if(ch==="/"){ t+=4*u; } }
  return { marks:out, len:t }; }

/* ---------------------------------------------------------- mount */
export function mountTool(el, id, K, back){
  const offs = [];
  const on = (t,ev,fn,o)=>{ t.addEventListener(ev,fn,o); offs.push(()=>t.removeEventListener(ev,fn,o)); };
  const timers = [];
  const loc = K.LS.get("turd_wx_loc", null) || { lat:34.9889, lon:-90.0126 };   // same default as Weather
  const head = (t,s)=>`<div class="xt-head"><button class="xt-back" data-back>◀ Tools</button><h2>${t}</h2><span>${s||""}</span></div>`;
  const T = TOOLS.find(t=>t.id===id);

  if(id==="morse"){
    el.innerHTML = head(T.name, T.sub) + `<div class="xt-grid2">
      <div class="xt-box"><label>Text</label><textarea id="xmT" rows="3" placeholder="SOS NEED WATER">SOS</textarea>
        <label>Morse</label><textarea id="xmM" rows="3" class="xt-mono"></textarea>
        <div class="xt-row"><label class="xt-inl">Speed <input id="xmW" type="range" min="5" max="25" value="12"> <b id="xmWv">12</b> wpm</label></div>
        <div class="xt-row"><button class="t-btn sm" id="xmPlay">▶ Sound</button><button class="t-btn sm" id="xmFlash">✺ Light</button><button class="t-btn sm" id="xmStop">■ Stop</button></div>
        <div class="xt-lamp" id="xmLamp"></div></div>
      <div class="xt-box"><label>Chart</label><div class="xt-chart">${"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("").map(c=>`<span><b>${c}</b>${toMorse(c).replace(/\./g,"·").replace(/-/g,"–")}</span>`).join("")}</div>
        <p class="xg-p">Slash (/) separates words. SOS is <b>··· ––– ···</b> sent as one run. Paste dots and dashes into the lower box to decode.</p></div></div>`;
    const t=el.querySelector("#xmT"), m=el.querySelector("#xmM"), w=el.querySelector("#xmW"), lamp=el.querySelector("#xmLamp");
    let lock=false; const enc=()=>{ if(lock) return; lock=true; m.value=toMorse(t.value).replace(/\./g,"·").replace(/-/g,"–"); lock=false; };
    const dec=()=>{ if(lock) return; lock=true; t.value=fromMorse(m.value.replace(/·/g,".").replace(/–/g,"-")); lock=false; };
    on(t,"input",enc); on(m,"input",dec); on(w,"input",()=>el.querySelector("#xmWv").textContent=w.value); enc();
    const stop=()=>{ timers.splice(0).forEach(clearTimeout); lamp.classList.remove("on"); if(AC){ AC.close(); AC=null; } };
    on(el.querySelector("#xmStop"),"click",stop);
    on(el.querySelector("#xmPlay"),"click",()=>{ stop(); const s=schedule(toMorse(t.value),+w.value), t0=ac().currentTime+.1; s.marks.forEach(([a,d])=>tone(t0+a,d)); });
    on(el.querySelector("#xmFlash"),"click",()=>{ stop(); const s=schedule(toMorse(t.value),+w.value);
      s.marks.forEach(([a,d])=>{ timers.push(setTimeout(()=>lamp.classList.add("on"),a*1000)); timers.push(setTimeout(()=>lamp.classList.remove("on"),(a+d)*1000)); }); });
    offs.push(stop);
  }

  if(id==="sos"){
    el.innerHTML = head(T.name, T.sub) + `<div class="xt-box xt-center">
      <p class="xg-p">Full-screen light for signaling or as a flashlight. Turn screen brightness all the way up. Tap the light to exit.</p>
      <div class="xt-row xt-wrap"><button class="t-btn" data-m="sos">SOS (··· ––– ···)</button><button class="t-btn" data-m="strobe">Strobe</button><button class="t-btn" data-m="white">Steady white</button><button class="t-btn" data-m="red">Red (night vision)</button></div></div>`;
    on(el,"click",ev=>{ const b=ev.target.closest("[data-m]"); if(!b) return;
      const ov=document.createElement("div"); ov.className="xt-light "+b.dataset.m; document.body.appendChild(ov);
      try{ ov.requestFullscreen && ov.requestFullscreen().catch(()=>{}); }catch(e){}
      let wake=null; try{ navigator.wakeLock && navigator.wakeLock.request("screen").then(w=>wake=w).catch(()=>{}); }catch(e){}
      const tt=[]; const mode=b.dataset.m;
      if(mode==="sos"){ const s=schedule(toMorse("SOS")+" / ",8); const run=()=>{ s.marks.forEach(([a,d])=>{ tt.push(setTimeout(()=>ov.classList.add("lit"),a*1000)); tt.push(setTimeout(()=>ov.classList.remove("lit"),(a+d)*1000)); }); tt.push(setTimeout(run,(s.len+1.4)*1000)); }; run(); }
      if(mode==="strobe"){ let x=false; tt.push(setInterval(()=>ov.classList.toggle("lit",x=!x),120)); }
      if(mode==="white"||mode==="red") ov.classList.add("lit");
      const close=()=>{ tt.forEach(x=>{ clearTimeout(x); clearInterval(x); }); try{ document.fullscreenElement && document.exitFullscreen(); }catch(e){} wake && wake.release && wake.release(); ov.remove(); };
      ov.addEventListener("click",close); offs.push(close);
    });
  }

  if(id==="compass"){
    el.innerHTML = head(T.name, T.sub) + `<div class="xt-box xt-center">
      <div class="xt-rose"><svg viewBox="0 0 200 200"><g id="xcDial">
        <circle cx="100" cy="100" r="92" class="ring"/>${Array.from({length:72},(_,i)=>{ const a=i*5, L=i%18===0?14:i%6===0?9:5, r=a*Math.PI/180;
          return `<line x1="${100+Math.sin(r)*(92-L)}" y1="${100-Math.cos(r)*(92-L)}" x2="${100+Math.sin(r)*92}" y2="${100-Math.cos(r)*92}" class="${i%18===0?"maj":""}"/>`; }).join("")}
        ${[["N",0],["E",90],["S",180],["W",270]].map(([l,a])=>{ const r=a*Math.PI/180; return `<text x="${100+Math.sin(r)*66}" y="${100-Math.cos(r)*66+6}" class="${l==="N"?"n":""}">${l}</text>`; }).join("")}
      </g><path d="M100 18 L108 44 L92 44Z" class="idx"/></svg><div class="xt-hdg" id="xcHdg">---°</div></div>
      <button class="t-btn sm" id="xcGo">Start compass</button>
      <p class="xg-p" id="xcMsg">Hold the device flat, away from metal and magnets. Wave it in a figure-8 to calibrate. On a PC without a magnetometer, use the shadow-stick or North Star methods in the Field Guide.</p></div>`;
    const dial=el.querySelector("#xcDial"), hdg=el.querySelector("#xcHdg"), msg=el.querySelector("#xcMsg");
    let got=false; const card=a=>["N","NE","E","SE","S","SW","W","NW"][Math.round(a/45)%8];
    const onO=e=>{ let h = e.webkitCompassHeading!=null ? e.webkitCompassHeading : (e.absolute||e.type==="deviceorientationabsolute") && e.alpha!=null ? (360-e.alpha)%360 : null;
      if(h==null) return; got=true; h=(h+(screen.orientation&&screen.orientation.angle||0))%360;
      dial.style.transform=`rotate(${-h}deg)`; hdg.textContent=`${Math.round(h)}° ${card(h)}`; };
    on(el.querySelector("#xcGo"),"click",async()=>{
      try{ if(window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) await DeviceOrientationEvent.requestPermission(); }catch(e){}
      on(window,"deviceorientationabsolute",onO); on(window,"deviceorientation",onO);
      setTimeout(()=>{ if(!got) msg.textContent="No compass sensor reported a heading on this device. Phones and most tablets have one; most PCs don't."; },2500);
    });
  }

  if(id==="sun"){
    el.innerHTML = head(T.name, T.sub) + `<div class="xt-box"><div class="xt-row xt-wrap">
      <label class="xt-inl">Lat <input id="xsLat" type="number" step="0.0001" value="${loc&&loc.lat!=null?loc.lat:""}"></label>
      <label class="xt-inl">Lon <input id="xsLon" type="number" step="0.0001" value="${loc&&loc.lon!=null?loc.lon:""}"></label>
      <label class="xt-inl">Date <input id="xsD" type="date" value="${new Date().toISOString().slice(0,10)}"></label>
      <button class="t-btn sm" id="xsGps">Use GPS</button></div><div id="xsOut" class="xt-stats"></div></div>`;
    const lat=el.querySelector("#xsLat"), lon=el.querySelector("#xsLon"), d=el.querySelector("#xsD"), out=el.querySelector("#xsOut");
    const calc=()=>{ const la=+lat.value, lo=+lon.value; if(lat.value===""||lon.value===""){ out.innerHTML=`<p class="xg-p">Enter a latitude/longitude or tap Use GPS (works offline on phones).</p>`; return; }
      const [y,m,dd]=d.value.split("-").map(Number), day=new Date(y,m-1,dd), s=sunTimes(day,la,lo), p=moonPhase(new Date(y,m-1,dd,12));
      const hrs = s.dayLen/36e5;
      out.innerHTML=[["Sunrise",fmtT(s.rise)],["Sunset",fmtT(s.riseSet)],["Solar noon",fmtT(s.noon)],["Daylight",`${Math.floor(hrs)} h ${Math.round(hrs%1*60)} m`],
        ["First light (civil)",fmtT(s.civil)],["Last light (civil)",fmtT(s.civilSet)],["Moon",`${moonName(p)} · ${Math.round((1-Math.cos(p*2*Math.PI))/2*100)}% lit`],["Times shown in","this device's time zone"]]
        .map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join(""); };
    [lat,lon,d].forEach(i=>on(i,"input",calc)); calc();
    on(el.querySelector("#xsGps"),"click",()=>navigator.geolocation && navigator.geolocation.getCurrentPosition(p=>{ lat.value=p.coords.latitude.toFixed(4); lon.value=p.coords.longitude.toFixed(4); calc(); },()=>K.toast("location unavailable"),{ timeout:15000 }));
  }

  if(id==="units"){
    const cats=[...Object.keys(UNITS),"Temperature"];
    el.innerHTML = head(T.name, T.sub) + `<div class="xt-box"><div class="xt-tabs">${cats.map((c,i)=>`<button class="t-link ${i?"":"on"}" data-c="${c}">${c}</button>`).join("")}</div><div id="xuBody"></div></div>`;
    const body=el.querySelector("#xuBody"); let cat=cats[0];
    const draw=()=>{ const units = cat==="Temperature" ? TEMP.units : Object.keys(UNITS[cat]);
      body.innerHTML=`<div class="xt-conv"><input id="xuV" type="number" value="1"><select id="xuF">${units.map(u=>`<option>${esc(u)}</option>`).join("")}</select></div><div class="xt-stats" id="xuOut"></div>`;
      const v=body.querySelector("#xuV"), f=body.querySelector("#xuF"), o=body.querySelector("#xuOut");
      const calc=()=>{ const x=+v.value; o.innerHTML=units.filter(u=>u!==f.value).map(u=>{ const r = cat==="Temperature" ? TEMP.conv(x,f.value,u) : x*UNITS[cat][f.value]/UNITS[cat][u];
        const s = Math.abs(r)>=1e6||(Math.abs(r)<1e-3&&r!==0) ? r.toExponential(4) : r1(r, Math.abs(r)<1?5:3); return `<div><span>${esc(u)}</span><b>${s}</b></div>`; }).join(""); };
      on(v,"input",calc); on(f,"change",calc); calc(); };
    on(el,"click",ev=>{ const b=ev.target.closest("[data-c]"); if(!b) return; cat=b.dataset.c; el.querySelectorAll("[data-c]").forEach(x=>x.classList.toggle("on",x===b)); draw(); });
    draw();
  }

  if(id==="wx"){
    el.innerHTML = head(T.name, T.sub) + `<div class="xt-box"><div class="xt-row xt-wrap">
      <label class="xt-inl">Temp °F <input id="xwT" type="number" value="35"></label><label class="xt-inl">Wind mph <input id="xwV" type="number" value="15"></label>
      <label class="xt-inl">Humidity % <input id="xwH" type="number" value="60" min="1" max="100"></label></div><div id="xwOut" class="xt-stats"></div>
      <p class="xg-p">NWS formulas. Wind chill applies at 50 °F or colder with wind ≥ 3 mph; heat index matters above about 80 °F. Frostbite can set in within 30 minutes once wind chill is below about −15 °F.</p></div>`;
    const T_=el.querySelector("#xwT"), V=el.querySelector("#xwV"), H=el.querySelector("#xwH"), o=el.querySelector("#xwOut");
    const calc=()=>{ const t=+T_.value, v=+V.value, h=Math.max(1,Math.min(100,+H.value)), wc=windChill(t,v), hi=heatIndex(t,h), dp=dewPoint((t-32)*5/9,h)*9/5+32;
      const risk = hi>=125?"Extreme danger":hi>=103?"Danger":hi>=90?"Extreme caution":hi>=80?"Caution":"Low";
      o.innerHTML=[["Wind chill", wc==null?"n/a":r1(wc,0)+" °F"],["Heat index", t<80?"n/a":`${r1(hi,0)} °F · ${risk}`],["Dew point", r1(dp,0)+" °F"],["Feels", t<=50&&wc!=null?r1(wc,0)+" °F":t>=80?r1(hi,0)+" °F":t+" °F"]]
        .map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join(""); };
    [T_,V,H].forEach(i=>on(i,"input",calc)); calc();
  }

  if(id==="power"){
    el.innerHTML = head(T.name, T.sub) + `<div class="xt-box"><div class="xt-row xt-wrap">
      <label class="xt-inl">Capacity <input id="xpC" type="number" value="20000"></label>
      <select id="xpU"><option value="mah">mAh @ 3.7 V (power bank)</option><option value="wh">Wh (power station)</option><option value="ah12">Ah @ 12 V (car/deep-cycle)</option></select>
      <label class="xt-inl">Chemistry <select id="xpK"><option value=".85">Li-ion / LiFePO4</option><option value=".5">Lead-acid (50% rule)</option></select></label>
      <label class="xt-inl">Load W <input id="xpL" type="number" value="10"></label>
      <label class="xt-inl">Via inverter (AC) <input id="xpI" type="checkbox"></label></div><div id="xpOut" class="xt-stats"></div>
      <p class="xg-p">Typical loads: phone 5–15 W, laptop 30–90 W, Steam Deck 15–30 W, router 6–12 W, CPAP 30–60 W, fridge 100–200 W average. Usable energy accounts for conversion losses.</p></div>`;
    const g=s=>el.querySelector(s), o=g("#xpOut");
    const calc=()=>{ const c=+g("#xpC").value, u=g("#xpU").value, k=+g("#xpK").value, L=Math.max(.1,+g("#xpL").value), inv=g("#xpI").checked;
      const wh = u==="mah" ? c/1000*3.7 : u==="ah12" ? c*12 : c, usable = wh*k*(inv?.88:1), h = usable/L;
      o.innerHTML=[["Stored",r1(wh,0)+" Wh"],["Usable",r1(usable,0)+" Wh"],["Runtime", h>=48?`${r1(h/24,1)} days`:`${Math.floor(h)} h ${Math.round(h%1*60)} m`],["Phone charges (~15 Wh)",r1(usable/15,0)]]
        .map(([k,v])=>`<div><span>${k}</span><b>${v}</b></div>`).join(""); };
    el.querySelectorAll("input,select").forEach(i=>on(i,"input",calc)); calc();
  }

  if(id==="cpr"){
    el.innerHTML = head(T.name, T.sub) + `<div class="xt-box xt-center"><div class="xt-beat" id="xcB">110</div>
      <div class="xt-row"><button class="t-btn" id="xcS">Start</button><button class="t-btn sm" id="xcX">Stop</button></div>
      <p class="xg-p">Push hard and fast in the center of the chest, at least 2 inches deep, on every beat. Call 911 first and put the phone on speaker. Full steps are under Field Guide → First aid → CPR.</p><div class="xt-count" id="xcN"></div></div>`;
    const B=el.querySelector("#xcB"), Nn=el.querySelector("#xcN"); let iv=null, n=0;
    const stop=()=>{ clearInterval(iv); iv=null; B.classList.remove("on"); };
    on(el.querySelector("#xcS"),"click",()=>{ stop(); n=0; iv=setInterval(()=>{ n++; try{ tone(ac().currentTime,.06, n%30===0?990:660); }catch(e){} B.classList.add("on"); setTimeout(()=>B.classList.remove("on"),90); Nn.textContent = `${n%30||30} / 30`; }, 60000/110); });
    on(el.querySelector("#xcX"),"click",stop); offs.push(stop);
  }

  on(el,"click",ev=>{ if(ev.target.closest("[data-back]")) back(); });
  return ()=>{ offs.forEach(f=>{ try{ f(); }catch(e){} }); timers.forEach(clearTimeout); };
}
