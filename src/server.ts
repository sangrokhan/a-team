import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fstatic from "@fastify/static";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import type { Config } from "./types.js";
import { EventStore } from "./eventStore.js";
import { Dispatcher } from "./dispatcher.js";
import { AuthStore } from "./auth.js";

export interface ServerDeps {
  bin: string; runRoot: string; stateRoot: string; extraArgs: string[];
  webDir: string | null;          // built React app, or null in tests
  configPath?: string;            // for the config editor
}

const COOKIE = "ateam_sid";

export function buildServer(cfg: Config, deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false });
  const store = new EventStore(deps.stateRoot);
  const auth = new AuthStore(cfg.auth.password);
  const dispatcher = new Dispatcher(store, { bin: deps.bin, runRoot: deps.runRoot, extraArgs: deps.extraArgs });

  app.register(websocket);

  function sid(req: any): string | undefined {
    const raw = req.headers.cookie?.split(";").map((s: string) => s.trim())
      .find((s: string) => s.startsWith(`${COOKIE}=`));
    return raw?.slice(COOKIE.length + 1);
  }

  // Auth guard for /api except /api/login
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (req.url === "/api/login") return;
    if (!auth.valid(sid(req))) reply.code(401).send({ error: "unauthorized" });
  });

  app.post("/api/login", async (req, reply) => {
    const pw = (req.body as any)?.password ?? "";
    const id = auth.login(pw);
    if (!id) return reply.code(401).send({ error: "bad password" });
    reply.header("set-cookie", `${COOKIE}=${id}; HttpOnly; Path=/; SameSite=Lax`).send({ ok: true });
  });

  app.post("/api/logout", async (req, reply) => { const s = sid(req); if (s) auth.logout(s); reply.send({ ok: true }); });

  app.get("/api/teams", async () => cfg.teams);

  app.post("/api/teams/:teamId/tasks", async (req, reply) => {
    const { teamId } = req.params as any;
    const { task, agent } = (req.body as any) ?? {};
    const team = cfg.teams.find(t => t.id === teamId);
    if (!team) return reply.code(404).send({ error: "no such team" });
    // fire and forget; events stream over WS
    const p = agent ? dispatcher.runDirect(team, agent, task) : dispatcher.dispatch(team, task);
    const job = await p.catch(() => null);
    reply.send({ jobId: job?.id ?? null });
  });

  // Config editor (behind auth via the hook above)
  app.get("/api/config", async (reply) => {
    if (!deps.configPath || !existsSync(deps.configPath)) return { content: "" };
    return { content: readFileSync(deps.configPath, "utf8") };
  });
  app.post("/api/config", async (req, reply) => {
    if (!deps.configPath) return reply.code(400).send({ error: "no config path" });
    writeFileSync(deps.configPath, (req.body as any)?.content ?? "");
    reply.send({ ok: true, note: "restart to apply" });
  });

  // WebSocket: push every event to all authenticated sockets
  app.register(async (scope) => {
    scope.get("/ws", { websocket: true }, (socket, req) => {
      if (!auth.valid(sid(req))) { socket.close(); return; }
      const off = store.onEvent((e) => { try { socket.send(JSON.stringify(e)); } catch {} });
      socket.on("close", off);
    });
  });

  if (deps.webDir) {
    app.register(fstatic, { root: deps.webDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
      reply.sendFile("index.html");           // SPA fallback
    });
  }

  return app;
}
