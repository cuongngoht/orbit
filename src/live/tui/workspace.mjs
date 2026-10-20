// THE WORKSPACE PANE (1.8.5): what a viewer BESIDE an AI CLI shows. The work as a CHECKLIST of the steps it actually
// took -- a coordinated workflow's plan (its pending steps too: the plan named them), or an engineering task's own
// steps in the order its journal recorded them, the checks of the baseline nested under it, the checks the change is
// held to nested under its verification and the files under the change -- the task being worked on NOW in one block,
// a STATUS BAR, and VIEWS a person switches between. Every word is a field of the journals the full-screen viewer
// reads (snapshot.mjs), through its own sections where one already says it; a field nothing recorded is left out,
// never filled in, and a step nothing recorded is never drawn. Pure, like the rest of tui/.
//
//   checklistOf(ctx) -> [row]                   row.depth: 0 a step, 1 what it ran or changed, 2 inside a workflow step
//   currentRows(ctx) -> [row]                   task · work · stage · step · action · goal · runs · component ·
//                                               files · time · observed · status · skill · blocker · next
//   statusBarOf(ctx) -> row                     the counts, and the LIVE indicator (indicator.mjs) on the right
//   viewsOf(ctx) -> [{ id, label, rows }]       events · tests · changes · notices · plan · timeline (1.8.6: the last
//                                               two after the first four, so a key a person learned keeps its view)
//   With no task to show (1.8.7), NOW, the status bar and the events, tests and changes views are THIS SESSION's tool
//   activity as the host's hooks observed it (session-view.mjs), said as such; beside a task, NOW's `session` line is
//   what this session's own tools did since the task began -- the work a host step does and no journal follows.
//   checkStatus(action, observation) -> key     what ONE check run came to, in STATUS_WORDS
//   paneTierOf(columns, rows) -> name           tiny · narrow · medium · wide (a pane's own, not the full screen's)
import { focusOf, progressWords } from "../activity.mjs";
import { indicatorOf } from "../indicator.mjs";
import { skillsOf } from "../plan.mjs";
import { LIFECYCLE_WORDS, PROVENANCE_WORDS, STATUS_WORDS, STEP_WORDS, WORKFLOW_STEP_WORDS } from "../words.mjs";
import { PANE_VIEWS, isCoordinator } from "./model.mjs";
import { chosen } from "./sections/activity.mjs";
import { between, dim, joined, row, seg, str } from "./sections/parts.mjs";
import { noticesSection, recentSection } from "./sections/recent.mjs";
import { grouped, kindOf } from "./sections/verify.mjs";
import { steps as workflowSteps } from "./sections/work.mjs";
import { currentStepOf, nextStepOf, planRows } from "./plan-view.mjs";
import { taskProgressOf } from "./progress.mjs";
import { timelineRows } from "./timeline-view.mjs";
import { workNowRows } from "./work-view.mjs";
import { eventsView } from "./events-view.mjs";
import { lifecycleRows } from "./lifecycle-view.mjs";
import { sessionBarOf, sessionIndicator, sessionLine, sessionNowRows, sessionOf, sessionViewRows } from "./session-view.mjs";

// ---- a pane's own tiers ---------------------------------------------------------------------------------------

// A pane takes a third of a terminal, so it is read in its own tiers: wide puts the checklist and the task side by
// side, medium stacks them, narrow keeps the task and the status bar, tiny a line.
export const PANE_TIERS = Object.freeze([
  { name: "tiny", when: (c, r) => c < 30 || r < 8 },
  { name: "narrow", when: (c) => c < 48 },
  { name: "medium", when: (c) => c < 84 },
  { name: "wide", when: () => true },
]);

export const paneTierOf = (columns, rows) => PANE_TIERS.find((t) => t.when(columns, rows)).name;

// ---- what a check came to -------------------------------------------------------------------------------------

const CHECK_TYPES = new Set(["build", "test", "verify"]);

// A runner that aborted before any case ran is BLOCKED -- an environment's doing, never a pass and never a failure of
// the code -- whatever the command's exit said; the engine's own verdict is shown beside it, never replaced.
const CHECK_STATUS = [
  { when: (a) => a.state === "running", status: "RUNNING" },
  { when: (a, o) => Boolean(o?.aborted), status: "BLOCKED" },
  { when: (a) => a.state === "succeeded", status: "PASSED" },
  { when: (a) => a.state === "failed", status: "FAILED" },
  { when: (a) => a.state === "error", status: "BLOCKED" },
  { when: () => true, status: "UNKNOWN" },
];

export const checkStatus = (a, o) => CHECK_STATUS.find((r) => r.when(a, o ?? null)).status;

// What a verification row says, in the seven words (verify.mjs KINDS): failing as before is still FAILED.
const ROW_STATUS = Object.freeze({ passed: "PASSED", asBefore: "FAILED", regressed: "FAILED", blocked: "BLOCKED", owed: "NOT_RUN", excluded: "NOT_RUN", gone: "NOT_RUN", missing: "UNKNOWN" });

const statusSeg = (key) => ((w) => seg(w.word, w.tone))(STATUS_WORDS[key]);

const glyphSeg = (key) => ((w) => seg(`${w.glyph} `, w.tone))(STATUS_WORDS[key]);

// What the runner reported, only that: an abort, the cases it named, its own totals, or why there is nothing.
const totalsWords = (t) => `the runner said ${[`${t.passed ?? 0} passed`, t.failed ? `${t.failed} failed` : null, t.skipped ? `${t.skipped} skipped` : null].filter(Boolean).join(" · ")} of ${t.tests}`;

const OBSERVED = [
  { when: (w) => w.aborted, words: (w) => w.aborted },
  { when: (w) => w.cases, words: (w) => (w.total ? `${w.cases} (${w.total})` : w.cases) },
  { when: (w, o) => Number.isInteger(o.totals?.tests), words: (w, o) => totalsWords(o.totals) },
  { when: (w, o) => w.unavailable && o.command?.purpose !== "build", words: (w) => w.unavailable },
  { when: (w, o) => o.state === "running", words: () => "no case reported yet" },
  { when: () => true, words: () => null },
];

export const observedWords = (o) => ((w) => (w ? OBSERVED.find((r) => r.when(w, o)).words(w, o) : null))(progressWords(o));

// ---- an engineering task's steps -------------------------------------------------------------------------------

const firstChange = (actions) => actions.findIndex((a) => a.type === "implement");

const stepKey = (a, i, first) => (CHECK_TYPES.has(a.type) ? (first < 0 || i < first ? "baseline" : "verify") : a.type);

function addTo(list, key, a) {
  const last = list.at(-1);
  if (last?.key === key) last.actions.push(a);
  return last?.key === key ? list : [...list, { key, actions: [a] }];
}

// Consecutive actions of one step are one row, in the journal's order.
const stepsOf = (actions) => ((first) => actions.reduce((list, a, i) => addTo(list, stepKey(a, i, first), a), []))(firstChange(actions));

const STEP_STATUS = [
  { when: (as) => as.some((a) => a.state === "running"), status: "RUNNING" },
  { when: (as, os) => as.some((a) => CHECK_TYPES.has(a.type) && checkStatus(a, os[a.id]) === "BLOCKED"), status: "BLOCKED" },
  { when: (as) => as.some((a) => a.state === "failed" || a.state === "error"), status: "FAILED" },
  { when: (as) => as.length > 0 && as.every((a) => a.state === "succeeded"), status: "PASSED" },
  { when: () => true, status: "UNKNOWN" },
];

const stepStatus = (actions, observations) => STEP_STATUS.find((r) => r.when(actions, observations ?? {})).status;

// Taking a baseline is DONE once its runs ended, whatever they came to: a check failing before the change is what the
// baseline records (each run says so under it), not a step that failed. A run that could not run at all still blocks.
const baselineStatus = (actions, observations) => ((st) => (st === "FAILED" ? "PASSED" : st))(stepStatus(actions, observations));

const STATUS_OF_STEP = { baseline: baselineStatus };

const statusOfStep = (s, observations) => (STATUS_OF_STEP[s.key] ?? stepStatus)(s.actions, observations);

const indent = (depth) => "  ".repeat(depth);

// A step's detail is said on the right of a step of the work, and after the label of a step inside one (0.0.2).
const stepRow = (key, status, words, detail, depth) => row([seg(indent(depth)), glyphSeg(status), seg(words, "label"), depth > 0 && detail ? dim(`  ${detail}`) : null], depth === 0 && detail ? [dim(detail)] : [], { depth, status });

// The step a person's eye goes to, in the brand's tone (0.0.2): the one running, else the newest that ran.
const emphasized = (r) => ({ ...r, left: r.left.map((s, i) => (i === 1 || i === 2 ? { ...s, tone: "title" } : s)) });

// The baseline is a CARD (0.0.2, ADR 0028): its head names it with a column for what each run came to, its runs inside.
const cardHead = (words, depth, status) => row([seg(indent(depth)), seg("▶ ", "subtle"), seg(words, "label")], [dim("status")], { depth, status, box: "baseline" });

// One check run under the baseline: what it ran, what it came to, what its runner reported.
const runRow = (a, o, depth, box = null) => ((status) => row([seg(indent(depth)), glyphSeg(status), seg(str(a.label) ?? a.type), dim(observedWords(o) ? `  ${observedWords(o)}` : "")], [statusSeg(status)], { depth, status, card: true, box }))(checkStatus(a, o));

// The runs that verify the change: those after its first implementation -- a baseline run is the base revision's,
// never the change's, however the check is named.
const afterChange = (actions) => ((first) => (first < 0 ? [] : actions.slice(first + 1)))(firstChange(actions));

// One check the change is held to: running now, or what the engine's verification row says; an aborted latest run
// is BLOCKED with the engine's own word beside it.
function heldRow(snap, v, depth) {
  const run = afterChange(snap.view.actions).filter((a) => a.tool === v.subject && CHECK_TYPES.has(a.type)).at(-1) ?? null;
  const o = run ? snap.observations?.[run.id] : null;
  const status = run?.state === "running" ? "RUNNING" : o?.aborted ? "BLOCKED" : ROW_STATUS[kindOf(v).kind];
  const note = [status === "BLOCKED" && o?.aborted ? `held as ${kindOf(v).word}` : null, kindOf(v).kind === "excluded" ? "not affected" : null, kindOf(v).kind === "asBefore" ? "as before the change" : null, run ? observedWords(o) : null].filter(Boolean).join(" · ");
  return row([seg(indent(depth)), glyphSeg(status), seg(String(v.obligation ?? v.subject).replace(/ — not affected, not run$/, "")), dim(note ? `  ${note}` : "")], [statusSeg(status)], { depth, status, card: true });
}

const fileRow = (p, depth) => row([seg(indent(depth)), seg(`${String(p.change ?? "modified").slice(0, 1).toUpperCase()} `, "info"), seg(p.path)], [dim(`+${p.added ?? 0} −${p.removed ?? 0}`)], { depth, status: "PASSED" });

const HELD_ORDER = ["regressed", "blocked", "owed", "asBefore", "passed", "missing", "excluded"];

const heldRows = (snap, depth) => ((g) => HELD_ORDER.flatMap((k) => g[k]).map((v) => heldRow(snap, v, depth)))(grouped(snap.view));

// What sits under a step: the baseline's runs, the files the last change touched, what the change is held to.
const NESTED = {
  baseline: (snap, s, depth) => s.actions.map((a) => runRow(a, snap.observations?.[a.id], depth, "baseline")),
  implement: (snap, s, depth, last) => (last.implement === s ? (snap.view.changes?.paths ?? []).slice(0, 8).map((p) => fileRow(p, depth)) : []),
  verify: (snap, s, depth, last) => (last.verify === s ? heldRows(snap, depth) : s.actions.map((a) => runRow(a, snap.observations?.[a.id], depth))),
};

const lastOf = (list) => ({ implement: list.filter((s) => s.key === "implement").at(-1), verify: list.filter((s) => s.key === "verify").at(-1) });

const stepDetail = (s) => str(s.actions.at(-1)?.summary) ?? str(s.actions.at(-1)?.label);

const HEADS = { baseline: (s, status, depth) => cardHead(STEP_WORDS.baseline, depth, status) };

const headOf = (s, status, depth) => (HEADS[s.key] ?? ((x) => stepRow(x.key, status, STEP_WORDS[x.key] ?? x.key, CHECK_TYPES.has(x.actions[0]?.type) ? null : stepDetail(x), depth)))(s, status, depth);

const stepRows = (snap, s, depth, last) => [headOf(s, statusOfStep(s, snap.observations), depth), ...(NESTED[s.key]?.(snap, s, depth + 1, last) ?? [])];

// The checks the plan holds the change to, before any of them ran: a step the impact receipt itself named.
const pendingVerify = (snap, list, depth) => (snap.view.verification?.length && !list.some((s) => s.key === "verify") && !snap.view.terminal ? [stepRow("verify", "NOT_RUN", STEP_WORDS.verify, "required by the plan, not run yet", depth), ...heldRows(snap, depth + 1)] : []);

function engineeringRows(snap, depth) {
  const list = stepsOf(snap.view.actions);
  const last = lastOf(list);
  return [...list.flatMap((s) => stepRows(snap, s, depth, last)), ...pendingVerify(snap, list, depth)];
}

// ---- a coordinated workflow's steps --------------------------------------------------------------------------------

const OUTCOME_STATUS = Object.freeze({ SUCCEEDED: "PASSED", FAILED: "FAILED", BLOCKED: "BLOCKED", RUNNING: "RUNNING", PENDING: "NOT_RUN", SKIPPED: "NOT_RUN", REPORTED: "UNKNOWN" });

const childSteps = (ctx, name) => (name === "engineering" && ctx.d.child?.view ? engineeringRows(ctx.d.child, 1) : []);

// A step's words: its kind's, and the capability it is for when the plan has one step of its kind per capability
// (1.8.6: `playbook.release.gate` reads "Playbook · release.gate").
const stepLabel = (name, plan) => ((p) => (p?.for ? `${WORKFLOW_STEP_WORDS[p.kind] ?? p.kind} · ${p.for}` : WORKFLOW_STEP_WORDS[name] ?? WORKFLOW_STEP_WORDS[p?.kind] ?? name))(plan?.steps?.find((x) => x.id === name));

const outcomeOf = (s, name) => s.receipts.get(name)?.outcome ?? "PENDING";

const focusName = (s) => s.names.find((n) => outcomeOf(s, n) === "RUNNING") ?? s.names.filter((n) => outcomeOf(s, n) !== "PENDING").at(-1) ?? null;

const workflowStepRow = (ctx, s, name) => ((outcome) => stepRow(name, OUTCOME_STATUS[outcome] ?? "UNKNOWN", stepLabel(name, ctx.d.root?.plan), outcome === "REPORTED" ? "reported, no receipt" : null, 0))(outcomeOf(s, name));

function workflowRows(ctx, view) {
  const s = workflowSteps(view, ctx.d.root?.plan);
  const focus = focusName(s);
  return s.names.flatMap((name) => [((r) => (name === focus ? emphasized(r) : r))(workflowStepRow(ctx, s, name)), ...childSteps(ctx, name)]);
}

export function checklistOf(ctx) {
  const root = ctx.d.root;
  if (root?.view && isCoordinator(root.view)) return workflowRows(ctx, root.view);
  return ctx.d.engineering?.view ? engineeringRows(ctx.d.engineering, 0) : [];
}

// ---- the task worked on now ---------------------------------------------------------------------------------------

const labelled = (label, segs) => row([dim(`${label.padEnd(10)}`), ...segs], [], { label });

const lifecycleSeg = (view) => ((w) => seg(w?.word ?? view.lifecycle ?? "UNKNOWN", w?.tone ?? "info"))(LIFECYCLE_WORDS[view.lifecycle]);

const actionStatus = (a) => (CHECK_TYPES.has(a.kind) ? checkStatus({ state: a.state }, a.observation) : stepStatus([{ state: a.state }], {}));

const runsWords = (a) => ((c) => (c ? [str(c.program), str(c.declaredAs) ?? str(c.purpose)].filter(Boolean).join(" · ") : str(a.how)))(a.observation?.command);

const filesWords = (view) => ((paths) => (paths.length ? `${paths.slice(0, 3).map((p) => p.path).join(", ")}${paths.length > 3 ? ` +${paths.length - 3} more` : ""}` : null))(view.changes?.paths ?? []);

const attemptWords = (view) => (view.attempt?.number ? `attempt ${view.attempt.number}/${view.attempt.limit ?? "?"}` : null);

function blockerWords(view) {
  const g = view.verification?.length ? grouped(view) : null;
  const parts = [g?.regressed.length && `${g.regressed.length} regressed`, g?.blocked.length && `${g.blocked.length} could not run`, g?.missing.length && `${g.missing.length} with nothing to verify it`, view.blocked && `blocked: ${view.blocked.stop}`, view.stopReason && `stopped: ${view.stopReason}`];
  return parts.filter(Boolean).join(" · ") || null;
}

const nextWords = (a) => (a?.next?.decided ? `decided: ${a.next.decided}` : a?.next?.waiting ? `awaiting ${a.next.waiting}` : null);

// What the work is about (1.8.6): the work item and requirement the task stands on, as its journal names them --
// never a title or a criterion nobody recorded. A snapshot's clarity is its requirement receipt's own word.
const requirementReceipt = (view) => (view?.receipts ?? []).filter((r) => r.domain === "requirement").at(-1) ?? null;

const workWords = (view) => ((t, r) => [t?.work, t?.root, t?.snapshot ?? r?.ref, r?.summary ? r.summary.replace(/^snapshot rs-[0-9a-f]+,\s*/, "") : null].filter(Boolean).join(" · ") || null)(view?.task, requirementReceipt(view));

// A coordinated workflow's step running now, else the one whose turn is next -- and why it is in the plan.
const stepWords = (root) => ((now, next) => (now ? `${now.id} — ${now.because ?? "running"}` : next ? `next: ${next.id} — ${next.because ?? "ready"}` : null))(currentStepOf(root), nextStepOf(root));

// What the skill factory is doing for a capability whose playbook is not followed yet.
const skillWords = (root) => ((k) => (k ? `${k.capability ?? "a capability"} · registered ${k.registered}${k.reused ? " (reused)" : ""}` : null))(skillsOf(root?.plan, root?.view).find((k) => !["SUCCEEDED", "REPORTED"].includes(k.followed ?? "")));

// Where what the action row says comes from: a check runner's own output, or an action that ENDED with a receipt, is
// OBSERVED; anything else -- a step a host is still running, an action that ended with no receipt -- is what was
// REPORTED: a receipt linked while a host works proves what the engine did before it, never what the host does.
const provenanceOf = (a) => (a.observation || (a.state !== "running" && a.evidence === "receipt") ? "observed" : "reported");

const provenanceSeg = (a) => ((w) => dim(`  ${w.word}`))(PROVENANCE_WORDS[provenanceOf(a)]);

// Each field, in the order a person reads them; one that nothing recorded is not drawn. `narrow` keeps the first few.
const CURRENT = [
  { label: "task", narrow: true, segs: (c) => [seg(c.view.task?.id ?? "?", "label"), dim(str(c.view.task?.objective) ? ` · ${c.view.task.objective}` : "")] },
  { label: "work", narrow: false, segs: (c) => [workWords(c.root?.view ?? c.view) ? seg(workWords(c.root?.view ?? c.view)) : dim("Not available — no work item or requirement was named")] },
  { label: "stage", narrow: false, segs: (c) => joined([lifecycleSeg(c.view), str(c.view.stage) && seg(c.view.stage), str(attemptWords(c.view)) && dim(attemptWords(c.view))]) },
  { label: "step", narrow: true, segs: (c) => (stepWords(c.root) ? [seg(stepWords(c.root))] : null) },
  { label: "action", narrow: true, segs: (c) => (c.a ? [seg(`${c.a.id} · ${c.a.kind}`, "label"), seg(` · ${c.a.what}`), provenanceSeg(c.a)] : null) },
  { label: "goal", narrow: false, segs: (c) => (c.a?.why ? [seg(c.a.why)] : null) },
  { label: "runs", narrow: false, segs: (c) => (c.a && runsWords(c.a) ? [seg(runsWords(c.a))] : null) },
  { label: "component", narrow: false, segs: (c) => (c.a?.where ? [seg(c.a.where)] : null) },
  { label: "files", narrow: false, segs: (c) => (filesWords(c.view) ? [seg(filesWords(c.view))] : null) },
  { label: "time", narrow: false, segs: (c) => (c.a && between(c.a.startedAt, c.a.endedAt, c.nowMs) ? [dim(between(c.a.startedAt, c.a.endedAt, c.nowMs))] : null) },
  { label: "observed", narrow: true, segs: (c) => (c.a && observedWords(c.a.observation) ? [seg(observedWords(c.a.observation))] : null) },
  { label: "status", narrow: true, segs: (c) => (c.a ? [glyphSeg(actionStatus(c.a)), statusSeg(actionStatus(c.a))] : null) },
  { label: "skill", narrow: false, segs: (c) => (skillWords(c.root) ? [seg(skillWords(c.root), "info")] : null) },
  { label: "blocker", narrow: false, segs: (c) => (blockerWords(c.view) ? [seg(blockerWords(c.view), "warning")] : null) },
  { label: "next", narrow: true, segs: (c) => (nextWords(c.a) ? [seg(nextWords(c.a), "info")] : null) },
  { label: "session", narrow: true, segs: (c) => c.session },
];

// The task a session's work began from: the workflow's when there is one, so a host step's tools count from its start.
const sinceOf = (ctx, snap) => (ctx.d.root?.view ?? snap.view).task?.createdAt ?? null;

const currentFacts = (ctx, snap) => ({ view: snap.view, a: focusOf(snap.activities), nowMs: ctx.nowMs, root: isCoordinator(ctx.d.root?.view) ? ctx.d.root : null, session: sessionLine(ctx, sinceOf(ctx, snap)) });

const NO_TASK = "no task here yet: one started in this checkout is shown by itself";

function taskRows(ctx, narrow) {
  const snap = chosen(ctx);
  if (!snap?.view) return sessionOf(ctx) ? sessionNowRows(ctx, narrow) : [row([dim(NO_TASK)])];
  const c = currentFacts(ctx, snap);
  return CURRENT.filter((f) => !narrow || f.narrow).map((f) => ({ f, segs: f.segs(c) })).filter((x) => x.segs?.length).map((x) => labelled(x.f.label, x.segs));
}

// The tracked work (1.8.8) is drawn ABOVE the task's rows and the session's raw tool list: it is what the person asked for.
// 1.8.9: the lifecycle rows (lifecycle-view.mjs) between the tracked work and the task: what the work gathered, what
// memory answered, where engineering stands and what it taught -- each off a journal line, never a guess.
export const currentRows = (ctx, narrow = false) => [...workNowRows(ctx, narrow), ...lifecycleRows(ctx, narrow), ...taskRows(ctx, narrow)];

// ---- the status bar -----------------------------------------------------------------------------------------------

const settledOf = (view) => ((g) => (g ? { settled: g.passed.length + g.asBefore.length, held: ["passed", "asBefore", "regressed", "blocked", "owed"].reduce((n, k) => n + g[k].length, 0) } : null))(view?.verification?.length ? grouped(view) : null);

const lastTest = (snap) => (snap?.activities ?? []).filter((a) => a.kind === "test" && a.observation).at(-1)?.observation ?? null;

const testsWords = (o) => (o ? (Number.isInteger(o.totals?.tests) ? `${o.totals.passed ?? 0}/${o.totals.tests}` : `${o.counts?.passed ?? 0}/${Number.isInteger(o.total) ? o.total : `${o.reported ?? 0}?`}`) : null);

// A coordinated workflow's steps are DONE on its plan's own contract -- the count the TASK line shows (1.8.6): a step that
// may stand on a report is done once reported, and a bar that counted only PASSED said 7/8 beside a COMPLETED workflow.
// Any other task counts the checklist's steps that PASSED.
const stepsCount = (c) => (c.plan ? `${c.plan.done}/${c.plan.total}` : `${c.steps.filter((r) => r.status === "PASSED").length}/${c.steps.length}`);

const planCountOf = (ctx) => ((p) => (p.basis === "plan" ? p : null))(taskProgressOf(ctx));

const BAR_PARTS = [
  (c) => (c.plan || c.steps.length ? seg(`STEPS ${stepsCount(c)}`) : null),
  (c) => (c.settled ? seg(`CHECKS ${c.settled.settled}/${c.settled.held}`) : null),
  (c) => (testsWords(c.test) ? seg(`TESTS ${testsWords(c.test)}`) : null),
  (c) => (c.view ? lifecycleSeg(c.view) : null),
];

// The LIVE indicator (1.8.6): the viewer's state and the task's lifecycle in one word; its glyph pulses only on
// evidence, and stands still for a person who asked for no motion. A coordinated workflow's work happens in the
// engineering task it started: while that one moves and the workflow's own journal reads fine, ITS evidence is what
// the indicator pulses on -- the lifecycle stays the workflow's.
const readable = (snap) => ["LIVE", "IDLE"].includes(snap?.presentation?.state);

const movingOf = (root, child) => (root?.view && readable(root) && child?.presentation?.state === "LIVE" ? { ...root, presentation: child.presentation } : root);

// No task, and this session's tools did something: the session's own indicator, which never claims a task moved.
const noTask = (ctx) => !ctx.d.root?.view && !chosen(ctx)?.view;

export const sessionShown = (ctx) => noTask(ctx) && ((a) => Boolean(a) && (a.observed > 0 || a.running.length > 0))(sessionOf(ctx));

export const indicatorFor = (ctx) => (sessionShown(ctx) ? sessionIndicator(sessionOf(ctx)) : indicatorOf(movingOf(ctx.d.root ?? chosen(ctx), ctx.d.child), ctx.state.viewer.settings));

// The status bar ends in the indicator's WORD (0.0.2): its glyph is the header's badge's.
const indicatorText = (i) => i.word;

const indicatorSeg = (i) => seg(indicatorText(i), i.tone);

export function statusBarOf(ctx, checklist = checklistOf(ctx)) {
  if (noTask(ctx) && sessionOf(ctx)) return sessionBarOf(ctx);
  const snap = chosen(ctx);
  const c = { steps: checklist.filter((r) => r.depth === 0), plan: planCountOf(ctx), settled: settledOf(ctx.d.engineering?.view), test: lastTest(ctx.d.engineering ?? snap), view: snap?.view ?? null };
  const i = indicatorFor(ctx);
  return row(joined(BAR_PARTS.map((f) => f(c)), "  ·  "), [indicatorSeg(i)]);
}

// ---- the views a person switches between ------------------------------------------------------------------------

const caseRow = (r) => row([seg(`${r.state === "passed" ? "✓" : r.state === "failed" ? "✗" : "-"} `, r.state === "passed" ? "success" : r.state === "failed" ? "danger" : "subtle"), seg(r.name ?? r.key)], r.durationMs ? [dim(`${r.durationMs}ms`)] : []);

const failureRow = (f) => row([seg("✗ ", "danger"), seg(f.name ?? f.key ?? "?", "danger"), dim(` — ${f.category}`), seg(f.message ? `: ${String(f.message).replace(/\s+/g, " ")}` : ""), dim(f.location ? `  (${f.location})` : "")]);

// What the case expected and what it got, when its runner printed them as such (1.8.6) -- under the failure.
const expectedRow = (f) => (f.expected || f.actual ? [row([dim("    expected "), seg(f.expected ?? "?"), dim("  actual "), seg(f.actual ?? "?", "danger")], [], { depth: 1 })] : []);

function testRows(snap) {
  const a = (snap?.activities ?? []).filter((x) => CHECK_TYPES.has(x.kind) && x.observation).at(-1);
  if (!a) return [row([dim("no build or test has reported anything yet")])];
  const o = a.observation;
  return [row([seg(`${a.id} · ${a.what}`, "label")], [dim(observedWords(o) ?? "")]), ...o.failures.slice(0, 5).flatMap((f) => [failureRow(f), ...expectedRow(f)]), ...o.recent.slice(-30).reverse().map(caseRow)];
}

const changeRows = (view) => ((paths) => (paths.length ? paths.map((p) => fileRow(p, 0)) : [row([dim("no file changed yet")])]))(view?.changes?.paths ?? []);

const sectionRows = (s) => (s ? [...(s.head ? [s.head] : []), ...s.rows] : [row([dim("nothing yet")])]);

export const timelineRowsWanted = (ctx) => ctx.state.viewer.settings?.pane?.timelineRows ?? 30;

// Each view by its id, in PANE_VIEWS' order (model.mjs) -- the order keys 1 to 6 and a docked pane's tabs share.
const VIEWS = {
  events: { label: "Events", rows: (ctx) => eventsView(ctx).rows, hint: (ctx) => eventsView(ctx).hint },
  tests: { label: "Tests", rows: (ctx) => testRows(ctx.d.engineering ?? chosen(ctx)) },
  changes: { label: "Changes", rows: (ctx) => changeRows((ctx.d.engineering ?? chosen(ctx))?.view) },
  notices: { label: "Notices", rows: (ctx) => sectionRows(noticesSection(ctx)) },
  plan: { label: "Plan", rows: (ctx) => planRows(ctx) },
  timeline: { label: "Timeline", rows: (ctx) => timelineRows(ctx, timelineRowsWanted(ctx)) },
};

// This session's own rows instead (1.8.7): every one when there is no task, and beside a task only where the task has
// nothing of its own to show and the session does -- a host step's checks and edits, which no journal follows.
const shownTask = (ctx) => ctx.d.engineering ?? chosen(ctx);

const SESSION_INSTEAD = {
  tests: (ctx, a) => (a.checks.length > 0 || a.running.some((e) => e.class !== "other")) && !(shownTask(ctx)?.activities ?? []).some((x) => CHECK_TYPES.has(x.kind) && x.observation),
  changes: (ctx, a) => a.files.length > 0 && !(shownTask(ctx)?.view?.changes?.paths ?? []).length,
};

const sessionInstead = (ctx, id) => ((a) => Boolean(a) && (noTask(ctx) || SESSION_INSTEAD[id]?.(ctx, a) === true))(sessionOf(ctx));

const rowsOfView = (ctx, id) => (sessionInstead(ctx, id) && sessionViewRows(ctx, id)) || VIEWS[id].rows(ctx);

// What a view shows, in its own words (0.0.2): the tabs' hint. A session's own rows have none.
const hintOfView = (ctx, id) => (sessionInstead(ctx, id) ? null : VIEWS[id].hint?.(ctx) ?? null);

const viewAt = (ctx, id) => ({ id, label: VIEWS[id].label, rows: rowsOfView(ctx, id), hint: hintOfView(ctx, id) });

export const viewsOf = (ctx) => PANE_VIEWS.map((id) => viewAt(ctx, id));

export const viewOf = (ctx, id) => viewAt(ctx, VIEWS[id] ? id : PANE_VIEWS[0]);
