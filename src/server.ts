import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fstatic from "@fastify/static";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import type { Config } from "./types.js";
import { EventStore } from "./eventStore.js";
import { Dispatcher } from "./dispatcher.js";
import { AuthStore } from "./auth.js";
import { RosterStore, HttpError } from "./rosterStore.js";

export interface ServerDeps {
  bin: string; runRoot: string; stateRoot: string; extraArgs: string[];
  webDir: string | null;
  configPath?: string;
}

const COOKIE = "ateam_sid";

export function buildServer(cfg: Config, deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new EventStore(deps.stateRoot);
  const auth = new AuthStore(cfg.auth.password);
  const roster = new RosterStore(cfg.teams, deps.configPath ?? null);
  const dispatcher = new Dispatcher(store, { bin: deps.bin, runRoot: deps.runRoot, extraArgs: deps.extraArgs });

  app.register(websocket);

  function sid(req: any): string | undefined {
    const raw = req.headers.cookie?.split(";").map((s: string) => s.trim())
      .find((s: string) => s.startsWith(`${COOKIE}=`));
    return raw?.slice(COOKIE.length + 1);
  }

  function fail(reply: any, err: unknown) {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    return reply.code(500).send({ error: String(err) });
  }

  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.url === "/api/login") return;
    if (!auth.valid(sid(req))) return reply.code(401).send({ error: "unauthorized" });
  });

  app.post("/api/login", async (req, reply) => {
    const pw = (req.body as any)?.password ?? "";
    const id = auth.login(pw);
    if (!id) return reply.code(401).send({ error: "bad password" });
    reply.header("set-cookie", `${COOKIE}=${id}; HttpOnly; Path=/; SameSite=Lax`).send({ ok: true });
  });

  app.post("/api/logout", async (req, reply) => { const s = sid(req); if (s) auth.logout(s); reply.send({ ok: true }); });

  app.get("/api/teams", async () => roster.getTeams());

  app.post("/api/teams/:teamId/tasks", async (req, reply) => {
    const { teamId } = req.params as any;
    const { task, agent } = (req.body as any) ?? {};
    const team = roster.getTeam(teamId);
    if (!team) return reply.code(404).send({ error: "no such team" });
    const p = agent ? dispatcher.runDirect(team, agent, task) : dispatcher.dispatch(team, task);
    const job = await p.catch(() => null);
    reply.send({ jobId: job?.id ?? null });
  });

  app.patch("/api/teams/:teamId/agents/:agentId", async (req, reply) => {
    const { teamId, agentId } = req.params as any;
    const { name, role } = (req.body as any) ?? {};
    try { reply.send(roster.updateAgent(teamId, agentId, { name, role })); }
    catch (e) { fail(reply, e); }
  });

  app.post("/api/teams/:teamId/agents", async (req, reply) => {
    const { teamId } = req.params as any;
    const { id, role, name } = (req.body as any) ?? {};
    if (!id || !role) return reply.code(400).send({ error: "id and role required" });
    try { reply.send(roster.addAgent(teamId, { id, role, name })); }
    catch (e) { fail(reply, e); }
  });

  app.post("/api/teams", async (req, reply) => {
    const { id, name } = (req.body as any) ?? {};
    if (!id || !name) return reply.code(400).send({ error: "id and name required" });
    try { reply.send(roster.addTeam({ id, name })); }
    catch (e) { fail(reply, e); }
  });

  app.get("/api/jobs", async (req) => {
    const { agent, team } = (req.query as any) ?? {};
    let jobs = store.listJobs();
    if (team) jobs = jobs.filter((j) => j.teamId === team);
    if (agent) jobs = jobs.filter((j) => j.target === agent || store.readEvents(j.id).some((e) => e.agentId === agent));
    return jobs.slice(0, 50);
  });

  app.get("/api/config", async () => {
    if (!deps.configPath || !existsSync(deps.configPath)) return { content: "" };
    return { content: readFileSync(deps.configPath, "utf8") };
  });
  app.post("/api/config", async (req, reply) => {
    if (!deps.configPath) return reply.code(400).send({ error: "no config path" });
    writeFileSync(deps.configPath, (req.body as any)?.content ?? "");
    reply.send({ ok: true, note: "restart to apply" });
  });

  app.register(async (scope) => {
    scope.get("/ws", { websocket: true }, (socket, req) => {
      if (!auth.valid(sid(req))) { socket.close(); return; }
      const off = store.onEvent((e) => { try { socket.send(JSON.stringify(e)); } catch {} });
      socket.on("close", off);
      socket.on("error", off);
    });
  });

  if (deps.webDir) {
    app.register(fstatic, { root: deps.webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
      reply.sendFile("index.html");
    });
  }

  return app;
}
