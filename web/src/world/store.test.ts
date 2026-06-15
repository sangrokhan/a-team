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
