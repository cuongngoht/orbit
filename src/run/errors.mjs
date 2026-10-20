// The outcome vocabulary of a run: the three typed stops (defined one layer up,
// in src/errors.mjs, so the PORTS can throw them too) and the exit codes.
import { fromEnv, varName } from "../project/env.mjs";
import { Refused } from "../errors.mjs";
export { Blocked, Refused, StepError } from "../errors.mjs";

// PARTIAL is exit 0 -- a deliberate --from/--to slice is the documented way to
// debug a case, and a non-zero code there would break every wrapper checking $?.
// INCONCLUSIVE is exit 4: the run ruled on NOTHING, which is neither "the product
// is wrong" nor "we never got to ask" but a third thing, and CI must not be green
// on it.
export const EXIT = { PASS: 0, SKIP: 0, PARTIAL: 0, FAIL: 1, REFUSED: 2, BLOCKED: 3, INCONCLUSIVE: 4 };

export const DEFAULT_TIMEOUT_SEC = (env = process.env) => seconds(fromEnv(env, "STEP_TIMEOUT"), 120, "STEP_TIMEOUT");

// Number("abc") is NaN, and `now() >= NaN` is always false -- so one typo in the
// variable silently switched the deadline off and left only the poll count.
export function seconds(given, fallback, name) {
  if (given === undefined || given === null || given === "") return fallback;
  const n = Number(given);
  if (!Number.isFinite(n) || n <= 0) throw new Refused(`${varName(name)}=${given} is not a number of seconds`);
  return n;
}
export const DEFAULT_TRIES = 25;
export const trunc = (s, n = 70) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s ?? "");
