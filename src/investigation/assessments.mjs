// An ASSESSMENT (doc §10; ADR 0032): what an investigation's generated tests came to, per
// obligation, FROZEN -- the one record a report is rendered from and a late result supersedes.
//
// Read off the journal's own fold and DECIDING nothing new: each result's word is the one its
// `evaluated` record holds (src/investigation/verification.mjs decided it), an obligation's word is
// OBLIGATION over its designs' latest results by control role (a negative proves nothing without
// its positive), and coverage counts exactly the SATISFIED ones -- over the obligations that apply,
// so an obligation nothing was designed for is in the denominator and in the gaps, never dropped.
// A gap always says why.
import { canonicalJson, sha } from "../hash.mjs";
import { current, withJournal } from "./act.mjs";
import { nextId } from "./model.mjs";
import { eventIdOf } from "./store.mjs";
import { countsForCoverage, obligationOutcome } from "./verification.mjs";

export const ASSESSMENT_API = "orbit.assessment/v1";

// reads: { designOf(artifactDigest) -> the design artifact or null }
export function assessmentOf(model, reads = {}) {
  const obligations = latestObligations(model).map((o) => obligationView(model, o, reads));
  const scope = { objective: model.meta?.objective ?? null, revision: model.meta?.revision ?? null, obligations: obligations.map((o) => [o.obligation, o.revision]) };
  const body = { v: ASSESSMENT_API, scope, scopeDigest: sha(canonicalJson(scope)), obligations, coverage: coverageOf(obligations), gapRefs: obligations.flatMap((o) => o.gaps.map((why) => `${o.obligation}: ${why}`)), resultRefs: obligations.flatMap((o) => o.results), findingRefs: (model.findings ?? []).map((f) => f.id) };
  return { ...body, id: `asm-${sha(canonicalJson(body)).slice(0, 16)}` };
}

const latestObligations = (model) => [...new Map(model.obligations.map((o) => [o.obligation, o])).values()];

function obligationView(model, o, reads) {
  const designs = model.designs.filter((d) => d.obligation === o.obligation && d.state === "designed");
  const latest = designs.map((d) => ({ d, r: latestResultOf(model, d.design) })).filter((x) => x.r);
  const controls = Object.fromEntries(latest.map(({ d, r }) => [roleOf(d, reads), r.outcome]));
  const outcome = latest.length ? obligationOutcome(controls).outcome : "INCONCLUSIVE";
  return { obligation: o.obligation, revision: o.revision ?? null, shape: o.shape ?? null, authority: o.authority ?? null, controls, outcome, results: latest.map(({ r }) => r.id), gaps: gapsOf(model, o, designs, latest) };
}

// A design that serves one control is that control; one serving several is judged whole.
function roleOf(d, reads) {
  const roles = (reads.designOf?.(d.digest)?.controls ?? []).map((c) => c.role);
  return roles.length === 1 ? roles[0] : `design ${d.design}`;
}

// The latest result for a design: its versions, their runs, the evaluation of those executions.
function latestResultOf(model, design) {
  const versions = new Set(model.versions.filter((v) => v.design === design).map((v) => v.version));
  const executions = new Set(model.runs.filter((r) => versions.has(r.version)).map((r) => r.execution));
  return model.evaluations.findLast((e) => executions.has(e.execution)) ?? null;
}

const GAPS = [
  { when: (m, o, designs) => !designs.length, why: () => "no design holds for it yet" },
  { when: (m, o, designs, latest) => designs.length > 0 && !latest.length, why: () => "it was designed and nothing of it has run" },
  { when: (m, o, designs, latest) => latest.some(({ r }) => r.outcome === "CAPABILITY_MISSING"), why: () => "nothing here could perform or observe what it needs" },
  { when: (m, o) => Boolean(o.missing), why: (m, o) => `no accepted source says ${o.missing}` },
];

const gapsOf = (m, o, designs, latest) => GAPS.filter((g) => g.when(m, o, designs, latest)).map((g) => g.why(m, o));

function coverageOf(obligations) {
  const counted = obligations.filter((o) => countsForCoverage(o.outcome)).length;
  return { counted, of: obligations.length, shown: obligations.length ? `${counted}/${obligations.length}` : "—" };
}

// Frozen: the snapshot as an artifact, written once by its digest, and an `assessed` line naming
// it and the assessment it supersedes.
export function assessed(w, reads = {}) {
  const snapshot = assessmentOf(current(w), reads);
  return withJournal(w, () => keptAssessment(w, snapshot));
}

function keptAssessment(w, snapshot) {
  const kept = w.store.putArtifact(w.id, "assessments", snapshot);
  const before = current(w).assessments.at(-1) ?? null;
  w.store.appendOnce(w.id, "assessed", { id: nextId(current(w), "assessed"), eventId: eventIdOf("assessed", w.id, 0, kept.digest), assessment: snapshot.id, digest: kept.digest, scope: snapshot.scopeDigest, results: snapshot.resultRefs, ...(before && before.assessment !== snapshot.id ? { supersedes: before.assessment } : {}) });
  return { snapshot, artifact: kept };
}
