import { chromium } from "playwright"; import fs from "fs"; import path from "path"; import http from "http";
const root=process.argv[2]; const THREE=fs.readFileSync("../deps/node_modules/three/build/three.module.js");
const srv=http.createServer((q,r)=>{ let p=q.url.split("?")[0]; if(p.endsWith("/")) p+="index.html"; fs.readFile(path.join(root,p),(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{"content-type":p.endsWith(".js")?"text/javascript":p.endsWith(".css")?"text/css":"text/html"}); r.end(d);});});
await new Promise(r=>srv.listen(0,r));
const b=await chromium.launch({args:["--use-gl=swiftshader"]}); const pg=await b.newPage(); const errs=[];
pg.on("pageerror",e=>errs.push(e.message));
await pg.route(/^https?:\/\/(?!127).*/,r=>r.request().url().includes("three")?r.fulfill({body:THREE,contentType:"text/javascript"}):r.abort());
await pg.addInitScript(()=>{ window.__mounts=[]; });
await pg.goto(`http://127.0.0.1:${srv.address().port}/`);
// fresh admin -> forced passkey change
await pg.fill("#p","admin"); await pg.click("#loginForm button"); await pg.waitForSelector("#npSkip"); await pg.click("#npSkip");
await pg.waitForSelector(".navbtn.active",{timeout:15000}); await pg.waitForTimeout(500);
console.log("active:",await pg.$eval(".navbtn.active",e=>e.dataset.go+" aria="+e.getAttribute("aria-current")+" title="+e.title));
console.log("shown sections:",await pg.$$eval(".section.show",s=>s.map(x=>x.dataset.sec)));
// audit (admin only) works after skip -> role kept
await pg.keyboard.type("audit"); await pg.waitForTimeout(200);
console.log("audit modal open:",await pg.$eval("#modal",m=>m.classList.contains("show")));
await pg.keyboard.press("Escape");
for(const q of ["MED","LOW","HIGH","MED"]){ await pg.click("#perf"); await pg.waitForTimeout(300);
  console.log("quality",await pg.$eval("#perf-val",e=>e.textContent),"q-low:",await pg.evaluate(()=>document.body.classList.contains("q-low"))); }
console.log("errors:",errs);
await b.close(); srv.close();
