import type { Team } from "../types.js";
import { zoneRect } from "./geometry.js";

export function Zone({ team, index, onLeaderClick }: { team: Team; index: number; onLeaderClick: () => void }) {
  const z = zoneRect(index);
  return (
    <>
      <div style={{ position: "absolute", left: z.x, top: z.y, width: z.w, height: z.h,
        border: "2px solid #b08968", background: "#6b4f3a30", borderRadius: 6 }} />
      <div onClick={onLeaderClick} title="Assign work to this team"
        style={{ position: "absolute", left: z.x + 8, top: z.y + 6, fontSize: 10, color: "#fde68a",
          background: "#0008", padding: "2px 7px", borderRadius: 4, cursor: "pointer" }}>
        🧭 {team.name}
      </div>
    </>
  );
}
