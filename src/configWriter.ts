import { readFileSync, writeFileSync } from "node:fs";
import yaml from "js-yaml";
import type { Team } from "./types.js";

// Re-reads the existing yaml UNEXPANDED (so ${ENV} refs and auth/server stay verbatim),
// swaps in the current teams, and writes it back. The expanded password secret is never
// touched because we load the raw file, not the in-memory expanded Config.
export function writeConfig(path: string, teams: Team[]): void {
  const raw = yaml.load(readFileSync(path, "utf8")) as Record<string, unknown>;
  raw.teams = teams;
  writeFileSync(path, yaml.dump(raw, { lineWidth: 100 }));
}
