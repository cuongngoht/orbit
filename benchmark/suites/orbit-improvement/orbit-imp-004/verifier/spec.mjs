// THE SPEC of ORBIT-IMP-004: how many INDEPENDENT sessions a set of runs came from, and the two decisions that rest on
// that count -- whether a promoted version REGRESSED, and whether a recurring problem is an OPPORTUNITY -- written from
// their contract (ADR 0045, "What counts as evidence" and "Monitoring and rollback"; AGENTS.md, "A definition improves
// only on independent evidence"; the headers of src/improvement/signals.mjs, monitor.mjs and detect.mjs) and never
// from their code. Kept beside the probe and handed to no runner; it never imports the subject.
//
// Independence is one machine on one UTC day, learn's own rule (src/memory/session.mjs). A host's session MARK reaches
// a command as a variable its shell can set, so it is never counted: two marks on one machine and day are one session,
// and runs repeated inside one sitting count once. After a promotion, ordinary work's runs are read the way detection
// reads them, in order: the definition's own failure back in `minSessions` independent sessions is REGRESSED; too few
// runs or sessions say nothing (INSUFFICIENT); runs mostly stopped by the environment are CONFOUNDED; runs that held in
// `minSessions` sessions are STABLE; anything else is INSUFFICIENT. Detection groups the runs that showed one problem
// and holds each group to `minRuns` runs in `minSessions` independent sessions, refuses what a definition does not
// decide (an environment, a provider), and calls a problem that held in at least as many sessions as showed it
// CONTRADICTED.
//
// What a run showed is its owner's own words (the run's receipts: a step's VERIFY_FAILED, an INPUT_MISSING or TIMEOUT
// block, a provider's FAILED; a mission's conclusion for a role), and the spec builds each run from the signal it
// means. Every check is a set of runs and the settings, and an expectation over the ids the probe reports: the
// observation's word, `opportunity:<signal>:<eligibility>` for each problem detection found, or the session count.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to the hand-written expectations of the fixed checks
export const CASE = "ORBIT-IMP-004";

export const GROUPS = {
  "sessions-counted": "independent sessions are machines on UTC days: hours apart on one machine-day count once, another day or another machine counts again",
  "session-mark-ignored": "a session mark is never a session: different marks on one machine-day count once, and one mark on two machine-days counts twice",
  regressed: "the definition's own failure back in minSessions independent sessions is REGRESSED",
  "one-sitting-no-regression": "the definition's own failure in one sitting -- one machine, one UTC day, under any session marks -- is never REGRESSED",
  confounded: "runs mostly stopped by the environment are CONFOUNDED, never REGRESSED",
  stable: "runs that held in minSessions independent sessions, the failure not back in enough sessions, are STABLE",
  insufficient: "too few runs, too few independent sessions, or nothing that held in enough of them, say nothing: INSUFFICIENT",
  "role-runs": "a role's runs, read off its missions' conclusions, are watched the same way",
  "detect-sessions": "detection needs minRuns runs in minSessions independent sessions; runs repeated in one sitting, under any marks, are one observation",
  "detect-not-definition": "a problem the environment or a provider caused is never an eligible opportunity",
  "detect-contradicted": "a problem that held in at least as many independent sessions as showed it is CONTRADICTED; marks never add sessions on either side",
  "seeded-sessions": "seeded runs on machines, days and marks: the number of independent sessions is the number of machine-days",
  "seeded-sitting": "seeded: the definition's own failure repeated in one sitting under any marks is never REGRESSED, and never an eligible opportunity",
  "seeded-observe": "seeded runs after a promotion: the observation the contract's table gives",
  "seeded-detect": "seeded runs: each problem's eligibility the contract's table gives",
};

// ---- what a run is made of: its owner's words, and the signal they mean ---------------------------------------------

const A = "laptop-a";
const B = "laptop-b";
const C = "ci-runner";
const HOSTS = [A, B, C];
const DAYS = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"];
const MARKS = [null, "s-1", "s-2", "s-3"];

const step = (id, word, over = {}) => ({ id, word, required: true, retries: 0, providers: ["managed:notes"], ...over });

// A declared playbook's run by the words its receipts carry, per the signal those words mean.
const SKILL = {
  "contract-violation": { word: "FAILED", steps: [step("evidence", "CONTRACT_MET"), step("notes", "VERIFY_FAILED")] },
  "input-missing": { word: "BLOCKED", steps: [step("evidence", "CONTRACT_MET"), step("notes", "BLOCKED", { block: "INPUT_MISSING" })] },
  "environment-blocked": { word: "BLOCKED", steps: [step("evidence", "CONTRACT_MET"), step("notes", "BLOCKED", { block: "TIMEOUT" })] },
  "provider-failure": { word: "FAILED", steps: [step("evidence", "CONTRACT_MET"), step("notes", "FAILED")] },
  answered: { word: "REPORTED", steps: [step("evidence", "CONTRACT_MET"), step("notes", "CONTRACT_MET")] },
  verified: { word: "VERIFIED", steps: [step("evidence", "VERIFIED"), step("notes", "VERIFIED")] },
  open: { word: "RUNNING", steps: [step("evidence", "RUNNING")] },
};

// A role's run by the conclusion its mission reached, per the signal that conclusion means.
const ROLE_RUN = {
  "unverified-outcome": { outcome: "insufficient", level: "REPORTED" },
  "environment-blocked": { outcome: "blocked", level: "NONE" },
  answered: { outcome: "succeeded", level: "REPORTED" },
  verified: { outcome: "succeeded", level: "VERIFIED" },
};

// What each signal is, by the owner's vocabulary: the definition's own failure, a run that held, an environment that
// stopped it, a provider that failed it -- or nothing yet, for a run still open.
const ROLE = { "contract-violation": "definition", "input-missing": "definition", "unverified-outcome": "definition", "environment-blocked": "environment", "provider-failure": "provider", answered: "healthy", verified: "healthy", open: null };

const hh = (n) => String(n).padStart(2, "0");

const atOf = (p) => `${DAYS[p.day]}T${hh(p.hour ?? 10)}:${hh(p.minute ?? 0)}:00.000Z`;

// One run as the spec plans it: the signal it means, where, when, and the mark its shell carried.
const plan = (signal, host, day, o = {}) => ({ signal, host, day, hour: o.hour, minute: o.minute, mark: o.mark ?? null, role: o.role === true });

const skillRecord = (p, i) => ({ task: `tsk-${String(i + 1).padStart(12, "0")}`, run: `srun-${i + 1}`, pin: "release-notes:1.0.1:bbbbbbbb", word: SKILL[p.signal].word, at: atOf(p), session: p.mark, host: p.host, steps: SKILL[p.signal].steps });

const roleRecord = (p, i) => ({ kind: "satellite", mission: `msn-${String(i + 1).padStart(12, "0")}`, run: `arn-${i + 1}`, rolePin: "rol-release-reader:1.0.1:bbbbbbbb", at: atOf(p), session: p.mark, host: p.host, ...ROLE_RUN[p.signal], signature: "notes-unproven", attribution: "RUNTIME_BOUND" });

const recordsOf = (plans) => plans.map((p, i) => (p.role ? roleRecord(p, i) : skillRecord(p, i)));

// ---- the reference model: the contract's tables, as data ------------------------------------------------------------

// One machine on one UTC day, as learn counts a session: never the mark a shell set.
const sessionOf = (p) => `${p.host}@${DAYS[p.day]}`;

const sessionsIn = (plans) => new Set(plans.map(sessionOf)).size;

const policyOf = (values) => ({ detect: true, minSessions: 2, minRuns: 3, ...(values?.improvement ?? {}) });

const playing = (plans, role) => plans.filter((p) => ROLE[p.signal] === role);

const factsOf = (plans, values) => ((runs) => ({ runs, min: policyOf(values).minSessions, minRuns: policyOf(values).minRuns, failing: playing(runs, "definition"), clean: playing(runs, "healthy"), blocked: playing(runs, "environment") }))(plans.filter((p) => ROLE[p.signal] !== null));

// In its order: the first row that holds decides.
const MONITOR = [
  { word: "REGRESSED", when: (f) => sessionsIn(f.failing) >= f.min },
  { word: "INSUFFICIENT", when: (f) => f.runs.length < f.minRuns || sessionsIn(f.runs) < f.min },
  { word: "CONFOUNDED", when: (f) => f.blocked.length * 2 > f.runs.length },
  { word: "STABLE", when: (f) => sessionsIn(f.clean) >= f.min },
  { word: "INSUFFICIENT", when: () => true },
];

export const observed = (plans, values) => ((f) => MONITOR.find((r) => r.when(f)).word)(factsOf(plans, values));

// One group per problem a version's runs showed; the runs of the same version that held count against it.
const CATEGORY = { "contract-violation": "definition", "input-missing": "definition", "environment-blocked": "environment", "provider-failure": "provider" };

const ELIGIBILITY = [
  { check: "DETECTION_OFF", fails: (g) => g.policy.detect === false },
  { check: "NOT_A_DEFINITION_DEFECT", fails: (g) => g.category !== "definition" },
  { check: "TOO_FEW_RUNS", fails: (g) => g.runs < g.policy.minRuns },
  { check: "TOO_FEW_SESSIONS", fails: (g) => g.sessions < g.policy.minSessions },
  { check: "CONTRADICTED", fails: (g) => g.against >= g.sessions },
];

const groupOf = (plans, signal, values) => ((runs) => ({ category: CATEGORY[signal], runs: runs.length, sessions: sessionsIn(runs), against: sessionsIn(playing(plans, "healthy")), policy: policyOf(values) }))(plans.filter((p) => p.signal === signal));

const eligibilityOf = (g) => ELIGIBILITY.find((r) => r.fails(g))?.check ?? "ELIGIBLE";

export const detected = (plans, values) => [...new Set(plans.map((p) => p.signal).filter((s) => CATEGORY[s]))].sort().map((s) => `opportunity:${s}:${eligibilityOf(groupOf(plans, s, values))}`);

export const counted = (plans) => [`sessions:${sessionsIn(plans)}`, `keys:${sessionsIn(plans)}`];

// ---- the calls ------------------------------------------------------------------------------------------------------

const NOW = "2026-10-20T00:00:00.000Z";

const settings = (o = {}) => ({ improvement: { minSessions: o.min ?? 2, minRuns: o.runs ?? 3 } });

const observe = (plans, values) => ({ call: "observe", records: recordsOf(plans), values });

const detect = (plans, values) => ({ call: "detect", records: recordsOf(plans), values, now: NOW });

const count = (plans) => ({ call: "sessions", records: recordsOf(plans) });

const row = (group, input, ids, plans, values) => ({ group, input, ids, plans, values });

const watched = (group, word, plans, values = settings()) => row(group, observe(plans, values), [word], plans, values);

const found = (group, ids, plans, values = settings()) => row(group, detect(plans, values), ids, plans, values);

const sessionsRow = (group, n, plans) => row(group, count(plans), [`sessions:${n}`, `keys:${n}`], plans, null);

// Several runs of one signal, each [host, day, options].
const runs = (signal, where) => where.map(([host, day, o]) => plan(signal, host, day, o));

const roleRuns = (signal, where) => where.map(([host, day, o]) => plan(signal, host, day, { ...o, role: true }));

// ---- the fixed checks, each expectation written by hand from the contract -------------------------------------------

const FIXED = [
  sessionsRow("sessions-counted", 1, runs("contract-violation", [[A, 0, { hour: 1 }], [A, 0, { hour: 12 }], [A, 0, { hour: 23 }]])),
  sessionsRow("sessions-counted", 2, runs("contract-violation", [[A, 0], [A, 1]])),
  sessionsRow("sessions-counted", 2, runs("answered", [[A, 0], [B, 0]])),
  sessionsRow("sessions-counted", 2, runs("contract-violation", [[A, 0, { hour: 23, minute: 59 }], [A, 1, { hour: 0, minute: 1 }]])),
  sessionsRow("sessions-counted", 0, []),
  sessionsRow("session-mark-ignored", 1, runs("contract-violation", [[A, 0, { mark: "s-1" }], [A, 0, { mark: "s-2", hour: 11 }], [A, 0, { mark: "s-3", hour: 12 }]])),
  sessionsRow("session-mark-ignored", 2, runs("contract-violation", [[A, 0, { mark: "s-1" }], [A, 1, { mark: "s-1" }]])),
  sessionsRow("session-mark-ignored", 1, runs("answered", [[B, 2, { mark: "s-1" }], [B, 2, { hour: 18 }]])),
  watched("regressed", "REGRESSED", runs("contract-violation", [[A, 0], [A, 1]])),
  watched("regressed", "REGRESSED", [plan("contract-violation", A, 0), plan("input-missing", B, 0)]),
  watched("regressed", "REGRESSED", [...runs("contract-violation", [[A, 0], [B, 1]]), ...runs("answered", [[A, 1], [B, 2], [C, 3]])]),
  watched("regressed", "REGRESSED", runs("input-missing", [[A, 0], [A, 1], [B, 2]]), settings({ min: 3 })),
  watched("one-sitting-no-regression", "INSUFFICIENT", runs("contract-violation", [[A, 0, { hour: 9 }], [A, 0, { hour: 15 }]])),
  watched("one-sitting-no-regression", "INSUFFICIENT", runs("contract-violation", [[A, 0, { mark: "s-1" }], [A, 0, { mark: "s-2", hour: 11 }], [A, 0, { mark: "s-3", hour: 12 }]])),
  watched("one-sitting-no-regression", "STABLE", [...runs("contract-violation", [[A, 0, { mark: "s-1" }], [A, 0, { mark: "s-2", hour: 14 }]]), ...runs("answered", [[A, 1], [B, 2]])]),
  watched("one-sitting-no-regression", "STABLE", [...runs("contract-violation", [[A, 0], [B, 1], [B, 1, { mark: "s-2", hour: 16 }]]), ...runs("verified", [[C, 2], [C, 3], [A, 3]])], settings({ min: 3 })),
  watched("confounded", "CONFOUNDED", [...runs("environment-blocked", [[A, 0], [A, 1], [A, 2]]), plan("answered", A, 2, { hour: 15 })]),
  watched("confounded", "CONFOUNDED", runs("environment-blocked", [[A, 0], [B, 1], [C, 2], [A, 3]])),
  watched("confounded", "CONFOUNDED", [...runs("environment-blocked", [[A, 0], [B, 1], [C, 2]]), plan("contract-violation", A, 0, { hour: 13 })]),
  watched("stable", "STABLE", runs("answered", [[A, 0], [A, 1], [B, 2]])),
  watched("stable", "STABLE", [plan("verified", A, 0), plan("verified", B, 0), plan("answered", A, 0, { hour: 12 })]),
  watched("stable", "STABLE", [plan("contract-violation", A, 0), ...runs("answered", [[A, 1], [B, 2]])]),
  watched("insufficient", "INSUFFICIENT", runs("answered", [[A, 0], [A, 1]])),
  watched("insufficient", "INSUFFICIENT", runs("answered", [[A, 0, { hour: 8 }], [A, 0, { hour: 9 }], [A, 0, { hour: 10 }]])),
  watched("insufficient", "INSUFFICIENT", []),
  watched("insufficient", "INSUFFICIENT", runs("open", [[A, 0], [B, 1], [C, 2]])),
  watched("insufficient", "INSUFFICIENT", runs("provider-failure", [[A, 0], [A, 1], [B, 2]])),
  watched("role-runs", "REGRESSED", roleRuns("unverified-outcome", [[A, 0], [A, 1]])),
  watched("role-runs", "STABLE", [...roleRuns("unverified-outcome", [[A, 0, { mark: "s-1" }], [A, 0, { mark: "s-2", hour: 14 }]]), ...roleRuns("verified", [[A, 1]]), ...roleRuns("answered", [[B, 2]])]),
  watched("role-runs", "CONFOUNDED", roleRuns("environment-blocked", [[A, 0], [B, 1], [C, 2]])),
  found("detect-sessions", ["opportunity:contract-violation:TOO_FEW_SESSIONS"], runs("contract-violation", [[A, 0, { hour: 8 }], [A, 0, { hour: 12 }], [A, 0, { hour: 16 }]])),
  found("detect-sessions", ["opportunity:contract-violation:TOO_FEW_SESSIONS"], runs("contract-violation", [[A, 0, { mark: "s-1" }], [A, 0, { mark: "s-2", hour: 11 }], [A, 0, { mark: "s-3", hour: 12 }]])),
  found("detect-sessions", ["opportunity:contract-violation:ELIGIBLE"], runs("contract-violation", [[A, 0], [A, 0, { hour: 14 }], [A, 1]])),
  found("detect-sessions", ["opportunity:contract-violation:TOO_FEW_RUNS"], runs("contract-violation", [[A, 0], [A, 1]])),
  found("detect-sessions", ["opportunity:input-missing:ELIGIBLE"], runs("input-missing", [[A, 0, { mark: "s-1" }], [A, 1, { mark: "s-1" }], [B, 2, { mark: "s-1" }]])),
  found("detect-sessions", ["opportunity:contract-violation:TOO_FEW_SESSIONS"], runs("contract-violation", [[A, 0], [B, 1], [B, 1, { mark: "s-2", hour: 15 }]]), settings({ min: 3 })),
  found("detect-not-definition", ["opportunity:environment-blocked:NOT_A_DEFINITION_DEFECT"], runs("environment-blocked", [[A, 0], [A, 1], [B, 2]])),
  found("detect-not-definition", ["opportunity:provider-failure:NOT_A_DEFINITION_DEFECT"], runs("provider-failure", [[A, 0], [A, 1], [B, 2]])),
  found("detect-not-definition", ["opportunity:contract-violation:ELIGIBLE", "opportunity:environment-blocked:NOT_A_DEFINITION_DEFECT"], [...runs("contract-violation", [[A, 0], [A, 1], [B, 2]]), plan("environment-blocked", C, 3)]),
  found("detect-contradicted", ["opportunity:contract-violation:CONTRADICTED"], [...runs("contract-violation", [[A, 0], [A, 0, { hour: 13 }], [A, 1]]), ...runs("answered", [[B, 2], [B, 3], [C, 3]])]),
  found("detect-contradicted", ["opportunity:contract-violation:ELIGIBLE"], [...runs("contract-violation", [[A, 0], [A, 1], [B, 2]]), plan("answered", C, 3)]),
  found("detect-contradicted", ["opportunity:contract-violation:ELIGIBLE"], [...runs("contract-violation", [[A, 0], [A, 1], [A, 1, { hour: 15 }]]), ...runs("answered", [[B, 2, { mark: "s-1" }], [B, 2, { mark: "s-2", hour: 12 }], [B, 2, { mark: "s-3", hour: 14 }]])]),
  found("detect-contradicted", ["opportunity:contract-violation:CONTRADICTED"], [...runs("contract-violation", [[A, 0], [A, 1], [A, 1, { hour: 16 }]]), ...runs("verified", [[B, 2], [B, 3]])]),
];

const asCheck = (x) => ({ group: x.group, input: x.input, expect: { exactly: x.ids } });

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

const anyDay = (r) => Math.floor(r() * DAYS.length);

const anyRun = (r, signals) => plan(pick(r, signals), pick(r, HOSTS), anyDay(r), { hour: Math.floor(r() * 24), minute: Math.floor(r() * 60), mark: pick(r, MARKS) });

const seededPlans = (r, signals, least, most) => Array.from({ length: least + Math.floor(r() * (most - least + 1)) }, () => anyRun(r, signals));

const anySettings = (r) => settings({ min: pick(r, [2, 2, 3]), runs: pick(r, [2, 3, 4]) });

const OBSERVED = ["contract-violation", "contract-violation", "input-missing", "answered", "answered", "verified", "environment-blocked", "environment-blocked", "provider-failure", "open"];

const PROBLEMS = ["contract-violation", "contract-violation", "input-missing", "environment-blocked"];

const DETECTED = [...PROBLEMS, "answered", "answered", "verified"];

const seededSessions = (r) => ((plans) => ({ group: "seeded-sessions", input: count(plans), expect: { exactly: counted(plans) } }))(seededPlans(r, OBSERVED, 0, 7));

const seededObserve = (r) => ((plans, values) => ({ group: "seeded-observe", input: observe(plans, values), expect: { exactly: [observed(plans, values)] } }))(seededPlans(r, OBSERVED, 2, 9), anySettings(r));

// Mostly one problem, the rest anything detection reads -- other problems, and runs of the same version that held.
function seededDetect(r) {
  const lead = pick(r, PROBLEMS);
  const plans = Array.from({ length: 3 + Math.floor(r() * 7) }, () => anyRun(r, [r() < 0.6 ? lead : pick(r, DETECTED)]));
  const values = anySettings(r);
  return { group: "seeded-detect", input: detect(plans, values), expect: { exactly: detected(plans, values) } };
}

// The definition's own failure two to five times in one sitting, under any marks, beside runs elsewhere that held.
function seededSitting(r) {
  const host = pick(r, HOSTS);
  const day = anyDay(r);
  const plans = [...Array.from({ length: 2 + Math.floor(r() * 4) }, (_, i) => plan(pick(r, ["contract-violation", "input-missing"]), host, day, { hour: 6 + i * 3, mark: pick(r, MARKS) })), ...seededPlans(r, ["answered", "verified"], 0, 3)];
  const values = anySettings(r);
  return [{ group: "seeded-sitting", input: observe(plans, values), expect: { exactly: [observed(plans, values)] } }, { group: "seeded-sitting", input: detect(plans, values), expect: { exactly: detected(plans, values) } }];
}

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

const many = (n, make, r) => Array.from({ length: n }, () => make(r));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  const quarter = Math.max(4, Math.floor(samples / 4));
  const seeded = [...many(quarter, seededSessions, r), ...many(Math.max(4, Math.floor(samples / 6)), seededSitting, r).flat(), ...many(Math.max(8, Math.floor(samples / 3)), seededObserve, r), ...many(quarter, seededDetect, r)];
  return numbered([...FIXED.map(asCheck), ...seeded]);
}

// ---- the reference model, held to what the contract says in words --------------------------------------------------

const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const MODELS = { observe: (x) => [observed(x.plans, x.values)], detect: (x) => detected(x.plans, x.values), sessions: (x) => counted(x.plans) };

const neverRegressed = () => cases(7, 48).filter((c) => c.group === "seeded-sitting" && c.input.call === "observe").every((c) => c.expect.exactly[0] !== "REGRESSED");

const neverEligible = () => cases(7, 48).filter((c) => c.group === "seeded-sitting" && c.input.call === "detect").every((c) => !c.expect.exactly.some((id) => /^opportunity:(contract-violation|input-missing):ELIGIBLE$/.test(id)));

export const selfTest = () => [...FIXED.filter((x) => !sameIds(MODELS[x.input.call](x), x.ids)).map((x) => `the reference model disagrees with the contract on a ${x.group} check: expected ${x.ids.join(" ")}`), ...(neverRegressed() && neverEligible() ? [] : ["a failure repeated in one sitting is owed a regression or an eligible opportunity"])];
