# a-team — Multi-Team Agent Orchestration with Web Control

**Date:** 2026-06-12
**Status:** Design approved (pending spec review)

---

## Ultimate Goal

Build a system where **teams of LLM agents collaborate like real teams** — each team has an
orchestrator that plans and delegates work to specialist agents — and the human **watches and
steers them from a single web page**: see every team as a live graph, chat with a team or a
specific agent, and assign new tasks. The agents run on the user's **prepaid Claude account via
the `claude` CLI**, doing real work (files, commands) in isolated working directories.

## Objectives

1. **Configurable teams** — declare any number of teams and agents in `teams.yaml` (name, role
   prompt, model, working dir). No code change to add/edit a team.
2. **Team-like collaboration** — an orchestrator agent reads a task, plans, and delegates subtasks
   to the right roster members, then collects their results.
3. **Real work** — agents invoke `claude` with tools enabled and operate in a per-task working
   directory, producing actual artifacts.
4. **Live web visualization** — one page shows multiple teams, each as a graph (orchestrator →
   workers) with live status (idle / running / error) that updates in real time.
5. **Targeted chat** — each team has its own chat thread; the user can address the whole team
   (→ orchestrator) or a specific agent directly.
6. **Prepaid CLI backend** — every agent turn is a `claude` subprocess; no API keys in code, auth
   comes from the user's logged-in CLI.
7. **Guarded control surface** — the web app is reachable over the network but behind a simple
   login, including a password-protected editor for `teams.yaml`.

## Non-Goals (v1)

- No hot config reload (edit → save → restart to apply).
- No auto-retry / reassign on agent failure (mark error, user resends).
- No multi-round orchestrator synthesis loop (single plan → dispatch → collect).
- No sandbox/containers/worktrees (agents trusted on the local machine).
- No multi-user accounts (single shared password).

---

## Architecture

```
Browser (React + React Flow)
   │  REST (login, send task, edit config) + WebSocket (live event stream)
Backend (Node / TypeScript — Fastify + ws)
   ├─ Auth          → single shared password, session cookie
   ├─ Config loader → reads teams.yaml at startup
   ├─ Orchestrator  → plans a task, emits subtask assignments
   ├─ Agent runner  → spawns `claude -p …` subprocess per agent turn
   ├─ Event store   → .a-team/state/jobs/<id>/{record.json, events.jsonl}
   └─ Working dirs  → .a-team/runs/<task>/<agent>/  (real tool work)
```

Single backend process. **File-based, event-sourced** state (reuse the proven `.a-team/state`
model from the prior stack) — no database. The append-only event stream is both what the UI
replays and what tests assert against.

### Components (each independently testable)

| Unit | Does | Depends on | Interface |
|------|------|-----------|-----------|
| `config` | Load + validate `teams.yaml` → typed `Team[]` | yaml parser | `loadConfig(path): Config` |
| `eventStore` | Append/read job events + record | fs | `appendEvent(jobId, e)`, `readEvents(jobId)` |
| `agentRunner` | Spawn `claude` subprocess, stream stdout as events | child_process, eventStore | `runAgent(agent, prompt, workdir): AsyncIterable<Event>` |
| `orchestrator` | Ask orchestrator agent for a plan, parse into assignments | agentRunner | `plan(team, task): Assignment[]` |
| `dispatcher` | Run a task: plan → run each assignment → collect | orchestrator, agentRunner, eventStore | `dispatch(team, task)` |
| `auth` | Verify password, issue/validate session | config (password) | middleware |
| `httpApi` | REST endpoints | all above | routes |
| `wsHub` | Broadcast events to connected browsers | eventStore | subscribe/publish |
| `web` (React) | Render teams, graphs, chat; send tasks | httpApi, wsHub | — |

---

## Config — `teams.yaml`

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
      prompt: "You are the team lead. Break the task into subtasks and assign each to one agent."
    agents:
      - { id: engineer, role: "Senior full-stack engineer", model: sonnet }
      - { id: reviewer, role: "Critical code reviewer",     model: sonnet }
      - { id: tester,   role: "QA / test author",           model: sonnet }
```

- Each agent → a `claude -p` call; `role` becomes the system prompt.
- Working dir per agent turn: `.a-team/runs/<taskId>/<agentId>/` (created on demand).
- Editable from the web config editor (behind login); save writes the file; restart to apply.

---

## Delegation Protocol

A task sent to a **team** (no specific agent):

1. **Plan** — `dispatcher` runs the orchestrator agent (`claude` call) with the task. It must
   return a structured plan:
   ```json
   { "assignments": [ { "agent": "engineer", "subtask": "Build the Vite app" },
                      { "agent": "tester",   "subtask": "Write tests for it" } ] }
   ```
   Parsed from the orchestrator's `--output-format json` / fenced-JSON output.
2. **Dispatch** — for each assignment, spawn that worker agent in its working dir.
3. **Stream** — worker stdout is emitted live as events (UI shows node running + output).
4. **Collect** — on completion the dispatcher appends a `result` event per agent and a final
   `job.done`. (No synthesis re-loop in v1.)

A message sent to a **specific agent** (Team → Agent in chat): skip the orchestrator, spawn that
agent directly with the message as its prompt.

**Concurrency:** one subprocess per agent at a time (serial per agent); agents within a team and
across teams run concurrently. A global cap (default 4 concurrent subprocesses) avoids overload.

### Event types (the contract between backend and UI)

`job.created`, `plan.ready`, `agent.started`, `agent.output` (chunk), `agent.done`,
`agent.error`, `chat.message`, `job.done`. Each: `{ ts, jobId, teamId, agentId?, type, payload }`.

---

## Frontend (Layout B — multi-team)

- **Team panels grid** — each team = a card containing a **React Flow** graph: orchestrator node
  + worker nodes, edges = delegation. Node color encodes live status (idle grey / running green /
  error red). An "Add team" tile is informational (editing is via config editor in v1).
- **Per-team chat thread** — click a team to focus its conversation. Composer has a target
  selector: *Team* (→ orchestrator) or a specific *Agent*. Sending posts the task and streams the
  reply.
- **Live updates** — a single WebSocket feeds all panels; events update node status, append chat
  messages, and stream agent output.
- **Config editor** — a settings page (behind login) showing `teams.yaml` in an editor; Save
  validates + writes; banner reminds to restart.
- **Login** — unauthenticated users get only the login screen (password → session cookie).

---

## Auth (simple)

- Single shared password from `auth.password` (env-expanded).
- `POST /login` checks the password, sets an httpOnly session cookie (random session id held in
  memory). All other routes + WS require a valid session.
- Logout clears the session. No user accounts, no registration.

---

## Error Handling

- Subprocess **nonzero exit / timeout** → `agent.error` event, node turns red, message in thread.
  No auto-retry (user resends).
- **`claude` not authenticated** → startup healthcheck (`claude --version` / cheap probe);
  failure surfaced as a banner; tasks rejected with a clear message until fixed.
- **Bad `teams.yaml`** → config load fails fast at startup with a precise parse/validation error.
- **Invalid orchestrator plan** (unparseable / unknown agent) → `agent.error`; task stops with an
  explanatory event rather than silently dropping work.

---

## Testing

All tests use a **mock `claude` script** (a fake executable that echoes canned output keyed by
prompt) injected via a configurable CLI path — so the suite never spends real credits.

- **Unit:** `config` (valid/invalid yaml, env expansion), `eventStore` (append/read ordering),
  `orchestrator` plan parser (good JSON, fenced JSON, malformed), `auth` (right/wrong password,
  session validation).
- **Integration:** send a task → assert the full event sequence (`job.created` … `job.done`) and
  the final job record; direct-agent message → assert orchestrator is skipped.
- **Goal-driven checks** per feature: e.g. "targeted chat" → test that a message to `alpha/tester`
  produces exactly one `agent.started` for `tester` and no `plan.ready`.

---

## Build Sequence (high level — detailed plan follows in writing-plans)

1. Scaffold backend (Fastify + ws + TS) and `config` loader → verify: loads sample `teams.yaml`.
2. `eventStore` + mock-CLI `agentRunner` → verify: run mock agent, events appended in order.
3. `orchestrator` + `dispatcher` → verify: integration test task → event sequence.
4. `auth` + REST API + `wsHub` → verify: login gate, task endpoint, live broadcast.
5. React frontend: login → team grid (React Flow) → per-team chat → live WS wiring.
6. Config editor page → verify: edit + save round-trips `teams.yaml`.
7. End-to-end with real `claude` on one small task → verify: artifact produced in working dir.

---

## Open Risks

- **Arbitrary command execution**: agents run real tools on the host. v1 trusts the local
  machine; the login guard limits *who* can trigger it, not *what* an agent can do. Sandbox is a
  future objective.
- **Open bind (0.0.0.0)**: mitigated only by the shared password — keep that password strong and
  avoid untrusted networks.
- **Prepaid credit burn**: real agent runs cost credits; the global concurrency cap and mock-CLI
  tests limit accidental spend.
