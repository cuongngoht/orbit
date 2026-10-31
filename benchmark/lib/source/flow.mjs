// THE FLOW of one benchmark run, from what was frozen to how it ended. Where the run stands is read off its task's
// journal every time -- never kept beside it -- so a run interrupted anywhere is carried on from there: an action that
// never settled is closed as interrupted; a verification (it changes nothing) is run again as a new action; a repair
// round (it changed something, in the runner's store) is never sent again, only read back.
//
//   baseline    attempt 1 (`fresh`), stage TESTING: the subject verified twice with the same seed
//   diagnosis   stage DIAGNOSING: the CAUSES table over what the two showed, and a decision saying what comes next
//   round k     attempt k+1 (`fix`): FIXING the runner, REVIEWING the inspection and the candidate's scope, TESTING and
//               REGRESSION its verification; then the NEXT table
//   ending      complete, fail or block, with the outcome a person reads (kept first in ending.json, so an ending
//               decided and not yet written is written on resume)
//
//   carried(ctx) -> { outcome, exit, summary }
import { causeOf } from "./classify.mjs";
import { frozenIntact } from "../core/context.mjs";
import { nextOf, signatureOf } from "./decide.mjs";
import { cleaned } from "../core/docker.mjs";
import { hostEnd } from "../core/host.mjs";
import { candidateOf, inspectedRound, ranRound } from "./round.mjs";
import { docRead, docWritten, readRegular } from "../core/room.mjs";
import { safeRel } from "../core/paths.mjs";
import { verified } from "./verify.mjs";

export const EXIT = { PASS: 0, REPAIRED_VERIFIED: 0, FAIL: 1, REPAIR_REJECTED: 1, NO_PROGRESS: 1, BUDGET_EXHAUSTED: 1, BENCHMARK_INVALID: 2, BLOCKED: 3, INCONCLUSIVE: 4 };

// Minutes kept back from a round's runner for what must follow it: reading the round back and verifying the candidate.
export const RESERVE_MINUTES = 20;

const show = (ctx) => ctx.rec.show(ctx.task);

const actsOf = (view, attempt) => (view.actions ?? []).filter((a) => a.attempt === attempt);

const current = (view) => view.attempt?.current ?? null;

const ok = (a) => a.state !== "running" && a.state !== "error";

const lastEnded = (acts, type) => acts.filter((a) => a.type === type && ok(a)).at(-1) ?? null;

const stepOf = (ctx, act) => (act ? docRead(ctx.room, `steps/${act.id}.json`) : null);

const shortRun = (ctx) => ctx.run.id.slice(4);

// ---- one recorded action: started, its evidence kept under its own id, ended with its receipt ----------------------------

async function recorded(ctx, type, label, body, role) {
  const act = ctx.rec.actStart(ctx.task, type, label, role);
  const result = await body(act);
  docWritten(ctx.room, `steps/${act}.json`, result.doc);
  return closed(ctx, act, result);
}

function closed(ctx, act, result) {
  if (result.receipt) ctx.rec.receipt(ctx.task, { ...result.receipt, action: act });
  ctx.rec.actComplete(ctx.task, act, result.outcome, result.receipt ? `${result.receipt.domain}:${result.receipt.ref}` : undefined, result.summary);
  return result.doc;
}

// ---- verifications -----------------------------------------------------------------------------------------------------

const verdictWord = (v) => (!v.complete ? "INCOMPLETE" : v.failures.length ? "FAIL" : "PASS");

const ownTest = (v) => (v.agent ? ` · own test ${v.agent.before.failed && v.agent.after.ok ? "fails before, passes after" : "does not prove the repair"}` : "");

export const verificationSummary = (v) => `hidden ${v.hidden.checks.filter((c) => c.ok).length}/${v.hidden.checks.length} · gates ${v.gates.filter((g) => g.ok).length}/${v.gates.length}${ownTest(v)} · tree ${v.digest.slice(0, 8)}`;

const verifyAct = (ctx, ref, label, entries, o) => recorded(ctx, "benchmark.verify", label, async () => ((v) => ({ doc: v, outcome: v.complete ? "succeeded" : "failed", receipt: { domain: "test", ref, outcome: verdictWord(v), summary: verificationSummary(v) }, summary: verificationSummary(v) }))(await verified(ctx, ref, entries, o)));

const baselineDocs = (ctx, view) => actsOf(view, view.attempts?.[0]?.id).filter((a) => a.type === "benchmark.verify" && a.state === "succeeded").map((a) => stepOf(ctx, a)).filter(Boolean);

function baselineOpened(ctx, view) {
  if (view.attempts?.length) return;
  ctx.rec.stage(ctx.task, "TESTING", "the subject, verified twice with the same seed");
  ctx.rec.attemptStart(ctx.task, "fresh");
}

async function baseline(ctx, view) {
  baselineOpened(ctx, view);
  const have = baselineDocs(ctx, show(ctx));
  for (let n = have.length + 1; n <= 2; n++) have.push(await verifyAct(ctx, `bv-${shortRun(ctx)}-${n}`, `the subject, verification ${n} of 2`, ctx.baseline, {}));
  ctx.rec.attemptComplete(ctx.task, have.every((v) => v.complete && !v.failures.length) ? "succeeded" : "failed", have[0].failures.length ? have[0].signature : undefined);
  return have;
}

// ---- the diagnosis ------------------------------------------------------------------------------------------------------

// The containers of a verification that did not run as declared, by how they ended: refused (the environment: Docker,
// an image, an attestation) or out of time or memory with nothing of a candidate's in them (the infrastructure). A run
// recorded before the ends were kept says only that it had a problem, and that is read as the environment's.
const endsOf = (r) => r.problemEnds ?? (r.problem ? ["REFUSED"] : []);

const problemWith = (runs, ends) => ((r) => (r ? { says: r.problem } : null))(runs.find((r) => endsOf(r).some((e) => ends.includes(e))));

// A probe that could not read the inputs the judge sent it is the verifier's own defect, never the subject's.
const inputRefused = (runs) => (runs.some((r) => r.hidden?.error?.code === "INPUT") ? { says: "the probe could not read the inputs the judge sent it: the verifier is broken, not the source" } : null);

const factsOf = (ctx, runs) => ({ benchmark: frozenIntact(ctx) ? null : { says: "the frozen case or subject changed after the run began" }, verifier: ctx.invalid ?? inputRefused(runs), environment: problemWith(runs, ["REFUSED"]), infrastructure: problemWith(runs, ["TIMEOUT", "OOM", "NO_EXIT"]), credentials: null, provider: null, budget: null, runs, repairable: ctx.case.measures.repairable });

const variantSays = (ctx) => (ctx.manifest.benchmark.variant === "real" ? "on the source as it is" : `planted by the ${ctx.manifest.benchmark.variant} variant, not a defect found in the source`);

// A known finding is a baseline the case says fails today (`baseline: "FAIL"`): its failure is the finding, not news.
const knownSays = (ctx, outcome) => (ctx.case.baseline && ctx.case.baseline !== outcome ? `; the case expects the source as it is to ${ctx.case.baseline}` : ctx.case.baseline === "FAIL" && outcome === "FAIL" ? "; a known finding, kept as evidence until it is repaired" : "");

const ENDINGS = {
  PASS: (ctx, cause) => ({ end: "complete", outcome: "PASS", summary: `PASS — ${cause.says}${knownSays(ctx, "PASS")}` }),
  FAIL: (ctx, cause) => ({ end: "complete", outcome: "FAIL", summary: `FAIL (${cause.id}, ${variantSays(ctx)}) — ${cause.says}${knownSays(ctx, "FAIL")}` }),
  BENCHMARK_INVALID: (ctx, cause) => ({ end: "fail", stop: "REQUIREMENT_BLOCKED", outcome: "BENCHMARK_INVALID", summary: `BENCHMARK_INVALID (${cause.id}) — ${cause.says}` }),
  BLOCKED: (ctx, cause) => ({ end: "block", stop: "ENVIRONMENT_BLOCKED", needs: "environment", outcome: "BLOCKED", summary: `BLOCKED (${cause.id}) — ${cause.says}` }),
  INCONCLUSIVE: (ctx, cause) => ({ end: "complete", outcome: "INCONCLUSIVE", summary: `INCONCLUSIVE (${cause.id}) — ${cause.says}` }),
};

const ENDING_OF = { PASS: "PASS", BENCHMARK_INVALID: "BENCHMARK_INVALID", VERIFIER_INVALID: "BENCHMARK_INVALID", ENVIRONMENT: "BLOCKED", CREDENTIALS: "BLOCKED", INFRASTRUCTURE: "BLOCKED", PROVIDER: "BLOCKED", BUDGET_EXHAUSTED: "BLOCKED", INSUFFICIENT_EVIDENCE: "INCONCLUSIVE", NON_DETERMINISTIC: "INCONCLUSIVE", GATE_UNEXPLAINED: "INCONCLUSIVE", UNKNOWN: "INCONCLUSIVE" };

// An ending says the cause and the class it stands on, so a report and a metric never parse its summary.
const endingFor0 = (ctx, cause) => ({ ...ENDINGS[ENDING_OF[cause.id] ?? (cause.repairable ? "FAIL" : "INCONCLUSIVE")](ctx, cause), cause: cause.id, class: cause.class });

// What the baseline came to, as the next action: a repair only for a cause the case declares repairable, when a repair
// was asked for; otherwise the run ends with the verdict it earned.
const repairDiagnosis = (ctx, cause) => (cause.repairable && ctx.repair ? { cause, next: "repair", ending: null } : { cause, next: "report", ending: endingFor0(ctx, cause) });

// An ENGINEERING case's baseline says whether the target is as the case declares it: a goal that asks for a change must
// not be met yet, and a goal that must be refused leaves a target whose behaviour already holds. When it is, the round
// runs -- the goal is the host's to attempt and the verifier's to judge; when it is not, the benchmark is wrong.
const GOAL_READY = { change: ["ORBIT_SOURCE_DEFECT", "CAPABILITY_MISSING"], blocked: ["PASS"] };

const notAsDeclared = (ctx, cause) => ({ end: "fail", stop: "REQUIREMENT_BLOCKED", outcome: "BENCHMARK_INVALID", cause: cause.id, class: "BENCHMARK_DEFECT", summary: `BENCHMARK_INVALID — the target is not as ${ctx.case.id} declares it: a goal that ${ctx.case.measures.expects === "change" ? "asks for a change found it already made" : "must be refused found the behaviour already broken"} (${cause.id})` });

const goalSettled = (ctx, cause) => (["PASS", "ORBIT_SOURCE_DEFECT", "CAPABILITY_MISSING"].includes(cause.id) ? notAsDeclared(ctx, cause) : endingFor0(ctx, cause));

const goalDiagnosis = (ctx, cause) => (GOAL_READY[ctx.case.measures.expects].includes(cause.id) ? { cause, next: "repair", ending: null } : { cause, next: "report", ending: goalSettled(ctx, cause) });

const diagnosisOf = (ctx, cause) => (ctx.case.kind === "engineering" ? goalDiagnosis : repairDiagnosis)(ctx, cause);

function diagnosed(ctx, runs) {
  ctx.rec.stage(ctx.task, "DIAGNOSING", "what the two verifications of the subject showed");
  const d = diagnosisOf(ctx, causeOf(factsOf(ctx, runs)));
  ctx.rec.decide(ctx.task, { observed: `${runs[0].failures.length} failing check(s); verified twice, signatures ${runs.map((r) => r.signature).join(" and ")}`, hypothesis: `${d.cause.id}${d.cause.class ? ` (${d.cause.class})` : ""}: ${d.cause.says}`, next: d.next, evidence: [show(ctx).attempts[0].id, `test:bv-${shortRun(ctx)}-1`] });
  return d;
}

// ---- the ending -----------------------------------------------------------------------------------------------------------

const ENDERS = {
  complete: (ctx, e) => ctx.rec.complete(ctx.task, e.summary),
  fail: (ctx, e) => ctx.rec.fail(ctx.task, e.stop, e.summary),
  block: (ctx, e) => ctx.rec.block(ctx.task, e.stop, e.needs ?? "environment", e.summary),
};

function ended(ctx, e) {
  docWritten(ctx.room, "ending.json", { ...e, at: new Date().toISOString() });
  ENDERS[e.end](ctx, e);
  return { outcome: e.outcome, exit: EXIT[e.outcome] ?? 4, summary: e.summary };
}

const groupsOf = (v) => Object.entries(v.hidden.checks.reduce((m, c) => ({ ...m, [c.group]: (m[c.group] ?? true) && c.ok }), {}));

// One verification row per group of hidden checks and per gate, each resting on the verification's receipt.
function verificationRows(ctx, subject, v, evidence) {
  for (const [group, held] of groupsOf(v)) ctx.rec.verification(ctx.task, { subject: `${subject}.${group}`, obligation: ctx.spec.GROUPS?.[group] ?? group, state: held ? "satisfied" : "violated", evidence });
  for (const g of v.gates) ctx.rec.verification(ctx.task, { subject: `${subject}.gate.${g.id}`, obligation: `the repository's gate ${g.id} holds`, state: g.ok ? "satisfied" : "violated", evidence });
}

// ---- a repair round, carried from wherever it stands ---------------------------------------------------------------------

// Who carried a run's rounds: nobody (no repair was asked), a SCRIPTED host (a control: Orbit's own loop driven by a
// script, no model) or a CODING HOST (a model). Every report and metric keeps the three apart: a scripted success is
// conformance of the controller, never a measure of a model.
export const hostBasisOf = (config) => (!config?.repair ? "none" : String(config.host ?? "").startsWith("scripted:") ? "scripted" : "coding-host");

const scripted = (ctx) => hostBasisOf({ repair: ctx.repair, host: ctx.host }) === "scripted";

const credentialProblem = (ctx) => (scripted(ctx) || ctx.credentialNames.some((n) => n !== "ANTHROPIC_BASE_URL") ? null : "CREDENTIALS: no credential for the coding host is set here, by name (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN; --credential=<NAME>) — the baseline is kept, and `resume` goes on once one is");

const minutesLeft = (view) => Math.floor((view.budget?.minutes?.limit ?? 0) - (view.budget?.minutes?.spent ?? 0));

// What a round cost: what its host REPORTED, or -- only to keep the budget from being overrun, never as a cost anyone
// reads -- an ESTIMATE of an even share of the budget, said as such.
const roundCost = (ctx, view, a) => ((usd) => (typeof usd === "number" ? { usd, basis: "REPORTED" } : { usd: ctx.limits.usd / Math.max(1, ctx.limits.rounds), basis: "ESTIMATED" }))(stepOf(ctx, lastEnded(actsOf(view, a.id), "benchmark.repair"))?.host?.costUsd);

const costsOf = (ctx, view) => (view.attempts ?? []).slice(1).filter((a) => a.outcome).map((a) => roundCost(ctx, view, a));

const leftOf = (ctx, view) => ((costs) => ({ rounds: ctx.limits.rounds - Math.max(0, (view.attempts?.length ?? 1) - 1), minutes: minutesLeft(view), usd: Math.max(0, Math.round((ctx.limits.usd - costs.reduce((n, c) => n + c.usd, 0)) * 100) / 100), usdBasis: costs.some((c) => c.basis === "ESTIMATED") ? "ESTIMATED" : "REPORTED" }))(costsOf(ctx, view));

const startedTask = (ctx, k) => ((buf) => (buf ? safeJson(buf.toString("utf8"))?.task ?? null : null))(readRegular(ctx.room.at("rounds", String(k), "out", "start.json"), 64 * 1024));

function safeJson(text) {
  try { return JSON.parse(text); }
  catch { return null; }
}

const TASK = /^tsk-[a-f0-9]{12}$/;

const inspectedTask = (ctx, k) => ((buf) => (buf ? safeJson(buf.toString("utf8"))?.task ?? null : null))(readRegular(ctx.room.at("rounds", String(k), "inspect", "inspect.json"), 4 * 1024 * 1024));

// The ONE engineering task of this run: the first one a round started, as its own start file says -- or, for a round
// interrupted before its runner said, as its inspection found it, the one task the runner store held.
const engTaskOf = (ctx, upTo) => Array.from({ length: upTo }, (_, i) => [startedTask(ctx, i + 1), inspectedTask(ctx, i + 1)]).flat().find((t) => TASK.test(String(t))) ?? null;

const latestVerification = (ctx, view) => stepOf(ctx, (view.actions ?? []).filter((a) => a.type === "benchmark.verify" && a.state === "succeeded").at(-1));

// What a round's host does, as the stage says it: a repair through the engineering loop, or a goal through the goal entry.
const ROUND_WORK = { source: "repairs the source through Orbit's engineering loop", engineering: "takes the goal through Orbit's goal entry, its workflow and its engineering task" };

// A case that declares an interruption cuts that round's runner at its minute -- a coding host is stopped wherever it
// is, the way a crash stops it. A scripted host interrupts itself, at a moment it can name.
const cutAt = (ctx, k, minutes) => (ctx.case.interrupt?.round === k && !scripted(ctx) ? Math.min(minutes, ctx.case.interrupt.afterMinutes) : minutes);

function roundState(ctx, view, k) {
  const left = leftOf(ctx, view);
  const runnerMinutes = cutAt(ctx, k, Math.max(1, Math.min(ctx.case.limits.runner.minutes, left.minutes - RESERVE_MINUTES)));
  ctx.rec.stage(ctx.task, "FIXING", `round ${k} of ${ctx.limits.rounds}: the ${scripted(ctx) ? "scripted" : "coding"} host ${ROUND_WORK[ctx.case.kind] ?? ROUND_WORK.source} · ${runnerMinutes} min · $${left.usd} left (${left.usdBasis})`);
  return { left: { ...left, engineeringMinutes: runnerMinutes }, latest: latestVerification(ctx, view), engTask: engTaskOf(ctx, k - 1), deadlineMs: runnerMinutes * 60000, held: () => Boolean(HELD(show(ctx))) };
}

const repairSummary = (r) => (r.error ? r.error.says : `the host made ${r.host?.toolCalls ?? "an unknown number of"} tool call(s) and ended ${r.container?.timedOut ? "at the round's deadline" : `with ${r.runner?.exit ?? "?"}${r.runner?.setup ? ` (${r.runner.setup})` : ""}`}`);

const repairReceipt = (ctx, k, r) => ((t) => (t ? { domain: "task", ref: `runner.${t}`, outcome: "IN_RUNNER_STORE", summary: `the run's one engineering task, in its runner store; round ${k}` } : null))(r.start?.task ?? r.runner?.task ?? null);

const repairAct = (ctx, k, state) => recorded(ctx, "benchmark.repair", `round ${k}: the ${scripted(ctx) ? "scripted" : "coding"} host on the engineering task`, async () => ((r) => ({ doc: r, outcome: r.error ? "failed" : "succeeded", receipt: repairReceipt(ctx, k, r), summary: repairSummary(r) }))(await ranRound(ctx, k, state)), { tool: scripted(ctx) ? "scripted-host" : "coding-host", mutates: true });

const inspectSummary = (ins) => (ins.inspect ? `${(ins.inspect.changes ?? []).length} change(s) in the workspace; the engineering task is ${ins.task?.json?.lifecycle ?? "unread"}` : `the inspection did not answer (${ins.end})`);

// The engineering task as the inspection read it back from the runner store, linked under the name a round's own
// receipt uses -- so a round whose end the controller never saw still names the task it worked on.
const readBack = (ins, k) => ((v) => (TASK.test(String(v?.task?.id)) ? { domain: "task", ref: `runner.${v.task.id}`, outcome: String(v.lifecycle ?? "UNREAD"), summary: `the run's one engineering task, as round ${k}'s inspection read it back from the runner store` } : null))(ins?.task?.json);

const inspectAct = (ctx, k, task) => recorded(ctx, "benchmark.inspect", `round ${k}: what the round left, read back`, async () => ((ins) => ({ doc: ins, outcome: ins.refused || !ins.inspect ? "failed" : "succeeded", receipt: readBack(ins, k), summary: inspectSummary(ins) }))(await inspectedRound(ctx, k, task)));

const repairOf = async (ctx, view, k, acts) => stepOf(ctx, lastEnded(acts, "benchmark.repair")) ?? (acts.some((a) => a.type === "benchmark.repair") ? { interrupted: true } : await repairAct(ctx, k, roundState(ctx, view, k)));

async function roundCarried(ctx, view, k) {
  const acts = actsOf(view, current(view));
  const repair = await repairOf(ctx, view, k, acts);
  ctx.rec.stage(ctx.task, "REVIEWING", `round ${k}: what the round left, and the candidate's scope`);
  const ins = stepOf(ctx, lastEnded(actsOf(show(ctx), current(view)), "benchmark.inspect")) ?? (await inspectAct(ctx, k, engTaskOf(ctx, k)));
  return judgedRound(ctx, k, repair, ins);
}

const NO_CANDIDATE = (ctx) => ({ changes: [], entries: ctx.baseline, scope: [], patch: "", patchDigest: null, agentTests: [], ignored: [] });

// Whether the engineering task waits for a person: an approval asked and not decided, or the stop that means it.
const waitingOf = (v) => (v.approvals ?? []).some((a) => a.open === true) || v.stopReason === "HUMAN_APPROVAL_REQUIRED";

const engineeringOf = (ins) => ((v) => (v ? { id: v.task?.id ?? null, lifecycle: v.lifecycle, terminal: v.terminal === true, stopReason: v.stopReason ?? null, waiting: waitingOf(v), stage: v.stage, attempts: (v.attempts ?? []).length, revision: v.revision, commit: (v.receipts ?? []).find((r) => r.domain === "commit")?.ref ?? null, changes: v.changes?.files ?? 0, provider: v.task?.provider ?? null } : null))(ins?.task?.json);

// Tasks a round left beside its ONE engineering task. A source repair starts nothing else, so any other task counts; a
// goal starts a workflow of its own, so only a second ENGINEERING task counts there.
const ENGINEERING_PROVIDER = "autonomous-engineering";

const countedTasks = (ctx, ins) => (ins?.tasks?.json?.tasks ?? []).filter((t) => ctx.case.kind !== "engineering" || t.provider === ENGINEERING_PROVIDER);

const extraTasks = (ctx, ins, k) => countedTasks(ctx, ins).map((t) => t.id).filter((t) => t !== (engTaskOf(ctx, k) ?? ins?.inspect?.task)).length;

// The owners' records a round left, read back by the inspection: the engineering task and its actions, every task, the
// goals and their plans -- each as its owner said it, through Orbit's own read commands.
const actionsOf = (ins) => (ins?.task?.json?.actions ?? []).map((a) => ({ id: a.id, type: a.type, tool: a.tool ?? null, state: a.state, receipts: a.receipts ?? [], why: String(a.reason ?? "").slice(0, 160) }));

const readBackOf = (ins, engineering) => ({ engineering, actions: actionsOf(ins), tasks: ins?.tasks?.json?.tasks ?? [], goals: ins?.goals?.json?.goals ?? [] });

const deliveredBy = (rb) => rb.engineering?.lifecycle === "COMPLETED" && (rb.engineering.changes ?? 0) > 0;

// What EVERY engineering case asks of those records, by what its goal expects -- before anything its own spec adds. A
// record check reads an owner's word about its own state and never judges code: the hidden checks do that.
export const GOAL_RECORDS = {
  change: [{ id: "engineering-completed", says: "the change was delivered by an Orbit engineering task that completed on its own journal's proof", ok: (rb) => rb.engineering?.lifecycle === "COMPLETED" }],
  blocked: [
    { id: "unit-unresolved", says: "the goal planned the change and left it unresolved for a rule nobody gave", ok: (rb) => rb.goals.some((g) => (g.units ?? []).some((u) => u.state === "unresolved" && u.missing === true)) },
    { id: "nothing-delivered", says: "no engineering task completed a change the goal gives no rule for", ok: (rb) => !deliveredBy(rb) },
  ],
};

const recordRow = (rb) => (row) => ({ id: row.id, ok: row.ok(rb) === true, says: row.says });

const specRecords = (ctx, rb) => (typeof ctx.spec?.records === "function" ? ctx.spec.records(rb).map((x) => ({ id: x.id, ok: x.ok === true, says: x.says ?? x.id })) : []);

const recordsOf = (ctx, ins, engineering) => (ctx.case.kind !== "engineering" ? [] : ((rb) => [...(GOAL_RECORDS[ctx.case.measures?.expects ?? "change"] ?? []).map(recordRow(rb)), ...specRecords(ctx, rb)])(readBackOf(ins, engineering)));

async function judgedRound(ctx, k, repair, ins) {
  const cand = ins?.inspect ? candidateOf(ctx, ins) : NO_CANDIDATE(ctx);
  docWritten(ctx.room, `rounds/${k}/candidate.json`, { ...cand, entries: undefined, patch: undefined });
  ctx.room.io.write(ctx.room.at("rounds", String(k), "candidate.patch"), cand.patch);
  const v = await verifiedCandidate(ctx, k, cand);
  return { repair, ins, cand, v, engineering: engineeringOf(ins), extraTasks: extraTasks(ctx, ins, k), expects: ctx.case.measures?.expects ?? "change", records: recordsOf(ctx, ins, engineeringOf(ins)), ...deltaOf(baselineDocs(ctx, show(ctx))[0], v) };
}

async function verifiedCandidate(ctx, k, cand) {
  ctx.rec.stage(ctx.task, "TESTING", `round ${k}: the candidate, held to the hidden checks`);
  const before = Object.fromEntries((baselineDocs(ctx, show(ctx))[0]?.gates ?? []).map((g) => [g.id, g]));
  return verifyAct(ctx, `cv-${shortRun(ctx)}-${k}`, `round ${k}: the candidate, verified`, cand.entries, { baseline: ctx.baseline, agentTests: cand.agentTests, beforeGates: before, candidate: true, between: () => ctx.rec.stage(ctx.task, "REGRESSION", `round ${k}: the gates and the candidate's own test`) });
}

// What a candidate did to what held before it: the hidden groups and gates that held on the subject and fail on the
// candidate (a REGRESSION, whatever else it fixed), and those that failed on the subject and hold now.
const heldOf = (v) => new Map(v ? [...groupsOf(v), ...v.gates.map((g) => [`gate:${g.id}`, g.ok])] : []);

export const deltaOf = (base, v) => ((was, now) => ({ regressed: [...was].filter(([k, ok]) => ok && now.get(k) === false).map(([k]) => k), improved: [...was].filter(([k, ok]) => !ok && now.get(k) === true).map(([k]) => k) }))(heldOf(base), heldOf(v));

const roundFailures = (r) => [...r.v.failures, ...r.cand.scope.map((f) => `scope:${f.id}:${f.rel ?? "-"}`), ...(r.extraTasks ? ["scope:EXTRA_TASK"] : []), ...(r.records ?? []).filter((x) => !x.ok).map((x) => `record:${x.id}`)];

const heldUp = (r) => r.v.complete && r.v.failures.length === 0 && r.cand.scope.length === 0 && r.extraTasks === 0 && (r.records ?? []).every((x) => x.ok);

// Verified, by what the case asks: a CHANGE made, inside its scope, holding every hidden check, gate, regression test
// and record check -- or, for a goal that must be refused, NOTHING delivered as done, every behaviour as it was, and
// the refusal on the owners' records.
const VERIFIED_BY = {
  change: (r) => heldUp(r) && r.cand.changes.length > 0,
  blocked: (r) => heldUp(r) && !(r.engineering?.lifecycle === "COMPLETED" && r.cand.changes.length > 0),
};

export const isVerified = (r) => VERIFIED_BY[r.expects ?? "change"](r);

// What kept a round from being a round of repair -- the environment, the provider, the network -- and never a host that
// stopped on its own budget (the budget rows decide that) or a candidate that failed (the verifier does).
const hostError = (r) => ((e) => (e && e.cause !== "BUDGET_EXHAUSTED" ? e : null))(r.repair?.host ? hostEnd(r.repair.host, { timedOut: r.repair.container?.timedOut || r.repair.container?.held, exit: r.repair.runner?.exit }) : null);

// A candidate's verification that did not run as declared: refused is the environment; anything else (a container
// with no exit) is the infrastructure. A candidate's own time and memory are never here -- verify.mjs counts them as
// its failures.
const verifyError = (v) => (v.problem ? { cause: (v.problemEnds ?? ["REFUSED"]).includes("REFUSED") ? "ENVIRONMENT" : "INFRASTRUCTURE", says: v.problem } : null);

const roundError = (r) => r.repair?.error ?? (r.repair?.runner?.setup === "EGRESS" ? { cause: "ENVIRONMENT", says: r.repair.runner.why } : null) ?? hostError(r) ?? verifyError(r.v);

// The candidates earlier rounds left, and how each failed: a round that leaves one of them again is no progress.
const earlierOf = (ctx, k) => Array.from({ length: k - 1 }, (_, i) => docRead(ctx.room, `rounds/${i + 1}/outcome.json`)).filter(Boolean).map((o) => ({ patchDigest: o.patchDigest, signature: o.signature ?? undefined }));

// Stopped at its deadline, not held by a person (a held run ends as the person held it) and not ended by its task.
const cutShortOf = (r) => r.repair?.container?.timedOut === true && r.repair.container.held !== true && r.engineering?.terminal !== true;

const roundFacts = (ctx, k, r, before) => ({ frozenIntact: frozenIntact(ctx), roundError: roundError(r), verified: isVerified(r), changed: r.cand.changes.length > 0, engineering: r.engineering, signature: before.signature, previous: before.previous, left: leftOf(ctx, show(ctx)), scope: [...r.cand.scope, ...(r.extraTasks ? [{ id: "EXTRA_TASK" }] : [])], cutShort: cutShortOf(r), patchDigest: r.cand.patchDigest, earlier: earlierOf(ctx, k), expects: r.expects ?? "change", ...(ctx.case.kind === "engineering" ? { standing: null } : {}) });

const signatureOrNot = (failures) => (failures.length ? signatureOf(failures) : undefined);

function concluded(ctx, k, r) {
  const before = { previous: show(ctx).attempts.map((a) => a.failureSignature).filter(Boolean), signature: signatureOrNot(roundFailures(r)) };
  ctx.rec.attemptComplete(ctx.task, isVerified(r) ? "succeeded" : "failed", before.signature);
  const facts = roundFacts(ctx, k, r, before);
  const next = nextOf(facts);
  return (docWritten(ctx.room, `rounds/${k}/outcome.json`, { round: k, signature: facts.signature ?? null, patchDigest: facts.patchDigest, regressed: r.regressed, improved: r.improved, records: r.records ?? [], cutShort: facts.cutShort, next: next.id, outcome: next.outcome, class: next.class }), next);
}

// An engineering case's outcome in its own words: the goal reached and verified is PASS, and refused is FAIL.
const GOAL_WORDS = { REPAIRED_VERIFIED: "PASS", REPAIR_REJECTED: "FAIL" };

const wordOf = (ctx, outcome) => (ctx.case.kind === "engineering" ? GOAL_WORDS[outcome] ?? outcome : outcome);

const endingFor = (ctx, next, r) => ((outcome) => ({ end: next.end, stop: next.stop, needs: next.needs ?? "environment", outcome, next: next.id, class: next.class, summary: `${outcome}: ${next.says}${r.cand.patch ? ` · patch ${r.cand.patchDigest.slice(0, 12)}` : ""}` }))(wordOf(ctx, next.outcome));

function linkedFiles(ctx, r) {
  for (const c of r.cand.changes.filter((x) => safeRel(x.rel))) ctx.rec.file(ctx.task, { path: c.rel, change: c.change, added: c.added, removed: c.removed });
  if (r.engineering?.commit) ctx.rec.receipt(ctx.task, { domain: "commit", ref: r.engineering.commit, outcome: "COMMITTED", summary: "the engineering task's own commit, in the run's runner store" });
}

function roundEnded(ctx, k, r, next) {
  verificationRows(ctx, `round-${k}`, r.v, `test:cv-${shortRun(ctx)}-${k}`);
  linkedFiles(ctx, r);
  if (next.id === "VERIFIED") docWritten(ctx.room, "verified.json", verifiedDoc(ctx, k, r));
  return ended(ctx, endingFor(ctx, next, r));
}

// THE VERIFIED CANDIDATE: everything a person needs to read what was repaired and to apply it themselves -- never
// applied here. It stays in the run's room; the developer's checkout is a person's to write (PRIMARY_CHECKOUT_WRITE).
function verifiedDoc(ctx, k, r) {
  const base = baselineDocs(ctx, show(ctx))[0] ?? null;
  const host = r.repair?.host ?? null;
  const patch = ctx.room.at("rounds", String(k), "candidate.patch");
  return { schema: 1, run: ctx.run.id, task: ctx.task, at: new Date().toISOString(), case: { id: ctx.case.id, version: ctx.case.version, suite: ctx.manifest.benchmark.suite, digest: ctx.manifest.benchmark.digest }, variant: ctx.manifest.benchmark.variant, source: { branch: ctx.manifest.source.branch, commit: ctx.manifest.source.commit, digest: ctx.manifest.source.digest }, subject: { digest: ctx.manifest.subject.digest, commit: ctx.manifest.subject.commit }, baseline: { signature: base?.signature ?? null, failingGroups: [...new Set((base?.hidden.checks ?? []).filter((c) => !c.ok).map((c) => c.group))] }, engineering: { task: r.engineering?.id ?? null, lifecycle: r.engineering?.lifecycle ?? null, commit: r.engineering?.commit ?? null, where: "the run's runner store" }, host: { basis: hostBasisOf(ctx.manifest.config), model: host?.model ?? null, session: host?.session ?? null, costUsd: host?.costUsd ?? null, numbers: "REPORTED by the host, never verified" }, candidate: { round: k, patch, patchDigest: r.cand.patchDigest, files: r.cand.changes, agentTests: r.cand.agentTests }, verification: { digest: r.v.digest, hidden: `${r.v.hidden.checks.filter((c) => c.ok).length}/${r.v.hidden.checks.length}`, gates: r.v.gates.map((g) => ({ id: g.id, ok: g.ok, tests: g.tap?.tests ?? null })), agent: r.v.agent ? { tests: r.v.agent.rels, failsBefore: r.v.agent.before.failed, passesAfter: r.v.agent.after.ok } : null, regressed: r.regressed, improved: r.improved }, reproduce: [`git clone ${ctx.checkoutDir} <scratch> && git -C <scratch> apply ${patch}`, `node benchmark/run.mjs run --like=${ctx.run.id}`, `node benchmark/run.mjs report ${ctx.run.id}`] };
}

const BUDGET_DOOR = /BUDGET_(ATTEMPTS|MINUTES|ACTIONS)|budget/i;

// A new round, only while the budget lasts -- the task's own door holds its attempts and minutes, and refuses past them.
function roundOpened(ctx, view) {
  if (leftOf(ctx, view).rounds <= 0 || minutesLeft(view) <= RESERVE_MINUTES) return false;
  try { return (ctx.rec.attemptStart(ctx.task, "fix"), true); }
  catch (e) { return BUDGET_DOOR.test(e.message) ? false : rethrown(e); }
}

const rethrown = (e) => {
  throw e;
};

const BUDGET_END = (ctx) => ({ end: "fail", stop: "BUDGET_EXHAUSTED", outcome: "BUDGET_EXHAUSTED", summary: `BUDGET_EXHAUSTED: no round or minute is left for another repair round (${ctx.limits.rounds} round(s); ${RESERVE_MINUTES} minutes are kept for verification)` });

async function oneRound(ctx, view) {
  const k = Math.max(1, view.attempts.length - (current(view) ? 1 : 0));
  if (!current(view) && !roundOpened(ctx, view)) return ended(ctx, BUDGET_END(ctx));
  const r = await roundCarried(ctx, show(ctx), k);
  const next = concluded(ctx, k, r);
  return next.end ? roundEnded(ctx, k, r, next) : null;
}

async function rounds(ctx) {
  const stop = credentialProblem(ctx);
  if (stop) return ended(ctx, { end: "block", stop: "ENVIRONMENT_BLOCKED", needs: "environment", outcome: "BLOCKED", summary: stop });
  for (let done = null; ; ) if ((done = await oneRound(ctx, show(ctx)))) return done;
}

// ---- the whole run ---------------------------------------------------------------------------------------------------------

const HELD = (view) => (view.lifecycle === "PAUSED" ? "a person paused this run: it goes on once they resume it in Orbit Control" : view.lifecycle === "CANCELLED" ? "a person cancelled this run" : null);

function reconciled(ctx, view) {
  const open = (view.actions ?? []).filter((a) => a.state === "running");
  if (open.some((a) => a.type === "benchmark.repair")) cleaned(ctx.run.id, ctx.deps);
  for (const a of open) ctx.rec.actFail(ctx.task, a.id, a.type === "benchmark.repair" ? "interrupted: the controller stopped before this round settled; what it did is read back, never sent again" : "interrupted: run again as a new action");
  if (view.lifecycle === "BLOCKED") unblocked(ctx);
}

// A blocked run resumed: what blocked it is asked again, and the ending that recorded the block is kept as history --
// it is no longer what the run is waiting to write.
function unblocked(ctx) {
  const was = docRead(ctx.room, "ending.json");
  if (was) docWritten(ctx.room, `endings/${String(was.at ?? Date.now()).replace(/[^0-9A-Za-z]/g, "")}.json`, was);
  ctx.room.io.removeFile(ctx.room.at("ending.json"));
  ctx.rec.unblock(ctx.task, "resumed: what blocked it is asked again");
}

const endedAlready = (ctx, view) => ((e) => ({ outcome: e?.outcome ?? view.lifecycle, exit: EXIT[e?.outcome] ?? 4, summary: HELD(view) ?? e?.summary ?? view.lifecycle }))(docRead(ctx.room, "ending.json"));

// From wherever the journal says the run stands, to its end -- or to where a person held it: a step the task's door
// refused because a person paused or cancelled the run ends the run there, with nothing of its own left running.
export async function carried(ctx) {
  const view = show(ctx);
  if (view.terminal || HELD(view)) return endedAlready(ctx, view);
  reconciled(ctx, view);
  return fromHere(ctx, show(ctx)).catch((e) => heldAfter(ctx, e));
}

function heldAfter(ctx, e) {
  const view = show(ctx);
  if (!HELD(view)) throw e;
  cleaned(ctx.run.id, ctx.deps);
  return endedAlready(ctx, view);
}

async function fromHere(ctx, view) {
  const pending = docRead(ctx.room, "ending.json");
  if (pending) return ended(ctx, pending);
  const runs = view.attempts[0]?.outcome ? baselineDocs(ctx, view) : await baseline(ctx, view);
  const d = (view.decisions ?? []).length ? diagnosisOf(ctx, causeOf(factsOf(ctx, runs))) : diagnosed(ctx, runs);
  return d.ending ? (verificationRows(ctx, "baseline", runs[0], `test:bv-${shortRun(ctx)}-1`), ended(ctx, d.ending)) : rounds(ctx);
}
