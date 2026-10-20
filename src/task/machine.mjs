// The MACHINE-WIDE view of task executions: a projection, never a store.
//
//   Project Registry ──► known project keys ──► <store>/tasks/* of each ──► fold ──► one view
//
// A project is known because Orbit was used from one of its checkouts (src/store/registry.mjs);
// nothing here lists a home directory, a workspace folder or a drive. Per project it costs one
// directory listing and one read per task -- no git, no probe, no runtime, nothing written -- and
// there is no index to rebuild or to disagree with a journal: the journals ARE the answer, read
// again each time.
//
// One task that cannot be read is one `unreadable` row, and one project whose room cannot be
// read is one `problem`: neither costs the rest of the machine its view. A checkout whose
// folder is gone still shows its tasks, because they live in the store.
//
// `rootOf(key)` (src/project/repository.mjs projectStoreRoot) and `since` (where "today" began,
// on this machine's clock) are handed in by the composition root, so this reads no environment
// and no time zone of its own.
import { loadTask } from "./load.mjs";
import { createTasks } from "./store.mjs";
import { summaryOf } from "./summary.mjs";
import { taskView, VIEW_VERSION } from "./views.mjs";

const RUNNING = ["PREPARING", "EXECUTING", "VERIFYING"];

// What the counters count, read in no order: each is its own question.
export const COUNTERS = [
  { name: "running", when: (t) => RUNNING.includes(t.lifecycle) },
  { name: "queued", when: (t) => t.lifecycle === "QUEUED" },
  { name: "waitingApproval", when: (t) => t.lifecycle === "WAITING_APPROVAL" },
  { name: "blocked", when: (t) => t.lifecycle === "BLOCKED" },
  { name: "paused", when: (t) => t.lifecycle === "PAUSED" },
  { name: "completedToday", when: (t, since) => t.lifecycle === "COMPLETED" && Boolean(since) && t.endedAt >= since },
  { name: "unreadable", when: (t) => t.unreadable === true },
];

// A reason a person can act on, never a path or an engine's stack.
const problemOf = (e) => (/newer Orbit/.test(String(e?.message ?? "")) ? "written by a newer Orbit — upgrade the plugin to read it" : "its journal could not be read");

function rowOf(tasks, id, project, now) {
  const { model } = loadTask({ tasks, now: () => now }, id);
  const checkout = project.checkouts.find((c) => c.id === model.meta.checkout) ?? null;
  return { ...summaryOf(taskView(model, now, checkout)), projectName: project.name, checkoutRoot: checkout?.root ?? null, checkoutKnown: checkout !== null, checkoutPresent: checkout?.exists === true };
}

function taskRow(tasks, id, project, now) {
  try { return rowOf(tasks, id, project, now); }
  catch (e) { return { id, project: project.key, projectName: project.name, unreadable: true, why: problemOf(e) }; }
}

function projectRows(project, { rootOf, io, now }) {
  const tasks = createTasks(rootOf(project.key), io);
  return { tasks: tasks.list().map((id) => taskRow(tasks, id, project, now)), problems: [] };
}

function projectOf(project, deps) {
  try { return projectRows(project, deps); }
  catch (e) { return { tasks: [], problems: [{ project: project.key, name: project.name, why: problemOf(e) }] }; }
}

const byRecent = (a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")) || String(a.id).localeCompare(String(b.id));

function countsOf(projects, tasks, since) {
  const counted = Object.fromEntries(COUNTERS.map((c) => [c.name, tasks.filter((t) => c.when(t, since)).length]));
  return { projects: projects.length, checkouts: projects.reduce((n, p) => n + p.checkouts.length, 0), tasks: tasks.length, ...counted };
}

// Every open approval on the machine, with what a person needs to find and decide it.
const approvalsOf = (tasks) => tasks.filter((t) => !t.unreadable).flatMap((t) => t.approvals.map((a) => ({ ...a, task: t.id, objective: t.objective, project: t.project, projectName: t.projectName, checkout: t.checkout, revision: t.revision, lifecycle: t.lifecycle })));

// deps: { registry, rootOf, io, now, since }
export function machineView(deps) {
  const projects = deps.registry.list();
  const rows = projects.map((p) => projectOf(p, deps));
  const tasks = rows.flatMap((r) => r.tasks).sort(byRecent);
  return { version: VIEW_VERSION, at: deps.now, since: deps.since ?? null, counts: countsOf(projects, tasks, deps.since), tasks, approvals: approvalsOf(tasks), problems: rows.flatMap((r) => r.problems) };
}

export const machineApprovals = (deps) => ({ version: VIEW_VERSION, approvals: machineView(deps).approvals });

// Where "today" began on this machine, for a composition root to hand in as `since`.
export function localDayStart(iso) {
  const day = new Date(iso);
  day.setHours(0, 0, 0, 0);
  return day.toISOString();
}
