# Web UI Prototype

TypeScript-based UI for Codex-like command input/output with per-location controls, live `app_server` WebSocket layer, and visual workflow/agent-injection configuration.

## Run

Compile TS:

```bash
tsc -p webui/tsconfig.json
```

Serve static files from repository root:

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
- Workflow Studio:
  - select workflow per chat
  - fixed-stage injection structure
  - edit/add/remove agents visually
  - duplicate/reset workflows
- Flow panel with route target and recent event stream
- WebSocket JSON-RPC connection (`initialize`, `thread/start`, `turn/start`, `turn/interrupt`)
- Quick command chips for common actions

## Source Layout

- `src/main.ts`: orchestration, command flow, stage injection runtime
- `src/state.ts`: location/workflow state and helpers
- `src/transport.ts`: WebSocket JSON-RPC transport layer
- `src/ui.ts`: rendering and visual editor wiring
- `src/config.ts`, `src/types.ts`, `src/utils.ts`: config/types/utilities
