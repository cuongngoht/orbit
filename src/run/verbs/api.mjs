// The UI->API half of the three-layer rule. A screen can look right over a call
// that 500'd (this class of app swallows failures) and wrong over a call that
// was fine -- so a case that cares asserts the call itself.
//
// What it asserts is a NEW request: one the UI made after the most recent action
// began (run/watermark.mjs). It used to scan the whole session log and take the
// last match, so a call made minutes earlier -- by the page load, by the
// previous case -- passed the step, and the case reported PASS for a click that
// had done nothing at all. Everything before the mark is invisible here.
import { newerMatching } from "../../browser/index.mjs";
import { budgetOf, pollUntil, stopped } from "../poll.mjs";
import { Blocked, trunc } from "../errors.mjs";

export default {
  name: "api",
  label: (s) => `${s.method ?? ""} ${trunc(s.match, 50)} => ${s.status ?? "2xx"}`,
  act(ctx, run, s) {
    const since = watermark(run, s);
    const budget = budgetOf(ctx, run, s);
    const waited = awaited(ctx, budget, since, s);
    if (!waited.result) throw missed(ctx, run, s, since, budget, waited.ms);
    return { ...waited.result, since: since.n, sinceStep: since.step?.i ?? null };
  },
  tail: (s, r) => `${r.result.method} ${r.result.status}`,
  logged: (r) => ({ result: r.result }),
};

// Among several new matches the FIRST that satisfies wins, so an app that
// answers 401, refreshes and retries 201 is not accused of the 401.
const satisfying = (requests, since, s) => newerMatching(requests, since, s.match, s.method).find((r) => statusOk(r, s)) ?? null;

// A request with no answer yet satisfies nothing: `status: null` means still in
// flight, which is neither a pass nor a wrong status.
const statusOk = (r, s) => (r.status === null ? false : s.status ? r.status === s.status : r.status >= 200 && r.status < 300);

// Timed, so the failure says how long the UI was actually given.
function awaited(ctx, budget, since, s) {
  const t0 = ctx.now();
  const result = pollUntil(ctx, budget, () => satisfying(ctx.browser.requestList(), since.n, s));
  return { result, ms: ctx.now() - t0 };
}

function watermark(run, s) {
  if (!run.watermark) throw new Blocked(`step ${s.i} (api) has no watermark — the run was prepared without one`);
  return run.watermark;
}

// Four situations, four sentences, because they are four different bugs and the
// reader has to act differently on each.
function missed(ctx, run, s, since, budget, ms) {
  const all = newerMatching(ctx.browser.requestList(), since.n, s.match, s.method);
  return stopped(ms, budget, () => `${why(ctx, all, s, since)}${after(since)}`, s.match);
}

function why(ctx, all, s, since) {
  if (!all.length) return absent(ctx, s, since);
  const pending = all.filter((r) => r.status === null);
  if (pending.length === all.length) return `${label(s)} is still in flight — ${all.length} matching call(s), none answered yet`;
  return `${label(s)} => ${all.map((r) => r.status ?? "pending").join(", ")}, expected ${s.status ?? "2xx"}`;
}

// The false pass, named as such: the call exists, it is simply not this one's.
function absent(ctx, s, since) {
  const old = newerMatching(ctx.browser.requestList(), 0, s.match, s.method);
  if (old.length) return `no NEW ${label(s)} — the UI never called it here (${old.length} matching call(s), all from before this step)`;
  return `no ${label(s)} was made — the UI never called it`;
}

const label = (s) => `${s.method ?? "request"} matching ${trunc(s.match, 60)}`;

const after = (since) => (since.step ? `\n     counted from step ${since.step.i} (${since.step.do}${since.step.on ? ` ${since.step.on}` : ""})` : "");
