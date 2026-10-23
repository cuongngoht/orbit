// A PLAN REVISION: one immutable artifact per revision of the work graph, written BEFORE the journal line that names
// it, and named by its own digest (plans/rev-<n>-<digest8>.json) so an interrupted revision proposed again is the same
// file, never a second one. Each revision says what it replaced, why, which units it touched and which results it
// invalidated: a reset unit's earlier runs no longer count toward its evidence.
import { join } from "node:path";
import { Refused } from "../../../src/errors.mjs";
import { canonicalJson, short } from "../../../src/hash.mjs";
import { missionFile } from "../store/rooms.mjs";
import { isObject, quietly, refused } from "../store/text.mjs";

export const PLAN_API = "orbit.satellite.plan/v1";

const digested = (rev) => ({ ...rev, digest: short(canonicalJson(rev), 16) });

// The action ids whose evidence a reset makes stale: every run of a reset unit, as of now.
const invalidatedBy = (m, reset) => [...m.runs.values()].filter((r) => reset.includes(r.unit)).map((r) => r.action);

export const revisionOf = (x) => digested({ api: PLAN_API, missionId: x.m.meta.id, n: x.m.plans.length + 1, replaces: x.m.plans.at(-1)?.digest ?? null, cause: x.cause, affectedUnits: [...x.units.map((u) => u.id), ...x.cancel, ...x.reset], invalidatedResults: invalidatedBy(x.m, x.reset), evidenceRefs: x.evidenceRefs ?? [], units: x.units, cancelled: x.cancel, reset: x.reset, intentDigest: x.m.intent?.digest ?? null, workflow: x.workflow ?? null, because: x.because ?? null });

export const planFileOf = (rooms, id, rev) => missionFile(rooms, id, "plans", `rev-${rev.n}-${rev.digest.slice(0, 8)}.json`);

export function writeRevision(io, rooms, id, rev) {
  const file = planFileOf(rooms, id, rev);
  if (!io.exists(file)) io.writePrivate(file, `${JSON.stringify(rev, null, 2)}\n`);
  return file;
}

const intactRev = (rev) => isObject(rev) && rev.api === PLAN_API && rev.digest === digested(Object.fromEntries(Object.entries(rev).filter(([k]) => k !== "digest"))).digest;

export function readRevision(io, file) {
  const rev = quietly(() => JSON.parse(io.read(file) ?? "null"));
  if (!intactRev(rev)) throw refused(Refused, "PLAN_UNREADABLE", `${file} is not the plan revision its journal line names`);
  return rev;
}

export const relativePlanFile = (rooms, id, rev) => join("plans", `rev-${rev.n}-${rev.digest.slice(0, 8)}.json`);
