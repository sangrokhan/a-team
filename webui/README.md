# Web UI Prototype

First-pass UI for Codex-like command input/output with per-location controls and a live `app_server` WebSocket layer.

## Run

From repository root:

```bash
python3 -m http.server 8080
```

Then open:

- `http://localhost:8080/webui/`

## Run codex app-server (WebSocket)

In another terminal:

```bash
codex app-server --listen ws://127.0.0.1:8765
```

Then in the UI:

1. Keep endpoint as `ws://127.0.0.1:8765`
2. Click `Connect`
3. Send commands from the console (`turn/start` text input is sent as `UserInput`)

## Included

- CLI-style input/output console
- Per-location control cards (pause, interrupt, queue/running state)
- Per-location `threadId` / `turnId` tracking
- Flow panel with route target and recent event stream
- WebSocket JSON-RPC connection (`initialize`, `thread/start`, `turn/start`, `turn/interrupt`)
- Quick command chips for common actions
