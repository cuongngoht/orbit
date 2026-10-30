// HOW a candidate is compared with the version it would replace, per kind of subject: a table, so a new kind of
// definition is a row and never a branch in the loop. Every run a verdict rests on is read back off its OWNER's
// record; nothing a host or an agent says about a run is ever a row.
//
//   skill      ENGINE: the coordinator's own skill runner (src/automation/skill-run.mjs, handed in as
//              ports.evaluation.run) runs the BASELINE and the CANDIDATE pin -- run n beside run n, on the frozen
//              inputs the opportunity's runs had -- in an evaluation TASK of its own (provider `improvement`, the
//              engine's door), each step through its provider's owner gate, read-only, every call a receipt; each run is
//              read back off that task's receipts. RUNTIME_BOUND: the engine bound every step and call as it made them.
//   satellite  HOST: the host pursues the same goal as a Satellite mission under each version (improve link), and
//              each agent run is read back off its mission's journal -- the pin its mission engine bound at dispatch,
//              and the outcome the mission concluded on its owners' records.
import { canonicalJson, sha } from "../hash.mjs";
import { answer, clip, ended, modeOf, rec, subjectPort, waiting } from "./act.mjs";
import { metricsOf, verdictOf } from "./evaluation.mjs";
import { modelOf, openEvaluation } from "./model.mjs";
import { improvementOf } from "./policy.mjs";

const reloaded = (ports, c) => ({ ...c, m: modelOf(ports.store.read(c.id) ?? []) });

const quietly = (fn) => {
  try { return fn(); }
  catch { return null; }
};

// ---- the inputs, frozen before anything runs ---------------------------------------------------------------------

// Each input named by the coordinator task it came from and the digest of what it asked -- never its text, which
// stays in its task.
export const frozenInputs = (inputs) => inputs.map((i) => ({ task: i.task, digest: sha(canonicalJson({ objective: i.objective, ref: i.ref ?? null })) }));

export const inputsDigestOf = (frozen) => sha(canonicalJson(frozen));

// Run n of the baseline beside run n of the candidate, input by input, cycled to the runs one evaluation makes.
export const slotsOf = (frozen, runs) => Array.from({ length: runs }, (_, i) => i + 1).flatMap((n) => ["baseline", "candidate"].map((side) => ({ side, n, input: frozen[(n - 1) % frozen.length] })));

const stepIdOf = (ev, slot) => `${ev.evaluation}-${slot.side[0]}${slot.n}`;

// What one evaluation may start: per run, its own action and one per step a declared workflow may hold (at most
// sixteen, src/skill-factory/interpret.mjs WF_LIMITS), and a few to close what a gone process left open.
const actionBudget = (c) => improvementOf(c.values).minRuns * 2 * 17 + 8;

const pinFor = (ev, slot) => (slot.side === "baseline" ? ev.baseline : ev.candidate);

// ---- a run, read back off the evaluation task's own receipts --------------------------------------------------------

const MET = ["VERIFIED", "CONTRACT_MET"];

const STOPPED = ["BLOCKED", "INTERRUPTED", "AMBIGUOUS"];

const requiredOf = (run) => (run?.steps ?? []).filter((s) => s.required !== false);

const msOf = (steps) => (steps.length && steps.every((s) => s.startedAt && s.endedAt) ? steps.reduce((n, s) => n + Math.max(0, Date.parse(s.endedAt) - Date.parse(s.startedAt)), 0) : null);

const met = (req) => req.length > 0 && req.every((s) => MET.includes(s.word));

const evidenceOf = (run, req) => (run.word === "VERIFIED" ? "VERIFIED" : met(req) ? "CONTRACT_MET" : "NONE");

const rowFrom = (x, slot, run) => ((req) => ({ evaluation: x.ev.evaluation, side: slot.side, n: slot.n, run: `${x.ev.task}/${run.run}`, word: run.word, met: met(req), failing: req.filter((s) => !MET.includes(s.word) && !STOPPED.includes(s.word)).map((s) => s.id), blocked: STOPPED.includes(run.word) || req.some((s) => STOPPED.includes(s.word)), retries: req.reduce((n, s) => n + (s.retries ?? 0), 0), calls: run.calls ?? 0, ms: msOf(req), attribution: run.provenance ?? "RUNTIME_BOUND", evidence: evidenceOf(run, req), eid: `${x.c.id}:${x.ev.evaluation}:${slot.side}:${slot.n}` }))(requiredOf(run));

const recorded = (ev, slot) => ev.runs.some((r) => r.side === slot.side && r.n === slot.n);

// ---- one slot: started, run through the coordinator's own runner, settled, read back --------------------------------

const providerOf = (x) => ({ kind: "skill", id: x.c.m.meta.subjectId, key: `project:${x.c.m.meta.subjectId}`, ownership: "project" });

const startedAction = (ports, x, slot) => ports.evaluation.apply(x.ev.task, "act-start", { type: "improvement.evaluate", tool: "skill-run", label: clip(`${x.ev.evaluation} ${slot.side} ${slot.n}: ${pinFor(x.ev, slot)}`), mutates: false }).lines.find((l) => l.kind === "action-started").id;

const lwOf = (ports, x, slot, input, act) => ((view) => ({ id: x.ev.task, view: { ...view, task: { ...view.task, objective: input.objective } }, events: ports.evaluation.events(x.ev.task), states: [{ id: stepIdOf(x.ev, slot), action: act }], ref: input.ref ?? null, plan: null }))(ports.evaluation.view(x.ev.task));

// The run's receipt is the runner's to link, except a VERIFIED one, which the step that ran it links as its evidence.
function settledAction(ports, x, act, read) {
  if (read.verdict === "satisfied" && read.receipt) ports.evaluation.apply(x.ev.task, "link-receipt", { ...read.receipt, action: act });
  const done = ["satisfied", "reported"].includes(read.verdict);
  ports.evaluation.apply(x.ev.task, done ? "act-complete" : "act-fail", done ? { action: act, outcome: "succeeded", summary: clip(read.summary ?? read.because) } : { action: act, reason: clip(read.because ?? read.verdict) });
}

async function ranSlot(ports, x, slot) {
  const input = x.inputs.find((i) => i.task === slot.input.task);
  const act = startedAction(ports, x, slot);
  settledAction(ports, x, act, await ports.evaluation.run(lwOf(ports, x, slot, input, act), { id: stepIdOf(x.ev, slot) }, { provider: providerOf(x), pin: pinFor(x.ev, slot) }));
  const run = ports.evaluation.runsOf(x.ev.task, [x.ev.baseline, x.ev.candidate]).find((r) => r.run === ports.evaluation.runIdOf(x.ev.task, stepIdOf(x.ev, slot)));
  rec(ports, x.c.id, "evaluation-run", run ? rowFrom(x, slot, run) : { evaluation: x.ev.evaluation, side: slot.side, n: slot.n, word: "UNREAD", met: false, failing: [], blocked: true, attribution: "UNATTRIBUTED", evidence: "NONE", eid: `${x.c.id}:${x.ev.evaluation}:${slot.side}:${slot.n}` });
}

// ---- the evaluation settled from its own runs ------------------------------------------------------------------------

function settledEvaluation(ports, x) {
  const ev = openEvaluation(reloaded(ports, x.c).m);
  const v = verdictOf(ev);
  rec(ports, x.c.id, "evaluation-settled", { evaluation: ev.evaluation, verdict: v.verdict, because: clip(v.because), regressions: v.regressions, metrics: metricsOf(ev), eid: `${x.c.id}:${ev.evaluation}:settled` });
  quietly(() => taskClosed(ports, x.c, ev, v));
  return answer(x.c, "EVALUATED", { say: clip(`${ev.evaluation}: ${v.verdict} — ${v.because}`) });
}

function taskClosed(ports, c, ev, v) {
  ports.evaluation.apply(ev.task, "link-receipt", { domain: "improvement", ref: c.id, outcome: v.verdict, summary: clip(`${ev.evaluation}: ${v.because}`) });
  ports.evaluation.apply(ev.task, "complete", { summary: clip(`${ev.evaluation} ${v.verdict}`) });
}

const spent = (ports, x) => ports.nowMs() - x.startedMs > improvementOf(x.c.values).maxEvaluationMinutes * 60000;

async function ranSlots(ports, x, slots) {
  if (!slots.length) return settledEvaluation(ports, x);
  if (spent(ports, x)) return waiting(x.c, "session", `${x.ev.evaluation} spent its ${improvementOf(x.c.values).maxEvaluationMinutes} minute(s) in this step — the next step resumes it where it stopped`);
  await ranSlot(ports, x, slots[0]);
  return ranSlots(ports, x, slots.slice(1));
}

// ---- before an evaluation goes on: is what it compares still what it compares? ----------------------------------------

const INVALID = [
  { when: (x) => !x.candidate?.intact || x.candidate.digest !== x.c.m.candidate.digest, because: (x) => `${x.ev.candidate}'s files are not what was staged — the evaluation is invalidated` },
  { when: (x) => x.current?.pin !== x.ev.baseline, because: (x) => `the version in place is ${x.current?.pin ?? "gone"}, not the baseline ${x.ev.baseline} — the comparison is stale` },
  { when: (x) => inputsDigestOf(frozenInputs(x.inputs)) !== x.ev.inputsDigest, because: () => "an input the evaluation was frozen on is gone or changed — the evaluation is invalidated" },
];

const invalidOf = (x) => INVALID.find((r) => r.when(x)) ?? null;

function interrupted(ports, x, row) {
  rec(ports, x.c.id, "evaluation-interrupted", { evaluation: x.ev.evaluation, because: clip(row.because(x)), eid: `${x.c.id}:${x.ev.evaluation}:interrupted` });
  return answer(x.c, "INVALIDATED", { say: clip(row.because(x)) });
}

const worldOf = (ports, c, ev) => ({ c, ev, startedMs: ports.nowMs(), inputs: ports.inputsOf(ev.inputs.map((i) => i.task)), candidate: quietly(() => subjectPort(ports, c).content(ev.candidate)), current: quietly(() => subjectPort(ports, c).current(c.m.meta.subjectId)) });

// Another live process carrying it is left alone; one that is gone left actions open, which are closed as interrupted
// (a read is safe to ask again) before the runs it never recorded are asked again.
async function continuedEngine(ports, c, ev) {
  if (ev.pid !== ports.ctx.pid && ports.liveness({ host: ev.host, pid: ev.pid }) !== false) return waiting(c, "session", `${ev.evaluation} is being run by another process on ${ev.host ?? "a machine"} — it settles there`);
  ports.evaluation.closeDead(ev.task);
  const x = worldOf(ports, c, ev);
  const invalid = invalidOf(x);
  return invalid ? interrupted(ports, x, invalid) : ranSlots(ports, x, slotsOf(ev.inputs, improvementOf(c.values).minRuns).filter((s) => !recorded(ev, s)));
}

function begunEngine(ports, c) {
  const inputs = ports.inputsOf(c.m.meta.tasks ?? []);
  if (!inputs.length) return ended(ports, c, "insufficient-evidence", "the runs the problem showed on are gone from this project's store — there is nothing to evaluate on");
  const frozen = frozenInputs(inputs);
  const ev = startedEvaluation(ports, c, frozen);
  return continuedEngine(ports, reloaded(ports, c), ev);
}

function startedEvaluation(ports, c, frozen) {
  const n = c.m.evaluations.length + 1;
  const task = ports.evaluation.create({ objective: clip(`ev${n} of ${c.id}: ${c.m.candidate.pin} beside ${c.m.meta.pin}`), actions: actionBudget(c) });
  quietly(() => ports.evaluation.apply(task, "link-receipt", { domain: "improvement", ref: c.id, outcome: "EVALUATING", summary: clip(`ev${n}: ${c.m.meta.pin} beside ${c.m.candidate.pin}`) }));
  rec(ports, c.id, "evaluation-started", { evaluation: `ev${n}`, task, baseline: c.m.meta.pin, candidate: c.m.candidate.pin, inputs: frozen, inputsDigest: inputsDigestOf(frozen), oracleDigest: c.m.validated.oracleDigest, isolation: "gated", session: ports.ctx.session, host: ports.ctx.host, pid: ports.ctx.pid, planned: improvementOf(c.values).minRuns * 2, ...modeOf("evaluate"), eid: `${c.id}:ev${n}:started` });
  return openEvaluation(reloaded(ports, c).m);
}

// ---- the host-carried evaluation: Satellite missions, linked and read back ---------------------------------------------

const HOW_LINK = (c) => `pursue one goal as a Satellite mission under ${c.m.meta.pin} and again under ${c.m.candidate.pin} (/orbit:satellite), then: node <engine>/cli/improve.mjs link ${c.id} --mission=<msn-…> --side=baseline|candidate`;

const sideRuns = (ports, ev, side) => (ev.links ?? []).filter((l) => l.side === side).flatMap((l) => (quietly(() => ports.missions.runs(l.mission)) ?? []).filter((r) => r.rolePin === (side === "baseline" ? ev.baseline : ev.candidate)));

const missionRow = (c, ev, side) => (r, i) => ({ evaluation: ev.evaluation, side, n: i + 1, run: `${r.mission}/${r.run}`, word: String(r.outcome ?? "unknown").toUpperCase(), met: r.outcome === "succeeded" && r.level === "VERIFIED", failing: r.outcome === "insufficient" ? ["contract"] : [], blocked: ["blocked", "violated"].includes(r.outcome), retries: 0, calls: r.calls ?? 0, ms: null, attribution: "RUNTIME_BOUND", evidence: r.level ?? "UNKNOWN", eid: `${c.id}:${ev.evaluation}:${side}:${r.mission}/${r.run}` });

const goalsDiffer = (ev) => new Set((ev.links ?? []).map((l) => l.goalDigest)).size > 1;

function settledHost(ports, c, ev) {
  for (const side of ["baseline", "candidate"]) sideRuns(ports, ev, side).forEach((r, i) => rec(ports, c.id, "evaluation-run", missionRow(c, ev, side)(r, i)));
  const fresh = openEvaluation(reloaded(ports, c).m);
  const v = goalsDiffer(fresh) ? { verdict: "INCONCLUSIVE", because: "the two missions did not pursue the same goal", regressions: [] } : verdictOf(fresh);
  rec(ports, c.id, "evaluation-settled", { evaluation: fresh.evaluation, verdict: v.verdict, because: clip(v.because), regressions: v.regressions, metrics: metricsOf(fresh), eid: `${c.id}:${fresh.evaluation}:settled` });
  return answer(c, "EVALUATED", { say: clip(`${fresh.evaluation}: ${v.verdict} — ${v.because}`) });
}

const bothLinked = (ev) => ["baseline", "candidate"].every((side) => (ev.links ?? []).some((l) => l.side === side));

function evaluateHost(ports, c) {
  const open = openEvaluation(c.m);
  if (open) return bothLinked(open) ? settledHost(ports, c, open) : waiting(c, "host", "each version's mission is linked before the two are compared", HOW_LINK(c));
  rec(ports, c.id, "evaluation-started", { evaluation: `ev${c.m.evaluations.length + 1}`, baseline: c.m.meta.pin, candidate: c.m.candidate.pin, inputs: [], inputsDigest: inputsDigestOf([]), oracleDigest: c.m.validated.oracleDigest, isolation: "gated", session: ports.ctx.session, host: ports.ctx.host, pid: ports.ctx.pid, planned: 0, ...modeOf("evaluate"), eid: `${c.id}:ev${c.m.evaluations.length + 1}:started` });
  return waiting(c, "host", "the evaluation is open: each version's mission is run by the host and linked", HOW_LINK(c));
}

// ---- the table -----------------------------------------------------------------------------------------------------

export const EVALUATORS = {
  skill: { carried: "engine", isolation: "gated", evaluate: async (ports, c) => ((open) => (open ? continuedEngine(ports, c, open) : begunEngine(ports, c)))(openEvaluation(c.m)) },
  satellite: { carried: "host", isolation: "gated", evaluate: async (ports, c) => evaluateHost(ports, c) },
};

// A mission the host ran under one version, linked to the open evaluation: what it pursued (its goal's digest) and how
// many agent runs it carried -- the runs themselves are read back when the evaluation settles, never copied here.
export function linkMission(ports, c, link) {
  const open = openEvaluation(c.m);
  const read = quietly(() => ports.missions.read(link.mission));
  if (!open || !read) return waiting(c, open ? "host" : "session", open ? `${link.mission} is no mission of this project` : `${c.id} has no open evaluation to link a mission to`);
  rec(ports, c.id, "linked", { evaluation: open.evaluation, mission: link.mission, side: link.side, goalDigest: read.goalDigest, agentRuns: read.runs.length, eid: `${c.id}:${open.evaluation}:${link.side}:${link.mission}` });
  return answer(c, "LINKED", { say: clip(`${link.mission} linked as the ${link.side} of ${open.evaluation}`) });
}
