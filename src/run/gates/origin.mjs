import { join } from "node:path";
import { varName } from "../../project/env.mjs";
import { Refused } from "../errors.mjs";

// A run that drives a page has to know WHICH application it drives. Since 1.8.9 every Git checkout is a project with
// nothing set up, so a project nobody configured for UI testing can reach a run with no origin at all: it is refused
// here, before any browser is asked, naming the file to set it in -- never a session compared against, or a URL
// built from, `undefined`. A case that needs no page (sql and call steps only) needs no origin and never meets this.
export function originGate(ctx) {
  if (ctx.config.origin) return;
  throw new Refused(`no UI test configuration: set "origin" in ${join(ctx.project.dataRoot ?? ctx.project.uiTests, "project.json")} (or ${varName("ORIGIN")}) before a case can drive a browser`);
}
