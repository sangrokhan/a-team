import type { Event, AgentStatus } from "../types.js";

export interface AgentLog {
  status: AgentStatus;
  currentJob?: string;
  output: string;                                    // live streamed text of the current job
  history: { jobId: string; status: string; text: string }[];
}
export interface WorldState { agents: Record<string, AgentLog>; }

export function agentKey(teamId: string, agentId: string): string { return `${teamId}/${agentId}`; }
export function emptyWorld(): WorldState { return { agents: {} }; }
function blank(): AgentLog { return { status: "idle", output: "", history: [] }; }

export function applyEvent(state: WorldState, e: Event): WorldState {
  if (!e.agentId) return state;
  const key = agentKey(e.teamId, e.agentId);
  const agents = { ...state.agents };
  const a: AgentLog = { ...(agents[key] ?? blank()) };

  switch (e.type) {
    case "agent.started":
      a.status = "running"; a.currentJob = e.jobId; a.output = ""; break;
    case "agent.output":
      a.output += String(e.payload?.chunk ?? ""); break;
    case "agent.done":
      a.status = "idle";
      a.history = [{ jobId: e.jobId, status: "done", text: String(e.payload?.text ?? a.output) }, ...a.history].slice(0, 20);
      a.currentJob = undefined; break;
    case "agent.error":
      a.status = "error";
      a.history = [{ jobId: e.jobId, status: "error", text: JSON.stringify(e.payload) }, ...a.history].slice(0, 20);
      a.currentJob = undefined; break;
    default:
      return state;
  }
  agents[key] = a;
  return { agents };
}
