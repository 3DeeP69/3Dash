// Mock Ollama: /api/tags, /api/generate (warm), /api/chat streaming NDJSON with tool calls.
import http from "http";
let mode = process.env.MODE || "ok"; const log = [];
http.createServer(async (req, res) => {
  let b = ""; for await (const c of req) b += c; const j = b ? JSON.parse(b) : {};
  if (req.url === "/__ctl") { mode = j.mode; res.end("ok"); return; }
  if (req.url === "/__log") { res.end(JSON.stringify(log)); return; }
  log.push({ url: req.url, tools: !!j.tools, msgs: j.messages?.map(m => ({ role: m.role, c: (m.content || "").slice(0, 80), tc: !!m.tool_calls, tn: m.tool_name })) , model: j.model, keep: j.keep_alive });
  if (req.url === "/api/tags") { res.end(JSON.stringify({ models: [{ name: "llama3.2:3b" }, { name: "nomic-embed-text:latest" }] })); return; }
  if (req.url === "/api/generate") { res.end(JSON.stringify({ done: true })); return; }
  if (req.url === "/api/chat") {
    if (mode === "notools" && j.tools) { res.writeHead(400); res.end(JSON.stringify({ error: "llama3.2:3b does not support tools" })); return; }
    res.writeHead(200, { "content-type": "application/x-ndjson" });
    const send = o => res.write(JSON.stringify(o) + "\n"); const sleep = ms => new Promise(r => setTimeout(r, ms));
    const last = j.messages[j.messages.length - 1];
    if (last.role === "tool") { for (const w of "Done, reminder set.".split(/(?= )/)) { send({ message: { role: "assistant", content: w }, done: false }); await sleep(20); } send({ done: true }); res.end(); return; }
    if (j.tools && /remind/i.test(last.content)) { send({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "set_reminder", arguments: { text: "stretch", in_minutes: 20 } } }] }, done: false }); send({ done: true, done_reason: "stop" }); res.end(); return; }
    const words = ("Local here. You have three open tasks and rain is likely tonight around 9, so grab an umbrella if you head out. " + (mode === "drop" ? "" : "Nothing else urgent.")).split(/(?= )/);
    for (const w of words) { send({ message: { role: "assistant", content: w }, done: false }); await sleep(15); }
    if (mode === "drop") { res.destroy(); return; }
    send({ done: true }); res.end(); return;
  }
  res.writeHead(404); res.end();
}).listen(11434, "127.0.0.1", () => console.log("ollama mock :11434"));
