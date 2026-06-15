import { useCallback, useEffect, useReducer, useState } from "react";
import type { Team, Event, AgentStatus } from "./types.js";
import { fetchTeams, fetchJobs, connectEvents } from "./api.js";
import { applyEvent, emptyWorld, agentKey, type WorldState } from "./world/store.js";
import { useMovement } from "./world/useMovement.js";
import { Floor } from "./world/Floor.js";
import { AgentPanel } from "./panels/AgentPanel.js";
import { LeaderPanel } from "./panels/LeaderPanel.js";
import { AddTeamDialog, AddAgentDialog } from "./panels/AddDialogs.js";
import { Login } from "./Login.js";

type Sel = { kind: "agent"; teamId: string; agentId: string } | { kind: "leader"; teamId: string } | null;
type Dlg = { kind: "team" } | { kind: "agent"; teamId: string } | null;

function reducer(s: WorldState, e: Event): WorldState { return applyEvent(s, e); }

export function App() {
  const [authed, setAuthed] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [world, dispatch] = useReducer(reducer, emptyWorld());
  const [sel, setSel] = useState<Sel>(null);
  const [dlg, setDlg] = useState<Dlg>(null);

  const reloadTeams = useCallback(() => { fetchTeams().then(setTeams).catch(() => setAuthed(false)); }, []);

  useEffect(() => {
    if (!authed) return;
    reloadTeams();
    fetchJobs().catch(() => {});
    const ws = connectEvents((e) => dispatch(e));
    return () => ws.close();
  }, [authed, reloadTeams]);

  const statusOf = useCallback(
    (teamId: string, agentId: string): AgentStatus => world.agents[agentKey(teamId, agentId)]?.status ?? "idle",
    [world],
  );
  const positions = useMovement(teams, statusOf);

  if (!authed) return <Login onOk={() => setAuthed(true)} />;

  const selAgent = sel?.kind === "agent"
    ? teams.find((t) => t.id === sel.teamId)?.agents.find((a) => a.id === sel.agentId) : undefined;
  const selLeaderTeam = sel?.kind === "leader" ? teams.find((t) => t.id === sel.teamId) : undefined;

  return (
    <div style={{ minHeight: "100vh", color: "#e2e8f0", padding: 12 }}>
      <h2 style={{ margin: "4px 0 12px" }}>a-team</h2>
      <Floor
        teams={teams} positions={positions} statusOf={statusOf}
        selectedKey={sel?.kind === "agent" ? agentKey(sel.teamId, sel.agentId) : null}
        onSelectAgent={(teamId, agentId) => setSel({ kind: "agent", teamId, agentId })}
        onSelectLeader={(teamId) => setSel({ kind: "leader", teamId })}
        onAddTeam={() => setDlg({ kind: "team" })}
        onAddAgent={(teamId) => setDlg({ kind: "agent", teamId })}
      />

      {selAgent && sel?.kind === "agent" && (
        <AgentPanel teamId={sel.teamId} agent={selAgent} status={statusOf(sel.teamId, selAgent.id)}
          log={world.agents[agentKey(sel.teamId, selAgent.id)] ?? { status: "idle", output: "", history: [] }}
          onClose={() => setSel(null)} onSaved={reloadTeams} />
      )}
      {selLeaderTeam && <LeaderPanel team={selLeaderTeam} onClose={() => setSel(null)} />}

      {dlg?.kind === "team" && <AddTeamDialog onDone={() => { setDlg(null); reloadTeams(); }} onCancel={() => setDlg(null)} />}
      {dlg?.kind === "agent" && <AddAgentDialog teamId={dlg.teamId} onDone={() => { setDlg(null); reloadTeams(); }} onCancel={() => setDlg(null)} />}
    </div>
  );
}
