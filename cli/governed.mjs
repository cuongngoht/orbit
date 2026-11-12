// THIS SESSION'S GOVERNED WORK (0.5.0, B22 M3, ADR 0050): which coordinated workflow, goal, engineering task, tracked
// work or Satellite mission a hook's session holds in this checkout, and where each stands -- for the hooks that follow
// a session's work through: the Stop hold and the agent-return line (cli/follow-hook.mjs), and a resumed session's open
// work and the failure-recovery row (cli/learn-hook.mjs). Not an entry point: a composition helper that binds the
// owners' own stores and folds, which nothing under src/lifecycle/ may import, and hands back table words and ids:
//
//   { kind, id, lifecycle, state, ready, open, run }    kind: workflow · goal · task · investigation · mission
//
//   lifecycle   the owner's own word (EXECUTING, running, RUNNING ...), said as it is
//   state       what a follow-through asks of it, one of STATES: running, or why not -- a person's pause or cancel,
//               a wait for a person (an approval, an answer), blocked, stopping (the owner's own stop rule says it
//               must end: no progress, a spent budget), ended
//   ready       the steps (a workflow's), units (a goal's) its own fold says may run next
//   open        a workflow's steps that started and wait to be settled
//
// WHICH task is this session's is src/live/association.mjs's table, over rows read from each journal's first line
// (`created.session`) and its last bytes, the way cli/live.mjs reads them -- never the newest task on the machine, and
// only the table's own rows for THIS session (coordinator, session): a pin or "the one task in this checkout" is a
// viewer's choice, never a session's work. A goal is this session's by its own first line. Finding the checkout spawns
// no git: a walk up to `.git` and the binding Orbit's first write in it left. Everything is read lazily, at most once,
// and a read that fails is null -- a hook that cannot tell says nothing. Nothing here writes.
//
// 0.6.0 (P3) `owed()`: what this session's edits still owe a check -- the working set's `unverified.changed` (edits
// since the last test that PASSED), the components of runtime understanding's graph that own them (the composition
// root hands their list in as `components`, read with `look`, writing nothing) and, through the verification plan
// (src/orchestration/obligations.mjs `planOf`, as cli/context-grounding.mjs asks it), a declared SAFE verifying check
// of one of them: { changed, paths, components, check, declaredPassed, tests } -- `check` with its argv as the checkout
// declared it, or null; `declaredPassed` when one of those declared verifying checks passed after the last edit (its
// command's class and executable among the working set's `unverified.ran`: a lint or a build alone never clears, but a
// component's own declared verifying check does); and, when `check` is null, `tests`: the tracked test files the relation pack links to the edited files (0.6.0, P3b:
// the relation adapters' `testsOf`, bound as the context package binds them, cli/relations-port.mjs), at most
// TESTS_NAMED -- named, never a command: nothing declared how this checkout runs them.
import { join } from "node:path";
import { parseRunRef } from "../src/attribution.mjs";
import { readyOf, stateOf } from "../src/automation/plan.mjs";
import { stopOf } from "../src/automation/stop.mjs";
import { DOMAIN } from "../src/automation/vocab.mjs";
import { createGoals } from "../src/goal/store.mjs";
import { frontierOf, lifecycleOf as goalLifecycleOf, modelOf as goalModelOf } from "../src/goal/model.mjs";
import { createInvestigations } from "../src/investigation/store.mjs";
import { modelOf as investigationModelOf } from "../src/investigation/model.mjs";
import { associate } from "../src/live/association.mjs";
import { taskSessionMark } from "../src/memory/session.mjs";
import { repositoryAt } from "../src/project/boundary.mjs";
import { checkoutId, projectStoreRoot, storeBase } from "../src/project/repository.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { TASK_SOURCE } from "../src/task/live.mjs";
import { modelOf as taskModelOf } from "../src/task/model.mjs";
import { createTasks, journalLine } from "../src/task/store.mjs";
import { taskView } from "../src/task/views.mjs";
import { createWorks } from "../src/work/store.mjs";
import { commandOf } from "../src/engineering/working-set/collect.mjs";
import { fold } from "../src/engineering/working-set/fold.mjs";
import { createWorkingSet } from "../src/engineering/working-set/store.mjs";
import { checksOf } from "../src/orchestration/checks.mjs";
import { DIRECT } from "../src/orchestration/impact.mjs";
import { planOf as verificationPlanOf } from "../src/orchestration/obligations.mjs";
import { VERIFYING } from "../src/orchestration/vocab.mjs";
import { switchOf } from "../src/project/env.mjs";
import { loadProject } from "../src/project/index.mjs";
import { workingSetDir } from "../src/project/runtime.mjs";
import { componentGraphOf } from "../src/runtime/graph.mjs";
import { openWorkOf } from "../src/work/track/open.mjs";
import { missionDirOf, roomsOf } from "../satellite/src/store/rooms.mjs";
import { sourceOf, testsLinked, treeIn } from "./relations-port.mjs";
import { journalLine as missionLine } from "../satellite/src/store/line.mjs";
import { modelOf as missionModelOf } from "../satellite/src/mission/fold.mjs";
import { lifecycleOf as missionLifecycleOf } from "../satellite/src/mission/state.mjs";

export const STATES = ["running", "paused", "cancelled", "waiting", "blocked", "stopping", "ended"];

// A journal touched in the last week is a candidate; at most this many first lines are read for one look.
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HEADS = 200;
const HEAD_BYTES = 8192;
const TAIL_BYTES = 16384;

// ---- each owner's own word, in a follow-through's: ordered where an order matters, the last always answering -------

// A workflow stands where its OWN stop table (src/automation/stop.mjs) says, or it runs.
const WORKFLOW_STATE = { cancelled: "cancelled", ended: "ended", paused: "paused", "waiting-approval": "waiting", "no-progress": "stopping", budget: "stopping", blocked: "blocked" };

const TASK_STATE = { CANCELLED: "cancelled", COMPLETED: "ended", FAILED: "ended", PAUSED: "paused", WAITING_APPROVAL: "waiting", BLOCKED: "blocked" };

const GOAL_STATE = { cancelled: "cancelled", completed: "ended", failed: "ended", partial: "ended", paused: "paused", "waiting-approval": "waiting", "waiting-input": "waiting", blocked: "blocked" };

const INVESTIGATION_STATE = { completed: "ended", cancelled: "cancelled", paused: "paused" };

const MISSION_STATE = { COMPLETED: "ended", REPORTED: "ended", FAILED: "ended", CANCELLED: "cancelled", BLOCKED: "blocked" };

// ---- reading, quietly ---------------------------------------------------------------------------------------------

const quietly = (fn) => {
  try { return fn(); }
  catch { return null; }
};

function once(fn) {
  const memo = {};
  return () => ("value" in memo ? memo.value : (memo.value = quietly(fn)));
}

const readJson = (io, file) => quietly(() => JSON.parse(io.read(file) ?? "null"));

// The checkout `cwd` is in, if Orbit has ever written for it: walk up to `.git`, hash the root the way every subject keys
// a checkout, and read the binding its first write left (cli/live.mjs `located`, read the same way).
function placeOf(env, cwd, io) {
  const root = repositoryAt(cwd);
  const base = storeBase(env);
  const binding = root ? readJson(io, join(stateRooms(base).checkouts, `${checkoutId(root)}.json`)) : null;
  return binding?.key ? { root, base, checkoutId: checkoutId(root), key: binding.key, storeRoot: projectStoreRoot(base, binding.key) } : null;
}

// ---- which task is this session's: the association table over each journal's first line --------------------------

const headOf = (io, file) => ((got) => ((text) => (text.includes("\n") ? journalLine(text.slice(0, text.indexOf("\n"))) : null))(got ? got.buffer.toString("utf8") : ""))(quietly(() => io.readFrom(file, 0, HEAD_BYTES)));

function endOf(io, file) {
  const size = io.size(file) ?? 0;
  const got = quietly(() => io.readFrom(file, Math.max(0, size - TAIL_BYTES), TAIL_BYTES));
  const lines = got ? got.buffer.toString("utf8").split("\n").slice(size > TAIL_BYTES ? 1 : 0) : [];
  return lines.map((l) => journalLine(l.replace(/\r$/, ""))).find((r) => r && TASK_SOURCE.ends.includes(r.kind)) ?? null;
}

// The tasks a session's work is governed by: a coordinated workflow (provider automation), which `coordinates` -- the
// one a session's turn goes on through -- and an engineering task (autonomous engineering). A release ship, a benchmark
// run or a campaign is a task too, and none of them is a session's governed work.
const GOVERNED = ["automation", "autonomous-engineering"];

const taskRow = (io, file, head) => ((end) => ({ id: head.id, checkout: head.checkout, session: head.session ?? null, terminal: end !== null, createdAt: head.at ?? "", endedAt: end?.at ?? null, coordinates: head.provider === "automation" }))(endOf(io, file));

const governedHead = (c) => ({ head }) => head?.kind === "created" && head.checkout === c.place.checkoutId && GOVERNED.includes(head.provider);

function taskRows(c) {
  const files = c.tasks.list().map((id) => c.tasks.journalFile(id)).filter((f) => c.nowMs - (c.io.mtime(f) ?? 0) <= RECENT_MS).slice(-MAX_HEADS);
  return files.map((file) => ({ file, head: headOf(c.io, file) })).filter(governedHead(c)).map(({ file, head }) => taskRow(c.io, file, head));
}

// THIS session's only: the table's coordinator and session rows -- a pin, a checkout's one task or a finished one is a
// viewer's choice, never a session's work.
const MINE = ["coordinator", "session"];

const associated = (c, rows) => ((a) => (MINE.includes(a.how) ? { how: a.how, id: a.task } : null))(associate({ explicit: null, pins: {}, mark: c.mark, checkout: c.place.checkoutId, rows, now: c.nowMs, finishedForMs: 0 }));

// ---- where a task stands ------------------------------------------------------------------------------------------

const viewOf = (c, id) => taskView(taskModelOf(c.tasks.read(id) ?? []), c.now);

const activePlan = (view) => view.receipts.filter((r) => r.domain === DOMAIN.PLAN && r.outcome === "ACTIVE").at(-1)?.ref ?? null;

const planOf = (c, id, view) => ((ref) => (ref ? readJson(c.io, join(c.place.storeRoot, "automation", id, "plans", `${ref}.json`)) : null))(activePlan(view));

function workflowOwner(c, id) {
  const view = viewOf(c, id);
  const plan = planOf(c, id, view);
  const states = plan?.steps ? stateOf(plan, view) : [];
  const stop = stopOf({ view, states });
  return { kind: "workflow", id, lifecycle: view.lifecycle, state: stop ? WORKFLOW_STATE[stop.id] ?? "stopping" : "running", ready: stop ? [] : readyOf(states).map((s) => s.id), open: states.filter((s) => s.state === "running").map((s) => s.id) };
}

const taskOwner = (c, kind, id) => ((view) => ({ kind, id, lifecycle: view.lifecycle, state: TASK_STATE[view.lifecycle] ?? "running", ready: [], open: [] }))(viewOf(c, id));

// ---- a goal is this session's by its own first line ------------------------------------------------------------------

function goalRows(c) {
  const ids = c.goals.list().filter((id) => c.nowMs - (c.io.mtime(c.goals.journalFile(id)) ?? 0) <= RECENT_MS).slice(-MAX_HEADS);
  return ids.map((id) => ({ id, model: quietly(() => goalModelOf(c.goals.read(id) ?? [])) })).filter((g) => g.model?.meta?.checkout === c.place.checkoutId).map(goalRow);
}

const ENDED_GOAL = ["completed", "failed", "partial", "cancelled"];

const goalRow = (g) => ({ id: g.id, checkout: g.model.meta.checkout, session: taskSessionMark(g.model.meta.session), terminal: ENDED_GOAL.includes(goalLifecycleOf(g.model)), createdAt: g.model.meta.at ?? "", endedAt: null, coordinates: true, model: g.model });

// A goal's next step: the units its frontier says may start, and once every unit is done, its verification.
const unitsReady = (model, lifecycle) => [...frontierOf(model).map((u) => u.id), ...(lifecycle === "verifying" ? ["verify"] : [])];

const goalOwner = (row) => ((lifecycle) => ({ kind: "goal", id: row.id, lifecycle, state: GOAL_STATE[lifecycle] ?? "running", ready: unitsReady(row.model, lifecycle), open: [] }))(goalLifecycleOf(row.model));

// ---- the session's tracked work, and who governs it (src/work/track/open.mjs) ---------------------------------------

const investigationOwner = (c, id) => ((m) => ({ kind: "investigation", id, lifecycle: m.lifecycle, state: INVESTIGATION_STATE[m.lifecycle] ?? "running", ready: [], open: [] }))(investigationModelOf(createInvestigations(c.place.storeRoot, c.io).read(id)));

const OWNER_OF = { workflow: (c, id) => workflowOwner(c, id), task: (c, id) => taskOwner(c, "task", id), investigation: (c, id) => investigationOwner(c, id) };

const workOwner = (c) => ((w) => (w?.open && OWNER_OF[w.owner?.what] ? { ...OWNER_OF[w.owner.what](c, w.owner.id), work: w.id } : null))(openWorkOf(createWorks(c.place.storeRoot, c.io), { refs: [], continued: true, session: c.mark, checkout: c.place.checkoutId }).current);

// ---- a mission, by the run an Agent call's envelope named ----------------------------------------------------------

const missionRecords = (c, id) => String(c.io.read(join(missionDirOf(roomsOf(c.place.storeRoot), id), "journal.jsonl")) ?? "").split("\n").map(missionLine).filter(Boolean);

function missionOwner(c, ref) {
  const named = parseRunRef(ref);
  const lifecycle = named ? missionLifecycleOf(missionModelOf(missionRecords(c, named.mission))) : null;
  return lifecycle ? { kind: "mission", id: named.mission, run: named.run, lifecycle, state: MISSION_STATE[lifecycle] ?? "running", ready: [], open: [] } : null;
}

// ---- what this session's edits still owe a check (0.6.0, P3) -------------------------------------------------------

// The session's working-set lines, where the working-set subscriber writes them: under the project the host names
// (CLAUDE_PROJECT_DIR), else the one the hook ran in -- and none while a person switched the working set off.
function sessionLines(c, opts, project) {
  if (!switchOf(opts.env ?? {}, "WORKING_SET", "working_set", true)) return [];
  return project() ? createWorkingSet(workingSetDir(project()), c.io).read(opts.session) : [];
}

const projectOf = (opts) => [opts.env?.CLAUDE_PROJECT_DIR, opts.cwd].filter(Boolean).map((dir) => quietly(() => loadProject(opts.env, dir))).find(Boolean) ?? null;

// The verification plan's look with nothing done yet: the paths are its scope (cli/context-grounding.mjs reads it so).
const lookAt = (paths, components) => ({ view: { changes: { paths: [] }, actions: [], receipts: [] }, events: [], checks: checksOf(components), planned: () => paths, graph: () => componentGraphOf(components) });

// A check of a component the edit itself reached comes first, then one of a component that depends on it -- never one
// of a component reached only because something it names is unresolved: that verifies nothing about this edit.
const RANK = { MODIFIED: 0, SHARED: 0, DEPENDENT: 1 };

const rankOf = (plan, key) => RANK[plan.impact.components.find((c) => c.key === key)?.reason] ?? null;

const verifyingOf = (plan) => plan.required.filter((c) => VERIFYING.includes(c.purpose) && rankOf(plan, c.component) !== null).sort((a, b) => rankOf(plan, a.component) - rankOf(plan, b.component));

const declaredOf = (components, c) => checksOf(components).find((x) => x.id === c.id && x.component === c.component) ?? null;

// Whether a DECLARED verifying check passed after the last edit: its own command, as the working set classes one (a
// class and a bare executable, collect.mjs `commandOf` -- the working set keeps nothing more), is among what passed.
const ranAs = (check) => commandOf({ command: check.argv.join(" "), ok: true });

const passedIn = (ran, check) => ((cmd) => ran.some((r) => r.class === cmd.class && r.exe === cmd.exe))(ranAs(check));

function checkedFor(changed, components, ran) {
  const plan = verificationPlanOf(lookAt(changed, components));
  const declared = verifyingOf(plan).map((c) => declaredOf(components, c)).filter(Boolean);
  const owning = plan.impact.components.filter((c) => DIRECT.includes(c.reason)).map((c) => c.key);
  return { changed, paths: changed.filter((p) => !plan.impact.unowned.includes(p)), components: owning, check: declared[0] ?? null, declaredPassed: declared.some((c) => passedIn(ran, c)) };
}

// At most this many test files are named for one turn's edits.
export const TESTS_NAMED = 5;

// The tracked tests the relation pack links to the edited files (cli/relations-port.mjs, the binding the context
// package's relations use) -- asked only when no component declares a check; a tree that cannot be listed names none.
const testsFor = (project, changed) => (project ? quietly(() => ((source) => testsLinked(source, treeIn(source), changed, TESTS_NAMED))(sourceOf(project))) ?? [] : []);

const owedFor = (u, components, project) => ((o) => ({ ...o, tests: o.check ? [] : testsFor(project(), u.changed) }))(checkedFor(u.changed, components, u.ran ?? []));

const NOTHING_OWED = Object.freeze({ changed: [], paths: [], components: [], check: null, declaredPassed: false, tests: [] });

function owedOf(c, opts) {
  const project = once(() => projectOf(opts));
  const unverified = fold(sessionLines(c, opts, project)).unverified;
  return unverified.changed.length ? owedFor(unverified, quietly(() => opts.components?.()) ?? [], project) : NOTHING_OWED;
}

// ---- the reader ---------------------------------------------------------------------------------------------------

// What a reader binds once: the checkout, the stores, this session's mark and the clock.
function contextOf(opts) {
  const io = opts.io ?? realIo();
  const place = placeOf(opts.env, opts.cwd, io);
  const nowMs = opts.nowMs ?? Date.now();
  return place ? { io, place, nowMs, now: new Date(nowMs).toISOString(), mark: taskSessionMark(opts.session), tasks: createTasks(place.storeRoot, io), goals: createGoals(place.storeRoot, io) } : null;
}

const ownedBy = (c, a, how) => (a?.how === how ? (how === "coordinator" ? workflowOwner(c, a.id) : taskOwner(c, "task", a.id)) : null);

// The association table's rows for this session's goals: the newest of its own that has not ended.
const goalOf = (c) => ((rows) => ((a) => (a ? goalOwner(rows.find((r) => r.id === a.id)) : null))(associated(c, rows)))(goalRows(c));

// opts: { env, cwd, session (the hook's hashed session), nowMs?, io?, components?() (runtime understanding's, for owed) }
// -- every answer lazy, read once, null on failure.
export function governedOf(opts) {
  const c = once(() => (opts.session ? contextOf(opts) : null));
  const tasks = once(() => (c() ? associated(c(), taskRows(c())) : null));
  const parts = { place: once(() => c()?.place ?? null), workflow: once(() => (c() ? ownedBy(c(), tasks(), "coordinator") : null)), task: once(() => (c() ? ownedBy(c(), tasks(), "session") : null)), goal: once(() => (c() ? goalOf(c()) : null)), work: once(() => (c() ? workOwner(c()) : null)), mission: (ref) => quietly(() => (c() ? missionOwner(c(), ref) : null)), owed: once(() => (c() ? owedOf(c(), opts) : null)) };
  return { ...parts, holding: () => parts.workflow() ?? parts.goal(), owner: () => parts.workflow() ?? parts.goal() ?? parts.work() ?? parts.task() };
}
