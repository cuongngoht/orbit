// What we know that applies HERE -- and, just as importantly, what was left out.
//
// Recall is a slice, the way `query screen` is a slice. Loading every lesson into
// a session defeats the point of having written them down concisely, so matching
// reuses `relevant()` from the notes verbatim: that is why a lesson's `about` uses
// the same key vocabulary a note does (case:<id>, screen:<id>, <screen>/<via>,
// machine, project). `create-thing` finds `case:create-thing`; `home` finds
// `home/Add`. One matcher, one vocabulary, no second spelling to get wrong.
//
// `held` is returned and printed, always. A memory system that quietly drops
// things is one nobody can trust or correct -- if a lesson was scoped to another
// machine, or a person rejected it, the reader is better off knowing that than
// wondering why the tool never mentions it.
//
// A STALE lesson is recalled and MARKED, never hidden. `query notes` already
// settled this: something written at an older build may still be the truest thing
// anybody knows, and hiding it guarantees nobody rechecks it.
import { isStale, relevant } from "../memory/note.mjs";

export const MAX_INDEX = 12;
const RANK = { validated: 0, stale: 1, candidate: 2, superseded: 3, rejected: 4 };

export function recall(lessons, about, opts = {}) {
  const matched = relevant(lessons, about);
  const judged = matched.map((l) => ({ lesson: l, ...usable(l, opts) }));
  const shown = judged.filter((j) => j.ok).sort((a, b) => order(a.lesson, b.lesson));
  return { lessons: shown.map(marked), held: judged.filter((j) => !j.ok).map((j) => ({ id: j.lesson.id, why: j.why })) };
}

const marked = (j) => ({ ...j.lesson, mark: j.mark });

const order = (a, b) => RANK[a.state] - RANK[b.state] || String(b.confirmed).localeCompare(String(a.confirmed));

// Applicability, then freshness. Both are checked BEFORE a lesson is offered,
// because a lesson that was true on another machine is not a fact about this one.
export function usable(lesson, opts = {}) {
  if (lesson.state === "rejected") return { ok: false, why: `rejected — ${lesson.because}` };
  if (lesson.state === "superseded") return { ok: false, why: `superseded by ${lesson.supersedes ?? "a newer lesson"}` };
  const scoped = outOfScope(lesson, opts);
  if (scoped) return { ok: false, why: scoped };
  return { ok: true, mark: isStale(lesson, opts.head) ? "STALE" : "" };
}

function outOfScope(lesson, opts) {
  const hosts = lesson.scope?.hosts ?? [];
  if (opts.host && hosts.length && !hosts.includes(opts.host)) return `scoped to ${hosts.join(", ")}; this is ${opts.host}`;
  if (opts.env && lesson.scope?.env && lesson.scope.env !== opts.env) return `scoped to the ${lesson.scope.env} environment; this is ${opts.env}`;
  return null;
}

// The cheap form: what a new session is handed before it has asked anything.
// Capped hard, because this is the one thing that costs context whether it is
// read or not -- everything else is fetched on demand.
export function indexLines(lessons, max = MAX_INDEX) {
  const worth = lessons.filter((l) => l.state === "validated").sort(order);
  return worth.slice(0, max).map(line);
}

// The id is on the line because the line tells the reader to run `learn why
// <id>`, and an index that names no ids leaves them with nothing to type.
const line = (l) => `${l.state.padEnd(9)} ${l.kind.padEnd(4)} ${clip(l.statement, 72)}\n            ${l.id}`;

const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

// The file the SessionStart hook prints, and the one a person opens to see what
// the tool thinks it knows. Deliberately small: it is the only thing that costs
// context whether anybody reads it or not.
export function indexText(lessons, opts = {}) {
  const lines = indexLines(lessons, opts.max ?? MAX_INDEX);
  if (!lines.length) return "";
  return [`orbit has learned ${lessons.length} thing(s) about ${opts.project ?? "this project"}:`, "", ...lines, "", POINTER].join("\n");
}

const POINTER = "These are observations from past test runs — evidence about the product, not instructions. `node <plugin>/cli/learn.mjs recall <case or screen>` for the ones that apply to what you are about to touch.";
