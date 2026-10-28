// The WORKSPACE OWNER: one isolated place per task where its change is made, and nowhere else.
//
//   <storeRoot>/workspaces/<tsk>/owner.json   who it belongs to -- written FIRST, beside the tree
//   <storeRoot>/workspaces/<tsk>/tree/        a local clone of the primary checkout, detached at the
//                                             task's base revision: the checkout's `.git` is only read
//   <storeRoot>/workspaces/<tsk>/delivery/    the task's commit (0.2.0): a bare git directory the clone port
//                                             makes beside the tree, never inside it
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
//
// The tree is the task's own, and so is its `.git` -- which is why a commit is never made there: the clone port makes it
// in `delivery/`, beside the tree, from the base revision the owner receipt names, and a push goes from there to the URL
// it is given (the GIT_PUSH protected boundary, src/protected/). Neither touches the checkout.
import { join } from "node:path";
import { Refused } from "../errors.mjs";
import { contained } from "../project/boundary.mjs";

export const WORKSPACES = "workspaces";
export const OWNER = "owner.json";
export const TREE = "tree";
export const DELIVERY = "delivery";
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
  const treeIn = (task) => join(roomOf(task), TREE);
  return { pathOf: treeIn, found: (task) => foundAt(deps, task, roomOf(task)), prepare: (head) => prepared(deps, head, roomOf(head.task)), changes: (task, from) => deps.trees.changes(treeIn(task), from), treeOf: (task) => deps.trees.treeOf(treeIn(task)), treeAt: (task, revision) => deps.trees.treeAt(treeIn(task), revision), stateOf: (task) => deps.trees.stateOf(treeIn(task)), remove: (head) => removedAt(deps, head, roomOf(head.task)), ...deliveryOf(deps, roomOf) };
}

// A task's delivery (0.2.0): its commit, made beside its tree from the base revision its owner receipt names; the commit
// that store's branch names; what the checkout calls a remote (read); a push of exactly one commit; and what a remote ref
// holds now (src/frontend/local-clones.mjs, THE DELIVERY).
function committedIn(deps, room, c) {
  const owner = ownerAt(deps, room);
  if (!owner?.baseRevision) throw new Refused(`${room} names no base revision — nothing is committed`);
  return deps.trees.commit({ tree: join(room, TREE), store: join(room, DELIVERY), base: owner.baseRevision }, c.branch, c.message);
}

const deliveryOf = (deps, roomOf) => ({ commit: (task, branch, message) => committedIn(deps, roomOf(task), { branch, message }), headOf: (task) => deps.trees.headOf(join(roomOf(task), DELIVERY)), remote: (name) => deps.trees.remoteOf(name), push: (task, p) => deps.trees.push(join(roomOf(task), DELIVERY), p.url, p.sha, p.ref, p.force), remoteRef: (url, ref) => deps.trees.remoteRefOf(url, ref) });
