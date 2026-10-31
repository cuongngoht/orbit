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

async function recorded(ctx, type, label, body) {
  const act = ctx.rec.actStart(ctx.task, type, label);
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

const problemOf = (runs) => runs.find((r) => r.problem)?.problem ?? null;

const factsOf = (ctx, runs) => ({ benchmark: ctx.invalid ?? (frozenIntact(ctx) ? null : { says: "the frozen case or subject changed after the run began" }), environment: problemOf(runs) ? { says: problemOf(runs) } : null, credentials: null, provider: null, budget: null, runs, repairable: ctx.case.measures.repairable });

const variantSays = (ctx) => (ctx.manifest.benchmark.variant === "real" ? "on the source as it is" : `planted by the ${ctx.manifest.benchmark.variant} variant, not a defect found in the source`);

const ENDINGS = {
  PASS: (ctx, cause) => ({ end: "complete", outcome: "PASS", summary: `PASS — ${cause.says}` }),
  FAIL: (ctx, cause) => ({ end: "complete", outcome: "FAIL", summary: `FAIL (${cause.id}, ${variantSays(ctx)}) — ${cause.says}` }),
  BENCHMARK_INVALID: (ctx, cause) => ({ end: "fail", stop: "REQUIREMENT_BLOCKED", outcome: "BENCHMARK_INVALID", summary: `BENCHMARK_INVALID — ${cause.says}` }),
  BLOCKED: (ctx, cause) => ({ end: "block", stop: "ENVIRONMENT_BLOCKED", needs: "environment", outcome: "BLOCKED", summary: `BLOCKED (${cause.id}) — ${cause.says}` }),
  INCONCLUSIVE: (ctx, cause) => ({ end: "complete", outcome: "INCONCLUSIVE", summary: `INCONCLUSIVE (${cause.id}) — ${cause.says}` }),
};

const ENDING_OF = { PASS: "PASS", BENCHMARK_INVALID: "BENCHMARK_INVALID", ENVIRONMENT: "BLOCKED", CREDENTIALS: "BLOCKED", PROVIDER: "BLOCKED", BUDGET_EXHAUSTED: "BLOCKED", INSUFFICIENT_EVIDENCE: "INCONCLUSIVE", GATE_UNEXPLAINED: "INCONCLUSIVE" };

// What the baseline came to, as the next action: a repair only for a cause the case declares repairable, when a repair
// was asked for; otherwise the run ends with the verdict it earned.
const diagnosisOf = (ctx, cause) => (cause.repairable && ctx.repair ? { cause, next: "repair", ending: null } : { cause, next: "report", ending: ENDINGS[ENDING_OF[cause.id] ?? (cause.repairable ? "FAIL" : "INCONCLUSIVE")](ctx, cause) });

function diagnosed(ctx, runs) {
  ctx.rec.stage(ctx.task, "DIAGNOSING", "what the two verifications of the subject showed");
  const d = diagnosisOf(ctx, causeOf(factsOf(ctx, runs)));
  ctx.rec.decide(ctx.task, { observed: `${runs[0].failures.length} failing check(s); verified twice, signatures ${runs.map((r) => r.signature).join(" and ")}`, hypothesis: `${d.cause.id}: ${d.cause.says}`, next: d.next, evidence: [show(ctx).attempts[0].id, `test:bv-${shortRun(ctx)}-1`] });
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

const credentialProblem = (ctx) => (ctx.credentialNames.some((n) => n !== "ANTHROPIC_BASE_URL") ? null : "CREDENTIALS: no credential for the coding host is set here, by name (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN; --credential=<NAME>) — the baseline is kept, and `resume` goes on once one is");

const minutesLeft = (view) => Math.floor((view.budget?.minutes?.limit ?? 0) - (view.budget?.minutes?.spent ?? 0));

const roundCost = (ctx, view, a) => stepOf(ctx, lastEnded(actsOf(view, a.id), "benchmark.repair"))?.host?.costUsd ?? ctx.limits.usd / Math.max(1, ctx.limits.rounds);

const spentUsd = (ctx, view) => (view.attempts ?? []).slice(1).filter((a) => a.outcome).reduce((n, a) => n + roundCost(ctx, view, a), 0);

const leftOf = (ctx, view) => ({ rounds: ctx.limits.rounds - Math.max(0, (view.attempts?.length ?? 1) - 1), minutes: minutesLeft(view), usd: Math.max(0, Math.round((ctx.limits.usd - spentUsd(ctx, view)) * 100) / 100) });

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

function roundState(ctx, view, k) {
  const left = leftOf(ctx, view);
  const runnerMinutes = Math.max(1, Math.min(ctx.case.limits.runner.minutes, left.minutes - RESERVE_MINUTES));
  ctx.rec.stage(ctx.task, "FIXING", `round ${k}: the coding host repairs the source through Orbit's engineering loop`);
  return { left: { ...left, engineeringMinutes: runnerMinutes }, latest: latestVerification(ctx, view), engTask: engTaskOf(ctx, k - 1), deadlineMs: runnerMinutes * 60000 };
}

const repairSummary = (r) => (r.error ? r.error.says : `the host made ${r.host?.toolCalls ?? "an unknown number of"} tool call(s) and ended ${r.container?.timedOut ? "at the round's deadline" : `with ${r.runner?.exit ?? "?"}${r.runner?.setup ? ` (${r.runner.setup})` : ""}`}`);

const repairReceipt = (ctx, k, r) => ((t) => (t ? { domain: "task", ref: `runner.${t}`, outcome: "IN_RUNNER_STORE", summary: `the run's one engineering task, in its runner store; round ${k}` } : null))(r.start?.task ?? r.runner?.task ?? null);

const repairAct = (ctx, k, state) => recorded(ctx, "benchmark.repair", `round ${k}: the coding host on the engineering task`, async () => ((r) => ({ doc: r, outcome: r.error ? "failed" : "succeeded", receipt: repairReceipt(ctx, k, r), summary: repairSummary(r) }))(await ranRound(ctx, k, state)));

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

const engineeringOf = (ins) => ((v) => (v ? { id: v.task?.id ?? null, lifecycle: v.lifecycle, terminal: v.terminal === true, stopReason: v.stopReason ?? null, stage: v.stage, attempts: (v.attempts ?? []).length, revision: v.revision, commit: (v.receipts ?? []).find((r) => r.domain === "commit")?.ref ?? null, changes: v.changes?.files ?? 0, provider: v.task?.provider ?? null } : null))(ins?.task?.json);

const extraTasks = (ctx, ins, k) => (ins?.tasks?.json?.tasks ?? []).map((t) => t.id).filter((t) => t !== engTaskOf(ctx, k)).length;

async function judgedRound(ctx, k, repair, ins) {
  const cand = ins?.inspect ? candidateOf(ctx, ins) : NO_CANDIDATE(ctx);
  docWritten(ctx.room, `rounds/${k}/candidate.json`, { ...cand, entries: undefined, patch: undefined });
  ctx.room.io.write(ctx.room.at("rounds", String(k), "candidate.patch"), cand.patch);
  const v = await verifiedCandidate(ctx, k, cand);
  return { repair, ins, cand, v, engineering: engineeringOf(ins), extraTasks: extraTasks(ctx, ins, k) };
}

async function verifiedCandidate(ctx, k, cand) {
  ctx.rec.stage(ctx.task, "TESTING", `round ${k}: the candidate, held to the hidden checks`);
  const before = Object.fromEntries((baselineDocs(ctx, show(ctx))[0]?.gates ?? []).map((g) => [g.id, g]));
  return verifyAct(ctx, `cv-${shortRun(ctx)}-${k}`, `round ${k}: the candidate, verified`, cand.entries, { baseline: ctx.baseline, agentTests: cand.agentTests, beforeGates: before, between: () => ctx.rec.stage(ctx.task, "REGRESSION", `round ${k}: the gates and the candidate's own test`) });
}

const roundFailures = (r) => [...r.v.failures, ...r.cand.scope.map((f) => `scope:${f.id}:${f.rel ?? "-"}`), ...(r.extraTasks ? ["scope:EXTRA_TASK"] : [])];

export const isVerified = (r) => r.v.complete && r.v.failures.length === 0 && r.cand.scope.length === 0 && r.extraTasks === 0 && r.cand.changes.length > 0;

// What kept a round from being a round of repair -- the environment, the provider, the network -- and never a host that
// stopped on its own budget (the budget rows decide that) or a candidate that failed (the verifier does).
const hostError = (r) => ((e) => (e && e.cause !== "BUDGET_EXHAUSTED" ? e : null))(r.repair?.host ? hostEnd(r.repair.host, { timedOut: r.repair.container?.timedOut, exit: r.repair.runner?.exit }) : null);

const roundError = (r) => r.repair?.error ?? (r.repair?.runner?.setup === "EGRESS" ? { cause: "ENVIRONMENT", says: r.repair.runner.why } : null) ?? hostError(r) ?? (r.v.problem ? { cause: "ENVIRONMENT", says: r.v.problem } : null);

function concluded(ctx, k, r) {
  const previous = show(ctx).attempts.map((a) => a.failureSignature).filter(Boolean);
  const failures = roundFailures(r);
  const signature = failures.length ? signatureOf(failures) : undefined;
  ctx.rec.attemptComplete(ctx.task, isVerified(r) ? "succeeded" : "failed", signature);
  return nextOf({ frozenIntact: frozenIntact(ctx), roundError: roundError(r), verified: isVerified(r), changed: r.cand.changes.length > 0, engineering: r.engineering, signature, previous, left: leftOf(ctx, show(ctx)), scope: [...r.cand.scope, ...(r.extraTasks ? [{ id: "EXTRA_TASK" }] : [])] });
}

const endingFor = (next, r) => ({ end: next.end, stop: next.stop, needs: "environment", outcome: next.outcome, summary: `${next.outcome}: ${next.says}${r.cand.patch ? ` · patch ${r.cand.patchDigest.slice(0, 12)}` : ""}` });

function linkedFiles(ctx, r) {
  for (const c of r.cand.changes.filter((x) => safeRel(x.rel))) ctx.rec.file(ctx.task, { path: c.rel, change: c.change, added: c.added, removed: c.removed });
  if (r.engineering?.commit) ctx.rec.receipt(ctx.task, { domain: "commit", ref: r.engineering.commit, outcome: "COMMITTED", summary: "the engineering task's own commit, in the run's runner store" });
}

function roundEnded(ctx, k, r, next) {
  verificationRows(ctx, `round-${k}`, r.v, `test:cv-${shortRun(ctx)}-${k}`);
  linkedFiles(ctx, r);
  return ended(ctx, endingFor(next, r));
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
