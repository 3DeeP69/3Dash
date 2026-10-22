// Fake Anthropic Messages API (SSE) for testing fallback + resume.
// Control: POST /__ctl {"claude-opus-5-5":"drop@40"|"500"|"429"|"ok"|"hang"|"auth", ...}
// GET /__log -> recorded request bodies
import http from "http";
let CTL = {}; const LOG = [];
const W = (res, type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
function lastUserText(msgs) {
  for (let i = msgs.length - 1; i >= 0; i--) { const m = msgs[i]; if (m.role !== "user") continue;
    const c = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    const t = c.filter(b => b.type === "text" && !b.text.startsWith("<turd_context>")).map(b => b.text).join(" ");
    if (t) return { t, toolResult: c.some(b => b.type === "tool_result") }; if (c.some(b => b.type === "tool_result")) return { t: "", toolResult: true }; }
  return { t: "" };
}
http.createServer(async (req, res) => {
  let body = ""; for await (const c of req) body += c;
  if (req.url === "/__ctl") { CTL = JSON.parse(body || "{}"); LOG.length = 0; res.end("ok"); return; }
  if (req.url === "/__log") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(LOG)); return; }
  if (req.url.startsWith("/v1/models/")) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ id: req.url.split("/").pop(), type: "model" })); return; }
  if (req.url === "/v1/chat/completions") {
    const b = JSON.parse(body); LOG.push({ model: b.model, openai: true, body: b });
    if (CTL.alt === "500") { res.writeHead(500); res.end("{}"); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    const sys = b.messages.filter(m => m.role === "system"); const resumed = sys.some(m => /interrupted/.test(m.content));
    for (const w of (resumed ? "[alt resumed] and that's the rest." : "Backup provider here, all good.").match(/\S+\s*/g)) { res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`); await sleep(20); }
    res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`); res.end(); return;
  }
  if (!req.url.startsWith("/v1/messages")) { res.writeHead(404); res.end(); return; }
  const b = JSON.parse(body); LOG.push({ model: b.model, beta: req.headers["anthropic-beta"], body: b });
  const mode = CTL[b.model] || "ok";
  if (mode === "auth") { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } })); return; }
  if (/^\d{3}$/.test(mode)) { res.writeHead(+mode, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: mode === "429" ? "rate_limit_error" : "api_error", message: "mock " + mode } })); return; }
  if (mode === "hang") { await sleep(120000); res.end(); return; }
  const sysNote = b.messages.filter(m => m.role === "system").pop();
  const { t: q, toolResult } = lastUserText(b.messages);
  let text, tool = null;
  const full = "The sky over Southaven is clear tonight, sixty-one degrees and falling slowly toward the mid fifties. Rain moves in after midnight, so if you're heading out late, take the umbrella. You also have two open tasks: order SD cards, and link the Oxford feeds.";
  if (toolResult) text = "Done. I'll nudge you in 20 minutes.";
  else if (/remind/i.test(q)) { text = "On it."; tool = { name: "set_reminder", input: { text: "stretch", in_minutes: 20 } }; }
  else if (sysNote && /interrupted/.test(JSON.stringify(sysNote))) {
    const shown = JSON.stringify(sysNote).match(/<shown>\\n([\s\S]*?)\\n<\/shown>/)[1].replace(/\\"/g, '"');
    // echo a little overlap on purpose to exercise the seam trimmer
    const k = full.indexOf(shown.slice(-20)); text = k >= 0 ? full.slice(Math.max(0, k + 20 - 14)) : " (resumed) " + full;
  } else text = full;
  res.writeHead(200, { "content-type": "text/event-stream" });
  const msg = { id: "msg_" + Date.now(), type: "message", role: "assistant", model: b.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 0, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 } };
  W(res, "message_start", { message: msg });
  W(res, "content_block_start", { index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
  for (const p of ["Checking the snapshot ", "for weather and tasks…"]) { W(res, "content_block_delta", { index: 0, delta: { type: "thinking_delta", thinking: p } }); await sleep(120); }
  W(res, "content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "sig" } });
  W(res, "content_block_stop", { index: 0 });
  W(res, "content_block_start", { index: 1, content_block: { type: "text", text: "" } });
  const drop = mode.startsWith("drop@") ? +mode.slice(5) : Infinity; let sent = 0;
  for (const w of text.match(/\S+\s*/g)) {
    if (sent >= drop) { res.socket.destroy(); return; }
    W(res, "content_block_delta", { index: 1, delta: { type: "text_delta", text: w } }); sent += w.length; await sleep(25);
  }
  W(res, "content_block_stop", { index: 1 });
  let stop = "end_turn";
  if (tool) { W(res, "content_block_start", { index: 2, content_block: { type: "tool_use", id: "toolu_" + Date.now(), name: tool.name, input: {} } });
    W(res, "content_block_delta", { index: 2, delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } }); W(res, "content_block_stop", { index: 2 }); stop = "tool_use"; }
  W(res, "message_delta", { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 80 } });
  W(res, "message_stop", {}); res.end();
}).listen(+process.env.MOCK_PORT || 9911, () => console.log("mock anthropic on", process.env.MOCK_PORT || 9911));
