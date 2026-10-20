import { varName } from "../../project/env.mjs";
import { Refused } from "../errors.mjs";

// Polls through the transient "context destroyed" window, so a browser that is
// merely mid-redirect is never reported as a missing one.
export function sessionGate(ctx, run) {
  const state = ctx.browser.settled();
  const dir = ctx.browser.dir();
  if (state === "NONE") throw new Refused(`no playwright-cli session in ${dir} — ${howToOpen(ctx, dir)}`);
  if (state === "SIGNIN") throw new Refused(`the session in ${dir} is parked on a sign-in page — finish signing in there, then re-run`);
  report(ctx, run, state, dir);
}

// A host session's browser is its own (src/project/affinity.mjs): the run directory is that session's, and a
// RUN_DIR somebody exported is not read -- so telling them to export one sent them round the same refusal again.
const OPEN = {
  isolated: (dir) => `this host session's browser is its own: open one with the launcher's --run-dir ${dir} (${varName("RUN_DIR")} is not read in a host session)`,
  shared: () => `run the launcher, then export ${varName("RUN_DIR")}=<the run directory it printed>`,
};

const howToOpen = (ctx, dir) => OPEN[ctx.project?.isolated ? "isolated" : "shared"](dir);

function report(ctx, run, state, dir) {
  const host = new URL(ctx.config.origin).host;
  if (state !== host) ctx.warn(`! session is on ${state}, case targets ${host}`);
  run.print.say(`session: ${state}  (${dir})`);
}
