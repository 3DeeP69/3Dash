// usage: node perf.mjs <webRoot> [label]   env: THROTTLE=4 SECS=home,weather VP=fold-cover,fold-inner,pc QUALITY=HIGH
import { chromium } from "playwright"; import fs from "fs"; import path from "path"; import http from "http";
const root=process.argv[2], tag=process.argv[3]||"run";
const THREE=fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname),"../deps/node_modules/three/build/three.module.js"));
const srv=http.createServer((q,r)=>{ let p=decodeURIComponent(q.url.split("?")[0]); if(p.endsWith("/")) p+="index.html";
  fs.readFile(path.join(root,p),(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{"content-type":p.endsWith(".js")?"text/javascript":p.endsWith(".css")?"text/css":"text/html"}); r.end(d);});});
await new Promise(r=>srv.listen(0,r));
const now=Math.floor(Date.now()/1000/3600)*3600, hrs=Array.from({length:25},(_,i)=>now+i*3600), days=Array.from({length:7},(_,i)=>now-(now%86400)+i*86400);
const fc={current:{temperature_2m:61,apparent_temperature:59,relative_humidity_2m:72,dew_point_2m:52,weather_code:63,is_day:1,cloud_cover:90,precipitation:.1,pressure_msl:1009,wind_speed_10m:12,wind_direction_10m:200,wind_gusts_10m:20,visibility:9000,uv_index:1},
 hourly:{time:hrs,temperature_2m:hrs.map((_,i)=>58+10*Math.sin(i/4)),precipitation_probability:hrs.map(()=>60),weather_code:hrs.map(()=>63),is_day:hrs.map(()=>1)},
 daily:{time:days,weather_code:[63,3,61,0,1,95,71],temperature_2m_max:[68,64,60,70,72,66,50],temperature_2m_min:[52,49,47,50,55,48,33],sunrise:days.map(d=>d),sunset:days.map(d=>d+86000),uv_index_max:[5,4,2,6,7,3,2],precipitation_probability_max:[80,30,85,0,10,60,40],precipitation_sum:[.4,0,.5,0,0,.2,.1],wind_speed_10m_max:[10,12,15,8,7,20,14]}};
const VPS={ "fold-cover":{viewport:{width:344,height:882},deviceScaleFactor:2.6,isMobile:true,hasTouch:true},
  "fold-inner":{viewport:{width:673,height:841},deviceScaleFactor:2.6,isMobile:true,hasTouch:true},
  "pc":{viewport:{width:1920,height:1080},deviceScaleFactor:1} };
const want=(process.env.VP||"fold-cover,fold-inner,pc").split(","), THR=+(process.env.THROTTLE||4);
const b=await chromium.launch({args:["--use-gl=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"]});
const out=[];
for(const vp of want){
  const ctx=await b.newContext(VPS[vp]); const pg=await ctx.newPage();
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1).*/, r=>{ const u=r.request().url();
    if(u.includes("three")) return r.fulfill({body:THREE,contentType:"text/javascript"});
    if(u.includes("api.open-meteo.com")) return r.fulfill({json:fc});
    if(u.includes("air-quality")) return r.fulfill({json:{current:{us_aqi:42,pm2_5:8}}});
    if(u.includes("weather.gov")) return r.fulfill({json:{features:[]}});
    if(u.includes("3dms")||u.includes("workers.dev")) return r.fulfill({body:"<h1>site</h1>",contentType:"text/html"});
    return r.abort(); });
  await pg.addInitScript(q=>{ localStorage.setItem("turd_users",JSON.stringify({admin:{pw:"admin",fresh:false,role:"admin"}})); if(q) localStorage.setItem("turd_quality",JSON.stringify(q)); }, process.env.QUALITY||null);
  const AB={ noblur:"*,*::before,*::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}",
    noscan:".scanlines{display:none!important}", noblend:".theme-halo,.visor-vignette,.scanlines{mix-blend-mode:normal!important}",
    nooverlay:".theme-halo,.visor-vignette,.visor-sheen,.scanlines,.arc,.helmet-bezel,.reticle{display:none!important}",
    noscene:"#scene{display:none!important}", noanim:"*,*::before,*::after{animation:none!important}",
    noshadow:"*,*::before,*::after{box-shadow:none!important;filter:none!important;text-shadow:none!important}", nopanel:"#stage{display:none!important}",
    opt:".scanlines{animation:none!important;mix-blend-mode:normal!important;opacity:.06!important}.theme-halo,.visor-vignette{mix-blend-mode:normal!important}",
    noarcfilter:".arc svg{filter:none!important}", nosheen:".visor-sheen{display:none!important}", nobezel:".helmet-bezel{display:none!important}" };
  const abl=(process.env.ABL||"").split(",").filter(Boolean);
  if(abl.length) await pg.addInitScript(css=>{ document.addEventListener("DOMContentLoaded",()=>{ const s=document.createElement("style"); s.textContent=css; document.head.appendChild(s); }); }, abl.map(a=>AB[a]).join("\n"));
  await pg.goto(`http://127.0.0.1:${srv.address().port}/`);
  await pg.fill("#p","admin"); await pg.click("#loginForm button"); await pg.waitForSelector(".navbtn",{timeout:20000}); await pg.waitForTimeout(1500);
  const cdp=await ctx.newCDPSession(pg); await cdp.send("Performance.enable"); await cdp.send("Emulation.setCPUThrottlingRate",{rate:THR});
  const ids=process.env.SECS?process.env.SECS.split(","):await pg.$$eval(".navbtn",x=>x.map(e=>e.dataset.go));
  for(const id of ids){
    await pg.click(`.navbtn[data-go="${id}"]`); await pg.waitForTimeout(2500);
    const m0=Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m=>[m.name,m.value]));
    const fr=await pg.evaluate(()=>new Promise(res=>{ const ts=[]; const t0=performance.now(); (function f(t){ ts.push(t); if(t-t0<3000) requestAnimationFrame(f); else res(ts); })(t0); }));
    const m1=Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map(m=>[m.name,m.value]));
    const iv=fr.slice(1).map((t,i)=>t-fr[i]).sort((a,b)=>a-b), dur=(fr.at(-1)-fr[0])/1000;
    const per=k=>((m1[k]-m0[k])/ (m1.Timestamp-m0.Timestamp)*100).toFixed(0)+"%";
    const row={abl:process.env.ABL||"-",vp,id,fps:(iv.length/dur).toFixed(1),p50:iv[iv.length>>1].toFixed(1),p95:iv[Math.floor(iv.length*.95)].toFixed(1),task:per("TaskDuration"),script:per("ScriptDuration"),style:per("RecalcStyleDuration"),layout:per("LayoutDuration"),nodes:m1.Nodes,heapMB:(m1.JSHeapUsedSize/1e6).toFixed(1)};
    out.push(row); console.log(JSON.stringify(row));
  }
  await ctx.close();
}
fs.writeFileSync(`../perf-${tag}.json`,JSON.stringify(out,null,1));
await b.close(); srv.close();
