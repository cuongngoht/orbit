// THE SPEC of ORBIT-SAT-004: when a Satellite agent run has succeeded and when a mission is VERIFIED, written from the
// contract and never from the code. Kept beside the probe and handed to no runner; the controller imports a FROZEN copy
// of it, and it never imports the subject. Two answers are held here. How a run ENDS is an ordered table over the
// evidence its owners hold: blocked by its own word, violated by a checkout that moved under it, succeeded on evidence
// that reaches its unit's verification contract -- from an INDEPENDENT owner when the contract asks for one --, blocked on
// an owner's BLOCKED record, insufficient otherwise. A mission's VERDICT is VERIFIED only when it recorded criteria and
// every one has a row VERIFIED by an independent owner, from a run that succeeded after its unit's last reset, with
// nothing still open; otherwise NOT_VERIFIED once settled and PENDING before, naming every criterion still owed.
//
// Evidence rows are the ones owners really give back (a run's own report, a handoff, a definition, a file; an
// engineering task's verification, a declared check, a QA investigation, a moved checkout), and seeded runs and
// missions are drawn from them with the run's seed. Every check expects exactly the outcome, or exactly the verdict and
// the criteria owed.
//
//   GROUPS -> { group: sentence }        cases(seed, samples) -> [{ id, group, input, expect }]
//   selfTest() -> [finding]              the reference model held to a table written by hand from the contract
export const CASE = "ORBIT-SAT-004";

export const GROUPS = {
  "run-said-blocked": "a run that said it could not go on is blocked, whatever its evidence says",
  "checkout-moved": "a run whose checkout changed while it was open is violated, ahead of any evidence it brought",
  "any-owner-reached": "a contract that asks for any owner is reached by any evidence at or above its minimum: succeeded",
  "independent-reached": "a contract that asks for an independent owner is reached by an engineering task's, a check's or a QA investigation's own record at or above its minimum: succeeded",
  "independent-owed": "a contract that asks for an independent owner is never reached by evidence nobody independent holds -- the run's own report, a handoff, a definition, a file -- however strong: insufficient, or blocked on an owner's BLOCKED record",
  "below-minimum": "evidence below the contract's minimum reaches nothing: insufficient, or blocked when an owner's record is BLOCKED",
  "reached-beside-blocked": "evidence that reaches the contract succeeds even beside an owner's BLOCKED record",
  "seeded-run": "seeded contracts, run states and evidence rows: exactly the outcome the ordered table comes to",
  "mission-verified": "every criterion verified by an independent owner, from a run that succeeded after its unit's last reset, with nothing open: VERIFIED",
  "criterion-owed": "a criterion with no such row is owed by name: NOT_VERIFIED once settled, PENDING before",
  "open-action": "an action still open keeps a mission from VERIFIED even when nothing is owed; a closed one does not",
  "no-criterion": "a mission with no acceptance criterion recorded is never VERIFIED: NOT_VERIFIED once settled, PENDING before",
  "stale-or-unsucceeded": "a row from a run that did not end succeeded, or from before its unit's last reset, counts toward nothing",
  "seeded-mission": "seeded missions: exactly the verdict, and exactly the criteria owed",
};

const LEVELS = ["UNKNOWN", "BLOCKED", "TOOL_COMPLETED", "CONTRACT_MET", "BEHAVIOR_OBSERVED", "VERIFIED"];

const INDEPENDENT = ["task", "check", "investigation"];

const OPEN = ["INTENT_PERSISTED", "PROVIDER_ACCEPTED", "EXECUTION_OBSERVED"];

const CLOSED = ["NOT_DISPATCHED", "REFUSED", "RESULT_RECORDED", "EVIDENCE_VERIFIED"];

// ---- the reference model: how a run ends, as the contract words it -----------------------------------------------------

const atLeast = (level, min) => LEVELS.indexOf(level) >= LEVELS.indexOf(min);

const reaches = (c, row) => atLeast(row.level, c.unit.verificationContract.min) && (c.unit.verificationContract.owner !== "independent" || row.independent === true);

const OUTCOMES = [
  ["blocked", (c) => c.state === "blocked"],
  ["violated", (c) => c.rows.some((row) => row.owner === "checkout" && row.level === "BLOCKED")],
  ["succeeded", (c) => c.rows.some((row) => reaches(c, row))],
  ["blocked", (c) => c.rows.some((row) => row.level === "BLOCKED")],
  ["insufficient", () => true],
];

export const outcomeOf = (c) => OUTCOMES.find(([, when]) => when(c))[0];

// ---- the reference model: a mission's verdict, as the contract words it ------------------------------------------------

const runIn = (v, id) => v.runs.find((x) => x.id === id);

const unitIn = (v, id) => v.units.find((x) => x.id === id);

// A row counts only from a run that ended succeeded after its unit's last reset.
const counts = (v, row) => ((r, u) => r?.ended?.outcome === "succeeded" && (!u || r.n > u.resetAt))(runIn(v, row.agentRun), unitIn(v, row.unit));

const proves = (v, id) => v.evidence.some((row) => counts(v, row) && row.acceptance.includes(id) && row.level === "VERIFIED" && row.independent === true);

const criteriaOf = (v) => (v.intent?.acceptanceCriteria ?? []).map((c) => c.id);

const owedOf = (v) => criteriaOf(v).filter((id) => !proves(v, id));

const verified = (v) => criteriaOf(v).length > 0 && owedOf(v).length === 0 && !v.actions.some((a) => OPEN.includes(a.status));

export const verdictIds = (v) => [verified(v) ? "VERIFIED" : v.settled ? "NOT_VERIFIED" : "PENDING", ...owedOf(v).map((id) => `owed:${id}`)];

// ---- what a run's evidence is made of -------------------------------------------------------------------------------------

const TASK = "tsk-0123456789ab";

const evidence = (owner, ref, level) => ({ owner, ref, level, independent: INDEPENDENT.includes(owner) });

const ROWS = {
  report: evidence("report", "report:arn-1", "CONTRACT_MET"),
  reportShort: evidence("report", "report:arn-1", "TOOL_COMPLETED"),
  handoff: evidence("handoff", "handoff:hof-1", "CONTRACT_MET"),
  definition: evidence("definition", "definition:release-reader:1.0.0:aaaaaaaa", "CONTRACT_MET"),
  file: evidence("file", "file:src/app/consumer.mjs", "TOOL_COMPLETED"),
  fileGone: evidence("file", "file:src/app/gone.mjs", "UNKNOWN"),
  taskVerified: evidence("task", `task:${TASK}`, "VERIFIED"),
  taskObserved: evidence("task", `task:${TASK}`, "BEHAVIOR_OBSERVED"),
  taskBlocked: evidence("task", `task:${TASK}`, "BLOCKED"),
  taskOpen: evidence("task", `task:${TASK}`, "UNKNOWN"),
  checkVerified: evidence("check", `check:${TASK}:chk-1`, "VERIFIED"),
  checkObserved: evidence("check", `check:${TASK}:chk-1`, "BEHAVIOR_OBSERVED"),
  checkRan: evidence("check", `check:${TASK}:chk-1`, "TOOL_COMPLETED"),
  investigationVerified: evidence("investigation", "investigation:inv-0000000000a1", "VERIFIED"),
  investigationObserved: evidence("investigation", "investigation:inv-0000000000a1", "BEHAVIOR_OBSERVED"),
  investigationBlocked: evidence("investigation", "investigation:inv-0000000000a1", "BLOCKED"),
  checkout: evidence("checkout", "checkout:c0ffee123456:d1d2d3d4", "BLOCKED"),
};

const ran = (min, owner, rows, state = "reported") => ({ call: "outcome", state, unit: { id: "wu-1", verificationContract: { min, owner } }, rows: rows.map((k) => ROWS[k]) });

// ---- the runs written by hand: contract, rows, state -> how the run ends -----------------------------------------------

const RUNS = [
  ["run-said-blocked", ran("VERIFIED", "independent", ["report", "taskVerified"], "blocked"), "blocked"],
  ["run-said-blocked", ran("CONTRACT_MET", "any", ["report"], "blocked"), "blocked"],
  ["checkout-moved", ran("VERIFIED", "independent", ["report", "checkVerified", "checkout"]), "violated"],
  ["checkout-moved", ran("CONTRACT_MET", "any", ["report", "checkout"]), "violated"],
  ["any-owner-reached", ran("CONTRACT_MET", "any", ["report"]), "succeeded"],
  ["any-owner-reached", ran("TOOL_COMPLETED", "any", ["reportShort", "file"]), "succeeded"],
  ["any-owner-reached", ran("BEHAVIOR_OBSERVED", "any", ["report", "taskObserved"]), "succeeded"],
  ["any-owner-reached", ran("CONTRACT_MET", "any", ["reportShort", "handoff"]), "succeeded"],
  ["independent-reached", ran("VERIFIED", "independent", ["report", "taskVerified"]), "succeeded"],
  ["independent-reached", ran("VERIFIED", "independent", ["report", "checkVerified"]), "succeeded"],
  ["independent-reached", ran("VERIFIED", "independent", ["report", "investigationVerified"]), "succeeded"],
  ["independent-reached", ran("BEHAVIOR_OBSERVED", "independent", ["report", "taskObserved"]), "succeeded"],
  ["independent-reached", ran("TOOL_COMPLETED", "independent", ["reportShort", "checkRan"]), "succeeded"],
  ["independent-reached", ran("CONTRACT_MET", "independent", ["report", "checkObserved"]), "succeeded"],
  ["independent-owed", ran("CONTRACT_MET", "independent", ["report"]), "insufficient"],
  ["independent-owed", ran("CONTRACT_MET", "independent", ["report", "handoff", "definition"]), "insufficient"],
  ["independent-owed", ran("TOOL_COMPLETED", "independent", ["reportShort", "file"]), "insufficient"],
  ["independent-owed", ran("CONTRACT_MET", "independent", ["report", "file", "taskOpen"]), "insufficient"],
  ["independent-owed", ran("CONTRACT_MET", "independent", ["report", "checkRan"]), "insufficient"],
  ["independent-owed", ran("CONTRACT_MET", "independent", ["report", "handoff", "taskBlocked"]), "blocked"],
  ["independent-owed", ran("TOOL_COMPLETED", "independent", ["report", "investigationBlocked"]), "blocked"],
  ["below-minimum", ran("VERIFIED", "independent", ["report", "checkObserved"]), "insufficient"],
  ["below-minimum", ran("VERIFIED", "any", ["report", "taskObserved"]), "insufficient"],
  ["below-minimum", ran("CONTRACT_MET", "any", ["reportShort"]), "insufficient"],
  ["below-minimum", ran("BEHAVIOR_OBSERVED", "any", ["reportShort", "fileGone"]), "insufficient"],
  ["below-minimum", ran("VERIFIED", "independent", ["report", "investigationBlocked"]), "blocked"],
  ["reached-beside-blocked", ran("VERIFIED", "independent", ["report", "taskBlocked", "checkVerified"]), "succeeded"],
  ["reached-beside-blocked", ran("CONTRACT_MET", "any", ["report", "investigationBlocked"]), "succeeded"],
];

// ---- what a mission is made of --------------------------------------------------------------------------------------------

const criteria = (ids) => (ids === null ? null : { acceptanceCriteria: ids.map((id) => ({ id, statement: `the outcome ${id} names holds` })) });

const mission = (o) => ({ call: "verdict", settled: o.settled !== false, intent: criteria(o.criteria === undefined ? ["acc-1"] : o.criteria), units: o.units ?? [{ id: "wu-1", resetAt: 3 }], runs: o.runs ?? [], evidence: o.evidence ?? [], actions: o.actions ?? [] });

const run = (id, unit, n, outcome) => ({ id, unit, n, ended: outcome ? { outcome } : null });

const row = (n, agentRun, unit, owner, level, acceptance) => ({ id: `evd-${n}`, agentRun, unit, owner, ref: `${owner}:${agentRun}`, level, independent: INDEPENDENT.includes(owner), verified: level === "VERIFIED" && INDEPENDENT.includes(owner), acceptance });

const act = (n, status) => ({ id: `act-${n}`, status });

const ONE_RUN = [run("arn-1", "wu-1", 10, "succeeded")];

const TWO_UNITS = [{ id: "wu-1", resetAt: 3 }, { id: "wu-2", resetAt: 4 }];

const TWO_RUNS = [run("arn-1", "wu-1", 10, "succeeded"), run("arn-2", "wu-2", 14, "succeeded")];

const PROVEN = [row(1, "arn-1", "wu-1", "task", "VERIFIED", ["acc-1"])];

const DONE = [act(1, "RESULT_RECORDED"), act(2, "EVIDENCE_VERIFIED")];

// ---- the missions written by hand: mission -> verdict and the criteria owed --------------------------------------------

const MISSIONS = [
  ["mission-verified", mission({ runs: ONE_RUN, evidence: PROVEN, actions: DONE }), ["VERIFIED"]],
  ["mission-verified", mission({ criteria: ["acc-1", "acc-2"], units: TWO_UNITS, runs: TWO_RUNS, evidence: [row(1, "arn-1", "wu-1", "check", "VERIFIED", ["acc-1"]), row(2, "arn-2", "wu-2", "investigation", "VERIFIED", ["acc-2"])], actions: DONE }), ["VERIFIED"]],
  ["mission-verified", mission({ criteria: ["acc-1", "acc-2"], runs: ONE_RUN, evidence: [row(1, "arn-1", "wu-1", "task", "VERIFIED", ["acc-1", "acc-2"])] }), ["VERIFIED"]],
  ["mission-verified", mission({ settled: false, runs: ONE_RUN, evidence: PROVEN, actions: DONE }), ["VERIFIED"]],
  ["mission-verified", mission({ units: [{ id: "wu-1", resetAt: 20 }], runs: [run("arn-1", "wu-1", 10, "succeeded"), run("arn-2", "wu-1", 25, "succeeded")], evidence: [row(1, "arn-1", "wu-1", "task", "VERIFIED", ["acc-1"]), row(2, "arn-2", "wu-1", "check", "VERIFIED", ["acc-1"])] }), ["VERIFIED"]],
  ["criterion-owed", mission({ criteria: ["acc-1", "acc-2"], runs: ONE_RUN, evidence: PROVEN, actions: DONE }), ["NOT_VERIFIED", "owed:acc-2"]],
  ["criterion-owed", mission({ criteria: ["acc-1", "acc-2"], settled: false, runs: ONE_RUN, evidence: PROVEN }), ["PENDING", "owed:acc-2"]],
  ["criterion-owed", mission({ runs: ONE_RUN, evidence: [row(1, "arn-1", "wu-1", "report", "CONTRACT_MET", ["acc-1"])] }), ["NOT_VERIFIED", "owed:acc-1"]],
  ["criterion-owed", mission({ runs: ONE_RUN, evidence: [row(1, "arn-1", "wu-1", "task", "BEHAVIOR_OBSERVED", ["acc-1"]), row(2, "arn-1", "wu-1", "handoff", "CONTRACT_MET", ["acc-1"])] }), ["NOT_VERIFIED", "owed:acc-1"]],
  ["criterion-owed", mission({ criteria: ["acc-1", "acc-2"] }), ["NOT_VERIFIED", "owed:acc-1", "owed:acc-2"]],
  ["criterion-owed", mission({ criteria: ["acc-1", "acc-2", "acc-3"], settled: false, runs: ONE_RUN, evidence: [row(1, "arn-1", "wu-1", "investigation", "VERIFIED", ["acc-2"])] }), ["PENDING", "owed:acc-1", "owed:acc-3"]],
  ["open-action", mission({ settled: false, runs: ONE_RUN, evidence: PROVEN, actions: [...DONE, act(3, "INTENT_PERSISTED")] }), ["PENDING"]],
  ["open-action", mission({ runs: ONE_RUN, evidence: PROVEN, actions: [act(1, "INTENT_PERSISTED")] }), ["NOT_VERIFIED"]],
  ["open-action", mission({ runs: ONE_RUN, evidence: PROVEN, actions: [act(1, "PROVIDER_ACCEPTED")] }), ["NOT_VERIFIED"]],
  ["open-action", mission({ settled: false, runs: ONE_RUN, evidence: PROVEN, actions: [act(1, "EXECUTION_OBSERVED")] }), ["PENDING"]],
  ["open-action", mission({ runs: ONE_RUN, evidence: PROVEN, actions: CLOSED.map((s, k) => act(k + 1, s)) }), ["VERIFIED"]],
  ["no-criterion", mission({ criteria: null }), ["NOT_VERIFIED"]],
  ["no-criterion", mission({ criteria: null, settled: false }), ["PENDING"]],
  ["no-criterion", mission({ criteria: [], runs: ONE_RUN, evidence: PROVEN, actions: DONE }), ["NOT_VERIFIED"]],
  ["no-criterion", mission({ criteria: null, runs: ONE_RUN, evidence: PROVEN, actions: DONE }), ["NOT_VERIFIED"]],
  ["no-criterion", mission({ criteria: [], settled: false, runs: ONE_RUN, evidence: PROVEN }), ["PENDING"]],
  ["stale-or-unsucceeded", mission({ units: [{ id: "wu-1", resetAt: 20 }], runs: ONE_RUN, evidence: PROVEN }), ["NOT_VERIFIED", "owed:acc-1"]],
  ["stale-or-unsucceeded", mission({ runs: [run("arn-1", "wu-1", 10, "insufficient")], evidence: PROVEN }), ["NOT_VERIFIED", "owed:acc-1"]],
  ["stale-or-unsucceeded", mission({ runs: [run("arn-1", "wu-1", 10, null)], evidence: PROVEN }), ["NOT_VERIFIED", "owed:acc-1"]],
  ["stale-or-unsucceeded", mission({ runs: [run("arn-1", "wu-1", 10, "violated")], evidence: PROVEN }), ["NOT_VERIFIED", "owed:acc-1"]],
  ["stale-or-unsucceeded", mission({ settled: false, runs: [run("arn-1", "wu-1", 10, "blocked")], evidence: PROVEN }), ["PENDING", "owed:acc-1"]],
];

const FIXED = [...RUNS.map(([group, input, outcome]) => ({ group, input, expect: { exactly: [outcome] } })), ...MISSIONS.map(([group, input, ids]) => ({ group, input, expect: { exactly: ids } }))];

// ---- a seeded generator, the same runs and missions for the same seed ---------------------------------------------------

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

const range = (from, to) => Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => from + k);

const MINS = ["TOOL_COMPLETED", "CONTRACT_MET", "BEHAVIOR_OBSERVED", "VERIFIED"];

const READ_BACK = ["handoff", "definition", "file", "fileGone", "taskVerified", "taskObserved", "taskBlocked", "taskOpen", "checkVerified", "checkObserved", "checkRan", "investigationVerified", "investigationObserved", "investigationBlocked"];

const seededRow = (r) => [pick(r, ["report", "reportShort"]), ...range(1, Math.floor(r() * 4)).map(() => pick(r, READ_BACK)), ...(r() < 0.08 ? ["checkout"] : [])];

const seededRun = (r) => ((input) => ({ group: "seeded-run", input, expect: { exactly: [outcomeOf(input)] } }))(ran(pick(r, MINS), pick(r, ["any", "independent"]), seededRow(r), r() < 0.08 ? "blocked" : "reported"));

// Levels each owner really gives back.
const GIVES = { task: ["VERIFIED", "VERIFIED", "BEHAVIOR_OBSERVED", "BLOCKED", "UNKNOWN"], check: ["VERIFIED", "VERIFIED", "BEHAVIOR_OBSERVED", "TOOL_COMPLETED"], investigation: ["VERIFIED", "VERIFIED", "BEHAVIOR_OBSERVED", "BLOCKED"], report: ["CONTRACT_MET", "TOOL_COMPLETED"], file: ["TOOL_COMPLETED", "UNKNOWN"], handoff: ["CONTRACT_MET"] };

const OUTCOME_WORDS = ["succeeded", "succeeded", "succeeded", "insufficient", "blocked", "violated", null];

const seededRuns = (r, units) => range(1, 1 + Math.floor(r() * 4)).map((k) => run(`arn-${k}`, pick(r, units).id, 6 + k * 5, pick(r, OUTCOME_WORDS)));

const seededEvidence = (r, runs, ids) => range(1, 1 + Math.floor(r() * 5)).map((k) => ((x, owner) => row(k, x.id, x.unit, owner, pick(r, GIVES[owner]), ids.filter(() => r() < 0.6)))(pick(r, runs), pick(r, Object.keys(GIVES))));

const seededActions = (r) => range(1, Math.floor(r() * 4)).map((k) => act(k, r() < 0.15 ? pick(r, OPEN) : pick(r, CLOSED)));

// Now and then a late run of the first unit that proves every criterion, so seeded missions are verified as well as owed.
const proving = (r, ids) => (r() < 0.4 ? { runs: [run("arn-9", "wu-1", 40, "succeeded")], rows: [row(9, "arn-9", "wu-1", pick(r, INDEPENDENT), "VERIFIED", ids)] } : { runs: [], rows: [] });

// A mission over its criteria and units: runs of its units, rows those runs linked, now and then a proving run, actions.
function missionOver(r, ids, units) {
  const runs = seededRuns(r, units);
  const late = proving(r, ids ?? ["acc-1"]);
  return mission({ settled: r() < 0.7, criteria: ids, units, runs: [...runs, ...late.runs], evidence: [...seededEvidence(r, runs, ids ?? ["acc-1"]), ...late.rows], actions: seededActions(r) });
}

function seededMission(r) {
  const ids = r() < 0.1 ? null : range(1, 1 + Math.floor(r() * 3)).map((k) => `acc-${k}`);
  const units = range(1, 1 + Math.floor(r() * 2)).map((k) => ({ id: `wu-${k}`, resetAt: r() < 0.25 ? 18 : k + 2 }));
  const input = missionOver(r, ids, units);
  return { group: "seeded-mission", input, expect: { exactly: verdictIds(input) } };
}

// ---- all of them, numbered within their group ------------------------------------------------------------------------

const numbered = (list) => list.map((c, i, all) => ({ id: `${c.group}-${all.slice(0, i).filter((x) => x.group === c.group).length + 1}`, ...c }));

export function cases(seed, samples) {
  const r = mulberry32(seed);
  const half = Math.max(12, Math.floor(samples / 2));
  return numbered([...FIXED, ...Array.from({ length: half }, () => seededRun(r)), ...Array.from({ length: half }, () => seededMission(r))]);
}

// ---- the reference model, held to what the contract says in words ------------------------------------------------------

const sameIds = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export const selfTest = () => [...RUNS.filter(([, input, outcome]) => outcomeOf(input) !== outcome).map(([group, input]) => `the reference model disagrees with the contract on ${group}: ${input.unit.verificationContract.min}/${input.unit.verificationContract.owner} over ${input.rows.map((x) => `${x.owner}:${x.level}`).join(", ")}`), ...MISSIONS.filter(([, input, ids]) => !sameIds(verdictIds(input), ids)).map(([group]) => `the reference model disagrees with the contract on ${group}`)];
