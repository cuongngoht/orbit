// THE FLOW of one QA benchmark run, from what was frozen to its verdict. Where the run stands is read off its task's
// journal every time -- never kept beside it -- so a run interrupted anywhere is carried on from there: a phase that
// never settled is closed as interrupted; setting the application up and confirming on the clean one (they change
// nothing anyone measured) are done again; the host's round is never sent again -- what it left in the investigation is
// read back and judged.
//
//   attempt 1 (`fresh`)
//     ENVIRONMENT  benchmark.target    the application assembled with its variant planted, seated, its isolated
//                                      sandbox up, one investigation opened on it
//     TESTING      benchmark.qa        the host's round: a coding host through the relay, or a control's scripted host
//     REVIEWING    benchmark.readback  what the investigation came to, read off the engine's journal; the sandbox released
//     REGRESSION   benchmark.confirm   every contradiction's design run again on the clean application, in a sandbox
//                                      of its own -- the only way a contradiction becomes a defect found
//   ending       the judge's verdict: complete (PASS, FAIL, INCONCLUSIVE), or block (BLOCKED) when the environment,
//                the provider or a credential kept the round from being one
//
//   carriedQa(ctx) -> { outcome, exit, summary }        ctx.host: "coding-host" | a scripted host's name (HOSTS)
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { frozenIntact } from "../core/context.mjs";
import { cleaned } from "../core/docker.mjs";
import { hostEnd } from "../core/host.mjs";
import { docRead, docWritten } from "../core/room.mjs";
import { engineFor } from "./engine.mjs";
import { HOSTS, replayed } from "./hosts.mjs";
import { designOf, judgedQa, outcomesOf, toConfirm } from "./judge.mjs";
import { askOf, ranQaRound, serveOf } from "./round.mjs";

export const EXIT = { PASS: 0, FAIL: 1, BENCHMARK_INVALID: 2, BLOCKED: 3, INCONCLUSIVE: 4 };

// Minutes kept back from the host's round for what must follow it: reading it back and confirming on the clean app.
export const RESERVE_MINUTES = 30;

const show = (ctx) => ctx.rec.show(ctx.task);

const stepOf = (ctx, act) => (act ? docRead(ctx.room, `steps/${act.id}.json`) : null);

const settledOf = (view, type) => (view.actions ?? []).filter((a) => a.type === type && a.state !== "running" && a.state !== "error").at(-1) ?? null;

const triedOf = (view, type) => (view.actions ?? []).some((a) => a.type === type);

// ---- one recorded phase: started, its evidence kept under its own id, ended with its receipt ------------------------------

async function recorded(ctx, p) {
  const act = ctx.rec.actStart(ctx.task, p.type, p.label);
  const result = await p.body();
  docWritten(ctx.room, `steps/${act}.json`, result.doc);
  if (result.receipt) ctx.rec.receipt(ctx.task, { ...result.receipt, action: act });
  return (ctx.rec.actComplete(ctx.task, act, result.outcome ?? "succeeded", result.receipt ? `${result.receipt.domain}:${result.receipt.ref}` : undefined, result.summary), result.doc);
}

// A phase that settled is read back; one that did not -- or one that only says what blocked it -- is done again, under
// the stage it belongs to.
async function phase(ctx, p) {
  const was = stepOf(ctx, settledOf(show(ctx), p.type));
  if (was && was.state !== "BLOCKED") return was;
  ctx.rec.stage(ctx.task, p.stage, p.because);
  return recorded(ctx, p);
}

// ---- the application, set up on one variant ---------------------------------------------------------------------------

const targetDir = (ctx, variant) => ctx.room.at("targets", variant, ctx.case.target.stack);

// What a person reads about the application -- its accepted requirement, its contracts, its accepted plan -- and never
// its source: the coding host's /work/target.
const publicMade = (ctx, dir) => ["contracts", "ui-tests"].filter((d) => existsSync(join(dir, d))).forEach((d) => cpSync(join(dir, d), ctx.room.at("public", d), { recursive: true }));

// A variant's engine: Orbit's own, beside the controller -- or, in a test, the double a context is handed. One per
// variant for as long as this process runs: the tokens its sandbox was started with are the ones its tests carry.
const engineOf = (ctx, variant) => ((ctx.engines ??= {})[variant] ??= (ctx.engineFor ?? engineFor)(ctx, variant, targetDir(ctx, variant)));

// A variant's engine on a clean slate: whatever a run interrupted before left of it is released and removed first.
async function freshEngine(ctx, variant) {
  if (existsSync(targetDir(ctx, variant))) await (await engineOf(ctx, variant)).sandboxDown();
  rmSync(ctx.room.at("targets", variant), { recursive: true, force: true });
  delete ctx.engines?.[variant];
  return engineOf(ctx, variant);
}

async function setUp(ctx, variant) {
  const e = await freshEngine(ctx, variant);
  const commit = await e.assembled();
  const up = await (await e.seated()).sandboxUp();
  ctx.secretValues = [...(ctx.secretValues ?? []), ...e.secrets];
  return { e, commit, up, investigation: up.state === "READY" ? await e.opened(up.environment) : null };
}

const targetDoc = (s, variant) => ({ variant, commit: s.commit, task: s.e.task, state: s.up.state, because: s.up.because ?? null, environment: s.up.environment ?? null, investigation: s.investigation });

// A setup that did not come up leaves nothing running: what it started of the sandbox is released.
const releasedAfter = async (ctx, variant, s) => (existsSync(targetDir(ctx, variant)) && (await (await engineOf(ctx, variant)).sandboxDown()), s);

const triedSetUp = (ctx, variant) => setUp(ctx, variant).catch((err) => releasedAfter(ctx, variant, { failed: String(err?.message ?? err).slice(0, 600) }));

async function targetBody(ctx) {
  const s = await triedSetUp(ctx, ctx.case.target.variant);
  if (s.failed || !s.investigation) return { doc: { variant: ctx.case.target.variant, state: "BLOCKED", because: s.failed ?? (await releasedAfter(ctx, ctx.case.target.variant, s)).up.because }, outcome: "failed", summary: `the application could not be set up: ${String(s.failed ?? s.up.because).slice(0, 200)}` };
  publicMade(ctx, targetDir(ctx, ctx.case.target.variant));
  return { doc: targetDoc(s, ctx.case.target.variant), receipt: { domain: "investigation", ref: s.investigation, outcome: "OPENED", summary: `the investigation over ${ctx.case.target.stack} with its variant planted, on its own isolated sandbox` }, summary: `${s.investigation} open on sandbox ${s.up.environment}` };
}

// ---- the host's round -------------------------------------------------------------------------------------------------

const minutesLeft = (view) => Math.floor((view.budget?.minutes?.limit ?? 0) - (view.budget?.minutes?.spent ?? 0));

const roundMs = (ctx) => Math.max(1, Math.min(ctx.case.limits.runner.minutes, minutesLeft(show(ctx)) - RESERVE_MINUTES)) * 60000;

async function scriptedRound(ctx, e, serve, inv) {
  const h = { ask: askOf(serve), journal: () => e.journal(inv), designs: e.target.designs(ctx.engineDir), stack: ctx.case.target.stack, clock: e.target.clock(ctx.engineDir, ctx.case.target.stack), falseAlarm: e.target.falseAlarm?.shape ?? null };
  return { driver: ctx.host, ...(await HOSTS[ctx.host](h)) };
}

const codingRound = async (ctx, serve, inv) => ({ driver: "coding-host", ...(await ranQaRound(ctx, 1, { investigation: inv, serve, deadlineMs: roundMs(ctx) })) });

async function qaBody(ctx, inv) {
  const e = await engineOf(ctx, ctx.case.target.variant);
  const serve = serveOf(ctx, e, inv);
  const r = ctx.host === "coding-host" ? await codingRound(ctx, serve, inv) : await scriptedRound(ctx, e, serve, inv);
  return { doc: r, outcome: r.error ? "failed" : "succeeded", summary: roundSummary(r) };
}

const roundSummary = (r) => (r.error ? r.error.says : r.driver === "coding-host" ? `the coding host made ${r.host?.toolCalls ?? "an unknown number of"} tool call(s); the relay served ${r.relay?.served ?? 0} request(s)` : `the ${r.driver} host tested ${(r.tested ?? []).length} shape(s)`);

// What kept a coding host's round from being a round at all: the environment, its network, the provider -- never a
// host that stopped on its own budget, and never what the investigation came to.
export const roundErrorOf = (r) => r?.error ?? (r?.runner?.setup === "EGRESS" ? { cause: "ENVIRONMENT", says: r.runner.why } : null) ?? ((e) => (e && e.cause !== "BUDGET_EXHAUSTED" ? e : null))(r?.host?.started !== undefined ? hostEnd(r.host, { timedOut: r.container?.timedOut, exit: r.runner?.exit }) : null);

// ---- what the investigation came to, and the clean application asked about it ------------------------------------------

const engineCall = (ctx, e, argv) => e.cli("autonomous-qa.mjs", argv, { seconds: ctx.case.limits.engine.stepSeconds });

const toReplay = (lines, outcomes, cleanIsPlanted) => toConfirm(outcomes, cleanIsPlanted).map((x) => ({ ...x, design: designOf(lines, x.obligation, x.version) }));

// What the investigation came to: every dispatch that never settled read back, the investigation finished if its host
// did not, and its journal read -- then its sandbox released.
const readOf = (ctx, inv, lines) => ((outcomes) => ({ investigation: inv, lines: lines.length, outcomes, confirm: toReplay(lines, outcomes, cleanIsPlanted(ctx)) }))(outcomesOf(lines));

async function readbackBody(ctx, inv) {
  const e = await engineOf(ctx, ctx.case.target.variant);
  for (const argv of [["reconcile", `--investigation=${inv}`, "--json"], ["finish", `--investigation=${inv}`, "--why=the benchmark round ended"]]) await engineCall(ctx, e, argv);
  const doc = { ...readOf(ctx, inv, e.journal(inv)), released: await e.sandboxDown() };
  return { doc, summary: `${Object.keys(doc.outcomes).length} shape(s) tested, ${doc.confirm.length} contradiction(s) to confirm on the clean application` };
}

const cleanIsPlanted = (ctx) => ctx.case.target.variant === ctx.case.target.clean;

async function confirmedOn(ctx, s, designs) {
  const h = { ask: askOf(serveOf(ctx, s.e, s.investigation)), journal: () => s.e.journal(s.investigation) };
  const replay = await replayed(h, designs);
  const outcomes = outcomesOf(s.e.journal(s.investigation));
  return { investigation: s.investigation, outcomes, replay: replay.tested, released: await s.e.sandboxDown() };
}

async function confirmBody(ctx, designs) {
  const s = await triedSetUp(ctx, ctx.case.target.clean);
  if (s.failed || !s.investigation) return { doc: { state: "BLOCKED", because: s.failed ?? (await releasedAfter(ctx, ctx.case.target.clean, s)).up.because, outcomes: {} }, outcome: "failed", summary: "the clean application could not be set up to confirm on" };
  const doc = await confirmedOn(ctx, s, designs);
  return { doc, receipt: { domain: "investigation", ref: s.investigation, outcome: "CONFIRMATION", summary: "the contradictions' designs, run again on the clean application" }, summary: `${designs.length} design(s) replayed on the clean application` };
}

// ---- the ending -----------------------------------------------------------------------------------------------------------

const pct = (x) => `${Math.round(x * 100)}%`;

const ENDINGS = {
  BLOCKED: (j) => ({ ...blocked(`${j.why} (${j.blocked} test(s) blocked)`), judged: true }),
  PASS: (j) => ({ end: "complete", outcome: "PASS", summary: `PASS — ${j.why} · found ${j.found}/${j.planted} · false alarms ${j.falseAlarms} · coverage ${pct(j.coverage)}` }),
  FAIL: (j) => ({ end: "complete", outcome: "FAIL", summary: `FAIL — ${j.why} · found ${j.found}/${j.planted} · false alarms ${j.falseAlarms} · coverage ${pct(j.coverage)}` }),
  INCONCLUSIVE: (j) => ({ end: "complete", outcome: "INCONCLUSIVE", summary: `INCONCLUSIVE — ${j.why}` }),
};

const ENDERS = {
  complete: (ctx, e) => ctx.rec.complete(ctx.task, e.summary),
  fail: (ctx, e) => ctx.rec.fail(ctx.task, e.stop, e.summary),
  block: (ctx, e) => ctx.rec.block(ctx.task, e.stop, "environment", e.summary),
};

function ended(ctx, e) {
  docWritten(ctx.room, "ending.json", { ...e, at: new Date().toISOString() });
  ENDERS[e.end](ctx, e);
  return { outcome: e.outcome, exit: EXIT[e.outcome] ?? 4, summary: e.summary };
}

const blocked = (says) => ({ end: "block", stop: "ENVIRONMENT_BLOCKED", outcome: "BLOCKED", summary: `BLOCKED — ${says}` });

const STATE_OF = { DETECTED: "satisfied", MISSED: "violated", FALSE_ALARM: "violated" };

const rowState = (r) => STATE_OF[r.credit] ?? (r.credit === "TESTED" && r.got === r.expected ? "satisfied" : r.credit === "TESTED" ? "violated" : "not-verified");

function verificationRows(ctx, j, inv) {
  for (const r of j.rows) ctx.rec.verification(ctx.task, { subject: `qa.${r.shape}`, obligation: `the planted application's ${r.shape} comes to ${r.expected} (${r.credit.toLowerCase().replace("_", " ")}${r.clean ? `; clean ${r.clean}` : ""})`, state: rowState(r), ...(rowState(r) === "not-verified" ? {} : { evidence: `investigation:${inv}` }) });
}

function judgedEnding(ctx, rb, cf) {
  const j = judgedQa(ctx.truth, rb.outcomes, cf?.outcomes ?? {}, { minCoverage: ctx.case.acceptance.minCoverage, cleanIsPlanted: cleanIsPlanted(ctx) });
  docWritten(ctx.room, "judged.json", j);
  verificationRows(ctx, j, rb.investigation);
  if (show(ctx).attempt?.open) ctx.rec.attemptComplete(ctx.task, j.verdict === "PASS" ? "succeeded" : "failed");
  return ended(ctx, ENDINGS[j.verdict](j));
}

// ---- the whole run --------------------------------------------------------------------------------------------------------

const credentialProblem = (ctx) => (ctx.host !== "coding-host" || ctx.credentialNames.some((n) => n !== "ANTHROPIC_BASE_URL") ? null : "CREDENTIALS: no credential for the coding host is set here, by name (ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN; --credential=<NAME>) — nothing was set up; `resume` goes on once one is");

const opened = (ctx) => (show(ctx).attempts?.length ? null : (ctx.rec.attemptStart(ctx.task, "fresh"), null));

async function rounds(ctx) {
  const t = await phase(ctx, { type: "benchmark.target", stage: "ENVIRONMENT", because: "the application, its variant planted, on its own isolated sandbox", label: "the application set up, and one investigation opened", body: () => targetBody(ctx) });
  if (!t.investigation) return closedWith(ctx, blocked(`the application's sandbox did not come up: ${String(t.because).slice(0, 300)}`));
  const r = (await hostPhase(ctx, t.investigation)) ?? {};
  const rb = await phase(ctx, { type: "benchmark.readback", stage: "REVIEWING", because: "what the investigation came to, read off the engine's journal", label: "the investigation read back, its sandbox released", body: () => readbackBody(ctx, t.investigation) });
  return roundErrorOf(r) ? closedWith(ctx, blocked(roundErrorOf(r).says)) : confirmedEnding(ctx, rb);
}

// The host's round, once: a round that started and never settled is read back, never sent again.
const hostPhase = (ctx, inv) => (triedOf(show(ctx), "benchmark.qa") && !settledOf(show(ctx), "benchmark.qa") ? { interrupted: true } : phase(ctx, { type: "benchmark.qa", stage: "TESTING", because: "the host works the investigation, one decision at a time", label: `the ${ctx.host} on the investigation`, body: () => qaBody(ctx, inv) }));

async function confirmedEnding(ctx, rb) {
  const cf = rb.confirm.length ? await phase(ctx, { type: "benchmark.confirm", stage: "REGRESSION", because: "each contradiction's design, run again on the clean application", label: "the contradictions confirmed on the clean application", body: () => confirmBody(ctx, rb.confirm) }) : null;
  if (cf?.state === "BLOCKED") return closedWith(ctx, blocked(`the clean application could not be set up to confirm on: ${String(cf.because).slice(0, 300)}`));
  return judgedEnding(ctx, rb, cf);
}

// A run that ends before a verdict closes its attempt first: the door completes or blocks no task with one open.
function closedWith(ctx, e) {
  if (show(ctx).attempt?.open) ctx.rec.attemptComplete(ctx.task, "failed");
  return ended(ctx, e);
}

const HELD = (view) => (view.lifecycle === "PAUSED" ? "a person paused this run: it goes on once they resume it in Orbit Control" : view.lifecycle === "CANCELLED" ? "a person cancelled this run" : null);

const endedAlready = (ctx, view) => ((e) => ({ outcome: e?.outcome ?? view.lifecycle, exit: EXIT[e?.outcome] ?? 4, summary: HELD(view) ?? e?.summary ?? view.lifecycle }))(docRead(ctx.room, "ending.json"));

// What a run that stopped part-way left running: a host's round never settled -- its runner is stopped by the run's
// label -- and every phase still open is closed as interrupted.
function reconciled(ctx, view) {
  const open = (view.actions ?? []).filter((a) => a.state === "running");
  if (open.some((a) => a.type === "benchmark.qa")) cleaned(ctx.run.id, ctx.deps);
  for (const a of open) ctx.rec.actFail(ctx.task, a.id, a.type === "benchmark.qa" ? "interrupted: the controller stopped before this round settled; what it left is read back, never sent again" : "interrupted: done again");
  if (view.lifecycle === "BLOCKED") unblocked(ctx);
}

// A blocked run resumed: the ending that recorded the block is kept as history, no longer what the run waits to write.
function unblocked(ctx) {
  const was = docRead(ctx.room, "ending.json");
  if (was) docWritten(ctx.room, `endings/${String(was.at ?? Date.now()).replace(/[^0-9A-Za-z]/g, "")}.json`, was);
  rmSync(ctx.room.at("ending.json"), { force: true });
  ctx.rec.unblock(ctx.task, "resumed: what blocked it is asked again");
}

async function fromHere(ctx) {
  const pending = docRead(ctx.room, "ending.json");
  if (pending) return ended(ctx, pending);
  if (!frozenIntact(ctx)) return ended(ctx, { end: "fail", stop: "REQUIREMENT_BLOCKED", outcome: "BENCHMARK_INVALID", summary: "BENCHMARK_INVALID — the frozen case or subject changed after the run began" });
  if (credentialProblem(ctx)) return ended(ctx, blocked(credentialProblem(ctx)));
  return (opened(ctx), rounds(ctx));
}

function heldAfter(ctx, e) {
  const view = show(ctx);
  if (!HELD(view)) throw e;
  cleaned(ctx.run.id, ctx.deps);
  return endedAlready(ctx, view);
}

// A run that stopped part-way releases every sandbox it started: they are the engine's, labelled by its own runtime,
// so the run's label alone would never find them.
const releasedAll = (ctx) => Promise.all(Object.values(ctx.engines ?? {}).map(async (p) => (await p).sandboxDown()));

// From wherever the journal says the run stands, to its verdict -- or to where a person held it.
export async function carriedQa(ctx) {
  const view = show(ctx);
  if (view.terminal || HELD(view)) return endedAlready(ctx, view);
  reconciled(ctx, view);
  return fromHere(ctx).catch(async (e) => (await releasedAll(ctx), heldAfter(ctx, e)));
}

// The case's ground truth, from the run's FROZEN copy of the case.
export const withTruth = (ctx) => ({ ...ctx, truth: JSON.parse(readFileSync(join(ctx.frozenCase, ctx.case.acceptance.truth), "utf8")) });
