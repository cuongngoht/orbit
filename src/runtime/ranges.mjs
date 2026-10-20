// Version ranges, as far as this subject needs them -- and no further.
//
// src/extensions/engine-range.mjs is the one reading of a comparison this engine has, a documented
// SUBSET of semver that says "cannot tell" rather than guess: `>= > <= < =` against a dotted
// version, several comparators ANDed. A manifest's own range is wider than that -- `^20`, `~1.2`,
// `22`, `20.x`, `^18.17 || >=20` are the usual ways a package says which Node it runs on -- so this
// file reads those the way npm does and rewrites each as comparators the subset understands. What
// it still cannot read is `null`, which a caller takes as UNKNOWN and never as a failure: nobody
// should be told a machine is incompatible because this engine cannot parse a range.
//
// Three jobs, all pure:
//   judged       does a machine's version satisfy a range: compatible, incompatible or unknown
//   pin          a tool-version file says `22` or `3.13.1` or `20.x`. That is a pin to a major
//                line, so it means `>=22 <23`
//   lower        the version a range asks AT LEAST, so a dev container feature can be told which to
//                install
import { satisfies } from "../extensions/engine-range.mjs";

const PIN = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.x)?$/i;

export function pinRange(text) {
  const m = PIN.exec(String(text ?? "").trim());
  if (!m) return null;
  const parts = [m[1], m[2], m[3]].filter((p) => p !== undefined);
  return `>=${parts.join(".")} <${Number(m[1]) + 1}`;
}

// ---- a range as alternatives of comparators --------------------------------------------------------

const WILD = /^[xX*]$/;
const VERSION = /^v?(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/;
const OPERATED = /^(>=|<=|>|<|=)v?(\d+(?:\.\d+){0,2})$/;

// The numbers a version word names, as far as it goes: `22` is [22], `22.1` is [22, 1], `22.x` is
// [22], and a bare wildcard is []. Null for what is not a version at all.
function partsOf(word) {
  if (WILD.test(word)) return [];
  const m = VERSION.exec(word);
  return m ? named(m) : null;
}

function named(m) {
  const given = [m[1], m[2], m[3]];
  const stop = given.findIndex((p) => p === undefined || WILD.test(p));
  return given.slice(0, stop < 0 ? 3 : stop).map(Number);
}

// A lower bound keeps the precision the file gave it (`8.0`, `22`): that is the version a container
// feature is asked for. A missing part reads as 0 where versions are compared, so nothing is padded.
const written = (parts) => parts.join(".");

// The version above which `parts` stops: the number at `at` is raised and what follows it is dropped.
const above = (parts, at) => [...parts.slice(0, at), parts[at] + 1].join(".");

const between = (parts, at) => [`>=${written(parts)}`, `<${above(parts, at)}`];

// What a version word with no operator means: the line it names, or exactly that version.
const line = (parts) => (parts.length === 0 ? [] : parts.length === 3 ? [`=${written(parts)}`] : between(parts, parts.length - 1));

// `^`: compatible with the version, up to the next change of its first non-zero number.
function caret(parts) {
  if (!parts.length) return [];
  const first = parts.findIndex((n) => n > 0);
  return between(parts, first < 0 ? parts.length - 1 : first);
}

// `~`: patch-level changes when a minor is named, minor-level when only a major is.
const tilde = (parts) => (parts.length ? between(parts, parts.length === 1 ? 0 : 1) : []);

// A comparison against a version: whole versions as they are, a partial one only where npm's meaning
// and the subset's agree (`>=22` and `<22` do; `>22` is `>=23` to npm and `>22.0.0` to the subset, so
// it is not read at all).
function operated(op, version) {
  const parts = partsOf(version);
  if (op === "=") return line(parts);
  return parts.length === 3 || op === ">=" || op === "<" ? [`${op}${written(parts)}`] : null;
}

const signed = (sign, version) => {
  const parts = partsOf(version);
  return parts ? (sign === "^" ? caret : tilde)(parts) : null;
};

const bare = (word) => {
  const parts = partsOf(word);
  return parts ? line(parts) : null;
};

function comparator(word) {
  const sign = /^(\^|~)v?(.+)$/.exec(word);
  if (sign) return signed(sign[1], sign[2]);
  const op = OPERATED.exec(word);
  return op ? operated(op[1], op[2]) : bare(word);
}

// One comparator set -- words ANDed -- or null when any word cannot be read.
function setOf(text) {
  const words = text.replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1").split(/\s+/).filter(Boolean);
  const read = words.map(comparator);
  return words.includes("-") || read.some((r) => r === null) ? null : read.flat();
}

// A range as its alternatives (`a || b`), each a list of comparators the subset reads -- or null when
// any of it cannot be read. An empty list is "any version".
export function alternatives(range) {
  const sets = String(range ?? "").split("||").map((s) => setOf(s.trim()));
  return sets.length && sets.every((s) => s !== null) ? sets : null;
}

// Can this engine read the range at all?
export const readable = (range) => alternatives(range) !== null;

// ---- what a machine's version says about a range ---------------------------------------------------

const asked = (version, terms) => (terms.length ? satisfies(version, terms.join(" ")) : { ok: true, tell: true });

// `compatible`, `incompatible`, or `unknown` when either side cannot be read. `why` always says which
// -- in this subject's own words: the sentence `satisfies` gives for a miss is about an extension and
// an engine, and "this engine is 3.9.6" would read as Orbit's version and not Python's.
export function judged(version, range) {
  if (!range) return { state: "compatible", why: "no version is asked" };
  const sets = alternatives(range);
  const answers = (sets ?? []).map((terms) => asked(version, terms));
  if (!sets || answers.some((a) => a.tell === false)) return { state: "unknown", why: `whether ${version ?? "the tool's version"} satisfies ${range} is not known: ${sets ? "the version is not one this reads" : "a range this does not read"}` };
  return answers.some((a) => a.ok) ? { state: "compatible", why: `${version} satisfies ${range}` } : { state: "incompatible", why: `${version} does not satisfy ${range}` };
}

// ---- the version to install ------------------------------------------------------------------------

const LOWER = /^(>=|=)(\d+(?:\.\d+){0,2})$/;

const parts = (v) => String(v).split(".").map(Number);

function higher(a, b) {
  const width = Math.max(parts(a).length, parts(b).length);
  for (let i = 0; i < width; i++) if ((parts(a)[i] ?? 0) !== (parts(b)[i] ?? 0)) return (parts(a)[i] ?? 0) > (parts(b)[i] ?? 0) ? a : b;
  return a;
}

// The highest lower bound of one alternative, or null when it asks for no minimum.
const floor = (terms) => terms.filter((t) => LOWER.test(t)).map((t) => LOWER.exec(t)[2]).reduce((best, v) => (best === null ? v : higher(best, v)), null);

// The version a range asks at least, or null when it asks nothing readable. Of several alternatives the
// newest floor is the one to install: it satisfies its own alternative, and a container has no reason to
// carry an older one. Only lower bounds count; an upper bound says what NOT to install.
export function lowerBound(range) {
  const sets = alternatives(range);
  const floors = (sets ?? []).map(floor).filter((v) => v !== null);
  return floors.length ? floors.reduce(higher) : null;
}
