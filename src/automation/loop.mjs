// THE COORDINATOR'S LOOP, the engine's half. The host's model chooses which ready step to run; this keeps
// the state that makes each choice checkable and each step safe -- all of it in the coordinator's own task.
//
//   start      classify the objective, plan its workflow, create the coordinator's task, write the plan
//              artifact BEFORE the receipt that names it, open the first attempt
//   context    where the workflow stands and what may come next: the plan, each step's state read off the
//              journal, the child task, what to run next and how. Writes NOTHING
//   step       one decision: judged, recorded BEFORE anything runs (the decision, the stage, the action,
//              the step's RUNNING receipt), then an engine step runs through its owner's port and settles
//              here, and a host step answers how the host runs it
//   settle     what a host-run step came to: the owner's evidence read back, then recorded -- never the
//              host's word alone
//   reconcile  a step whose process or host is gone: read back from its owner, or closed as interrupted --
//              never run again by itself
//   finish     complete when every step is done; otherwise end with a stop the journal supports
//   resume     the running coordinator for a task id, a requirement or the same objective
//
// After every settle the ENGINE decides what the evidence moves: a failed step is planned again (a new
// plan artifact, a new attempt) while its kind has retries and the budget allows, then the workflow fails;
// three failures with one signature are NO_PROGRESS; every step done completes it. Since 1.8.6 the plan is a
// graph and it is also REVISED on new evidence (replan.mjs TRIGGERS): a playbook step nothing provides gets its
// draft and register steps when a person lets the skill factory close the gap, a requirement that moved has the
// steps built on it planned again, and a QA step goes in once discovery finds something to start -- each a new
// plan artifact naming why, within the revisions a person allows.
//
// Two locks, never nested: the task's own (its write door, per operation) and the coordinator's
// (`ports.lock`), held to judge-and-record and to settle -- never across anything a step runs.
import { Refused } from "../errors.mjs";
import { canonicalJson, short } from "../hash.mjs";
import { scrub } from "../scrub.mjs";
import { againOf, judgeFresh, judgeForm, judgeOutcomeForm, judgeSettle, protocolRules } from "./decision.mjs";
import { BEFORE_HOST, ENGINE, childOf, howOf } from "./dispatch.mjs";
import { verifyOf } from "./evidence.mjs";
import { factsOf, generates, missingOf } from "./intelligence.mjs";
import { interruptedOps, settledOf } from "./outcome.mjs";
import { DEPENDS } from "./graph.mjs";
import { allDone, digestOf, planOf, readyOf, replanOf, stateOf, validate } from "./plan.mjs";
import { classOf, verdictOf } from "./policy.mjs";
import { RESPONSE_IDS, TRIGGERS, respond, structuralOf } from "./replan.mjs";
import { selectionOf } from "./select.mjs";
import { narrowedBudget } from "./settings.mjs";
import { kindOf, STEP_KINDS } from "./steps.mjs";
import { STOP_EVIDENCE, stopOf } from "./stop.mjs";
import { ACTION_TYPE, CAUSE, DECISION_FIELDS, DECISION_SCHEMA, DOMAIN, FORBIDDEN, LIFE, NEEDS, OUTCOME_FIELDS, PLAN_SCHEMA, PROVIDER, STALE_AFTER_MS, STEP_WORD, STOP } from "./vocab.mjs";

const clip = (text) => String(text ?? "").slice(0, 240) || undefined;

// ---- the world one look sees ------------------------------------------------------------------------

const activePlanRef = (view) => view.receipts.filter((r) => r.domain === DOMAIN.PLAN && r.outcome === "ACTIVE").at(-1)?.ref ?? null;

const planIn = (ports, id, view) => ((ref) => (ref ? ports.roomOf(id).read(`plans/${ref}`) : null))(activePlanRef(view));

const openOf = (view) => view.actions.filter((a) => a.state === "running");

// ports: task · settings · classify · resolve · gapOf · requirements · runtime · context · child ·
// investigations · factory · host · roomOf · lock · liveness · session · now · pid (cli/automation.mjs)
export function loopWorld(ports, id) {
  const view = ports.task.view(id);
  const plan = planIn(ports, id, view);
  const base = { id, view, events: ports.task.events(id), plan, states: plan ? stateOf(plan, view) : [], open: openOf(view), now: ports.now(), values: ports.settings().values };
  return { ...base, ref: view.task.root ?? null };
}

// ---- how to watch it ---------------------------------------------------------------------------------

// What the host tells the PERSON. The task's journal is kept whether anybody watches or not, and a viewer only
// reads it. Since 1.8.5 /orbit-help (and since 0.0.1 /orbit) opens this session's viewer by itself (`live ensure`, ADR 0020) where a person
// left that on; this says how to bring it to this task, and the one look for a host that cannot open a pane. A
// full-screen viewer needs a terminal of its own, never the one the host's agent runs in.
const TUI = (id) => `node <engine>/cli/live.mjs ensure ${id} (this session's full-screen viewer, opened beside it or told to show this task; it stays until the person leaves it)`;

const WATCH = {
  off: () => null,
  compact: (id) => `node <engine>/cli/live.mjs status ${id}`,
  full: (id) => TUI(id),
  auto: (id, host) => (host.statusLine ? `the status line shows it (Orbit Live); full screen: ${TUI(id)}` : `Orbit Live: ${TUI(id)}, or node <engine>/cli/live.mjs status ${id} for one look`),
};

const watchOf = (lw, host) => (lw.values.live.autoAttach ? WATCH[lw.values.live.display](lw.id, host) : null);

// ---- context -----------------------------------------------------------------------------------------

const stopView = (lw) => ((s) => (s ? { id: s.id, say: s.say(lw) } : null))(stopOf(lw));

// What a step must PROVE to count, read off its kind -- never stored twice: the obligation its owner's record
// must hold, the evidence it accepts, and whether a host's report alone can never settle it.
const verificationOf = (kind) => ((k) => ({ obligation: k.obligation, evidence: k.domains, strict: k.strict }))(kindOf(kind));

const stepView = (s) => ({ id: s.id, kind: s.kind, provides: s.provides, after: s.after, ...(s.for ? { for: s.for } : {}), because: s.because ?? kindOf(s.kind).goal, state: s.state, action: s.action, summary: s.summary, verification: verificationOf(s.kind) });

const planView = (lw) => ({ ref: `plan:${lw.plan.digest}`, schema: lw.plan.schema, n: lw.plan.n, workflow: lw.plan.workflow, retries: lw.plan.retries, limit: lw.plan.limit ?? null, revisedOnEvidence: structuralOf(lw.plan), replans: lw.plan.replans ?? [], steps: lw.states.map(stepView) });

const childView = (ports, lw) => ((id) => (id ? ((v) => (v ? { task: id, lifecycle: v.lifecycle, stage: v.stage, attempt: `${v.attempt.number ?? 0}/${v.attempt.limit ?? "?"}`, changes: v.changes.files, stop: v.stopReason } : { task: id, lifecycle: "UNREADABLE" }))(quietly(() => ports.child.view(id))) : null))(childOf(lw.view));

const quietly = (fn) => {
  try { return fn(); }
  catch { return null; }
};

// What the host would be told for the first ready step, without recording anything.
function nextOf(ports, lw) {
  const s = readyOf(lw.states)[0];
  if (!s || stopOf(lw)) return null;
  const sel = selected(ports, lw, s);
  return { step: s.id, goal: kindOf(s.kind).goal, ...(sel.blocked ? { blocked: sel.blocked } : { mode: sel.dispatch.mode, provider: sel.dispatch.provider }), decide: `step ${lw.id} with { "schemaVersion": ${DECISION_SCHEMA}, "decisionId": "<yours>", "expectedRevision": ${lw.view.revision}, "action": { "kind": "run", "step": "${s.id}" }, "observed": "…", "hypothesis": "…" }` };
}

const sayNext = (lw, next) => (stopOf(lw) ? stopOf(lw).say(lw) : lw.open.length ? `settle ${lw.open[0].label ?? lw.open[0].id} with its evidence, or reconcile it` : next ? `next: ${next.step} — ${next.goal}` : allDone(lw.states) ? "every step is done — finish completes the workflow" : "nothing is ready");

export function contextOf(ports, id) {
  const lw = loopWorld(ports, id);
  const next = nextOf(ports, lw);
  return { task: { id, objective: lw.view.task.objective, root: lw.view.task.root, provider: lw.view.task.provider }, revision: lw.view.revision, lifecycle: lw.view.lifecycle, stage: lw.view.stage, attempt: lw.view.attempt, budget: lw.view.budget, repeats: lw.view.repeats, plan: lw.plan ? planView(lw) : null, ready: readyOf(lw.states).map((s) => s.id), open: lw.open.map((a) => ({ id: a.id, type: a.type, tool: a.tool, label: a.label, startedAt: a.startedAt })), child: childView(ports, lw), approvals: lw.view.approvals.filter((a) => a.open), blocked: lw.view.blocked, stop: stopView(lw), next, say: sayNext(lw, next), watch: watchOf(lw, ports.host), protocol: { schemaVersion: DECISION_SCHEMA } };
}

// ---- applying task operations ------------------------------------------------------------------------

function applied(ports, id, ops) {
  for (const [op, given] of ops) ports.task.apply(id, op, given);
}

// ---- choosing who runs a step ------------------------------------------------------------------------

// The resolver is asked only for a step a host runs: an engine step's provider is the engine.
const resolvedFor = (ports, step, kind, facts) => (step.provides && !kind.engine(facts) ? quietly(() => ports.resolve(step.provides)) : null);

const liveFacts = (ports, lw, kind) => (kind.id === "requirement" && lw.ref ? { requirement: { ready: ((l) => Boolean(l?.latest) && l.blocking === 0)(quietly(() => ports.requirements.look(lw.ref))) } } : {});

function selected(ports, lw, step) {
  const kind = kindOf(step.kind);
  const facts = liveFacts(ports, lw, kind);
  return selectionOf(step, kind, resolvedFor(ports, step, kind, facts), ports.host, facts);
}

// ---- the person's gate ------------------------------------------------------------------------------

// What a person is asked to allow is exactly the action that will start: its type, its tool, and the step,
// provider and class in its parameters -- so the grant's fingerprint is the action's, and nothing else. The step is
// named by its ID (1.8.6): a plan may hold two steps of one kind -- a draft for each of two capabilities -- and a
// grant, a rejection or an open request for one must never stand for the other. A plan whose ids are its kinds
// (every plan before 1.8.6) fingerprints exactly as it did.
const gateOf = (lw, step, kind, dispatch, verdict) => (verdict === "approval" ? { type: TYPE_OF[dispatch.mode], tool: toolSlug(dispatch.provider.id), environment: "local", params: { step: step.id, provider: dispatch.provider.key, class: classFor(kind, { dispatch }) } } : null);

const approvalsOf = (lw) => {
  const asked = new Map(lw.events.filter((e) => e.kind === "approval-requested").map((e) => [e.id, e.fingerprint]));
  const rows = lw.view.approvals.map((a) => ({ ...a, fingerprint: asked.get(a.id) }));
  return { byId: new Map(rows.map((a) => [a.id, a])), rejected: new Set(rows.filter((a) => a.state === "rejected").map((a) => a.fingerprint)), open: new Map(rows.filter((a) => ["pending", "granted"].includes(a.state)).map((a) => [a.fingerprint, a.id])) };
};

// ---- step: judged and recorded -----------------------------------------------------------------------

const decisionOf = (d) => ({ observed: d.observed, hypothesis: d.hypothesis, nextAction: `step.${d.action.step}`, evidence: d.evidence, reason: d.reason, ref: d.decisionId });

const TYPE_OF = { engine: ACTION_TYPE.ENGINE, skill: ACTION_TYPE.SKILL, agent: ACTION_TYPE.AGENT, playbook: ACTION_TYPE.SKILL };

const actOf = (step, kind, dispatch, d, gate) => ({ type: TYPE_OF[dispatch.mode], tool: toolSlug(dispatch.provider.id), label: clip(`${step.id}: ${kind.goal}`), approval: d.approval, environment: gate?.environment, params: gate?.params });

const toolSlug = (id) => String(id).toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^[^a-z]+/, "").slice(0, 64) || undefined;

const stageOps = (lw, kind) => (kind.stage && kind.stage !== lw.view.stage ? [["stage", { stage: kind.stage, because: `step ${kind.id}` }]] : []);

const unblockOps = (lw) => (lw.view.lifecycle === LIFE.BLOCKED ? [["unblock", { because: "the blocked step runs again" }]] : []);

// A step the engine reads back itself (a snapshot that is already frozen) dispatches no skill: it is reading.
const classFor = (kind, sel) => (sel.dispatch?.mode === "engine" && kind.class === "dispatch-skill" ? "read-context" : kind.class);

function judgedStep(ports, lw, d) {
  const step = lw.plan?.steps.find((s) => s.id === d.action.step) ?? null;
  const sel = step ? selected(ports, lw, step) : { blocked: null };
  const kind = step ? kindOf(step.kind) : null;
  const verdict = kind ? verdictOf(lw.values, classFor(kind, sel), sel.verdict ?? "allow") : "allow";
  return { step, kind, sel, verdict, gate: sel.dispatch ? gateOf(lw, step, kind, sel.dispatch, verdict) : null };
}

function freshlyJudged(ports, lw, d, j) {
  const fp = j.gate ? ports.task.fingerprint(j.gate) : null;
  judgeFresh(d, { lw, step: j.step, ready: readyOf(lw.states), state: lw.states.find((s) => s.id === d.action.step)?.state ?? null, verdict: j.verdict, kindClass: j.kind ? classFor(j.kind, j.sel) : null, gate: j.gate, fp, approvals: approvalsOf(lw) });
}

function asked(ports, lw, d, j) {
  applied(ports, lw.id, [["decide", decisionOf(d)]]);
  const done = ports.task.apply(lw.id, "request-approval", { ...j.gate, reason: clip(`${j.step.id}: ${j.kind.goal}`), risk: clip(`${classOf(j.kind.class).say} — ${j.sel.dispatch.provider.id}`) });
  return { done: { task: lw.id, state: "waiting-approval", approval: done.lines[0].id, say: `${done.lines[0].id} asks a person to allow ${j.step.id} once, in Orbit Control (Mission Control → Approvals); then send the same step with "approval": "${done.lines[0].id}" and a new decisionId` } };
}

function blockedStep(ports, lw, d, j, answer = {}) {
  applied(ports, lw.id, [["decide", decisionOf(d)], ["link-receipt", { domain: DOMAIN.STEP, ref: j.step.id, outcome: STEP_WORD.BLOCKED, summary: clip(j.sel.blocked.because) }], ...(lw.view.lifecycle === LIFE.BLOCKED ? [] : [["block", { stop: j.sel.blocked.needs === "requirement" ? STOP.REQUIREMENT_BLOCKED : STOP.ENVIRONMENT_BLOCKED, needs: j.sel.blocked.needs, because: clip(`step ${j.step.id}: ${j.sel.blocked.because}`) }]])]);
  return { done: { task: lw.id, state: "blocked", step: j.step.id, needs: j.sel.blocked.needs, trigger: answer.trigger ?? null, say: j.sel.blocked.because, ...(answer.cause ? { replan: answer.because } : {}) } };
}

// A step whose provider cannot be selected: blocked as before -- unless the evidence says to REVISE the plan
// around it first (a playbook step nothing provides, its gap one a person lets the skill factory close).
function blockedOrRevised(ports, lw, d, j) {
  const answer = respondTo(ports, lw, { at: "blocked", step: j.step, needs: j.sel.blocked.needs });
  return answer.revision ? generationInserted(ports, lw, d, j, answer) : blockedStep(ports, lw, d, j, answer);
}

// The decision is kept, the workflow unblocked if it was, and the revision written: the step that could not run
// waits, PENDING, for the draft and register steps now planned before it.
function generationInserted(ports, lw, d, j, answer) {
  applied(ports, lw.id, [...unblockOps(lw), ["decide", decisionOf(d)]]);
  revised(ports, lw, answer);
  return { done: { task: lw.id, state: "replanned", step: j.step.id, trigger: answer.trigger, plan: `plan-${answer.revision.n}`, say: answer.because, context: contextOf(ports, lw.id) } };
}

const runningOf = (ports, act, step, mode) => ({ action: act.id, step: step.id, mode, host: ports.hostName, pid: ports.pid, session: ports.session ?? null, at: act.at });

function started(ports, lw, d, j) {
  applied(ports, lw.id, [...unblockOps(lw), ["decide", decisionOf(d)], ...stageOps(lw, j.kind)]);
  const act = ports.task.apply(lw.id, "act-start", actOf(j.step, j.kind, j.sel.dispatch, d, j.gate)).lines.find((l) => l.kind === "action-started");
  applied(ports, lw.id, [["link-receipt", { domain: DOMAIN.STEP, ref: j.step.id, outcome: STEP_WORD.RUNNING, action: act.id, summary: clip(`${j.sel.dispatch.mode} ${j.sel.dispatch.provider.id}${j.sel.dispatch.note ? ` (${j.sel.dispatch.note})` : ""}`) }]]);
  ports.roomOf(lw.id).write("running", runningOf(ports, act, j.step, j.sel.dispatch.mode));
  return { lw, d, step: j.step, kind: j.kind, dispatch: j.sel.dispatch, act: act.id };
}

// A stop the evidence says to WRITE is written instead of anything the decision asked for.
function halted(ports, lw) {
  const stop = stopOf(lw);
  if (!stop?.writes) return null;
  ports.task.apply(lw.id, ...stop.writes(lw));
  return { done: { task: lw.id, state: "stopped", stop: stop.id, say: stop.say(lw) } };
}

// The same decision delivered again: answered from the journal, never run twice.
function replayed(ports, lw, d) {
  const prior = lw.view.decisions.find((x) => x.ref === d.decisionId);
  return prior ? replayOf(ports, lw, d, prior) : null;
}

function replayOf(ports, lw, d, prior) {
  const st = lw.states.find((s) => s.id === d.action.step);
  const row = againOf(prior, d, { open: st?.state === "running", mode: quietly(() => ports.roomOf(lw.id).read("running"))?.mode ?? null });
  if (row.id !== "REPLAY") throw Object.assign(new Refused(`${row.id}: ${row.say(prior)}`), { code: row.id });
  return { done: { task: lw.id, state: "replayed", step: d.action.step, stepState: st?.state ?? null, say: row.say(prior), context: contextOf(ports, lw.id) } };
}

function takenDown(ports, id, d) {
  const lw = loopWorld(ports, id);
  const again = replayed(ports, lw, d) ?? halted(ports, lw);
  if (again) return again;
  const j = judgedStep(ports, lw, d);
  return recorded(ports, lw, d, j);
}

function recorded(ports, lw, d, j) {
  freshlyJudged(ports, lw, d, j);
  if (j.sel.blocked) return blockedOrRevised(ports, lw, d, j);
  if (j.gate && !d.approval) return asked(ports, lw, d, j);
  return started(ports, lw, d, j);
}

// ---- step: run -----------------------------------------------------------------------------------

async function ran(ports, fn) {
  try { return await fn(); }
  catch (e) { return { verdict: "violated", receipt: null, because: clip(scrub(e.message)), error: true }; }
}

const engineRun = (ports, taken) => ran(ports, () => ENGINE[taken.kind.id](ports, { ...loopWorld(ports, taken.lw.id), plan: taken.lw.plan }, taken.step));

const budgetOf = (lw) => ({ minutes: lw.view.budget.minutes.limit ?? undefined });

async function hostHanded(ports, taken) {
  const before = BEFORE_HOST[taken.kind.id];
  const r = before ? await ran(ports, () => before(ports, taken.lw, budgetOf(taken.lw), taken.step)) : { receipts: [] };
  return ports.lock(taken.lw.id, () => handed(ports, taken, r));
}

function handed(ports, taken, r) {
  if (r.error) return settleEngine(ports, taken, r);
  applied(ports, taken.lw.id, r.receipts.map((x) => ["link-receipt", { ...x, action: taken.act }]));
  const lw = loopWorld(ports, taken.lw.id);
  return { task: lw.id, decision: lw.view.decision.id, action: taken.act, step: taken.step.id, mode: taken.dispatch.mode, how: howOf(ports, lw, taken.step, taken.kind, taken.dispatch, lw.values, { shape: r.shape }), revision: lw.view.revision, lifecycle: lw.view.lifecycle, stage: lw.view.stage, watch: watchOf(lw, ports.host) };
}

// ---- settling, for an engine step and a host step alike -------------------------------------------------

function settleEngine(ports, taken, read) {
  ports.roomOf(taken.lw.id).remove("running");
  const lw = loopWorld(ports, taken.lw.id);
  applied(ports, lw.id, settledOf({ step: taken.step, kind: taken.kind, act: taken.act, read: read.verdict === "unreadable" && taken.kind.strict ? { ...read, verdict: "violated" } : read }).ops);
  return concluded(ports, lw.id, taken.step);
}

export async function step(ports, id, d) {
  judgeForm(d);
  const taken = ports.lock(id, () => takenDown(ports, id, d));
  if (taken.done) return taken.done;
  if (taken.dispatch.mode === "engine") return engineSettled(ports, taken);
  return hostHanded(ports, taken);
}

async function engineSettled(ports, taken) {
  const read = await engineRun(ports, taken);
  return ports.lock(taken.lw.id, () => settleEngine(ports, taken, read));
}

// ---- settle: a host step's outcome ------------------------------------------------------------------

const refsOf = (o) => [...(o.evidenceRefs ?? []), ...(o.receiptRefs ?? [])];

function settling(ports, id, o) {
  const lw = loopWorld(ports, id);
  const prior = lw.view.decisions.find((x) => x.ref === o.decisionId) ?? null;
  const st = lw.states.find((s) => s.id === o.stepId) ?? null;
  if (prior && st && st.state !== "running" && prior.nextAction === `step.${o.stepId}`) return { task: id, state: "replayed", step: st.id, stepState: st.state, say: "this outcome was already settled — nothing was recorded twice", context: contextOf(ports, id) };
  return settledNow(ports, lw, o, { prior, st });
}

function settledNow(ports, lw, o, at) {
  judgeSettle(o, { lw, prior: at.prior, state: at.st?.state ?? null });
  const kind = kindOf(at.st.kind);
  const read = verifyOf(ports, kind, refsOf(o), lw);
  const ops = settledOf({ step: at.st, kind, act: at.st.action, read, outcome: o }).ops;
  return finishSettle(ports, lw, at.st, ops);
}

function finishSettle(ports, lw, st, ops) {
  applied(ports, lw.id, ops);
  ports.roomOf(lw.id).remove("running");
  return concluded(ports, lw.id, st);
}

export async function settle(ports, id, o) {
  judgeOutcomeForm(o);
  return ports.lock(id, () => settling(ports, id, o));
}

// ---- what the evidence moves --------------------------------------------------------------------------

const signatureOf = (failed, lw) => short(canonicalJson({ step: failed.id, provider: lw.view.actions.find((a) => a.id === failed.action)?.tool ?? null, because: failed.summary ?? null }), 12);

const summaryOf = (lw) => clip(`${lw.states.length} step(s): ${lw.states.map((s) => `${s.id} ${s.state}`).join(", ")}${childOf(lw.view) ? `; engineering task ${childOf(lw.view)}` : ""}`);

function completedAll(ports, lw) {
  applied(ports, lw.id, [...(lw.view.attempt.open ? [["attempt-complete", { outcome: "succeeded" }]] : []), ["complete", { summary: summaryOf(lw) }]]);
}

function failedAll(ports, lw, stop, because) {
  applied(ports, lw.id, [["fail", { stop, because: clip(because) }]]);
}

// The plan receipt says which revision, and -- for a revision -- what asked for it; its tail keeps the
// `N step(s): a, b` an earlier viewer reads the steps from.
const replanNote = (plan) => ((r) => (r ? `, after ${r.trigger} at ${r.step ?? "the plan"}` : ""))(plan.replans?.at(-1));

const planReceipt = (plan, outcome) => ["link-receipt", { domain: DOMAIN.PLAN, ref: plan.digest, outcome, summary: clip(`plan-${plan.n} (${plan.workflow}${replanNote(plan)}): ${plan.steps.length} step(s): ${plan.steps.map((s) => s.id).join(", ")}`) }];

const spentAttempts = (lw) => lw.view.budget.attempts.limit !== null && lw.view.attempt.count >= lw.view.budget.attempts.limit;

const pendingStep = (summary) => (sid) => ["link-receipt", { domain: DOMAIN.STEP, ref: sid, outcome: STEP_WORD.PENDING, summary: clip(summary) }];

// A REVISION, whatever asked for it: the new plan written before the receipts that name it, the one it replaced
// SUPERSEDED, and every step it plans again back to PENDING. No receipt is rewritten -- each says what it was.
function revised(ports, lw, r) {
  ports.roomOf(lw.id).write(`plans/${r.revision.digest}`, r.revision);
  applied(ports, lw.id, [planReceipt(lw.plan, "SUPERSEDED"), planReceipt(r.revision, "ACTIVE"), ...r.reset.map(pendingStep(r.say ?? `planned again (${r.trigger}): ${r.because ?? ""}`))]);
}

function replanned(ports, lw, failed, answer) {
  const next = replanOf(lw.plan, failed, { trigger: answer.trigger, summary: answer.because });
  if (!next) return failedAll(ports, lw, STOP.VERIFICATION_FAILED, `step ${failed.id} failed and no retry is left for it: ${failed.summary ?? "see its receipt"}`);
  if (spentAttempts(lw)) return failedAll(ports, lw, STOP.BUDGET_EXHAUSTED, `step ${failed.id} failed and the plan revisions a person allowed are spent`);
  revised(ports, lw, { revision: next.plan, reset: next.reset, say: `planned again after ${failed.id} failed` });
  applied(ports, lw.id, [["attempt-start", { cause: failed.kind === "engineering" ? CAUSE.FIX : CAUSE.RETRY }]]);
}

function afterFailure(ports, lw, failed) {
  applied(ports, lw.id, lw.view.attempt.open ? [["attempt-complete", { outcome: "failed", failureSignature: signatureOf(failed, lw) }]] : []);
  const now = loopWorld(ports, lw.id);
  return halted(ports, now) ?? replanned(ports, now, failed, respondTo(ports, now, { at: "failed", step: failed }));
}

// ---- what a trigger row reads --------------------------------------------------------------------------

// The requirement snapshot this workflow's requirement step read back, once it succeeded -- and the newest one
// now, asked only then: a workflow with no requirement step reads nothing.
const linkedSnapshot = (lw) => (lw.states.some((s) => s.kind === "requirement" && s.state === "succeeded") ? lw.view.receipts.filter((r) => r.domain === DOMAIN.REQUIREMENT).at(-1)?.ref ?? null : null);

const requirementNow = (ports, lw) => ((linked) => ({ linked, latest: linked && lw.ref ? quietly(() => ports.requirements.look(lw.ref))?.latest?.id ?? null : null }))(linkedSnapshot(lw));

const generatesFor = (ports, lw, step) => ((cap) => generates(quietly(() => ports.gapOf(quietly(() => ports.resolve(cap)), lw.values)), lw.values))(step.for ?? step.provides);

const violatedOn = (lw, step) => lw.view.verification.some((v) => v.subject === `${DOMAIN.STEP}:${step.id}` && v.state === "violated");

// Whether a QA step could go in: the runtime step read the checkout, a change is planned, and no QA step is. Only
// then is runtime understanding's memory asked what can be started now -- after ANY settle, so a revision for
// another reason in between never loses it.
const runtimeDone = (lw) => lw.states.some((s) => s.kind === "runtime" && s.state === "succeeded");

const qaPossible = (lw) => runtimeDone(lw) && lw.plan.steps.some((s) => s.kind === "engineering") && !lw.plan.steps.some((s) => s.kind === "qa");

const environmentNow = (ports, lw) => ({ runtimeDone: runtimeDone(lw), startable: qaPossible(lw) ? quietly(() => ports.runtime.startable())?.length ?? 0 : 0, ran: lw.states.filter((s) => s.state !== "pending").map((s) => s.id) });

// What each moment's rows may read, gathered only for that moment -- at most one owner read each.
const FACTS = {
  blocked: (ports, lw, c) => ({ generates: c.step.kind === "playbook" && c.needs === NEEDS.CAPABILITY && Boolean(c.step.for ?? c.step.provides) ? generatesFor(ports, lw, c.step) : false }),
  settled: (ports, lw) => ({ ...requirementNow(ports, lw), ...environmentNow(ports, lw) }),
  failed: (ports, lw, c) => ({ violated: violatedOn(lw, c.step) }),
};

function respondTo(ports, lw, c) {
  const facts = FACTS[c.at](ports, lw, c);
  return respond({ ...c, ...facts, plan: lw.plan, values: lw.values, ref: lw.ref });
}

// A settle the workflow goes on from: whether the evidence asks for a new plan. A workflow that ended, waits,
// or has a failed step to handle reads nothing more.
const still = (lw) => lw.view.terminal || [LIFE.PAUSED, LIFE.BLOCKED].includes(lw.view.lifecycle) || lw.states.some((s) => s.state === "failed");

const evidenceAfter = (ports, lw, settled) => (still(lw) || !lw.plan ? { response: "none" } : respondTo(ports, lw, { at: "settled", step: lw.states.find((s) => s.id === settled?.id) ?? null }));

const MOVES = [
  { when: (lw) => lw.view.terminal || [LIFE.PAUSED, LIFE.BLOCKED].includes(lw.view.lifecycle), then: () => null },
  { when: (lw) => lw.states.some((s) => s.state === "failed"), then: (ports, lw) => afterFailure(ports, lw, lw.states.find((s) => s.state === "failed")) },
  { when: (lw, c) => Boolean(c.revision), then: (ports, lw, c) => revised(ports, lw, c) },
  { when: (lw, c) => c.response === "fail", then: (ports, lw, c) => failedAll(ports, lw, STOP.BUDGET_EXHAUSTED, c.because) },
  { when: (lw) => allDone(lw.states), then: (ports, lw) => completedAll(ports, lw) },
  { when: () => true, then: (ports, lw) => halted(ports, lw) },
];

function concluded(ports, id, settledStep) {
  const lw = loopWorld(ports, id);
  const c = evidenceAfter(ports, lw, settledStep);
  MOVES.find((m) => m.when(lw, c)).then(ports, lw, c);
  return answerOf(ports, id, settledStep);
}

const lastReplan = (plan) => (plan && plan.n > 1 ? plan.replans?.at(-1) ?? null : null);

function answerOf(ports, id, settledStep) {
  const lw = loopWorld(ports, id);
  const s = lw.states.find((x) => x.id === settledStep.id);
  return { task: id, step: settledStep.id, stepState: s?.state ?? null, summary: s?.summary ?? null, revision: lw.view.revision, lifecycle: lw.view.lifecycle, stage: lw.view.stage, plan: lw.plan ? `plan-${lw.plan.n}` : null, replan: lastReplan(lw.plan), ready: readyOf(lw.states).map((x) => x.id), stop: stopView(lw), say: sayNext(lw, nextOf(ports, lw)) };
}

// ---- reconcile -------------------------------------------------------------------------------------------

const ageOf = (lw, act) => Date.parse(lw.now) - Date.parse(act.startedAt);

// A host-run step is read back from its owner first; only an owner that cannot say leaves it to who ran it.
const HOST_GONE = [
  { when: (c) => ["satisfied", "violated", "blocked"].includes(c.read.verdict), then: "settle" },
  { when: (c) => c.read.verdict === "open", then: "running" },
  { when: (c) => c.runner?.session && c.runner.session === c.session, then: "interrupted" },
  { when: (c) => c.age > STALE_AFTER_MS, then: "interrupted" },
  { when: () => true, then: "running" },
];

const ENGINE_GONE = [
  { when: (c) => c.alive === true, then: "running" },
  { when: (c) => c.alive === false, then: "interrupted" },
  { when: (c) => c.age > STALE_AFTER_MS, then: "interrupted" },
  { when: () => true, then: "running" },
];

const childEvidence = (lw, kind) => (kind.domains.includes(DOMAIN.TASK) && childOf(lw.view) ? [`${DOMAIN.TASK}:${childOf(lw.view)}`] : []);

function verdictFor(ports, lw, act) {
  const st = lw.states.find((s) => s.action === act.id);
  const runner = ports.roomOf(lw.id).read("running");
  const host = act.type !== ACTION_TYPE.ENGINE;
  const c = { read: host && st ? verifyOf(ports, kindOf(st.kind), childEvidence(lw, kindOf(st.kind)), lw) : { verdict: "unreadable" }, runner: runner?.action === act.id ? runner : null, session: ports.session, age: ageOf(lw, act), alive: runner?.action === act.id ? ports.liveness(runner) : null };
  return { st, c, then: (host ? HOST_GONE : ENGINE_GONE).find((r) => r.when(c)).then };
}

function reconciledOne(ports, lw, act) {
  const v = verdictFor(ports, lw, act);
  if (v.then === "running") throw Object.assign(new Refused(`STILL_RUNNING: ${act.id} (${act.label ?? act.type}) is still being run — it settles itself, or settle it with its evidence`), { code: "STILL_RUNNING" });
  const ops = v.then === "settle" ? settledOf({ step: v.st, kind: kindOf(v.st.kind), act: act.id, read: v.c.read }).ops : interruptedOps(v.st ?? { id: "unknown" }, act.id, "what ran this step is gone, and its owner keeps no record of it — closed as interrupted, never run again");
  applied(ports, lw.id, ops);
  return { action: act.id, step: v.st?.id ?? null, settled: v.then };
}

function reconciling(ports, id) {
  const lw = loopWorld(ports, id);
  if (!lw.open.length) throw Object.assign(new Refused("NOTHING_OPEN: no step of this workflow is waiting to be settled"), { code: "NOTHING_OPEN" });
  const settled = lw.open.map((act) => reconciledOne(ports, lw, act));
  ports.roomOf(id).remove("running");
  return { task: id, settled, answer: concluded(ports, id, { id: settled[0].step }) };
}

export const reconcile = async (ports, id) => ports.lock(id, () => reconciling(ports, id));

// ---- finish ------------------------------------------------------------------------------------------

const childNote = (ports, lw) => ((c) => (c && !["COMPLETED", "FAILED", "CANCELLED", "UNREADABLE"].includes(c.lifecycle) ? `the engineering task ${c.task} still runs — a person cancels it in Orbit Control if it should stop` : null))(childView(ports, lw));

function named(ports, lw, stop, because) {
  const row = STOP_EVIDENCE[stop];
  if (!row) throw new Refused(`STOP: ${stop} is not a stop a host may name — one of ${Object.keys(STOP_EVIDENCE).join(", ")}`);
  if (!row.holds(lw)) throw new Refused(`STOP: ${stop} needs ${row.needs}, and the journal does not show it`);
  failedAll(ports, lw, stop, because ?? row.needs);
  return { task: lw.id, state: "failed", stop, note: childNote(ports, lw) };
}

const unmetSay = (lw) => `NOT_COMPLETE: ${lw.states.filter((s) => !["succeeded", "skipped", "reported"].includes(s.state)).map((s) => `${s.id} ${s.state}`).join(", ") || "a step is still open"} — keep going, or end it with a stop the journal supports: finish --stop=<${Object.keys(STOP_EVIDENCE).join("|")}>`;

function finishing(ports, id, opts) {
  const lw = loopWorld(ports, id);
  if (lw.view.terminal) return { task: id, state: lw.view.lifecycle.toLowerCase(), say: `the workflow is ${lw.view.lifecycle} already`, note: childNote(ports, lw) };
  if (opts.stop) return named(ports, lw, opts.stop, opts.because);
  if (!allDone(lw.states) || lw.open.length) throw new Refused(unmetSay(lw));
  return completedNow(ports, lw);
}

function completedNow(ports, lw) {
  completedAll(ports, lw);
  return { task: lw.id, state: "completed", note: childNote(ports, lw) };
}

export const finish = async (ports, id, opts = {}) => ports.lock(id, () => finishing(ports, id, opts));

// ---- start and resume ------------------------------------------------------------------------------

const objectiveKey = (text) => short(String(text).trim().toLowerCase().replace(/\s+/g, " "), 16);

const coordinators = (ports) => ports.task.list().map((t) => quietly(() => ports.task.view(t))).filter((v) => v && v.task.provider === PROVIDER);

const activeFor = (ports, match) => coordinators(ports).find((v) => !v.terminal && match(v))?.task.id ?? null;

const sameObjective = (objective) => (v) => objectiveKey(v.task.objective) === objectiveKey(objective);

export function planFor(ports, spec) {
  const values = ports.settings().values;
  const facts = factsOf(ports, spec, values);
  const plan = planOf(facts, values);
  if (plan) validate(plan);
  return { plan, facts: { intent: facts.intent, confidence: facts.confidence, matched: facts.matched, requirement: facts.requirement, startable: facts.startable, playbook: facts.playbook, capabilities: facts.capabilities, missing: missingOf(facts, plan) }, writes: "nothing" };
}

function created(ports, spec, facts, plan) {
  const values = ports.settings().values;
  const id = ports.task.create({ objective: spec.objective, root: facts.requirement?.root, provider: PROVIDER, actor: ports.actor ?? undefined, ...narrowedBudget(values, spec) }).task;
  ports.lock(id, () => opened(ports, id, plan));
  return id;
}

function opened(ports, id, plan) {
  ports.roomOf(id).write(`plans/${plan.digest}`, plan);
  applied(ports, id, [planReceipt(plan, "ACTIVE"), ["attempt-start", { cause: CAUSE.FRESH }]]);
}

const nothingToDo = (got) => Object.assign(new Refused(`NOTHING_TO_COORDINATE: the objective reads as ${got.facts.intent} (${got.facts.confidence} confidence), which no workflow here coordinates — orbit-help names the one workflow for it`), { code: "NOTHING_TO_COORDINATE" });

export function start(ports, spec) {
  const running = activeFor(ports, sameObjective(spec.objective));
  if (running) return { task: running, created: false, resumed: true, context: contextOf(ports, running) };
  return startedNew(ports, spec);
}

function startedNew(ports, spec) {
  const got = planFor(ports, spec);
  if (!got.plan) throw nothingToDo(got);
  const id = created(ports, spec, got.facts, got.plan);
  return { task: id, created: true, plan: got.plan, context: contextOf(ports, id) };
}

const RESUME = [
  { when: (ref) => /^tsk-[a-f0-9]{12}$/.test(ref), find: (ports, ref) => ref },
  { when: (ref) => /^req-[0-9a-f]{12}$/.test(ref), find: (ports, ref) => activeFor(ports, (v) => v.task.root === ref) },
  { when: () => true, find: (ports, ref) => activeFor(ports, (v) => v.task.root === quietly(() => ports.requirements.resolve(ref))?.root) ?? activeFor(ports, sameObjective(ref)) },
];

// A task id, a requirement or the objective itself. It never un-pauses: a person resumes, in Control.
export function resume(ports, ref) {
  const id = RESUME.find((r) => r.when(String(ref ?? ""))).find(ports, String(ref ?? ""));
  if (!id) throw Object.assign(new Refused(`NO_ACTIVE_WORKFLOW: no coordinated workflow is running for ${ref} in this checkout — start one`), { code: "NO_ACTIVE_WORKFLOW" });
  return { task: id, context: contextOf(ports, id) };
}

export function planOfTask(ports, id) {
  const lw = loopWorld(ports, id);
  if (!lw.plan) throw new Refused("PLAN_UNREADABLE: the workflow's plan receipt names an artifact that is gone");
  return { task: id, plan: lw.plan, states: lw.states.map(stepView), revisions: lw.plan.replans ?? [] };
}

const planningOf = () => ({ schema: PLAN_SCHEMA, depends: DEPENDS, triggers: TRIGGERS.map((t) => ({ id: t.id, at: t.at, response: t.response, otherwise: t.otherwise ?? null })), responses: RESPONSE_IDS });

export const protocolOf = () => ({ schemaVersion: DECISION_SCHEMA, decision: { fields: DECISION_FIELDS, action: { kind: "run", step: "<a ready step's id>" } }, outcome: { fields: OUTCOME_FIELDS, executionState: ["succeeded", "failed", "blocked"], evidence: "domain:id — task:tsk-…, investigation:inv-…, requirement:rs-…, skill:<id>:<version>:<digest8>" }, forbidden: FORBIDDEN, rules: protocolRules(), steps: STEP_KINDS.map((k) => ({ kind: k.id, provides: k.provides, stage: k.stage, strict: k.strict, evidence: k.domains, class: k.class, obligation: k.obligation })), planning: planningOf(), stops: Object.keys(STOP_EVIDENCE) });

export { digestOf };
