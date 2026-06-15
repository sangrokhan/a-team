# a-team

Run **teams of `claude`-CLI agents** that work like a team — an orchestrator plans a task and
delegates subtasks to specialist agents — and watch + steer them live from a web page.

- **Configurable teams** in `teams.yaml` (no code changes to add a team or agent)
- **Orchestrator delegation**: a lead agent plans, then routes subtasks to roster members
- **Real work**: agents run `claude` with tools in a per-task working directory
- **Live web UI** (React + React Flow): every team is a graph whose nodes light up as agents run
- **Targeted chat**: message a whole team (→ orchestrator) or one specific agent
- **Prepaid backend**: every agent turn is a `claude -p` subprocess — auth comes from your CLI, no API keys in code
- **Guarded**: single shared password; `teams.yaml` is editable from an in-browser config editor

## Architecture

```
Browser (React + React Flow)
   │  REST (login, send task, edit config) + WebSocket (live event stream)
Backend (Node/TS — Fastify + ws)
   ├─ Auth          single shared password, session cookie
   ├─ Config        teams.yaml
   ├─ Orchestrator  plans a task → assignments
   ├─ Agent runner  spawns `claude -p` per agent turn
   ├─ Event store   .a-team/state/jobs/<id>/{record.json, events.jsonl}
   └─ Work dirs     .a-team/runs/<task>/<agent>/   (real tool work)
```

State is file-based and event-sourced (no database). The append-only event stream is what the UI
replays and what the tests assert against.

## Prerequisites

- Node.js 20+ (developed on 22)
- `claude` CLI installed and authenticated in your shell

## Quick start

```bash
# 1) install backend deps
npm install

# 2) build the web UI
cd web && npm install && npm run build && cd ..

# 3) create your config from the example
cp teams.example.yaml teams.yaml

# 4) run (set a strong password)
ATEAM_PASSWORD=changeme ATEAM_CLAUDE_BIN=$(command -v claude) npm start

# open http://localhost:10000  (log in with the password above)
```

Send a task in a team's chat (target = **Team** to let the orchestrator delegate, or pick a
specific **agent**). Nodes turn green while running; streamed output and results appear in the thread.

## Configuration — `teams.yaml`

```yaml
auth:
  password: "${ATEAM_PASSWORD}"     # env-expanded; the single shared login password
server:
  host: "0.0.0.0"
  port: 10000
teams:
  - id: alpha
    name: "Team Alpha — web build"
    orchestrator:
      model: opus
      prompt: >
        You are the team lead. Break the task into subtasks and assign each to one
        agent by id. Respond ONLY with a fenced ```json block:
        {"assignments":[{"agent":"<id>","subtask":"<text>"}]}.
    agents:
      - { id: engineer, role: "Senior full-stack engineer", model: sonnet }
      - { id: reviewer, role: "Critical code reviewer",     model: sonnet }
      - { id: tester,   role: "QA / test author",           model: sonnet }
```

Edit it from the **⚙ Config** page in the UI (behind login). Changes apply on restart.

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `ATEAM_PASSWORD` | — | Login password (referenced by `teams.yaml`) |
| `ATEAM_CLAUDE_BIN` | `claude` | Path to the CLI to spawn per agent turn |
| `ATEAM_CONFIG` | `teams.yaml` | Config file path |
| `ATEAM_SKIP_PERMISSIONS` | on (`!= "0"`) | Run `claude` with `--dangerously-skip-permissions` so agents act non-interactively. Set to `0` to disable |

## Tests

```bash
npm test          # backend suite — uses a mock claude CLI, spends no credits
```

## Security notes

- Agents run `claude` with tools doing **real work** — i.e. arbitrary command execution on the
  host. The login guards *who* can trigger it, not *what* an agent can do. Run on trusted machines
  only; keep `ATEAM_PASSWORD` strong; avoid untrusted networks. A startup warning prints while
  skip-permissions mode is active.
- The server binds `0.0.0.0` by design (remote access); the shared password is the only gate.

## Design docs

See `docs/superpowers/specs/` (design) and `docs/superpowers/plans/` (implementation plan).
