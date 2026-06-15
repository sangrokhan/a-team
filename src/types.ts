export interface AgentDef {
  id: string;
  name?: string;          // display name; defaults to id
  role: string;            // persona / system prompt
  model?: string;
}

export interface OrchestratorDef {
  model?: string;
  prompt: string;
}

export interface Team {
  id: string;
  name: string;
  orchestrator: OrchestratorDef;
  agents: AgentDef[];
}

export interface ServerConfig {
  host: string;
  port: number;
}

export interface AuthConfig {
  password: string;
}

export interface Config {
  auth: AuthConfig;
  server: ServerConfig;
  teams: Team[];
}

export type EventType =
  | "job.created" | "plan.ready" | "agent.started" | "agent.output"
  | "agent.done" | "agent.error" | "chat.message" | "job.done";

export interface Event {
  ts: number;
  jobId: string;
  teamId: string;
  agentId?: string;
  type: EventType;
  payload: Record<string, unknown>;
}

export interface Assignment {
  agent: string;     // AgentDef.id
  subtask: string;
}

export interface JobRecord {
  id: string;
  teamId: string;
  task: string;
  target?: string;   // agentId if a direct message; undefined = whole team
  createdAt: number;
  status: "running" | "done" | "error";
}
