// Did applying it actually help?
//
// This is the half of a learning loop that is usually skipped, and skipping it is
// how a tool accumulates confident advice that has never once been checked.
//
// It is judged on VERDICTS, not on time. The ledger's `status` is reliable; its
// timing is one whole-run number that a slow machine or a cold cache moves as
// easily as a code change does. Comparing pass rates before and after, inside a
// comparable group, is the strongest claim this data supports.
//
// Three rules keep it honest:
//   comparable groups -- the same case on the same machine, never a pooled
//     average across machines that were never running the same thing;
//   a floor        -- fewer than three independent sessions either side is
//     "insufficient data", full stop, not a quiet verdict on a sample of one;
//   the wording    -- "after", never "because of", and every confounder the data
//     can see is named. Something else changed at the same time is the normal
//     case, not the exception.
import { independent } from "../memory/session.mjs";

export const MIN_SESSIONS = 3;
export const VERDICTS = ["improvement", "regression", "no clear difference", "insufficient data"];
const PASSED = new Set(["PASS", "SKIP"]);

export function judge(runs, applied, opts = {}) {
  const mine = runs.filter((r) => r.case === applied.case);
  const groups = [...new Set(mine.map((r) => r.host))].map((host) => group(mine, host, applied.at));
  const usable = groups.filter((g) => enough(g));
  return usable.length ? verdict(usable, groups, opts) : short(groups);
}

function group(runs, host, at) {
  const here = runs.filter((r) => r.host === host);
  const before = here.filter((r) => String(r.at) < String(at));
  const after = here.filter((r) => String(r.at) >= String(at));
  return { host, before: rate(before), after: rate(after) };
}

function rate(runs) {
  const sessions = independent(runs);
  const passed = runs.filter((r) => PASSED.has(r.status));
  return { sessions, runs: runs.length, passed: passed.length, share: runs.length ? passed.length / runs.length : null, commits: [...new Set(runs.map((r) => r.fe_commit).filter(Boolean))] };
}

const enough = (g) => g.before.sessions >= MIN_SESSIONS && g.after.sessions >= MIN_SESSIONS;

function verdict(usable, all, opts) {
  const moved = usable.map((g) => g.after.share - g.before.share);
  const best = Math.max(...moved);
  const worst = Math.min(...moved);
  return { verdict: called(best, worst), groups: usable, skipped: all.filter((g) => !enough(g)).map(thin), confounders: confounders(usable, opts), says: SAYS };
}

// A quarter of the runs is the smallest shift worth calling a direction on with
// samples this size; anything under it is the same answer with noise on top.
const called = (best, worst) => (worst < -0.25 ? "regression" : best > 0.25 ? "improvement" : "no clear difference");

const short = (groups) => ({ verdict: "insufficient data", groups: [], skipped: groups.map(thin), confounders: [], says: `fewer than ${MIN_SESSIONS} independent sessions on one side — nothing here is worth calling a result` });

const thin = (g) => ({ host: g.host, why: `${g.before.sessions} session(s) before and ${g.after.sessions} after — ${MIN_SESSIONS} are needed on each side` });

const SAYS = "these runs happened AFTER the change, which is not the same as because of it";

function confounders(groups, opts) {
  const moved = groups.filter((g) => g.before.commits.some((c) => !g.after.commits.includes(c)));
  const frontend = moved.length ? [`the frontend moved in the same window on ${moved.map((g) => g.host).join(", ")} — that alone could explain the difference`] : [];
  return [...frontend, ...(opts.window ? [] : ["no window was given, so every run ever recorded is in the comparison"])];
}
