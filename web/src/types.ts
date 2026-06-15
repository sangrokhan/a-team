export interface AgentDef { id: string; name?: string; role: string; model?: string; }
export interface Team { id: string; name: string; orchestrator: { model?: string; prompt: string }; agents: AgentDef[]; }

export type EventType =
  | "job.created" | "plan.ready" | "agent.started" | "agent.output"
  | "agent.done" | "agent.error" | "chat.message" | "job.done";
export interface Event { ts: number; jobId: string; teamId: string; agentId?: string; type: EventType; payload: any; }

export interface JobRecord { id: string; teamId: string; task: string; target?: string; createdAt: number; status: "running" | "done" | "error"; }
export type AgentStatus = "idle" | "running" | "error";
