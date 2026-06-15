import type { Team, AgentDef } from "./types.js";
import { writeConfig } from "./configWriter.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const DEFAULT_ORCHESTRATOR = {
  model: "opus",
  prompt:
    "You are the team lead. Break the task into subtasks and assign each to exactly one " +
    'agent by id. Respond ONLY with a fenced ```json block: ' +
    '{"assignments":[{"agent":"<id>","subtask":"<text>"}]}.',
};

export class RosterStore {
  constructor(private teams: Team[], private configPath: string | null) {}

  getTeams(): Team[] { return this.teams; }
  getTeam(id: string): Team | undefined { return this.teams.find((t) => t.id === id); }

  updateAgent(teamId: string, agentId: string, patch: { name?: string; role?: string }): AgentDef {
    const team = this.requireTeam(teamId);
    const agent = team.agents.find((a) => a.id === agentId);
    if (!agent) throw new HttpError(404, `no such agent ${agentId}`);
    const prev = { name: agent.name, role: agent.role };
    if (patch.name !== undefined) agent.name = patch.name;
    if (patch.role !== undefined) agent.role = patch.role;
    this.persist(() => { agent.name = prev.name; agent.role = prev.role; });
    return agent;
  }

  addAgent(teamId: string, def: { id: string; role: string; name?: string }): AgentDef {
    const team = this.requireTeam(teamId);
    if (team.agents.some((a) => a.id === def.id)) throw new HttpError(409, `duplicate agent id ${def.id}`);
    const agent: AgentDef = { id: def.id, name: def.name ?? def.id, role: def.role, model: "sonnet" };
    team.agents.push(agent);
    this.persist(() => { team.agents.pop(); });
    return agent;
  }

  addTeam(def: { id: string; name: string }): Team {
    if (this.teams.some((t) => t.id === def.id)) throw new HttpError(409, `duplicate team id ${def.id}`);
    const team: Team = { id: def.id, name: def.name, orchestrator: { ...DEFAULT_ORCHESTRATOR }, agents: [] };
    this.teams.push(team);
    this.persist(() => { this.teams.pop(); });
    return team;
  }

  private requireTeam(teamId: string): Team {
    const t = this.getTeam(teamId);
    if (!t) throw new HttpError(404, `no such team ${teamId}`);
    return t;
  }

  // Persist to disk; if the write fails, run `rollback` so memory matches disk, then rethrow.
  private persist(rollback: () => void): void {
    if (!this.configPath) return;
    try { writeConfig(this.configPath, this.teams); }
    catch (err) { rollback(); throw new HttpError(500, `failed to persist config: ${String(err)}`); }
  }
}
