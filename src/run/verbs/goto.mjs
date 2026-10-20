import { StepError } from "../errors.mjs";
import { budgetOf, poll } from "../poll.mjs";

const absolute = (origin, u) => (/^https?:/.test(u) ? u : origin + u);

export default {
  name: "goto",
  label: (s) => s.url,
  // Resolved at PLAN time, because --dry and the screen grouping need it before
  // anything is driven. The planner used to compute it, which meant the planner
  // knew what a goto is.
  plan: (st, graph) => ({ url: st.url ?? graph.screens.get(st.screen)?.url }),
  act(ctx, run, s) {
    if (/\{\w+\}/.test(s.url)) throw new StepError(`templated url ${s.url} — declare the value as a param`);
    const url = absolute(ctx.config.origin, s.url);
    ctx.browser.goto(url);
    // A route missing from this environment's menu renders a fallback screen instead
    // of 404ing, and every later click is then wrong -- so assert the path.
    return landed(ctx, run, s, new URL(url).pathname);
  },
};

// The budget is the step's, like every other wait: {tries: 25, timeoutSec: 120}
// was written in here, so a goto honoured neither the step's own `tries` nor
// ORBIT_STEP_TIMEOUT, and no run deadline could clip it.
function landed(ctx, run, s, path) {
  const what = () => `not on ${s.screen}: landed at ${ctx.browser.ev("location.pathname")}`;
  return poll(ctx, `location.pathname===${JSON.stringify(path)}`, budgetOf(ctx, run, s), what);
}
