export interface Rect { x: number; y: number; w: number; h: number; }
export interface Pt { x: number; y: number; }

const ZONE_W = 320, ZONE_H = 240, GAP = 24, COLS = 2, PAD = 28;

// Zone i is placed in a 2-column grid.
export function zoneRect(i: number): Rect {
  const col = i % COLS, row = Math.floor(i / COLS);
  return { x: GAP + col * (ZONE_W + GAP), y: GAP + row * (ZONE_H + GAP), w: ZONE_W, h: ZONE_H };
}

// A stable desk position for agent index `j` inside zone `i` (row of desks near the bottom).
export function deskSlot(i: number, j: number): Pt {
  const z = zoneRect(i);
  const perRow = 3;
  const col = j % perRow, row = Math.floor(j / perRow);
  return { x: z.x + PAD + col * 90, y: z.y + z.h - PAD - 24 - row * 56 };
}

// A random point well inside zone `i`. `rng` defaults to Math.random; injectable for tests.
export function wanderPoint(i: number, rng: () => number = Math.random): Pt {
  const z = zoneRect(i);
  return { x: z.x + PAD + rng() * (z.w - 2 * PAD), y: z.y + PAD + rng() * (z.h - 2 * PAD) };
}

export function inside(z: Rect, p: Pt): boolean {
  return p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h;
}

export const FLOOR = { zoneW: ZONE_W, zoneH: ZONE_H, gap: GAP, cols: COLS };
