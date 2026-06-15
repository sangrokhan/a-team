import type { Team, Event, AgentDef, JobRecord } from "./types.js";

async function jpost(url: string, body: unknown) {
  return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export async function login(password: string): Promise<boolean> {
  return (await jpost("/api/login", { password })).ok;
}
export async function fetchTeams(): Promise<Team[]> {
  const r = await fetch("/api/teams");
  if (!r.ok) throw new Error("unauthorized");
  return r.json();
}
export async function assign(teamId: string, task: string, agent?: string): Promise<string | null> {
  const r = await jpost(`/api/teams/${teamId}/tasks`, { task, agent });
  return (await r.json()).jobId ?? null;
}
export async function updateAgent(teamId: string, agentId: string, patch: { name?: string; role?: string }): Promise<AgentDef> {
  const r = await fetch(`/api/teams/${teamId}/agents/${agentId}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
  });
  return r.json();
}
export async function addAgent(teamId: string, def: { id: string; role: string; name?: string }): Promise<AgentDef> {
  return (await jpost(`/api/teams/${teamId}/agents`, def)).json();
}
export async function addTeam(def: { id: string; name: string }): Promise<Team> {
  return (await jpost("/api/teams", def)).json();
}
export async function fetchJobs(agent?: string): Promise<JobRecord[]> {
  const q = agent ? `?agent=${encodeURIComponent(agent)}` : "";
  return (await fetch(`/api/jobs${q}`)).json();
}
export function connectEvents(onEvent: (e: Event) => void): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (m) => onEvent(JSON.parse(m.data));
  return ws;
}
