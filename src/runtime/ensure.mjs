// Does this checkout's runtime have to be READ again, and if so how much?
//
// The same discipline as src/architecture/ensure.mjs, for the same reasons, and
// with a table of its own because the question is a different one. Pure: facts in,
// one row out, reads no file and spawns nothing -- so a test describes a moved
// evidence file instead of producing one, and nothing in the suite needs a clock,
// a disk or a commit to cover every path through this.
//
// Three properties every row holds to:
//
//   the last row always matches   -- a table with a hole returns undefined at 2am
//   `writes` is a COLUMN          -- so `--dry` is the table with one column
//                                    flipped, and "current means no read" and
//                                    "--dry writes nothing" are one assertion
//   every row SAYS what it decided -- a tool that decides silently cannot be audited
//
// What a read costs is the evidence files, and only those: a manifest, a build
// file, a container file, a pipeline. Changing a source file moves nothing here,
// which is the whole point -- the understanding of what a checkout NEEDS must not
// go stale because somebody edited a class.
import { UNDERSTANDING } from "./vocab.mjs";

export const DECISIONS = [
  { name: "BLOCKED_SOURCE", scan: "none", writes: false, stops: true, when: (f) => !f.readable, say: () => "there is no readable git checkout here, so nothing can be read or dated" },
  { name: "RESCAN", scan: "evidence", writes: true, when: (f) => f.forced, say: (f) => `asked for outright — reading the evidence again, over ${f.count} fact(s) already here` },
  { name: "BOOTSTRAP", scan: "evidence", writes: true, when: (f) => !f.model && !f.count, say: () => "nothing has read this checkout's runtime yet — reading its evidence once, so nothing after this has to" },
  { name: "UNREADABLE_STATE", scan: "evidence", writes: true, when: (f) => !f.model, say: (f) => `${f.count} fact(s) are here but the state beside them cannot be read — ${f.modelWhy}. The old file is left where it is` },
  { name: "READERS_CHANGED", scan: "evidence", writes: true, when: (f) => f.readers !== f.model.readers, say: () => "what reads a checkout's evidence changed — an engine, an ecosystem or the catalog — so it is read again" },
  { name: "EVIDENCE_CHANGED", scan: "evidence", writes: true, when: (f) => f.stale.length + f.added.length + f.removed.length > 0, say: (f) => `${describe(f)} — reading the evidence again, and nothing but the evidence` },
  { name: "CURRENT", scan: "none", writes: false, when: () => true, say: (f) => (f.dirty?.length ? `${f.count} fact(s) from the last commit; ${plural(f.dirty.length, "evidence file")} ${f.dirty.length === 1 ? "has" : "have"} uncommitted edits (${f.dirty.slice(0, 3).join(", ")}${f.dirty.length > 3 ? ", …" : ""}) — what is read is what is committed, so commit ${f.dirty.length === 1 ? "it" : "them"} and the next look reads ${f.dirty.length === 1 ? "it" : "them"}` : `${f.count} fact(s), every evidence file still where the last read left it`) },
];

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function describe(f) {
  const parts = [f.stale.length && `${plural(f.stale.length, "evidence file")} changed`, f.added.length && `${plural(f.added.length, "evidence file")} appeared`, f.removed.length && `${plural(f.removed.length, "evidence file")} went away`];
  return parts.filter(Boolean).join(", ");
}

export function decide(facts, opts = {}) {
  const row = DECISIONS.find((d) => d.when(facts));
  const dry = Boolean(opts.dry);
  return { ...row, dry, writes: row.writes && !dry, say: row.say(facts) };
}

// What can be understood of this checkout, as ONE word -- derived on every look
// and never stored:
//
//   NOT_DISCOVERED  nothing has read it
//   STALE           evidence moved, appeared or went away, or what reads it changed
//   UNKNOWN         evidence has uncommitted edits, so whether it moved cannot be
//                   settled -- or there is no checkout to ask
//   PARTIAL         every evidence file is where it was, and something could not be
//                   READ (a manifest that would not parse, a reader that failed) --
//                   or there was nothing to understand
//   CURRENT         every evidence file is where it was, and all of it was read
export function stateOf(f) {
  if (!f.readable) return "UNKNOWN";
  if (!f.model) return "NOT_DISCOVERED";
  if (f.readers !== f.model.readers || f.stale.length || f.added.length || f.removed.length) return "STALE";
  if (f.dirty.length) return "UNKNOWN";
  return (f.model.gaps ?? []).length || !f.count ? "PARTIAL" : "CURRENT";
}

export const STATES = UNDERSTANDING;
