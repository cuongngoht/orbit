// A declared playbook REVIEWED from what its runs actually did (0.0.4): the questions a person asks of a skill before
// trusting it again, each answered only from the records a binding hands in -- every run the project's coordinators
// carried of it, and whether each pinned version's workflow still holds -- never from a counter anybody keeps. A
// review proposes; it never rewrites a version, and one good run is never called reliable.
//
//   reviewOf({ id, runs, versions, sessions }) -> { id, versions, questions, reliability, proposal }
//     runs      [{ task, run, pin, word, steps: [{ id, word, required, calls, retries, waiting, bound, providers }], session, at }]
//     versions  [{ pin, version, status, holds }]    `holds`: the version's workflow is held to the contract again today
//
// Each question answers yes, no or unknown -- unknown when no run says -- with the sentence of why.
const PROOF = "VERIFIED";
const WAITED = ["BLOCKED", "AMBIGUOUS", "INTERRUPTED"];

const steps = (runs) => runs.flatMap((r) => r.steps);

const required = (runs) => steps(runs).filter((s) => s.required !== false);

const answer = (yes, sayYes, sayNo) => ({ answer: yes ? "yes" : "no", because: yes ? sayYes : sayNo });

const unknownIfNoRun = (runs, fn) => (runs.length ? fn(runs) : { answer: "unknown", because: "no run of it has been recorded" });

// Who a call went through is a provider an owner gate serves -- a managed server's broker (`managed:`) or a project
// capability's pipeline, never a server a host configured or one only catalogued -- and the provider the step was
// bound to when it started.
const gateServed = (key) => typeof key === "string" && !/^(external|catalog):/.test(key);

const authorized = (s) => (s.providers ?? []).every((p) => gateServed(p) && (!s.bound || p === s.bound));

export const REVIEW = [
  { id: "WORKFLOW_VALID", ask: "Does its workflow still hold to the contract?", of: (x) => (x.versions.length ? answer(x.versions.every((v) => v.holds), "every version kept holds to the workflow contract today", `${x.versions.filter((v) => !v.holds).map((v) => v.pin).join(", ")} no longer holds`) : { answer: "unknown", because: "no version is kept" }) },
  { id: "ALL_REQUIRED_RAN", ask: "Did every required step run?", of: (x) => unknownIfNoRun(x.runs, (runs) => answer(required(runs).every((s) => s.word !== "PENDING"), "every required step of every run recorded what it came to", `${required(runs).filter((s) => s.word === "PENDING").length} required step(s) were never reached`)) },
  { id: "AUTHORIZED_PROVIDER", ask: "Did every call go through the provider an owner gate serves?", of: (x) => unknownIfNoRun(x.runs, (runs) => answer(steps(runs).every(authorized), "every call went through a managed server's broker or a project capability's pipeline, as bound", "a call went through a provider it was not bound to")) },
  { id: "CONTRACTS", ask: "Did the output contracts hold?", of: (x) => unknownIfNoRun(x.runs, (runs) => answer(!steps(runs).some((s) => s.word === "VERIFY_FAILED"), "no step's output contract failed", `${steps(runs).filter((s) => s.word === "VERIFY_FAILED").length} step(s) answered outside their contract`)) },
  { id: "EVIDENCE", ask: "Is what it did proven by an owner's record?", of: (x) => unknownIfNoRun(x.runs, (runs) => answer(runs.every((r) => r.word === PROOF), "every run was VERIFIED on an owner's record", `${runs.filter((r) => r.word !== PROOF).length} of ${runs.length} run(s) were reported, failed or stopped — answered is not proven`)) },
  { id: "DELIVERED", ask: "Did it deliver what it provides?", of: (x) => unknownIfNoRun(x.runs, (runs) => answer(runs.some((r) => r.word === PROOF), "at least one run delivered it with proof", "no run delivered it with proof")) },
  { id: "INTERVENTION", ask: "Did it need retries or a person?", of: (x) => unknownIfNoRun(x.runs, (runs) => answer(steps(runs).some((s) => s.retries > 0 || s.waiting || WAITED.includes(s.word)), `${steps(runs).filter((s) => s.retries > 0).length} step(s) were asked again, ${steps(runs).filter((s) => s.waiting || WAITED.includes(s.word)).length} waited or stopped`, "no step was asked again or waited for anyone")) },
];

// Whether to trust it again, from the runs alone: never on one run, and never past what a second independent session
// saw (src/memory/session.mjs is what tells sessions apart; a binding hands in each run's).
const RELIABILITY = [
  { word: "UNTRIED", when: (x) => x.runs.length === 0, because: () => "it has never run" },
  { word: "FAILING", when: (x) => x.runs[0]?.word === "FAILED", because: () => "its newest run FAILED" },
  { word: "INSUFFICIENT", when: (x) => x.runs.length < 2 || new Set(x.runs.map((r) => r.session ?? r.task)).size < 2, because: (x) => `${x.runs.length} run(s) in ${new Set(x.runs.map((r) => r.session ?? r.task)).size} session(s) — one session's success is an observation, never a rule` },
  { word: "UNPROVEN", when: (x) => !x.runs.some((r) => r.word === PROOF), because: () => "its runs answered, and none was proven by an owner's record" },
  { word: "CONSISTENT", when: () => true, because: (x) => `${x.runs.filter((r) => r.word === PROOF).length} of ${x.runs.length} run(s) verified, across ${new Set(x.runs.map((r) => r.session ?? r.task)).size} sessions — consistent so far, never universally reliable` },
];

// A successor is PROPOSED -- never written: a failed contract, a refused call or a workflow that no longer holds is
// what a new version would answer, drafted by a workflow and registered through the whole contract again.
const proposalOf = (x, questions) => ((no) => (no.length ? { successor: true, because: `${no.map((q) => q.id).join(", ")} said no — a new version drafted by a workflow (propose-skill) and held to the contract again would answer it; this version is never rewritten`, writes: "nothing" } : { successor: false, because: "nothing its runs show asks for a new version", writes: "nothing" }))(questions.filter((q) => ["WORKFLOW_VALID", "CONTRACTS"].includes(q.id) && q.answer === "no"));

const versionRow = (runs) => (v) => ((mine) => ({ ...v, runs: mine.length, verified: mine.filter((r) => r.word === PROOF).length, reported: mine.filter((r) => r.word === "REPORTED").length, failed: mine.filter((r) => r.word === "FAILED").length, blocked: mine.filter((r) => ["BLOCKED", "INTERRUPTED"].includes(r.word)).length }))(runs.filter((r) => r.pin === v.pin));

export function reviewOf(x) {
  const runs = [...(x.runs ?? [])].sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  const facts = { ...x, runs, versions: x.versions ?? [] };
  const questions = REVIEW.map((q) => ({ id: q.id, ask: q.ask, ...q.of(facts) }));
  return { id: x.id, versions: facts.versions.map(versionRow(runs)), questions, reliability: ((row) => ({ word: row.word, runs: runs.length, because: row.because(facts) }))(RELIABILITY.find((r) => r.when(facts))), proposal: proposalOf(facts, questions) };
}

export const REVIEW_IDS = REVIEW.map((q) => q.id);
