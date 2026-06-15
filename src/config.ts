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
