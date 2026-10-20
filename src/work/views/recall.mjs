// What a task should know about the work already in progress -- the `== WORK ==` section of
// project context. Bounded, and about the works that TASK is about: one that names the item
// by its id, or shares enough of its words with the objective. It lists the frontier, so a
// session that has just been told to continue starts where the last one stopped.
import { tokens } from "../../tokens.mjs";
import { load, standing } from "../resume.mjs";
import { listed } from "../summary.mjs";
import { rootOf } from "../store.mjs";

export const MIN_SHARED_WORDS = 2;
export const MAX_WORKS = 3;
export const MAX_NEXT = 5;

const said = (head, task) => new Set(task.toLowerCase().split(/[^a-z0-9-]+/)).has(String(head.root?.id ?? "").toLowerCase()) || [head.id, rootOf(head.id)].some((id) => task.includes(id));

const shared = (head, task) => tokens(head.objective).filter((t) => tokens(task).includes(t)).length;

export const aboutTask = (head, task) => (head.root?.id ? said(head, task) : false) || shared(head, task) >= MIN_SHARED_WORDS;

function standingOf(w, head) {
  const where = standing(w, head.id);
  const model = load(w, head.id);
  return { work: head.id, objective: head.objective, root: head.root, snapshot: where.snapshot, newer: where.newer, next: where.frontier.slice(0, MAX_NEXT), frontier: where.frontier.length, stale: where.needs.filter((n) => n.state === "stale").length, blocked: where.needs.filter((n) => n.state === "blocked").length, satisfied: where.needs.filter((n) => n.state === "satisfied").length, needs: model.needs.size };
}

// A work whose journal cannot be read is left out: a context section is never the reason
// a task cannot start.
function quietly(w, head) {
  try { return standingOf(w, head); }
  catch { return null; }
}

export function recallWork(w, task) {
  const heads = listed(w.works);
  const matches = heads.filter((h) => aboutTask(h, String(task ?? ""))).slice(0, MAX_WORKS).map((h) => quietly(w, h)).filter(Boolean);
  return { kept: heads.length, matches };
}
