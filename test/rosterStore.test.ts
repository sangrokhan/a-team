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
    expect(a.name).toBe("tester");
    expect(store.getTeam("alpha")!.agents).toHaveLength(2);
    expect(() => store.addAgent("alpha", { id: "engineer", role: "x" })).toThrowError(/duplicate/i);
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
