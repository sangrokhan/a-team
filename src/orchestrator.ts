import type { Assignment } from "./types.js";

export function parseAssignments(output: string, validAgentIds: string[]): Assignment[] {
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : output.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) throw new Error("orchestrator: no plan JSON found in output");

  let parsed: { assignments?: Assignment[] };
  try { parsed = JSON.parse(candidate.trim()); }
  catch { throw new Error("orchestrator: plan JSON is malformed"); }

  const assignments = parsed.assignments ?? [];
  if (!assignments.length) throw new Error("orchestrator: plan has no assignments");
  for (const a of assignments) {
    if (!validAgentIds.includes(a.agent)) throw new Error(`orchestrator: unknown agent ${a.agent}`);
  }
  return assignments;
}
