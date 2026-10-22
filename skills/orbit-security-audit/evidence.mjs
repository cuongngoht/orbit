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

// The latest execution of each obligation, with the design it ran, the case as it was frozen, the run the host recorded,
// and the step the host's run log says failed.
function testedOf(input, o) {
  const evaluated = (input.model.evaluations ?? []).filter((e) => e.obligation === o.obligation).at(-1);
  if (!evaluated) return [];
  const run = (input.model.runs ?? []).find((r) => r.execution === evaluated.execution) ?? null;
  const version = (input.model.versions ?? []).find((v) => v.version === run?.version) ?? null;
  return [{ obligation: o, evaluated, run, version, design: designOf(input, version), frozen: frozenOf(input, version), failedAt: failedAt(input, run), attempts: (input.model.evaluations ?? []).filter((e) => e.obligation === o.obligation) }];
}

function designOf(input, version) {
  const record = (input.model.designs ?? []).findLast((d) => d.design === version?.design && d.state === "designed");
  return record ? input.readArtifact("designs", record.digest) ?? {} : {};
}

// One result per control role the design ran, each placed by what failed and where.
const rowsOf = (input, t, c) => (t.design.controls ?? []).filter((ctl) => ["positive", "negative", "state"].includes(ctl.role)).map((ctl) => ((outcome) => ({ catalog: c.catalog, control: c.control, role: ctl.role, outcome, ...facts(input, t, ctl, outcome) }))(ROLE_WORDS.find((r) => r.when(t, ctl)).word(t, ctl)));

// The word each role earned. A role the frozen case never SHOWS earned nothing, whatever the run came to; otherwise the
// run's own word, when it passed or could not decide; when it was contradicted, CONTRADICTED for the role shown in the
// step that failed, SATISFIED for a positive control shown only before it, and INCONCLUSIVE for every other; and a
// positive control that did not hold is CONTRADICTED itself, with every role beside it INCONCLUSIVE.
const ROLE_WORDS = [
  { when: (t, ctl) => shownIn(t, ctl).length === 0, word: () => "INCONCLUSIVE" },
  { when: (t) => t.evaluated.cause === "POSITIVE_CONTROL", word: (t, ctl) => (ctl.role === "positive" ? "CONTRADICTED" : "INCONCLUSIVE") },
  { when: (t) => t.evaluated.outcome === "CONTRADICTED", word: (t, ctl) => (shownIn(t, ctl).includes(t.failedAt) ? "CONTRADICTED" : ctl.role === "positive" && shownIn(t, ctl).every((i) => i < t.failedAt) ? "SATISFIED" : "INCONCLUSIVE") },
  { when: () => true, word: (t) => t.evaluated.outcome },
];

// The steps of the frozen case a control is SHOWN in: steps that act as the identity it names and on the resource it
// names (at least one of the two), and that an assertion compiled from an accepted criterion rules on. A control that
// names neither, or that no ruled step acts as, is shown in none.
const shownIn = (t, ctl) => (t.frozen?.steps ?? []).map((s, n) => ({ s, i: n + 1 })).filter(({ s, i }) => actsAs(s, ctl) && (t.design.assertions ?? []).some((a) => a?.step === i)).map(({ i }) => i);

const actsAs = (step, ctl) => Boolean(ctl.identityRef || ctl.resourceRef) && (!ctl.identityRef || step?.input?.identityRef === ctl.identityRef) && (!ctl.resourceRef || refsIn(step).includes(ctl.resourceRef));

const refsIn = (step) => Object.entries(step?.input ?? {}).filter(([k]) => k.endsWith("Ref") && k !== "identityRef").map(([, v]) => v);

// The case as it was frozen, read back by the version that names it.
const frozenOf = (input, version) => (version ? input.readVersion(`versions/${version.version.split("@")[1]}/${version.case}.json`)?.case ?? null : null);

// The step the host's run log says failed -- the record a worker's claim was held to.
function failedAt(input, run) {
  const failed = (run?.evidence ? linesOf(join(input.storeRoot, run.evidence, "run-log.jsonl")) : []).find((r) => r.kind === "step" && r.ok === false)?.i;
  return Number.isInteger(failed) ? failed : null;
}

function linesOf(file) {
  try { return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
  catch { return []; }
}

// Who a control's evidence was acting as: the identity it names, or -- one that names none -- every identity the test
// acted as. A test that acted as nobody checked nobody's claims.
const actorsOf = (t, ctl) => (ctl.identityRef ? [ctl.identityRef] : [...new Set((t.frozen?.steps ?? []).map((s) => s?.input?.identityRef).filter(Boolean))]);

// What a confirmed finding has to stand on, as the owner's records show it -- each false when they do not.
function facts(input, t, ctl, outcome) {
  const identities = input.tenancy?.identities ?? {};
  return { fresh: t.obligation.applicability?.state !== "stale" && (input.model.bindings ?? []).filter((b) => (t.obligation.bindings ?? []).includes(b.binding)).every((b) => b.state === "fresh"), authority: t.obligation.authority ?? "draft", target: t.obligation.target ?? null, testValid: (input.model.validations ?? []).some((v) => v.version === t.version?.version && v.state === "valid"), identityValid: actorsOf(t, ctl).length > 0 && actorsOf(t, ctl).every((id) => Boolean(identities[id])), fixtureValid: (input.model.preparations ?? []).some((p) => p.version === t.version?.version && p.state === "prepared"), readBack: t.evaluated.id, identity: ctl.identityRef ?? null, fixture: null, ...(ctl.role === "negative" && outcome === "CONTRADICTED" ? { leak: { kind: "access" } } : {}), reproducibility: t.attempts.length > 1 ? `${t.attempts.length} attempts` : "one attempt", evidenceRefs: [t.run?.id, t.evaluated.id].filter(Boolean), executable: Boolean(t.version) };
}
