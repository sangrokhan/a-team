import { ReactFlow, Background, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Team, AgentStatus } from "./types.js";

const color: Record<AgentStatus, string> = { idle: "#475569", running: "#22c55e", error: "#ef4444" };

export function TeamPanel({ team, status }: { team: Team; status: Record<string, AgentStatus> }) {
  const nodes: Node[] = [
    { id: `${team.id}-orch`, position: { x: 140, y: 0 }, data: { label: "🧭 Orchestrator" },
      style: { border: "2px solid #3b82f6", borderRadius: 8, padding: 6, background: "#0f172a", color: "#e2e8f0" } },
    ...team.agents.map((a, i): Node => ({
      id: `${team.id}-${a.id}`, position: { x: i * 160, y: 120 }, data: { label: `${a.id}` },
      style: { border: `2px solid ${color[status[a.id] ?? "idle"]}`, borderRadius: 8, padding: 6, background: "#1e293b", color: "#e2e8f0" },
    })),
  ];
  const edges: Edge[] = team.agents.map((a): Edge => ({
    id: `${team.id}-e-${a.id}`, source: `${team.id}-orch`, target: `${team.id}-${a.id}`, animated: status[a.id] === "running",
  }));
  return (
    <div style={{ height: 240, border: "1px solid #334155", borderRadius: 8 }}>
      <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
        <Background />
      </ReactFlow>
    </div>
  );
}
