// WHICH project Control's Autonomous QA page is about: the checkout Control was
// started from, and only that one -- no route takes a project from outside, the
// rule the report pages keep (control-server/src/reports/project.mjs). Its
// autonomous-qa room is resolved by the same binding the CLI uses.
import { createInvestigations, reportProject, Refused } from "../core.mjs";

export const NOT_IN_CHECKOUT = "Start Orbit Control from the project's checkout: an investigation is about the application that checkout tests.";

// -> { project, io, store (the investigations room) } or null outside a checkout
export function aqaProject(ctx) {
  try {
    const found = reportProject(ctx.world.env, ctx.world.projectRoot);
    return { project: found.project, io: found.io, store: createInvestigations(found.store.root, found.io) };
  } catch (e) {
    if (e instanceof Refused) return null;
    throw e;
  }
}
