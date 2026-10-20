// NO_PROGRESS, as rows over what the task already counts.
//
// The task folds `repeats`: how many completed attempts in a row, counting back from the last,
// ended on the same failure signature (src/task/model.mjs). A signature is what failed, normalised
// (src/orchestration/failure.mjs), so a cosmetic edit that leaves the same test failing the same
// way counts as no progress, and a change that makes a DIFFERENT test fail -- or the same one fail
// differently -- starts the count again. Nothing here is kept: it is read off the task every time.
import { NO_PROGRESS_REPEATS } from "./vocab.mjs";

const lastSignature = (lw) => lw.view.attempts.filter((a) => a.endedAt).at(-1)?.failureSignature ?? null;

export const PROGRESS = [
  { id: "SAME_FAILURE", holds: (lw) => (lw.view.repeats ?? 0) >= NO_PROGRESS_REPEATS, say: (lw) => `the last ${lw.view.repeats} attempts ended on one failure (signature ${lastSignature(lw)}) — the loop is going round` },
];

// -> { id, because } when the loop is making no progress, else null.
export function noProgress(lw) {
  const row = PROGRESS.find((r) => r.holds(lw));
  return row ? { id: row.id, because: row.say(lw) } : null;
}
