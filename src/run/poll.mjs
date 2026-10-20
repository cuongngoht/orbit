// Wait for something under a budget, or stop saying WHICH budget ran out and how
// long it really took -- "60 polls" tells a reader nothing about whether the
// screen was slow or the predicate was simply wrong.
//
// This is the ONLY wait loop in the engine, and it is clocked by ctx.now(). The
// browser port used to run a second one with its own Date.now, so the deadline
// was measured by a clock no test could move while the message was measured by
// one it could.
//
// `what` may be a thunk, and for anything that reads the page it must be: built
// eagerly it describes the page BEFORE the poll, which is how a goto the router
// bounced straight back once reported landing where it aimed.
import { Blocked, StepError } from "./errors.mjs";

export { budgetOf } from "./budget.mjs";

// Probe until it returns something truthy, or a budget is spent. Returns what
// the probe returned, so a caller can poll for a VALUE and not just a boolean.
export function pollUntil(ctx, budget, probe) {
  const until = ctx.now() + budget.timeoutSec * 1000;
  for (let i = 1; i <= budget.tries; i++) {
    const got = probe(i);
    if (got) return got;
    if (ctx.now() >= until) return null;
  }
  return null;
}

export function poll(ctx, js, budget, what = null) {
  const t0 = ctx.now();
  const n = pollUntil(ctx, budget, (i) => (ctx.browser.truthy(js) ? i : 0));
  if (n) return n;
  throw stopped(ctx.now() - t0, budget, what, js);
}

// Which budget expired decides the KIND of stop, because they are not the same
// news: the step's own limits are about the product, the run's is about us.
export function stopped(ms, budget, what, js) {
  const detail = typeof what === "function" ? what() : what;
  const said = `after ${(ms / 1000).toFixed(1)}s: ${detail ?? js}`;
  const timedOut = ms >= budget.timeoutSec * 1000;
  if (budget.clipped && timedOut) return waiting(new Blocked(`RUN DEADLINE ${said} — the run's ${budget.runSec}s budget is spent (ORBIT_RUN_TIMEOUT)`));
  return waiting(new StepError(`TIMEOUT ${said} (${timedOut ? `${budget.timeoutSec}s timeout` : `${budget.tries} polls`})`));
}

// WHICH PART of the step stopped it, carried on the error by the code that threw
// so nothing downstream has to read the message to find out. A browser command
// that failed is news about the LOCATOR; a wait that ran out is news about the
// product reaching a state. Treating those two as one thing is exactly how a
// timeout ends up being called map drift and a correct map record gets edited.
const waiting = (err) => Object.assign(err, { phase: "wait" });
