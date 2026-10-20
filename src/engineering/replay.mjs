import { JOURNAL_VERSION } from "../memory/journal.mjs";
// Re-derive every fact from the journal, and say where the store disagrees.
//
// This is what makes the journal worth keeping rather than a log nobody reads:
// a fact file is a MATERIALISED answer, and replaying every observation through
// the same reconciliation, in the order they were made, must arrive at the same
// judgement. Where it does not, something wrote a fact without going through
// the door -- or a fact predates the journal, which is said as such, never
// treated as an error.
//
// Pure, and it writes nothing. Only what reconciliation DECIDES is compared --
// never the stamps (`at`, `commit`, `fingerprint`, `status`), which belong to the
// moment of recording and to freshness, not to the evidence.
import { Refused } from "../errors.mjs";
import { reconcile } from "./reconcile.mjs";

export const JUDGED = ["kind", "key", "statement", "scope", "evidence", "strength", "confidence", "enforcedBy"];

export function replayed(lines) {
  const ordered = [...lines].map((l, i) => ({ l, i })).sort((a, b) => journalOrder(a, b));
  return ordered.reduce((facts, { l }) => applied(facts, l), new Map());
}

function applied(facts, line) {
  if (line.v !== JOURNAL_VERSION) throw new Refused("unsupported engineering journal version");
  const decision = reconcile({ ...line.candidate, seenBy: line.seenBy }, facts.get(line.factId) ?? null, { human: line.human, evidence: line.evidence });
  if (decision.fact) facts.set(line.factId, { ...decision.fact, id: line.factId });
  return facts;
}

// One row per fact on either side: same, differs (and in what), not journaled,
// or journaled but missing from the store.
export function compared(stored, lines) {
  const derived = replayed(lines);
  const ids = [...new Set([...stored.map((f) => f.id), ...derived.keys()])];
  const byId = new Map(stored.map((f) => [f.id, f]));
  return ids.map((id) => verdict(id, byId.get(id), derived.get(id)));
}

const VERDICTS = [
  { state: "not-journaled", when: (s, d) => s && !d, say: () => "the stored fact has no supporting journal entry — its evidence cannot be replayed" },
  { state: "missing", when: (s, d) => !s && d, say: () => "the journal derives this fact, but the store has no file for it" },
  { state: "differs", when: (s, d) => differences(s, d).length > 0, say: (s, d) => `the store and the journal disagree on ${differences(s, d).join(", ")}` },
  { state: "same", when: () => true, say: () => "the journal re-derives exactly this" },
];

function verdict(id, stored, derived) {
  const row = VERDICTS.find((v) => v.when(stored, derived));
  return { id, state: row.state, say: row.say(stored, derived) };
}

const differences = (stored, derived) => [...JUDGED.filter((k) => JSON.stringify(stored[k]) !== JSON.stringify(derived[k])), ...supportDiff(stored, derived)];

const supportDiff = (stored, derived) => ["sessions", "against"].filter((k) => stored.support?.[k] !== derived.support?.[k]).map((k) => `support.${k}`);

const journalOrder = (a, b) => a.l.sequence - b.l.sequence;
