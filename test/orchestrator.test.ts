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
