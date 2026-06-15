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

  it("defaults agent name to id when omitted", () => {
    process.env.TEST_PW = "s3cret";
    const cfg = loadConfig(tmpFile("teams.yaml", VALID));
    expect(cfg.teams[0].agents[0].name).toBe("engineer");
  });
});
