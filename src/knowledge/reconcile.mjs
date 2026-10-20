// Turning ONE knowledge candidate into a decision about the store --
// src/engineering/reconcile.mjs's ordered table, over claims, with the same
// four structural rules:
//
//   CONFIDENCE is derived from independent sessions (src/memory/support.mjs,
//   the one definition both memories share), never carried by a candidate;
//   SESSIONS are a set, so A, B, A is two;
//   STRENGTH moves only on the `adopt` row, for an explicit human record;
//   a CONTRADICTION never overwrites -- the contradicting session is counted
//   against the claim, and a person gets the finding.
//
// One row engineering does not need: `unfounded`. A knowledge candidate carries
// no statement of its own -- it IS the triple -- so a contradiction of a claim
// nobody recorded would, by falling through to `new`, store the very triple it
// calls false. It writes nothing instead.
//
// PURE, and it decides about ONE claim. Rivals -- another object for the same
// subject and relation -- are never contested here: whether two objects compete
// is the relation's cardinality, vocabulary can change, and a contest baked
// into `support` could neither be replayed nor undone. Rivals are settled when
// claims are READ (src/knowledge/query.mjs).
import { NO_SUPPORT, counted, settled, supportOf } from "../memory/support.mjs";
import { MAX_EVIDENCE } from "./fields.mjs";
import { claimId } from "./model.mjs";
import { claimableByObserver } from "./vocab.mjs";
import { credited } from "../memory/evidence.mjs";

export const OUTCOMES = ["contradict", "unfounded", "new", "adopt", "confirm", "extend"];

const RULES = [
  { outcome: "contradict", when: (c, existing) => Boolean(c.contradicts) && existing != null, result: contradicted },
  { outcome: "unfounded", when: (c) => Boolean(c.contradicts), result: unfounded },
  { outcome: "new", when: (_c, existing) => existing == null, result: fresh },
  { outcome: "adopt", when: (c, existing, opts) => Boolean(opts.human) && c.strength !== existing.strength, result: adopted },
  { outcome: "confirm", when: (c, existing) => sameEvidence(c.evidence, existing.evidence), result: (c, existing) => merged("confirm", existing, c, existing.evidence) },
  { outcome: "extend", when: () => true, result: (c, existing) => merged("extend", existing, c, union(existing.evidence, c.evidence)) },
];

export function reconcile(candidate, existing, opts = {}) {
  const row = RULES.find((r) => r.when(candidate, existing, opts));
  return evidenceDecision(row.result(candidate, existing, opts), candidate, existing, opts);
}

function evidenceDecision(decision, candidate, existing, opts) {
  if (!opts.evidence || !decision.claim || decision.outcome === "contradict") return decision;
  const support = credited(existing, decision.claim.support, candidate.seenBy, opts.evidence);
  return { ...decision, claim: settled(decision.claim, support, decision.claim.because) };
}

function fresh(c) {
  const { seenBy, contradicts: _contradicts, ...rest } = c;
  const support = counted({ ...NO_SUPPORT, examples: (rest.evidence ?? []).length }, seenBy, "seen");
  const claim = settled({ ...rest, lastSeenBy: seenBy, ...adoption(rest, seenBy) }, support, rest.because);
  return { outcome: "new", claim, finding: null };
}

// A strength only a person may set is dated to that person's record.
const adoption = (claim, seenBy) => (claimableByObserver(claim.strength) ? {} : { adoptedBy: seenBy });

function contradicted(c, existing) {
  const support = counted(supportOf(existing), c.seenBy, "contested");
  const claim = settled(existing, support, existing.because);
  const finding = { kind: "knowledge-contradicted", claimId: existing.id, say: `a new observation contradicts ${existing.id} (${existing.strength} · ${claim.confidence}) — it is left exactly as it was, and counted as contested; a person resolves it` };
  return { outcome: "contradict", claim, finding };
}

function unfounded(c) {
  return { outcome: "unfounded", claim: null, finding: { kind: "knowledge-unfounded", claimId: claimId(c), say: `a candidate contradicts ${claimId(c)}, which nobody recorded — nothing was written, because storing it would store the claim it calls false` } };
}

// Everything that is a JUDGEMENT -- the triple, the context, the scope, the
// strength -- is carried from the EXISTING claim untouched: reconciliation is
// evidence bookkeeping, never a rewrite of what was decided.
function merged(outcome, existing, c, evidence) {
  const support = { ...counted(supportOf(existing), c.seenBy, "seen"), examples: evidence.length };
  const claim = settled({ ...existing, evidence, lastSeenBy: c.seenBy }, support, existing.because);
  return { outcome, claim, finding: null };
}

// The one row that moves strength: an explicit human record, and it is dated.
function adopted(c, existing) {
  const base = merged("adopt", existing, c, union(existing.evidence, c.evidence));
  const gate = c.enforcedBy ? { enforcedBy: c.enforcedBy } : {};
  return { ...base, claim: { ...base.claim, strength: c.strength, adoptedBy: c.seenBy, ...gate } };
}

const sameEvidence = (a, b) => (a ?? []).length === (b ?? []).length && union(a, b).length === (a ?? []).length;

// The newest MAX_EVIDENCE, once confirmations extend it: a claim does not grow
// with every session that ever cited another file.
const union = (a, b) => [...new Set([...(a ?? []), ...(b ?? [])])].slice(-MAX_EVIDENCE);
