import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Event, JobRecord } from "./types.js";

type NewEvent = Omit<Event, "ts">;
type EventListener = (e: Event) => void;

export class EventStore {
  private listeners = new Set<EventListener>();
  constructor(private root: string) {}

  private jobDir(id: string) { return join(this.root, "jobs", id); }

  onEvent(fn: EventListener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  createJob(input: { teamId: string; task: string; target?: string }): JobRecord {
    const record: JobRecord = {
      id: randomUUID(), teamId: input.teamId, task: input.task,
      target: input.target, createdAt: Date.now(), status: "running",
    };
    mkdirSync(this.jobDir(record.id), { recursive: true });
    writeFileSync(join(this.jobDir(record.id), "record.json"), JSON.stringify(record, null, 2));
    this.appendEvent({ jobId: record.id, teamId: input.teamId, type: "job.created", payload: { task: input.task, target: input.target } });
    return record;
  }

  setStatus(id: string, status: JobRecord["status"]) {
    const rec = this.readRecord(id);
    if (!rec) return;
    rec.status = status;
    writeFileSync(join(this.jobDir(id), "record.json"), JSON.stringify(rec, null, 2));
  }

  appendEvent(e: NewEvent): Event {
    const full: Event = { ...e, ts: Date.now() };
    appendFileSync(join(this.jobDir(e.jobId), "events.jsonl"), JSON.stringify(full) + "\n");
    for (const fn of this.listeners) fn(full);
    return full;
  }

  readRecord(id: string): JobRecord | null {
    const p = join(this.jobDir(id), "record.json");
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
  }

  readEvents(id: string): Event[] {
    const p = join(this.jobDir(id), "events.jsonl");
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
  }
}
