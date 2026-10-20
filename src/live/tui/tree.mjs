// The TASK PICKER's tree: the projects and checkouts this machine knows (the registry, never a scan), and the
// tasks of every checkout the person opened, read from each journal's first and last lines. A workflow's
// engineering task sits under the workflow when that is KNOWN -- from a view this viewer read -- and never from a
// name. Counts say only what the rows prove: running or ended; blocked and waiting where a view says so, and
// how many are not known.
//
//   pickerItems(state) -> [{ kind: "project" | "checkout" | "task", depth, key, checkoutId, task, row, ... }]
//   countsOf(rows, views) -> { running, ended, waiting, blocked, unknown }
import { childIdOf } from "./model.mjs";

const newestFirst = (a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

const ordered = (rows) => [...rows.filter((r) => !r.terminal).sort(newestFirst), ...rows.filter((r) => r.terminal).sort(newestFirst)];

const LIFE = { WAITING_APPROVAL: "waiting", BLOCKED: "blocked", PAUSED: "blocked" };

export function countsOf(rows, views) {
  const running = rows.filter((r) => !r.terminal);
  const seen = running.map((r) => LIFE[views[r.id]?.lifecycle] ?? (views[r.id] ? "known" : "unknown"));
  const n = (word) => seen.filter((w) => w === word).length;
  return { running: running.length, ended: rows.length - running.length, waiting: n("waiting"), blocked: n("blocked"), unknown: n("unknown") };
}

// The views this viewer holds: the tasks it follows, and the workflows it read once for their engineering task.
export const viewsOf = (state) => ({ ...state.picker.views, ...Object.fromEntries(Object.values(state.tasks).filter((s) => s.view).map((s) => [s.id, s.view])) });

// Which workflow started which engineering task: from every view this viewer holds, followed or read once.
const childrenOf = (state) => ({ ...state.picker.children, ...Object.fromEntries(Object.values(state.tasks).map((s) => [s.id, childIdOf(s.view)]).filter(([, c]) => c)) });

const childIds = (state) => new Set(Object.values(childrenOf(state)).filter(Boolean));

function taskItems(state, project, checkout) {
  const rows = ordered(state.picker.rows[checkout.id] ?? []);
  const nested = childIds(state);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.filter((r) => !nested.has(r.id)).flatMap((r) => [taskItem(project, checkout, r, 2), ...childItem(state, project, checkout, byId, r)]);
}

const taskItem = (project, checkout, row, depth) => ({ kind: "task", depth, key: project.key, checkoutId: checkout.id, task: row.id, row });

function childItem(state, project, checkout, byId, row) {
  const child = childrenOf(state)[row.id];
  return child ? [taskItem(project, checkout, byId.get(child) ?? { id: child, terminal: null, createdAt: "", coordinates: false, missing: true }, 3)] : [];
}

const checkoutItem = (state, project, checkout) => ({ kind: "checkout", depth: 1, key: project.key, checkoutId: checkout.id, checkout, open: Boolean(state.picker.expanded[checkout.id]), counts: state.picker.rows[checkout.id] ? countsOf(state.picker.rows[checkout.id], viewsOf(state)) : null });

const checkoutItems = (state, project) => project.checkouts.flatMap((c) => [checkoutItem(state, project, c), ...(state.picker.expanded[c.id] ? taskItems(state, project, c) : [])]);

// When the registry has nothing to say (a checkout bound a moment ago), the checkout the viewer stands in is
// still listed, so its own tasks can be picked.
const projectsOf = (state) => (state.picker.projects.length || !state.place ? state.picker.projects : [{ key: state.place.key, name: state.place.project ?? state.place.key, checkouts: [{ id: state.place.checkoutId, root: state.place.root ?? null, exists: true, summary: null }] }]);

export const pickerItems = (state) => projectsOf(state).flatMap((p) => [{ kind: "project", depth: 0, key: p.key, project: p }, ...checkoutItems(state, p)]);
