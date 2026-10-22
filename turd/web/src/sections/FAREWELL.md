# "Before you go" recap: integration notes (from the Weather, projects and logbook thread)

File: `web/src/sections/farewell.js`. It is self-contained: it builds its own full-screen overlay and injects its own CSS.

```js
const go = await (await import("./sections/farewell.js")).beforeYouGo(ctx);   // Promise<boolean>
if (go) { SESSION = null; location.reload(); }
```

## How it resolves

- **`true` (Log out):** the Log out button, Enter, ✕, or gamepad A. A CRT power-off animation (about 0.6 s) plays before it resolves.
- **`false` (Stay signed in):** the Stay button, Esc, ○, gamepad B, or a click outside the panel.

## What it shows

- **Today:** entries logged, tasks done, the streak, and today's calendar events. Finished events are struck through.
- **Still open:** tasks that can be ticked off right there. Ticking one sets `doneAt`.
- **Tomorrow:** forecast hi/lo, rain chance and alerts, the first calendar event, and sunrise.
- **PC line (admin only):** shown when `turd_pc_last` is fresh, telling the operator the PC is still running.
- **"One last note" box:** saves to the Logbook, tagged `#signoff`.

## Behaviour notes

- While it is open, it captures `[ ]` and PageUp/PageDown so sections don't flip behind it.
- It sets `window.TURD_OVERLAY = true` while open. The shell's gamepad `step()` should skip when that flag is set.
- It uses `ctx.session` (user, role), `ctx.toast` and `ctx.http`. All of them are optional.
- If the weather cache is more than 3 h old, it refreshes it with a 3.5 s timeout. Everything else is local.
- Calling it again while it is already open returns the same promise.
