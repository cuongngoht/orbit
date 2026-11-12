// A CAMPAIGN'S JOURNAL: one append-only line per thing that happened, and every state read back from it by one fold.
// A worker that dies mid-run leaves a `started` with no `ended`; resume reads that as INTERRUPTED (its spend counted as
// its full cap), and runs the slot again as a new attempt, at most MAX_RERUNS times. A run that has an `outcome` is
// held and never run again.
//
//   lines: begun · started {run, attempt} · ended {run, attempt, chargedUsd, ...} · outcome {run, attempt, word, why}
//          interrupted {run, attempt, chargedUsd, found} · skipped {run, reason} · halted {reason} · finished
//   foldJournal(lines) -> { runs: Map(run -> { attempts: [...], outcome, skipped }), halted, finished }
//   ledgerOf(fold, budgetUsd) -> { budgetUsd, chargedUsd, reservedUsd, remainingUsd }   canStart(ledger, capUsd)
import { existsSync, readFileSync } from "node:fs";

export const MAX_RERUNS = 2;

export function readJournal(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).flatMap((l) => {
    try { return [JSON.parse(l)]; }
    catch { return []; }
  });
}

const slot = (runs, id) => runs.get(id) ?? runs.set(id, { attempts: [], outcome: null, skipped: null }).get(id);

const attemptOf = (r, n) => r.attempts.find((a) => a.n === n) ?? (r.attempts.push({ n, started: null, ended: null, outcome: null, interrupted: null }), r.attempts.at(-1));

const STEPS = {
  started: (r, l) => (attemptOf(r, l.attempt).started = l),
  ended: (r, l) => (attemptOf(r, l.attempt).ended = l),
  interrupted: (r, l) => (attemptOf(r, l.attempt).interrupted = l),
  outcome: (r, l) => ((attemptOf(r, l.attempt).outcome = l), (r.outcome = l)),
  skipped: (r, l) => (r.skipped = l),
};

export function foldJournal(lines) {
  const runs = new Map();
  const state = { runs, halted: null, finished: null, begun: [] };
  for (const l of lines) {
    if (STEPS[l.kind] && l.run) STEPS[l.kind](slot(runs, l.run), l);
    if (l.kind === "halted") state.halted = l;
    if (l.kind === "finished") state.finished = l;
    if (l.kind === "begun") state.begun.push(l);
  }
  return state;
}

// An attempt that started and has neither ended nor been marked interrupted: open (running now, or cut by a restart).
export const openAttempts = (fold) => [...fold.runs.entries()].flatMap(([run, r]) => r.attempts.filter((a) => a.started && !a.ended && !a.interrupted).map((a) => ({ run, attempt: a.n, capUsd: a.started.capUsd ?? 0, container: a.started.container ?? null })));

export const interruptedCount = (r) => r.attempts.filter((a) => a.interrupted).length;

export const nextAttempt = (r) => (r?.attempts.length ? Math.max(...r.attempts.map((a) => a.n)) + 1 : 1);

const cents = (usd) => Math.round((usd ?? 0) * 100);

// What the campaign has spent: an ended attempt's charge (its reported cost, or its full cap when the stream had no
// result line), an interrupted attempt's full cap, and -- reserved, not spent -- the cap of every attempt still open.
export function ledgerOf(fold, budgetUsd) {
  const atts = [...fold.runs.values()].flatMap((r) => r.attempts);
  const charged = atts.reduce((s, a) => s + cents(a.ended?.chargedUsd) + cents(a.interrupted?.chargedUsd), 0);
  const reserved = openAttempts(fold).reduce((s, a) => s + cents(a.capUsd), 0);
  return { budgetUsd, chargedUsd: charged / 100, reservedUsd: reserved / 100, remainingUsd: (cents(budgetUsd) - charged - reserved) / 100 };
}

export const canStart = (ledger, capUsd) => cents(ledger.remainingUsd) >= cents(capUsd);

// What an attempt is charged: nothing for an arm that spends nothing; else what its stream said it cost, or -- with no
// result line to say -- its whole cap.
export const chargeOf = (arm, costUsd, capUsd) => (arm.charges === false ? 0 : typeof costUsd === "number" ? costUsd : capUsd);
