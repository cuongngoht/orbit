import { describe, expect, test } from "vitest";
import type { EmployeeCard } from "@orbit-web/contracts";
import { buildRoute, createWalker, doorwayForZone, stepWalkers, type SimEmployee, type WaypointMap } from "./officeSim";

const WAYPOINTS: WaypointMap = {
  "hall-center": { x: 300, y: 200 },
  "hall-aisle": { x: 300, y: 100 },
  "director-door": { x: 150, y: 140 },
  "pantry-door": { x: 450, y: 140 },
  "pantry-coffee": { x: 430, y: 90 },
  "pantry-sofa": { x: 470, y: 90 },
  "pantry-pingpong": { x: 510, y: 90 },
  "director-visitor-0": { x: 180, y: 90 },
  "desk-ceo-1": { x: 110, y: 90 },
  "dept-door-d1": { x: 150, y: 260 },
  "desk-emp-1": { x: 110, y: 310 },
};

function card(over: Partial<EmployeeCard> = {}): EmployeeCard {
  return {
    id: "ceo-1",
    name: "Eve",
    title: "Director",
    kind: "permanent",
    departmentId: null,
    managerId: null,
    employment: "active",
    availability: "available",
    workLabel: "ready",
    notReadyReason: null,
    holding: null,
    queued: 0,
    execution: { runtime: "claude", connectionId: "conn-1", model: "sonnet", effort: "medium", webSearch: false, orbitPlugin: false },
    connectionWarning: null,
    expiresAt: null,
    role: "ceo",
    version: 1,
    updatedAt: "2026-11-24T00:00:00.000Z",
    ...over,
  };
}

describe("officeSim: CEO in Director's Office", () => {
  test("doorwayForZone maps the director desk key to director-door", () => {
    expect(doorwayForZone("desk", "director", WAYPOINTS)).toEqual(WAYPOINTS["director-door"]);
    expect(doorwayForZone("desk", "d1", WAYPOINTS)).toEqual(WAYPOINTS["dept-door-d1"]);
  });

  test("a waiting CEO stays at their executive desk in Director's Office rather than moving to a visitor slot", () => {
    const waitingCeo: SimEmployee = {
      employee: card({ workLabel: "waiting_review", availability: "busy" }),
      deptKey: "director",
      visitorSlot: 0,
    };
    const w = createWalker(waitingCeo, WAYPOINTS);
    expect(w.targetWp).toBe("desk-ceo-1");
    expect(w.zone).toBe("desk");
    expect(w.activity).toBe("asking");

    const waitingStaff: SimEmployee = {
      employee: card({ id: "emp-1", name: "Ana", role: null, departmentId: "d1", workLabel: "waiting_review", availability: "busy" }),
      deptKey: "d1",
      visitorSlot: 0,
    };
    const staffWalker = createWalker(waitingStaff, WAYPOINTS);
    expect(staffWalker.targetWp).toBe("director-visitor-0");
    expect(staffWalker.zone).toBe("director");
  });

  test("a ready CEO walks out through director-door into the hallway toward the Pantry", () => {
    const readyCeo: SimEmployee = {
      employee: card({ workLabel: "ready", availability: "available" }),
      deptKey: "director",
      visitorSlot: 0,
    };
    const route = buildRoute(WAYPOINTS["desk-ceo-1"]!, "desk", "pantry-coffee", "pantry", "director", WAYPOINTS);
    expect(route).toEqual([
      WAYPOINTS["director-door"],
      { x: WAYPOINTS["director-door"]!.x, y: WAYPOINTS["hall-center"]!.y },
      { x: WAYPOINTS["pantry-door"]!.x, y: WAYPOINTS["hall-center"]!.y },
      WAYPOINTS["pantry-door"],
      WAYPOINTS["pantry-coffee"],
    ]);

    const initial = { ...createWalker(readyCeo, WAYPOINTS), dwellMs: 10 };
    const [stepped] = stepWalkers([initial], [readyCeo], WAYPOINTS, 20, null);
    expect(stepped?.targetZone).toBe("pantry");
    expect(stepped?.targetWp).toBe("pantry-coffee");
    expect(stepped?.path[0]).toEqual(WAYPOINTS["director-door"]);
  });
});
