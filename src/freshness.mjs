// Has the tree moved under this fact?
//
// A LEAF with no imports: architecture facts and engineering facts both ask it,
// and neither may import the other for it -- the reason src/hash.mjs and
// src/scrub.mjs sit at this level too.
//
// Scoped, and that is the whole point. A fact about `src/dsl` is dated against
// `src/dsl`, not against HEAD, so a commit that touches a README leaves it
// alone. Keying freshness on the commit would make every fact stale on every
// push, and a tool whose answer is always "re-do everything" is a tool people
// learn to ignore -- the argument src/qa/impact.mjs already makes about a
// frontend commit advancing.
//
// Three words, and they are the plan checker's (`src/qa/vocab.mjs`):
//
//   fresh    the scope hashes to what it hashed to. A comparison, shown.
//   stale    it moved. NEEDS REVALIDATION -- it does not mean the fact is false.
//   unknown  nothing could settle it: the scope is gone, or it has uncommitted
//            edits the index cannot see, or there is no checkout to ask.
//
// `unknown` for an uncommitted edit is the honest answer and was the tempting
// place to cheat. Calling it `stale` would be a claim nothing can show; calling
// it `fresh` would be worse, because the index genuinely does not know. The
// vocabulary already says so: unknown is "not enough reference to tell — treated
// as unproven, never as fresh".

export const FRESH = "fresh";
export const STALE = "stale";
export const UNKNOWN = "unknown";

// One scope, against what the last scan recorded for it. The hash rides along
// with the verdict because a scan needs it to stamp the facts it just derived,
// and asking the tree for it a second time would be a git call per fact.
export function scopeState(now, was) {
  if (!now) return { state: UNKNOWN, hash: null, say: "the scope is gone, or there is no checkout to ask" };
  if (now.dirty) return { state: UNKNOWN, hash: now.hash, say: `${now.dirty} uncommitted change(s) there — the index cannot settle whether it moved` };
  return { hash: now.hash, ...settled(now, was) };
}

const settled = (now, was) => (!was ? { state: UNKNOWN, say: "nothing recorded what it used to be" } : { state: now.hash === was ? FRESH : STALE, say: now.hash === was ? `${now.files} file(s), unchanged` : "it moved — re-read it" });

// A fact is as fresh as its LEAST fresh scope: any stale scope makes it stale,
// all fresh makes it fresh, and anything else is unknown. The fold
// src/qa/states.mjs uses over its own references, for the same reason -- one
// reference that moved is enough to owe a re-read.
export function factState(fact, scopes) {
  const states = (fact.scope ?? []).map((s) => scopes[s]?.state ?? UNKNOWN);
  if (states.includes(STALE)) return STALE;
  return states.length && states.every((s) => s === FRESH) ? FRESH : UNKNOWN;
}

// Which scopes a rescan would have to cover: the ones that moved, plus the ones
// nothing can speak for. Never every scope -- that is a bootstrap, and it is a
// different decision with a different name.
export const movedScopes = (scopes) => Object.entries(scopes).filter(([, v]) => v.state !== FRESH).map(([k]) => k);

// Measure every scope the facts name, once, through the source port. The only
// place in this subsystem that asks the tree anything during a freshness check
// -- and it asks in ONE call however many scopes there are, because a port that
// answered one scope per call turned a freshness check into a hundred processes.
export function measure(facts, model, source) {
  const wanted = [...new Set(facts.flatMap((f) => f.scope ?? []))];
  const now = wanted.length ? source.fingerprints(wanted) : {};
  return Object.fromEntries(wanted.map((s) => [s, scopeState(now?.[s] ?? null, model?.scopes?.[s]?.hash)]));
}
