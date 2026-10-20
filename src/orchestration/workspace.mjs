// The WORKSPACE OWNER: one isolated place per task where its change is made, and nowhere else.
//
//   <storeRoot>/workspaces/<tsk>/owner.json   who it belongs to -- written FIRST, beside the tree
//   <storeRoot>/workspaces/<tsk>/tree/        a local clone of the primary checkout, detached at the
//                                             task's base revision: the checkout's `.git` is only read
//
// Deterministic: the task's id names the room, and the journal keeps `ws-<the task's 12 hex>`;
// the absolute path is resolved here, live, for whoever must edit there, and never journaled.
//
// The owner receipt sits BESIDE the tree because the store's guard refuses a write below a `.git`
// (a clone has one), and it is written before git makes the tree, so a directory nobody can account
// for is never this task's. What is there already is judged before anything is made:
//
//   an owner naming another task or checkout   refused, and left as it is
//   a tree that is a repository of its own     reused (a prepare is idempotent)
//   any other directory, a link, a file at the tree's place
//                                              refused, and left as it is
//
// The tree is written by git and by the host's editor, never by the store's io. It is removed only
// on request, only when the owner names this task and checkout, and only through git.
//
// deps: { root (the project's store root), io (the store's guarded io), trees (the primary
// checkout's local clones, src/frontend/local-clones.mjs), host, now() }
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";

export const WORKSPACES = "workspaces";
export const OWNER = "owner.json";
export const TREE = "tree";
export const OWNER_SCHEMA = 1;

const TASK = /^tsk-[a-f0-9]{12}$/;

export const workspaceIdOf = (task) => `ws-${String(task).slice("tsk-".length)}`;

function checkedTask(task) {
  if (!TASK.test(String(task))) throw new Refused(`${task} is not a task id`);
  return task;
}

const parsed = (text) => {
  try { return JSON.parse(text); }
  catch { return { unreadable: true }; }
};

const ownerAt = (deps, room) => ((text) => (text === null ? null : parsed(text)))(deps.io.read(join(room, OWNER)));

const ownsIt = (owner, head) => Boolean(owner) && owner.task === head.task && owner.checkout === head.checkout;

const foreign = (room, owner) => new Refused(`${room} is ${owner?.task ? `${owner.task}'s workspace` : "not a workspace any task can account for"} — not this task's, and it is left as it is`);

function written(deps, head, room) {
  const owner = { task: head.task, project: head.project, checkout: head.checkout, baseRevision: head.baseRevision, host: deps.host, at: deps.now(), schema: OWNER_SCHEMA };
  deps.io.write(join(room, OWNER), `${JSON.stringify(owner, null, 2)}\n`);
  return owner;
}

function ownedBy(deps, head, room) {
  const owner = ownerAt(deps, room) ?? written(deps, head, room);
  if (!ownsIt(owner, head)) throw foreign(room, owner);
  return owner;
}

// What stands where the tree goes: nothing, a clone of its own, or something nobody may touch.
const TREE_STATES = [
  { when: (kind) => kind === null, held: false },
  { when: (kind, deps, tree) => kind === "dir" && deps.trees.listed(tree), held: true },
];

function heldAt(deps, tree) {
  const kind = deps.io.kind(tree);
  const row = TREE_STATES.find((s) => s.when(kind, deps, tree));
  if (!row) throw new Refused(`${tree} holds a ${kind} that is not a repository of its own — not this task's, and it is left as it is`);
  return row.held;
}

function prepared(deps, head, room) {
  const owner = ownedBy(deps, head, room);
  const tree = join(room, TREE);
  const reused = heldAt(deps, tree);
  if (!reused) deps.trees.add(tree, owner.baseRevision);
  return { id: workspaceIdOf(head.task), path: tree, baseRevision: owner.baseRevision, reused };
}

// A workspace that is this task's AND there: owner and tree both.
function foundAt(deps, task, room) {
  const owner = ownerAt(deps, room);
  const tree = join(room, TREE);
  if (!owner?.task || owner.task !== task || deps.io.kind(tree) !== "dir" || !deps.trees.listed(tree)) return null;
  return { id: workspaceIdOf(task), path: tree, baseRevision: owner.baseRevision, reused: true };
}

function removedAt(deps, head, room) {
  const owner = ownerAt(deps, room);
  if (!ownsIt(owner, head)) throw foreign(room, owner);
  if (heldAt(deps, join(room, TREE))) deps.trees.remove(join(room, TREE));
  deps.io.remove(room);
  return { id: workspaceIdOf(head.task), removed: true };
}

export function createWorkspaces(deps) {
  const base = join(deps.root, WORKSPACES);
  const roomOf = (task) => contained(base, join(base, checkedTask(task)));
  return { pathOf: (task) => join(roomOf(task), TREE), found: (task) => foundAt(deps, task, roomOf(task)), prepare: (head) => prepared(deps, head, roomOf(head.task)), changes: (task, from) => deps.trees.changes(join(roomOf(task), TREE), from), treeOf: (task) => deps.trees.treeOf(join(roomOf(task), TREE)), treeAt: (task, revision) => deps.trees.treeAt(join(roomOf(task), TREE), revision), stateOf: (task) => deps.trees.stateOf(join(roomOf(task), TREE)), remove: (head) => removedAt(deps, head, roomOf(head.task)) };
}
