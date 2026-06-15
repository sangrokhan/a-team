# a-team Multi-Team Agent Web Control — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node/TS backend that runs configurable teams of `claude`-CLI agents (orchestrator plans → delegates to workers, doing real work in per-task dirs) plus a React/React Flow web UI to visualize the teams live and chat with a team or a specific agent.

**Architecture:** Single Fastify backend spawns `claude -p` subprocesses per agent turn, streams an append-only event log (`.a-team/state/jobs/<id>/`) to browsers over WebSocket, and serves a built React app. A single shared password gates all routes; `teams.yaml` is editable from a settings page (restart to apply).

**Tech Stack:** Node 22 + TypeScript, Fastify + `@fastify/websocket`, `js-yaml`, Vitest (backend tests with a mock `claude` script), Vite + React + `@xyflow/react` (React Flow) for the UI.

Reference spec: `docs/superpowers/specs/2026-06-12-agent-team-web-control-design.md`

---

## File Structure

```
package.json              # backend deps + scripts
tsconfig.json
vitest.config.ts
teams.example.yaml        # sample config (committed); teams.yaml is gitignored
src/
  types.ts                # Config, Team, AgentDef, Event, Assignment, Job
  config.ts               # loadConfig(path) -> Config  (+ env expansion, validation)
  eventStore.ts           # createJob, appendEvent, readEvents, readRecord
  agentRunner.ts          # runAgent(): spawn claude, stream stdout as chunks
  orchestrator.ts         # plan(): run orchestrator agent, parse Assignment[]
  dispatcher.ts           # dispatch(): plan -> run workers -> collect ; runDirect()
  auth.ts                 # password check + in-memory session store
  server.ts               # buildServer(): Fastify routes + websocket + static
  index.ts                # entry: load config, buildServer, listen
test/
  mocks/mock-claude.mjs   # fake claude CLI (canned output keyed by prompt)
  helpers.ts              # tmpdir + config fixtures
  config.test.ts
  eventStore.test.ts
  agentRunner.test.ts
  orchestrator.test.ts
  dispatcher.test.ts
  auth.test.ts
  api.test.ts
web/                      # Vite React app (separate package.json)
  package.json
  index.html
  src/main.tsx
  src/api.ts              # REST + WS client
  src/types.ts            # mirror of backend event/team types
  src/store.ts            # event reducer -> team/agent/chat state
  src/Login.tsx
  src/App.tsx
  src/TeamPanel.tsx       # React Flow graph for one team
  src/ChatThread.tsx      # per-team chat + target selector
  src/ConfigEditor.tsx    # settings page (edit teams.yaml)
```

**Convention:** All backend modules are pure ESM TypeScript run with `tsx`/Vitest. Each module exports small, individually testable functions. `claude` binary path comes from `ATEAM_CLAUDE_BIN` env (defaults to `claude` on PATH) so tests inject the mock.

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore` (append)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "a-team",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@fastify/static": "^8.0.0",
    "@fastify/websocket": "^11.0.0",
    "fastify": "^5.0.0",
    "js-yaml": "^4.1.0"
  },
  "devDependencies": {
    "@types/js-yaml": "^4.0.9",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
```

- [ ] **Step 4: Append to `.gitignore`**

```
node_modules/
dist/
teams.yaml
.a-team/runs/
.a-team/state/
web/dist/
web/node_modules/
```

- [ ] **Step 5: Install and verify**

Run: `npm install && npx vitest run`
Expected: install succeeds; Vitest reports "No test files found" (exit 0 or "no tests"). This confirms the toolchain.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore
git commit -m "chore: scaffold a-team backend project"
```

---

## Task 1: Shared types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write `src/types.ts`**

```ts
export interface AgentDef {
  id: string;
  role: string;            // becomes the claude system prompt
  model?: string;          // e.g. "sonnet" | "opus"
}

export interface OrchestratorDef {
  model?: string;
  prompt: string;
}

export interface Team {
  id: string;
  name: string;
  orchestrator: OrchestratorDef;
  agents: AgentDef[];
}

export interface ServerConfig {
  host: string;
  port: number;
}

export interface AuthConfig {
  password: string;
}

export interface Config {
  auth: AuthConfig;
  server: ServerConfig;
  teams: Team[];
}

export type EventType =
  | "job.created" | "plan.ready" | "agent.started" | "agent.output"
  | "agent.done" | "agent.error" | "chat.message" | "job.done";

export interface Event {
  ts: number;
  jobId: string;
  teamId: string;
  agentId?: string;
  type: EventType;
  payload: Record<string, unknown>;
}

export interface Assignment {
  agent: string;     // AgentDef.id
  subtask: string;
}

export interface JobRecord {
  id: string;
  teamId: string;
  task: string;
  target?: string;   // agentId if a direct message; undefined = whole team
  createdAt: number;
  status: "running" | "done" | "error";
}
```

- [ ] **Step 2: Commit** (no test — pure types)

```bash
git add src/types.ts
git commit -m "feat: add shared a-team types"
```

---

## Task 2: Config loader

**Files:**
- Create: `src/config.ts`, `test/config.test.ts`, `test/helpers.ts`, `teams.example.yaml`

- [ ] **Step 1: Write `test/helpers.ts`**

```ts
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ateam-"));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}
```

- [ ] **Step 2: Write the failing test `test/config.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config.js";
import { tmpFile } from "./helpers.js";

const VALID = `
auth: { password: "\${TEST_PW}" }
server: { host: "0.0.0.0", port: 10000 }
teams:
  - id: alpha
    name: "Team Alpha"
    orchestrator: { model: opus, prompt: "Plan and delegate." }
    agents:
      - { id: engineer, role: "Engineer", model: sonnet }
`;

describe("loadConfig", () => {
  it("parses teams and expands env in password", () => {
    process.env.TEST_PW = "s3cret";
    const cfg = loadConfig(tmpFile("teams.yaml", VALID));
    expect(cfg.auth.password).toBe("s3cret");
    expect(cfg.server.port).toBe(10000);
    expect(cfg.teams[0].agents[0].id).toBe("engineer");
  });

  it("throws on duplicate agent ids", () => {
    const bad = VALID.replace(
      '{ id: engineer, role: "Engineer", model: sonnet }',
      '{ id: engineer, role: "E" }\n      - { id: engineer, role: "E2" }'
    );
    expect(() => loadConfig(tmpFile("teams.yaml", bad))).toThrow(/duplicate/i);
  });

  it("throws when password is empty after expansion", () => {
    delete process.env.TEST_PW;
    expect(() => loadConfig(tmpFile("teams.yaml", VALID))).toThrow(/password/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — cannot find module `../src/config.js`.

- [ ] **Step 4: Write `src/config.ts`**

```ts
import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import type { Config } from "./types.js";

function expandEnv(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name) => process.env[name] ?? "");
}

export function loadConfig(path: string): Config {
  const raw = yaml.load(readFileSync(path, "utf8")) as Config;

  if (!raw?.teams?.length) throw new Error("config: no teams defined");
  raw.auth = raw.auth ?? ({} as Config["auth"]);
  raw.auth.password = expandEnv(String(raw.auth.password ?? ""));
  if (!raw.auth.password) throw new Error("config: auth.password is empty");

  raw.server = { host: raw.server?.host ?? "0.0.0.0", port: raw.server?.port ?? 10000 };

  const teamIds = new Set<string>();
  for (const team of raw.teams) {
    if (teamIds.has(team.id)) throw new Error(`config: duplicate team id ${team.id}`);
    teamIds.add(team.id);
    if (!team.orchestrator?.prompt) throw new Error(`config: team ${team.id} missing orchestrator.prompt`);
    const agentIds = new Set<string>();
    for (const a of team.agents ?? []) {
      if (agentIds.has(a.id)) throw new Error(`config: duplicate agent id ${a.id} in team ${team.id}`);
      agentIds.add(a.id);
    }
  }
  return raw;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write `teams.example.yaml`**

```yaml
auth:
  password: "${ATEAM_PASSWORD}"   # set ATEAM_PASSWORD in the environment
server:
  host: "0.0.0.0"
  port: 10000
teams:
  - id: alpha
    name: "Team Alpha — web build"
    orchestrator:
      model: opus
      prompt: >
        You are the team lead. Read the task, break it into subtasks, and assign
        each subtask to exactly one agent by id. Respond ONLY with a fenced ```json
        block: {"assignments":[{"agent":"<id>","subtask":"<text>"}]}.
    agents:
      - { id: engineer, role: "Senior full-stack engineer", model: sonnet }
      - { id: reviewer, role: "Critical code reviewer",     model: sonnet }
      - { id: tester,   role: "QA / test author",           model: sonnet }
```

- [ ] **Step 7: Commit**

```bash
git add src/config.ts test/config.test.ts test/helpers.ts teams.example.yaml
git commit -m "feat: add config loader with env expansion and validation"
```

---

## Task 3: Event store

**Files:**
- Create: `src/eventStore.ts`, `test/eventStore.test.ts`

- [ ] **Step 1: Write the failing test `test/eventStore.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventStore } from "../src/eventStore.js";

function store() {
  return new EventStore(mkdtempSync(join(tmpdir(), "ateam-st-")));
}

describe("EventStore", () => {
  it("creates a job record and reads it back", () => {
    const s = store();
    const job = s.createJob({ teamId: "alpha", task: "build" });
    expect(job.status).toBe("running");
    expect(s.readRecord(job.id)?.teamId).toBe("alpha");
  });

  it("appends events and reads them in order", () => {
    const s = store();
    const job = s.createJob({ teamId: "alpha", task: "build" });
    s.appendEvent({ jobId: job.id, teamId: "alpha", type: "agent.started", payload: {} });
    s.appendEvent({ jobId: job.id, teamId: "alpha", type: "agent.done", payload: { ok: true } });
    const evs = s.readEvents(job.id);
    expect(evs.map(e => e.type)).toEqual(["job.created", "agent.started", "agent.done"]);
    expect(typeof evs[0].ts).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/eventStore.test.ts`
Expected: FAIL — cannot find module `../src/eventStore.js`.

- [ ] **Step 3: Write `src/eventStore.ts`**

```ts
import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Event, JobRecord } from "./types.js";

type NewEvent = Omit<Event, "ts">;
type EventListener = (e: Event) => void;

export class EventStore {
  private listeners = new Set<EventListener>();
  constructor(private root: string) {}

  private jobDir(id: string) { return join(this.root, "jobs", id); }

  onEvent(fn: EventListener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  createJob(input: { teamId: string; task: string; target?: string }): JobRecord {
    const record: JobRecord = {
      id: randomUUID(), teamId: input.teamId, task: input.task,
      target: input.target, createdAt: Date.now(), status: "running",
    };
    mkdirSync(this.jobDir(record.id), { recursive: true });
    writeFileSync(join(this.jobDir(record.id), "record.json"), JSON.stringify(record, null, 2));
    this.appendEvent({ jobId: record.id, teamId: input.teamId, type: "job.created", payload: { task: input.task, target: input.target } });
    return record;
  }

  setStatus(id: string, status: JobRecord["status"]) {
    const rec = this.readRecord(id);
    if (!rec) return;
    rec.status = status;
    writeFileSync(join(this.jobDir(id), "record.json"), JSON.stringify(rec, null, 2));
  }

  appendEvent(e: NewEvent): Event {
    const full: Event = { ...e, ts: Date.now() };
    appendFileSync(join(this.jobDir(e.jobId), "events.jsonl"), JSON.stringify(full) + "\n");
    for (const fn of this.listeners) fn(full);
    return full;
  }

  readRecord(id: string): JobRecord | null {
    const p = join(this.jobDir(id), "record.json");
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  }

  readEvents(id: string): Event[] {
    const p = join(this.jobDir(id), "events.jsonl");
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/eventStore.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/eventStore.ts test/eventStore.test.ts
git commit -m "feat: add file-based event store with listeners"
```

---

## Task 4: Mock claude CLI + agent runner

**Files:**
- Create: `test/mocks/mock-claude.mjs`, `src/agentRunner.ts`, `test/agentRunner.test.ts`

- [ ] **Step 1: Write `test/mocks/mock-claude.mjs`** (the fake CLI)

```js
#!/usr/bin/env node
// Mock claude: reads the prompt from `-p <prompt>` and echoes canned output.
// If the prompt contains "PLAN", emits a fenced JSON assignment block.
// If it contains "FAIL", exits non-zero. Otherwise echoes two output lines.
const args = process.argv.slice(2);
const pIdx = args.indexOf("-p");
const prompt = pIdx >= 0 ? args[pIdx + 1] ?? "" : "";

if (prompt.includes("FAIL")) {
  process.stderr.write("mock failure\n");
  process.exit(3);
}
if (prompt.includes("PLAN")) {
  process.stdout.write('```json\n{"assignments":[{"agent":"engineer","subtask":"do work"}]}\n```\n');
  process.exit(0);
}
process.stdout.write("line one\n");
process.stdout.write("line two\n");
process.exit(0);
```

Make it executable: `chmod +x test/mocks/mock-claude.mjs`

- [ ] **Step 2: Write the failing test `test/agentRunner.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { runAgent } from "../src/agentRunner.js";

const MOCK = fileURLToPath(new URL("./mocks/mock-claude.mjs", import.meta.url));

describe("runAgent", () => {
  it("streams stdout chunks and returns full text", async () => {
    const chunks: string[] = [];
    const result = await runAgent(
      { bin: MOCK, prompt: "hello", model: "sonnet", cwd: process.cwd() },
      (c) => chunks.push(c)
    );
    expect(result.text).toContain("line one");
    expect(result.text).toContain("line two");
    expect(result.code).toBe(0);
    expect(chunks.join("")).toContain("line two");
  });

  it("reports non-zero exit and stderr", async () => {
    const result = await runAgent(
      { bin: MOCK, prompt: "please FAIL", cwd: process.cwd() },
      () => {}
    );
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("mock failure");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/agentRunner.test.ts`
Expected: FAIL — cannot find module `../src/agentRunner.js`.

- [ ] **Step 4: Write `src/agentRunner.ts`**

```ts
import { spawn } from "node:child_process";

export interface RunOptions {
  bin: string;          // claude binary or mock path
  prompt: string;
  model?: string;
  cwd: string;
  extraArgs?: string[]; // e.g. ["--dangerously-skip-permissions"]
}

export interface RunResult { text: string; stderr: string; code: number; }

export function runAgent(opts: RunOptions, onChunk: (chunk: string) => void): Promise<RunResult> {
  const args = ["-p", opts.prompt];
  if (opts.model) args.push("--model", opts.model);
  if (opts.extraArgs) args.push(...opts.extraArgs);

  return new Promise((resolve) => {
    const child = spawn(opts.bin, args, { cwd: opts.cwd });
    let text = "", stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => { text += d; onChunk(d); });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => { stderr += d; });
    child.on("close", (code) => resolve({ text, stderr, code: code ?? 0 }));
    child.on("error", (err) => resolve({ text, stderr: stderr + String(err), code: 1 }));
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/agentRunner.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/agentRunner.ts test/agentRunner.test.ts test/mocks/mock-claude.mjs
git commit -m "feat: add agent runner with mock claude CLI"
```

---

## Task 5: Orchestrator plan parser

**Files:**
- Create: `src/orchestrator.ts`, `test/orchestrator.test.ts`

- [ ] **Step 1: Write the failing test `test/orchestrator.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseAssignments } from "../src/orchestrator.js";

describe("parseAssignments", () => {
  it("parses a fenced json block", () => {
    const out = 'Here is the plan:\n```json\n{"assignments":[{"agent":"engineer","subtask":"build"}]}\n```';
    expect(parseAssignments(out, ["engineer", "tester"])).toEqual([{ agent: "engineer", subtask: "build" }]);
  });

  it("parses bare json without a fence", () => {
    const out = '{"assignments":[{"agent":"tester","subtask":"test it"}]}';
    expect(parseAssignments(out, ["engineer", "tester"])).toEqual([{ agent: "tester", subtask: "test it" }]);
  });

  it("throws on unknown agent id", () => {
    const out = '{"assignments":[{"agent":"ghost","subtask":"x"}]}';
    expect(() => parseAssignments(out, ["engineer"])).toThrow(/unknown agent/i);
  });

  it("throws when no json found", () => {
    expect(() => parseAssignments("no json here", ["engineer"])).toThrow(/no plan/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/orchestrator.test.ts`
Expected: FAIL — cannot find module `../src/orchestrator.js`.

- [ ] **Step 3: Write `src/orchestrator.ts`**

```ts
import type { Assignment } from "./types.js";

export function parseAssignments(output: string, validAgentIds: string[]): Assignment[] {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : output.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error("orchestrator: no plan JSON found in output");

  let parsed: { assignments?: Assignment[] };
  try { parsed = JSON.parse(candidate.trim()); }
  catch { throw new Error("orchestrator: plan JSON is malformed"); }

  const assignments = parsed.assignments ?? [];
  if (!assignments.length) throw new Error("orchestrator: plan has no assignments");
  for (const a of assignments) {
    if (!validAgentIds.includes(a.agent)) throw new Error(`orchestrator: unknown agent ${a.agent}`);
  }
  return assignments;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/orchestrator.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator.ts test/orchestrator.test.ts
git commit -m "feat: add orchestrator plan parser"
```

---

## Task 6: Dispatcher (plan → run workers → collect)

**Files:**
- Create: `src/dispatcher.ts`, `test/dispatcher.test.ts`

- [ ] **Step 1: Write the failing test `test/dispatcher.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventStore } from "../src/eventStore.js";
import { Dispatcher } from "../src/dispatcher.js";
import type { Team } from "../src/types.js";

const MOCK = fileURLToPath(new URL("./mocks/mock-claude.mjs", import.meta.url));

const team: Team = {
  id: "alpha", name: "Alpha",
  orchestrator: { model: "opus", prompt: "PLAN this" },   // mock returns engineer assignment
  agents: [{ id: "engineer", role: "Eng", model: "sonnet" }],
};

function makeDispatcher() {
  const store = new EventStore(mkdtempSync(join(tmpdir(), "ateam-d-")));
  const runRoot = mkdtempSync(join(tmpdir(), "ateam-run-"));
  return { store, d: new Dispatcher(store, { bin: MOCK, runRoot, extraArgs: [] }) };
}

describe("Dispatcher", () => {
  it("plans then runs the assigned worker and finishes", async () => {
    const { store, d } = makeDispatcher();
    const job = await d.dispatch(team, "build a thing");
    const types = store.readEvents(job.id).map(e => e.type);
    expect(types).toContain("plan.ready");
    expect(types).toContain("agent.started");
    expect(types).toContain("agent.done");
    expect(types).toContain("job.done");
    expect(store.readRecord(job.id)?.status).toBe("done");
  });

  it("direct message to an agent skips planning", async () => {
    const { store, d } = makeDispatcher();
    const job = await d.runDirect(team, "engineer", "just do X");
    const types = store.readEvents(job.id).map(e => e.type);
    expect(types).not.toContain("plan.ready");
    expect(types.filter(t => t === "agent.started")).toHaveLength(1);
    expect(store.readRecord(job.id)?.status).toBe("done");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dispatcher.test.ts`
Expected: FAIL — cannot find module `../src/dispatcher.js`.

- [ ] **Step 3: Write `src/dispatcher.ts`**

```ts
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Team, JobRecord } from "./types.js";
import { EventStore } from "./eventStore.js";
import { runAgent } from "./agentRunner.js";
import { parseAssignments } from "./orchestrator.js";

export interface DispatcherOptions { bin: string; runRoot: string; extraArgs: string[]; }

export class Dispatcher {
  constructor(private store: EventStore, private opts: DispatcherOptions) {}

  private workdir(jobId: string, agentId: string): string {
    const dir = join(this.opts.runRoot, jobId, agentId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private async runOne(job: JobRecord, team: Team, agentId: string, prompt: string) {
    const agent = team.agents.find(a => a.id === agentId)!;
    this.store.appendEvent({ jobId: job.id, teamId: team.id, agentId, type: "agent.started", payload: { prompt } });
    const fullPrompt = `${agent.role}\n\nTask: ${prompt}`;
    const res = await runAgent(
      { bin: this.opts.bin, prompt: fullPrompt, model: agent.model, cwd: this.workdir(job.id, agentId), extraArgs: this.opts.extraArgs },
      (chunk) => this.store.appendEvent({ jobId: job.id, teamId: team.id, agentId, type: "agent.output", payload: { chunk } })
    );
    if (res.code === 0) {
      this.store.appendEvent({ jobId: job.id, teamId: team.id, agentId, type: "agent.done", payload: { text: res.text } });
    } else {
      this.store.appendEvent({ jobId: job.id, teamId: team.id, agentId, type: "agent.error", payload: { code: res.code, stderr: res.stderr } });
    }
    return res.code === 0;
  }

  async dispatch(team: Team, task: string): Promise<JobRecord> {
    const job = this.store.createJob({ teamId: team.id, task });
    try {
      const planRes = await runAgent(
        { bin: this.opts.bin, prompt: `${team.orchestrator.prompt}\n\nTask: ${task}`, model: team.orchestrator.model, cwd: this.workdir(job.id, "orchestrator"), extraArgs: this.opts.extraArgs },
        () => {}
      );
      const assignments = parseAssignments(planRes.text, team.agents.map(a => a.id));
      this.store.appendEvent({ jobId: job.id, teamId: team.id, type: "plan.ready", payload: { assignments } });
      let allOk = true;
      for (const a of assignments) {
        const ok = await this.runOne(job, team, a.agent, a.subtask);
        allOk = allOk && ok;
      }
      this.store.setStatus(job.id, allOk ? "done" : "error");
    } catch (err) {
      this.store.appendEvent({ jobId: job.id, teamId: team.id, type: "agent.error", payload: { error: String(err) } });
      this.store.setStatus(job.id, "error");
    }
    this.store.appendEvent({ jobId: job.id, teamId: team.id, type: "job.done", payload: { status: this.store.readRecord(job.id)?.status } });
    return this.store.readRecord(job.id)!;
  }

  async runDirect(team: Team, agentId: string, message: string): Promise<JobRecord> {
    const job = this.store.createJob({ teamId: team.id, task: message, target: agentId });
    const ok = await this.runOne(job, team, agentId, message);
    this.store.setStatus(job.id, ok ? "done" : "error");
    this.store.appendEvent({ jobId: job.id, teamId: team.id, type: "job.done", payload: { status: ok ? "done" : "error" } });
    return this.store.readRecord(job.id)!;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/dispatcher.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/dispatcher.ts test/dispatcher.test.ts
git commit -m "feat: add dispatcher for plan/delegate/collect and direct messages"
```

---

## Task 7: Auth

**Files:**
- Create: `src/auth.ts`, `test/auth.test.ts`

- [ ] **Step 1: Write the failing test `test/auth.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { AuthStore } from "../src/auth.js";

describe("AuthStore", () => {
  it("issues a session for the right password and validates it", () => {
    const auth = new AuthStore("s3cret");
    const sid = auth.login("s3cret");
    expect(sid).toBeTruthy();
    expect(auth.valid(sid!)).toBe(true);
  });

  it("rejects the wrong password", () => {
    const auth = new AuthStore("s3cret");
    expect(auth.login("nope")).toBeNull();
  });

  it("invalidates a session on logout", () => {
    const auth = new AuthStore("s3cret");
    const sid = auth.login("s3cret")!;
    auth.logout(sid);
    expect(auth.valid(sid)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/auth.test.ts`
Expected: FAIL — cannot find module `../src/auth.js`.

- [ ] **Step 3: Write `src/auth.ts`**

```ts
import { randomUUID, timingSafeEqual } from "node:crypto";

export class AuthStore {
  private sessions = new Set<string>();
  constructor(private password: string) {}

  login(attempt: string): string | null {
    const a = Buffer.from(attempt);
    const b = Buffer.from(this.password);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const sid = randomUUID();
    this.sessions.add(sid);
    return sid;
  }

  valid(sid: string | undefined): boolean { return !!sid && this.sessions.has(sid); }
  logout(sid: string) { this.sessions.delete(sid); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/auth.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts test/auth.test.ts
git commit -m "feat: add password auth with in-memory sessions"
```

---

## Task 8: HTTP API + WebSocket + static serving

**Files:**
- Create: `src/server.ts`, `src/index.ts`, `test/api.test.ts`

- [ ] **Step 1: Write the failing test `test/api.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "../src/server.js";
import type { Config } from "../src/types.js";

const MOCK = fileURLToPath(new URL("./mocks/mock-claude.mjs", import.meta.url));

const cfg: Config = {
  auth: { password: "pw" },
  server: { host: "127.0.0.1", port: 0 },
  teams: [{ id: "alpha", name: "Alpha", orchestrator: { model: "opus", prompt: "PLAN" },
            agents: [{ id: "engineer", role: "Eng", model: "sonnet" }] }],
};

function server() {
  return buildServer(cfg, { bin: MOCK, runRoot: mkdtempSync(join(tmpdir(), "api-run-")),
    stateRoot: mkdtempSync(join(tmpdir(), "api-st-")), extraArgs: [], webDir: null });
}

describe("api", () => {
  it("rejects unauthenticated /api/teams", async () => {
    const app = server();
    const res = await app.inject({ method: "GET", url: "/api/teams" });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("logs in and lists teams", async () => {
    const app = server();
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "pw" } });
    expect(login.statusCode).toBe(200);
    const cookie = login.cookies[0];
    const res = await app.inject({ method: "GET", url: "/api/teams", cookies: { [cookie.name]: cookie.value } });
    expect(res.statusCode).toBe(200);
    expect(res.json()[0].id).toBe("alpha");
    await app.close();
  });

  it("accepts a task and returns a job id", async () => {
    const app = server();
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "pw" } });
    const cookie = login.cookies[0];
    const res = await app.inject({ method: "POST", url: "/api/teams/alpha/tasks",
      cookies: { [cookie.name]: cookie.value }, payload: { task: "build" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().jobId).toBeTruthy();
    await app.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/api.test.ts`
Expected: FAIL — cannot find module `../src/server.js`.

- [ ] **Step 3: Write `src/server.ts`**

```ts
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fstatic from "@fastify/static";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import type { Config } from "./types.js";
import { EventStore } from "./eventStore.js";
import { Dispatcher } from "./dispatcher.js";
import { AuthStore } from "./auth.js";

export interface ServerDeps {
  bin: string; runRoot: string; stateRoot: string; extraArgs: string[];
  webDir: string | null;          // built React app, or null in tests
  configPath?: string;            // for the config editor
}

const COOKIE = "ateam_sid";

export function buildServer(cfg: Config, deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new EventStore(deps.stateRoot);
  const auth = new AuthStore(cfg.auth.password);
  const dispatcher = new Dispatcher(store, { bin: deps.bin, runRoot: deps.runRoot, extraArgs: deps.extraArgs });

  app.register(websocket);

  function sid(req: any): string | undefined {
    const raw = req.headers.cookie?.split(";").map((s: string) => s.trim())
      .find((s: string) => s.startsWith(`${COOKIE}=`));
    return raw?.slice(COOKIE.length + 1);
  }

  // Auth guard for /api except /api/login
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.url === "/api/login") return;
    if (!auth.valid(sid(req))) reply.code(401).send({ error: "unauthorized" });
  });

  app.post("/api/login", async (req, reply) => {
    const pw = (req.body as any)?.password ?? "";
    const id = auth.login(pw);
    if (!id) return reply.code(401).send({ error: "bad password" });
    reply.header("set-cookie", `${COOKIE}=${id}; HttpOnly; Path=/; SameSite=Lax`).send({ ok: true });
  });

  app.post("/api/logout", async (req, reply) => { const s = sid(req); if (s) auth.logout(s); reply.send({ ok: true }); });

  app.get("/api/teams", async () => cfg.teams);

  app.post("/api/teams/:teamId/tasks", async (req, reply) => {
    const { teamId } = req.params as any;
    const { task, agent } = (req.body as any) ?? {};
    const team = cfg.teams.find(t => t.id === teamId);
    if (!team) return reply.code(404).send({ error: "no such team" });
    // fire and forget; events stream over WS
    const p = agent ? dispatcher.runDirect(team, agent, task) : dispatcher.dispatch(team, task);
    const job = await p.catch(() => null);
    reply.send({ jobId: job?.id ?? null });
  });

  // Config editor (behind auth via the hook above)
  app.get("/api/config", async (reply) => {
    if (!deps.configPath || !existsSync(deps.configPath)) return { content: "" };
    return { content: readFileSync(deps.configPath, "utf8") };
  });
  app.post("/api/config", async (req, reply) => {
    if (!deps.configPath) return reply.code(400).send({ error: "no config path" });
    writeFileSync(deps.configPath, (req.body as any)?.content ?? "");
    reply.send({ ok: true, note: "restart to apply" });
  });

  // WebSocket: push every event to all authenticated sockets
  app.register(async (scope) => {
    scope.get("/ws", { websocket: true }, (socket, req) => {
      if (!auth.valid(sid(req))) { socket.close(); return; }
      const off = store.onEvent((e) => { try { socket.send(JSON.stringify(e)); } catch {} });
      socket.on("close", off);
    });
  });

  if (deps.webDir) {
    app.register(fstatic, { root: deps.webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
      reply.sendFile("index.html");           // SPA fallback
    });
  }

  return app;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/api.test.ts`
Expected: PASS (3 tests). If `@fastify/static` complains when `webDir` is null, confirm it is only registered inside the `if (deps.webDir)` block (it is).

- [ ] **Step 5: Write `src/index.ts`** (entry point)

```ts
import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const configPath = process.env.ATEAM_CONFIG ?? "teams.yaml";
const cfg = loadConfig(configPath);

const skipPerms = process.env.ATEAM_SKIP_PERMISSIONS !== "0";
const webDist = join(process.cwd(), "web", "dist");

const app = buildServer(cfg, {
  bin: process.env.ATEAM_CLAUDE_BIN ?? "claude",
  runRoot: join(process.cwd(), ".a-team", "runs"),
  stateRoot: join(process.cwd(), ".a-team", "state"),
  extraArgs: skipPerms ? ["--dangerously-skip-permissions"] : [],
  webDir: existsSync(webDist) ? webDist : null,
  configPath,
});

app.listen({ host: cfg.server.host, port: cfg.server.port })
  .then(() => console.log(`a-team on http://${cfg.server.host}:${cfg.server.port}`))
  .catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Manual smoke (real claude, optional but recommended)**

```bash
cp teams.example.yaml teams.yaml
ATEAM_PASSWORD=test ATEAM_CLAUDE_BIN=$(command -v claude) npm start
```
Expected: logs `a-team on http://0.0.0.0:10000`. `curl -s localhost:10000/api/teams` → `401` (unauthenticated). Stop with Ctrl-C.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/index.ts test/api.test.ts
git commit -m "feat: add Fastify API, websocket event stream, and entry point"
```

---

## Task 9: Full backend test pass

- [ ] **Step 1: Run the whole suite**

Run: `npx vitest run`
Expected: PASS — all of config, eventStore, agentRunner, orchestrator, dispatcher, auth, api (16 tests total).

- [ ] **Step 2: Commit** (only if you fixed anything; otherwise skip)

```bash
git commit -am "test: backend suite green"
```

---

## Task 10: Frontend scaffold (Vite + React + React Flow)

**Files:**
- Create: `web/package.json`, `web/index.html`, `web/tsconfig.json`, `web/vite.config.ts`, `web/src/main.tsx`, `web/src/types.ts`

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "a-team-web",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -b && vite build", "preview": "vite preview" },
  "dependencies": {
    "@xyflow/react": "^12.3.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create `web/vite.config.ts`** (proxy API+WS to backend in dev)

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:10000", "/ws": { target: "ws://localhost:10000", ws: true } } },
});
```

- [ ] **Step 3: Create `web/index.html`**

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>a-team</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```

- [ ] **Step 4: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx",
    "strict": true, "skipLibCheck": true, "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 5: Create `web/src/types.ts`** (mirror backend events)

```ts
export interface AgentDef { id: string; role: string; model?: string; }
export interface Team { id: string; name: string; orchestrator: { model?: string; prompt: string }; agents: AgentDef[]; }
export type EventType =
  | "job.created" | "plan.ready" | "agent.started" | "agent.output"
  | "agent.done" | "agent.error" | "chat.message" | "job.done";
export interface Event { ts: number; jobId: string; teamId: string; agentId?: string; type: EventType; payload: any; }
export type AgentStatus = "idle" | "running" | "error";
```

- [ ] **Step 6: Create `web/src/main.tsx`** (placeholder root, replaced in Task 13)

```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
```

- [ ] **Step 7: Install and verify build tooling**

Run: `cd web && npm install`
Expected: installs cleanly. (Build verified in Task 13 once `App.tsx` exists.)

- [ ] **Step 8: Commit**

```bash
git add web/package.json web/vite.config.ts web/index.html web/tsconfig.json web/src/types.ts web/src/main.tsx
git commit -m "chore: scaffold a-team web frontend"
```

---

## Task 11: Frontend API client + event store reducer

**Files:**
- Create: `web/src/api.ts`, `web/src/store.ts`

- [ ] **Step 1: Write `web/src/api.ts`**

```ts
import type { Team, Event } from "./types.js";

export async function login(password: string): Promise<boolean> {
  const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  return r.ok;
}
export async function fetchTeams(): Promise<Team[]> {
  const r = await fetch("/api/teams");
  if (!r.ok) throw new Error("unauthorized");
  return r.json();
}
export async function sendTask(teamId: string, task: string, agent?: string): Promise<string | null> {
  const r = await fetch(`/api/teams/${teamId}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, agent }) });
  return (await r.json()).jobId ?? null;
}
export async function getConfig(): Promise<string> { return (await (await fetch("/api/config")).json()).content; }
export async function saveConfig(content: string): Promise<void> { await fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) }); }

export function connectEvents(onEvent: (e: Event) => void): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (m) => onEvent(JSON.parse(m.data));
  return ws;
}
```

- [ ] **Step 2: Write `web/src/store.ts`** (reduce events → per-team agent status + chat)

```ts
import type { Event, AgentStatus } from "./types.js";

export interface ChatMsg { who: string; text: string; ts: number; kind: "user" | "agent" | "error" | "system"; }
export interface TeamState { agentStatus: Record<string, AgentStatus>; chat: ChatMsg[]; }

export function emptyTeamState(): TeamState { return { agentStatus: {}, chat: [] }; }

export function applyEvent(state: TeamState, e: Event): TeamState {
  const agentStatus = { ...state.agentStatus };
  const chat = [...state.chat];
  switch (e.type) {
    case "job.created":
      chat.push({ who: "you", text: String(e.payload.task ?? ""), ts: e.ts, kind: "user" }); break;
    case "plan.ready":
      chat.push({ who: "🧭 orchestrator", text: "Plan: " + JSON.stringify(e.payload.assignments), ts: e.ts, kind: "system" }); break;
    case "agent.started":
      if (e.agentId) agentStatus[e.agentId] = "running"; break;
    case "agent.done":
      if (e.agentId) agentStatus[e.agentId] = "idle";
      chat.push({ who: e.agentId ?? "agent", text: String(e.payload.text ?? "(done)"), ts: e.ts, kind: "agent" }); break;
    case "agent.error":
      if (e.agentId) agentStatus[e.agentId] = "error";
      chat.push({ who: e.agentId ?? "agent", text: "Error: " + JSON.stringify(e.payload), ts: e.ts, kind: "error" }); break;
  }
  return { agentStatus, chat };
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/api.ts web/src/store.ts
git commit -m "feat(web): add api client and event reducer"
```

---

## Task 12: Team panel (React Flow) + chat thread + config editor

**Files:**
- Create: `web/src/TeamPanel.tsx`, `web/src/ChatThread.tsx`, `web/src/ConfigEditor.tsx`, `web/src/Login.tsx`

- [ ] **Step 1: Write `web/src/TeamPanel.tsx`** (graph: orchestrator → workers, colored by status)

```tsx
import { ReactFlow, Background, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Team, AgentStatus } from "./types.js";

const color: Record<AgentStatus, string> = { idle: "#475569", running: "#22c55e", error: "#ef4444" };

export function TeamPanel({ team, status }: { team: Team; status: Record<string, AgentStatus> }) {
  const nodes: Node[] = [
    { id: `${team.id}-orch`, position: { x: 140, y: 0 }, data: { label: "🧭 Orchestrator" },
      style: { border: "2px solid #3b82f6", borderRadius: 8, padding: 6, background: "#0f172a", color: "#e2e8f0" } },
    ...team.agents.map((a, i): Node => ({
      id: `${team.id}-${a.id}`, position: { x: i * 160, y: 120 }, data: { label: `${a.id}` },
      style: { border: `2px solid ${color[status[a.id] ?? "idle"]}`, borderRadius: 8, padding: 6, background: "#1e293b", color: "#e2e8f0" },
    })),
  ];
  const edges: Edge[] = team.agents.map((a): Edge => ({
    id: `${team.id}-e-${a.id}`, source: `${team.id}-orch`, target: `${team.id}-${a.id}`, animated: status[a.id] === "running",
  }));
  return (
    <div style={{ height: 240, border: "1px solid #334155", borderRadius: 8 }}>
      <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
        <Background />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 2: Write `web/src/ChatThread.tsx`** (per-team thread + target selector)

```tsx
import { useState } from "react";
import type { Team } from "./types.js";
import type { ChatMsg } from "./store.js";
import { sendTask } from "./api.js";

export function ChatThread({ team, chat }: { team: Team; chat: ChatMsg[] }) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");   // "" = whole team (orchestrator)

  async function submit() {
    if (!text.trim()) return;
    await sendTask(team.id, text, target || undefined);
    setText("");
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ maxHeight: 180, overflow: "auto", background: "#0b1220", borderRadius: 6, padding: 6 }}>
        {chat.map((m, i) => (
          <div key={i} style={{ color: m.kind === "error" ? "#f87171" : "#cbd5e1", fontSize: 12 }}>
            <b style={{ color: "#60a5fa" }}>{m.who}:</b> {m.text}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Team ▾</option>
          {team.agents.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}
        </select>
        <input style={{ flex: 1 }} value={text} placeholder="task or message…"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <button onClick={submit}>Send</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Write `web/src/ConfigEditor.tsx`**

```tsx
import { useEffect, useState } from "react";
import { getConfig, saveConfig } from "./api.js";

export function ConfigEditor() {
  const [content, setContent] = useState("");
  const [note, setNote] = useState("");
  useEffect(() => { getConfig().then(setContent); }, []);
  return (
    <div style={{ padding: 12 }}>
      <h3>teams.yaml</h3>
      <textarea value={content} onChange={(e) => setContent(e.target.value)} style={{ width: "100%", height: 320, fontFamily: "monospace" }} />
      <button onClick={async () => { await saveConfig(content); setNote("Saved — restart the server to apply."); }}>Save</button>
      <span style={{ marginLeft: 8, color: "#f59e0b" }}>{note}</span>
    </div>
  );
}
```

- [ ] **Step 4: Write `web/src/Login.tsx`**

```tsx
import { useState } from "react";
import { login } from "./api.js";

export function Login({ onOk }: { onOk: () => void }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState(false);
  async function submit() { (await login(pw)) ? onOk() : setErr(true); }
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100vh" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h2>a-team</h2>
        <input type="password" value={pw} placeholder="password"
          onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        {err && <span style={{ color: "#f87171" }}>Wrong password</span>}
        <button onClick={submit}>Log in</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Commit**

```bash
git add web/src/TeamPanel.tsx web/src/ChatThread.tsx web/src/ConfigEditor.tsx web/src/Login.tsx
git commit -m "feat(web): add team graph, chat thread, config editor, login"
```

---

## Task 13: App shell wiring (multi-team + live WS)

**Files:**
- Create: `web/src/App.tsx`

- [ ] **Step 1: Write `web/src/App.tsx`**

```tsx
import { useEffect, useReducer, useState } from "react";
import type { Team, Event } from "./types.js";
import { fetchTeams, connectEvents } from "./api.js";
import { applyEvent, emptyTeamState, type TeamState } from "./store.js";
import { TeamPanel } from "./TeamPanel.js";
import { ChatThread } from "./ChatThread.js";
import { ConfigEditor } from "./ConfigEditor.js";
import { Login } from "./Login.js";

type States = Record<string, TeamState>;
function reducer(s: States, e: Event): States {
  return { ...s, [e.teamId]: applyEvent(s[e.teamId] ?? emptyTeamState(), e) };
}

export function App() {
  const [authed, setAuthed] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [states, dispatch] = useReducer(reducer, {});
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    if (!authed) return;
    fetchTeams().then(setTeams).catch(() => setAuthed(false));
    const ws = connectEvents((e) => dispatch(e));
    return () => ws.close();
  }, [authed]);

  if (!authed) return <Login onOk={() => setAuthed(true)} />;
  if (showConfig) return (<div><button onClick={() => setShowConfig(false)}>← back</button><ConfigEditor /></div>);

  return (
    <div style={{ padding: 12, background: "#020617", minHeight: "100vh", color: "#e2e8f0" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2>a-team</h2><button onClick={() => setShowConfig(true)}>⚙ Config</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {teams.map((t) => {
          const st = states[t.id] ?? emptyTeamState();
          return (
            <div key={t.id} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: 10 }}>
              <h3>{t.name}</h3>
              <TeamPanel team={t} status={st.agentStatus} />
              <ChatThread team={t} chat={st.chat} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build the frontend to verify it compiles**

Run: `cd web && npm run build`
Expected: `tsc -b` passes, Vite writes `web/dist/`. Fix any type errors before continuing.

- [ ] **Step 3: Commit**

```bash
git add web/src/App.tsx
git commit -m "feat(web): wire multi-team app shell with live websocket"
```

---

## Task 14: End-to-end verification (real claude)

- [ ] **Step 1: Build the UI and start the backend**

```bash
cd web && npm run build && cd ..
cp teams.example.yaml teams.yaml
ATEAM_PASSWORD=changeme ATEAM_CLAUDE_BIN=$(command -v claude) npm start
```

- [ ] **Step 2: Verify in the browser**

Open `http://localhost:10000`. Expected:
1. Login screen → enter `changeme` → team grid appears with Team Alpha's graph.
2. Type "create a file hello.txt that says hi" in Alpha's chat, target = Team, Send.
3. Orchestrator node + assigned worker node light green; chat shows plan + agent output.
4. Confirm real work: `ls .a-team/runs/<jobId>/engineer/` shows the agent's working dir.

- [ ] **Step 3: Verify targeted chat**

Select target = `reviewer`, send "say hello". Expected: only the `reviewer` node runs; no plan event in the thread.

- [ ] **Step 4: Verify config editor**

Click ⚙ Config → edit a team name → Save → see "restart to apply" → restart → name updated.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "docs: a-team v1 verified end-to-end"
```

---

## Self-Review (completed by plan author)

- **Spec coverage:** configurable teams (Task 2), real work in workdirs (Task 6), delegation protocol (Tasks 5–6), live viz (Tasks 12–13), targeted chat (Tasks 6, 12), CLI backend (Task 4), login + config editor (Tasks 7, 8, 12), event store (Task 3), errors (agent.error in Task 6, healthcheck note below), tests with mock CLI (Tasks 2–8). All spec sections map to tasks.
- **Healthcheck note:** spec's "is claude authenticated" startup check is intentionally deferred to manual smoke (Task 8 Step 6 / Task 14) to keep v1 minimal; if desired later, add a `claude --version` probe in `index.ts`. This is the one spec item not auto-tested — flagged here deliberately.
- **Placeholder scan:** no TBD/TODO; every code step contains full code.
- **Type consistency:** `Event`, `Team`, `Assignment`, `JobRecord`, `AgentStatus` defined in `src/types.ts` and mirrored in `web/src/types.ts`; method names (`appendEvent`, `readEvents`, `dispatch`, `runDirect`, `login`, `valid`, `parseAssignments`, `applyEvent`) are consistent across tasks.
