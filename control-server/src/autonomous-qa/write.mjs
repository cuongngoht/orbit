// Autonomous QA, changed by a PERSON: the settings document -- enabled,
// environments and the modes approved on each, identities, limits, the
// duplicate and tenancy contracts. This page IS the person's act the engine's
// gates ask for (src/investigation/gates.mjs), which is why the write exists
// here and nowhere a session could reach on its own.
//
// Every change names the revision the page read: a page open for an hour
// cannot overwrite what somebody changed a minute ago -- that is a 409.
import { AQA_STALE_REVISION, writeAqaSettings } from "../core.mjs";
import { conflict, guarded, invalid } from "../errors.mjs";
import { aqaProject, NOT_IN_CHECKOUT } from "./project.mjs";

export async function putAutonomousQaSettings(ctx, body) {
  const found = aqaProject(ctx);
  if (!found) throw conflict("NOT_IN_CHECKOUT", NOT_IN_CHECKOUT);
  if (!body || typeof body.settings !== "object" || body.settings === null || Array.isArray(body.settings)) throw invalid("AQA_SETTINGS_INVALID", "send { settings, revision }");
  return { saved: await guarded("AQA_SETTINGS_INVALID", () => written(ctx, found, body)) };
}

function written(ctx, found, body) {
  try {
    return writeAqaSettings(found.store.paths, found.io, { next: body.settings, revision: body.revision ?? null, by: "person", now: ctx.now().toISOString() });
  } catch (e) {
    throw e?.code === AQA_STALE_REVISION ? conflict(AQA_STALE_REVISION, "These settings were changed since you opened them. Reload, then make your change again.") : e;
  }
}
