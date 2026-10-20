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

function lifecycleUnits(model) {
  const units = [...model.units.values()];
  if (units.some((u) => u.state === "running")) return "running";
  if (units.some(unitFailed)) return "blocked";
  if (units.length && units.every(unitDone)) return "verifying";
  return "ready";
}

export const lifecycleSay = (name) => (LIFECYCLE_NAMES.includes(name) ? name : "created");
