import { useEffect, useState } from "react";
import type { AgentDef, AgentStatus } from "../types.js";
import type { AgentLog } from "../world/store.js";
import { assign, updateAgent } from "../api.js";

const pill: Record<AgentStatus, string> = { idle: "#334155", running: "#14532d", error: "#7f1d1d" };

export function AgentPanel({ teamId, agent, status, log, onClose, onSaved }: {
  teamId: string; agent: AgentDef; status: AgentStatus; log: AgentLog;
  onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(agent.name ?? agent.id);
  const [role, setRole] = useState(agent.role);
  const [msg, setMsg] = useState("");
  useEffect(() => { setName(agent.name ?? agent.id); setRole(agent.role); }, [agent.id]);

  async function save() { await updateAgent(teamId, agent.id, { name, role }); onSaved(); }
  async function send() { if (!msg.trim()) return; await assign(teamId, msg, agent.id); setMsg(""); }

  return (
    <div style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b>{agent.name ?? agent.id}</b>
        <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 99, background: pill[status], color: "#e2e8f0" }}>● {status}</span>
          <button onClick={onClose} style={btnGhost}>✕</button>
        </span>
      </div>
      <div style={{ fontSize: 10, color: "#64748b", margin: "2px 0 10px" }}>{teamId} · {agent.id}</div>

      <Label>Name</Label>
      <input style={inp} value={name} onChange={(e) => setName(e.target.value)} />
      <Label>Persona / role prompt</Label>
      <textarea style={{ ...inp, minHeight: 56 }} value={role} onChange={(e) => setRole(e.target.value)} />
      <button onClick={save} style={btn}>Save persona</button>

      <Label>Direct message / assign job</Label>
      <input style={inp} value={msg} placeholder="tell this agent to do something…"
        onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
      <button onClick={send} style={{ ...btn, background: "#16a34a" }}>Assign to {agent.id}</button>

      <Label>Running job</Label>
      {log.currentJob
        ? <pre style={out}>{log.output || "…"}</pre>
        : <div style={{ fontSize: 11, color: "#64748b" }}>idle</div>}
      <Label>History</Label>
      {log.history.length === 0 && <div style={{ fontSize: 11, color: "#64748b" }}>none yet</div>}
      {log.history.map((h, i) => (
        <div key={i} style={{ fontSize: 11, color: h.status === "error" ? "#f87171" : "#cbd5e1",
          borderTop: "1px solid #1e293b", padding: "4px 0" }}>
          {h.status === "error" ? "✕" : "✓"} {h.text.slice(0, 120)}
        </div>
      ))}
    </div>
  );
}

function Label({ children }: { children: string }) {
  return <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".05em", color: "#64748b", margin: "10px 0 3px" }}>{children}</div>;
}
const panel: React.CSSProperties = { position: "fixed", right: 12, top: 12, bottom: 12, width: 320, overflow: "auto", background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: 12, color: "#e2e8f0", fontSize: 12 };
const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#1e293b", border: "1px solid #475569", borderRadius: 5, padding: "5px 7px", color: "#e2e8f0", fontFamily: "inherit" };
const btn: React.CSSProperties = { marginTop: 6, background: "#1d4ed8", color: "#fff", border: 0, borderRadius: 5, padding: "5px 10px", cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "transparent", color: "#94a3b8", border: 0, cursor: "pointer", fontSize: 14 };
const out: React.CSSProperties = { background: "#0b1220", borderRadius: 6, padding: 6, fontSize: 10, color: "#86efac", whiteSpace: "pre-wrap", maxHeight: 140, overflow: "auto" };
