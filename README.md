# a-team

This repository includes a minimal control surface and service stack for a Codex-style multi-agent workflow.

## Folder layout
- `services/api/` — HTTP/API service (built NestJS app)
- `services/worker/` — queue worker process
- `webui/` — TypeScript web control UI
- `.a-team/` — runtime workspace metadata

## Prerequisites
- Node.js 20+
- npm (or your preferred package manager)
- Python 3 (for static file serving)
- `codex` CLI installed and authenticated in your shell

> Note: The API and worker run from committed JavaScript builds in `dist`.

## 1) Run API service

From repo root:

```bash
node services/api/dist/main.js
```

- Default: `http://localhost:8080`
- Change port with env var: `PORT=39090 node services/api/dist/main.js`
- API docs: `http://localhost:8080/v1/docs`

## 2) Run worker

Open another terminal and run:

```bash
node services/worker/dist/index.js
```

Optional env vars:
- `REDIS_URL` (Redis queue mode)
- `WORK_ROOT` (workspace for run artifacts)

## 3) Build and run Web UI

From repo root:

```bash
tsc -p webui/tsconfig.json
```

Then serve the repo root and open the UI:

```bash
python3 -m http.server 8090
```

Open in browser:

- `http://localhost:8090/webui/`

## 4) Connect to Codex app-server

In another terminal, start:

```bash
codex app-server --listen ws://127.0.0.1:8765
```

In the UI, set endpoint to `ws://127.0.0.1:8765` and click **Connect**.

## Quick startup order

1. `node services/api/dist/main.js`
2. `node services/worker/dist/index.js`
3. `tsc -p webui/tsconfig.json`
4. `python3 -m http.server 8090`
5. `codex app-server --listen ws://127.0.0.1:8765`
6. Open `http://localhost:8090/webui/`

## Common ports
- API: `8080` (configurable via `PORT`)
- Web UI server: `8090` (sample)
- App-server websocket: `8765`

## One-command execution for UI + Codex

Use the execution script:

```bash
./scripts/start-webserver-and-codex.sh
```

Defaults:
- Web UI: `http://localhost:8090/webui/`
- WebSocket: `ws://127.0.0.1:8765`

You can override:

```bash
WEBUI_PORT=8085 CODEX_LISTEN=ws://127.0.0.1:8770 ./scripts/start-webserver-and-codex.sh
```

## Alternative one-liner (manual)

```bash
cd /home/han/.openclaw/workspace/a-team && (python3 -m http.server 8090 >/tmp/a-team-webui.log 2>&1 &) && codex app-server --listen ws://127.0.0.1:8765
```

## Smoke test

You can run a quick startup smoke test for the local webstack:

```bash
./scripts/test-webstack.sh
```

The test performs:

- starts the web UI launcher script
- verifies the web page is reachable at `/webui/`
- runs a real `codex app-server` by default and validates websocket connectivity to the endpoint

If your environment does not have `codex` available, you can run a fake-mode smoke test:

```bash
TEST_USE_REAL_CODEX=0 ./scripts/test-webstack.sh
```
