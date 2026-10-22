#!/usr/bin/env bash
cd "$(dirname "$0")/server" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get it from https://nodejs.org then re-run this."; read -r _; exit 1
fi
if [ ! -d node_modules/@anthropic-ai/sdk ]; then
  echo "First run: installing the AI assistant's Claude library (one-time, needs internet)..."
  echo "(if this fails you can still use everything else; the assistant runs on its on-device brain)"
  npm install --omit=dev --no-audit --no-fund || true
fi
echo "Starting T.U.R.D. ... opening http://localhost:8787 (close this window to stop)"
( sleep 1; open http://localhost:8787 2>/dev/null || xdg-open http://localhost:8787 2>/dev/null ) &
node server.js
