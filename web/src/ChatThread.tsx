import { useState } from "react";
import type { Team } from "./types.js";
import type { ChatMsg } from "./store.js";
import { sendTask } from "./api.js";

export function ChatThread({ team, chat }: { team: Team; chat: ChatMsg[] }) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");   // "" = whole team (orchestrator)

  async function submit() {
    if (!text.trim()) return;
    await sendTask(team.id, text, target || undefined);
    setText("");
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ maxHeight: 180, overflow: "auto", background: "#0b1220", borderRadius: 6, padding: 6 }}>
        {chat.map((m, i) => (
          <div key={i} style={{ color: m.kind === "error" ? "#f87171" : "#cbd5e1", fontSize: 12 }}>
            <b style={{ color: "#60a5fa" }}>{m.who}:</b> {m.text}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Team ▾</option>
          {team.agents.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}
        </select>
        <input style={{ flex: 1 }} value={text} placeholder="task or message…"
          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <button onClick={submit}>Send</button>
      </div>
    </div>
  );
}
