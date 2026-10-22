# Run T.U.R.D. on your desktop

Everything lives in this folder and runs locally — no accounts, no cloud. Your
data (operator accounts, chat, calendar, the admin log) stays on your machine in
`server/data/`.

## One-time: install Node.js
If you don't already have it, grab the **LTS** from <https://nodejs.org> and install
it (next-next-finish). That's the only requirement.

## Start it
- **Windows:** double-click **`start-windows.bat`**.
- **Mac/Linux:** double-click **`start-mac-linux.command`** (first time on a Mac you may
  need to right-click → Open to clear the security prompt).

A browser opens at <http://localhost:8787>. Log in as **admin** (passkey `admin`
the first time — you'll be asked to set your own). The app is already pointed at
your local server, so chat and the calendar just work. Keep the little black
window open while you use it; close it to stop the server.

## Let other people / your phone in
Others on **your home Wi-Fi** can join at `http://YOUR-PC-IP:8787` (find your IP with
`ipconfig` on Windows / `ifconfig` on Mac). For people **outside** your network you'd
need to forward port 8787 on your router or run a tunnel (e.g. Cloudflare Tunnel or
ngrok) — ask me and I'll walk you through it.

## Invite operators (it's invite-only)
In **Chat → ⬡ NET LOG → Invite an operator**, make an id + passkey for each person
and share it. The admin connection log (IP, approx. location, device, etc.) is on
that same panel, visible only to you.

## The AI assistant tab
The first time you start it, the script installs the assistant's Claude library
(needs internet, one-time). To let the assistant actually reach Claude, open
**Assistant** in the app and add your Anthropic API key (admin only — it's stored
locally in `server/data`, never shown back). Without a key or internet it still
works on its built-in on-device brain. See `server/ASSISTANT.md`.

## Options (set before starting, optional)
`set GEOIP=0` (Windows) / `GEOIP=0 ...` to turn off location lookup, `PORT=9000` to
change the port, `ADMIN_PASSWORD=...` to seed a different admin passkey. Details in
`server/README.md`.
