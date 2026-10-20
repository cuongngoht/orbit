// Keeping the registry's one-line summary of this checkout current, after a command
// that changed something.
//
// Fail-open end to end: a summary is a convenience for a page that lists every
// project, and a command that did its real work must never fail because the
// convenience could not be written or computed. The checkout is first PREPARED so
// that it is bound -- the registry's membership is the binding files
// (src/store/registry.mjs) -- which is idempotent and writes only once.
import { look } from "./understanding.mjs";
import { planned } from "./lifecycle/world.mjs";
import { sessionsNow } from "./lifecycle/start.mjs";
import { noted } from "./summary.mjs";

// The registry's one-line word about a checkout is the PERSON's runtime; a task's sandbox never writes it.
export function summarize(ctx) {
  if (ctx.owner?.kind === "task") return false;
  try {
    ctx.prepare?.();
    const understanding = look(ctx);
    const { plan } = planned(ctx, understanding, ctx.readSettings().settings, { probe: false });
    const sessions = sessionsNow(ctx).map(({ judgement }) => judgement);
    return noted(ctx, { understanding: understanding.state, plan, sessions, branch: ctx.source.branch() });
  } catch {
    return false;
  }
}
