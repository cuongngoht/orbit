// The Security Auditor's evidence, READ BACK from its owner (doc §7; ADR 0040): what an autonomous QA
// investigation's generated tests came to, for each control role their designs ran, as the auditor's
// results -- never a file somebody reported.
//
// The owner is the investigation's own journal: the obligation each test served (its shape and the
// graph node it was about), the design it was made from (the control roles it ran, each acting as an
// identity), the frozen version and its validation, the run the host recorded and the word the host's
// own check earned (src/investigation/verification.mjs). A security control in effect is answered by
// every test whose obligation's shape the control names; which role a run's failure belongs to is the
// role whose identity the failed step acted as, read off the run log the host kept beside the run.
//
// Nothing here re-judges a verdict: a word is passed on as it was earned, its role is placed, and the
// auditor's own table (src/qa/security/assessment.mjs PAIRING) decides what the control comes to.
import { readFileSync } from "node:fs";
import { join } from "node:path";

// in: { model: the investigation's fold, readArtifact(kind, digest), readVersion(path), storeRoot, tenancy, controls:
//       [{ catalog, control, shapes }] } -> results for the auditor, one per control role per test.
export function resultsFromInvestigation(input) {
  return (input.model.obligations ?? []).filter(latestOf(input.model)).flatMap((o) => testedOf(input, o)).flatMap((t) => input.controls.filter((c) => c.shapes.includes(t.obligation.shape)).flatMap((c) => rowsOf(input, t, c)));
}

const latestOf = (model) => (o) => (model.obligations ?? []).filter((x) => x.obligation === o.obligation).at(-1) === o;

// The latest execution of each obligation, with the design it ran, the run the host recorded, and the identity the
// step that failed acted as.
function testedOf(input, o) {
  const evaluated = (input.model.evaluations ?? []).filter((e) => e.obligation === o.obligation).at(-1);
  if (!evaluated) return [];
  const run = (input.model.runs ?? []).find((r) => r.execution === evaluated.execution) ?? null;
  const version = (input.model.versions ?? []).find((v) => v.version === run?.version) ?? null;
  return [{ obligation: o, evaluated, run, version, design: designOf(input, version), failedAs: failedAs(input, run, version), attempts: (input.model.evaluations ?? []).filter((e) => e.obligation === o.obligation) }];
}

function designOf(input, version) {
  const record = (input.model.designs ?? []).findLast((d) => d.design === version?.design && d.state === "designed");
  return record ? input.readArtifact("designs", record.digest) ?? {} : {};
}

// One result per control role the design ran, each placed by what failed and where.
const rowsOf = (input, t, c) => (t.design.controls ?? []).filter((ctl) => ["positive", "negative", "state"].includes(ctl.role)).map((ctl) => ((outcome) => ({ catalog: c.catalog, control: c.control, role: ctl.role, outcome, ...facts(input, t, ctl, outcome) }))(ROLE_WORDS.find((r) => r.when(t)).word(t, ctl)));

// The word each role earned: the run's own, when it passed or could not decide; when it was contradicted, CONTRADICTED
// for the role whose step failed and SATISFIED for a positive control that held before it; a positive control that
// did not hold is CONTRADICTED itself, and every role beside it is INCONCLUSIVE.
const ROLE_WORDS = [
  { when: (t) => t.evaluated.cause === "POSITIVE_CONTROL", word: (t, ctl) => (ctl.role === "positive" ? "CONTRADICTED" : "INCONCLUSIVE") },
  { when: (t) => t.evaluated.outcome === "CONTRADICTED", word: (t, ctl) => (t.failedAs && t.failedAs === ctl.identityRef ? "CONTRADICTED" : ctl.role === "positive" ? "SATISFIED" : "INCONCLUSIVE") },
  { when: () => true, word: (t) => t.evaluated.outcome },
];

// The identity the step the host's run log says failed acted as -- the record a worker's claim was held to -- read
// against the case as it was frozen.
function failedAs(input, run, version) {
  const frozen = version ? input.readVersion(`versions/${version.version.split("@")[1]}/${version.case}.json`)?.case ?? null : null;
  const failed = (run?.evidence ? linesOf(join(input.storeRoot, run.evidence, "run-log.jsonl")) : []).find((r) => r.kind === "step" && r.ok === false)?.i;
  return Number.isInteger(failed) ? frozen?.steps?.[failed - 1]?.input?.identityRef ?? null : null;
}

function linesOf(file) {
  try { return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
  catch { return []; }
}

// What a confirmed finding has to stand on, as the owner's records show it -- each false when they do not.
function facts(input, t, ctl, outcome) {
  const identities = input.tenancy?.identities ?? {};
  return { fresh: t.obligation.applicability?.state !== "stale" && (input.model.bindings ?? []).filter((b) => (t.obligation.bindings ?? []).includes(b.binding)).every((b) => b.state === "fresh"), authority: t.obligation.authority ?? "draft", target: t.obligation.target ?? null, testValid: (input.model.validations ?? []).some((v) => v.version === t.version?.version && v.state === "valid"), identityValid: !ctl.identityRef || Boolean(identities[ctl.identityRef]), fixtureValid: (input.model.preparations ?? []).some((p) => p.version === t.version?.version && p.state === "prepared"), readBack: t.evaluated.id, identity: ctl.identityRef ?? null, fixture: null, ...(ctl.role === "negative" && outcome === "CONTRADICTED" ? { leak: { kind: "access" } } : {}), reproducibility: t.attempts.length > 1 ? `${t.attempts.length} attempts` : "one attempt", evidenceRefs: [t.run?.id, t.evaluated.id].filter(Boolean), executable: Boolean(t.version) };
}
