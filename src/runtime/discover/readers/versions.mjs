// Files whose whole job is to PIN a version -- `.nvmrc`, `.python-version`, a tool
// list -- read as the requirement each one is.
//
// Which files these are, and which requirement each pins, is catalog data
// (catalog/runtimes.json `versionFiles`): this reader knows two FORMATS, a file
// that is one version on its first line, and a file of `name version…` pairs.
//
// A pin to `22` is a pin to the 22 line, and is held as such (src/runtime/ranges.mjs
// `pinRange`). A pin this cannot read as a version -- `lts/*`, `system`, a
// branch name -- is said and not guessed at. A tool list names whatever a
// developer wants on their PATH, which is not the same as what the project needs
// to run, so an entry whose tool the catalog has no row for is reported, never
// turned into a requirement nobody can check.
import { posix } from "node:path";
import { requirement, versionFile } from "../../catalog.mjs";
import { pinRange } from "../../ranges.mjs";
import { merged } from "./merge.mjs";

export const versionsReader = {
  name: "version-files",
  claims: (path, input) => versionFile(input.catalog, path) !== null,
  read: (input) => merged(input.paths.map((path) => oneFile(input, path))),
};

const FORMATS = { line, pairs };

function oneFile(input, path) {
  const text = input.read(path);
  if (text === null) return { observations: [], unknowns: [] };
  const row = versionFile(input.catalog, path);
  return FORMATS[row.format](input, path, text, row);
}

const meaningful = (text) => String(text).split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean);

const pinned = (path, id, value) => ({ type: "requirement", dir: posix.dirname(path), path, source: "version-file", confidence: "certain", requirement: id, range: pinRange(value), why: `${posix.basename(path)} pins ${value}` });

function line(input, path, text, row) {
  const value = meaningful(text)[0];
  if (!value) return { observations: [], unknowns: [`${path}: it names no version`] };
  if (!pinRange(value)) return { observations: [], unknowns: [`${path}: ${JSON.stringify(value)} is not a version this reads, so nothing is pinned`] };
  return { observations: [pinned(path, row.requirement, value)], unknowns: [] };
}

// `name version [version…]`: the first version is the one in use.
function pairs(input, path, text, row) {
  const entries = meaningful(text).map((l) => l.split(/\s+/)).filter((w) => w.length >= 2);
  const known = entries.map(([name, ...versions]) => ({ id: row.aliases[name] ?? name, version: versions[0] })).filter((e) => requirement(input.catalog, e.id) && pinRange(e.version));
  const skipped = entries.length - known.length;
  return { observations: known.map((e) => pinned(path, e.id, e.version)), unknowns: skipped ? [`${path}: ${skipped} entr${skipped === 1 ? "y" : "ies"} name a tool the catalog has no row for, or a version this does not read, so nothing is pinned for them`] : [] };
}
