// THE SPEC of ORBIT-IMP-003: the twelve PROMOTION GATES a qualified candidate passes before it may run for new work,
// written from their contract (ADR 0045, "Promotion: twelve gates, then the owner's own door" and "What counts as
// evidence"; ADR 0044, a call is attributed only by evidence; AGENTS.md, "A run knows its identity" and "A definition
// improves only on independent evidence"; the header of src/improvement/gates.mjs) and never from their code. Kept
// beside the probe and handed to no runner; it never imports the subject.
//
// Every gate is asked every time, in order, and the first that does not hold decides what happens instead: reject,
// supersede, wait, block, await or stale. A candidate run counts as evidence only when the engine bound it
// (RUNTIME_BOUND) or the host's own payload linked it (HOST_OBSERVED): a run somebody only REPORTED -- or one nothing
// attributes, or two sources disagree about -- proves nothing. A person's disable, archive or revocation of the version
// in place always wins, and a person's door (Orbit Control) passes the policy gate and no other.
//
// Every check is the facts a promotion is asked about and an expectation over the ids the probe reports: the decision
// and the gate that decided it (none when it promotes), every gate in its order with its outcome, or every gate that
// does not hold. Each fixed check breaks one thing of a candidate that holds everywhere; seeded checks break several at
// once. Both directions are checked, so gates that pass everything fail as surely as gates that pass nothing.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to the hand-written expectations of the fixed checks
export const CASE = "ORBIT-IMP-003";

export const GROUPS = {
  "all-hold": "a candidate every gate holds for is promoted, and no gate is named",
  "gate-order": "the twelve gates are asked every time, in their order, each with the outcome it decides when it does not hold",
  "one-gate-fails": "a candidate one gate does not hold for gets that gate's own outcome, and the gate is named",
  "reported-never-proves": "a candidate run only reported -- or unattributed, or conflicting -- proves nothing: EVIDENCE_INDEPENDENT waits",
  "proving-attribution": "candidate runs the engine bound or the host observed prove: they hold EVIDENCE_INDEPENDENT",
  withheld: "a version in place that a person disabled, archived or revoked holds every promotion: NOT_WITHHELD blocks",
  "persons-door": "a person's door passes the policy gate and no other",
  "first-failure-decides": "seeded: when several gates do not hold, the first in order decides and is named",
  "every-gate-asked": "seeded: every gate is asked every time, so each one that does not hold is reported, not only the first",
  "seeded-attribution": "seeded: candidate runs under random attribution words, later gates broken at random: EVIDENCE_INDEPENDENT holds only when every candidate run was bound by the engine or observed by the host",
  "seeded-withheld": "seeded: a person's switches on the version in place, later gates broken at random, through either door: any disable, archive or revocation blocks",
};

// ---- the reference model: the gates in their order, as data ----------------------------------------------------------

// What proves a run, by ADR 0044's words: Orbit bound it as it made the call, or the host's own payload linked it.
const PROVING = ["RUNTIME_BOUND", "HOST_OBSERVED"];

const policyOf = (f) => ({ promote: true, minSessions: 2, ...(f.values?.improvement ?? {}) });

const candidateRuns = (f) => f.runs.filter((r) => r.side === "candidate");

const GATES = [
  { id: "CANDIDATE_INTACT", onFail: "reject", holds: (f) => f.candidate.intact === true && f.candidate.digest === f.m.candidate.digest },
  { id: "CAPABILITIES_PROVIDED", onFail: "reject", holds: (f) => f.validation.ok === true },
  { id: "PARENT_CURRENT", onFail: "supersede", holds: (f) => f.current.pin === f.m.meta.pin },
  { id: "EVALUATION_COMPLETE", onFail: "wait", holds: (f) => f.aggregate.verdict === "BETTER" && f.open !== true },
  { id: "EVIDENCE_INDEPENDENT", onFail: "wait", holds: (f) => f.aggregate.sessions >= policyOf(f).minSessions && candidateRuns(f).every((r) => PROVING.includes(r.attribution)) },
  { id: "REQUIRED_CHECKS", onFail: "reject", holds: (f) => candidateRuns(f).length > 0 && candidateRuns(f).every((r) => r.met === true) },
  { id: "NO_CRITICAL_REGRESSION", onFail: "reject", holds: (f) => f.regressions.length === 0 },
  { id: "NO_NEW_PERMISSIONS", onFail: "reject", holds: (f) => f.widened.length === 0 },
  { id: "ORACLE_UNCHANGED", onFail: "reject", holds: (f) => f.weakened.length === 0 },
  { id: "NOT_WITHHELD", onFail: "block", holds: (f) => f.current.status === "active" && f.current.archived !== true && f.current.revoked !== true },
  { id: "POLICY_ALLOWS", onFail: "await", holds: (f) => f.door === "control" || policyOf(f).promote === true },
  { id: "REVISION_CURRENT", onFail: "stale", holds: (f) => f.revisionOk !== false },
];

export const decided = (f) => ((g) => (g ? [g.onFail, g.id] : ["promote"]))(GATES.find((g) => !g.holds(f)));

export const failingOf = (f) => GATES.filter((g) => !g.holds(f)).map((g) => g.id);

// ---- what the inputs are made of ------------------------------------------------------------------------------------

const PIN = "release-notes:1.0.0:aaaaaaaa";
const CANDIDATE = "release-notes:1.0.1:bbbbbbbb";

const baseRun = (n) => ({ evaluation: "ev-1", side: "baseline", n, word: "FAILED", met: false, failing: ["notes"], blocked: false, attribution: "RUNTIME_BOUND", evidence: "NONE" });

const candRun = (n) => ({ evaluation: "ev-1", side: "candidate", n, word: "REPORTED", met: true, failing: [], blocked: false, attribution: "RUNTIME_BOUND", evidence: "CONTRACT_MET" });

// Everything a promotion is asked about, every gate holding: the candidate read back intact, its owner's contract
// holding it, the version it was compared with still in place and active, better in two independent sessions on runs
// the engine bound, nothing newly failing, widened or weakened, and a person letting the engine promote.
const holding = () => ({
  m: { meta: { pin: PIN, subjectId: "release-notes" }, candidate: { pin: CANDIDATE, digest: "d1" } },
  aggregate: { verdict: "BETTER", sessions: 2, evaluations: 2 },
  open: false,
  candidate: { pin: CANDIDATE, digest: "d1", intact: true },
  validation: { ok: true, findings: [] },
  current: { pin: PIN, status: "active" },
  weakened: [],
  widened: [],
  runs: [1, 2, 3].flatMap((n) => [baseRun(n), candRun(n)]),
  regressions: [],
  values: { improvement: { promote: true, minSessions: 2 } },
  door: "improvement",
  revisionOk: true,
});

const onCandidate = (f, n, over) => ({ ...f, runs: f.runs.map((r) => (r.side === "candidate" && r.n === n ? { ...r, ...over } : r)) });

const attributed = (word, n = 1) => (f) => onCandidate(f, n, { attribution: word });

const everyAttributed = (word) => (f) => [1, 2, 3].reduce((x, n) => onCandidate(x, n, { attribution: word }), f);

const current = (over) => (f) => ({ ...f, current: { ...f.current, ...over } });

const settings = (over) => (f) => ({ ...f, values: { improvement: { ...f.values.improvement, ...over } } });

// Each break touches only what its own gate asks about, so several compose.
const BREAKS = {
  CANDIDATE_INTACT: [(f) => ({ ...f, candidate: { ...f.candidate, intact: false } }), (f) => ({ ...f, candidate: { ...f.candidate, digest: "d2" } })],
  CAPABILITIES_PROVIDED: [(f) => ({ ...f, validation: { ok: false, findings: [{ id: "SF_CAPABILITY_MISSING" }] } })],
  PARENT_CURRENT: [current({ pin: "release-notes:1.0.2:cccccccc" })],
  EVALUATION_COMPLETE: [(f) => ({ ...f, aggregate: { ...f.aggregate, verdict: "INCONCLUSIVE" } }), (f) => ({ ...f, open: true })],
  EVIDENCE_INDEPENDENT: [(f) => ({ ...f, aggregate: { ...f.aggregate, sessions: 1 } }), settings({ minSessions: 3 }), attributed("REPORTED"), attributed("UNATTRIBUTED", 2)],
  REQUIRED_CHECKS: [(f) => onCandidate(f, 3, { word: "FAILED", met: false, failing: ["notes"], evidence: "NONE" })],
  NO_CRITICAL_REGRESSION: [(f) => ({ ...f, regressions: ["evidence"] })],
  NO_NEW_PERMISSIONS: [(f) => ({ ...f, widened: ["Bash"] })],
  ORACLE_UNCHANGED: [(f) => ({ ...f, weakened: [{ id: "RULE_LOOSENED", says: "notes: a lower bound on hits dropped from 1 to 0" }] })],
  NOT_WITHHELD: [current({ status: "disabled" }), current({ archived: true }), current({ revoked: true })],
  POLICY_ALLOWS: [settings({ promote: false })],
  REVISION_CURRENT: [(f) => ({ ...f, revisionOk: false })],
};

const decide = (facts) => ({ call: "decide", facts });

const row = (group, facts, ids) => ({ group, facts, ids });

const broken = (...fns) => fns.reduce((f, fn) => fn(f), holding());

const ORDER = ["CANDIDATE_INTACT:reject", "CAPABILITIES_PROVIDED:reject", "PARENT_CURRENT:supersede", "EVALUATION_COMPLETE:wait", "EVIDENCE_INDEPENDENT:wait", "REQUIRED_CHECKS:reject", "NO_CRITICAL_REGRESSION:reject", "NO_NEW_PERMISSIONS:reject", "ORACLE_UNCHANGED:reject", "NOT_WITHHELD:block", "POLICY_ALLOWS:await", "REVISION_CURRENT:stale"].map((x, i) => `${i + 1}:${x}`);

// ---- the fixed checks, each expectation written by hand from the contract -------------------------------------------

const FIXED = [
  row("all-hold", holding(), ["promote"]),
  row("all-hold", { ...holding(), values: {} }, ["promote"]),
  row("one-gate-fails", broken(BREAKS.CANDIDATE_INTACT[0]), ["reject", "CANDIDATE_INTACT"]),
  row("one-gate-fails", broken(BREAKS.CANDIDATE_INTACT[1]), ["reject", "CANDIDATE_INTACT"]),
  row("one-gate-fails", broken(BREAKS.CAPABILITIES_PROVIDED[0]), ["reject", "CAPABILITIES_PROVIDED"]),
  row("one-gate-fails", broken(BREAKS.PARENT_CURRENT[0]), ["supersede", "PARENT_CURRENT"]),
  row("one-gate-fails", broken(BREAKS.EVALUATION_COMPLETE[0]), ["wait", "EVALUATION_COMPLETE"]),
  row("one-gate-fails", broken(BREAKS.EVALUATION_COMPLETE[1]), ["wait", "EVALUATION_COMPLETE"]),
  row("one-gate-fails", broken(BREAKS.EVIDENCE_INDEPENDENT[0]), ["wait", "EVIDENCE_INDEPENDENT"]),
  row("one-gate-fails", broken(BREAKS.EVIDENCE_INDEPENDENT[1]), ["wait", "EVIDENCE_INDEPENDENT"]),
  row("one-gate-fails", broken(BREAKS.REQUIRED_CHECKS[0]), ["reject", "REQUIRED_CHECKS"]),
  row("one-gate-fails", broken(BREAKS.NO_CRITICAL_REGRESSION[0]), ["reject", "NO_CRITICAL_REGRESSION"]),
  row("one-gate-fails", broken(BREAKS.NO_NEW_PERMISSIONS[0]), ["reject", "NO_NEW_PERMISSIONS"]),
  row("one-gate-fails", broken(BREAKS.ORACLE_UNCHANGED[0]), ["reject", "ORACLE_UNCHANGED"]),
  row("one-gate-fails", broken(BREAKS.POLICY_ALLOWS[0]), ["await", "POLICY_ALLOWS"]),
  row("one-gate-fails", broken(BREAKS.REVISION_CURRENT[0]), ["stale", "REVISION_CURRENT"]),
  row("reported-never-proves", broken(attributed("REPORTED")), ["wait", "EVIDENCE_INDEPENDENT"]),
  row("reported-never-proves", broken(everyAttributed("REPORTED")), ["wait", "EVIDENCE_INDEPENDENT"]),
  row("reported-never-proves", broken(attributed("REPORTED", 3), (f) => ({ ...f, aggregate: { ...f.aggregate, sessions: 6 } })), ["wait", "EVIDENCE_INDEPENDENT"]),
  row("reported-never-proves", broken(attributed("UNATTRIBUTED", 2)), ["wait", "EVIDENCE_INDEPENDENT"]),
  row("reported-never-proves", broken(attributed("CONFLICTING")), ["wait", "EVIDENCE_INDEPENDENT"]),
  row("reported-never-proves", broken(everyAttributed("REPORTED"), (f) => ({ ...f, door: "control" })), ["wait", "EVIDENCE_INDEPENDENT"]),
  row("proving-attribution", broken(everyAttributed("HOST_OBSERVED")), ["promote"]),
  row("proving-attribution", broken(attributed("HOST_OBSERVED", 2)), ["promote"]),
  row("withheld", broken(current({ status: "disabled" })), ["block", "NOT_WITHHELD"]),
  row("withheld", broken(current({ status: "retired" })), ["block", "NOT_WITHHELD"]),
  row("withheld", broken(current({ archived: true })), ["block", "NOT_WITHHELD"]),
  row("withheld", broken(current({ revoked: true })), ["block", "NOT_WITHHELD"]),
  row("withheld", broken(current({ revoked: true }), (f) => ({ ...f, door: "control" })), ["block", "NOT_WITHHELD"]),
  row("persons-door", broken(settings({ promote: false }), (f) => ({ ...f, door: "control" })), ["promote"]),
  row("persons-door", broken(BREAKS.CAPABILITIES_PROVIDED[0], (f) => ({ ...f, door: "control" })), ["reject", "CAPABILITIES_PROVIDED"]),
  row("persons-door", broken(BREAKS.NO_CRITICAL_REGRESSION[0], (f) => ({ ...f, door: "control" })), ["reject", "NO_CRITICAL_REGRESSION"]),
  row("persons-door", broken(current({ pin: "release-notes:1.0.2:cccccccc" }), (f) => ({ ...f, door: "control" })), ["supersede", "PARENT_CURRENT"]),
  row("persons-door", broken(BREAKS.REVISION_CURRENT[0], settings({ promote: false }), (f) => ({ ...f, door: "control" })), ["stale", "REVISION_CURRENT"]),
];

const asCheck = (x) => ({ group: x.group, input: decide(x.facts), expect: { exactly: x.ids } });

// No candidate run at all: whichever gate says so, nothing was proven, so nothing is promoted.
const UNPROVEN = { group: "one-gate-fails", input: decide({ ...holding(), runs: holding().runs.filter((r) => r.side === "baseline") }), expect: { lacks: ["promote"] } };

const ORDERED = [holding(), broken(...Object.values(BREAKS).map((list) => list[0]))].map((facts) => ({ group: "gate-order", input: { call: "order", facts }, expect: { exactly: ORDER } }));

// ---- a seeded generator, the same numbers for the same seed --------------------------------------------------------

export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    const t = Math.imul(s ^ (s >>> 15), s | 1);
    const u = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((u ^ (u >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];

const GATE_IDS = Object.keys(BREAKS);

const shuffled = (r, list) => list.map((x) => [r(), x]).sort((a, b) => a[0] - b[0]).map(([, x]) => x);

// Two to four gates broken at once, each by one of its own breaks.
function seededPair(r) {
  const gates = shuffled(r, GATE_IDS).slice(0, 2 + Math.floor(r() * 3));
  const facts = broken(...gates.map((g) => pick(r, BREAKS[g])));
  return [{ group: "first-failure-decides", input: decide(facts), expect: { exactly: decided(facts) } }, { group: "every-gate-asked", input: { call: "failing", facts }, expect: { exactly: failingOf(facts) } }];
}

// Words that never prove a run: somebody said so, nothing says, or two sources disagree.
const UNPROVING = ["REPORTED", "REPORTED", "UNATTRIBUTED", "CONFLICTING"];

const AFTER_EVIDENCE = GATE_IDS.slice(GATE_IDS.indexOf("EVIDENCE_INDEPENDENT") + 1);

const someOf = (r, gates, most) => shuffled(r, gates).slice(0, Math.floor(r() * (most + 1))).map((g) => pick(r, BREAKS[g]));

const seededCheck = (group, facts) => ({ group, input: decide(facts), expect: { exactly: decided(facts) } });

const wordFor = (r, proves) => pick(r, proves ? PROVING : UNPROVING);

// Half the candidates proven on every run, half with one to three runs nothing proves -- and up to two later gates broken.
function seededAttribution(r) {
  const unproven = r() < 0.5 ? shuffled(r, [1, 2, 3]).slice(0, 1 + Math.floor(r() * 3)) : [];
  const words = [1, 2, 3].map((n) => wordFor(r, !unproven.includes(n)));
  return seededCheck("seeded-attribution", broken(...words.map((w, n) => attributed(w, n + 1)), ...someOf(r, AFTER_EVIDENCE, 2)));
}

const SWITCHES = [{}, { status: "disabled" }, { status: "retired" }, { archived: true }, { revoked: true }, { revoked: true }, { revoked: true }, { revoked: true, archived: true }];

const byControl = (f) => ({ ...f, door: "control" });

function seededWithheld(r) {
  const later = someOf(r, ["POLICY_ALLOWS", "REVISION_CURRENT"], 2);
  return seededCheck("seeded-withheld", broken(current(pick(r, SWITCHES)), ...later, ...(r() < 0.5 ? [byControl] : [])));
}

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

const many = (n, make, r) => Array.from({ length: n }, () => make(r));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  const quarter = Math.max(4, Math.floor(samples / 4));
  const seeded = [...many(Math.max(8, Math.floor(samples / 3)), seededPair, r).flat(), ...many(quarter, seededAttribution, r), ...many(quarter, seededWithheld, r)];
  return numbered([...FIXED.map(asCheck), UNPROVEN, ...ORDERED, ...seeded]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const breakFindings = () => Object.entries(BREAKS).flatMap(([gate, list]) => list.filter((fn) => !sameIds(failingOf(fn(holding())), [gate])).map(() => `a break of ${gate} does not fail exactly that gate`));

const orderFindings = () => (GATES.length === ORDER.length && GATES.every((g, i) => ORDER[i] === `${i + 1}:${g.id}:${g.onFail}`) ? [] : ["the reference gates are not the contract's twelve, in its order, with its outcomes"]);

export const selfTest = () => [...FIXED.filter((x) => !sameIds(decided(x.facts), x.ids)).map((x) => `the reference model disagrees with the contract on a ${x.group} promotion: expected ${x.ids.join(" ")}`), ...breakFindings(), ...orderFindings()];
