import type { Team, AgentStatus } from "../types.js";
import type { Pt } from "./geometry.js";
import { zoneRect, FLOOR } from "./geometry.js";
import { Zone } from "./Zone.js";
import { Avatar } from "./Avatar.js";

export function Floor({ teams, positions, statusOf, selectedKey, onSelectAgent, onSelectLeader, onAddTeam, onAddAgent }: {
  teams: Team[];
  positions: Record<string, Pt>;
  statusOf: (teamId: string, agentId: string) => AgentStatus;
  selectedKey: string | null;
  onSelectAgent: (teamId: string, agentId: string) => void;
  onSelectLeader: (teamId: string) => void;
  onAddTeam: () => void;
  onAddAgent: (teamId: string) => void;
}) {
  const rows = Math.ceil((teams.length + 1) / FLOOR.cols);
  const width = FLOOR.cols * (FLOOR.zoneW + FLOOR.gap) + FLOOR.gap;
  const height = rows * (FLOOR.zoneH + FLOOR.gap) + FLOOR.gap;
  const addRect = zoneRect(teams.length);

  return (
    <div style={{ position: "relative", width, height, margin: "0 auto",
      background: "#3b4a63", backgroundImage:
        "linear-gradient(#ffffff10 1px,transparent 1px),linear-gradient(90deg,#ffffff10 1px,transparent 1px)",
      backgroundSize: "20px 20px", borderRadius: 10 }}>
      {teams.map((team, ti) => (
        <div key={team.id}>
          <Zone team={team} index={ti} onLeaderClick={() => onSelectLeader(team.id)} />
          <div onClick={() => onAddAgent(team.id)}
            style={{ position: "absolute", left: zoneRect(ti).x + 8, top: zoneRect(ti).y + zoneRect(ti).h - 22,
              fontSize: 9, color: "#cbd5e1", cursor: "pointer" }}>＋ add agent</div>
          {team.agents.map((ag, ai) => {
            const key = `${team.id}/${ag.id}`;
            const pos = positions[key] ?? { x: zoneRect(ti).x + 40, y: zoneRect(ti).y + 40 };
            return <Avatar key={ag.id} agent={ag} index={ai} pos={pos} status={statusOf(team.id, ag.id)}
              selected={selectedKey === key} onClick={() => onSelectAgent(team.id, ag.id)} />;
          })}
        </div>
      ))}
      <div onClick={onAddTeam}
        style={{ position: "absolute", left: addRect.x, top: addRect.y, width: addRect.w, height: addRect.h,
          border: "2px dashed #64748b", borderRadius: 6, display: "grid", placeItems: "center",
          color: "#94a3b8", cursor: "pointer" }}>＋ Add team</div>
    </div>
  );
}
