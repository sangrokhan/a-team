import { useState } from "react";
import { addAgent, addTeam } from "../api.js";

export function AddTeamDialog({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [id, setId] = useState(""); const [name, setName] = useState(""); const [err, setErr] = useState("");
  async function go() {
    const r = await addTeam({ id: id.trim(), name: name.trim() || id.trim() });
    if ((r as any).error) { setErr((r as any).error); return; }
    onDone();
  }
  return <Modal title="Add team" err={err} onCancel={onCancel} onOk={go}>
    <Field v={id} set={setId} ph="team id (e.g. data)" />
    <Field v={name} set={setName} ph="display name" />
  </Modal>;
}

export function AddAgentDialog({ teamId, onDone, onCancel }: { teamId: string; onDone: () => void; onCancel: () => void }) {
  const [id, setId] = useState(""); const [role, setRole] = useState(""); const [err, setErr] = useState("");
  async function go() {
    const r = await addAgent(teamId, { id: id.trim(), role: role.trim() || "Agent" });
    if ((r as any).error) { setErr((r as any).error); return; }
    onDone();
  }
  return <Modal title={`Add agent to ${teamId}`} err={err} onCancel={onCancel} onOk={go}>
    <Field v={id} set={setId} ph="agent id (e.g. analyst)" />
    <Field v={role} set={setRole} ph="persona / role" />
  </Modal>;
}

function Field({ v, set, ph }: { v: string; set: (s: string) => void; ph: string }) {
  return <input value={v} placeholder={ph} onChange={(e) => set(e.target.value)}
    style={{ width: "100%", boxSizing: "border-box", margin: "4px 0", background: "#1e293b", border: "1px solid #475569", borderRadius: 5, padding: "6px 8px", color: "#e2e8f0" }} />;
}
function Modal({ title, children, err, onCancel, onOk }: { title: string; children: React.ReactNode; err: string; onCancel: () => void; onOk: () => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#0009", display: "grid", placeItems: "center" }}>
      <div style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 10, padding: 16, width: 300, color: "#e2e8f0" }}>
        <b>{title}</b>
        <div style={{ margin: "10px 0" }}>{children}</div>
        {err && <div style={{ color: "#f87171", fontSize: 11, marginBottom: 6 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ background: "#334155", color: "#e2e8f0", border: 0, borderRadius: 5, padding: "5px 10px", cursor: "pointer" }}>Cancel</button>
          <button onClick={onOk} style={{ background: "#1d4ed8", color: "#fff", border: 0, borderRadius: 5, padding: "5px 10px", cursor: "pointer" }}>Add</button>
        </div>
      </div>
    </div>
  );
}
