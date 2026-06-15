import type { Team, Event } from "./types.js";

export async function login(password: string): Promise<boolean> {
  const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
  return r.ok;
}
export async function fetchTeams(): Promise<Team[]> {
  const r = await fetch("/api/teams");
  if (!r.ok) throw new Error("unauthorized");
  return r.json();
}
export async function sendTask(teamId: string, task: string, agent?: string): Promise<string | null> {
  const r = await fetch(`/api/teams/${teamId}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, agent }) });
  return (await r.json()).jobId ?? null;
}
export async function getConfig(): Promise<string> { return (await (await fetch("/api/config")).json()).content; }
export async function saveConfig(content: string): Promise<void> { await fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content }) }); }

export function connectEvents(onEvent: (e: Event) => void): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onmessage = (m) => onEvent(JSON.parse(m.data));
  return ws;
}
