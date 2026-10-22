// Builds turd-server(.exe): the chat + assistant server (turd/server) as ONE
// self-contained executable (Node single-executable application), so the Windows app
// can host it with no Node install. The Anthropic SDK is bundled in with esbuild.
//
// usage: node scripts/build-server-sea.mjs [win|linux] [path/to/turd/server]
//   → src-tauri/binaries/turd-server-<target-triple>[.exe]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const target = process.argv[2] || "win";
const src = path.resolve(process.argv[3] || process.env.TURD_SERVER || path.join(root, "..", "..", "server"));
const work = path.join(root, "build", "server-sea");
const NODE_VER = process.env.TURD_NODE_VERSION || process.versions.node;   // blob and runtime must match
const triple = { win: "x86_64-pc-windows-gnu", "win-msvc": "x86_64-pc-windows-msvc", linux: "x86_64-unknown-linux-gnu" }[target];
if (!triple) { console.error("target must be win, win-msvc or linux"); process.exit(1); }
const isWin = target.startsWith("win");
const run = (cmd, args, opt = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opt });

fs.rmSync(path.join(work, "app"), { recursive: true, force: true });
fs.mkdirSync(path.join(work, "app"), { recursive: true });
for (const f of fs.readdirSync(src)) {
  if (/\.(js|json)$/.test(f) && f !== "package-lock.json") fs.copyFileSync(path.join(src, f), path.join(work, "app", f));
}
// Windows npm is npm.cmd, which execFileSync won't find under the bare name "npm"
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
run(NPM, ["install", "--omit=dev", "--no-audit", "--no-fund", "--silent"], { cwd: path.join(work, "app") });

// one CommonJS file: server.js + assistant.js + @anthropic-ai/sdk
const esbuild = await import("esbuild");
await esbuild.build({
  entryPoints: [path.join(work, "app", "server.js")],
  bundle: true, platform: "node", target: "node22", format: "cjs",
  outfile: path.join(work, "bundle.js"),
  logLevel: "warning",
  banner: { js: "/* T.U.R.D. uplink server, bundled for the Windows app */" },
});

fs.writeFileSync(path.join(work, "sea-config.json"), JSON.stringify({
  main: path.join(work, "bundle.js"),
  output: path.join(work, "sea-prep.blob"),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,          // code cache is platform-specific; we build Windows from Linux
}));
run(process.execPath, ["--experimental-sea-config", path.join(work, "sea-config.json")]);

// the Node runtime for the target, same version as the blob
const cache = path.join(root, "vendor-cache", "node");
fs.mkdirSync(cache, { recursive: true });
let nodeBin;
if (isWin) {
  nodeBin = path.join(cache, `node-v${NODE_VER}-win-x64.exe`);
  if (!fs.existsSync(nodeBin)) {
    const url = `https://nodejs.org/dist/v${NODE_VER}/win-x64/node.exe`;
    console.log("fetching " + url);
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const sums = await (await fetch(`https://nodejs.org/dist/v${NODE_VER}/SHASUMS256.txt`)).text();
    const want = (sums.split("\n").find(l => l.endsWith(" win-x64/node.exe")) || "").split(/\s+/)[0];
    const got = (await import("node:crypto")).createHash("sha256").update(buf).digest("hex");
    if (!want || want !== got) { console.error(`node.exe checksum mismatch (${got} vs ${want})`); process.exit(1); }
    fs.writeFileSync(nodeBin, buf);
  }
} else {
  nodeBin = process.execPath;
}

const outDir = path.join(root, "src-tauri", "binaries");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `turd-server-${triple}${isWin ? ".exe" : ""}`);
fs.copyFileSync(nodeBin, out);
fs.chmodSync(out, 0o755);
if (isWin) {
  // node.exe's Authenticode signature no longer matches once the blob is injected; drop it
  try {
    const tmp = out + ".unsigned";
    run("osslsigncode", ["remove-signature", "-in", out, "-out", tmp], { stdio: "ignore" });
    fs.renameSync(tmp, out);
  } catch (e) { console.warn("osslsigncode not available; leaving the stale signature in place"); }
}
run(process.execPath, [path.join(root, "node_modules", "postject", "dist", "cli.js"), out, "NODE_SEA_BLOB", path.join(work, "sea-prep.blob"),
  "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2", ...(isWin ? [] : [])]);
console.log("built " + out + " (" + (fs.statSync(out).size / 1048576).toFixed(1) + " MB)");
