import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Team, JobRecord } from "./types.js";
import { EventStore } from "./eventStore.js";
import { runAgent } from "./agentRunner.js";
import { parseAssignments } from "./orchestrator.js";

export interface DispatcherOptions { bin: string; runRoot: string; extraArgs: string[]; }

export class Dispatcher {
  constructor(private store: EventStore, private opts: DispatcherOptions) {}

  private workdir(jobId: string, agentId: string): string {
    const dir = join(this.opts.runRoot, jobId, agentId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private async runOne(job: JobRecord, team: Team, agentId: string, prompt: string) {
    const agent = team.agents.find(a => a.id === agentId)!;
    this.store.appendEvent({ jobId: job.id, teamId: team.id, agentId, type: "agent.started", payload: { prompt } });
    const fullPrompt = `${agent.role}\n\nTask: ${prompt}`;
    const res = await runAgent(
      { bin: this.opts.bin, prompt: fullPrompt, model: agent.model, cwd: this.workdir(job.id, agentId), extraArgs: this.opts.extraArgs },
      (chunk) => this.store.appendEvent({ jobId: job.id, teamId: team.id, agentId, type: "agent.output", payload: { chunk } })
    );
    if (res.code === 0) {
      this.store.appendEvent({ jobId: job.id, teamId: team.id, agentId, type: "agent.done", payload: { text: res.text } });
    } else {
      this.store.appendEvent({ jobId: job.id, teamId: team.id, agentId, type: "agent.error", payload: { code: res.code, stderr: res.stderr } });
    }
    return res.code === 0;
  }

  async dispatch(team: Team, task: string): Promise<JobRecord> {
    const job = this.store.createJob({ teamId: team.id, task });
    try {
      const planRes = await runAgent(
        { bin: this.opts.bin, prompt: `${team.orchestrator.prompt}\n\nTask: ${task}`, model: team.orchestrator.model, cwd: this.workdir(job.id, "orchestrator"), extraArgs: this.opts.extraArgs },
        () => {}
      );
      const assignments = parseAssignments(planRes.text, team.agents.map(a => a.id));
      this.store.appendEvent({ jobId: job.id, teamId: team.id, type: "plan.ready", payload: { assignments } });
      let allOk = true;
      for (const a of assignments) {
        const ok = await this.runOne(job, team, a.agent, a.subtask);
        allOk = allOk && ok;
      }
      this.store.setStatus(job.id, allOk ? "done" : "error");
    } catch (err) {
      this.store.appendEvent({ jobId: job.id, teamId: team.id, type: "agent.error", payload: { error: String(err) } });
      this.store.setStatus(job.id, "error");
    }
    this.store.appendEvent({ jobId: job.id, teamId: team.id, type: "job.done", payload: { status: this.store.readRecord(job.id)?.status } });
    return this.store.readRecord(job.id)!;
  }

  async runDirect(team: Team, agentId: string, message: string): Promise<JobRecord> {
    const job = this.store.createJob({ teamId: team.id, task: message, target: agentId });
    try {
      if (!team.agents.some(a => a.id === agentId)) throw new Error(`unknown agent ${agentId}`);
      const ok = await this.runOne(job, team, agentId, message);
      this.store.setStatus(job.id, ok ? "done" : "error");
    } catch (err) {
      this.store.appendEvent({ jobId: job.id, teamId: team.id, agentId, type: "agent.error", payload: { error: String(err) } });
      this.store.setStatus(job.id, "error");
    }
    this.store.appendEvent({ jobId: job.id, teamId: team.id, type: "job.done", payload: { status: this.store.readRecord(job.id)?.status } });
    return this.store.readRecord(job.id)!;
  }
}
