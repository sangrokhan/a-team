import type { Event, AgentStatus } from "./types.js";

export interface ChatMsg { who: string; text: string; ts: number; kind: "user" | "agent" | "error" | "system"; streaming?: boolean; }
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
    case "agent.output": {
      if (!e.agentId) break;
      const chunk = String(e.payload.chunk ?? "");
      const last = chat[chat.length - 1];
      if (last && last.kind === "agent" && last.who === e.agentId && last.streaming) {
        chat[chat.length - 1] = { ...last, text: last.text + chunk };
      } else {
        chat.push({ who: e.agentId, text: chunk, ts: e.ts, kind: "agent", streaming: true });
      }
      break;
    }
    case "agent.done": {
      if (e.agentId) agentStatus[e.agentId] = "idle";
      const last = chat[chat.length - 1];
      if (last && last.kind === "agent" && last.who === e.agentId && last.streaming) {
        chat[chat.length - 1] = { ...last, text: String(e.payload.text ?? last.text), streaming: false };
      } else {
        chat.push({ who: e.agentId ?? "agent", text: String(e.payload.text ?? "(done)"), ts: e.ts, kind: "agent" });
      }
      break;
    }
    case "agent.error":
      if (e.agentId) agentStatus[e.agentId] = "error";
      chat.push({ who: e.agentId ?? "agent", text: "Error: " + JSON.stringify(e.payload), ts: e.ts, kind: "error" }); break;
  }
  return { agentStatus, chat };
}
