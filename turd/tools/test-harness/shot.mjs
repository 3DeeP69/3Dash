// usage: node shot.mjs <webRoot> <outDir> [sections...]
import { chromium } from "playwright";
import fs from "fs"; import path from "path"; import http from "http";
const [,, root, out, ...want] = process.argv;
const SECS = want.length ? want : ["home","weather","logbook","opsec","radar","projects"];
fs.mkdirSync(out,{recursive:true});
const THREE = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname),"../deps/node_modules/three/build/three.module.js"));
const mime={".html":"text/html",".js":"text/javascript",".css":"text/css",".png":"image/png",".svg":"image/svg+xml",".json":"application/json"};
const srv=http.createServer((q,r)=>{ let p=decodeURIComponent(q.url.split("?")[0]); if(p.endsWith("/")) p+="index.html";
  const f=path.join(root,p); fs.readFile(f,(e,d)=>{ if(e){ r.writeHead(404); r.end(); return; } r.writeHead(200,{"content-type":mime[path.extname(f)]||"application/octet-stream"}); r.end(d); }); });
await new Promise(r=>srv.listen(0,r)); const port=srv.address().port;
const now=Math.floor(Date.now()/1000/3600)*3600;
const hrs=Array.from({length:25},(_,i)=>now+i*3600);
const days=Array.from({length:7},(_,i)=>now-(now%86400)+i*86400);
const fc={current:{temperature_2m:61,apparent_temperature:59,relative_humidity_2m:72,dew_point_2m:52,weather_code:2,is_day:0,cloud_cover:40,precipitation:0,pressure_msl:1014,wind_speed_10m:8,wind_direction_10m:200,wind_gusts_10m:15,visibility:16000,uv_index:0},
 hourly:{time:hrs,temperature_2m:hrs.map((_,i)=>58+10*Math.sin(i/4)),precipitation_probability:hrs.map((_,i)=>i>6&&i<10?70:10),weather_code:hrs.map((_,i)=>i>6&&i<10?61:2),is_day:hrs.map((_,i)=>i>3&&i<15?1:0)},
 daily:{time:days,weather_code:[2,3,61,0,1,95,71],temperature_2m_max:[68,64,60,70,72,66,50],temperature_2m_min:[52,49,47,50,55,48,33],sunrise:days.map(d=>d+12*3600),sunset:days.map(d=>d+23*3600),uv_index_max:[5,4,2,6,7,3,2],precipitation_probability_max:[20,30,85,0,10,60,40],precipitation_sum:[0,0,.5,0,0,.2,.1],wind_speed_10m_max:[10,12,15,8,7,20,14]}};
const site=`<html><head><title>3D MS</title></head><body style="background:#123;color:#fff;font:40px sans-serif"><h1>3D MS</h1><h2>Camera wall</h2></body></html>`;
const b=await chromium.launch({args:["--use-gl=swiftshader","--enable-webgl","--ignore-gpu-blocklist"]});
const errors=[];
async function run(label, vp, mobile){
  const ctx=await b.newContext({viewport:vp,deviceScaleFactor:1,isMobile:!!mobile,hasTouch:!!mobile});
  const pg=await ctx.newPage();
  pg.on("response",r=>{ if(r.status()>=400) errors.push(`[${label}] HTTP ${r.status()} ${r.url()}`); });
  pg.on("requestfailed",r=>{ const u=r.url(); if(!/fonts\.g/.test(u)) errors.push(`[${label}] FAILED ${u.slice(0,120)}`); });
  pg.on("pageerror",e=>errors.push(`[${label}] pageerror ${e.message}`));
  pg.on("console",m=>{ if(m.type()==="error"||m.type()==="warning") errors.push(`[${label}] console.${m.type()} ${m.text()}`); });
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1|localhost).*/, async r=>{ const u=r.request().url();
    if(u.includes("three")) return r.fulfill({body:THREE,contentType:"text/javascript"});
    if(u.includes("api.open-meteo.com")) return r.fulfill({json:fc});
    if(u.includes("air-quality")) return r.fulfill({json:{current:{us_aqi:42,pm2_5:8}}});
    if(u.includes("weather.gov")) return r.fulfill({json:{features:[]}});
    if(u.includes("bigdatacloud")) return r.fulfill({json:{city:"Southaven",principalSubdivisionCode:"US-MS",countryCode:"US"}});
    if(u.includes("3dms")||u.includes("workers.dev")) return r.fulfill({body:site,contentType:"text/html"});
    return r.abort(); });
  await pg.addInitScript(()=>{ if(!localStorage.getItem("turd_users")) localStorage.setItem("turd_users",JSON.stringify({admin:{pw:"admin",fresh:false,role:"admin"}}));
    if(!localStorage.getItem("turd_log")){ const n=Date.now(); localStorage.setItem("turd_log",JSON.stringify([
      {id:"a",t:n-3e5,txt:"Order new SD cards for the dashcam",cat:"task",tags:[],pinned:false,done:false},
      {id:"b",t:n-6e5,txt:"Idea: night-mode auto switch for the camera wall",cat:"idea",tags:[],pinned:true,done:false},
      {id:"c",t:n-9e5,txt:"Checked TN relay latency, all green. #3dms https://3dms.netlify.app",cat:"note",tags:["3dms"],pinned:false,done:false},
      {id:"d",t:n-86400e3,txt:"Link the remaining Oxford camera feeds #3dms",cat:"task",tags:["3dms"],pinned:false,done:false}])); } });
  await pg.goto(`http://127.0.0.1:${port}/`);
  await pg.fill("#p","admin"); await pg.click("#loginForm button");
  await pg.waitForSelector(".navbtn",{timeout:15000}); await pg.waitForTimeout(800);
  const ids=want.length?SECS:await pg.$$eval(".navbtn",b=>b.map(x=>x.dataset.go));
  for(const s of ids){
    const btn=await pg.$(`.navbtn[data-go="${s}"]`); if(!btn){ errors.push(`[${label}] no nav for ${s}`); continue; }
    await btn.click(); await pg.waitForTimeout(1600);
    await pg.screenshot({path:path.join(out,`${label}-${s}.png`)});
    // overlap check: does the rail cover the visible panel?
    const ov=await pg.evaluate(id=>{ const r=document.querySelector("#rail .nav").getBoundingClientRect(); const p=document.querySelector("#sec-"+id).getBoundingClientRect();
      const st=document.querySelector("#status").getBoundingClientRect();
      return {railRight:Math.round(r.right),railTop:Math.round(r.top),railBottom:Math.round(r.bottom),panelLeft:Math.round(p.left),panelTop:Math.round(p.top),panelBottom:Math.round(p.bottom),panelRight:Math.round(p.right),vw:innerWidth,vh:innerHeight,
        hscroll:document.querySelector("#sec-"+id).scrollWidth>document.querySelector("#sec-"+id).clientWidth+1}; },s);
    console.log(label,s,JSON.stringify(ov));
  }
  await ctx.close();
}
const modes=(process.env.MODES||"desk,phone").split(",");
if(modes.includes("desk")) await run("desk",{width:1600,height:900});
if(modes.includes("laptop")) await run("laptop",{width:1280,height:720});
if(modes.includes("cover")) await run("cover",{width:344,height:882},true);
if(modes.includes("inner")) await run("inner",{width:673,height:841},true);
if(modes.includes("innerland")) await run("innerland",{width:841,height:673},true);
if(modes.includes("phone")) await run("phone",{width:412,height:900},true);
await b.close(); srv.close();
console.log("ERRORS:\n"+[...new Set(errors)].join("\n"));
