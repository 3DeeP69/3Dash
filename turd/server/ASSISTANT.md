# T.U.R.D. Assistant: backend

The Assistant tab talks to `server/assistant.js`, which plugs into the uplink server (`server.js` already has the hook). Keys stay on the server and never reach a phone or browser.

## Turn it on (free)
The assistant runs free on your own PC with [Ollama](https://ollama.com). No account, no key, nothing leaves the machine.
```bash
# once, on the PC that runs the server
ollama pull llama3.2      # 2 GB; use llama3.2:1b on a PC with under 8 GB RAM
# then, as usual
cd server && node server.js
```
The server finds Ollama at `http://127.0.0.1:11434` on its own, loads the model into memory ahead of the first question, and keeps it warm for 30 minutes. The startup line says `free mode: local model via Ollama`. If you pull more than one model, pick it in **Assistant → ⚙ → Local brain**.

When the PC or Ollama is off, the app falls back to its on-device brain (briefings, weather, tasks, calendar, logging, reminders, navigation), so the tab always answers.

### Optional: Claude (paid)
Only if you ever want it: run `npm install` in `server/` (pulls `@anthropic-ai/sdk`), then **Assistant → ⚙ → Claude → API key**. The key is checked with Anthropic and stored in `data/assistant/config.json` (mode 0600); `ANTHROPIC_API_KEY` in the environment works too. Without a key, Claude isn't part of the chain at all and the SDK isn't needed.

Only the admin sees the settings. By default only the admin can use the assistant; flip **Other operators can use it** to share it.

## The fallback chain
Each answer goes to the first healthy tier (in free mode that's just 5 then 6):

1. **Claude Opus 5.5** (primary; switchable to Sonnet or Haiku in settings)
2. **Claude Sonnet 5.5**
3. **Claude Haiku 5.5**
4. **Backup provider** (optional): any OpenAI-compatible API, e.g. OpenAI, Groq, OpenRouter, Gemini's OpenAI endpoint, LM Studio
5. **Local model**: Ollama on the server's machine, auto-detected at `http://127.0.0.1:11434`. Streams, sees the dashboard snapshot, and can do the same app actions (tools are only offered when you ask it to do something, since small models over-use them)
6. **On-device** (in the app itself): the browser's built-in model when the device has one, otherwise a built-in engine that handles briefings, weather, tasks, calendar, logging, reminders and navigation

How it behaves when something breaks:
- **Dies mid-answer** (dropped connection, overload, stall): the next tier gets the same conversation plus a note with the words already on screen, and carries on from that exact point. The app keeps typing. Any repeated words at the join are trimmed.
- **Fails before answering** (529 overloaded, 429 rate limit, 5xx, no first token in 25s): the next tier answers. A failed tier sits out for 90 seconds.
- **Phone loses signal**: the server keeps generating. The app re-attaches to the same answer for up to ~2 minutes and picks up where it left off.
- **Server unreachable**: the on-device brain answers. Those turns are sent to the server conversation when it's back, so the history stays whole.
- **Safety decline on Opus/Sonnet**: Anthropic's server-side `fallbacks: "default"` retries it on the recommended model inside the same request.

## What it can see and do
Every message carries a compact snapshot of the dashboard: local time, weather and alerts, open tasks, pinned notes, recent log entries, upcoming calendar events, project status and reminders. It's only re-sent when something changed, which keeps the prompt cache warm.

It can open a section, add a log entry or task, tick off a task, add a calendar event, set a reminder (these fire anywhere in the app, with a notification), and search the web (Opus/Sonnet/Haiku, $0.01 per search, can be turned off).

## Cost control
- **Depth**: Quick (default, `effort: low`), Balanced (`medium`), Deep (`high`).
- **Prompt caching** is on, so long conversations re-bill mostly at the cached rate.
- **Daily budget** (default $5): past it, Claude pauses until midnight and the other tiers keep going. The settings sheet shows today's spend.

Prices used for the estimate ($ per million tokens, input/output): Opus 5.5 4/20, Sonnet 5.5 2/10, Haiku 5.5 0.10/0.50.

## API (all need a login token)
| route | what |
|---|---|
| `GET /api/assistant/status` | tiers, readiness, today's spend (key shown masked, admin only) |
| `POST /api/assistant/chat` | `{conv?, text, context?, effort?}` or `{conv, toolResults}`; streams SSE: `turn`, `tier`, `think`, `text`, `search`, `action`, `notice`, `fail`, `done` |
| `GET /api/assistant/turn?id=&from=` | re-attach to a running answer from event N |
| `POST /api/assistant/stop` | `{turn}` |
| `GET /api/assistant/convs`, `GET /api/assistant/conv?id=`, `POST /api/assistant/delete` | conversation history (stored per user in `data/assistant/conv/`) |
| `POST /api/assistant/config` | admin only: key, primary model, depth, web search, budget, sharing, backup provider, local model |

The server keeps each conversation's full transcript (including the model's thinking blocks) and only ever appends to it, which is what Claude's newer models require for multi-turn thinking and what keeps caching effective.
