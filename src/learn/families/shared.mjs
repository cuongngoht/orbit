// The arithmetic every family shares, so none of them invents its own.
//
// `tally` is the important one: it counts SESSIONS, not runs. A family that
// reached for `runs.length` would let one tester's afternoon look like a trend,
// which is the single easiest way for a store like this to talk itself into
// believing something.
import { sessionId } from "../../memory/session.mjs";

export function groupBy(items, keyOf) {
  const by = new Map();
  for (const item of items) by.set(keyOf(item), [...(by.get(keyOf(item)) ?? []), item]);
  return by;
}

export function tally(runs) {
  const sessions = [...new Set(runs.map(sessionId))];
  const hostNames = [...new Set(runs.map((r) => r.host).filter(Boolean))];
  const times = runs.map((r) => r.at).filter(Boolean).sort();
  return { for: sessions.length, hosts: hostNames.length, hostNames, sessions, runs: runs.length, firstSeen: times[0] ?? null, confirmed: times[times.length - 1] ?? null, fe_commit: latestCommit(runs) };
}

const latestCommit = (runs) => [...runs].sort(byTime).at(-1)?.fe_commit ?? null;

export const byTime = (a, b) => String(a.at ?? "").localeCompare(String(b.at ?? ""));

export const FINDING = { kind: "saw", applies: [], notWhen: [], against: 0, notes: 0, evidenceRuns: [], evidenceNotes: [], missing: [] };

export const finding = (fields) => ({ ...FINDING, ...fields });

// A row for the lesson's evidence table. `session` is what makes three runs in
// one sitting visibly one session to a reader, not just to the counter.
export const runRow = (r) => ({ session: sessionId(r), at: r.at, status: verdictOf(r), fe_commit: r.fe_commit ?? null });

const verdictOf = (r) => (r.failedStep ? `${r.status} at step ${r.failedStep.i} ${r.failedStep.do} ${r.failedStep.on ?? ""}`.trim() : r.status);

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
