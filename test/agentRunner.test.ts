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
