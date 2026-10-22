import { chromium } from "playwright";
const [svg, out, size] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +size, height: +size } });
const fs = await import("node:fs");
await p.setContent(`<html><body style="margin:0;background:transparent">${fs.readFileSync(svg,"utf8").replace('width="1024" height="1024"',`width="${size}" height="${size}"`)}</body></html>`);
await p.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: +size, height: +size } });
await b.close();
