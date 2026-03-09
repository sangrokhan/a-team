#!/usr/bin/env bash
set -euo pipefail

# Smoke test for startup helper scripts:
# - verifies start script prints expected web UI URL
# - verifies web UI is reachable
# - starts a real codex app-server (default) and validates websocket availability

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
START_SCRIPT="./scripts/start-webserver-and-codex.sh"
PORT="${START_WEBUI_TEST_PORT:-8110}"
LISTEN="${START_WEBUI_TEST_LISTEN:-ws://127.0.0.1:8765}"
TIMEOUT_SECONDS="${START_WEBUI_TEST_TIMEOUT:-8}"
USE_REAL_CODEX="${TEST_USE_REAL_CODEX:-1}"

TMPDIR="$(mktemp -d)"
START_LOG="$TMPDIR/start.log"
FAKE_CODEX_LOG="$TMPDIR/fake-codex.log"
FAKE_CODEX="$TMPDIR/codex"
START_PID=""

cleanup() {
  if [[ -n "$START_PID" ]] && kill -0 "$START_PID" 2>/dev/null; then
    kill "$START_PID" 2>/dev/null || true
    wait "$START_PID" 2>/dev/null || true
  fi
}

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
}

get_ws_host_port() {
  python3 - <<PY
import os
import urllib.parse
url = os.environ["LISTEN"]
parsed = urllib.parse.urlparse(url)
host = parsed.hostname or "127.0.0.1"
port = parsed.port or (443 if parsed.scheme == "wss" else 80)
print(host)
print(port)
PY
}

check_websocket_url() {
  python3 - <<PY
import os
import socket
import time
host = os.environ["WS_HOST"]
port = int(os.environ["WS_PORT"])
for _ in range(int(os.environ["WS_TIMEOUT"])):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(1)
        try:
            if sock.connect_ex((host, port)) == 0:
                print("socket_ok")
                raise SystemExit(0)
        except OSError:
            pass
    time.sleep(1)
raise SystemExit(1)
PY
}

check_websocket_handshake() {
  node - <<NODE
const url = process.env.CODEX_WS_URL;
const timeoutMs = Number(process.env.CODEX_WS_TIMEOUT || "5000");

const ws = new WebSocket(url);
const timeout = setTimeout(() => {
  console.error("websocket_timeout");
  process.exit(3);
}, timeoutMs);

ws.addEventListener("open", () => {
  clearTimeout(timeout);
  console.log("websocket_open");
  ws.close();
  process.exit(0);
});

ws.addEventListener("error", () => {
  clearTimeout(timeout);
  console.error("websocket_error");
  process.exit(2);
});
NODE
}

require_command python3
require_command node

if [[ "$USE_REAL_CODEX" == "1" ]]; then
  require_command codex
else
  cat > "$FAKE_CODEX" <<EOF_FAKE
#!/usr/bin/env bash
echo "[fake-codex] args: \$@" >> "$FAKE_CODEX_LOG"
sleep "$TIMEOUT_SECONDS"
EOF_FAKE
  chmod +x "$FAKE_CODEX"
  export PATH="$TMPDIR:$PATH"
fi

trap cleanup EXIT

(
  cd "$ROOT_DIR"
  WEBUI_PORT="$PORT" CODEX_LISTEN="$LISTEN" "$START_SCRIPT" >> "$START_LOG" 2>&1
) &
START_PID=$!

start_seen=0
for _ in $(seq 1 "$TIMEOUT_SECONDS"); do
  if grep -q "Web UI started on http://localhost:$PORT/webui/" "$START_LOG"; then
    start_seen=1
    break
  fi
  if ! kill -0 "$START_PID" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [[ "$start_seen" -ne 1 ]]; then
  echo "Startup did not initialize web UI in expected time." >&2
  echo "--- start output ---" >&2
  cat "$START_LOG" >&2
  exit 1
fi

python3 - <<PY
import sys
from urllib.request import urlopen

url = "http://127.0.0.1:${PORT}/webui/"
with urlopen(url, timeout=10) as r:
    body = r.read(200).decode("utf-8", errors="ignore")
    if r.status != 200:
        raise SystemExit(f"Unexpected status: {r.status}")
    if "Codex Command Grid" not in body:
        raise SystemExit("webui index did not load expected UI title")
print("webui_ok")
PY

if [[ "$USE_REAL_CODEX" == "1" ]]; then
  if ! grep -q "Starting codex app-server" "$START_LOG"; then
    echo "codex app-server did not start as expected." >&2
    echo "--- start output ---" >&2
    cat "$START_LOG" >&2
    exit 1
  fi

  WS_HOST_PORT=$(LISTEN="$LISTEN" get_ws_host_port)
  WS_HOST_PORT="$(printf '%s' "$WS_HOST_PORT" | tr '\n' ' ')"
  read -r WS_HOST WS_PORT <<< "$WS_HOST_PORT"

  WS_HOST="$WS_HOST" WS_PORT="$WS_PORT" WS_TIMEOUT="$TIMEOUT_SECONDS" check_websocket_url || {
    echo "WebSocket socket check failed (tcp connect) to ${WS_HOST}:${WS_PORT}." >&2
    echo "--- start output ---" >&2
    cat "$START_LOG" >&2
    exit 1
  }

  CODEX_WS_TIMEOUT=$((TIMEOUT_SECONDS * 1000)) CODEX_WS_URL="$LISTEN" check_websocket_handshake || {
    echo "WebSocket handshake check failed for $LISTEN." >&2
    echo "--- start output ---" >&2
    cat "$START_LOG" >&2
    exit 1
  }
else
  if [[ ! -s "$FAKE_CODEX_LOG" ]] || ! grep -q -- "--listen $LISTEN" "$FAKE_CODEX_LOG"; then
    echo "codex was not invoked with expected websocket endpoint." >&2
    echo "--- fake codex log ---" >&2
    cat "$FAKE_CODEX_LOG" >&2 || true
    exit 1
  fi
fi

if kill -0 "$START_PID" 2>/dev/null; then
  kill "$START_PID"
  wait "$START_PID" 2>/dev/null || true
  START_PID=""
fi

echo "PASS: web UI start script smoke check completed"
