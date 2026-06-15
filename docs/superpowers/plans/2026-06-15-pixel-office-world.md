# a-team v2 — Pixel Office World Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the v1 dashboard with a 2D pixel-art office where each team is a fixed room and each agent is a stylized pixel person who wanders, walks to a desk and "works" while a job runs; clicking an agent lets you rename it, edit its persona, DM/assign work, and watch its jobs — all live and persisted to `teams.yaml`.

**Architecture:** Reuse the entire v1 backend (Fastify + ws, EventStore, Dispatcher, AuthStore, agentRunner, mock-CLI tests). Add a `RosterStore` (live, mutable teams that persist to yaml via `configWriter`) plus roster + jobs routes. Rewrite the React frontend as DOM-sprite world (no canvas): a tick loop moves avatars based on per-agent status derived from the WS event stream.

**Tech Stack:** Node 22 + TypeScript, Fastify 5 + @fastify/websocket, js-yaml, Vitest (backend + new web reducer tests), Vite + React 18.

Reference spec: `docs/superpowers/specs/2026-06-15-pixel-office-world-design.md`. v1 spec/plan in the same dirs.

---

## v1 recap (what already exists — do not rebuild)

Backend `src/`:
- `types.ts`: `AgentDef {id, role, model?}`, `OrchestratorDef {model?, prompt}`, `Team {id, name, orchestrator, agents}`, `Config {auth, server, teams}`, `Event {ts, jobId, teamId, agentId?, type, payload}`, `EventType`, `Assignment {agent, subtask}`, `JobRecord {id, teamId, task, target?, createdAt, status}`.
- `config.ts`: `loadConfig(path): Config` (env-expands `${VAR}`, validates).
- `eventStore.ts`: `class EventStore(root)` — `createJob({teamId,task,target?})`, `appendEvent({jobId,teamId,agentId?,type,payload})`, `setStatus(id,status)`, `readRecord(id)`, `readEvents(id)`, `onEvent(fn)→unsub`.
- `agentRunner.ts`: `runAgent({bin,prompt,model?,cwd,extraArgs?}, onChunk): Promise<{text,stderr,code}>`.
- `orchestrator.ts`: `parseAssignments(output, validAgentIds): Assignment[]`.
- `dispatcher.ts`: `class Dispatcher(store, {bin,runRoot,extraArgs})` — `dispatch(team,task)`, `runDirect(team,agentId,message)`.
- `auth.ts`: `class AuthStore(password)` — `login(attempt)→sid|null`, `valid(sid)`, `logout(sid)`.
- `server.ts`: `buildServer(cfg, deps): FastifyInstance`, `ServerDeps {bin, runRoot, stateRoot, extraArgs, webDir, configPath?}`. Cookie `ateam_sid`. Routes: login/logout, `GET /api/teams`, `POST /api/teams/:teamId/tasks {task, agent?}`, `GET/POST /api/config`, `GET /ws`.
- `index.ts`: env-driven entry.

Frontend `web/src/`: `types.ts`, `api.ts`, `store.ts`, `TeamPanel.tsx`, `ChatThread.tsx`, `ConfigEditor.tsx`, `Login.tsx`, `App.tsx`, `main.tsx`. **These v1 UI files are replaced in Task 12.**

Tests use `test/mocks/mock-claude.mjs`: prompt contains "PLAN" → emits `{"assignments":[{"agent":"engineer","subtask":"do work"}]}`; "FAIL" → exit 3; else two stdout lines.

---

## File structure (v2 additions / changes)

```
src/
  types.ts          MODIFY  AgentDef gains optional `name`
  configWriter.ts   CREATE  write teams back to yaml, preserving auth/server (incl. ${ENV} password)
  rosterStore.ts    CREATE  live mutable teams + persist; HttpError
  eventStore.ts     MODIFY  add listJobs()
  server.ts         MODIFY  use RosterStore; add roster routes + GET /api/jobs; map HttpError
test/
  configWriter.test.ts   CREATE
  rosterStore.test.ts    CREATE
  eventStore.test.ts     MODIFY  add listJobs test
  api.test.ts            MODIFY  add roster-route + jobs tests
web/
  package.json      MODIFY  add vitest + test script
  vitest.config.ts  CREATE
  src/types.ts      REWRITE incl. name, JobRecord, AgentStatus
  src/api.ts        REWRITE roster + assign + jobs client
  src/world/store.ts        CREATE  event→world reducer (per-agent status/output/history)
  src/world/store.test.ts   CREATE
  src/world/geometry.ts     CREATE  zone layout + wander/desk target math (pure, tested)
  src/world/geometry.test.ts CREATE
  src/world/useMovement.ts  CREATE  tick loop hook
  src/world/Avatar.tsx      CREATE
  src/world/Zone.tsx        CREATE
  src/world/Floor.tsx       CREATE
  src/panels/AgentPanel.tsx CREATE
  src/panels/LeaderPanel.tsx CREATE
  src/panels/AddDialogs.tsx CREATE
  src/Login.tsx     KEEP (unchanged from v1)
  src/App.tsx       REWRITE shell
  src/main.tsx      KEEP
  # DELETE: src/store.ts, src/TeamPanel.tsx, src/ChatThread.tsx, src/ConfigEditor.tsx
```

---

## Task 1: `AgentDef.name` + config default

**Files:** Modify `src/types.ts`; Modify `src/config.ts`; Modify `test/config.test.ts`

- [ ] **Step 1: Add a failing test** — append inside the `describe("loadConfig", …)` block in `test/config.test.ts`:

```ts
  it("defaults agent name to id when omitted", () => {
    process.env.TEST_PW = "s3cret";
    const cfg = loadConfig(tmpFile("teams.yaml", VALID));
    expect(cfg.teams[0].agents[0].name).toBe("engineer");
  });
```

- [ ] **Step 2: Run it, confirm FAIL**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — `name` is `undefined`.

- [ ] **Step 3: Modify `src/types.ts`** — change the `AgentDef` interface to:

```ts
export interface AgentDef {
  id: string;
  name?: string;          // display name; defaults to id
  role: string;            // persona / system prompt
  model?: string;
}
```

- [ ] **Step 4: Modify `src/config.ts`** — in `loadConfig`, inside the `for (const a of team.agents ?? [])` loop, after the duplicate-id check add:

```ts
      a.name = a.name ?? a.id;
```

- [ ] **Step 5: Run it, confirm PASS**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/config.ts test/config.test.ts
git commit -m "feat: add optional AgentDef.name, default to id"
```

---

## Task 2: `configWriter` — persist teams to yaml, preserve password ref

**Files:** Create `src/configWriter.ts`, `test/configWriter.test.ts`

- [ ] **Step 1: Write failing test `test/configWriter.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { writeConfig } from "../src/configWriter.js";
import { loadConfig } from "../src/config.js";
import { tmpFile } from "./helpers.js";
import type { Team } from "../src/types.js";

const YAML = `
auth: { password: "\${SECRET_PW}" }
server: { host: "0.0.0.0", port: 10000 }
teams:
  - id: alpha
    name: "Alpha"
    orchestrator: { model: opus, prompt: "PLAN" }
    agents:
      - { id: engineer, name: "Nova", role: "Engineer", model: sonnet }
`;

describe("writeConfig", () => {
  it("writes updated teams but keeps the password as an env reference", () => {
    const path = tmpFile("teams.yaml", YAML);
    const teams: Team[] = [{
      id: "alpha", name: "Alpha",
      orchestrator: { model: "opus", prompt: "PLAN" },
      agents: [{ id: "engineer", name: "Nova", role: "Lead engineer, writes tests", model: "sonnet" }],
    }];
    writeConfig(path, teams);

    // raw (unexpanded) read: password placeholder must be intact, not the secret
    const raw = yaml.load(readFileSync(path, "utf8")) as any;
    expect(raw.auth.password).toBe("${SECRET_PW}");
    expect(raw.teams[0].agents[0].role).toBe("Lead engineer, writes tests");

    // and loadConfig still works with the env set
    process.env.SECRET_PW = "xyz";
    const cfg = loadConfig(path);
    expect(cfg.auth.password).toBe("xyz");
    expect(cfg.teams[0].agents[0].name).toBe("Nova");
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** — `npx vitest run test/configWriter.test.ts` → cannot find module.

- [ ] **Step 3: Write `src/configWriter.ts`**

```ts
import { readFileSync, writeFileSync } from "node:fs";
import yaml from "js-yaml";
import type { Team } from "./types.js";

// Re-reads the existing yaml UNEXPANDED (so ${ENV} refs and auth/server stay verbatim),
// swaps in the current teams, and writes it back. The expanded password secret is never
// touched because we load the raw file, not the in-memory expanded Config.
export function writeConfig(path: string, teams: Team[]): void {
  const raw = yaml.load(readFileSync(path, "utf8")) as Record<string, unknown>;
  raw.teams = teams;
  writeFileSync(path, yaml.dump(raw, { lineWidth: 100 }));
}
```

- [ ] **Step 4: Run it, confirm PASS** — `npx vitest run test/configWriter.test.ts` → 1 passed.

- [ ] **Step 5: Commit**

```bash
git add src/configWriter.ts test/configWriter.test.ts
git commit -m "feat: add configWriter that persists teams without leaking the password"
```

---

## Task 3: `RosterStore` — live mutable teams + persistence

**Files:** Create `src/rosterStore.ts`, `test/rosterStore.test.ts`

- [ ] **Step 1: Write failing test `test/rosterStore.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { readFileSync } from "node:fs";
import { RosterStore, HttpError } from "../src/rosterStore.js";
import { tmpFile } from "./helpers.js";
import type { Team } from "../src/types.js";

const YAML = `
auth: { password: "\${PW}" }
server: { host: "0.0.0.0", port: 10000 }
teams:
  - id: alpha
    name: "Alpha"
    orchestrator: { model: opus, prompt: "PLAN" }
    agents:
      - { id: engineer, name: "Nova", role: "Engineer", model: sonnet }
`;

function make() {
  const path = tmpFile("teams.yaml", YAML);
  const teams: Team[] = [{
    id: "alpha", name: "Alpha",
    orchestrator: { model: "opus", prompt: "PLAN" },
    agents: [{ id: "engineer", name: "Nova", role: "Engineer", model: "sonnet" }],
  }];
  return { path, store: new RosterStore(teams, path) };
}

describe("RosterStore", () => {
  it("updates an agent's name/role in memory and on disk", () => {
    const { path, store } = make();
    store.updateAgent("alpha", "engineer", { name: "Atlas", role: "Staff engineer" });
    expect(store.getTeam("alpha")!.agents[0].name).toBe("Atlas");
    const raw = yaml.load(readFileSync(path, "utf8")) as any;
    expect(raw.teams[0].agents[0].role).toBe("Staff engineer");
  });

  it("adds an agent and rejects duplicate ids", () => {
    const { store } = make();
    const a = store.addAgent("alpha", { id: "tester", role: "QA" });
    expect(a.name).toBe("tester");             // defaults to id
    expect(store.getTeam("alpha")!.agents).toHaveLength(2);
    expect(() => store.addAgent("alpha", { id: "engineer", role: "x" }))
      .toThrowError(/duplicate/i);
  });

  it("adds a team with a default orchestrator and rejects duplicate team ids", () => {
    const { store } = make();
    const t = store.addTeam({ id: "beta", name: "Beta" });
    expect(t.orchestrator.prompt).toMatch(/assign/i);
    expect(t.agents).toEqual([]);
    expect(() => store.addTeam({ id: "alpha", name: "X" })).toThrowError(/duplicate/i);
  });

  it("throws HttpError(404) for unknown team/agent", () => {
    const { store } = make();
    try { store.updateAgent("ghost", "x", { name: "y" }); }
    catch (e) { expect((e as HttpError).status).toBe(404); }
    expect.assertions(1);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** — module not found.

- [ ] **Step 3: Write `src/rosterStore.ts`**

```ts
import type { Team, AgentDef } from "./types.js";
import { writeConfig } from "./configWriter.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const DEFAULT_ORCHESTRATOR = {
  model: "opus",
  prompt:
    "You are the team lead. Break the task into subtasks and assign each to exactly one " +
    'agent by id. Respond ONLY with a fenced ```json block: ' +
    '{"assignments":[{"agent":"<id>","subtask":"<text>"}]}.',
};

export class RosterStore {
  constructor(private teams: Team[], private configPath: string | null) {}

  getTeams(): Team[] { return this.teams; }
  getTeam(id: string): Team | undefined { return this.teams.find((t) => t.id === id); }

  updateAgent(teamId: string, agentId: string, patch: { name?: string; role?: string }): AgentDef {
    const team = this.requireTeam(teamId);
    const agent = team.agents.find((a) => a.id === agentId);
    if (!agent) throw new HttpError(404, `no such agent ${agentId}`);
    const prev = { name: agent.name, role: agent.role };
    if (patch.name !== undefined) agent.name = patch.name;
    if (patch.role !== undefined) agent.role = patch.role;
    this.persist(() => { agent.name = prev.name; agent.role = prev.role; });
    return agent;
  }

  addAgent(teamId: string, def: { id: string; role: string; name?: string }): AgentDef {
    const team = this.requireTeam(teamId);
    if (team.agents.some((a) => a.id === def.id)) throw new HttpError(409, `duplicate agent id ${def.id}`);
    const agent: AgentDef = { id: def.id, name: def.name ?? def.id, role: def.role, model: "sonnet" };
    team.agents.push(agent);
    this.persist(() => { team.agents.pop(); });
    return agent;
  }

  addTeam(def: { id: string; name: string }): Team {
    if (this.teams.some((t) => t.id === def.id)) throw new HttpError(409, `duplicate team id ${def.id}`);
    const team: Team = { id: def.id, name: def.name, orchestrator: { ...DEFAULT_ORCHESTRATOR }, agents: [] };
    this.teams.push(team);
    this.persist(() => { this.teams.pop(); });
    return team;
  }

  private requireTeam(teamId: string): Team {
    const t = this.getTeam(teamId);
    if (!t) throw new HttpError(404, `no such team ${teamId}`);
    return t;
  }

  // Persist to disk; if the write fails, run `rollback` so memory matches disk, then rethrow.
  private persist(rollback: () => void): void {
    if (!this.configPath) return;
    try { writeConfig(this.configPath, this.teams); }
    catch (err) { rollback(); throw new HttpError(500, `failed to persist config: ${String(err)}`); }
  }
}
```

- [ ] **Step 4: Run it, confirm PASS** — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/rosterStore.ts test/rosterStore.test.ts
git commit -m "feat: add RosterStore for live mutable teams with yaml persistence"
```

---

## Task 4: `EventStore.listJobs()`

**Files:** Modify `src/eventStore.ts`, `test/eventStore.test.ts`

- [ ] **Step 1: Add failing test** — append inside the `describe("EventStore", …)` block of `test/eventStore.test.ts`:

```ts
  it("lists jobs newest-first", () => {
    const s = store();
    const a = s.createJob({ teamId: "alpha", task: "first" });
    const b = s.createJob({ teamId: "beta", task: "second" });
    const ids = s.listJobs().map((j) => j.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(ids[0]).toBe(b.id); // newest first
  });
```

- [ ] **Step 2: Run it, confirm FAIL** — `listJobs` is not a function.

- [ ] **Step 3: Modify `src/eventStore.ts`** — add `readdirSync` to the `node:fs` import, and add this method to the `EventStore` class (after `readEvents`):

```ts
  listJobs(): JobRecord[] {
    const dir = join(this.root, "jobs");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((id) => this.readRecord(id))
      .filter((r): r is JobRecord => r !== null)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
```

Update the import line to: `import { mkdirSync, appendFileSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";`

- [ ] **Step 4: Run it, confirm PASS** — `npx vitest run test/eventStore.test.ts` → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/eventStore.ts test/eventStore.test.ts
git commit -m "feat: add EventStore.listJobs"
```

---

## Task 5: Wire RosterStore + roster routes + GET /api/jobs into the server

**Files:** Modify `src/server.ts`, `test/api.test.ts`

- [ ] **Step 1: Add failing tests** — append these inside the `describe("api", …)` block of `test/api.test.ts` (the existing helper `server()` and `cfg` stay). Add a login helper usage inline:

```ts
  it("updates an agent's persona (auth-gated, persisted shape)", async () => {
    const app = server();
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "pw" } });
    const cookie = login.cookies[0];
    const res = await app.inject({
      method: "PATCH", url: "/api/teams/alpha/agents/engineer",
      cookies: { [cookie.name]: cookie.value }, payload: { name: "Nova", role: "Staff eng" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Nova");

    const teams = await app.inject({ method: "GET", url: "/api/teams", cookies: { [cookie.name]: cookie.value } });
    expect(teams.json()[0].agents[0].role).toBe("Staff eng");
    await app.close();
  });

  it("adds an agent and a team", async () => {
    const app = server();
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "pw" } });
    const cookie = login.cookies[0];
    const a = await app.inject({ method: "POST", url: "/api/teams/alpha/agents",
      cookies: { [cookie.name]: cookie.value }, payload: { id: "tester", role: "QA" } });
    expect(a.statusCode).toBe(200);
    const t = await app.inject({ method: "POST", url: "/api/teams",
      cookies: { [cookie.name]: cookie.value }, payload: { id: "beta", name: "Beta" } });
    expect(t.statusCode).toBe(200);
    expect(t.json().id).toBe("beta");
    await app.close();
  });

  it("rejects duplicate agent id with 409", async () => {
    const app = server();
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "pw" } });
    const cookie = login.cookies[0];
    const res = await app.inject({ method: "POST", url: "/api/teams/alpha/agents",
      cookies: { [cookie.name]: cookie.value }, payload: { id: "engineer", role: "x" } });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it("lists jobs (auth-gated)", async () => {
    const app = server();
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "pw" } });
    const cookie = login.cookies[0];
    await app.inject({ method: "POST", url: "/api/teams/alpha/tasks",
      cookies: { [cookie.name]: cookie.value }, payload: { task: "build" } });
    const res = await app.inject({ method: "GET", url: "/api/jobs", cookies: { [cookie.name]: cookie.value } });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    await app.close();
  });
```

Note: tests pass `configPath` undefined (via the existing `server()` helper). With no configPath, `RosterStore` mutates memory but skips disk writes — exactly what these tests assert.

- [ ] **Step 2: Run it, confirm FAIL** — new routes 404.

- [ ] **Step 3: Replace `src/server.ts`** with this full version (adds RosterStore, roster routes, jobs route, HttpError mapping; everything else preserved including the v1 fixes):

```ts
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fstatic from "@fastify/static";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import type { Config } from "./types.js";
import { EventStore } from "./eventStore.js";
import { Dispatcher } from "./dispatcher.js";
import { AuthStore } from "./auth.js";
import { RosterStore, HttpError } from "./rosterStore.js";

export interface ServerDeps {
  bin: string; runRoot: string; stateRoot: string; extraArgs: string[];
  webDir: string | null;
  configPath?: string;
}

const COOKIE = "ateam_sid";

export function buildServer(cfg: Config, deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new EventStore(deps.stateRoot);
  const auth = new AuthStore(cfg.auth.password);
  const roster = new RosterStore(cfg.teams, deps.configPath ?? null);
  const dispatcher = new Dispatcher(store, { bin: deps.bin, runRoot: deps.runRoot, extraArgs: deps.extraArgs });

  app.register(websocket);

  function sid(req: any): string | undefined {
    const raw = req.headers.cookie?.split(";").map((s: string) => s.trim())
      .find((s: string) => s.startsWith(`${COOKIE}=`));
    return raw?.slice(COOKIE.length + 1);
  }

  function fail(reply: any, err: unknown) {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    return reply.code(500).send({ error: String(err) });
  }

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.url === "/api/login") return;
    if (!auth.valid(sid(req))) return reply.code(401).send({ error: "unauthorized" });
  });

  app.post("/api/login", async (req, reply) => {
    const pw = (req.body as any)?.password ?? "";
    const id = auth.login(pw);
    if (!id) return reply.code(401).send({ error: "bad password" });
    reply.header("set-cookie", `${COOKIE}=${id}; HttpOnly; Path=/; SameSite=Lax`).send({ ok: true });
  });

  app.post("/api/logout", async (req, reply) => { const s = sid(req); if (s) auth.logout(s); reply.send({ ok: true }); });

  app.get("/api/teams", async () => roster.getTeams());

  app.post("/api/teams/:teamId/tasks", async (req, reply) => {
    const { teamId } = req.params as any;
    const { task, agent } = (req.body as any) ?? {};
    const team = roster.getTeam(teamId);
    if (!team) return reply.code(404).send({ error: "no such team" });
    const p = agent ? dispatcher.runDirect(team, agent, task) : dispatcher.dispatch(team, task);
    const job = await p.catch(() => null);
    reply.send({ jobId: job?.id ?? null });
  });

  // --- roster mutation (live + persisted) ---
  app.patch("/api/teams/:teamId/agents/:agentId", async (req, reply) => {
    const { teamId, agentId } = req.params as any;
    const { name, role } = (req.body as any) ?? {};
    try { reply.send(roster.updateAgent(teamId, agentId, { name, role })); }
    catch (e) { fail(reply, e); }
  });

  app.post("/api/teams/:teamId/agents", async (req, reply) => {
    const { teamId } = req.params as any;
    const { id, role, name } = (req.body as any) ?? {};
    if (!id || !role) return reply.code(400).send({ error: "id and role required" });
    try { reply.send(roster.addAgent(teamId, { id, role, name })); }
    catch (e) { fail(reply, e); }
  });

  app.post("/api/teams", async (req, reply) => {
    const { id, name } = (req.body as any) ?? {};
    if (!id || !name) return reply.code(400).send({ error: "id and name required" });
    try { reply.send(roster.addTeam({ id, name })); }
    catch (e) { fail(reply, e); }
  });

  app.get("/api/jobs", async (req) => {
    const { agent, team } = (req.query as any) ?? {};
    let jobs = store.listJobs();
    if (team) jobs = jobs.filter((j) => j.teamId === team);
    if (agent) jobs = jobs.filter((j) => j.target === agent || store.readEvents(j.id).some((e) => e.agentId === agent));
    return jobs.slice(0, 50);
  });

  // --- config editor (kept from v1) ---
  app.get("/api/config", async () => {
    if (!deps.configPath || !existsSync(deps.configPath)) return { content: "" };
    return { content: readFileSync(deps.configPath, "utf8") };
  });
  app.post("/api/config", async (req, reply) => {
    if (!deps.configPath) return reply.code(400).send({ error: "no config path" });
    writeFileSync(deps.configPath, (req.body as any)?.content ?? "");
    reply.send({ ok: true, note: "restart to apply" });
  });

  app.register(async (scope) => {
    scope.get("/ws", { websocket: true }, (socket, req) => {
      if (!auth.valid(sid(req))) { socket.close(); return; }
      const off = store.onEvent((e) => { try { socket.send(JSON.stringify(e)); } catch {} });
      socket.on("close", off);
      socket.on("error", off);
    });
  });

  if (deps.webDir) {
    app.register(fstatic, { root: deps.webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
      reply.sendFile("index.html");
    });
  }

  return app;
}
```

- [ ] **Step 4: Run the full suite, confirm PASS** — `npx vitest run` → all green (v1 tests + new roster/jobs tests, ~28 total).

- [ ] **Step 5: Commit**

```bash
git add src/server.ts test/api.test.ts
git commit -m "feat: roster mutation routes, GET /api/jobs, live RosterStore in server"
```

---

## Task 6: Web test runner + rewritten types & api client

**Files:** Modify `web/package.json`; Create `web/vitest.config.ts`; Rewrite `web/src/types.ts`, `web/src/api.ts`

- [ ] **Step 1: Modify `web/package.json`** — add a test script and vitest devDep. Set `scripts` and `devDependencies` to:

```json
  "scripts": { "dev": "vite", "build": "tsc -b && vite build", "preview": "vite preview", "test": "vitest run" },
```
and add to `devDependencies`: `"vitest": "^2.1.0"` (keep the existing entries).

- [ ] **Step 2: Create `web/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["src/**/*.test.ts"] } });
```

- [ ] **Step 3: Install** — Run: `cd web && npm install` → installs vitest.

- [ ] **Step 4: Rewrite `web/src/types.ts`**

```ts
export interface AgentDef { id: string; name?: string; role: string; model?: string; }
export interface Team { id: string; name: string; orchestrator: { model?: string; prompt: string }; agents: AgentDef[]; }

export type EventType =
  | "job.created" | "plan.ready" | "agent.started" | "agent.output"
  | "agent.done" | "agent.error" | "chat.message" | "job.done";
export interface Event { ts: number; jobId: string; teamId: string; agentId?: string; type: EventType; payload: any; }

export interface JobRecord { id: string; teamId: string; task: string; target?: string; createdAt: number; status: "running" | "done" | "error"; }
export type AgentStatus = "idle" | "running" | "error";
```

- [ ] **Step 5: Rewrite `web/src/api.ts`**

```ts
import type { Team, Event, AgentDef, JobRecord } from "./types.js";

async function jpost(url: string, body: unknown) {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export async function login(password: string): Promise<boolean> {
  return (await jpost("/api/login", { password })).ok;
}
export async function fetchTeams(): Promise<Team[]> {
  const r = await fetch("/api/teams");
  if (!r.ok) throw new Error("unauthorized");
  return r.json();
}
export async function assign(teamId: string, task: string, agent?: string): Promise<string | null> {
  const r = await jpost(`/api/teams/${teamId}/tasks`, { task, agent });
  return (await r.json()).jobId ?? null;
}
export async function updateAgent(teamId: string, agentId: string, patch: { name?: string; role?: string }): Promise<AgentDef> {
  const r = await fetch(`/api/teams/${teamId}/agents/${agentId}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
  });
  return r.json();
}
export async function addAgent(teamId: string, def: { id: string; role: string; name?: string }): Promise<AgentDef> {
  return (await jpost(`/api/teams/${teamId}/agents`, def)).json();
}
export async function addTeam(def: { id: string; name: string }): Promise<Team> {
  return (await jpost("/api/teams", def)).json();
}
export async function fetchJobs(agent?: string): Promise<JobRecord[]> {
  const q = agent ? `?agent=${encodeURIComponent(agent)}` : "";
  return (await fetch(`/api/jobs${q}`)).json();
}
export function connectEvents(onEvent: (e: Event) => void): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (m) => onEvent(JSON.parse(m.data));
  return ws;
}
```

- [ ] **Step 6: Commit**

```bash
git add web/package.json web/vitest.config.ts web/src/types.ts web/src/api.ts
git commit -m "feat(web): add vitest, rewrite types and api client for v2"
```

---

## Task 7: World reducer (event → per-agent status/output/history)

**Files:** Create `web/src/world/store.ts`, `web/src/world/store.test.ts`

- [ ] **Step 1: Write failing test `web/src/world/store.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { emptyWorld, applyEvent, agentKey, type WorldState } from "./store.js";
import type { Event } from "../types.js";

const ev = (p: Partial<Event>): Event => ({ ts: 1, jobId: "j1", teamId: "alpha", type: "agent.started", payload: {}, ...p });

describe("world reducer", () => {
  it("marks an agent running on agent.started and idle on agent.done", () => {
    let s: WorldState = emptyWorld();
    s = applyEvent(s, ev({ type: "agent.started", agentId: "eng" }));
    expect(s.agents[agentKey("alpha", "eng")].status).toBe("running");
    s = applyEvent(s, ev({ type: "agent.output", agentId: "eng", payload: { chunk: "hello" } }));
    expect(s.agents[agentKey("alpha", "eng")].output).toContain("hello");
    s = applyEvent(s, ev({ type: "agent.done", agentId: "eng", payload: { text: "final" } }));
    const a = s.agents[agentKey("alpha", "eng")];
    expect(a.status).toBe("idle");
    expect(a.history[0].text).toBe("final");
    expect(a.currentJob).toBeUndefined();
  });

  it("marks error on agent.error", () => {
    let s = emptyWorld();
    s = applyEvent(s, ev({ type: "agent.started", agentId: "eng" }));
    s = applyEvent(s, ev({ type: "agent.error", agentId: "eng", payload: { code: 3 } }));
    expect(s.agents[agentKey("alpha", "eng")].status).toBe("error");
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** — module not found.

- [ ] **Step 3: Write `web/src/world/store.ts`**

```ts
import type { Event, AgentStatus } from "../types.js";

export interface AgentLog {
  status: AgentStatus;
  currentJob?: string;
  output: string;                                    // live streamed text of the current job
  history: { jobId: string; status: string; text: string }[];
}
export interface WorldState { agents: Record<string, AgentLog>; }

export function agentKey(teamId: string, agentId: string): string { return `${teamId}/${agentId}`; }
export function emptyWorld(): WorldState { return { agents: {} }; }
function blank(): AgentLog { return { status: "idle", output: "", history: [] }; }

export function applyEvent(state: WorldState, e: Event): WorldState {
  if (!e.agentId) return state;
  const key = agentKey(e.teamId, e.agentId);
  const agents = { ...state.agents };
  const a: AgentLog = { ...(agents[key] ?? blank()) };

  switch (e.type) {
    case "agent.started":
      a.status = "running"; a.currentJob = e.jobId; a.output = ""; break;
    case "agent.output":
      a.output += String(e.payload?.chunk ?? ""); break;
    case "agent.done":
      a.status = "idle";
      a.history = [{ jobId: e.jobId, status: "done", text: String(e.payload?.text ?? a.output) }, ...a.history].slice(0, 20);
      a.currentJob = undefined; break;
    case "agent.error":
      a.status = "error";
      a.history = [{ jobId: e.jobId, status: "error", text: JSON.stringify(e.payload) }, ...a.history].slice(0, 20);
      a.currentJob = undefined; break;
    default:
      return state;
  }
  agents[key] = a;
  return { agents };
}
```

- [ ] **Step 4: Run it, confirm PASS** — `cd web && npx vitest run src/world/store.test.ts` → 2 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/world/store.ts web/src/world/store.test.ts
git commit -m "feat(web): world reducer mapping events to per-agent state"
```

---

## Task 8: Zone geometry (pure layout + movement targets)

**Files:** Create `web/src/world/geometry.ts`, `web/src/world/geometry.test.ts`

- [ ] **Step 1: Write failing test `web/src/world/geometry.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { zoneRect, deskSlot, wanderPoint, inside } from "./geometry.js";

describe("geometry", () => {
  it("lays teams out in a grid of non-overlapping zones", () => {
    const r0 = zoneRect(0), r1 = zoneRect(1);
    expect(r0.w).toBeGreaterThan(0);
    expect(r0.x).not.toBe(r1.x === r0.x ? r0.y : r1.x); // different cell
  });

  it("desk slots fall inside their zone", () => {
    const slot = deskSlot(0, 2);
    expect(inside(zoneRect(0), slot)).toBe(true);
  });

  it("wander points fall inside their zone", () => {
    const z = zoneRect(0);
    for (let i = 0; i < 20; i++) expect(inside(z, wanderPoint(0, () => 0.5))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** — module not found.

- [ ] **Step 3: Write `web/src/world/geometry.ts`**

```ts
export interface Rect { x: number; y: number; w: number; h: number; }
export interface Pt { x: number; y: number; }

const ZONE_W = 320, ZONE_H = 240, GAP = 24, COLS = 2, PAD = 28;

// Zone i is placed in a 2-column grid.
export function zoneRect(i: number): Rect {
  const col = i % COLS, row = Math.floor(i / COLS);
  return { x: GAP + col * (ZONE_W + GAP), y: GAP + row * (ZONE_H + GAP), w: ZONE_W, h: ZONE_H };
}

// A stable desk position for agent index `j` inside zone `i` (row of desks near the bottom).
export function deskSlot(i: number, j: number): Pt {
  const z = zoneRect(i);
  const perRow = 3;
  const col = j % perRow, row = Math.floor(j / perRow);
  return { x: z.x + PAD + col * 90, y: z.y + z.h - PAD - 24 - row * 56 };
}

// A random point well inside zone `i`. `rng` defaults to Math.random; injectable for tests.
export function wanderPoint(i: number, rng: () => number = Math.random): Pt {
  const z = zoneRect(i);
  return { x: z.x + PAD + rng() * (z.w - 2 * PAD), y: z.y + PAD + rng() * (z.h - 2 * PAD) };
}

export function inside(z: Rect, p: Pt): boolean {
  return p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;
}

export const FLOOR = { zoneW: ZONE_W, zoneH: ZONE_H, gap: GAP, cols: COLS };
```

- [ ] **Step 4: Run it, confirm PASS** — `cd web && npx vitest run src/world/geometry.test.ts` → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add web/src/world/geometry.ts web/src/world/geometry.test.ts
git commit -m "feat(web): zone geometry and movement-target math"
```

---

## Task 9: Movement hook + Avatar + Zone + Floor

**Files:** Create `web/src/world/useMovement.ts`, `web/src/world/Avatar.tsx`, `web/src/world/Zone.tsx`, `web/src/world/Floor.tsx`

- [ ] **Step 1: Write `web/src/world/useMovement.ts`**

```ts
import { useEffect, useRef, useState } from "react";
import type { Team, AgentStatus } from "../types.js";
import { deskSlot, wanderPoint, type Pt } from "./geometry.js";

export interface Placed { key: string; teamIndex: number; agentIndex: number; pos: Pt; }

// Computes a live position per agent. Idle agents re-pick a wander target every few seconds;
// running agents target their desk. Positions ease toward targets each tick.
export function useMovement(
  teams: Team[],
  statusOf: (teamId: string, agentId: string) => AgentStatus,
): Record<string, Pt> {
  const [positions, setPositions] = useState<Record<string, Pt>>({});
  const targets = useRef<Record<string, Pt>>({});
  const nextWander = useRef<Record<string, number>>({});

  useEffect(() => {
    let raf = 0; let last = 0;
    const tick = (t: number) => {
      if (t - last > 120) {                                  // ~8 fps update is plenty
        last = t;
        const pos: Record<string, Pt> = { ...positionsRef.current };
        teams.forEach((team, ti) => {
          team.agents.forEach((ag, ai) => {
            const key = `${team.id}/${ag.id}`;
            const status = statusOf(team.id, ag.id);
            if (!pos[key]) pos[key] = wanderPoint(ti);
            if (status === "running") {
              targets.current[key] = deskSlot(ti, ai);
            } else if (!targets.current[key] || t > (nextWander.current[key] ?? 0)) {
              targets.current[key] = wanderPoint(ti);
              nextWander.current[key] = t + 2500 + Math.floor((ai + 1) * 700);
            }
            const tg = targets.current[key];
            pos[key] = { x: pos[key].x + (tg.x - pos[key].x) * 0.12, y: pos[key].y + (tg.y - pos[key].y) * 0.12 };
          });
        });
        positionsRef.current = pos;
        setPositions(pos);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [teams, statusOf]);

  const positionsRef = useRef<Record<string, Pt>>({});
  positionsRef.current = positions;
  return positions;
}
```

Note: `positionsRef` is declared after the effect for readability but hoisted by JS; if your linter objects, move the two `positionsRef` lines above the `useEffect`. Behaviour is identical.

- [ ] **Step 2: Write `web/src/world/Avatar.tsx`**

```tsx
import type { AgentDef, AgentStatus } from "../types.js";
import type { Pt } from "./geometry.js";

const bodyColors = ["#2563eb", "#16a34a", "#9333ea", "#0891b2", "#db2777", "#ca8a04"];
const badge: Record<AgentStatus, string> = { idle: "transparent", running: "#22c55e", error: "#ef4444" };

export function Avatar({ agent, index, pos, status, selected, onClick }: {
  agent: AgentDef; index: number; pos: Pt; status: AgentStatus; selected: boolean; onClick: () => void;
}) {
  const name = agent.name ?? agent.id;
  return (
    <div onClick={onClick}
      style={{ position: "absolute", left: pos.x, top: pos.y, transform: "translate(-50%,-50%)",
        transition: "left .25s linear, top .25s linear", cursor: "pointer", textAlign: "center",
        outline: selected ? "2px solid #38bdf8" : "none", outlineOffset: 3, borderRadius: 4 }}>
      <div style={{ position: "relative", width: 14, margin: "0 auto",
        animation: status === "running" ? "ateam-bob .6s ease-in-out infinite" : undefined }}>
        <div style={{ width: 9, height: 9, margin: "0 auto", borderRadius: 2, background: "#fcd34d" }} />
        <div style={{ width: 14, height: 9, marginTop: 1, borderRadius: 2, background: bodyColors[index % bodyColors.length] }} />
        <span style={{ position: "absolute", top: -4, right: -4, width: 7, height: 7, borderRadius: "50%", background: badge[status] }} />
        {status === "running" && <span style={{ position: "absolute", top: -14, left: 2, fontSize: 9 }}>✎</span>}
      </div>
      <div style={{ fontSize: 8, color: "#e2e8f0", marginTop: 1, whiteSpace: "nowrap" }}>{name}</div>
    </div>
  );
}
```

- [ ] **Step 3: Write `web/src/world/Zone.tsx`**

```tsx
import type { Team } from "../types.js";
import { zoneRect } from "./geometry.js";

export function Zone({ team, index, onLeaderClick }: { team: Team; index: number; onLeaderClick: () => void }) {
  const z = zoneRect(index);
  return (
    <>
      <div style={{ position: "absolute", left: z.x, top: z.y, width: z.w, height: z.h,
        border: "2px solid #b08968", background: "#6b4f3a30", borderRadius: 6 }} />
      <div onClick={onLeaderClick} title="Assign work to this team"
        style={{ position: "absolute", left: z.x + 8, top: z.y + 6, fontSize: 10, color: "#fde68a",
          background: "#0008", padding: "2px 7px", borderRadius: 4, cursor: "pointer" }}>
        🧭 {team.name}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Write `web/src/world/Floor.tsx`**

```tsx
import type { Team, AgentStatus } from "../types.js";
import type { Pt } from "./geometry.js";
import { zoneRect, FLOOR } from "./geometry.js";
import { Zone } from "./Zone.js";
import { Avatar } from "./Avatar.js";

export function Floor({ teams, positions, statusOf, selectedKey, onSelectAgent, onSelectLeader, onAddTeam, onAddAgent }: {
  teams: Team[];
  positions: Record<string, Pt>;
  statusOf: (teamId: string, agentId: string) => AgentStatus;
  selectedKey: string | null;
  onSelectAgent: (teamId: string, agentId: string) => void;
  onSelectLeader: (teamId: string) => void;
  onAddTeam: () => void;
  onAddAgent: (teamId: string) => void;
}) {
  const rows = Math.ceil((teams.length + 1) / FLOOR.cols);
  const width = FLOOR.cols * (FLOOR.zoneW + FLOOR.gap) + FLOOR.gap;
  const height = rows * (FLOOR.zoneH + FLOOR.gap) + FLOOR.gap;
  const addRect = zoneRect(teams.length);

  return (
    <div style={{ position: "relative", width, height, margin: "0 auto",
      background: "#3b4a63", backgroundImage:
        "linear-gradient(#ffffff10 1px,transparent 1px),linear-gradient(90deg,#ffffff10 1px,transparent 1px)",
      backgroundSize: "20px 20px", borderRadius: 10 }}>
      {teams.map((team, ti) => (
        <div key={team.id}>
          <Zone team={team} index={ti} onLeaderClick={() => onSelectLeader(team.id)} />
          <div onClick={() => onAddAgent(team.id)}
            style={{ position: "absolute", left: zoneRect(ti).x + 8, top: zoneRect(ti).y + zoneRect(ti).h - 22,
              fontSize: 9, color: "#cbd5e1", cursor: "pointer" }}>＋ add agent</div>
          {team.agents.map((ag, ai) => {
            const key = `${team.id}/${ag.id}`;
            const pos = positions[key] ?? { x: zoneRect(ti).x + 40, y: zoneRect(ti).y + 40 };
            return <Avatar key={ag.id} agent={ag} index={ai} pos={pos} status={statusOf(team.id, ag.id)}
              selected={selectedKey === key} onClick={() => onSelectAgent(team.id, ag.id)} />;
          })}
        </div>
      ))}
      <div onClick={onAddTeam}
        style={{ position: "absolute", left: addRect.x, top: addRect.y, width: addRect.w, height: addRect.h,
          border: "2px dashed #64748b", borderRadius: 6, display: "grid", placeItems: "center",
          color: "#94a3b8", cursor: "pointer" }}>＋ Add team</div>
    </div>
  );
}
```

- [ ] **Step 5: Build to type-check** — Run: `cd web && npx tsc -b` → no errors. (Floor/Avatar/Zone unused-warnings resolve once App imports them in Task 11; tsc with `noEmit` only errors on real type problems.) If `tsc` reports the `positionsRef` hoist ordering as a use-before-declaration error, move the two `positionsRef` lines above the `useEffect` in `useMovement.ts`.

- [ ] **Step 6: Commit**

```bash
git add web/src/world/useMovement.ts web/src/world/Avatar.tsx web/src/world/Zone.tsx web/src/world/Floor.tsx
git commit -m "feat(web): movement hook and pixel floor/zone/avatar components"
```

---

## Task 10: Panels (agent inspect, leader assign, add dialogs)

**Files:** Create `web/src/panels/AgentPanel.tsx`, `web/src/panels/LeaderPanel.tsx`, `web/src/panels/AddDialogs.tsx`

- [ ] **Step 1: Write `web/src/panels/AgentPanel.tsx`**

```tsx
import { useEffect, useState } from "react";
import type { AgentDef, AgentStatus } from "../types.js";
import type { AgentLog } from "../world/store.js";
import { assign, updateAgent } from "../api.js";

const pill: Record<AgentStatus, string> = { idle: "#334155", running: "#14532d", error: "#7f1d1d" };

export function AgentPanel({ teamId, agent, status, log, onClose, onSaved }: {
  teamId: string; agent: AgentDef; status: AgentStatus; log: AgentLog;
  onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(agent.name ?? agent.id);
  const [role, setRole] = useState(agent.role);
  const [msg, setMsg] = useState("");
  useEffect(() => { setName(agent.name ?? agent.id); setRole(agent.role); }, [agent.id]);

  async function save() { await updateAgent(teamId, agent.id, { name, role }); onSaved(); }
  async function send() { if (!msg.trim()) return; await assign(teamId, msg, agent.id); setMsg(""); }

  return (
    <div style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b>{agent.name ?? agent.id}</b>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 99, background: pill[status], color: "#e2e8f0" }}>● {status}</span>
          <button onClick={onClose} style={btnGhost}>✕</button>
        </span>
      </div>
      <div style={{ fontSize: 10, color: "#64748b", margin: "2px 0 10px" }}>{teamId} · {agent.id}</div>

      <Label>Name</Label>
      <input style={inp} value={name} onChange={(e) => setName(e.target.value)} />
      <Label>Persona / role prompt</Label>
      <textarea style={{ ...inp, minHeight: 56 }} value={role} onChange={(e) => setRole(e.target.value)} />
      <button onClick={save} style={btn}>Save persona</button>

      <Label>Direct message / assign job</Label>
      <input style={inp} value={msg} placeholder="tell this agent to do something…"
        onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
      <button onClick={send} style={{ ...btn, background: "#16a34a" }}>Assign to {agent.id}</button>

      <Label>Running job</Label>
      {log.currentJob
        ? <pre style={out}>{log.output || "…"}</pre>
        : <div style={{ fontSize: 11, color: "#64748b" }}>idle</div>}
      <Label>History</Label>
      {log.history.length === 0 && <div style={{ fontSize: 11, color: "#64748b" }}>none yet</div>}
      {log.history.map((h, i) => (
        <div key={i} style={{ fontSize: 11, color: h.status === "error" ? "#f87171" : "#cbd5e1",
          borderTop: "1px solid #1e293b", padding: "4px 0" }}>
          {h.status === "error" ? "✕" : "✓"} {h.text.slice(0, 120)}
        </div>
      ))}
    </div>
  );
}

function Label({ children }: { children: string }) {
  return <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".05em", color: "#64748b", margin: "10px 0 3px" }}>{children}</div>;
}
const panel: React.CSSProperties = { position: "fixed", right: 12, top: 12, bottom: 12, width: 320, overflow: "auto", background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: 12, color: "#e2e8f0", fontSize: 12 };
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#1e293b", border: "1px solid #475569", borderRadius: 5, padding: "5px 7px", color: "#e2e8f0", fontFamily: "inherit" };
const btn: React.CSSProperties = { marginTop: 6, background: "#1d4ed8", color: "#fff", border: 0, borderRadius: 5, padding: "5px 10px", cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "transparent", color: "#94a3b8", border: 0, cursor: "pointer", fontSize: 14 };
const out: React.CSSProperties = { background: "#0b1220", borderRadius: 6, padding: 6, fontSize: 10, color: "#86efac", whiteSpace: "pre-wrap", maxHeight: 140, overflow: "auto" };
```

- [ ] **Step 2: Write `web/src/panels/LeaderPanel.tsx`**

```tsx
import { useState } from "react";
import type { Team } from "../types.js";
import { assign } from "../api.js";

export function LeaderPanel({ team, onClose }: { team: Team; onClose: () => void }) {
  const [task, setTask] = useState("");
  async function send() { if (!task.trim()) return; await assign(team.id, task); setTask(""); onClose(); }
  return (
    <div style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <b>🧭 {team.name} — team lead</b>
        <button onClick={onClose} style={{ background: "transparent", color: "#94a3b8", border: 0, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ fontSize: 11, color: "#64748b", margin: "6px 0" }}>
        Assign a task to the whole team. The lead plans it and delegates to {team.agents.length} agent(s).
      </div>
      <textarea style={ta} value={task} placeholder="what should the team build?"
        onChange={(e) => setTask(e.target.value)} />
      <button onClick={send} style={{ background: "#16a34a", color: "#fff", border: 0, borderRadius: 5, padding: "6px 12px", cursor: "pointer" }}>Assign to team</button>
    </div>
  );
}
const panel: React.CSSProperties = { position: "fixed", right: 12, top: 12, width: 320, background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: 12, color: "#e2e8f0" };
const ta: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 70, background: "#1e293b", border: "1px solid #475569", borderRadius: 5, padding: 7, color: "#e2e8f0", marginBottom: 6, fontFamily: "inherit" };
```

- [ ] **Step 3: Write `web/src/panels/AddDialogs.tsx`**

```tsx
import { useState } from "react";
import { addAgent, addTeam } from "../api.js";

export function AddTeamDialog({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [id, setId] = useState(""); const [name, setName] = useState(""); const [err, setErr] = useState("");
  async function go() {
    const r = await addTeam({ id: id.trim(), name: name.trim() || id.trim() });
    if ((r as any).error) { setErr((r as any).error); return; }
    onDone();
  }
  return <Modal title="Add team" err={err} onCancel={onCancel} onOk={go}>
    <Field v={id} set={setId} ph="team id (e.g. data)" />
    <Field v={name} set={setName} ph="display name" />
  </Modal>;
}

export function AddAgentDialog({ teamId, onDone, onCancel }: { teamId: string; onDone: () => void; onCancel: () => void }) {
  const [id, setId] = useState(""); const [role, setRole] = useState(""); const [err, setErr] = useState("");
  async function go() {
    const r = await addAgent(teamId, { id: id.trim(), role: role.trim() || "Agent" });
    if ((r as any).error) { setErr((r as any).error); return; }
    onDone();
  }
  return <Modal title={`Add agent to ${teamId}`} err={err} onCancel={onCancel} onOk={go}>
    <Field v={id} set={setId} ph="agent id (e.g. analyst)" />
    <Field v={role} set={setRole} ph="persona / role" />
  </Modal>;
}

function Field({ v, set, ph }: { v: string; set: (s: string) => void; ph: string }) {
  return <input value={v} placeholder={ph} onChange={(e) => set(e.target.value)}
    style={{ width: "100%", boxSizing: "border-box", margin: "4px 0", background: "#1e293b", border: "1px solid #475569", borderRadius: 5, padding: "6px 8px", color: "#e2e8f0" }} />;
}
function Modal({ title, children, err, onCancel, onOk }: { title: string; children: React.ReactNode; err: string; onCancel: () => void; onOk: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", display: "grid", placeItems: "center" }}>
      <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: 16, width: 300, color: "#e2e8f0" }}>
        <b>{title}</b>
        <div style={{ margin: "10px 0" }}>{children}</div>
        {err && <div style={{ color: "#f87171", fontSize: 11, marginBottom: 6 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ background: "#334155", color: "#e2e8f0", border: 0, borderRadius: 5, padding: "5px 10px", cursor: "pointer" }}>Cancel</button>
          <button onClick={onOk} style={{ background: "#1d4ed8", color: "#fff", border: 0, borderRadius: 5, padding: "5px 10px", cursor: "pointer" }}>Add</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type-check** — `cd web && npx tsc -b` → no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/panels
git commit -m "feat(web): agent inspect, leader assign, and add dialogs"
```

---

## Task 11: App shell wiring + global animation CSS

**Files:** Rewrite `web/src/App.tsx`; Create `web/src/world.css`; Modify `web/src/main.tsx`

- [ ] **Step 1: Create `web/src/world.css`** (the bob keyframe used by Avatar)

```css
@keyframes ateam-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
body { margin: 0; background: #020617; }
```

- [ ] **Step 2: Modify `web/src/main.tsx`** — add the css import as the first import line:

```tsx
import "./world.css";
```
(keep the rest of the file unchanged)

- [ ] **Step 3: Rewrite `web/src/App.tsx`**

```tsx
import { useCallback, useEffect, useReducer, useState } from "react";
import type { Team, Event, AgentStatus } from "./types.js";
import { fetchTeams, fetchJobs, connectEvents } from "./api.js";
import { applyEvent, emptyWorld, agentKey, type WorldState } from "./world/store.js";
import { useMovement } from "./world/useMovement.js";
import { Floor } from "./world/Floor.js";
import { AgentPanel } from "./panels/AgentPanel.js";
import { LeaderPanel } from "./panels/LeaderPanel.js";
import { AddTeamDialog, AddAgentDialog } from "./panels/AddDialogs.js";
import { Login } from "./Login.js";

type Sel = { kind: "agent"; teamId: string; agentId: string } | { kind: "leader"; teamId: string } | null;
type Dlg = { kind: "team" } | { kind: "agent"; teamId: string } | null;

function reducer(s: WorldState, e: Event): WorldState { return applyEvent(s, e); }

export function App() {
  const [authed, setAuthed] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [world, dispatch] = useReducer(reducer, emptyWorld());
  const [sel, setSel] = useState<Sel>(null);
  const [dlg, setDlg] = useState<Dlg>(null);

  const reloadTeams = useCallback(() => { fetchTeams().then(setTeams).catch(() => setAuthed(false)); }, []);

  useEffect(() => {
    if (!authed) return;
    reloadTeams();
    fetchJobs().catch(() => {});           // backfill (history derives from events; this primes auth/jobs)
    const ws = connectEvents((e) => dispatch(e));
    return () => ws.close();
  }, [authed, reloadTeams]);

  const statusOf = useCallback(
    (teamId: string, agentId: string): AgentStatus => world.agents[agentKey(teamId, agentId)]?.status ?? "idle",
    [world],
  );
  const positions = useMovement(teams, statusOf);

  if (!authed) return <Login onOk={() => setAuthed(true)} />;

  const selAgent = sel?.kind === "agent"
    ? teams.find((t) => t.id === sel.teamId)?.agents.find((a) => a.id === sel.agentId) : undefined;
  const selLeaderTeam = sel?.kind === "leader" ? teams.find((t) => t.id === sel.teamId) : undefined;

  return (
    <div style={{ minHeight: "100vh", color: "#e2e8f0", padding: 12 }}>
      <h2 style={{ margin: "4px 0 12px" }}>a-team</h2>
      <Floor
        teams={teams} positions={positions} statusOf={statusOf}
        selectedKey={sel?.kind === "agent" ? agentKey(sel.teamId, sel.agentId) : null}
        onSelectAgent={(teamId, agentId) => setSel({ kind: "agent", teamId, agentId })}
        onSelectLeader={(teamId) => setSel({ kind: "leader", teamId })}
        onAddTeam={() => setDlg({ kind: "team" })}
        onAddAgent={(teamId) => setDlg({ kind: "agent", teamId })}
      />

      {selAgent && sel?.kind === "agent" && (
        <AgentPanel teamId={sel.teamId} agent={selAgent} status={statusOf(sel.teamId, selAgent.id)}
          log={world.agents[agentKey(sel.teamId, selAgent.id)] ?? { status: "idle", output: "", history: [] }}
          onClose={() => setSel(null)} onSaved={reloadTeams} />
      )}
      {selLeaderTeam && <LeaderPanel team={selLeaderTeam} onClose={() => setSel(null)} />}

      {dlg?.kind === "team" && <AddTeamDialog onDone={() => { setDlg(null); reloadTeams(); }} onCancel={() => setDlg(null)} />}
      {dlg?.kind === "agent" && <AddAgentDialog teamId={dlg.teamId} onDone={() => { setDlg(null); reloadTeams(); }} onCancel={() => setDlg(null)} />}
    </div>
  );
}
```

- [ ] **Step 4: Build** — Run: `cd web && npm run build` → `tsc -b && vite build` passes, `web/dist/` written. Fix any genuine type errors only.

- [ ] **Step 5: Commit**

```bash
git add web/src/App.tsx web/src/world.css web/src/main.tsx
git commit -m "feat(web): wire pixel-office app shell"
```

---

## Task 12: Remove dead v1 UI files

**Files:** Delete `web/src/store.ts`, `web/src/TeamPanel.tsx`, `web/src/ChatThread.tsx`, `web/src/ConfigEditor.tsx`

- [ ] **Step 1: Confirm nothing imports them** — Run: `cd web && grep -rEl "TeamPanel|ChatThread|ConfigEditor|from \"./store" src || echo "no references"`
Expected: only matches inside the files themselves (or "no references"). The new `App.tsx` imports `world/store`, not `store`.

- [ ] **Step 2: Delete the files**

```bash
git rm web/src/store.ts web/src/TeamPanel.tsx web/src/ChatThread.tsx web/src/ConfigEditor.tsx
```

- [ ] **Step 3: Rebuild to prove nothing broke** — Run: `cd web && npm run build` → passes.

- [ ] **Step 4: Run web reducer/geometry tests** — Run: `cd web && npm test` → store + geometry tests pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(web): remove v1 dashboard components superseded by the pixel office"
```

---

## Task 13: Full backend suite + manual E2E

- [ ] **Step 1: Backend suite** — Run (repo root): `npx vitest run` → all green (~28 tests).

- [ ] **Step 2: Web suite** — Run: `cd web && npm test` → store + geometry tests green.

- [ ] **Step 3: Manual E2E (real claude)**

```bash
cd web && npm run build && cd ..
# teams.yaml already exists from v1; if not: cp teams.example.yaml teams.yaml
ATEAM_PASSWORD=changeme ATEAM_CLAUDE_BIN=$(command -v claude) npm start
# open http://localhost:10000
```
Verify:
1. Login → pixel office with Team Alpha's zone and its agents wandering.
2. Click an agent → panel. Edit persona → Save. Confirm `grep -A3 'agents:' teams.yaml` shows the new role and the password line still reads `${ATEAM_PASSWORD}`.
3. In the panel, assign a job → the avatar walks to its desk, plays the working bob, streams output; on completion it returns and the result is in History.
4. Click the team lead (🧭 label) → assign a team task → orchestrator delegates; assigned agents animate.
5. ＋ Add agent → new avatar appears in the zone. ＋ Add team → new zone appears.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A && git commit -m "test: a-team v2 verified end-to-end"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** pixel office replaces dashboard (Tasks 9–12), fixed zones (Task 8 geometry + Task 9 Zone), stylized avatars (Task 9 Avatar), state-driven movement (Task 9 useMovement, statuses from Task 7 reducer), click-to-inspect with name/persona/DM/job-tracking (Task 10 AgentPanel), team-level via Leader (Task 10 LeaderPanel + Task 9 Zone leader click), in-world add (Task 10 AddDialogs + Task 9 Floor buttons + Task 5 routes), live+persisted roster (Tasks 2–3 + Task 5), password never written plaintext (Task 2). All objectives mapped.
- **Placeholder scan:** no TBD/TODO; every code step has full code.
- **Type consistency:** `AgentDef.name?`, `Team`, `Event`, `JobRecord`, `AgentStatus`, `AgentLog`, `agentKey`, `RosterStore.{getTeams,getTeam,updateAgent,addAgent,addTeam}`, `HttpError.status`, `zoneRect/deskSlot/wanderPoint/inside`, api client (`assign/updateAgent/addAgent/addTeam/fetchJobs/connectEvents`) are used consistently across backend, reducer, and components.
- **Known nuance flagged in code:** `useMovement.ts` `positionsRef` hoist note (Task 9 Step 1/Step 5) — move the ref above the effect if the linter complains. Behaviour identical either way.
- **Deferred per spec:** cross-team delegation, remove team/agent, sprite sheets, collaborate-walk — none scheduled here.
