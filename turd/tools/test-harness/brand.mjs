import { chromium } from "playwright"; import fs from "fs"; import path from "path"; import http from "http";
const root=process.argv[2]; const THREE=fs.readFileSync("../deps/node_modules/three/build/three.module.js");
const srv=http.createServer((q,r)=>{ let p=q.url.split("?")[0]; if(p.endsWith("/")) p+="index.html"; fs.readFile(path.join(root,p),(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{"content-type":p.endsWith(".js")?"text/javascript":p.endsWith(".css")?"text/css":"text/html"}); r.end(d);});});
await new Promise(r=>srv.listen(0,r));
const b=await chromium.launch({args:["--use-gl=swiftshader"]});
for(const vp of [{width:1600,height:900},{width:344,height:882}]){ const pg=await b.newPage({viewport:vp});
await pg.route(/^https?:\/\/(?!127).*/,r=>r.request().url().includes("three")?r.fulfill({body:THREE,contentType:"text/javascript"}):r.abort());
await pg.addInitScript(()=>localStorage.setItem("turd_users",JSON.stringify({admin:{pw:"admin",fresh:false,role:"admin"}})));
await pg.goto(`http://127.0.0.1:${srv.address().port}/`); await pg.fill("#p","admin"); await pg.click("#loginForm button"); await pg.waitForSelector(".navbtn.active"); await pg.waitForTimeout(500);
const r=await pg.$eval("#brand",e=>{const b=e.getBoundingClientRect(); return [b.x+b.width/2,b.y+b.height/2];});
const top=await pg.evaluate(([x,y])=>document.elementFromPoint(x,y)?.closest("#brand")?"brand":document.elementFromPoint(x,y)?.tagName,r);
for(let i=0;i<5;i++) await pg.mouse.click(r[0],r[1]);
await pg.waitForTimeout(300); console.log(vp.width,"element at wordmark:",top,"| 5 taps open log:",await pg.$eval("#modal",m=>m.classList.contains("show"))); }
await b.close(); srv.close();
