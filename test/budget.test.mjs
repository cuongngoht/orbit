import assert from "node:assert/strict";
import { test } from "node:test";
import { createBrowser } from "../src/browser/index.mjs";
import { createDatabase } from "../src/database/index.mjs";
import { Blocked, Refused, StepError } from "../src/run/errors.mjs";
import { budgetOf, createBudget } from "../src/run/budget.mjs";
import { poll } from "../src/run/poll.mjs";
import { fakeClock } from "./fakes/clock.mjs";

const ctxOf = (clock, truthy = () => false) => ({ now: clock.now, env: {}, browser: { truthy } });

// Three budgets used to disagree: `wait` read the step, `goto` had 25/120 written
// into it, and `api` counted tries and ignored timeout entirely.
test("one budget answers for every wait, and the step can narrow it", () => {
  const ctx = ctxOf(fakeClock());
  const run = { budget: createBudget(ctx, {}) };
  assert.deepEqual(budgetOf(ctx, run, {}).tries, 25);
  assert.equal(budgetOf(ctx, run, {}).timeoutSec, 120);
  assert.equal(budgetOf(ctx, run, { tries: 3 }).tries, 3);
  assert.equal(budgetOf(ctx, run, { timeout: 5 }).timeoutSec, 5);
  assert.equal(budgetOf(ctxOf(fakeClock()), { budget: createBudget(ctxOf(fakeClock()), { ORBIT_STEP_TIMEOUT: "7" }) }, {}).timeoutSec, 7);
});

// Number("abc") is NaN and `now() >= NaN` is always false, so one typo used to
// switch the deadline off silently and leave only the poll count.
test("a malformed budget variable is refused, not silently ignored", () => {
  assert.throws(() => createBudget(ctxOf(fakeClock()), { ORBIT_STEP_TIMEOUT: "soon" }), Refused);
  assert.throws(() => createBudget(ctxOf(fakeClock()), { ORBIT_RUN_TIMEOUT: "0" }), Refused);
});

// The clock is the fake one, so this is instant and the attempt count is exact.
test("a poll stops on whichever budget runs out first, and says which", () => {
  const clock = fakeClock();
  const ctx = ctxOf(clock, () => { clock.tick(1000); return false; });
  const byTries = () => poll(ctx, "x", { tries: 3, timeoutSec: 600, runSec: 900 });
  assert.throws(byTries, (e) => e instanceof StepError && /\(3 polls\)/.test(e.message));

  const clock2 = fakeClock();
  const ctx2 = ctxOf(clock2, () => { clock2.tick(1000); return false; });
  assert.throws(() => poll(ctx2, "x", { tries: 999, timeoutSec: 4, runSec: 900 }), (e) => e instanceof StepError && /\(4s timeout\)/.test(e.message));
});

// A step that is too slow is the PRODUCT being slow. The run deadline is the
// harness giving up, and proves nothing about the product -- so it is BLOCKED.
test("the run deadline is Blocked, not a product failure", () => {
  const clock = fakeClock();
  const ctx = ctxOf(clock, () => { clock.tick(1000); return false; });
  const run = { budget: { endsAt: clock.now() + 2000, stepSec: 600, tries: 25, runSec: 900 } };
  const budget = budgetOf(ctx, run, { timeout: 600 });
  assert.ok(budget.clipped, "the step asked for more than the run has left");
  assert.throws(() => poll(ctx, "x", budget), (e) => e instanceof Blocked && /RUN DEADLINE/.test(e.message));
});

// Neither port passed a timeout, so one wedged child outlived every budget the
// case declared -- and because requests/console/ev tolerate failure, the wedge
// came back as text a poll then span on.
test("a child process that has to be killed is Blocked, even where failure is tolerated", () => {
  const wedged = () => { const e = new Error("timed out"); e.code = "ETIMEDOUT"; e.killed = true; throw e; };
  const browser = createBrowser("/tmp/x", { exec: wedged, timeoutMs: 30000 });
  assert.throws(() => browser.goto("https://a.test"), Blocked, "an action");
  assert.throws(() => browser.requests(), (e) => e instanceof Blocked && /was killed after 30s/.test(e.message), "and a tolerated read");
});

test("the timeout really reaches the child, and a killed query is not a product failure", () => {
  let got = null;
  createBrowser("/tmp/x", { exec: (bin, args, opts) => { got = opts; return ""; }, timeoutMs: 12345 }).console();
  assert.equal(got.timeout, 12345);
  assert.equal(got.killSignal, "SIGKILL");

  let dbOpts = null;
  const db = createDatabase(["sqlx"], { spawn: (bin, args, opts) => { dbOpts = opts; return { signal: "SIGKILL" }; }, timeoutMs: 9000 });
  const r = db.query("SELECT 1");
  assert.equal(dbOpts.timeout, 9000);
  assert.equal(r.ok, false);
  assert.match(r.error, /was killed after 9s — the query never answered/);
});
