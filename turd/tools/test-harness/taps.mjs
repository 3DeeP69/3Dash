import { chromium } from "playwright"; import fs from "fs"; import path from "path"; import http from "http";
const root=process.argv[2]; const THREE=fs.readFileSync("../deps/node_modules/three/build/three.module.js");
const srv=http.createServer((q,r)=>{ let p=q.url.split("?")[0]; if(p.endsWith("/")) p+="index.html"; fs.readFile(path.join(root,p),(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{"content-type":p.endsWith(".js")?"text/javascript":p.endsWith(".css")?"text/css":"text/html"}); r.end(d);});});
await new Promise(r=>srv.listen(0,r));
const b=await chromium.launch({args:["--use-gl=swiftshader"]}); const ctx=await b.newContext({viewport:{width:344,height:882},isMobile:true,hasTouch:true}); const pg=await ctx.newPage();
await pg.route(/^https?:\/\/(?!127).*/,r=>r.request().url().includes("three")?r.fulfill({body:THREE,contentType:"text/javascript"}):r.abort());
await pg.addInitScript(()=>localStorage.setItem("turd_users",JSON.stringify({admin:{pw:"admin",fresh:false,role:"admin"}})));
await pg.goto(`http://127.0.0.1:${srv.address().port}/`); await pg.fill("#p","admin"); await pg.click("#loginForm button"); await pg.waitForSelector(".navbtn");
const ids=await pg.$$eval(".navbtn",x=>x.map(e=>e.dataset.go));
for(const id of ids){ await pg.click(`.navbtn[data-go="${id}"]`); await pg.waitForTimeout(1200);
  const small=await pg.evaluate(id=>{ const p=document.querySelector("#sec-"+id); const out=[];
    p.querySelectorAll("button,a,[role=button],input[type=checkbox],summary,select").forEach(e=>{ const r=e.getBoundingClientRect(); if(!r.width||getComputedStyle(e).visibility==="hidden") return;
      if(r.height<32||r.width<32) out.push(`${e.tagName.toLowerCase()}.${[...e.classList].slice(0,2).join(".")} "${(e.textContent||e.title||"").trim().slice(0,18)}" ${Math.round(r.width)}x${Math.round(r.height)}`); });
    const fs=[]; p.querySelectorAll("*").forEach(e=>{ if(e.children.length||!e.textContent.trim()) return; const z=parseFloat(getComputedStyle(e).fontSize); if(z<10) fs.push(z); });
    return {n:out.length, list:[...new Set(out)].slice(0,8), tinyText:fs.length, minFont:Math.min(...fs,99)}; },id);
  console.log(id, JSON.stringify(small)); }
await b.close(); srv.close();
