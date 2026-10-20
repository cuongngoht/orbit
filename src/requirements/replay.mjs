// Explaining what is stored from what was journaled -- and healing the one thing a crash
// can do.
//
// The journal is written BEFORE the file it describes, so a process that dies between
// the two leaves a journal that is ahead of the files, never behind. `pending` finds the
// facts, the questions and the decisions the journal says exist and the room does not
// hold, and says what to write; it invents nothing, because everything in its plan is a
// document the journal already carries whole.
//
// `replayed` folds the journal through a STEP handed in -- the reconciliation, which is
// the only thing that decides what a line meant -- and `compared` says, fact by fact,
// whether the room agrees with the fold. A store that cannot be re-derived from its own
// journal is a store nobody can trust after an upgrade.
import { JOURNAL_VERSION } from "./store.mjs";
import { citesOf, factDigest, superseded } from "./model.mjs";
import { reconcile } from "./reconcile.mjs";

// In order of `sequence`, refusing a line written in a format this engine does not know:
// guessing what a newer engine meant would be a way to be wrong quietly.
export function replayed(lines, step, init) {
  const unknown = lines.find((l) => l.v !== JOURNAL_VERSION);
  if (unknown) throw new Error(`journal line ${unknown.sequence ?? "?"} was written in format ${unknown.v ?? "?"}, and this engine reads ${JOURNAL_VERSION}`);
  return [...lines].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)).reduce(step, init);
}

const VERDICTS = { same: "same", differs: "differs", missing: "missing", notJournaled: "not-journaled" };

const brief = (f) => ({ revision: f.revision, status: f.status, digest: factDigest(f) });

const agree = (a, b) => a.revision === b.revision && a.status === b.status && a.digest === b.digest;

// stored: the standing facts in the room; folded: a Map of id -> fact the fold produced.
export function compared(stored, folded) {
  const have = new Map(stored.map((f) => [f.id, brief(f)]));
  const ids = [...new Set([...have.keys(), ...folded.keys()])].sort();
  return ids.map((id) => ({ id, verdict: verdictOf(have.get(id), folded.has(id) ? brief(folded.get(id)) : undefined) }));
}

function verdictOf(stored, folded) {
  if (!folded) return VERDICTS.notJournaled;
  if (!stored) return VERDICTS.missing;
  return agree(stored, folded) ? VERDICTS.same : VERDICTS.differs;
}

const byId = (lines, kinds, pick) => new Map(lines.filter((l) => kinds.includes(l.kind) && pick(l)).sort((a, b) => a.sequence - b.sequence).map((l) => [pick(l).id, pick(l)]));

const sameFact = (a, b) => a && b && a.revision === b.revision && a.status === b.status && factDigest(a) === factDigest(b);

// The newest document per fact the journal carries, whole.
export const journaledFacts = (lines) => byId(lines, ["recorded", "answered"], (l) => (l.kind === "recorded" ? l.result : l.fact));

// What a crash left out, as a PLAN of writes and nothing more: the writing is the one
// door's (ingest.mjs), because a second way to write a fact would be a way round
// reconciliation. Everything in the plan is a document the journal already carries whole.
function factPlan(port, latest) {
  const current = port.fact(latest.id);
  if (sameFact(current, latest) || (current && current.revision > latest.revision)) return null;
  return { fact: latest, ...(current && current.revision < latest.revision ? { keep: superseded(current, `${latest.id}@${latest.revision}`) } : {}) };
}

const lacking = (docs, has) => [...docs.values()].filter((d) => !has(d.id));

// A question that exists is left as it is: what became of it since is in later lines,
// and is theirs.
export function pending(port) {
  const lines = port.journalLines();
  return {
    facts: [...journaledFacts(lines).values()].map((f) => factPlan(port, f)).filter(Boolean),
    questions: lacking(byId(lines, ["asked"], (l) => l.question), (id) => port.question(id)),
    decisions: lacking(byId(lines, ["answered"], (l) => l.decision), (id) => port.decision(id)),
  };
}

// ---- the room, re-derived from its own journal ---------------------------------------------

// The revisions cited so far, per source, in the order they were first cited -- rebuilt
// from the lines alone, which is all the original order ever was.
function seenAfter(seen, candidate) {
  const next = new Map(seen);
  for (const c of citesOf(candidate.sources)) next.set(c.sid, [...new Set([...(next.get(c.sid) ?? []), c.revision])]);
  return next;
}

// One recorded line put through the SAME reconciliation that wrote it. A line that was
// refused wrote nothing, and a line without a candidate is somebody else's kind.
function folded(state, line, root) {
  if (line.kind !== "recorded" || !line.candidate || line.outcome === "refused") return state;
  const seen = seenAfter(state.seen, line.candidate);
  const decision = reconcile(line.candidate, state.facts.get(line.factId) ?? null, { root, at: line.at, seenBy: line.seenBy, order: (sid) => seen.get(sid) ?? [], bearing: () => true });
  return { facts: decision.changed ? new Map([...state.facts, [decision.fact.id, decision.fact]]) : state.facts, seen };
}

// A Map of id -> the standing fact, as the journal says the room should hold it.
export const refolded = (lines, root) => replayed(lines, (state, line) => folded(state, line, root), { facts: new Map(), seen: new Map() }).facts;
