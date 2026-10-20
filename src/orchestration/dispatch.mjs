// Every step a decision may take, as rows -- and nothing else it can do.
//
// A row says which fields the action carries and which it needs, what the task journal calls it
// (`type`, `tool`, `label`), whether it can change something (`mutates`), whether it settles in the
// same step (`now`) or is read back by a later one (`later`: a change the host makes in the
// workspace), what must hold before it runs (`check`), what it IS -- `run`, always an existing
// owner's operation reached through a port -- and how an interrupted one is read back (`readBack`).
//
// There is no free-form action, no command string and no second way to reach the runtime, the
// workspace, a capability or the process port. An action answers with a RESULT:
//
//   { outcome: succeeded | failed | error | open, summary, reason?, receipts?, files?,
//     verifications?, closes?, failure?, needs?, because?, workspace?, then?, data? }
//
// `data` goes back to the host and nowhere else; everything the journal keeps is a reference, a
// count or a sentence.
import { classify, exactOf, excerptOf, signatureOf } from "./failure.mjs";
import { changed, checkRuns, currentAttempt, openOf, pinned, treeNow, workspaceProblem } from "./journal.mjs";
import { allRowsOf, impactReceipt, planOf, requiredIds, rowsOf } from "./obligations.mjs";
import { environmentOf } from "./readiness.mjs";
import { error, failed, ok } from "./results.mjs";
import { reviewOf, scopeProblem, scopeSignature } from "./review.mjs";
import { needsSandbox, sandboxPrepared, sandboxReadBack, sandboxStarted } from "./sandbox.mjs";
import { CHECKING, purposesNow } from "./stages.mjs";
import { AS_BEFORE, DOMAIN, RESULT, STAGE, TEXT_LIMIT } from "./vocab.mjs";
import { briefOf } from "./checks.mjs";
import { scrub } from "../scrub.mjs";

const sentence = (v) => typeof v === "string" && v.trim().length > 0 && v.length <= TEXT_LIMIT;

// The receipt of a check is named after the action that ran it: act-7 ran chk-7.
export const chkOf = (action) => `chk-${String(action.id).slice("act-".length)}`;

export const commandOf = (lw, id) => lw.checks.find((c) => c.id === id) ?? null;

const short12 = (rev) => String(rev ?? "").slice(0, 12);

// ---- reading an interrupted action back ----------------------------------------------------------

const interrupted = async () => error("interrupted: the step that ran it ended before it said how it went — nothing of its outcome was recorded, and running it again is a new action");

const unknownOutcome = async () => error("its outcome is unknown: it may have changed something, so it is never sent again — another one needs another approval");

// ---- the requirement, the context, the environment -----------------------------------------------

const requirementChecked = async (ports, lw) => (lw.requirement.ok ? ok(lw.requirement.because) : failed(lw.requirement.because, { because: lw.requirement.because, needs: "requirement" }));

// The context command's own word for what it gathered (src/context/status.mjs) is the summary, never a count of
// sections taken for understanding. One that could not be gathered on this machine at all (BLOCKED) fails the action,
// naming who must act; the task then stays where it is. A context command from before 1.8.9 says no word.
async function contextGathered(ports, lw, a) {
  const got = await ports.context.gather(a.for ?? lw.view.task.objective);
  const summary = got.status?.summary ?? `${got.sections.length} section(s) of project context, ${got.sections.filter((s) => s.known).length} known`;
  const data = { sections: got.sections, ...(got.status ? { status: got.status } : {}) };
  return got.status?.word === "BLOCKED" ? failed(summary, { because: got.status.because, needs: "environment", data }) : ok(summary, { data });
}

async function environmentChecked(ports) {
  const looked = await ports.runtime.readiness();
  const verdict = environmentOf(looked);
  const data = { checks: looked.checks.map(briefOf), understanding: looked.understanding };
  return verdict.ok ? ok(verdict.because, { data }) : failed(verdict.because, { because: verdict.because, needs: verdict.needs, data });
}

const startedReceipt = (s) => ({ domain: DOMAIN.RUNTIME, ref: s.session, outcome: "RUNNING", summary: `${s.component} started for this task` });

async function runtimeStarted(ports, lw, a) {
  const done = await ports.runtime.start({ component: a.component });
  const receipts = done.started.filter((s) => s.session).map(startedReceipt);
  return ok(`${receipts.length} session(s) started, ${done.skipped.length} already running, ${done.blocked.length} blocked`, { receipts, data: { started: done.started, skipped: done.skipped, blocked: done.blocked } });
}

// What runtime recorded after the action began: its receipt is written BEFORE a launch, so a start
// that the orchestrator lost the answer to is still on runtime's books.
async function runtimeReadBack(ports, lw, act) {
  const since = (await ports.runtime.sessions()).filter((s) => s.requestedAt >= act.startedAt && ["RUNNING", "STARTING", "AMBIGUOUS"].includes(s.state));
  const receipts = since.map((s) => ({ domain: DOMAIN.RUNTIME, ref: s.id, outcome: s.state, summary: `${s.component}, read back after an interrupted start` }));
  return receipts.length ? ok(`${receipts.length} session(s) read back`, { receipts }) : error("nothing it may have started is on runtime's books — it is not started again by itself");
}

// ---- the workspace -------------------------------------------------------------------------------

const headOf = (lw) => ({ task: lw.view.task.id, project: lw.view.task.project, checkout: lw.view.task.checkout, baseRevision: lw.view.task.baseRevision });

function workspacePrepared(ports, lw) {
  const ws = ports.workspace.prepare(headOf(lw));
  return ok(`${ws.id} at ${short12(ws.baseRevision)}${ws.reused ? ", reused" : ""}`, { workspace: ws, data: { workspace: { id: ws.id, path: ws.path } } });
}

function workspaceReadBack(ports, lw) {
  const ws = ports.workspace.found(lw.view.task.id);
  return ws ? ok(`${ws.id} read back`, { workspace: ws }) : error("the workspace it was preparing is not there as this task's own — prepare it again");
}

const needsWorkspace = (a, lw) => workspaceProblem(lw);

const implementing = async (ports, lw) => ({ outcome: "open", summary: null, data: { workspace: lw.workspace.path, next: "make the change in the workspace, then step record-changes" } });

const latestPlan = (ports, lw) => ((p) => (p ? ports.room.read(`plans/${p.id}`) : null))(lw.view.actions.filter((x) => x.type === "plan" && x.state === "succeeded").at(-1));

function planProblem(a) {
  if (!sentence(a.intent)) return `intent is the smallest intended change, one sentence of at most ${TEXT_LIMIT} characters`;
  return scopeProblem(a.scope);
}

// What a plan or a change is found to reach, published: the verification rows that say what is owed, not
// affected or unverifiable, and one impact receipt -- so a viewer that reads only the journal sees it too.
const impOf = (act) => `imp-${String(act.id).slice("act-".length)}`;

const published = (lw, act, plan) => ({ receipts: [impactReceipt(impOf(act), plan)], verifications: rowsOf(lw, plan), data: { verificationPlan: plan } });

async function planned(ports, lw, a, act) {
  ports.room.write(`plans/${act.id}`, { intent: a.intent, scope: a.scope });
  const plan = planOf({ ...lw, planned: () => a.scope });
  return ok(`${a.scope.length} path(s) in the plan's scope; ${plan.required.length} check(s) required, ${plan.excluded.length} not affected`, published(lw, act, plan));
}

// Before a first attempt begins in PLANNING, a plan has said what the change reaches.
const needsPlan = (a, lw) => (lw.view.stage === STAGE.PLANNING && !lw.view.actions.some((x) => x.type === "plan" && x.state === "succeeded") ? "plan first: its scope says what the change reaches, which checks it is held to, and which to baseline before it begins" : null);

// ---- the change ------------------------------------------------------------------------------

export const lastRecorded = (lw) => lw.view.actions.filter((x) => x.type === "record-changes" && x.state === "succeeded").at(-1) ?? null;

function treeBefore(ports, lw) {
  const kept = lastRecorded(lw) ? ports.room.read(`trees/${lastRecorded(lw).id}`) : null;
  const tree = kept?.git ?? kept?.tree ?? null;
  return tree ? { ref: tree, say: "the last recorded change" } : { ref: lw.view.task.baseRevision, say: "the base revision" };
}

const linkedNow = (lw) => lw.events.filter((e) => e.kind === "file-changed" && e.attempt === currentAttempt(lw)).map((e) => `${e.path}\u0000${e.change}`);

// A crash halfway through linking leaves some rows on the journal: they are not linked twice.
const unlinked = (lw, rows) => rows.filter((r) => !linkedNow(lw).includes(`${r.path}\u0000${r.change}`));

// The code moved, so nothing verified before it holds any more.
const staled = (lw) => lw.view.verification.filter((v) => v.state !== "not-verified").map((v) => ({ subject: v.subject ?? undefined, obligation: v.obligation, state: "not-verified" }));

// A rename is a file gone from where it was, as well as one where it is now: both ends reach a component.
const withSources = (rows) => [...rows, ...rows.filter((r) => r.change === "renamed" && r.from).map((r) => ({ path: r.from, change: "deleted", added: 0, removed: 0 }))];

const pathsAfter = (lw, rows) => [...new Set([...lw.view.changes.paths.map((p) => p.path), ...rows.map((r) => r.path)])].map((path) => ({ path }));

// The plan once these rows are on the journal: the code moved, so every required check is owed again.
const planAfter = (lw, rows) => planOf({ ...lw, view: { ...lw.view, changes: { ...lw.view.changes, paths: pathsAfter(lw, rows) }, actions: lw.view.actions }, events: [...lw.events, { kind: "file-changed", n: lw.events.length }] });

// What the change made stale that the plan does not speak for (a row of another subject).
const staledBesides = (lw, plan) => ((spoken) => staled(lw).filter((v) => !spoken.has(v.subject)))(new Set(allRowsOf(lw, plan).map((r) => r.subject)));

const needsImplement = (a, lw) => (openOf(lw, "implement") ? null : "nothing is being changed — implement first, edit the workspace, then record-changes");

async function changesRecorded(ports, lw, a, act) {
  const from = treeBefore(ports, lw);
  const got = ports.workspace.changes(lw.view.task.id, from.ref);
  if (!got.rows.length) return failed(`nothing changed since ${from.say} — make the change in the workspace, then record it`);
  ports.room.write(`trees/${act.id}`, { tree: got.tree, git: got.git ?? got.tree, from: from.ref });
  return changeResult(lw, act, withSources(got.rows), from);
}

function changeResult(lw, act, rows, from) {
  const plan = planAfter(lw, rows);
  const out = published(lw, act, plan);
  return ok(`${rows.length} file(s) changed since ${from.say}; ${plan.required.length} check(s) required, ${plan.excluded.length} not affected, ${plan.missing.length} unverifiable`, { ...out, files: unlinked(lw, rows), closes: openOf(lw, "implement").id, verifications: [...out.verifications, ...staledBesides(lw, plan)] });
}

// ---- a check -------------------------------------------------------------------------------------

function checkProblem(a, lw) {
  const command = commandOf(lw, a.command);
  if (!command) return `${a.command} is not a declared check of this checkout — the context lists them (checks)`;
  if (!purposesNow(lw).includes(command.purpose)) return `${lw.view.stage} runs ${purposesNow(lw).join(" or ") || "no check"}, not ${command.purpose}`;
  if (CHECKING.includes(lw.view.stage) && !requiredIds(lw).has(command.id)) return `${a.command} (${command.component}) is not affected by this change: it is not run here, and stays NOT AFFECTED — the context lists what the change is held to (verificationPlan.required)`;
  return needsWorkspace(a, lw);
}

const checkLabel = (a, lw) => ((c) => (c ? `${c.purpose} · ${c.component} · ${c.declaredAs}` : a.command))(commandOf(lw, a.command));

// How the same command did on the pinned base revision: its last run on the base revision's own tree,
// before the code first changed.
function baselineOf(ports, lw, id) {
  const run = checkRuns(lw).filter((r) => r.command === id && r.state !== "running" && pinned(lw, r)).at(-1);
  return run ? ((kept) => ({ state: run.state, signature: kept?.signature ?? null, exact: kept?.exact ?? null }))(ports.room.read(`checks/${chkOf(run)}`)) : null;
}

// A failure after a change is the one that was already there only when it says EXACTLY what its baseline
// said (failure.mjs exactOf) -- never by the coarse signature, which two different failures can share.
const sameAsBaseline = (baseline, exact, lw) => changed(lw) && baseline?.state === "failed" && Boolean(exact) && baseline.exact === exact;

const runFacts = (command, ran) => ({ purpose: command.purpose, command: command.id, lines: ran.lines, status: ran.status, timedOut: ran.timedOut, cut: ran.cut });

function failureOf(ports, lw, command, ran) {
  const signature = signatureOf(runFacts(command, ran), lw.workspace.path);
  const exact = exactOf(runFacts(command, ran), lw.workspace.path);
  const baseline = baselineOf(ports, lw, command.id);
  return { signature, exact, asBefore: sameAsBaseline(baseline, exact, lw), ...classify({ purpose: command.purpose, started: ran.started, timedOut: ran.timedOut, changed: changed(lw), signature, baseline }) };
}

// How a check came out: passed; failed exactly as at its baseline (visible, never a pass -- what is
// satisfied is that it got no worse); failed; or could not start.
const HOW = [
  { when: (r) => r.ok, word: "succeeded", outcome: RESULT.SUCCEEDED, verified: "satisfied", obligation: "passes", say: () => "passed" },
  { when: (r, f) => r.started && f?.asBefore === true, word: AS_BEFORE, outcome: RESULT.FAILED, verified: "satisfied", obligation: "fails no worse than before the change", say: (r) => `exit ${r.status}, as before the change` },
  { when: (r) => r.started, word: "failed", outcome: RESULT.FAILED, verified: "violated", obligation: "passes", say: (r) => (r.timedOut ? "did not finish in time" : `exit ${r.status}`) },
  { when: () => true, word: "unstarted", outcome: RESULT.ERROR, verified: "blocked", obligation: "passes", say: () => "could not be started" },
];

const howOf = (ran, failure = null) => HOW.find((h) => h.when(ran, failure));

const checkSummary = (command, ran, how) => `${command.purpose} · ${command.component} · ${command.declaredAs} · ${how.say(ran)} · ${Math.round(ran.durationMs / 1000)}s`;

const obligationOf = (command, how) => `${command.component} · ${command.purpose} ${command.declaredAs} ${how.obligation}`;

// A check speaks for the change only when the change is held to it, and only after the change: a run
// before it is a baseline, and a check the change does not reach stays NOT AFFECTED whatever it did.
const verifiesNow = (lw, command) => changed(lw) && requiredIds(lw).has(command.id);

// `observation` is what was READ off the run while it ran (src/orchestration/activity/): its bounded summary, kept
// with the record, never a verdict -- the receipt's word is the check's, whatever an observation counted.
const checkRecord = (lw, command, ran, failure) => ({ command: command.id, purpose: command.purpose, component: command.component, declaredAs: command.declaredAs, started: ran.started, timedOut: ran.timedOut, status: ran.status, durationMs: ran.durationMs, signature: failure?.signature ?? null, exact: failure?.exact ?? null, class: failure?.class ?? null, confidence: failure?.confidence ?? null, stage: lw.view.stage, tree: ran.tree ?? null, unpinned: ran.unpinned === true, observation: ran.observation ?? null });

function checkResult(ports, lw, command, ran, ref) {
  const failure = ran.ok ? null : failureOf(ports, lw, command, ran);
  const how = howOf(ran, failure);
  ports.room.write(`checks/${ref}`, checkRecord(lw, command, ran, failure));
  const receipt = { domain: DOMAIN.CHECK, ref, outcome: how.word, summary: checkSummary(command, ran, how), sourceTree: ran.tree ?? undefined };
  return { outcome: how.outcome, asBefore: how.word === AS_BEFORE, summary: receipt.summary, reason: ran.started ? null : ran.reason ?? "it could not be started", receipts: [receipt], verifications: verifiesNow(lw, command) ? [{ subject: command.id, obligation: obligationOf(command, how), state: how.verified, evidence: `${DOMAIN.CHECK}:${ref}` }] : [], failure, data: { check: ref, failure, excerpt: ran.ok ? [] : excerptOf(ran, lw.workspace.path), observation: ran.observation ?? null } };
}

// What the workspace holds as a check starts or ends: its anchored tree, how many entries its own ignore
// files leave out, and the newest change time among its files (src/frontend/local-clones.mjs `stateOf`).
// Unreadable is all null, and a null names nothing.
const UNNAMED = Object.freeze({ tree: null, ignored: null, stamp: null });

function stateHere(ports, lw) {
  try { return ports.workspace.stateOf?.(lw.id) ?? UNNAMED; }
  catch { return UNNAMED; }
}

// What a check RAN on is named twice -- before it starts and after it ends -- and only a tree that was the
// same both times, with no file of it written in between (the newest change time unmoved: an edit put back
// is still a write, and a change time is not one a process sets back), is its tree: otherwise nothing names what it tested, so it is neither a baseline nor
// a pass of the recorded change. Anything ignored beside it, or an unknown count,
// makes it UNPINNED: a tree leaves ignored files out, so it is never a run on the base revision exactly.
const unmoved = (a, b) => Boolean(a.tree) && a.tree === b.tree && a.stamp !== null && a.stamp === b.stamp;

const settledState = (a, b) => ({ tree: unmoved(a, b) ? a.tree : null, unpinned: !(a.ignored === 0 && b.ignored === 0) });

// The tree is named before the run starts and only AFTER it settled -- the check may run for half an hour, and an
// edit during it must make the run name no tree.
async function checked(ports, lw, a, act) {
  const command = commandOf(lw, a.command);
  const before = stateHere(ports, lw);
  const ran = await ports.checks.run(command, { task: lw.id, dir: lw.workspace.path, ref: chkOf(act), action: act.id, attempt: act.attempt ?? null, why: whyOf(lw, command) });
  return checkResult(ports, lw, command, { ...ran, ...settledState(before, stateHere(ports, lw)) }, chkOf(act));
}

// Why a check runs now, in the journal's own terms: before the code first changed it is a baseline; after, it is one
// the change is held to because the change REACHES its component, said with the impact's own reason -- never a guess
// at what the host had in mind.
const reachOf = (lw, command) => planOf(lw).impact.components.find((c) => c.key === command.component) ?? null;

const WHY = [
  { when: (lw) => !changed(lw), say: () => "baseline: how it does on the base revision, before the code first changes" },
  { when: (lw, c) => Boolean(reachOf(lw, c)), say: (lw, c) => ((r) => `required: the change reaches ${c.component} (${String(r.reason).toLowerCase()}${r.because ? `: ${r.because}` : ""})`)(reachOf(lw, c)) },
  { when: () => true, say: (lw, c) => `${c.purpose} of ${c.component}` },
];

export const whyOf = (lw, command) => WHY.find((w) => w.when(lw, command)).say(lw, command).slice(0, 240);

// ---- evidence from elsewhere -----------------------------------------------------------------

const INVESTIGATION = /^inv-\d{8}-\d{6}-[0-9a-f]{4}$/;

const investigationSummary = (o) => `${o.reason ?? o.lifecycle} · ${o.findings} finding(s), ${o.defects} its vocabulary calls a defect`;

function investigationLinked(ports, lw, a) {
  const o = ports.investigations.outcome(a.investigation);
  if (!o) return error(`no investigation ${a.investigation} is kept for this project`);
  return ok(investigationSummary(o), { receipts: [{ domain: DOMAIN.INVESTIGATION, ref: a.investigation, outcome: o.lifecycle, summary: investigationSummary(o) }], data: { investigation: o } });
}

function invokeProblem(a, lw) {
  if (!lw.describe?.(a.capability)) return `${a.capability} is not a capability this project registered — query capabilities lists them`;
  return a.input === undefined || (typeof a.input === "object" && a.input !== null && !Array.isArray(a.input) && JSON.stringify(a.input).length <= 8192) ? null : "input is a JSON object of at most 8 KB";
}

const bounded = (value) => scrub(JSON.stringify(value ?? null)).slice(0, 4000);

async function invoked(ports, lw, a, act) {
  const value = await ports.capabilities.invoke(a.capability, a.input ?? {}, { approved: Boolean(act.approval) });
  return ok(`${a.capability} answered`, { data: { answer: bounded(value) } });
}

// ---- the review ----------------------------------------------------------------------------------

function reviewed(ports, lw) {
  const plan = latestPlan(ports, lw);
  if (!plan) return error("no plan's scope can be read for this task — what the change was meant to touch is unknown, so it cannot be reviewed");
  const review = reviewOf(ports.workspace.changes(lw.view.task.id, lw.view.task.baseRevision).rows, plan.scope);
  const data = { files: review.files, unexpected: review.unexpected, scope: plan.scope, missing: planOf(lw).missing, unrecorded: unrecordedOf(lw, review.rows), moved: movedSince(lw) };
  return REVIEWED.find((r) => r.when(review, data)).result(review, data);
}

// Whether the workspace's tree is no longer the one record-changes recorded: an edit after the last read-back,
// to a path it already knew included.
const movedSince = (lw) => ((t) => Boolean(t.live) && Boolean(t.recorded) && t.live !== t.recorded)(treeNow(lw));

// What the workspace holds that record-changes never read back: its reach was never computed, so nothing
// it reaches was ever held to anything. A review never passes over it.
const unrecordedOf = (lw, rows) => ((known) => [...new Set(rows.flatMap((r) => [r.path, r.from]).filter(Boolean))].filter((p) => !known.has(p)).sort())(new Set(lw.view.changes.paths.map((p) => p.path)));

// A change outside its plan's scope is drift; a change that reaches what nothing declared verifies cannot
// be shown to work. Either fails the review, and the loop diagnoses it like any failure.
const missingSay = (data) => `the change reaches what nothing declared verifies: ${data.missing.slice(0, 3).map((m) => m.what).join(", ")}${data.missing.length > 3 ? ", …" : ""}`;

const REVIEWED = [
  { when: (review, data) => data.unrecorded.length > 0 || data.moved, result: (review, data) => failed(`the workspace holds changes record-changes has not read back${data.unrecorded.length ? `: ${data.unrecorded.slice(0, 3).join(", ")}${data.unrecorded.length > 3 ? ", …" : ""}` : ""} — record them, so what they reach is verified on the code that is there`, { failure: { signature: scopeSignature(["unrecorded", ...data.unrecorded]), ...classify({ purpose: "review", unexpected: Math.max(1, data.unrecorded.length) }) }, data }) },
  { when: (review) => review.unexpected.length > 0, result: (review, data) => failed(review.say, { failure: { signature: scopeSignature(review.unexpected), ...classify({ purpose: "review", unexpected: review.unexpected.length }) }, data }) },
  { when: (review, data) => data.missing.length > 0, result: (review, data) => failed(missingSay(data), { failure: { signature: scopeSignature(data.missing.map((m) => `missing:${m.what}`)), ...classify({ purpose: "review", missing: data.missing.length }) }, data }) },
  { when: () => true, result: (review, data) => ok(review.say, { data }) },
];

// ---- the rows ------------------------------------------------------------------------------------

const never = () => false;
const always = () => true;
const nothing = () => null;
const self = (kind) => () => kind;

const row = (kind, spec) => ({ fields: [], required: [], type: self(kind), tool: nothing, label: () => kind, mutates: never, settles: "now", check: nothing, readBack: interrupted, ...spec });

export const ACTIONS = {
  "check-requirement": row("check-requirement", { label: () => "the requirement the task rests on", run: requirementChecked }),
  "gather-context": row("gather-context", { fields: ["for"], label: () => "project context, memory first", check: (a) => (a.for === undefined || sentence(a.for) ? null : `for is one sentence of at most ${TEXT_LIMIT} characters`), run: contextGathered }),
  "check-environment": row("check-environment", { label: () => "whether the declared checks can run here", run: environmentChecked }),
  "start-runtime": row("start-runtime", { fields: ["component"], label: (a) => `runtime start${a.component ? ` ${a.component}` : ""}`, mutates: always, run: runtimeStarted, readBack: runtimeReadBack }),
  "prepare-sandbox": row("prepare-sandbox", { label: () => "the task's sandbox, at the workspace's tree", mutates: always, check: needsWorkspace, run: sandboxPrepared, readBack: sandboxReadBack }),
  "start-sandbox": row("start-sandbox", { fields: ["component"], label: (a) => `sandbox start${a.component ? ` ${a.component}` : ""}`, mutates: always, check: needsSandbox, run: sandboxStarted, readBack: sandboxReadBack }),
  "prepare-workspace": row("prepare-workspace", { label: () => "the task's own workspace", mutates: always, run: workspacePrepared, readBack: workspaceReadBack }),
  plan: row("plan", { fields: ["intent", "scope"], required: ["intent", "scope"], label: (a) => a.intent, check: planProblem, run: planned }),
  implement: row("implement", { label: () => "the change, in the workspace", mutates: always, settles: "later", check: (a, lw) => needsWorkspace(a, lw) ?? needsPlan(a, lw), run: implementing }),
  "record-changes": row("record-changes", { label: () => "what changed, read back", mutates: always, check: needsImplement, run: changesRecorded }),
  check: row("check", { fields: ["command"], required: ["command"], type: (a, lw) => commandOf(lw, a.command)?.purpose ?? "check", tool: (a) => a.command, label: checkLabel, mutates: always, check: checkProblem, run: checked }),
  diagnose: row("diagnose", { fields: ["then"], required: ["then"], label: (a) => `diagnosed: ${a.then}`, check: (a) => (["fix", "retest"].includes(a.then) ? null : "then is fix (change something) or retest (the same change again)"), run: async (ports, lw, a) => ok(`next: ${a.then}`, { then: a.then }) }),
  "link-investigation": row("link-investigation", { fields: ["investigation"], required: ["investigation"], label: (a) => `investigation ${a.investigation}`, check: (a) => (INVESTIGATION.test(String(a.investigation)) ? null : "investigation is an inv- id"), run: investigationLinked }),
  invoke: row("invoke", { fields: ["capability", "input"], required: ["capability"], type: () => "capability.invoke", tool: (a) => String(a.capability).toLowerCase(), label: (a) => `capability ${a.capability}`, mutates: (a, lw, gate) => gate !== null, check: invokeProblem, run: invoked, readBack: unknownOutcome }),
  review: row("review", { label: () => "the change against its plan", run: reviewed }),
};

export const ACTION_KINDS = Object.keys(ACTIONS);

