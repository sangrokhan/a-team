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

    const raw = yaml.load(readFileSync(path, "utf8")) as any;
    expect(raw.auth.password).toBe("${SECRET_PW}");
    expect(raw.teams[0].agents[0].role).toBe("Lead engineer, writes tests");

    process.env.SECRET_PW = "xyz";
    const cfg = loadConfig(path);
    expect(cfg.auth.password).toBe("xyz");
    expect(cfg.teams[0].agents[0].name).toBe("Nova");
  });
});
