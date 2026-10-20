import { LIFECYCLE_NAMES } from "./vocab.mjs";

const unitDone = (u) => ["completed", "skipped"].includes(u.state);
const unitFailed = (u) => u.state === "failed" || u.state === "blocked";

const META = [
  { when: (m) => m.cancelled, name: "cancelled" },
  { when: (m) => m.verified?.outcome === "completed", name: "completed" },
  { when: (m) => m.verified?.outcome === "failed", name: "failed" },
  { when: (m) => m.verified?.outcome === "partial", name: "partial" },
  { when: (m) => m.paused, name: "paused" },
  { when: (m) => !m.analyzed, name: (m) => (m.spec ? "analyzing" : "created") },
  { when: (m) => !m.plan, name: "analyzing" },
  { when: () => true, name: (m) => lifecycleUnits(m) },
];

export function lifecycleOf(model) {
  const row = META.find((r) => r.when(model));
  const name = typeof row.name === "function" ? row.name(model) : row.name;
  return name;
}

// Where a planned goal stands, from its units: the first row that holds. A unit a missing prerequisite blocks waits
// for a person (`waiting-input`) -- never a guess.
const UNIT_LIFE = [
  { when: (units) => units.some((u) => u.state === "running"), name: "running" },
  { when: (units) => units.some(unitFailed), name: "blocked" },
  { when: (units) => units.some((u) => u.state === "unresolved"), name: "waiting-input" },
  { when: (units) => units.length > 0 && units.every(unitDone), name: "verifying" },
  { when: () => true, name: "ready" },
];

function lifecycleUnits(model) {
  const units = [...model.units.values()];
  return UNIT_LIFE.find((r) => r.when(units)).name;
}

export const lifecycleSay = (name) => (LIFECYCLE_NAMES.includes(name) ? name : "created");
