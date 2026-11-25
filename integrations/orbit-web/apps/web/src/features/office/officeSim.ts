// REAL-TIME OFFICE FLOOR WALKING ENGINE: pure waypoint routing across doorways, corridors, desks, Pantry lounges,
// and the Director's Office. One physical walker per employee -- never duplicated -- with realistic human dwell routines.
import type { EmployeeCard, WorkLabel } from "@orbit-web/contracts";
import type { ChibiActivity, ChibiFacing } from "./PixelOfficeArt";
import { presenceKindOf } from "./VirtualDesk";

export interface Point {
  x: number;
  y: number;
}

export type WaypointMap = Record<string, Point>;

export type FloorZone = "desk" | "pantry" | "director" | "hallway";

export interface SimEmployee {
  employee: EmployeeCard;
  deptKey: string;
  visitorSlot: number;
}

export interface WalkerState {
  id: string;
  x: number;
  y: number;
  facing: ChibiFacing;
  walking: boolean;
  stride: 0 | 1;
  activity: ChibiActivity;
  zone: FloorZone;
  targetWp: string;
  targetZone: FloorZone;
  path: Point[];
  dwellMs: number;
  routineStep: number;
  strideClockMs: number;
  lastWorkLabel: WorkLabel;
}

const WALK_SPEED_PX_PER_SEC = 76;
const STRIDE_INTERVAL_MS = 175;

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function dedupePath(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const pt of points) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 4) {
      out.push(pt);
    }
  }
  return out;
}

export function doorwayForZone(zone: FloorZone, deptKey: string, wps: WaypointMap): Point | null {
  if (zone === "director") return wps["director-door"] ?? null;
  if (zone === "pantry") return wps["pantry-door"] ?? null;
  if (zone === "desk") return deptKey === "director" ? (wps["director-door"] ?? null) : (wps[`dept-door-${deptKey}`] ?? null);
  return null;
}

export function buildRoute(
  from: Point,
  fromZone: FloorZone,
  targetWp: string,
  targetZone: FloorZone,
  deptKey: string,
  wps: WaypointMap,
): Point[] {
  const dest = wps[targetWp];
  if (!dest) return [];

  // Same room short walk (e.g., Pantry coffee counter -> Pantry sofa)
  if (fromZone === targetZone && fromZone !== "hallway") {
    return dedupePath([dest]);
  }

  const hallY = wps["hall-center"]?.y ?? from.y;
  const aisleX = wps["hall-aisle"]?.x ?? wps["hall-center"]?.x ?? from.x;
  const points: Point[] = [];

  // Exit origin room through its doorway into the nearest corridor
  if (fromZone !== "hallway") {
    const exitDoor = doorwayForZone(fromZone, deptKey, wps);
    if (exitDoor) {
      points.push(exitDoor);
      const needsInterRowAisle = fromZone === "desk" && exitDoor.y > hallY + 34;
      if (needsInterRowAisle) {
        const outerY = exitDoor.y - 18;
        points.push({ x: exitDoor.x, y: outerY });
        points.push({ x: aisleX, y: outerY });
        points.push({ x: aisleX, y: hallY });
      } else {
        points.push({ x: exitDoor.x, y: hallY });
      }
    }
  } else {
    points.push({ x: from.x, y: hallY });
  }

  // Enter destination room through its doorway
  const enterDoor = doorwayForZone(targetZone, deptKey, wps);
  if (enterDoor) {
    const needsInterRowAisle = targetZone === "desk" && enterDoor.y > hallY + 34;
    if (needsInterRowAisle) {
      const outerY = enterDoor.y - 18;
      points.push({ x: aisleX, y: hallY });
      points.push({ x: aisleX, y: outerY });
      points.push({ x: enterDoor.x, y: outerY });
    } else {
      points.push({ x: enterDoor.x, y: hallY });
    }
    points.push(enterDoor);
  }

  points.push(dest);
  return dedupePath(points);
}

interface TargetSpec {
  wp: string;
  zone: FloorZone;
  activity: ChibiActivity;
  dwellMs: number;
}

function desiredTargetFor(item: SimEmployee, routineStep: number, wps: WaypointMap): TargetSpec {
  const { employee: e, visitorSlot } = item;
  const h = hashId(e.id);
  const kind = presenceKindOf(e.workLabel);

  if (e.workLabel === "working") {
    return { wp: `desk-${e.id}`, zone: "desk", activity: "typing", dwellMs: 12_000 };
  }
  if (kind === "waiting") {
    if (item.deptKey === "director") {
      return { wp: `desk-${e.id}`, zone: "desk", activity: "asking", dwellMs: 12_000 };
    }
    const slotKey = wps[`director-visitor-${visitorSlot % 2}`] ? `director-visitor-${visitorSlot % 2}` : "director-visitor-0";
    return { wp: slotKey, zone: "director", activity: "asking", dwellMs: 12_000 };
  }
  if (e.workLabel === "paused") {
    return { wp: "pantry-sofa", zone: "pantry", activity: "default", dwellMs: 12_000 };
  }
  if (e.workLabel === "not_ready") {
    return { wp: `desk-${e.id}`, zone: "desk", activity: "default", dwellMs: 12_000 };
  }

  // "ready": cycle naturally between desk (pen-spin), coffee counter, Pantry sofa, and ping-pong corner
  const stops: TargetSpec[] = [
    { wp: `desk-${e.id}`, zone: "desk", activity: "pen-spin", dwellMs: 4200 + (h % 2400) },
    { wp: "pantry-coffee", zone: "pantry", activity: "coffee", dwellMs: 5200 + ((h >>> 3) % 2400) },
    { wp: "pantry-sofa", zone: "pantry", activity: "coffee", dwellMs: 5800 + ((h >>> 6) % 2600) },
    { wp: "pantry-pingpong", zone: "pantry", activity: "default", dwellMs: 4600 + ((h >>> 9) % 2400) },
  ];
  return stops[routineStep % stops.length]!;
}

export function resnapIdleWalkers(prev: WalkerState[], wps: WaypointMap): WalkerState[] {
  return prev.map((w) => {
    if (w.path.length > 0) return w;
    const pt = wps[w.targetWp];
    return pt ? { ...w, x: pt.x, y: pt.y } : w;
  });
}

export function createWalker(item: SimEmployee, wps: WaypointMap): WalkerState {
  const h = hashId(item.employee.id);
  const spec = desiredTargetFor(item, 0, wps);
  const origin = wps[spec.wp] ?? wps[`desk-${item.employee.id}`] ?? { x: 0, y: 0 };

  return {
    id: item.employee.id,
    x: origin.x,
    y: origin.y,
    facing: "front",
    walking: false,
    stride: 0,
    activity: spec.activity,
    zone: spec.zone,
    targetWp: spec.wp,
    targetZone: spec.zone,
    path: [],
    // Ready teammates start with a shorter first dwell so you see them walk out to the Pantry within ~2.5-4s
    dwellMs: item.employee.workLabel === "ready" ? 2200 + (h % 1800) : spec.dwellMs,
    routineStep: 0,
    strideClockMs: 0,
    lastWorkLabel: item.employee.workLabel,
  };
}

export function stepWalkers(
  prev: WalkerState[],
  items: SimEmployee[],
  wps: WaypointMap,
  dtMs: number,
  pausedId: string | null,
): WalkerState[] {
  const prevMap = new Map(prev.map((w) => [w.id, w]));

  return items.map((item) => {
    const e = item.employee;
    const cur = prevMap.get(e.id);
    if (!cur) return createWalker(item, wps);

    // Politely pause walking when user opens desk dialogue with this colleague
    if (pausedId === e.id) {
      return { ...cur, walking: false, facing: "front" };
    }

    let next = { ...cur };

    // Immediately redirect along hallway/doorways if live status changed
    if (e.workLabel !== next.lastWorkLabel) {
      const spec = desiredTargetFor(item, 0, wps);
      const route = buildRoute(next, next.zone, spec.wp, spec.zone, item.deptKey, wps);
      next = {
        ...next,
        lastWorkLabel: e.workLabel,
        routineStep: 0,
        targetWp: spec.wp,
        targetZone: spec.zone,
        zone: route.length > 0 && spec.zone !== next.zone ? "hallway" : next.zone,
        activity: spec.activity,
        path: route,
        dwellMs: spec.dwellMs,
      };
    }

    // Move along path if there are waypoints left
    if (next.path.length > 0) {
      const targetPt = next.path[0]!;
      const dx = targetPt.x - next.x;
      const dy = targetPt.y - next.y;
      const dist = Math.hypot(dx, dy);
      const stepDist = (WALK_SPEED_PX_PER_SEC * Math.min(dtMs, 80)) / 1000;

      if (dist <= Math.max(1.5, stepDist)) {
        next.x = targetPt.x;
        next.y = targetPt.y;
        next.path = next.path.slice(1);

        if (next.path.length === 0) {
          next.walking = false;
          next.facing = "front";
          next.zone = next.targetZone;
          next.strideClockMs = 0;
        } else if (next.targetZone !== next.zone) {
          next.zone = "hallway";
        }
      } else {
        const vx = dx / dist;
        const vy = dy / dist;
        next.x += vx * stepDist;
        next.y += vy * stepDist;
        next.walking = true;
        next.facing = Math.abs(dx) >= Math.abs(dy) * 0.45 ? (dx < 0 ? "left" : "right") : "front";
        next.strideClockMs += dtMs;
        if (next.strideClockMs >= STRIDE_INTERVAL_MS) {
          next.strideClockMs %= STRIDE_INTERVAL_MS;
          next.stride = next.stride === 0 ? 1 : 0;
        }
      }
      return next;
    }

    // Dwelling at destination; ready teammates naturally advance to their next office spot
    next.walking = false;
    next.facing = "front";
    next.zone = next.targetZone;

    if (e.workLabel === "ready") {
      next.dwellMs -= dtMs;
      if (next.dwellMs <= 0) {
        const nextStep = (next.routineStep + 1) % 4;
        const spec = desiredTargetFor(item, nextStep, wps);
        const route = buildRoute(next, next.zone, spec.wp, spec.zone, item.deptKey, wps);
        next.routineStep = nextStep;
        next.targetWp = spec.wp;
        next.targetZone = spec.zone;
        next.zone = route.length > 0 && spec.zone !== cur.zone ? "hallway" : cur.zone;
        next.activity = spec.activity;
        next.dwellMs = spec.dwellMs;
        next.path = route;
      }
    }

    return next;
  });
}
