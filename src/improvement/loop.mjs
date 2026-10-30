// THE CAMPAIGN'S LOOP, the engine's half: what happens next, one step at a time, from where the journal says the
// campaign stands. Every step is an OWNER's operation through a port -- the skill factory's successor door, the
// coordinator's own skill runner, Satellite's registry, the learn port -- with an intent line written BEFORE anything
// that changes what runs, and settled after. A step that needs the host (a successor's text, a Satellite mission), a
// person (Orbit Control) or another session (independent evidence, later runs) says so and does nothing else.
//
//   step(ports, id) -> answer               advance(ports, id, { cheap }) -> [answer]
//   analyseNow(ports, { dry, hook }) -> { opportunities, changed, eligible, expired, started, advanced }
//   reconcile(ports, id) -> answer          person(ports, id, act, { expected, because }) -> answer   (Control's door)
//
// ports: store · ctx { store, door, session, host, pid, now } · values() · now() · nowMs() · records() · history(subject)
//        · inputsOf(tasks) · subjects { skill, satellite } · evaluation · missions · liveness · learn(finding) · trace
import { Refused } from "../errors.mjs";
import { short } from "../hash.mjs";
import { answer, clip, ended, modeOf, rec, rejectedThenEnded, subjectPort, traced, waiting } from "./act.mjs";
import { analyse } from "./detect.mjs";
import { diagnosisOf } from "./diagnose.mjs";
import { aggregateOf } from "./evaluation.mjs";
import { EVALUATORS } from "./evaluators.mjs";
import { decisionOf, gatesOf } from "./gates.mjs";
import { findingOf } from "./learning.mjs";
import { modelOf, openEvaluation, phaseOf } from "./model.mjs";
import { observationOf } from "./monitor.mjs";
import { start } from "./ops.mjs";
import { digestOfOracle, weakenings } from "./oracle.mjs";
import { allowedTo, improvementOf } from "./policy.mjs";
import { factsOf, safetyOf, suppressionKey } from "./safety.mjs";
import { groupsOf, independent } from "./signals.mjs";
import { CODES, STAGE_MODES, causeRow } from "./vocab.mjs";

const quietly = (fn) => {
  try { return fn(); }
  catch { return null; }
};

const attempt = (fn) => {
  try { return { value: fn() }; }
  catch (error) { return { error }; }
};

const rethrow = (ports, c, e) => {
  throw e;
};

const loaded = (ports, id) => ((lines) => (lines ? { id, m: modelOf(lines), values: ports.values() } : null))(ports.store.read(id));

export function campaignOf(ports, id) {
  const c = loaded(ports, id);
  if (!c?.m.meta) throw Object.assign(new Refused(`IMP_UNKNOWN: ${id} is no improvement campaign of this project`), { code: CODES.UNKNOWN });
  return c;
}

const kindOf = (c) => c.m.meta.subjectKind;

const off = (c, stage) => waiting(c, "person", `a person turned improvement.${stage === "evaluate" ? "evaluate" : stage} off — nothing ${stage}s until a person turns it on in Orbit Control`);

const currentOf = (ports, c) => quietly(() => subjectPort(ports, c).current(c.m.meta.subjectId));

function blockedFor(ports, c, stop, needs, because) {
  rec(ports, c.id, "blocked", { stop, needs, because: clip(because) });
  traced(ports, "improvement.decided", { campaign: c.id, phase: "BLOCKED", verdict: stop });
  return waiting(c, needs, because);
}

// ---- detected → diagnosed → proposed ------------------------------------------------------------------------------

const opportunityOf = (m) => ({ subject: { kind: m.meta.subjectKind, id: m.meta.subjectId }, pin: m.meta.pin, signal: m.meta.signal, category: m.meta.category, signature: m.meta.signature ?? [], providers: m.meta.providers ?? [], runs: m.meta.runs, sessions: m.meta.sessions, against: m.meta.against, evidence: m.meta.evidence ?? [] });

function diagnosed(ports, c) {
  const d = diagnosisOf(opportunityOf(c.m), c.values);
  rec(ports, c.id, "diagnosed", { cause: d.cause, confidence: d.confidence, hypothesis: d.hypothesis, supporting: d.supporting, contradicting: d.contradicting, unknowns: d.unknowns, affected: d.affected, risk: d.risk, test: d.test, expected: d.expected, mode: STAGE_MODES.diagnose });
  return answer(c, "DIAGNOSED", { say: clip(`${d.cause} (${d.confidence}): ${d.hypothesis}`) });
}

// A cause no new version answers ends the campaign as what it is, and generates nothing.
const CAUSE_OUTCOME = { flaky: "insufficient-evidence", inconclusive: "insufficient-evidence", environment: "environment-blocked", provider: "capability-gap", policy: "capability-gap", efficiency: "capability-gap" };

const changeOf = (c) => clip(`a successor of ${c.m.meta.subjectId} that changes only how ${c.m.meta.signature?.join(", ") || "its failing steps"} read or bind what their providers answer, and keeps every acceptance rule of ${c.m.meta.pin}`);

function proposed(ports, c) {
  const d = c.m.diagnosis;
  if (!(causeRow(d.cause)?.candidate && d.confidence === "high")) return ended(ports, c, CAUSE_OUTCOME[d.cause] ?? "insufficient-evidence", `${d.cause} (${d.confidence}): ${causeRow(d.cause)?.say ?? ""} — nothing is generated`);
  rec(ports, c.id, "proposed", { strategy: "successor", change: changeOf(c), expected: d.expected, mode: STAGE_MODES.propose });
  return answer(c, "PROPOSED", { say: changeOf(c) });
}

// ---- generating: the owner drafts, the host writes, the owner's contract holds it -----------------------------------

const HOW_WRITE = (c) => `read it with node <engine>/cli/skill-factory.mjs show ${c.m.meta.pin}; write the changed SKILL.md or workflow.json — every required step, output name and success rule kept — and put it: node <engine>/cli/skill-factory.mjs put ${c.m.meta.subjectId} <file> [--as=workflow.json]; then node <engine>/cli/improve.mjs step ${c.id}`;

const HOW_PROPOSE = (c) => `write the successor's whole content of ${c.m.meta.pin} as JSON (same id, same profile, every completion criterion and restriction kept) and propose it: node <engine>/cli/improve.mjs candidate ${c.id} --file=<content.json>`;

const SCAFFOLD_REFUSED = {
  SF_WITHHELD: (ports, c, e) => blockedFor(ports, c, "SUBJECT_WITHHELD", "person", e.message),
  SF_UNKNOWN: (ports, c, e) => ended(ports, c, "superseded", e.message),
  SF_DRAFT_BUSY: (ports, c, e) => waiting(c, "session", e.message),
  SF_SUCCESSOR_OFF: (ports, c) => off(c, "generate"),
};

function scaffolded(ports, c, first) {
  const got = attempt(() => subjectPort(ports, c).scaffoldSuccessor({ id: c.m.meta.subjectId, of: c.m.meta.pin, campaign: c.id }));
  if (got.error) return (SCAFFOLD_REFUSED[got.error.code] ?? rethrow)(ports, c, got.error);
  if (first) rec(ports, c.id, "generating", { draft: got.value.id, of: c.m.meta.pin, ...modeOf("generate") });
  return waiting(c, "host", `the successor of ${c.m.meta.pin} is drafted from it — the host writes what changes`, HOW_WRITE(c));
}

const GENERATE = {
  skill: (ports, c) => scaffolded(ports, c, true),
  satellite: (ports, c) => (rec(ports, c.id, "generating", { of: c.m.meta.pin, ...modeOf("propose") }), waiting(c, "host", `the host proposes a successor of ${c.m.meta.pin}`, HOW_PROPOSE(c))),
};

const generatedStep = (ports, c) => (allowedTo(c.values, "generate") ? GENERATE[kindOf(c)](ports, c) : off(c, "generate"));

const candidateIdOf = (campaign, pin) => `cand-${short(`${campaign}\u0000${pin}`, 12)}`;

const changedOf = (a, b) => (a?.files && b?.files ? b.files.filter((f) => a.files.find((g) => g.name === f.name)?.digest !== f.digest).map((f) => f.name) : Object.keys(b?.content ?? {}).filter((k) => JSON.stringify(a?.content?.[k]) !== JSON.stringify(b.content[k])));

function stagedRecorded(ports, c, s) {
  const port = subjectPort(ports, c);
  rec(ports, c.id, "generated", { candidate: candidateIdOf(c.id, s.pin), pin: s.pin, digest: s.digest, successorOf: s.successorOf, reused: s.reused === true, changed: changedOf(quietly(() => port.content(c.m.meta.pin)), quietly(() => port.content(s.pin))).slice(0, 16), mode: STAGE_MODES.generate });
  traced(ports, "improvement.decided", { campaign: c.id, phase: "GENERATED", verdict: s.pin });
  return answer(c, "GENERATED", { say: clip(`${s.pin} kept as a candidate${s.reused ? " (the same files as one kept already)" : ""} — offered to nobody`) });
}

function refusedRecorded(ports, c, r) {
  rec(ports, c.id, "generation-refused", { findings: r.findings.map((f) => f.id).slice(0, 8), attempts: c.m.refusals.length + 1, because: clip(r.findings.map((f) => `${f.id}: ${f.says}`).join("; ")) });
  return waiting(c, "host", `its owner's contract refused the successor: ${r.findings.map((f) => f.id).slice(0, 3).join(", ")} — the host fixes it and puts it again`, HOW_WRITE(c));
}

const STAGE_REFUSED = {
  SF_BUDGET_ATTEMPTS: (ports, c, e) => rejectedThenEnded(ports, c, "GENERATION_ATTEMPTS", e.message),
  SF_UNCHANGED: (ports, c) => waiting(c, "host", "the successor still says what the version it succeeds says", HOW_WRITE(c)),
};

const stagedFrom = (ports, c, got) => (got.error ? (STAGE_REFUSED[got.error.code] ?? rethrow)(ports, c, got.error) : got.value.ok ? stagedRecorded(ports, c, got.value) : refusedRecorded(ports, c, got.value));

function stagedSkill(ports, c) {
  const draft = subjectPort(ports, c).successorDraft(c.m.meta.subjectId);
  if (!draft.exists) return scaffolded(ports, c, false);
  if (!draft.written) return waiting(c, "host", `the successor of ${c.m.meta.pin} waits for the host to write what changes`, HOW_WRITE(c));
  return stagedFrom(ports, c, attempt(() => subjectPort(ports, c).stage(c.m.meta.subjectId)));
}

const STAGE = { skill: stagedSkill, satellite: (ports, c) => waiting(c, "host", `the host proposes a successor of ${c.m.meta.pin}`, HOW_PROPOSE(c)) };

// A Satellite successor the host proposed (improve candidate): held to Satellite's own rules and kept as a candidate
// nobody is offered, by its owner's door.
export function proposeCandidate(ports, id, content) {
  const c = campaignOf(ports, id);
  if (kindOf(c) !== "satellite" || phaseOf(c.m) !== "GENERATING") throw Object.assign(new Refused(`IMP_PHASE: ${id} takes a proposed successor only while a Satellite definition's successor is being generated`), { code: CODES.PHASE });
  return stagedFrom(ports, c, attempt(() => subjectPort(ports, c).stage(c.m.meta.subjectId, { of: c.m.meta.pin, campaign: id, content })));
}

// ---- generated → validated -----------------------------------------------------------------------------------------

const suppressedKeys = (ports) => ports.store.list().map((id) => modelOf(ports.store.read(id) ?? [])).filter((m) => m.candidate && (m.rejected || m.rolledBack)).map((m) => suppressionKey(m.meta.pin, m.candidate.digest));

const pairOf = (ports, c) => ((port) => ({ parent: factsOf(kindOf(c), quietly(() => port.content(c.m.meta.pin))), candidate: factsOf(kindOf(c), quietly(() => port.content(c.m.candidate.pin))) }))(subjectPort(ports, c));

const safetyFacts = (ports, c) => ({ ...pairOf(ports, c), ownerFindings: (quietly(() => subjectPort(ports, c).validate(c.m.candidate.pin))?.findings ?? [{ id: "UNREADABLE" }]).map((f) => f.id), suppressed: suppressedKeys(ports) });

function validatedStep(ports, c) {
  const facts = safetyFacts(ports, c);
  const findings = safetyOf(facts);
  if (findings.length) return rejectedThenEnded(ports, c, findings[0].id, findings.map((f) => `${f.id}: ${f.says}`).join("; "));
  rec(ports, c.id, "validated", { candidate: c.m.candidate.candidate, parentDigest: facts.parent.digest, oracleDigest: digestOfOracle(facts.parent.oracle), mode: STAGE_MODES.validate });
  return answer(c, "VALIDATED", { say: clip(`${c.m.candidate.pin} holds to its owner's contract and weakens no acceptance rule of ${c.m.meta.pin}`) });
}

// ---- evaluating -------------------------------------------------------------------------------------------------------

// Only an evaluation of THIS candidate against THIS baseline under THIS oracle counts: a changed candidate, a moved
// baseline or a regenerated oracle leaves what was measured before as history, never as evidence.
export const validEvaluations = (m) => m.evaluations.filter((e) => e.settled && !e.interrupted && e.candidate === m.candidate?.pin && e.baseline === m.meta.pin && e.oracleDigest === m.validated?.oracleDigest);

const here = (ports) => ({ session: ports.ctx.session ?? null, host: ports.ctx.host ?? null, at: ports.now() });

const sessionOf = (e) => ({ session: e.session ?? null, host: e.host ?? null, at: e.at });

// This session has evaluated already when one more evaluation from it would add no independent session to the ones kept:
// the same host session, or no host session on a machine and day that one already counts for -- so asking again,
// with or without a session, is never a second vote.
const evaluatedHere = (ports, c) => ((kept) => kept.length > 0 && independent([...kept, here(ports)]) === independent(kept))(validEvaluations(c.m).filter((e) => e.settled.verdict !== "BLOCKED").map(sessionOf));

const openCount = (ports) => ports.store.list().map((id) => modelOf(ports.store.read(id) ?? [])).filter((m) => !m.ended && openEvaluation(m)).length;

const HOW_EVALUATE = (c) => `from another session (another day or another host session): node <engine>/cli/improve.mjs evaluate ${c.id}`;

function anotherOrEnd(ports, c, a, outcome) {
  if (c.m.evaluations.length >= improvementOf(c.values).maxEvaluationAttempts) return ended(ports, c, outcome, `${c.m.evaluations.length} evaluation(s), the most a person allows — ${a.because}`);
  if (evaluatedHere(ports, c)) return waiting(c, "session", a.because, HOW_EVALUATE(c));
  if (openCount(ports) >= improvementOf(c.values).maxConcurrentEvaluations) return waiting(c, "session", `${openCount(ports)} evaluation(s) are open in this project, the most a person allows at once`);
  return EVALUATORS[kindOf(c)].evaluate(ports, c);
}

function qualifiedStep(ports, c, a) {
  rec(ports, c.id, "qualified", { verdict: a.verdict, sessions: a.sessions, because: clip(a.because) });
  traced(ports, "improvement.decided", { campaign: c.id, phase: "QUALIFIED", verdict: a.verdict });
  return answer(c, "QUALIFIED", { say: clip(a.because) });
}

const AFTER = {
  WORSE: (ports, c, a) => rejectedThenEnded(ports, c, "EVALUATED_WORSE", a.because),
  BETTER: (ports, c, a) => qualifiedStep(ports, c, a),
  EQUIVALENT: (ports, c, a) => rejectedThenEnded(ports, c, "NO_MEASURABLE_IMPROVEMENT", a.because, "no-measurable-improvement"),
  BLOCKED: (ports, c, a) => anotherOrEnd(ports, c, a, "environment-blocked"),
  INCONCLUSIVE: (ports, c, a) => anotherOrEnd(ports, c, a, "insufficient-evidence"),
};

const aggregated = (ports, c) => ((a) => AFTER[a.verdict](ports, c, a))(aggregateOf(validEvaluations(c.m), c.values));

const sandboxed = (c) => improvementOf(c.values).isolation === "sandbox" && EVALUATORS[kindOf(c)].isolation !== "sandbox";

// A playbook or definition a person switched off is never evaluated behind their back: the campaign waits for them.
const withheld = (ports, c) => !withheldLifted(ports, c);

async function evaluatedStep(ports, c) {
  if (!allowedTo(c.values, "evaluate")) return off(c, "evaluate");
  if (withheld(ports, c)) return blockedFor(ports, c, "SUBJECT_WITHHELD", "person", `${c.m.meta.subjectId} is ${currentOf(ports, c)?.status ?? "gone"} — a person switched it off, and nothing is evaluated until a person moves it back`);
  if (sandboxed(c)) return blockedFor(ports, c, "ISOLATION_UNPROVEN", "person", `a person requires a sandbox of its own for every evaluation (improvement.isolation), and a ${kindOf(c)} evaluation runs read-only through owner gates — nothing is evaluated`);
  return openEvaluation(c.m) ? EVALUATORS[kindOf(c)].evaluate(ports, c) : aggregated(ports, c);
}

// ---- qualified → gated → promoted ----------------------------------------------------------------------------------

const gateFacts = (ports, c, door, expected) => ((pair, evals) => ({ m: c.m, aggregate: aggregateOf(evals, c.values), open: Boolean(openEvaluation(c.m)), candidate: pair.candidate, validation: quietly(() => subjectPort(ports, c).validate(c.m.candidate.pin)), current: currentOf(ports, c), weakened: weakenings(pair.parent?.oracle, pair.candidate?.oracle), widened: (pair.candidate?.tools ?? []).filter((t) => !(pair.parent?.tools ?? []).includes(t)), runs: evals.flatMap((e) => e.runs), regressions: evals.flatMap((e) => e.settled?.regressions ?? []), values: c.values, door, revisionOk: !Number.isInteger(expected) || !c.m.materialAt.some((p) => p > expected) }))(pairOf(ports, c), validEvaluations(c.m));

const promotionAt = (c) => `${c.id}:promote:${c.m.position}`;

function promotionDone(ports, c, got, door) {
  rec(ports, c.id, "promoted", { from: got.from, to: got.pin, door, by: door === "control" ? "person" : "improvement", eid: `${c.id}:promoted` });
  traced(ports, "improvement.promoted", { campaign: c.id, subject: c.m.meta.subjectId, from: got.from, to: got.pin });
  return answer(c, "PROMOTED", { say: clip(`${got.pin} runs for new work; tasks that pinned ${got.from} keep it`) });
}

function readBackPromotion(ports, c, door) {
  const now = currentOf(ports, c);
  if (now?.pin === c.m.candidate.pin) return promotionDone(ports, c, { from: c.m.meta.pin, pin: now.pin }, door);
  rec(ports, c.id, "promotion-interrupted", { because: clip(`${c.m.meta.subjectId} runs ${now?.pin ?? "nothing"} — another choice was made first`) });
  return ended(ports, c, "superseded", `${c.m.meta.subjectId} runs ${now?.pin ?? "nothing"} now — another choice was made before this one`);
}

const PROMOTION_REFUSED = {
  STALE_REVISION: (ports, c, e, door) => readBackPromotion(ports, c, door),
  SF_SELECT_WITHHELD: (ports, c, e) => blockedFor(ports, c, "PROMOTION_WITHHELD", "person", e.message),
  SF_SELECT_POLICY: (ports, c, e) => awaited(ports, c, { because: e.message }),
  SF_SELECT_DOOR: rethrow,
};

function promotedStep(ports, c, door) {
  rec(ports, c.id, "promotion-started", { from: c.m.meta.pin, to: c.m.candidate.pin, door, ...modeOf("promote"), eid: promotionAt(c) });
  const got = attempt(() => subjectPort(ports, c).select(c.m.meta.subjectId, { pin: c.m.candidate.pin, expect: c.m.meta.pin, door, campaign: c.id }));
  if (got.error) return (PROMOTION_REFUSED[got.error.code] ?? ((p, x, e) => rejectedThenEnded(p, x, e.code ?? "SELECTION_REFUSED", e.message)))(ports, c, got.error, door);
  return promotionDone(ports, c, got.value, door);
}

function awaited(ports, c, d) {
  if (!c.m.awaiting) rec(ports, c.id, "awaiting-authority", { because: clip(d.because) });
  traced(ports, "improvement.decided", { campaign: c.id, phase: "AWAITING_AUTHORITY", verdict: "QUALIFIED" });
  return waiting(c, "person", `${c.m.candidate.pin} qualified — ${clip(d.because)}; a person promotes it in Orbit Control`);
}

const staleRefusal = (c) => Object.assign(new Refused(`STALE_REVISION: ${c.id} moved since the revision a person read — read it again`), { code: CODES.STALE });

const DECIDED = {
  promote: (ports, c, d, door) => promotedStep(ports, c, door),
  await: (ports, c, d) => awaited(ports, c, d),
  block: (ports, c, d) => blockedFor(ports, c, "PROMOTION_WITHHELD", "person", d.because),
  supersede: (ports, c, d) => ended(ports, c, "superseded", d.because),
  reject: (ports, c, d) => rejectedThenEnded(ports, c, d.gate, d.because),
  wait: (ports, c, d) => waiting(c, "session", d.because),
  stale: (ports, c) => {
    throw staleRefusal(c);
  },
};

// The candidate already runs: a person in Orbit Control, or this engine before a crash, chose it. That choice is read
// back and recorded as it was made -- never made a second time, and never mistaken for a moved baseline.
function adopted(ports, c) {
  const now = currentOf(ports, c);
  rec(ports, c.id, "promotion-started", { from: c.m.meta.pin, to: c.m.candidate.pin, door: now.selectedBy ?? "control", ...modeOf("promote"), eid: promotionAt(c) });
  return promotionDone(ports, c, { from: c.m.meta.pin, pin: now.pin }, now.selectedBy ?? "control");
}

const chosenAlready = (ports, c) => currentOf(ports, c)?.pin === c.m.candidate.pin;

function gatedStep(ports, c, door, expected) {
  if (chosenAlready(ports, c)) return adopted(ports, c);
  const rows = gatesOf(gateFacts(ports, c, door, expected));
  const d = decisionOf(rows);
  rec(ports, c.id, "gated", { rows: rows.map((r) => ({ id: r.id, holds: r.holds })), failed: d.gate, mode: STAGE_MODES.gates });
  return DECIDED[d.decision](ports, c, d, door);
}

// A crash between choosing and recording: the owner is read back, and nothing is ever chosen twice.
function promotionReadBack(ports, c) {
  const now = currentOf(ports, c);
  if (now?.pin === c.m.promotion.to) return promotionDone(ports, c, { from: c.m.promotion.from, pin: now.pin }, c.m.promotion.door);
  if (now?.pin === c.m.promotion.from) return (rec(ports, c.id, "promotion-interrupted", { because: "read back from its owner: nothing was chosen, so the gates are asked again" }), answer(c, "READ_BACK", { say: "nothing was chosen before the crash — the gates are asked again" }));
  return blockedFor(ports, c, "SELECTION_AMBIGUOUS", "person", `${c.m.meta.subjectId} runs ${now?.pin ?? "nothing"} — neither the version it replaced nor the candidate; a person decides`);
}

// ---- promoted → monitored → (rolled back) -----------------------------------------------------------------------------

const since = (ports, c) => (quietly(() => ports.history({ kind: kindOf(c), id: c.m.meta.subjectId })) ?? []).filter((r) => (r.pin ?? r.rolePin) === c.m.promoted.to && String(r.at) > String(c.m.promoted.at));

const sameObservation = (m, o) => ((last) => Boolean(last) && last.word === o.word && last.runs === o.runs)(m.observations.at(-1));

function watching(ports, c, o) {
  if (!sameObservation(c.m, o)) rec(ports, c.id, "observed", { runs: o.runs, sessions: o.sessions, clean: o.clean, failing: o.failing, blocked: o.blocked, word: o.word, because: clip(o.because), mode: STAGE_MODES.monitor });
  return waiting(c, "session", o.because);
}

function rolledBackDone(ports, c, got, door) {
  rec(ports, c.id, "rolled-back", { from: got.from, to: got.pin, door, by: door === "control" ? "person" : "improvement", eid: `${c.id}:rolled-back` });
  traced(ports, "improvement.rolled_back", { campaign: c.id, subject: c.m.meta.subjectId, from: got.from, to: got.pin });
  return ended(ports, c, c.m.regression ? "regression-detected" : "candidate-rejected", c.m.regression ? `${got.pin} runs again: ${c.m.regression.because}` : `a person put ${got.pin} back in Orbit Control`);
}

const ROLLBACK_REFUSED = {
  STALE_REVISION: (ports, c) => rollbackReadBack(ports, loaded(ports, c.id)),
  SF_SELECT_DOOR: rethrow,
};

function rollbackStep(ports, c, door = "improvement") {
  if (door === "improvement" && !allowedTo(c.values, "rollback")) return blockedFor(ports, c, "ROLLBACK_WITHHELD", "person", `${c.m.promoted.to} regressed, and a person turned automatic promotion off — a person puts ${c.m.promoted.from} back in Orbit Control`);
  rec(ports, c.id, "rollback-started", { from: c.m.promoted.to, to: c.m.promoted.from, door, ...modeOf("rollback"), eid: `${c.id}:rollback:${c.m.position}` });
  const got = attempt(() => subjectPort(ports, c).select(c.m.meta.subjectId, { pin: c.m.promoted.from, expect: c.m.promoted.to, door, campaign: c.id }));
  if (got.error) return (ROLLBACK_REFUSED[got.error.code] ?? ((p, x, e) => blockedFor(p, x, "ROLLBACK_WITHHELD", "person", e.message)))(ports, c, got.error);
  return rolledBackDone(ports, c, got.value, door);
}

function rollbackReadBack(ports, c) {
  const now = currentOf(ports, c);
  if (now?.pin === c.m.rollback.to) return rolledBackDone(ports, c, { from: c.m.rollback.from, pin: now.pin }, c.m.rollback.door);
  if (now?.pin === c.m.rollback.from) return (rec(ports, c.id, "rollback-interrupted", { because: "read back from its owner: nothing was put back, so it is asked again" }), answer(c, "READ_BACK", { say: "nothing was put back before the crash — it is asked again" }));
  return blockedFor(ports, c, "SELECTION_AMBIGUOUS", "person", `${c.m.meta.subjectId} runs ${now?.pin ?? "nothing"} — neither version; a person decides`);
}

function regressed(ports, c, o) {
  rec(ports, c.id, "regression", { runs: o.failing, sessions: o.failingSessions, evidence: o.evidence, because: clip(o.because) });
  traced(ports, "improvement.decided", { campaign: c.id, phase: "REGRESSION", verdict: "WORSE" });
  return rollbackStep(ports, loaded(ports, c.id));
}

const OBSERVED = {
  REGRESSED: (ports, c, o) => regressed(ports, c, o),
  STABLE: (ports, c, o) => ended(ports, c, "improvement-verified", o.because),
  INSUFFICIENT: (ports, c, o) => watching(ports, c, o),
  CONFOUNDED: (ports, c, o) => watching(ports, c, o),
};

function monitoredStep(ports, c) {
  if (c.m.regression) return rollbackStep(ports, c);
  const now = currentOf(ports, c);
  if (now?.pin !== c.m.promoted.to || now.status !== "active") return ended(ports, c, "superseded", `${c.m.meta.subjectId} runs ${now?.pin ?? "nothing"}${now && now.status !== "active" ? ` (${now.status})` : ""} now — a person or another campaign changed it before monitoring settled`);
  return ((o) => OBSERVED[o.word](ports, c, o))(observationOf({ records: since(ports, c), values: c.values }));
}

// ---- blocked, ended, learned ------------------------------------------------------------------------------------------

const withheldLifted = (ports, c) => ((now) => now?.status === "active" && now.archived !== true && now.revoked !== true)(currentOf(ports, c));

const UNBLOCK = {
  SUBJECT_WITHHELD: (ports, c) => withheldLifted(ports, c),
  PROMOTION_WITHHELD: (ports, c) => withheldLifted(ports, c),
  ROLLBACK_WITHHELD: (ports, c) => withheldLifted(ports, c) && allowedTo(c.values, "rollback"),
  ISOLATION_UNPROVEN: (ports, c) => !sandboxed(c),
  EVALUATION_BLOCKED: () => true,
};

function unblockedStep(ports, c) {
  if (!(UNBLOCK[c.m.blocked.stop] ?? (() => false))(ports, c)) return waiting(c, c.m.blocked.needs ?? "person", c.m.blocked.because ?? c.m.blocked.stop);
  rec(ports, c.id, "unblocked", { because: clip(`${c.m.blocked.stop} no longer holds`) });
  return answer(c, "UNBLOCKED", { say: clip(`${c.m.blocked.stop} no longer holds — the campaign goes on`) });
}

function learnedStep(ports, c) {
  if (c.m.learned) return answer(c, "DONE", { outcome: c.m.ended.outcome, say: clip(c.m.ended.because) });
  const r = quietly(() => ports.learn(findingOf(c.m))) ?? { kept: false, because: "learning is unavailable here — nothing was kept" };
  rec(ports, c.id, "learned", { lesson: r.id ?? undefined, state: r.state ?? undefined, kept: r.kept === true, because: clip(r.because) });
  return answer(c, "LEARNED", { outcome: c.m.ended.outcome, say: clip(r.because) });
}

export const STEPS = {
  DETECTED: (ports, c) => (allowedTo(c.values, "diagnose") ? diagnosed(ports, c) : off(c, "detect")),
  DIAGNOSED: proposed,
  PROPOSED: generatedStep,
  GENERATING: (ports, c) => (allowedTo(c.values, "generate") ? STAGE[kindOf(c)](ports, c) : off(c, "generate")),
  GENERATED: validatedStep,
  VALIDATED: evaluatedStep,
  EVALUATING: evaluatedStep,
  QUALIFIED: (ports, c) => gatedStep(ports, c, "improvement"),
  AWAITING_AUTHORITY: (ports, c) => waiting(c, "person", c.m.awaiting?.because ?? "a person promotes it in Orbit Control"),
  PROMOTING: promotionReadBack,
  PROMOTED: monitoredStep,
  MONITORING: monitoredStep,
  ROLLING_BACK: rollbackReadBack,
  REJECTED: (ports, c) => ended(ports, c, c.m.rejected.reason === "NO_MEASURABLE_IMPROVEMENT" ? "no-measurable-improvement" : "candidate-rejected", c.m.rejected.because),
  ROLLED_BACK: (ports, c) => ended(ports, c, c.m.regression ? "regression-detected" : "candidate-rejected", c.m.rolledBack.because ?? `${c.m.rolledBack.to} runs again`),
  BLOCKED: unblockedStep,
};

export async function step(ports, id) {
  const c = campaignOf(ports, id);
  const out = await (c.m.ended ? learnedStep : STEPS[phaseOf(c.m)])(ports, c);
  return { ...out, phase: phaseOf(campaignOf(ports, id).m) };
}

// The phases a hook's own process may carry a campaign through: what costs a few reads and owner writes, and never an
// evaluation -- a provider is asked only by `step` or `evaluate` in a session.
export const CHEAP = ["DETECTED", "DIAGNOSED", "PROPOSED", "GENERATING", "GENERATED", "QUALIFIED", "PROMOTING", "PROMOTED", "MONITORING", "ROLLING_BACK", "REJECTED", "ROLLED_BACK", "BLOCKED", "COMPLETED", "INCONCLUSIVE"];

const stops = (out, ports, id, opts) => Boolean(out.needs) || out.did === "DONE" || (opts.cheap === true && !CHEAP.includes(phaseOf(campaignOf(ports, id).m)));

export async function advance(ports, id, opts = {}, limit = 16) {
  if (opts.cheap === true && !CHEAP.includes(phaseOf(campaignOf(ports, id).m))) return [];
  const out = await step(ports, id);
  return stops(out, ports, id, opts) || limit <= 1 ? [out] : [out, ...(await advance(ports, id, opts, limit - 1))];
}

// ---- detection, and the campaigns it starts ---------------------------------------------------------------------------

const summaryOf = (ports) => (id) => ((m) => ({ id, subjectKind: m.meta?.subjectKind, subjectId: m.meta?.subjectId, fingerprint: m.meta?.fingerprint, terminal: Boolean(m.ended), endedAt: m.ended?.at ?? null, startedAt: m.meta?.at ?? null, generated: m.candidate ? 1 : 0 }))(modelOf(ports.store.read(id) ?? []));

const saved = (ports, doc) => quietly(() => ports.store.saveOpportunity(doc)) !== null;

function startedFor(ports, doc) {
  const s = start(ports.ctx, doc);
  if (s.created) saved(ports, { ...doc, campaign: s.campaign });
  if (s.created) traced(ports, "improvement.detected", { campaign: s.campaign, subject: doc.subject.id, signal: doc.signal, sessions: doc.sessions, runs: doc.runs });
  return s;
}

const DEBOUNCE_MS = 10 * 60000;

const debounced = (ports) => ((last) => Boolean(last?.at) && ports.nowMs() - Date.parse(last.at) < DEBOUNCE_MS)(ports.store.analysed());

const openIds = (ports) => ports.store.list().filter((id) => !modelOf(ports.store.read(id) ?? []).ended || !modelOf(ports.store.read(id) ?? []).learned);

async function written(ports, found, opts) {
  const kept = found.changed.filter((d) => saved(ports, d)).length;
  found.expired.forEach((id) => quietly(() => ports.store.dropOpportunity(id)));
  const started = allowedTo(ports.values(), "detect") ? found.eligible.filter((d) => !d.campaign).map((d) => startedFor(ports, d)) : [];
  ports.store.setAnalysed({ at: ports.now(), host: ports.ctx.host, session: ports.ctx.session ?? null, groups: found.opportunities.length, eligible: found.eligible.length, started: started.filter((s) => s.created).length });
  return { kept, started, advanced: await advancedAll(ports, openIds(ports), opts) };
}

const advancedAll = async (ports, ids, opts) => (ids.length ? [...(await quietlyAsync(() => advance(ports, ids[0], { cheap: opts.hook === true }))), ...(await advancedAll(ports, ids.slice(1), opts))] : []);

async function quietlyAsync(fn) {
  try { return await fn(); }
  catch (e) { return [{ did: "FAILED", needs: null, say: clip(e.message) }]; }
}

export async function analyseNow(ports, opts = {}) {
  if (opts.hook === true && debounced(ports)) return { debounced: true, opportunities: [], changed: [], eligible: [], expired: [], unreadable: [], started: [], advanced: [] };
  const found = analyse({ groups: groupsOf(ports.records()), kept: ports.store.opportunities(), campaigns: ports.store.list().map(summaryOf(ports)), values: ports.values(), now: ports.now() });
  return opts.dry ? { ...found, dry: true, started: [], advanced: [] } : { ...found, ...(await written(ports, found, opts)) };
}

// ---- reconcile: what a dead process left ------------------------------------------------------------------------------

export function reconcile(ports, id) {
  const c = campaignOf(ports, id);
  const open = openEvaluation(c.m);
  const dead = open?.task && open.pid !== ports.ctx.pid && ports.liveness({ host: open.host, pid: open.pid }) === false;
  const closed = dead ? ports.evaluation.closeDead(open.task) : 0;
  return answer(c, "RECONCILED", { say: dead ? `${closed} action(s) a gone process left open were closed as interrupted; ${open.evaluation} goes on with the runs it never recorded` : "nothing a gone process left open", phase: phaseOf(c.m) });
}

// ---- a person's decisions: Orbit Control's door only ------------------------------------------------------------------

const BENEATH = (m) => phaseOf({ ...m, blocked: null });

const PERSON = {
  promote: { phases: ["QUALIFIED", "AWAITING_AUTHORITY"], run: (ports, c, o) => gatedStep(ports, c, "control", o.expected) },
  revert: { phases: ["PROMOTED", "MONITORING"], run: (ports, c) => rollbackStep(ports, c, "control") },
  reject: { phases: ["DIAGNOSED", "PROPOSED", "GENERATING", "GENERATED", "VALIDATED", "EVALUATING", "QUALIFIED", "AWAITING_AUTHORITY"], run: (ports, c, o) => rejectedThenEnded(ports, c, "PERSON_REJECTED", o.because ?? "a person rejected it in Orbit Control") },
};

const refusedPerson = (code, say) => Object.assign(new Refused(`${code}: ${say}`), { code });

export async function person(ports, id, act, o = {}) {
  if (ports.ctx.door !== "control" || !PERSON[act]) throw refusedPerson(CODES.DOOR, "promote, revert and reject are a person's, decided in Orbit Control, where the page proves the decision is a person's");
  const c = campaignOf(ports, id);
  if (Number.isInteger(o.expected) && c.m.materialAt.some((p) => p > o.expected)) throw staleRefusal(c);
  if (!PERSON[act].phases.includes(BENEATH(c.m))) throw refusedPerson(CODES.PHASE, `${id} is ${phaseOf(c.m)} — it cannot be ${act}ed now`);
  return { ...(await PERSON[act].run(ports, c, o)), phase: phaseOf(campaignOf(ports, id).m) };
}
