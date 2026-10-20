import { Refused } from "../errors.mjs";

// A case whose first step is not a goto assumes the browser already sits on its
// start screen -- typically because the start url is templated and only a
// human knows the id. Check, don't hope.
export function startScreenGate(ctx, run) {
  const start = ctx.graph.screens.get(run.c.start);
  const firstAction = run.slice.find((s) => !ctx.dsl.verbsWhere("switchesIdentity").has(s.do));
  if ((firstAction && ctx.dsl.verbsWhere("navigates").has(firstAction.do)) || !start?.url) return;
  const here = ctx.browser.ev("location.pathname");
  if (!templateOf(start.url).test(here)) throw new Refused(`${run.c.id} starts on ${run.c.start} (${start.url}) but the session is at ${here} — navigate there first`);
}

const templateOf = (url) => new RegExp("^" + url.replace(/\{\w+\}/g, "[^/]+") + "$");
