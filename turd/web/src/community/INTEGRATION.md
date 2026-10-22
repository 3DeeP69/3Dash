# Community calendar — integration notes

Files (owned by the Community calendar thread): `calendar.js`, `page.js`, `community.css` (auto-injected by calendar.js).

## Mounting on the Chat page

**A) Easiest** — let page.js do the split layout:

```js
import { mountCommunity } from "../community/page.js";
mount(panel, ctx){ this._off = mountCommunity(panel, ctx, { title:"Community", mountChat: el => renderChat(el, ctx) }); }
unmount(){ this._off && this._off(); }
```

Renders the header, a `1fr | ~400px` split (calendar | chat), and a Calendar / Chat switch below 1100px. `mountChat(el)` may return a cleanup fn.

**B) Own layout** — `mountCalendar(el, ctx, { transport })` returns cleanup. `el` needs a real height (calendar fills 100%). `ctx` uses `session {user, role}`, `toast`, `show`.

Other exports: `upcoming(n)` (sync, cached), `summary()` (Home tile shape), `CATS`, `localTransport()`, `remoteTransport({ base, token, socket })`, `renderUpcomingStrip(el, ctx)`.

## Transport shape

```
{ kind:"server"|"local", list()->events[], put(ev)->ev, del(id), rsvp(id, user, state|null)->ev, onChange(cb)->off }
onChange messages: {op:"put",event} | {op:"del",id} | {op:"sync"}   (remote:true when from elsewhere)
```

If no transport is passed, calendar.js imports `../uplink.js` and, when `configured()` is true, calls
`calendarTransport(remoteTransport)`. Simplest uplink export:

```js
export async function calendarTransport(make){ return make({ base: API_BASE, token: token(), socket: currentWs }); }
```

`remoteTransport` speaks:
- `GET /api/events` → `{ events:[...] }`
- `POST /api/events` (body = event) → `{ event }`
- `DELETE /api/events/:id` → 204 / `{}`
- `POST /api/events/:id/rsvp` `{ state:"going"|"maybe"|null }` → `{ event }`
- WS frames `{ type:"cal", op:"put", event }` / `{ type:"cal", op:"del", id }`

## Suggested server rules

Event: `{ id, title<=120, start, end (epoch ms; end>start; <=62 days), allDay, cat ∈ meetup|game|stream|movie|trip|bday|work|other, where<=160, notes<=2000, repeat ∈ none|weekly|biweekly|monthly|yearly, until, by, created, updated, rsvp{ user:"going"|"maybe" } }`

- All endpoints need a valid token (logged-in operator).
- Create: server sets `by` = token user, `created`.
- Update / delete: only the owner (`by`) or admin. Keep server-side `by`, `created`, `rsvp` on update.
- RSVP: any logged-in user, only their own entry.
- Cap total events (e.g. 2000); broadcast after every write.
