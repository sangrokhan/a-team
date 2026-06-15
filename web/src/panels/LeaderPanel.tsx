import { useState } from "react";
import type { Team } from "../types.js";
import { assign } from "../api.js";

export function LeaderPanel({ team, onClose }: { team: Team; onClose: () => void }) {
  const [task, setTask] = useState("");
  async function send() { if (!task.trim()) return; await assign(team.id, task); setTask(""); onClose(); }
  return (
    <div style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <b>🧭 {team.name} — team lead</b>
        <button onClick={onClose} style={{ background: "transparent", color: "#94a3b8", border: 0, cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ fontSize: 11, color: "#64748b", margin: "6px 0" }}>
        Assign a task to the whole team. The lead plans it and delegates to {team.agents.length} agent(s).
      </div>
      <textarea style={ta} value={task} placeholder="what should the team build?"
        onChange={(e) => setTask(e.target.value)} />
      <button onClick={send} style={{ background: "#16a34a", color: "#fff", border: 0, borderRadius: 5, padding: "6px 12px", cursor: "pointer" }}>Assign to team</button>
    </div>
  );
}
const panel: React.CSSProperties = { position: "fixed", right: 12, top: 12, width: 320, background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: 12, color: "#e2e8f0" };
const ta: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 70, background: "#1e293b", border: "1px solid #475569", borderRadius: 5, padding: 7, color: "#e2e8f0", marginBottom: 6, fontFamily: "inherit" };
