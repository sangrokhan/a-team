import { useEffect, useReducer, useState } from "react";
import type { Team, Event } from "./types.js";
import { fetchTeams, connectEvents } from "./api.js";
import { applyEvent, emptyTeamState, type TeamState } from "./store.js";
import { TeamPanel } from "./TeamPanel.js";
import { ChatThread } from "./ChatThread.js";
import { ConfigEditor } from "./ConfigEditor.js";
import { Login } from "./Login.js";

type States = Record<string, TeamState>;
function reducer(s: States, e: Event): States {
  return { ...s, [e.teamId]: applyEvent(s[e.teamId] ?? emptyTeamState(), e) };
}

export function App() {
  const [authed, setAuthed] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [states, dispatch] = useReducer(reducer, {});
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    if (!authed) return;
    fetchTeams().then(setTeams).catch(() => setAuthed(false));
    const ws = connectEvents((e) => dispatch(e));
    return () => ws.close();
  }, [authed]);

  if (!authed) return <Login onOk={() => setAuthed(true)} />;
  if (showConfig) return (<div><button onClick={() => setShowConfig(false)}>← back</button><ConfigEditor /></div>);

  return (
    <div style={{ padding: 12, background: "#020617", minHeight: "100vh", color: "#e2e8f0" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <h2>a-team</h2><button onClick={() => setShowConfig(true)}>⚙ Config</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {teams.map((t) => {
          const st = states[t.id] ?? emptyTeamState();
          return (
            <div key={t.id} style={{ background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: 10 }}>
              <h3>{t.name}</h3>
              <TeamPanel team={t} status={st.agentStatus} />
              <ChatThread team={t} chat={st.chat} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
