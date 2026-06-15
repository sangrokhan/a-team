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

  it("runDirect with an unknown agent ends in error, not a hang", async () => {
    const { store, d } = makeDispatcher();
    const job = await d.runDirect(team, "ghost", "do something");
    const types = store.readEvents(job.id).map(e => e.type);
    expect(types).toContain("agent.error");
    expect(types).toContain("job.done");
    expect(store.readRecord(job.id)?.status).toBe("error");
  });
});
