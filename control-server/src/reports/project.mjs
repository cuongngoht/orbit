// WHICH project Control's PO Reports pages are about: the checkout Control was
// started from, and only that one -- no route takes a project from outside.
// Started anywhere that is not a Git checkout, there is no project to report
// on, and the pages say so rather than guess one.
import { boundReport, readSettings, reportProject, Refused } from "../core.mjs";

export const NOT_IN_CHECKOUT = "Start Orbit Control from the project's checkout: a project report is about the repository it was started in.";

export function inCheckout(ctx) {
  try {
    return reportProject(ctx.world.env, ctx.world.projectRoot);
  } catch (e) {
    if (e instanceof Refused) return null;
    throw e;
  }
}

// The report as the CLI binds it, over Control's own rooms and secret port.
export const reportOf = (ctx) => boundReport({ env: ctx.world.env, cwd: ctx.world.projectRoot, rooms: ctx.world.rooms, secrets: ctx.world.secrets, sources: ctx.world.reportSources, fetch: ctx.world.fetch, log: ctx.log });

export function settingsOf(ctx) {
  const found = inCheckout(ctx);
  return found ? { found, ...readSettings(found.room, found.io) } : null;
}
