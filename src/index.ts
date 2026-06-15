import { join } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

const configPath = process.env.ATEAM_CONFIG ?? "teams.yaml";
const cfg = loadConfig(configPath);

const skipPerms = process.env.ATEAM_SKIP_PERMISSIONS !== "0";
if (skipPerms) {
  console.warn("⚠️  a-team: agents run claude with --dangerously-skip-permissions (arbitrary command execution). Set ATEAM_SKIP_PERMISSIONS=0 to disable. Keep the login password strong and avoid untrusted networks.");
}
const webDist = join(process.cwd(), "web", "dist");

const app = buildServer(cfg, {
  bin: process.env.ATEAM_CLAUDE_BIN ?? "claude",
  runRoot: join(process.cwd(), ".a-team", "runs"),
  stateRoot: join(process.cwd(), ".a-team", "state"),
  extraArgs: skipPerms ? ["--dangerously-skip-permissions"] : [],
  webDir: existsSync(webDist) ? webDist : null,
  configPath,
});

app.listen({ host: cfg.server.host, port: cfg.server.port })
  .then(() => console.log(`a-team on http://${cfg.server.host}:${cfg.server.port}`))
  .catch((e) => { console.error(e); process.exit(1); });
