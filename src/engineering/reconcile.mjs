// Turning ONE candidate into a decision about the store, without ever letting a
// single observation flatter itself into a certainty or a rule.
//
// This is the ordered-table discipline src/learn/confidence.mjs already applies
// to a lesson, over a different question: a lesson asks "how sure is the tool
// allowed to be", this asks "what does one more piece of evidence do to a fact
// that may already exist". First match wins, the last row always matches, and
// reading the rows in order is reading the policy.
//
// It is the ONLY way a fact changes: src/engineering/ingest.mjs is its one
// production caller and the one place a fact is saved. Four rules are
// structural here rather than promises in a comment:
//
//   CONFIDENCE is derived, never carried. `derive(support)` is the one function
//   that says it -- two or more independent sessions and nothing against is
//   `certain`, anything else is `possible` -- so a candidate cannot arrive
//   certain, and a fact cannot stay certain once a session contradicts it.
//
//   SESSIONS are a set, not a counter beside the last one seen. `support.seen`
//   holds the hashed marks of every session that supported the fact, so A, B, A
//   is two sessions and never three, and a hook's real session and a hand-typed
//   record the same day on the same machine are one. What a session IS stays
//   src/memory/session.mjs's one definition.
//
//   STRENGTH moves only on the `adopt` row, and only for an explicit human
//   record (`opts.human`). An observer confirming a fact a thousand times leaves
//   `observed` observed and an `adopted` fact adopted -- repetition is not
//   adoption, and an observation cannot demote a decision either.
//
//   a CONTRADICTION never overwrites. The statement, scope, evidence and
//   strength stay exactly as they were; the contradicting session is counted in
//   `support.contested`, which is what makes the derived confidence honest, and
//   a drift finding goes to a person. A different statement for the same
//   subject is not silently kept or dropped either: it is a `restated` finding.
//
// The first two rules -- what confidence is, and how sessions are counted --
// live in src/memory/support.mjs, because project knowledge (src/knowledge/)
// reconciles its claims by the very same ones. Both consumers import them directly.
import { KEEP_SESSIONS, NO_SUPPORT, counted, derive, settled, supportOf } from "../memory/support.mjs";
import { claimableByObserver } from "./vocab.mjs";
import { credited } from "../memory/evidence.mjs";


export const OUTCOMES = ["contradict", "new", "adopt", "confirm", "extend"];

const RULES = [
  {
    outcome: "contradict",
    when: (c, existing) => Boolean(c.contradicts) && existing != null,
    result: contradicted,
  },
  {
    outcome: "new",
    when: (c, existing) => existing == null,
    result: fresh,
  },
  {
    outcome: "adopt",
    when: (c, existing, opts) => Boolean(opts.human) && c.strength !== existing.strength,
    result: adopted,
  },
  {
    outcome: "confirm",
    when: (c, existing) => sameEvidence(c.evidence, existing.evidence),
    result: (c, existing) => merged("confirm", existing, c, existing.evidence),
  },
  {
    outcome: "extend",
    when: () => true,
    result: (c, existing) => merged("extend", existing, c, union(existing.evidence, c.evidence)),
  },
];

export function reconcile(candidate, existing, opts = {}) {
  const row = RULES.find((r) => r.when(candidate, existing, opts));
  return evidenceDecision(row.result(candidate, existing, opts), candidate, existing, opts);
}

function evidenceDecision(decision, candidate, existing, opts) {
  if (!opts.evidence || decision.outcome === "contradict") return decision;
  const support = credited(existing, decision.fact.support, candidate.seenBy, opts.evidence);
  return { ...decision, fact: settled(decision.fact, support, decision.fact.because) };
}

function fresh(c) {
  const { seenBy, contradicts: _contradicts, ...rest } = c;
  const support = counted({ ...NO_SUPPORT, examples: (rest.evidence ?? []).length }, seenBy, "seen");
  const fact = settled({ ...rest, lastSeenBy: seenBy, ...adoption(rest, seenBy) }, support, rest.because);
  return { outcome: "new", fact, finding: null };
}

// A strength only a person may set is dated to that person's record.
const adoption = (fact, seenBy) => (claimableByObserver(fact.strength) ? {} : { adoptedBy: seenBy });

function contradicted(c, existing) {
  const support = counted(supportOf(existing), c.seenBy, "contested");
  const fact = settled(existing, support, existing.because);
  const finding = { kind: "engineering-drift", factId: existing.id, candidateKey: c.key, say: `a new observation about "${c.key}" contradicts ${existing.id} (${existing.strength} · ${fact.confidence}) — its statement, evidence and strength are left exactly as they are; this is a drift candidate for a person to resolve` };
  return { outcome: "contradict", fact, finding };
}

// Everything that is a JUDGEMENT -- kind, key, statement, scope, strength -- is
// carried from the EXISTING fact untouched: reconciliation is evidence
// bookkeeping, never a rewrite of what was decided.
function merged(outcome, existing, c, evidence) {
  const support = { ...counted(supportOf(existing), c.seenBy, "seen"), examples: evidence.length };
  const fact = settled({ ...existing, evidence, lastSeenBy: c.seenBy }, support, existing.because);
  return { outcome, fact, finding: restated(existing, c) };
}

// The one row that moves strength: an explicit human record, and it is dated.
function adopted(c, existing) {
  const base = merged("adopt", existing, c, union(existing.evidence, c.evidence));
  const gate = c.enforcedBy ? { enforcedBy: c.enforcedBy } : {};
  return { ...base, fact: { ...base.fact, strength: c.strength, adoptedBy: c.seenBy, ...gate } };
}

const restated = (existing, c) => (c.statement && c.statement !== existing.statement ? { kind: "engineering-restated", factId: existing.id, candidateKey: c.key, say: `an observation about "${c.key}" words it differently from ${existing.id} — the recorded statement is kept; a person decides whether the new wording is better` } : null);

const sameEvidence = (a, b) => (a ?? []).length === (b ?? []).length && union(a, b).length === (a ?? []).length;

const union = (a, b) => [...new Set([...(a ?? []), ...(b ?? [])])];
