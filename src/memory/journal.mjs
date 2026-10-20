import { Refused } from "../errors.mjs";

export const JOURNAL_VERSION = 3;

// The newest materialized write-ahead result, selected by transaction sequence.
// This is a recovery hint in the journal; replay still derives from candidates.
export function pendingResult(lines, field, id, current) {
  const last = lines.filter((line) => line.v === JOURNAL_VERSION && line[field] === id).sort((a, b) => a.sequence - b.sequence).at(-1);
  if (!last?.result || sameDecision(current, last.result)) return null;
  return last.result;
}
const FIELDS = ['id', 'at', 'commit', 'fingerprint', 'support', 'strength', 'confidence', 'evidence', 'lastSeenBy', 'adoptedBy'];
const sameDecision = (a, b) => a && FIELDS.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));

// The journal read ONCE for a batch that already holds the store's lock: every
// line this batch appends is added to the same list, so a later candidate sees
// it and a sequence is still the next one. Without the lock nobody else can
// append, which is the only reason a cached read is still the whole journal.
export function readOnce(port, read) {
  const lines = currentJournal(port[read]());
  return { ...port, [read]: () => lines, journal: (line) => appended(port, lines, line) };
}

function appended(port, lines, line) {
  port.journal(line);
  lines.push(line);
}

const JOURNAL_FIELDS = ["v", "at", "factId", "claimId", "candidate", "seenBy", "human", "commit", "outcome", "evidence", "sequence", "result", "operation", "stamp"];

export function currentJournal(lines) {
  if (lines.some((line) => line?.v !== JOURNAL_VERSION || Object.keys(line).some((k) => !JOURNAL_FIELDS.includes(k)))) throw new Refused(`Unsupported memory journal version; expected ${JOURNAL_VERSION}; files unchanged`);
  return lines;
}
