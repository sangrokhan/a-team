import { useEffect, useRef, useState } from "react";
import type { Team, AgentStatus } from "../types.js";
import { deskSlot, wanderPoint, type Pt } from "./geometry.js";

export interface Placed { key: string; teamIndex: number; agentIndex: number; pos: Pt; }

// Computes a live position per agent. Idle agents re-pick a wander target every few seconds;
// running agents target their desk. Positions ease toward targets each tick.
export function useMovement(
  teams: Team[],
  statusOf: (teamId: string, agentId: string) => AgentStatus,
): Record<string, Pt> {
  const [positions, setPositions] = useState<Record<string, Pt>>({});
  const positionsRef = useRef<Record<string, Pt>>({});
  positionsRef.current = positions;
  const targets = useRef<Record<string, Pt>>({});
  const nextWander = useRef<Record<string, number>>({});

  useEffect(() => {
    let raf = 0; let last = 0;
    const tick = (t: number) => {
      if (t - last > 120) {                                  // ~8 fps update is plenty
        last = t;
        const pos: Record<string, Pt> = { ...positionsRef.current };
        teams.forEach((team, ti) => {
          team.agents.forEach((ag, ai) => {
            const key = `${team.id}/${ag.id}`;
            const status = statusOf(team.id, ag.id);
            if (!pos[key]) pos[key] = wanderPoint(ti);
            if (status === "running") {
              targets.current[key] = deskSlot(ti, ai);
            } else if (!targets.current[key] || t > (nextWander.current[key] ?? 0)) {
              targets.current[key] = wanderPoint(ti);
              nextWander.current[key] = t + 2500 + Math.floor((ai + 1) * 700);
            }
            const tg = targets.current[key];
            pos[key] = { x: pos[key].x + (tg.x - pos[key].x) * 0.12, y: pos[key].y + (tg.y - pos[key].y) * 0.12 };
          });
        });
        positionsRef.current = pos;
        setPositions(pos);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [teams, statusOf]);

  return positions;
}
