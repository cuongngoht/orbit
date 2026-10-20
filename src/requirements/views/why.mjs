// How a fact, a question, a decision or a snapshot came to be: every journal line that is
// about it, oldest first, and what it is now. The journal is the explanation -- nothing is
// reconstructed and nothing is guessed, so what this says is what happened.
//
// Read-only.
import { Refused } from "../../errors.mjs";

const ABOUT = [
  { pattern: /^rf-[0-9a-f]{12}$/, kind: "fact", of: (l, id) => l.factId === id, now: (port, id) => port.fact(id) },
  { pattern: /^rq-[0-9a-f]{12}$/, kind: "question", of: (l, id) => l.questionId === id, now: (port, id) => port.question(id) },
  { pattern: /^rd-[0-9a-f]{12}$/, kind: "decision", of: (l, id) => l.decisionId === id, now: (port, id) => port.decision(id) },
  { pattern: /^rs-[0-9a-f]{12}$/, kind: "snapshot", of: (l, id) => l.snapshotId === id, now: (port, id) => port.snapshot(id) },
];

// A line as a reader wants it: what kind, when, and what it says -- the fields that
// explain, and no more.
const lineView = (l) => ({ sequence: l.sequence, at: l.at, kind: l.kind, ...(l.outcome ? { outcome: l.outcome } : {}), ...(l.because ? { because: l.because } : {}), ...(l.clarity ? { clarity: l.clarity, authority: l.authority } : {}) });

export function why(ctx, root, id) {
  const row = ABOUT.find((a) => a.pattern.test(id));
  if (!row) throw new Refused(`${id} is not a fact (rf-…), a question (rq-…), a decision (rd-…) or a snapshot (rs-…)`);
  const port = ctx.requirements.open(root);
  const lines = port.journalLines().filter((l) => row.of(l, id)).sort((a, b) => a.sequence - b.sequence);
  return { id, kind: row.kind, now: row.now(port, id), history: lines.map(lineView), versions: row.kind === "fact" ? port.versions(id).map((v) => ({ revision: v.revision, status: v.status, says: v.says })) : [] };
}
