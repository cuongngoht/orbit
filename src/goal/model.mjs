import { Refused } from "../errors.mjs";
import { lifecycleOf, lifecycleSay } from "./lifecycle.mjs";
import { GOAL_SCHEMA, PREFIX } from "./vocab.mjs";

export { lifecycleOf, lifecycleSay };

export function readable(meta) {
  if (meta && meta.schema !== GOAL_SCHEMA) throw new Refused(`this goal was written by a newer Orbit (journal format ${meta.schema}); upgrade the plugin before working on it`);
  return meta;
}

const emptyModel = () => ({ meta: null, spec: null, analyzed: null, plan: null, units: new Map(), ac: new Map(), replans: [], verified: null, paused: false, records: [] });

const FOLDS = {
  created: (m, r) => { m.meta = r; },
  spec: (m, r) => { m.spec = r; },
  analyzed: (m, r) => { m.analyzed = r; },
  planned: (m, r) => { m.plan = r; m.units = new Map((r.units ?? []).map((u) => [u.id, { ...u, state: u.state ?? "planned" }])); },
  replanned: (m, r) => { m.replans.push(r); m.plan = { id: r.plan, digest: r.digest, units: r.units }; m.units = new Map((r.units ?? []).map((u) => [u.id, { ...u }])); },
  unit: (m, r) => { const u = m.units.get(r.unit); if (u) m.units.set(r.unit, { ...u, ...r, state: r.state ?? u.state }); },
  ac: (m, r) => { m.ac.set(r.ac, r); },
  verified: (m, r) => { m.verified = r; },
  paused: (m, r) => { m.paused = true; },
  resumed: (m, r) => { m.paused = false; },
  cancelled: (m, r) => { m.cancelled = r; },
};

export function modelOf(records) {
  const model = emptyModel();
  for (const line of records) FOLDS[line.kind]?.(model, line);
  if (model.meta) readable(model.meta);
  return Object.assign(model, { records, position: records.length, revision: records.length });
}

export const nextId = (model, kind) => `${PREFIX[kind]}-${model.records.filter((r) => r.kind === kind).length + 1}`;

const unitDone = (u) => ["completed", "skipped"].includes(u.state);

export function frontierOf(model) {
  const units = [...model.units.values()];
  const done = new Set(units.filter(unitDone).map((u) => u.id));
  return units.filter((u) => u.state === "planned" || u.state === "ready").filter((u) => (u.dependsOn ?? []).every((d) => done.has(d))).sort((a, b) => a.id.localeCompare(b.id));
}

export function acCoverage(model) {
  const acs = model.analyzed?.acceptance ?? [];
  const verified = acs.filter((a) => model.ac.get(a.id)?.state === "verified").length;
  return { total: acs.length, verified };
}

export function unitProgress(model) {
  const units = [...model.units.values()];
  const verified = units.filter(unitDone).length;
  return { total: units.length, verified };
}
