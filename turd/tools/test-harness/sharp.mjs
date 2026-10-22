// sharpness metric: mean |Laplacian| of luminance over a clip of the shown panel (higher = crisper)
import { chromium } from "playwright"; import fs from "fs"; import path from "path"; import http from "http";
const [,,root,variantsJson,secs="home,weather,logbook",dsfs="1,1.25,1.5",outdir=""]=process.argv;
const VARS=JSON.parse(fs.readFileSync(variantsJson,"utf8")); const THREE=fs.readFileSync("../deps/node_modules/three/build/three.module.js");
const srv=http.createServer((q,r)=>{ let p=q.url.split("?")[0]; if(p.endsWith("/")) p+="index.html"; fs.readFile(path.join(root,p),(e,d)=>{ if(e){r.writeHead(404);r.end();return;} r.writeHead(200,{"content-type":p.endsWith(".js")?"text/javascript":p.endsWith(".css")?"text/css":"text/html"}); r.end(d);});});
await new Promise(r=>srv.listen(0,r));
const b=await chromium.launch({args:["--use-gl=swiftshader"]});
const res={};
for(const dsf of dsfs.split(",")) for(const [vn,css] of Object.entries(VARS)){
  const pg=await b.newPage({viewport:{width:1536,height:864},deviceScaleFactor:+dsf});
  await pg.route(/^https?:\/\/(?!127).*/,r=>r.request().url().includes("three")?r.fulfill({body:THREE,contentType:"text/javascript"}):r.abort());
  await pg.addInitScript(c=>{ localStorage.setItem("turd_users",JSON.stringify({admin:{pw:"admin",fresh:false,role:"admin"}})); localStorage.setItem("turd_quality",JSON.stringify("HIGH"));
    document.addEventListener("DOMContentLoaded",()=>{ const s=document.createElement("style"); s.textContent=c+"\n#stage,canvas{visibility:hidden!important}"; document.head.appendChild(s); }); }, css);
  await pg.goto(`http://127.0.0.1:${srv.address().port}/`);
  await pg.fill("#p","admin"); await pg.click("#loginForm button"); await pg.waitForSelector(".navbtn.active");
  for(const sec of secs.split(",")){
    await pg.click(`.navbtn[data-go="${sec}"]`); await pg.waitForTimeout(1600); await pg.mouse.move(2,860);
    const r=await pg.$eval(`#sec-${sec}`,s=>{const e=s.querySelector(".panel")||s;const b=e.getBoundingClientRect(); return {x:Math.max(0,b.x),y:Math.max(0,b.y),width:Math.min(b.width,1536-b.x),height:Math.min(b.height,864-b.y)};});
    const buf=await pg.screenshot({clip:r}); if(outdir) fs.writeFileSync(`${outdir}/${sec}-${vn}-${dsf}.png`,buf);
    const score=await pg.evaluate(async d=>{ const im=new Image(); im.src="data:image/png;base64,"+d; await im.decode(); const c=new OffscreenCanvas(im.width,im.height), x=c.getContext("2d"); x.drawImage(im,0,0);
      const {data,width:w,height:h}=x.getImageData(0,0,im.width,im.height); const L=new Float32Array(w*h); for(let i=0;i<w*h;i++) L[i]=.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2];
      let s=0,n=0; for(let y=1;y<h-1;y++) for(let X=1;X<w-1;X++){ const i=y*w+X; const v=Math.abs(4*L[i]-L[i-1]-L[i+1]-L[i-w]-L[i+w]); if(v>8){s+=v;n++;} } return +(s/Math.max(1,n)).toFixed(2); }, buf.toString("base64"));
    (res[`${sec}@${dsf}`] ||= {})[vn]=score;
  }
  await pg.close();
}
console.table(res); await b.close(); srv.close();
