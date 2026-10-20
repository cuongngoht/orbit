// Automation, changed by a PERSON: how autonomous Orbit may be on this machine, what one project narrows that
// to, and how Live looks. This page is the ONE door the automation settings are written through: the engine
// refuses any other (src/automation/settings.mjs), because a terminal cannot prove who typed a flag and an
// agent must never raise its own autonomy. The token and origin checks every mutating route passes are that
// proof; the context's door says so.
//
// Every change names the revision the page read: one open for an hour cannot overwrite what somebody changed a
// minute ago -- a 409.
import { AUTOMATION_SETTINGS_INVALID, writeAutomation, writeLive } from "../core.mjs";
import { guarded, invalid } from "../errors.mjs";
import { readProject } from "../projects/read.mjs";
import { liveFile, liveSettings, machineFile, projectAutomation, automationOverview, projectFile } from "./read.mjs";

function bodyOf(body) {
  if (!body || typeof body.settings !== "object" || body.settings === null || Array.isArray(body.settings)) throw invalid(AUTOMATION_SETTINGS_INVALID, "send { settings, revision }");
  return { changes: body.settings, revision: body.revision ?? null };
}

const writer = (ctx, revision) => ({ revision, by: "person", door: "control", at: ctx.now().toISOString() });

export async function putAutomation(ctx, body) {
  const b = bodyOf(body);
  await guarded(AUTOMATION_SETTINGS_INVALID, () => writeAutomation(ctx.world.io, machineFile(ctx), b.changes, writer(ctx, b.revision)));
  return { saved: automationOverview(ctx) };
}

export async function putProjectAutomation(ctx, key, body) {
  readProject(ctx, key);
  const b = bodyOf(body);
  await guarded(AUTOMATION_SETTINGS_INVALID, () => writeAutomation(ctx.world.io, projectFile(ctx, key), b.changes, writer(ctx, b.revision)));
  return { saved: projectAutomation(ctx, key) };
}

export async function putLiveSettings(ctx, body) {
  const b = bodyOf(body);
  await guarded("LIVE_SETTINGS_INVALID", () => writeLive(ctx.world.io, liveFile(ctx), b.changes, writer(ctx, b.revision)));
  return { saved: liveSettings(ctx) };
}
