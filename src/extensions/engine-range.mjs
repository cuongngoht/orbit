// Does this engine fall in the range an extension says it was tested against?
//
// A DOCUMENTED SUBSET of semver, deliberately, because the alternatives are both
// worse. A dependency is out (package.json has none and stays that way), and a
// full range grammar nobody asked for would be a few hundred lines of
// speculative code serving one field.
//
// What is supported, and all that is:
//
//   >=1.4.5        at least this
//   >1.4.5 <3      several comparators, all of which must hold
//   =1.4.5  1.4.5  exactly this (a bare version means =)
//   <=2 <3 >1.2    any of >= > <= < =, against a 1-, 2- or 3-part version
//
// A term this cannot read is reported as UNREADABLE rather than as unsatisfied,
// and the caller decides. That distinction is the point: "your extension does not
// run on this engine" and "nobody can tell whether it does" are different
// sentences, and printing the first when the second is true sends somebody to
// rewrite a working extension.
//
// A prerelease is BELOW its release -- 1.0.0-beta.2 < 1.0.0 -- which is the one
// piece of semver's precedence rules this engine actually uses (AGENTS.md's
// prerelease rule), and the one that would otherwise read backwards.

const SATISFIED = { ">=": (c) => c >= 0, ">": (c) => c > 0, "<=": (c) => c <= 0, "<": (c) => c < 0, "=": (c) => c === 0 };
const TERM = /^(>=|<=|>|<|=)?(\d+(?:\.\d+){0,2})(?:-([\w.]+))?$/;

export function satisfies(version, range) {
  if (!version) return { ok: false, tell: false, why: "this engine could not read its own version" };
  const terms = String(range ?? "").trim().split(/\s+/).filter(Boolean).map(parseTerm);
  const unreadable = terms.filter((t) => !t.ok);
  if (!terms.length || unreadable.length) return cannotTell(range, unreadable);
  return judged(version, terms, range);
}

function parseTerm(text) {
  const m = TERM.exec(text);
  if (!m) return { ok: false, text };
  return { ok: true, text, op: m[1] ?? "=", parts: m[2].split(".").map(Number), pre: m[3] ?? null };
}

const cannotTell = (range, unreadable) => ({
  ok: false,
  tell: false,
  why: unreadable.length
    ? `"${range}" uses ${unreadable.map((t) => `"${t.text}"`).join(", ")}, which this engine cannot read — it understands >= > <= < = against a dotted version`
    : `"${range}" states no version at all`,
});

function judged(version, terms, range) {
  const mine = parseTerm(version);
  if (!mine.ok) return { ok: false, tell: false, why: `this engine's own version "${version}" is not a plain semver` };
  const failed = terms.filter((t) => !SATISFIED[t.op](compare(mine, t)));
  if (!failed.length) return { ok: true, tell: true, why: `${version} satisfies ${range}` };
  return { ok: false, tell: true, why: `this engine is ${version}, and the extension was written for ${range}` };
}

// Numeric part by part, a missing part reading as 0, then the prerelease rule.
function compare(a, b) {
  const width = Math.max(a.parts.length, b.parts.length);
  for (let i = 0; i < width; i++) {
    const d = (a.parts[i] ?? 0) - (b.parts[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return preceding(a.pre, b.pre);
}

// Equal numbers: whichever carries a prerelease is the earlier one. Two
// prereleases compare as text, which is exactly enough for "beta" vs "beta.2"
// and is not pretending to be more.
function preceding(a, b) {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}
