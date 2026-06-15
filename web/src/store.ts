import type { Event, AgentStatus } from "./types.js";

export interface ChatMsg { who: string; text: string; ts: number; kind: "user" | "agent" | "error" | "system"; }
export interface TeamState { agentStatus: Record<string, AgentStatus>; chat: ChatMsg[]; }

export function emptyTeamState(): TeamState { return { agentStatus: {}, chat: [] }; }

export function applyEvent(state: TeamState, e: Event): TeamState {
  const agentStatus = { ...state.agentStatus };
  const chat = [...state.chat];
  switch (e.type) {
    case "job.created":
      chat.push({ who: "you", text: String(e.payload.task ?? ""), ts: e.ts, kind: "user" }); break;
    case "plan.ready":
      chat.push({ who: "🧭 orchestrator", text: "Plan: " + JSON.stringify(e.payload.assignments), ts: e.ts, kind: "system" }); break;
    case "agent.started":
      if (e.agentId) agentStatus[e.agentId] = "running"; break;
    case "agent.done":
      if (e.agentId) agentStatus[e.agentId] = "idle";
      chat.push({ who: e.agentId ?? "agent", text: String(e.payload.text ?? "(done)"), ts: e.ts, kind: "agent" }); break;
    case "agent.error":
      if (e.agentId) agentStatus[e.agentId] = "error";
      chat.push({ who: e.agentId ?? "agent", text: "Error: " + JSON.stringify(e.payload), ts: e.ts, kind: "error" }); break;
  }
  return { agentStatus, chat };
}
