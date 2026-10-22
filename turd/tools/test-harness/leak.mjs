import { chromium } from "playwright"; import fs from "fs"; import path from "path"; import http from "http";
const root=process.argv[2]; const THREE=fs.readFileSync("../deps/node_modules/three/build/three.module.js");
const srv=http.createServer((q,r)=>{ let p=q.url.split("?")[0]; if(p.endsWith("/")) p+="index.html"; fs.readFile(path.join(root,p),(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{"content-type":p.endsWith(".js")?"text/javascript":p.endsWith(".css")?"text/css":"text/html"}); r.end(d);});});
await new Promise(r=>srv.listen(0,r));
const b=await chromium.launch({args:["--use-gl=swiftshader"]}); const ctx=await b.newContext(); const pg=await ctx.newPage();
await pg.route(/^https?:\/\/(?!127).*/,r=>r.request().url().includes("three")?r.fulfill({body:THREE,contentType:"text/javascript"}):r.abort());
await pg.addInitScript(()=>localStorage.setItem("turd_users",JSON.stringify({admin:{pw:"admin",fresh:false,role:"admin"}})));
await pg.goto(`http://127.0.0.1:${srv.address().port}/`); await pg.fill("#p","admin"); await pg.click("#loginForm button"); await pg.waitForSelector(".navbtn");
const cdp=await ctx.newCDPSession(pg);
const ids=await pg.$$eval(".navbtn",x=>x.map(e=>e.dataset.go));
async function snap(){ const {result}=await cdp.send("Runtime.evaluate",{expression:"window"}); const {listeners}=await cdp.send("DOMDebugger.getEventListeners",{objectId:result.objectId});
  const {result:d}=await cdp.send("Runtime.evaluate",{expression:"document"}); const {listeners:dl}=await cdp.send("DOMDebugger.getEventListeners",{objectId:d.objectId});
  const c={}; listeners.forEach(l=>c["w:"+l.type]=(c["w:"+l.type]||0)+1); dl.forEach(l=>c["d:"+l.type]=(c["d:"+l.type]||0)+1);
  const n=await pg.evaluate(()=>document.querySelectorAll("*").length+" nodes, fades="+document.querySelectorAll(".t-fade").length+", iframes="+document.querySelectorAll("iframe").length); return [c,n]; }
for(const r of [1,2,3]){ for(const id of ids){ await pg.click(`.navbtn[data-go="${id}"]`); await pg.waitForTimeout(350); } await pg.click(`.navbtn[data-go="home"]`); await pg.waitForTimeout(500); console.log("round",r,JSON.stringify(await snap())); }
await b.close(); srv.close();
