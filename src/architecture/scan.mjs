// Running the analysers, and recording only what came back.
//
// A scan is the table filtered and the input narrowed -- which is the whole
// reason the analysers are pure. Bootstrap runs all four over every tracked
// path; an incremental scan runs them over the paths under the scopes that
// moved; a targeted scan runs the two that read a DECLARATION rather than a
// tree. Same code, three inputs.
//
// Nothing here decides WHETHER to scan. That is `ensure.mjs`, and keeping the
// two apart is what stops a scan from quietly justifying itself.
//
// Everything the tree is asked is asked ONCE and hoisted: the commit, the
// listing, and one fingerprint per distinct scope. An earlier draft measured
// inside the per-fact stamp, which is a git process per fact -- fine for the
// eight facts a fixture has, and unusable on a repository with two hundred.
import { ANALYZERS, analyseWith, analyzersReading } from "./analyzers/index.mjs";
import { makeFact } from "./model.mjs";
import { measure } from "../freshness.mjs";
import { shape } from "./analyzers/shape.mjs";

// Which analysers a decision's `scan` column turns into. `asked` runs the two
// that read a declaration or a listing: a capability is something a project
// DECLARES or lays out, and reading every source file to look for a word is the
// scan this whole feature exists to avoid.
const PLAN = {
  all: () => ANALYZERS,
  scopes: () => ANALYZERS,
  asked: () => analyzersReading(["manifests", "listing"]),
  none: () => [],
};

export const NOT_A_CHECKOUT = "nothing could be listed — this is not a readable git checkout";

export function scan(ctx, decision, opts = {}) {
  const rows = PLAN[decision.scan]();
  if (!rows.length) return empty(decision);
  return ran(ctx, rows, decision, opts);
}

const empty = (decision) => ({ facts: [], unknowns: [], scopes: {}, read: 0, analysers: [], skipped: decision.skipped ?? [] });

function ran(ctx, rows, decision, opts) {
  const files = narrowed(ctx.source.files(), decision, opts);
  if (files === null) return { ...empty(decision), unknowns: [NOT_A_CHECKOUT] };
  return harvested(rows, inputOf(ctx, files, opts), ctx, decision);
}

// The modules the shape analysis finds are what the imports analysis walks, so
// shape runs once up front and its facts are part of the next one's input. One
// reading of "what a module is", not two that can disagree.
function inputOf(ctx, files, opts) {
  const counted = { n: 0 };
  const read = (p) => (counted.n++, ctx.source.read(p));
  const search = (p) => (counted.n++, ctx.source.search(p));
  return { files, read, search, counted, budget: opts.budget, facts: shape({ files, read }).facts, layerTools: opts.layerTools ?? {}, yaml: ctx.yaml ?? null };
}

function harvested(rows, input, ctx, decision) {
  const out = analyseWith(rows, input);
  const done = stampAll(out.facts, ctx.source, ctx.now);
  return { ...out, ...done, read: input.counted.n, analysers: rows.map((r) => r.name), skipped: decision.skipped ?? [] };
}

// Also the door a fact derived OUTSIDE an analyser comes through -- the
// capability search builds its facts after the scan, and they earn the same
// stamps from the same measurement rather than a second way of getting them.
export function stampAll(raw, source, now) {
  const scopes = measure(raw, null, source);
  const commit = source.commit();
  return { facts: raw.map((f) => stamp(f, scopes, commit, now)), scopes };
}

// A fact is stamped with the fingerprint of its OWN scope, which is what lets it
// stay fresh while the rest of the tree moves. At the moment of a scan every
// scope it just read IS fresh by definition -- the fact was derived from exactly
// that content -- so the only other answer is `unknown`, for a scope the tree
// could not fingerprint at all.
function stamp(raw, scopes, commit, now) {
  const hashes = raw.scope.map((s) => scopes[s]?.hash);
  const status = hashes.length && hashes.every(Boolean) ? "fresh" : "unknown";
  return makeFact(raw, { commit, fingerprint: hashes.find(Boolean) ?? undefined, status, now });
}

// Narrowed to the paths the decision covers. A bootstrap covers everything; an
// incremental scan covers what moved; a targeted scan covers everything but runs
// only the analysers that read a declaration.
function narrowed(files, decision, opts) {
  if (files === null) return null;
  if (decision.scan !== "scopes") return files;
  return files.filter((f) => (opts.scopes ?? []).some((s) => under(f, s)));
}

// The same reading of a scope the source port uses, including `.` meaning the
// whole tree. Two spellings of "is this path in that scope" would be two answers.
const under = (p, s) => s === "." || s === "" || p === s || p.startsWith(`${s}/`);

// What the scan recorded about the tree, for the NEXT decision to compare
// against: one hash per scope any fact names. Folded into whatever the previous
// scan knew, because an incremental scan speaks only for the scopes it read.
export const scopesInto = (was, scopes) => ({ ...was, ...Object.fromEntries(Object.entries(scopes).filter(([, v]) => v.hash).map(([k, v]) => [k, { hash: v.hash }])) });
