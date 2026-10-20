// A coordinated workflow's PLAN as a LIVE SOURCE (1.8.6, ADR 0022): which plan artifact is active, read by its digest
// from the coordinator's own room, and the projection a viewer draws -- handed to src/live/ by a composition root
// (cli/live.mjs), never imported there, the way the activity source is. Before 1.8.6 a viewer read a plan's steps
// out of its receipt's summary sentence, cut at 240 characters; the artifact itself says what waits for what, why
// each step is there, what it must prove and every revision -- and a viewer that cannot read it still has the
// sentence.
//
//   PLAN_SOURCE
//     activeRef(view) -> digest | null              the ACTIVE plan receipt's ref
//     open(storeRoot, io) -> { read(task, ref) }    the projection, or null for an artifact that is gone, unreadable,
//                                                   or not what its digest says (a hand edit is never drawn)
//     projectionOf(plan) -> { ref, schema, n, workflow, limit, steps, replans }
//       step: { id, kind, after, for, provides, because, goal, strict, obligation }
import { join } from "node:path";
import { digestOf } from "./plan.mjs";
import { kindOf } from "./steps.mjs";
import { DOMAIN, MAX_REVISIONS, MAX_STEPS } from "./vocab.mjs";

const TASK = /^tsk-[a-f0-9]{12}$/;

const DIGEST = /^[a-f0-9]{16}$/;

const parsed = (text) => {
  try { return text === null || text === undefined ? null : JSON.parse(text); }
  catch { return null; }
};

export const activeRef = (view) => (view?.receipts ?? []).filter((r) => r.domain === DOMAIN.PLAN && r.outcome === "ACTIVE").at(-1)?.ref ?? null;

const stepOf = (s) => ((k) => ({ id: s.id, kind: s.kind, after: Array.isArray(s.after) ? s.after : [], for: s.for ?? null, provides: s.provides ?? null, because: s.because ?? k?.goal ?? null, goal: k?.goal ?? null, strict: k?.strict === true, obligation: k?.obligation ?? null }))(kindOf(s.kind));

const replanOf = (r) => ({ n: r.n, trigger: r.trigger, response: r.response, step: r.step ?? null, summary: r.summary ?? null });

export const projectionOf = (plan) => ({ ref: plan.digest, schema: plan.schema, n: plan.n, workflow: plan.workflow, limit: plan.limit ?? null, steps: (plan.steps ?? []).slice(0, MAX_STEPS).map(stepOf), replans: (plan.replans ?? []).slice(-MAX_REVISIONS).map(replanOf) });

const usable = (plan, ref) => Boolean(plan) && Array.isArray(plan.steps) && plan.digest === ref && digestOf(plan) === ref;

// Only a task id and a digest of their own shapes make a path: nothing a journal says can point a read elsewhere.
function readPlan(storeRoot, io, task, ref) {
  if (!TASK.test(String(task)) || !DIGEST.test(String(ref))) return null;
  const plan = parsed(io.read(join(storeRoot, "automation", task, "plans", `${ref}.json`)));
  return usable(plan, ref) ? projectionOf(plan) : null;
}

export const PLAN_SOURCE = Object.freeze({
  version: 1,
  activeRef,
  open: (storeRoot, io) => ({ read: (task, ref) => readPlan(storeRoot, io, task, ref) }),
  projectionOf,
});
