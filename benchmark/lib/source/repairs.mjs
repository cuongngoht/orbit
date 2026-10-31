// REPAIR CONTROLS carried straight to the JUDGE: a candidate built from its definition (a case's controls/<file>.json:
// exact mutations, files it brings, files it deletes) over the run's own copy of the variant it repairs -- no runner, no
// host, no model -- then held to SCOPE, laid over the subject, verified in the verifier's own containers with its own
// regression test run before and after it, and judged by the very rule a round's candidate is (`isVerified`). What it
// proves is the judge: a real repair passes, and every way of cheating a verifier -- a test deleted, weakened or
// skipped, a check or the harness touched, a process smuggled in, a "regression test" that proves nothing, a candidate
// that hangs -- is refused by name. A control that names what must refuse it (`rejects`) is matched only when every one
// of those names is among what refused it.
//
//   judgedRepair(ctx, c, r, cache) -> { id, kind, through, expect, got, matched, rejects, found, summary, digest }
//   variantEntriesOf(ctx, c, variant) -> entries        candidateOfDefinition(ctx, base, doc) -> candidate
import { Refused } from "../../../src/errors.mjs";
import { candidateEntries, candidateFile } from "../core/mutations.mjs";
import { variantEntries } from "../core/context.mjs";
import { changesOf } from "./candidate.mjs";
import { isVerified, verificationSummary } from "./flow.mjs";
import { assembled } from "./round.mjs";
import { verified } from "./verify.mjs";

const drifted = (what, m) => {
  throw Object.assign(new Refused(`FIXTURE_DRIFT: ${what} does not apply to this source (${m.drift.mutation} in ${m.drift.file})`), { code: "FIXTURE_DRIFT", drift: m.drift });
};

// The variant's tree, from the run's own frozen subject: the faults it plants applied to a copy, never to a checkout.
export function variantEntriesOf(ctx, c, variant) {
  const m = variantEntries({ ...c, dir: ctx.frozenCase }, variant, ctx.baseline);
  return m.ok ? m.entries : drifted(`the ${variant} variant`, m);
}

// What a workspace listing says of a tree, as the inspection says it: path, kind, digest and size.
const listingOf = (entries) => entries.map((e) => ({ rel: e.rel, kind: e.mode === "exec" ? "exec" : "file", digest: e.digest, size: e.bytes?.length ?? 0 }));

const textsOf = (base, after) => ((was, now) => (rel, side) => (side === "before" ? was.get(rel) : now.get(rel)) ?? null)(new Map(base.map((e) => [e.rel, e.bytes?.toString("utf8")])), new Map(after.map((e) => [e.rel, e.bytes?.toString("utf8")])));

// The candidate as a round would have left it: its changes against the variant's tree, its text the definition's.
export function candidateOfDefinition(ctx, base, doc) {
  const after = candidateEntries(base, doc);
  if (!after.ok) drifted(`candidate ${doc.id}`, after);
  return assembled({ ...ctx, baseline: base }, changesOf(base, listingOf(after.entries)), textsOf(base, after.entries), []);
}

// The variant verified once, as a subject, for every control that repairs it: what its gates ran is what a candidate's
// gates must run, and what held on it is what a candidate may not break.
const baselineOf = async (ctx, base, variant, cache) => (cache[variant] ??= await verified({ ...ctx, baseline: base }, `repair-baseline-${variant}`, base, {}));

const gatesById = (v) => Object.fromEntries((v?.gates ?? []).map((g) => [g.id, g]));

const foundOf = (cand, v) => [...cand.scope.map((f) => f.id), ...v.failures];

// A name a control expects to be refused by: a SCOPE rule's id, or a failure id or its prefix (`hidden:probe:TIMEOUT`,
// `agent:passes-before`, `hidden` for any hidden check).
const refusedBy = (found, id) => found.some((f) => f === id || f.startsWith(`${id}:`));

function rowOf(r, cand, v) {
  const got = isVerified({ v, cand, extraTasks: 0 }) ? "REPAIRED_VERIFIED" : "REPAIR_REJECTED";
  const found = foundOf(cand, v);
  const missing = (r.rejects ?? []).filter((id) => !refusedBy(found, id));
  return { id: r.id, kind: "candidate", through: "judge", expect: r.expect, got, matched: got === r.expect && missing.length === 0, rejects: r.rejects ?? [], found: [...new Set(found.map((f) => f.split(":").slice(0, 2).join(":")))], missing, summary: `${verificationSummary(v)}${cand.scope.length ? ` · scope ${[...new Set(cand.scope.map((f) => f.id))].join(", ")}` : ""}${v.skipped ? " · gates not run" : ""}`, digest: v.digest, patchDigest: cand.patchDigest };
}

export async function judgedRepair(ctx, c, r, cache) {
  const base = variantEntriesOf(ctx, c, r.variant);
  const before = await baselineOf(ctx, base, r.variant, cache);
  const cand = candidateOfDefinition(ctx, base, candidateFile(ctx.frozenCase, r.candidate));
  const v = await verified({ ...ctx, baseline: base, limits: { ...ctx.limits, seconds: r.seconds ?? ctx.limits.seconds } }, `repair-${r.id}`, cand.entries, { baseline: base, agentTests: cand.agentTests, beforeGates: gatesById(before), candidate: true });
  return rowOf(r, cand, v);
}
