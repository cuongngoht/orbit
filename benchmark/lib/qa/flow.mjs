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
// The first three phases are one SESSION (0.5.0, ADR 0054): one investigation over the application, carried by one host
// round. A QA run is one session (`qaSession`); a sessions run (lib/sessions/flow.mjs) is a learning session over the
// same checkout and stores first, then this one -- its phases under the very types a QA run's are, so everything that
// reads a QA run's round reads a sessions run's measured one.
//
//   carriedQa(ctx) -> { outcome, exit, summary }        ctx.host: "coding-host" | a scripted host's name (HOSTS)
//   carriedBy(ctx, body, roundTypes) · sessionRan(ctx, s) -> { rb, r } | { blocked } · confirmedEnding(ctx, rb)
//   phase(ctx, p) · closedWith(ctx, e) · blocked(says) · engineOf(ctx, s) · show(ctx) · QA_TYPES · qaSession(ctx)
//   s = { key, variant, dir, task, fresh, round, of, host, types, env, runner, says, scripted?(ctx) }
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
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

export const show = (ctx) => ctx.rec.show(ctx.task);

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
export async function phase(ctx, p) {
  const was = stepOf(ctx, settledOf(show(ctx), p.type));
  if (was && was.state !== "BLOCKED") return was;
  ctx.rec.stage(ctx.task, p.stage, p.because);
  return recorded(ctx, p);
}

// ---- a session, and the QA run's one --------------------------------------------------------------------------------------

export const QA_TYPES = { target: "benchmark.target", qa: "benchmark.qa", readback: "benchmark.readback" };

// A session over one variant of the application in a checkout of its own -- the QA run's planted one, or the clean one a
// confirmation replays on -- assembled fresh, its engine's task named by the variant as it always was.
const ownSession = (ctx, variant, o) => ({ key: variant, variant, dir: ctx.room.at("targets", variant, ctx.case.target.stack), task: variant, fresh: true, round: 1, of: 1, host: ctx.host, types: QA_TYPES, env: {}, runner: null, says: "with its variant planted", ...o });

export const qaSession = (ctx) => ownSession(ctx, ctx.case.target.variant, {});

const cleanSession = (ctx) => ownSession(ctx, ctx.case.target.clean, { says: "with nothing planted" });

// What a person reads about the application -- its accepted requirement, its contracts, its accepted plan -- and never
// its source: the coding host's /work/target.
const publicMade = (ctx, dir) => ["contracts", "ui-tests"].filter((d) => existsSync(join(dir, d))).forEach((d) => cpSync(join(dir, d), ctx.room.at("public", d), { recursive: true }));

// A session's engine: Orbit's own, beside the controller -- or, in a test, the double a context is handed. One per
// session for as long as this process runs: the tokens its sandbox was started with are the ones its tests carry.
export const engineOf = (ctx, s) => ((ctx.engines ??= {})[s.key] ??= (ctx.engineFor ?? engineFor)(ctx, s.variant, s.dir, { task: s.task, env: s.env }));

// A session's engine on a clean slate: whatever a run interrupted before left of its sandbox is released first; a session
// that assembles its application afresh removes what an earlier try left of it, and one that works a kept checkout keeps
// it.
async function freshEngine(ctx, s) {
  if (existsSync(s.dir)) await (await engineOf(ctx, s)).sandboxDown();
  if (s.fresh) rmSync(dirname(s.dir), { recursive: true, force: true });
  delete ctx.engines?.[s.key];
  return engineOf(ctx, s);
}

async function setUp(ctx, s) {
  const e = await freshEngine(ctx, s);
  const commit = await (s.fresh ? e.assembled() : e.head());
  const up = await (s.fresh ? await e.seated() : e).sandboxUp();
  ctx.secretValues = [...(ctx.secretValues ?? []), ...e.secrets];
  return { e, commit, up, investigation: up.state === "READY" ? await e.opened(up.environment) : null };
}

const targetDoc = (st, variant) => ({ variant, commit: st.commit, task: st.e.task, state: st.up.state, because: st.up.because ?? null, environment: st.up.environment ?? null, investigation: st.investigation });

// A setup that did not come up leaves nothing running: what it started of the sandbox is released.
const releasedAfter = async (ctx, s, st) => (existsSync(s.dir) && (await (await engineOf(ctx, s)).sandboxDown()), st);

const triedSetUp = (ctx, s) => setUp(ctx, s).catch((err) => releasedAfter(ctx, s, { failed: String(err?.message ?? err).slice(0, 600) }));

async function targetBody(ctx, s) {
  const st = await triedSetUp(ctx, s);
  if (st.failed || !st.investigation) return { doc: { variant: s.variant, state: "BLOCKED", because: st.failed ?? (await releasedAfter(ctx, s, st)).up.because }, outcome: "failed", summary: `the application could not be set up: ${String(st.failed ?? st.up.because).slice(0, 200)}` };
  publicMade(ctx, s.dir);
  return { doc: targetDoc(st, s.variant), receipt: { domain: "investigation", ref: st.investigation, outcome: "OPENED", summary: `the investigation over ${ctx.case.target.stack} ${s.says}, on its own isolated sandbox` }, summary: `${st.investigation} open on sandbox ${st.up.environment}` };
}

// ---- the host's round -------------------------------------------------------------------------------------------------

const minutesLeft = (view) => Math.floor((view.budget?.minutes?.limit ?? 0) - (view.budget?.minutes?.spent ?? 0));

// A round's time: the runner's own bound, within what is left once every session still to come and what follows them
// have their share.
const roundMs = (ctx, s) => ((left) => Math.max(1, Math.min(ctx.case.limits.runner.minutes, Math.floor((minutesLeft(show(ctx)) - RESERVE_MINUTES * left) / left))) * 60000)(s.of - s.round + 1);

async function scriptedRound(ctx, s, e, serve, inv) {
  const h = { ask: askOf(serve), journal: () => e.journal(inv), designs: e.target.designs(ctx.engineDir), stack: ctx.case.target.stack, clock: e.target.clock(ctx.engineDir, ctx.case.target.stack), falseAlarm: e.target.falseAlarm?.shape ?? null, ...((await s.scripted?.(ctx)) ?? {}) };
  return { driver: s.host, ...(await HOSTS[s.host](h)) };
}

const codingRound = async (ctx, s, serve, inv) => ({ driver: "coding-host", ...(await ranQaRound(ctx, s.round, { investigation: inv, serve, deadlineMs: roundMs(ctx, s), ...(s.of > 1 ? { session: { round: s.round, of: s.of, runner: s.runner } } : {}) })) });

async function qaBody(ctx, s, inv) {
  const e = await engineOf(ctx, s);
  const serve = serveOf(ctx, e, inv);
  const r = s.host === "coding-host" ? await codingRound(ctx, s, serve, inv) : await scriptedRound(ctx, s, e, serve, inv);
  return { doc: r, outcome: r.error ? "failed" : "succeeded", summary: roundSummary(r) };
}

const roundSummary = (r) => (r.error ? r.error.says : r.driver === "coding-host" ? `the coding host made ${r.host?.toolCalls ?? "an unknown number of"} tool call(s); the relay served ${r.relay?.served ?? 0} request(s)` : `the ${r.driver} host tested ${(r.tested ?? []).length} shape(s)`);

// What kept a coding host's round from being a round at all: the environment, its network, the provider -- never a
// host that stopped on its own budget, and never what the investigation came to.
export const roundErrorOf = (r) => r?.error ?? (r?.runner?.setup === "EGRESS" ? { cause: "ENVIRONMENT", says: r.runner.why } : null) ?? ((e) => (e && e.cause !== "BUDGET_EXHAUSTED" ? e : null))(r?.host?.started !== undefined ? hostEnd(r.host, { timedOut: r.container?.timedOut, exit: r.runner?.exit }) : null);

// ---- what the investigation came to, and the clean application asked about it ------------------------------------------

const engineCall = (ctx, e, argv) => e.cli("autonomous-qa.mjs", argv, { seconds: ctx.case.limits.engine.stepSeconds });

const toReplay = (lines, outcomes, cleanIsPlanted) => toConfirm(outcomes, cleanIsPlanted).map((x) => ({ ...x, design: designOf(lines, x.obligation, x.version) }));

const of = (lines, kind) => lines.filter((l) => l.kind === kind);

// What the host's work came to in the engine's own journal (0.5.0): the decisions the engine took down, the designs it
// judged and the ones it refused, and the steps it refused or blocked -- counts, never what a decision said.
export const workOf = (lines) => ({ decisions: of(lines, "decision").length, designs: of(lines, "designed").length, designsRefused: of(lines, "designed").filter((d) => d.state === "failed").length, stepsRefused: of(lines, "settled").filter((x) => x.state === "refused" || x.state === "blocked").length, versions: of(lines, "version").length });

// What the investigation came to: every dispatch that never settled read back, the investigation finished if its host
// did not, and its journal read -- then its sandbox released.
const readOf = (ctx, inv, lines) => ((outcomes) => ({ investigation: inv, lines: lines.length, outcomes, confirm: toReplay(lines, outcomes, cleanIsPlanted(ctx)), work: workOf(lines) }))(outcomesOf(lines));

async function readbackBody(ctx, s, inv) {
  const e = await engineOf(ctx, s);
  for (const argv of [["reconcile", `--investigation=${inv}`, "--json"], ["finish", `--investigation=${inv}`, "--why=the benchmark round ended"]]) await engineCall(ctx, e, argv);
  const doc = { ...readOf(ctx, inv, e.journal(inv)), released: await e.sandboxDown() };
  return { doc, summary: `${Object.keys(doc.outcomes).length} shape(s) tested, ${doc.confirm.length} contradiction(s) to confirm on the clean application` };
}

const cleanIsPlanted = (ctx) => ctx.case.target.variant === ctx.case.target.clean;

async function confirmedOn(ctx, st, designs) {
  const h = { ask: askOf(serveOf(ctx, st.e, st.investigation)), journal: () => st.e.journal(st.investigation) };
  const replay = await replayed(h, designs);
  const outcomes = outcomesOf(st.e.journal(st.investigation));
  return { investigation: st.investigation, outcomes, replay: replay.tested, released: await st.e.sandboxDown() };
}

async function confirmBody(ctx, designs) {
  const st = await triedSetUp(ctx, cleanSession(ctx));
  if (st.failed || !st.investigation) return { doc: { state: "BLOCKED", because: st.failed ?? (await releasedAfter(ctx, cleanSession(ctx), st)).up.because, outcomes: {} }, outcome: "failed", summary: "the clean application could not be set up to confirm on" };
  const doc = await confirmedOn(ctx, st, designs);
  return { doc, receipt: { domain: "investigation", ref: st.investigation, outcome: "CONFIRMATION", summary: "the contradictions' designs, run again on the clean application" }, summary: `${designs.length} design(s) replayed on the clean application` };
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

export const blocked = (says) => ({ end: "block", stop: "ENVIRONMENT_BLOCKED", outcome: "BLOCKED", summary: `BLOCKED — ${says}` });

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

// The host's round, once: a round that started and never settled is read back, never sent again.
const hostPhase = (ctx, s, inv) => (triedOf(show(ctx), s.types.qa) && !settledOf(show(ctx), s.types.qa) ? { interrupted: true } : phase(ctx, { type: s.types.qa, stage: "TESTING", because: "the host works the investigation, one decision at a time", label: `the ${s.host} on the investigation`, body: () => qaBody(ctx, s, inv) }));

// One session's three phases: its application up with one investigation open, the host's round, what it came to read
// back -- or why it could not be one: its application never came up, or the round was kept from being one.
export async function sessionRan(ctx, s) {
  const t = await phase(ctx, { type: s.types.target, stage: "ENVIRONMENT", because: `the application ${s.says}, on its own isolated sandbox`, label: "the application set up, and one investigation opened", body: () => targetBody(ctx, s) });
  if (!t.investigation) return { blocked: `the application's sandbox did not come up: ${String(t.because).slice(0, 300)}` };
  const r = (await hostPhase(ctx, s, t.investigation)) ?? {};
  const rb = await phase(ctx, { type: s.types.readback, stage: "REVIEWING", because: "what the investigation came to, read off the engine's journal", label: "the investigation read back, its sandbox released", body: () => readbackBody(ctx, s, t.investigation) });
  return roundErrorOf(r) ? { blocked: roundErrorOf(r).says, rb } : { rb, r };
}

async function rounds(ctx) {
  const m = await sessionRan(ctx, qaSession(ctx));
  return m.blocked ? closedWith(ctx, blocked(m.blocked)) : confirmedEnding(ctx, m.rb);
}

export async function confirmedEnding(ctx, rb) {
  const cf = rb.confirm.length ? await phase(ctx, { type: "benchmark.confirm", stage: "REGRESSION", because: "each contradiction's design, run again on the clean application", label: "the contradictions confirmed on the clean application", body: () => confirmBody(ctx, rb.confirm) }) : null;
  if (cf?.state === "BLOCKED") return closedWith(ctx, blocked(`the clean application could not be set up to confirm on: ${String(cf.because).slice(0, 300)}`));
  return judgedEnding(ctx, rb, cf);
}

// A run that ends before a verdict closes its attempt first: the door completes or blocks no task with one open.
export function closedWith(ctx, e) {
  if (show(ctx).attempt?.open) ctx.rec.attemptComplete(ctx.task, "failed");
  return ended(ctx, e);
}

const HELD = (view) => (view.lifecycle === "PAUSED" ? "a person paused this run: it goes on once they resume it in Orbit Control" : view.lifecycle === "CANCELLED" ? "a person cancelled this run" : null);

const endedAlready = (ctx, view) => ((e) => ({ outcome: e?.outcome ?? view.lifecycle, exit: EXIT[e?.outcome] ?? 4, summary: HELD(view) ?? e?.summary ?? view.lifecycle }))(docRead(ctx.room, "ending.json"));

// What a run that stopped part-way left running: a host's round never settled -- its runner is stopped by the run's
// label -- and every phase still open is closed as interrupted.
function reconciled(ctx, view, roundTypes) {
  const open = (view.actions ?? []).filter((a) => a.state === "running");
  if (open.some((a) => roundTypes.includes(a.type))) cleaned(ctx.run.id, ctx.deps);
  for (const a of open) ctx.rec.actFail(ctx.task, a.id, roundTypes.includes(a.type) ? "interrupted: the controller stopped before this round settled; what it left is read back, never sent again" : "interrupted: done again");
  if (view.lifecycle === "BLOCKED") unblocked(ctx);
}

// A blocked run resumed: the ending that recorded the block is kept as history, no longer what the run waits to write.
function unblocked(ctx) {
  const was = docRead(ctx.room, "ending.json");
  if (was) docWritten(ctx.room, `endings/${String(was.at ?? Date.now()).replace(/[^0-9A-Za-z]/g, "")}.json`, was);
  rmSync(ctx.room.at("ending.json"), { force: true });
  ctx.rec.unblock(ctx.task, "resumed: what blocked it is asked again");
}

async function fromHere(ctx, body) {
  const pending = docRead(ctx.room, "ending.json");
  if (pending) return ended(ctx, pending);
  if (!frozenIntact(ctx)) return ended(ctx, { end: "fail", stop: "REQUIREMENT_BLOCKED", outcome: "BENCHMARK_INVALID", summary: "BENCHMARK_INVALID — the frozen case or subject changed after the run began" });
  if (credentialProblem(ctx)) return ended(ctx, { ...blocked(credentialProblem(ctx)), cause: "CREDENTIALS", class: "ENVIRONMENT_BLOCKED" });
  return (opened(ctx), body(ctx));
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

// From wherever the journal says the run stands, to its verdict -- or to where a person held it -- through `body`, the
// phases a kind of run is made of; `roundTypes` are the phases a host's round runs under, never sent again.
export async function carriedBy(ctx, body, roundTypes) {
  const view = show(ctx);
  if (view.terminal || HELD(view)) return endedAlready(ctx, view);
  reconciled(ctx, view, roundTypes);
  return fromHere(ctx, body).catch(async (e) => (await releasedAll(ctx), heldAfter(ctx, e)));
}

export const carriedQa = (ctx) => carriedBy(ctx, rounds, [QA_TYPES.qa]);

// The case's ground truth, from the run's FROZEN copy of the case.
export const withTruth = (ctx) => ({ ...ctx, truth: JSON.parse(readFileSync(join(ctx.frozenCase, ctx.case.acceptance.truth), "utf8")) });
