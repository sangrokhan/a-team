#!/usr/bin/env bash
set -euo pipefail

# Starts:
# 1) web UI static server
# 2) codex app-server websocket
# Both in the same terminal session.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/webui"
PORT="${WEBUI_PORT:-8090}"
CODEX_LISTEN="${CODEX_LISTEN:-ws://127.0.0.1:8765}"

if [[ ! -f "$WEB_DIR/index.html" ]]; then
  echo "Cannot find web UI at $WEB_DIR"
  exit 1
fi

WEB_PID=""
cleanup() {
  if [[ -n "$WEB_PID" ]] && ps -p "$WEB_PID" >/dev/null 2>&1; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

cd "$ROOT_DIR"
python3 -m http.server "$PORT" >/tmp/a-team-webui-server.log 2>&1 &
WEB_PID=$!

echo "Web UI started on http://localhost:$PORT/webui/ (pid $WEB_PID)"
echo "Web UI logs: /tmp/a-team-webui-server.log"
echo "Codex websocket target: $CODEX_LISTEN"

echo "Starting codex app-server..."
exec codex app-server --listen "$CODEX_LISTEN"
