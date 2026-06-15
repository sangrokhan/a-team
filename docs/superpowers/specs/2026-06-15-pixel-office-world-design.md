# a-team v2 — The Pixel Office World (Phase A+B)

**Date:** 2026-06-15
**Status:** Design approved (pending spec review)
**Builds on:** `2026-06-12-agent-team-web-control-design.md` (v1)

---

## Ultimate Goal

Replace the v1 dashboard with a **living 2D pixel-art office**: each team is a fixed room, each
agent is a stylized pixel person who wanders their room and visibly works when busy. The human
operator runs the company by **clicking avatars** — rename them, edit their persona, message or
assign work to them, and watch their jobs run — and grows the company with in-world **＋ Add team /
＋ Add agent** buttons. Everything is live and persisted; no restarts.

## Objectives

1. **Pixel office UI** replaces the v1 React Flow + chat dashboard entirely.
2. **Fixed team zones** — one labeled room per team; agents are confined to their team's room.
3. **Stylized pixel avatars** (head+body figure, distinct color, role emoji, name label) — no
   external sprite assets.
4. **State-driven movement** — idle agents wander; an agent with a running job walks to a desk and
   plays a "working" animation; on completion it walks back to wandering.
5. **Click-to-inspect** — clicking an agent opens a panel to edit Name + Persona, DM/assign a job,
   and track that agent's running job (live output) + recent history.
6. **Team-level work** — clicking a team's Leader opens a panel to assign a job to the whole team
   (orchestrator delegates, as in v1).
7. **In-world growth** — ＋ Add team and ＋ Add agent spawn the zone/avatar immediately.
8. **Live + persisted roster** — name/persona edits and adds apply to the next job AND are written
   back to `teams.yaml`, with no server restart.

## Non-Goals (this phase)

- Cross-team leader-to-leader delegation (Phase C, separate spec).
- Removing teams or agents (add + edit only).
- Real sprite-sheet art / 4-direction walk cycles.
- Agents pathing toward each other to "collaborate" (movement is per-agent, state-driven only).
- Canvas/PixiJS rendering (DOM sprites are sufficient at this scale).

---

## Architecture

Reuses the entire v1 backend (Fastify + ws, `EventStore`, `Dispatcher`, `AuthStore`,
`agentRunner`, mock-CLI tests). Two additions on the backend, a full rewrite of the frontend.

```
Browser (React) — pixel office
   │  REST (login, roster mutate, assign/DM, job history) + WebSocket (live events)
Backend (Node/TS — Fastify + ws)   [v1, + RosterStore + roster routes]
   ├─ Auth, EventStore, Dispatcher, agentRunner   (unchanged from v1)
   ├─ RosterStore   NEW — in-memory teams + mutate + persist to teams.yaml
   └─ routes        +PATCH/POST roster, +GET /api/jobs   (existing task/login/ws kept)
```

### Backend units

| Unit | Change | Interface |
|------|--------|-----------|
| `types.ts` | `AgentDef` gains `name: string` (display); `id` stable; `role` is the persona | — |
| `rosterStore.ts` | NEW — owns the live `Team[]`, mutates + writes yaml | `getTeams()`, `updateAgent(teamId,agentId,{name?,role?})`, `addAgent(teamId,{id,role,name})`, `addTeam({id,name})`, `persist()` |
| `configWriter.ts` | NEW — serialize current roster back to `teams.yaml` preserving `auth`/`server` | `writeConfig(path, cfg)` |
| `server.ts` | use `RosterStore` instead of static `cfg.teams`; add roster routes + `GET /api/jobs` | routes below |
| `eventStore.ts` | add `listJobs()` (read all job records, newest first) for history | `listJobs(): JobRecord[]` |

`Dispatcher` is constructed to read `rosterStore.getTeams()` at request time (or is passed the
team object resolved per request), so persona/name edits take effect on the next job with no
restart.

### New / changed routes (all auth-gated like v1)

- `PATCH /api/teams/:teamId/agents/:agentId` — body `{name?, role?}` → update + persist → `{ok}`
- `POST /api/teams/:teamId/agents` — body `{id, role, name?}` → add agent + persist → the new `AgentDef`
- `POST /api/teams` — body `{id, name}` → add empty-roster team (with a default orchestrator) + persist → the new `Team`
- `GET /api/jobs?agent=<agentId>&team=<teamId>` — recent job records (filter optional) for history backfill
- Unchanged: `POST /api/login`, `POST /api/logout`, `GET /api/teams`, `POST /api/teams/:teamId/tasks` (team assign = no `agent`; DM/assign-to-agent = with `agent`), `GET /ws`, `GET/POST /api/config`.

Validation: reject duplicate team id / duplicate agent id within a team (reuse the v1 config
validation rules); `409` on conflict, `404` on unknown team/agent.

### `configWriter` note

`teams.yaml` is written by serializing the live `Config` (auth + server + teams) with `js-yaml`
`dump`. The `auth.password` is preserved as its **original `${ENV}` reference**, not the expanded
secret — `RosterStore` keeps the raw pre-expansion config text for `auth`/`server` and only
re-serializes the `teams` array, so the password secret is never written to disk in plaintext.

---

## Frontend (full rewrite under `web/src/`)

DOM-sprite world in React. No canvas. A fixed-size "floor" with one zone per team.

| File | Responsibility |
|------|----------------|
| `types.ts` | mirror backend types incl. `name`; `AgentRuntime` (status, position, target) |
| `api.ts` | REST client: login, fetchTeams, assignTeam, assignAgent/dm, updateAgent, addAgent, addTeam, fetchJobs, connectEvents (WS) |
| `world/store.ts` | reducer: events → per-agent `status` (idle/running/error) + per-agent chat/job log; team/agent roster |
| `world/useMovement.ts` | tick loop (rAF/interval) computing each agent's target position from status (wander point in zone, or its desk when running) |
| `world/Floor.tsx` | renders zones + the ＋Add team/agent buttons |
| `world/Zone.tsx` | one team room: label, desks, contained agents |
| `world/Avatar.tsx` | one pixel figure: head+body+emoji+name, CSS-transition to target position, working animation when running, status badge |
| `panels/AgentPanel.tsx` | inspect panel: edit name/persona, DM/assign, running job + history |
| `panels/LeaderPanel.tsx` | team-assign panel (assign job → orchestrator) |
| `panels/AddDialogs.tsx` | add-team / add-agent forms |
| `Login.tsx` | unchanged from v1 |
| `App.tsx` | shell: login gate → Floor + selected panel; WS wiring |

### Movement model

Each agent has a current `{x,y}` and a `target {x,y}` within its zone's bounds. A single tick loop
(~one step every few hundred ms) updates targets:
- **idle** → every few seconds pick a new random wander point inside the zone.
- **running** → target = the zone's desk slot for that agent; once there, play the `working`
  CSS animation (small bob + a "✎"/spinner over the head).
- **error** → target = wander, badge turns red briefly.
`Avatar.tsx` renders position via a CSS `transform` transition, so motion is smooth between targets.
Status comes from the event reducer: `agent.started`→running, `agent.output`→running (keep),
`agent.done`→idle, `agent.error`→error.

### Deriving per-agent jobs

The WS event stream carries `agentId`+`jobId`. `world/store.ts` keeps, per agent: current job id,
streamed output buffer, and a short history (job id + status + last text). On first load,
`GET /api/jobs` backfills recent history. The AgentPanel reads this slice.

---

## Data flow (assign a job to one agent)

1. Click avatar → AgentPanel. Type message → **Assign job**.
2. `POST /api/teams/:teamId/tasks {task, agent}` → v1 `dispatcher.runDirect`.
3. Backend streams `agent.started`/`agent.output`/`agent.done` over WS.
4. Reducer flips that agent to **running** → `useMovement` walks it to its desk + working anim;
   AgentPanel shows live output; on `agent.done` it walks back and the result lands in history.

Editing persona: AgentPanel → `PATCH …/agents/:id {name, role}` → `RosterStore` updates the live
team object + persists yaml → next job for that agent uses the new persona; the avatar's name label
updates from the refreshed roster.

---

## Error handling

- Roster mutations validate ids; `409` duplicate, `404` unknown → panel shows the error inline.
- `configWriter` failure (disk) → route returns `500`, in-memory change is rolled back so memory and
  disk stay consistent.
- WS disconnect → client retries with backoff; on reconnect it refetches `GET /api/teams` + `GET /api/jobs`
  to resync roster and history.
- Agent job failure (`agent.error`) → red badge + error line in the panel (no auto-retry, per v1).

---

## Testing

- **Backend (Vitest + mock claude):**
  - `rosterStore`: update agent name/role, add agent, add team, reject duplicate ids, `persist()`
    round-trips through `configWriter` (write then `loadConfig` returns the mutation).
  - `configWriter`: `auth.password` is written as the original `${ENV}` reference, not the secret.
  - routes: PATCH/POST roster are auth-gated, persist, and return correct codes; `GET /api/jobs`
    filters by agent.
  - regression: existing v1 suite stays green.
- **Frontend (Vitest, jsdom):**
  - `world/store.ts` reducer: `agent.started`→running, `agent.done`→idle, `agent.error`→error;
    per-agent job/history slice built from a sequence of events.
  - `api.ts`: request shapes for assign/dm/update/add.
  - Movement/animation is visual — verified manually, not unit-tested.
- **Manual E2E (real claude):** add a team + agent in-world; assign a job to an agent and watch it
  walk to its desk, stream output, and return; edit a persona and confirm the next job reflects it;
  confirm `teams.yaml` on disk updated and the password line still shows `${ATEAM_PASSWORD}`.

---

## Build sequence (high level — detailed plan follows in writing-plans)

1. Backend: `AgentDef.name`, `configWriter`, `RosterStore` (+ tests) → verify yaml round-trip.
2. Backend: wire `RosterStore` into `server.ts`, add roster routes + `GET /api/jobs` (+ tests) → v1 suite still green.
3. Frontend scaffold: new `types`, `api`, `world/store` reducer (+ tests).
4. Frontend world: `Floor`/`Zone`/`Avatar` + `useMovement` → static then moving.
5. Frontend panels: AgentPanel, LeaderPanel, AddDialogs → wired to API + WS.
6. App shell wiring + remove old v1 UI files.
7. Manual E2E with real claude.

---

## Open risks

- **Movement jank** with many agents (DOM transitions). Acceptable for expected small teams;
  revisit canvas only if it stutters.
- **Concurrent roster edits** (two browser tabs) could race on the yaml. v1-style single-user
  assumption holds; last write wins. Note, don't solve now.
- **Persona live-apply** only affects jobs started after the edit; in-flight jobs keep the old
  persona. Intended.
