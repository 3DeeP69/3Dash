// Runs the Rust self test (src-tauri/src/selftest.rs) in a real debug build of the app:
// local server with Range support, a connection that drops half way, a slow stream to
// cancel, and a zip. usage: node tests/native-selftest.mjs path/to/turd-binary
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const bin = process.argv[2];
const big = Buffer.alloc(20 * 1024 * 1024);
for (let i = 0; i < big.length; i += 32) crypto.createHash("sha256").update(String(i)).digest().copy(big, i);
const zipDir = fs.mkdtempSync(path.join(os.tmpdir(), "z"));
execFileSync("python3", ["-c", `import zipfile;z=zipfile.ZipFile('${zipDir}/pack.zip','w');z.writestr('inner/hello.txt','hello from zip');z.close()`]);
const zip = fs.readFileSync(path.join(zipDir, "pack.zip"));
const stats = { ranges: 0, flakyFirst: true };

function sendRange(q, r, buf, opts = {}) {
  const m = /bytes=(\d+)-/.exec(q.headers.range || "");
  const start = m ? +m[1] : 0;
  if (m) stats.ranges++;
  if (start >= buf.length) { r.writeHead(416, { "content-range": `bytes */${buf.length}` }); return r.end(); }
  r.writeHead(m ? 206 : 200, { "content-length": buf.length - start, "accept-ranges": "bytes", ...(m ? { "content-range": `bytes ${start}-${buf.length - 1}/${buf.length}` } : {}) });
  const body = buf.subarray(start);
  if (opts.dropAt) { r.write(body.subarray(0, opts.dropAt)); setTimeout(() => r.socket.destroy(), 50); return; }
  if (opts.slow) {
    let o = 0; const t = setInterval(() => { if (r.destroyed || o >= body.length) { clearInterval(t); return r.end(); } r.write(body.subarray(o, o + 65536)); o += 65536; }, 60);
    r.on("close", () => clearInterval(t)); return;
  }
  r.end(body);
}
const srv = http.createServer((q, r) => {
  const u = q.url;
  if (u === "/hello") return r.end("hello");
  if (u === "/stats") { r.setHeader("content-type", "application/json"); return r.end(JSON.stringify(stats)); }
  if (u === "/big.bin") return sendRange(q, r, big);
  if (u === "/slow.bin") return sendRange(q, r, big, { slow: true });
  if (u === "/flaky.bin") {
    if (!q.headers.range && stats.flakyFirst) { stats.flakyFirst = false; return sendRange(q, r, big, { dropAt: 7 * 1024 * 1024 }); }
    return sendRange(q, r, big);
  }
  if (u === "/pack.zip") return sendRange(q, r, zip);
  r.writeHead(404); r.end();
});
await new Promise(r => srv.listen(0, "127.0.0.1", r));
const p = spawn("xvfb-run", ["-a", bin], { env: { ...process.env, TURD_SELFTEST: `http://127.0.0.1:${srv.address().port}` }, stdio: ["ignore", "pipe", "pipe"] });
let outp = "";
p.stdout.on("data", d => { outp += d; process.stdout.write(d.toString().split("\n").filter(l => l.startsWith("SELFTEST")).map(l => l + "\n").join("")); });
p.stderr.on("data", d => { if (process.env.VERBOSE) process.stderr.write(d); });
const code = await new Promise(r => { p.on("exit", r); setTimeout(() => { p.kill(); r(124); }, 180000); });
srv.close();
process.exit(/SELFTEST DONE PASS/.test(outp) ? 0 : (code || 1));
