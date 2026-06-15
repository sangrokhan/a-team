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
