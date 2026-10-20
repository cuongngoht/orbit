// The WORKSPACES port (src/runtime/context.mjs), in memory: the tasks that have a workspace of their own on
// this machine, what each holds, and the tree id of exactly that.
//
// `edit` is what an editor does to a workspace -- the files change, the tree id moves, and nothing tells the
// sandbox -- so a test proves STALE the way it happens. A path is never a real directory: `sourceOf` and
// `treeOf` answer from the files of whichever task owns the path.
import { sha } from "../../src/hash.mjs";
import { memorySource } from "./source.mjs";
import { fakeWorktree } from "./worktree.mjs";

const treeOf = (files) => sha(Object.keys(files).sort().map((p) => `${p}\u0000${files[p]}`).join("\n")).slice(0, 40);

export function fakeWorkspaces(opts = {}) {
  const tasks = new Map();
  const byPath = (path) => [...tasks.values()].find((t) => t.path === path);
  const port = { found: (task) => found(tasks, task), tree: (task) => (tasks.has(task) && !tasks.get(task).unreadable ? treeOf(tasks.get(task).files) : null), sourceOf: (path) => byPath(path).source, treeOf: (path) => byPath(path).worktree };
  return { port, tasks, add: (task, files, extra = {}) => added(tasks, task, files, extra, opts), edit: (task, path, text) => edited(tasks.get(task), path, text), drop: (task) => tasks.delete(task), unreadable: (task) => void (tasks.get(task).unreadable = true) };
}

const found = (tasks, task) => (tasks.has(task) ? { id: tasks.get(task).id, path: tasks.get(task).path, baseRevision: tasks.get(task).baseRevision, reused: true } : null);

function added(tasks, task, files, extra, opts) {
  const path = extra.path ?? `/store/workspaces/${task}/tree`;
  const doc = { id: `ws-${task.slice("tsk-".length)}`, path, baseRevision: extra.baseRevision ?? "8ce1970", files: { ...files }, source: memorySource(files, opts), worktree: fakeWorktree(files, { root: path }) };
  tasks.set(task, doc);
  return doc;
}

function edited(doc, path, text) {
  doc.files[path] = text;
  doc.source.write(path, text);
  doc.worktree.edit(path, text);
  return treeOf(doc.files);
}
