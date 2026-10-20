// One budget, and one question every wait asks of it.
//
// There were three. `wait` read tries/timeout through poll.mjs; `goto` had
// {tries: 25, timeoutSec: 120} written into it, so it honoured neither the
// step's `tries` nor ORBIT_STEP_TIMEOUT; and `api` counted tries in a loop with
// no delay and never looked at `timeout` at all. Nothing had a run-level limit,
// and no child process had a timeout, so one wedged playwright-cli could outlive
// every budget the case declared.
import { fromEnv } from "../project/env.mjs";
import { DEFAULT_TIMEOUT_SEC, DEFAULT_TRIES, seconds } from "./errors.mjs";

export const DEFAULT_RUN_SEC = (env = process.env) => seconds(fromEnv(env, "RUN_TIMEOUT"), 900, "RUN_TIMEOUT");

export function createBudget(ctx, env) {
  const runSec = DEFAULT_RUN_SEC(env);
  return { endsAt: ctx.now() + runSec * 1000, stepSec: DEFAULT_TIMEOUT_SEC(env), tries: DEFAULT_TRIES, runSec };
}

// A step's own budget, clipped by whatever is left of the run's. `clipped` is
// what lets the failure say WHICH limit stopped it -- and the two mean different
// things: a slow step is the product being slow, a spent run deadline is the
// harness giving up and proves nothing.
export function budgetOf(ctx, run, s) {
  const b = run?.budget ?? createBudget(ctx, ctx.env);
  const want = s.timeout ?? b.stepSec;
  const leftSec = Math.max(Math.ceil((b.endsAt - ctx.now()) / 1000), 0);
  return { tries: s.tries ?? b.tries, timeoutSec: Math.min(want, leftSec), clipped: leftSec < want, runSec: b.runSec };
}

// What is left of the run, for a child process that must not outlive it.
export const remainingMs = (ctx, run) => Math.max((run?.budget?.endsAt ?? Infinity) - ctx.now(), 0);
