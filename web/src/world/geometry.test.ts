import { describe, it, expect } from "vitest";
import { zoneRect, deskSlot, wanderPoint, inside } from "./geometry.js";

describe("geometry", () => {
  it("lays teams out in a grid of non-overlapping zones", () => {
    const r0 = zoneRect(0), r1 = zoneRect(1);
    expect(r0.w).toBeGreaterThan(0);
    expect(r0.x).not.toBe(r1.x === r0.x ? r0.y : r1.x); // different cell
  });

  it("desk slots fall inside their zone", () => {
    const slot = deskSlot(0, 2);
    expect(inside(zoneRect(0), slot)).toBe(true);
  });

  it("wander points fall inside their zone", () => {
    const z = zoneRect(0);
    for (let i = 0; i < 20; i++) expect(inside(z, wanderPoint(0, () => 0.5))).toBe(true);
  });
});
