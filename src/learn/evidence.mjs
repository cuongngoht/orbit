// What the families are allowed to look at.
//
// This is an ALLOW-LIST and that is the whole point. The ledger line carries
// `params`, `resolved`, `captured`, `report` and `identity[].upn` -- command-line
// values, rows read out of the database, text read off the page, and the signed-in
// user's name. None of it is copied here, so none of it can leak into a file in
// somebody's home directory by being missed by a redaction pattern. scrub.mjs is
// the backstop; this is the defence. A deny-list defaults to letting things
// through, and a field added to resultJson() next year would be let through by
// one that nobody remembered to update.
//
// A note's body is the one piece of free text that crosses, and it crosses
// through `quote()` -- flattened, truncated, stripped of anything that could open
// a heading or a fence in whatever reads the lesson next.
import { relevant, slugOf } from "../memory/note.mjs";
import { SESSION_IS, sessionsOf } from "../memory/session.mjs";
import { quote } from "../quote.mjs";

export const RUN_KEYS = ["at", "host", "case", "status", "ms", "fe_commit", "failedStep", "slice", "proved"];
export const NOTE_KEYS = ["about", "title", "type", "fe_commit", "at", "host", "file"];

// What the ledger simply does not hold. Carried into every lesson built from it,
// because a reader who is told three sessions failed at step 2 will otherwise
// assume the tool knows WHY and chose not to say.
export const LEDGER_CANNOT = [
  "the failure message — the ledger records where a run stopped, never why; the run log in each evidence dir has it",
  "runs refused before the first step — a refusal never reaches the ledger, so the commonest one (no signed-in session) cannot be counted",
  SESSION_IS,
];

export const pickRun = (r) => pick(r, RUN_KEYS);

export const pickNote = (n) => ({ ...pick(n, NOTE_KEYS), slug: slugOf(n), body: quote(n.body) });

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

export function evidenceOf(ctx, opts = {}) {
  const runs = ctx.memory.runs().map(pickRun).filter((r) => within(r, opts.since));
  const notes = dedupeNotes(ctx.memory.notes().map(pickNote));
  const head = ctx.frontend.commit();
  return { runs, notes, sessions: sessionsOf(runs), head, host: ctx.memory.host, cases: opts.cases ?? [], since: opts.since ?? null };
}

const within = (run, since) => !since || String(run.at ?? "") >= since;

// Two copies of one note are one note. Without this, a store synced to two
// machines would let the same remark vote twice -- and a note does not vote at
// all in the ladder, but it does appear in `because`, and "2 machines wrote this
// down" is a sentence that has to be true.
function dedupeNotes(notes) {
  const bySlug = new Map();
  for (const n of notes) bySlug.set(n.slug, bySlug.get(n.slug) ?? n);
  return [...bySlug.values()];
}

// Evidence is cited by POINTER, never by content: the tombstone hashes these, the
// lesson prints them, and `learn why` sends the reader back to the real record.
export const runRef = (r) => `run:${r.case}@${r.at}`;

export const noteRef = (n) => `note:${n.slug}`;

export const notesAbout = (notes, about) => relevant(notes, about);
