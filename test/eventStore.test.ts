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
