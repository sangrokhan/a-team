import type { AgentDef, AgentStatus } from "../types.js";
import type { Pt } from "./geometry.js";

const bodyColors = ["#2563eb", "#16a34a", "#9333ea", "#0891b2", "#db2777", "#ca8a04"];
const badge: Record<AgentStatus, string> = { idle: "transparent", running: "#22c55e", error: "#ef4444" };

export function Avatar({ agent, index, pos, status, selected, onClick }: {
  agent: AgentDef; index: number; pos: Pt; status: AgentStatus; selected: boolean; onClick: () => void;
}) {
  const name = agent.name ?? agent.id;
  return (
    <div onClick={onClick}
      style={{ position: "absolute", left: pos.x, top: pos.y, transform: "translate(-50%,-50%)",
        transition: "left .25s linear, top .25s linear", cursor: "pointer", textAlign: "center",
        outline: selected ? "2px solid #38bdf8" : "none", outlineOffset: 3, borderRadius: 4 }}>
      <div style={{ position: "relative", width: 14, margin: "0 auto",
        animation: status === "running" ? "ateam-bob .6s ease-in-out infinite" : undefined }}>
        <div style={{ width: 9, height: 9, margin: "0 auto", borderRadius: 2, background: "#fcd34d" }} />
        <div style={{ width: 14, height: 9, marginTop: 1, borderRadius: 2, background: bodyColors[index % bodyColors.length] }} />
        <span style={{ position: "absolute", top: -4, right: -4, width: 7, height: 7, borderRadius: "50%", background: badge[status] }} />
        {status === "running" && <span style={{ position: "absolute", top: -14, left: 2, fontSize: 9 }}>✎</span>}
      </div>
      <div style={{ fontSize: 8, color: "#e2e8f0", marginTop: 1, whiteSpace: "nowrap" }}>{name}</div>
    </div>
  );
}
