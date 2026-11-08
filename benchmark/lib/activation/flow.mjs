// THE FLOW of one activation run (0.5.0, B22 M4), from what was frozen to its verdict. Where the run stands is read off
// its task's journal every time -- never kept beside it -- so a run interrupted anywhere is carried on from there: the
// seed and every verification are done again (they change nothing anyone measured); the host's round is never sent
// again -- what it left is read back and judged.
//
//   attempt 1 (`fresh`)
//     ENVIRONMENT  benchmark.target      the case's SEED laid into the runner's store by the run's own Orbit (seed.mjs)
//     TESTING      benchmark.verify      an outcome case's target held to its hidden checks BEFORE the host's round: a
//                                        target that already holds what the prompt asks is a benchmark that is wrong
//     TESTING      benchmark.activation  the host's round: the prompt, verbatim, to Claude Code or a control's scripted host
//     REVIEWING    benchmark.inspect     what the round left, read back with the run's own Orbit (round.mjs)
//     REGRESSION   benchmark.verify      what the host DELIVERED -- an Orbit engineering task's own commit, or the checkout
//                                        it was handed -- held to the hidden checks (a case with a spec)
//   ending       the judge's verdict (judge.mjs): PASS, FAIL with its class, or BLOCKED
//
//   carriedActivation(ctx) -> { outcome, exit, summary }      withActivation(ctx) -> ctx with its truth (and spec)
//   deliveredOf(inspection) -> { by, changes, dir }           factsFrom(x) -> the judge's facts      EXIT · RESERVE_MINUTES
import { join } from "node:path";
import { shaBytes } from "../../../src/hash.mjs";
import { frozenIntact, withSpec } from "../core/context.mjs";
import { cleaned } from "../core/docker.mjs";
import { commandsOf, hostOf } from "../core/host.mjs";
import { safeRel } from "../core/paths.mjs";
import { docRead, docWritten, readRegular } from "../core/room.mjs";
import { activationTruthOf } from "../core/suites.mjs";
import { verificationSummary } from "../source/flow.mjs";
import { assembled } from "../source/round.mjs";
import { verified } from "../source/verify.mjs";
import { judgedActivation } from "./judge.mjs";
import { hostRan, inspected, scriptedHost } from "./round.mjs";
import { seededRan, seedState } from "./seed.mjs";

export const EXIT = { PASS: 0, FAIL: 1, BENCHMARK_INVALID: 2, BLOCKED: 3, INCONCLUSIVE: 4 };

// Minutes kept back from the host's round for what must follow it: reading it back and verifying what it delivered.
export const RESERVE_MINUTES = 15;

const show = (ctx) => ctx.rec.show(ctx.task);

const stepOf = (ctx, act) => (act ? docRead(ctx.room, `steps/${act.id}.json`) : null);

const settledOf = (view, type, label) => (view.actions ?? []).filter((a) => a.type === type && (!label || a.label === label) && a.state !== "running" && a.state !== "error").at(-1) ?? null;

const triedOf = (view, type) => (view.actions ?? []).some((a) => a.type === type);

const shortRun = (ctx) => ctx.run.id.slice(4);

// ---- one recorded phase: started, its evidence kept under its own id, ended with its receipt -------------------------------

async function recorded(ctx, p) {
  const act = ctx.rec.actStart(ctx.task, p.type, p.label, p.role);
  const result = await p.body();
  docWritten(ctx.room, `steps/${act}.json`, result.doc);
  if (result.receipt) ctx.rec.receipt(ctx.task, { ...result.receipt, action: act });
  return (ctx.rec.actComplete(ctx.task, act, result.outcome ?? "succeeded", result.receipt ? `${result.receipt.domain}:${result.receipt.ref}` : undefined, result.summary), result.doc);
}

// A phase that settled is read back; one that did not is done again, under the stage it belongs to.
async function phase(ctx, p) {
  const was = stepOf(ctx, settledOf(show(ctx), p.type, p.label));
  if (was) return was;
  ctx.rec.stage(ctx.task, p.stage, p.because);
  return recorded(ctx, p);
}

// ---- the seed -------------------------------------------------------------------------------------------------------------

async function seedBody(ctx) {
  const r = await seededRan(ctx);
  const s = seedState(r);
  return { doc: { ...(r.seed ?? {}), ran: r.ran, ...s }, outcome: s.state === "SEEDED" ? "succeeded" : "failed", summary: s.state === "SEEDED" ? `seeded: ${Object.keys(r.seed?.kept ?? {}).length} value(s) kept, ${Object.keys(r.seed?.digests ?? {}).length} test-data file(s)` : `the seed did not hold: ${String(s.why).slice(0, 200)}` };
}

const seeded = (ctx) => (ctx.case.seed ? phase(ctx, { type: "benchmark.target", stage: "ENVIRONMENT", because: "the case's seed, laid into the runner's store by the run's own Orbit", label: "the seed laid into the runner's store", body: () => seedBody(ctx) }) : null);

// ---- verifications ----------------------------------------------------------------------------------------------------------

const verifyBody = async (ctx, ref, entries, o) => ((v) => ({ doc: v, outcome: v.complete ? "succeeded" : "failed", receipt: { domain: "test", ref, outcome: !v.complete ? "INCOMPLETE" : v.failures.length ? "FAIL" : "PASS", summary: verificationSummary(v) }, summary: verificationSummary(v) }))(await verified(ctx, ref, entries, o));

const outcomeCase = (ctx) => ctx.case.measures.tier === "outcome";

const baselined = (ctx) => (outcomeCase(ctx) ? phase(ctx, { type: "benchmark.verify", stage: "TESTING", because: "the target, held to its hidden checks before the host is handed it", label: "the target, verified before the round", body: () => verifyBody(ctx, `bv-${shortRun(ctx)}`, ctx.baseline, {}) }) : null);

// ---- the host's round, once --------------------------------------------------------------------------------------------------

const minutesLeft = (view) => Math.floor((view.budget?.minutes?.limit ?? 0) - (view.budget?.minutes?.spent ?? 0));

const roundMs = (ctx) => Math.max(1, Math.min(ctx.case.limits.runner.minutes, minutesLeft(show(ctx)) - RESERVE_MINUTES)) * 60000;

const HELD = (view) => (view.lifecycle === "PAUSED" ? "a person paused this run: it goes on once they resume it in Orbit Control" : view.lifecycle === "CANCELLED" ? "a person cancelled this run" : null);

const driverOf = (ctx) => (scriptedHost(ctx) ? ctx.host : "coding-host");

const roundSummary = (r) => (r.error ? r.error.says : `the host made ${r.host?.toolCalls ?? "an unknown number of"} tool call(s) and ended ${r.container?.timedOut ? "at the round's deadline" : `with ${r.runner?.exit ?? "?"}`}`);

async function hostBody(ctx) {
  const r = await hostRan(ctx, { deadlineMs: roundMs(ctx), held: () => Boolean(HELD(show(ctx))) });
  return { doc: { driver: driverOf(ctx), ...r }, outcome: r.error ? "failed" : "succeeded", summary: roundSummary(r) };
}

const ROLE = (ctx) => ({ tool: scriptedHost(ctx) ? "scripted-host" : "coding-host", mutates: true });

const hostPhase = (ctx) => (triedOf(show(ctx), "benchmark.activation") && !settledOf(show(ctx), "benchmark.activation") ? { interrupted: true } : phase(ctx, { type: "benchmark.activation", stage: "TESTING", because: "the prompt, as a person types it, to the host", label: `the ${driverOf(ctx)} on the prompt`, role: ROLE(ctx), body: () => hostBody(ctx) }));

const inspectSummary = (ins) => `the inspection ended ${ins.end}: ${(ins.tasks?.json?.tasks ?? []).length} task(s), ${(ins.inspect?.changes ?? []).length} change(s) in the checkout`;

// The read-back is the receipt every record row of the truth rests on.
const inspectBody = async (ctx) => ((ins) => ({ doc: ins, outcome: ins.refused ? "failed" : "succeeded", receipt: { domain: "check", ref: `in-${shortRun(ctx)}`, outcome: ins.refused ? "REFUSED" : "READ_BACK", summary: inspectSummary(ins) }, summary: inspectSummary(ins) }))(await inspected(ctx));

const inspectedPhase = (ctx) => phase(ctx, { type: "benchmark.inspect", stage: "REVIEWING", because: "what the round left, read back with the run's own Orbit", label: "what the round left, read back", body: () => inspectBody(ctx) });

// ---- what the host delivered, and its verification -----------------------------------------------------------------------------

const MAX_FILE = 2 * 1024 * 1024;

const viewOfTask = (ins, task) => (ins?.views?.json?.views ?? []).find((v) => v.id === task) ?? null;

// An Orbit engineering task delivered a change when it completed, or committed one in its own delivery.
const engineeringDelivered = (ins) => ((v) => Boolean(v) && (v.lifecycle === "COMPLETED" || (v.receipts ?? []).some((r) => r.domain === "commit")))(viewOfTask(ins, ins?.workspace?.json?.task));

// What the host DELIVERED: an Orbit engineering task's own change when one delivered it -- else whatever it left in the
// checkout it was handed, or nothing.
export const deliveredOf = (ins) => (engineeringDelivered(ins) && (ins.workspace.json.changes ?? []).length ? { by: "orbit", changes: ins.workspace.json.changes, dir: join(ins.dir, "ws-files") } : { by: (ins?.inspect?.changes ?? []).length ? "host" : "nothing", changes: ins?.inspect?.changes ?? [], dir: join(ins?.dir ?? ".", "files") });

const brought = (dir, c) => ((b) => (b && shaBytes(b) === c.digest ? b : null))(c.change === "deleted" || !c.copied || !safeRel(c.rel) ? null : readRegular(join(dir, c.rel), MAX_FILE));

const textsOf = (ctx, d) => ((bytes) => (rel, side) => (side === "before" ? ctx.baselineText(rel) : bytes.get(rel)?.toString("utf8") ?? null))(new Map(d.changes.map((c) => [c.rel, brought(d.dir, c)])));

// A case whose prompt asks for its tests to be changed holds them by the gate's count, never by SCOPE's test rules.
const AS_LEFT = ["TEST_WEAKENED", "TEST_DELETED"];

const asLeft = (ctx) => ctx.case.scope?.tests === "as-left";

const scopeHeld = (ctx, cand) => cand.scope.filter((f) => !(asLeft(ctx) && AS_LEFT.includes(f.id)));

const gatesOf = (base) => (base?.gates ? Object.fromEntries(base.gates.map((g) => [g.id, g])) : null);

const outcomeOf = (d, cand, scope, v) => ({ delivered: d.by, changes: d.changes.length, complete: v.complete, held: v.complete && !v.failures.length && !scope.length && d.changes.length > 0, problem: v.problem, problemEnds: v.problemEnds, scope: scope.map((f) => f.id), says: `${verificationSummary(v)}${scope.length ? ` · scope ${scope.map((f) => f.id).join(", ")}` : ""}` });

async function candidateBody(ctx, ins, base) {
  const d = deliveredOf(ins);
  const cand = assembled(ctx, d.changes, textsOf(ctx, d), []);
  const v = await verified(ctx, `cv-${shortRun(ctx)}`, cand.entries, { baseline: ctx.baseline, agentTests: cand.agentTests, beforeGates: gatesOf(base), candidate: true, testsAsLeft: asLeft(ctx) });
  const outcome = outcomeOf(d, cand, scopeHeld(ctx, cand), v);
  return { doc: { outcome, patch: cand.patch, patchDigest: cand.patchDigest, files: cand.changes, v }, outcome: v.complete ? "succeeded" : "failed", summary: outcome.says };
}

const candidated = (ctx, ins, base) => (ctx.case.acceptance.spec ? phase(ctx, { type: "benchmark.verify", stage: "REGRESSION", because: "what the host delivered, held to the hidden checks", label: "what the host delivered, verified", body: () => candidateBody(ctx, ins, base) }) : null);

// ---- the judge's facts ------------------------------------------------------------------------------------------------------

const textAt = (file, max = 80 * 1024 * 1024) => readRegular(file, max)?.toString("utf8") ?? "";

// The host's stream as the controller captured it, else as the runner kept it.
const streamText = (ctx) => textAt(ctx.room.at("rounds", "1", "host.stream.jsonl")) || `${textAt(ctx.room.at("rounds", "1", "out", "host.jsonl"))}\n${textAt(ctx.room.at("rounds", "1", "out", "host-tail.jsonl"), 70 * 1024)}`;

const ranOf = (r) => ({ timedOut: r?.container?.timedOut === true, interrupted: r?.interrupted === true, error: r?.error?.says ?? (r?.runner?.setup === "EGRESS" ? r.runner.why : null) });

const readOf = (ins) => ({ views: ins?.views?.json?.views ?? [], workflows: ins?.workflows?.json?.workflows ?? [], works: ins?.works?.json?.works ?? [], rooms: ins?.rooms?.json ?? {}, uitests: ins?.uitests?.json ?? {}, ledger: ins?.ledger?.json?.lines ?? [], plans: ins?.plans?.json?.plans ?? [], plancheck: { exit: ins?.plancheck?.exit ?? null, errors: ins?.plancheck?.json?.errors ?? null }, check: { exit: ins?.check?.exit ?? null }, goals: ins?.goals?.json?.goals ?? [] });

const treeOf = (entries) => ({ rels: entries.map((e) => e.rel), sizes: Object.fromEntries(entries.map((e) => [e.rel, e.bytes?.length ?? 0])) });

const seedOf = (doc) => (doc ? { kept: doc.kept ?? {}, digests: doc.digests ?? null, cases: doc.cases ?? null } : null);

// What the judge is handed, from what a run kept: the case and its truth, the host's stream, its round, the inspection's
// documents, the seed's record, what was delivered and verified, and the target as it was frozen. A test that plays a
// control outside any container hands the same.
// x: { c, truth, arm, switches, text, host, ins, seed, cand, entries }
export function factsFrom(x) {
  const h = hostOf(x.text);
  return { tier: x.c.measures.tier, arm: x.arm, switches: x.switches ?? {}, truth: x.truth, host: h, ran: ranOf(x.host), uses: h.uses, commands: commandsOf(x.text), session: h.session, trail: { turns: x.ins?.turns ?? null, usage: x.ins?.trace ?? null }, read: readOf(x.ins), seed: seedOf(x.seed), outcome: x.cand?.outcome ?? null, tree: treeOf(x.entries) };
}

const factsOf = (ctx, s) => factsFrom({ c: ctx.case, truth: ctx.truth, arm: ctx.arm, switches: ctx.switches, text: streamText(ctx), host: s.host, ins: s.ins, seed: s.seed, cand: s.cand, entries: ctx.baseline });

// ---- the ending ---------------------------------------------------------------------------------------------------------------

const ENDINGS = {
  PASS: (j) => ({ end: "complete", outcome: "PASS", summary: `PASS — ${j.why}` }),
  FAIL: (j) => ({ end: "complete", outcome: "FAIL", summary: `FAIL (${j.row}, ${j.class}) — ${j.why}` }),
  BLOCKED: (j) => ({ end: "block", stop: "ENVIRONMENT_BLOCKED", outcome: "BLOCKED", summary: `BLOCKED (${j.row}) — ${j.why}` }),
};

const ENDERS = {
  complete: (ctx, e) => ctx.rec.complete(ctx.task, e.summary),
  fail: (ctx, e) => ctx.rec.fail(ctx.task, e.stop, e.summary),
  block: (ctx, e) => ctx.rec.block(ctx.task, e.stop, "environment", e.summary),
};

function ended(ctx, e) {
  docWritten(ctx.room, "ending.json", { ...e, at: new Date().toISOString() });
  if (show(ctx).attempt?.open) ctx.rec.attemptComplete(ctx.task, e.outcome === "PASS" ? "succeeded" : "failed");
  ENDERS[e.end](ctx, e);
  return { outcome: e.outcome, exit: EXIT[e.outcome] ?? 4, summary: e.summary };
}

const blocked = (cause, cls, says) => ({ end: "block", stop: "ENVIRONMENT_BLOCKED", outcome: "BLOCKED", cause, class: cls, summary: `BLOCKED — ${says}` });

const invalid = (says) => ({ end: "fail", stop: "REQUIREMENT_BLOCKED", outcome: "BENCHMARK_INVALID", cause: "BENCHMARK_INVALID", class: "BENCHMARK_DEFECT", summary: `BENCHMARK_INVALID — ${says}` });

function judgedEnding(ctx, s) {
  const j = judgedActivation(factsOf(ctx, s));
  docWritten(ctx.room, "judged.json", j);
  for (const r of j.records) ctx.rec.verification(ctx.task, { subject: `activation.record.${r.id}`, obligation: r.says, state: r.ok ? "satisfied" : "violated", evidence: `check:in-${shortRun(ctx)}` });
  return ended(ctx, { ...ENDINGS[j.verdict](j), cause: j.row, class: j.class });
}

// ---- the whole run ----------------------------------------------------------------------------------------------------------

// What ends a run before a host is handed the prompt: a seed that did not hold, or a target that already holds.
const SETUP_ENDS = [
  { when: (s) => s.seed?.state === "BLOCKED", end: (s) => blocked("ENVIRONMENT", "ENVIRONMENT_BLOCKED", `the seed round could not run: ${s.seed.why}`) },
  { when: (s) => s.seed && s.seed.state !== "SEEDED", end: (s) => invalid(`the case's seed does not hold on this source: ${s.seed.why}`) },
  { when: (s) => Boolean(s.base?.problem), end: (s) => blocked("ENVIRONMENT", "ENVIRONMENT_BLOCKED", s.base.problem) },
  { when: (s) => s.base && s.base.complete && s.base.hiddenFailed === 0, end: () => invalid("the target already holds what the prompt asks: a case whose target needs no change measures nothing") },
];

const setupEnd = (s) => SETUP_ENDS.find((r) => r.when(s))?.end(s) ?? null;

async function rounds(ctx) {
  const pre = { seed: await seeded(ctx), base: await baselined(ctx) };
  if (setupEnd(pre)) return ended(ctx, setupEnd(pre));
  const host = (await hostPhase(ctx)) ?? {};
  const ins = await inspectedPhase(ctx);
  return judgedEnding(ctx, { ...pre, host, ins, cand: await candidated(ctx, ins, pre.base) });
}

const credentialProblem = (ctx) => (scriptedHost(ctx) || ctx.credentialNames.some((n) => n !== "ANTHROPIC_BASE_URL") ? null : "CREDENTIALS: no credential for the coding host is set here, by name (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN; --credential=<NAME>) — nothing was run; `resume` goes on once one is");

const opened = (ctx) => (show(ctx).attempts?.length ? null : (ctx.rec.attemptStart(ctx.task, "fresh"), null));

async function fromHere(ctx) {
  const pending = docRead(ctx.room, "ending.json");
  if (pending) return ended(ctx, pending);
  if (!frozenIntact(ctx) || ctx.invalid) return ended(ctx, invalid(ctx.invalid?.says ?? "the frozen case or subject changed after the run began"));
  if (credentialProblem(ctx)) return ended(ctx, blocked("CREDENTIALS", "ENVIRONMENT_BLOCKED", credentialProblem(ctx)));
  return (opened(ctx), rounds(ctx));
}

const endedAlready = (ctx, view) => ((e) => ({ outcome: e?.outcome ?? view.lifecycle, exit: EXIT[e?.outcome] ?? 4, summary: HELD(view) ?? e?.summary ?? view.lifecycle }))(docRead(ctx.room, "ending.json"));

// What a run that stopped part-way left running: the host's round never settled -- its runner is stopped by the run's
// label -- and every phase still open is closed as interrupted.
function reconciled(ctx, view) {
  const open = (view.actions ?? []).filter((a) => a.state === "running");
  if (open.length) cleaned(ctx.run.id, ctx.deps);
  for (const a of open) ctx.rec.actFail(ctx.task, a.id, a.type === "benchmark.activation" ? "interrupted: the controller stopped before this round settled; what it left is read back, never sent again" : "interrupted: done again");
  if (view.lifecycle === "BLOCKED") unblocked(ctx);
}

function unblocked(ctx) {
  const was = docRead(ctx.room, "ending.json");
  if (was) docWritten(ctx.room, `endings/${String(was.at ?? Date.now()).replace(/[^0-9A-Za-z]/g, "")}.json`, was);
  ctx.room.io.removeFile(ctx.room.at("ending.json"));
  ctx.rec.unblock(ctx.task, "resumed: what blocked it is asked again");
}

function heldAfter(ctx, e) {
  const view = show(ctx);
  if (!HELD(view)) throw e;
  cleaned(ctx.run.id, ctx.deps);
  return endedAlready(ctx, view);
}

// From wherever the journal says the run stands, to its verdict -- or to where a person held it.
export async function carriedActivation(ctx) {
  const view = show(ctx);
  if (view.terminal || HELD(view)) return endedAlready(ctx, view);
  reconciled(ctx, view);
  return fromHere(ctx).catch((e) => heldAfter(ctx, e));
}

// The case's truth, from the run's FROZEN copy of the case -- and, for a case with hidden checks, its spec.
export const withActivation = async (ctx) => ((c) => (ctx.case.acceptance.spec ? withSpec(c) : c))({ ...ctx, truth: activationTruthOf(ctx.case) });
