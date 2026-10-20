// DISCOVER: read a checkout's runtime evidence, and say what it amounts to.
//
// A pure function over a source tree and what is handed in -- the ecosystem
// registry, the catalog, a way to read a tracked file -- that reads only EVIDENCE
// files (src/runtime/discover/readers/ decides which) and never a source file,
// runs nothing, and writes nothing. What it answers is raw facts, the evidence
// paths it read (`inventory`, so a file that appears later is noticed without
// reading), a print of what did the reading (`readers`, so a new engine or a new
// catalog re-reads), and every sentence about what it could not settle.
//
// Reads are BOUNDED: the evidence list is every tracked path a reader claims and
// nothing else, so the cost of discovery is the number of manifests and build
// files in a repository, never its size, and a checkout with no evidence costs
// one listing.
import { canonicalJson, short } from "../../hash.mjs";
import { engineVersion } from "../../version.mjs";
import { assemble } from "./assemble.mjs";
import { MAX_EVIDENCE_FILES, READERS, READER_NAMES, evidenceOf, isolated, leftOut } from "./readers/index.mjs";

// `input`: { files, read, ecosystems, catalog, name }. The reader's view adds `has`.
export function discover(input) {
  const inventory = evidenceOf(input.files, input);
  const empty = new Set();
  const view = { ...input, read: noted(input.read, empty), has: setOf(input.files), allowed: new Set(inventory) };
  return answered({ ...readAll(view), inventory, input, unreadable: inventory.filter((p) => empty.has(p)) });
}

function readAll(view) {
  const read = READERS.map((reader) => isolated(reader, view));
  return { read, joined: assemble(read.flatMap((r) => r.observations), view) };
}

// A read that comes back empty is remembered. A path that is LISTED and cannot be read -- it is staged
// and not in the last commit yet, it is too large to be text, it is not text at all -- has not been
// understood, and must say so rather than read as "nothing here".
const noted = (read, empty) => (path) => {
  const text = read(path);
  if (text === null) empty.add(path);
  return text;
};

function answered({ read, joined, inventory, input, unreadable }) {
  const said = [...bound(input), ...unreadableSaid(unreadable)];
  return { facts: joined.facts, unknowns: [...read.flatMap((r) => r.unknowns), ...joined.unknowns, ...said], gaps: [...read.flatMap((r) => r.gaps ?? []), ...joined.gaps, ...said], inventory, unreadable, readers: readersPrint(input) };
}

function unreadableSaid(paths) {
  const shown = paths.slice(0, 3).join(", ");
  return paths.length ? [`${paths.length} evidence file(s) could not be read -- not in the last commit, too large, or not text -- so what they say is not known (${shown}${paths.length > 3 ? ", …" : ""})`] : [];
}

// The evidence a scan did not read because there was more of it than a checkout keeps, as a sentence.
function bound(input) {
  const skipped = leftOut(input.files, input);
  return skipped ? [`${skipped} evidence file(s) past the ${MAX_EVIDENCE_FILES} a checkout keeps were not read`] : [];
}

const setOf = (files) => {
  const set = new Set(files);
  return (path) => set.has(path);
};

// What did the reading: this engine, the ecosystems registered beside it, and the catalog. A change to any
// is a reason to read again. The engine goes in by its VERSION because a reader's logic moves with a
// release and its name does not: without it, what an upgrade learned to read would stay unread until the
// evidence itself happened to change, and a checkout would read as understood by what it used to see.
export const readersPrint = (input, engine = engineVersion()) => short(canonicalJson([engine, READER_NAMES, input.ecosystems.ids().slice().sort(), input.catalog.digest]), 12);

export { evidenceOf };
