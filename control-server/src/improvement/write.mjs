// A PERSON's decisions on a self-improvement campaign (0.3.0, ADR 0045) -- promote a qualified candidate, put back the
// version a promotion replaced, reject a candidate -- and the bounds a person sets. This page is the ONE door these go
// through: the engine refuses them from anywhere else (src/improvement/loop.mjs `person`), because a terminal cannot
// prove who typed them and an agent must never promote its own candidate or raise its own autonomy. Every decision names
// the revision the page read: one open for an hour cannot overwrite what moved a minute ago -- a 409. A promotion still
// passes every gate an engine promotion passes; only the switch that lets the engine promote by itself is a person's.
import { AUTOMATION_SETTINGS_INVALID, improvementDecision, writeAutomation } from "../core.mjs";
import { conflict, guarded, invalid, missing } from "../errors.mjs";
import { projectFile } from "../automation/read.mjs";
import { readProject } from "../projects/read.mjs";
import { improvementCampaign, settingsView } from "./read.mjs";
import { improvementOf } from "./project.mjs";

const CODE = "IMPROVEMENT_DECISION_INVALID";

const CONFLICTS = ["IMP_PHASE", "IMP_ENDED", "STALE_REVISION"];

const translated = (e) => (CONFLICTS.includes(e?.code) ? conflict(e.code, e.message) : e?.code === "IMP_UNKNOWN" ? missing(e.code, e.message) : e);

async function translatedCall(fn) {
  try { return await fn(); }
  catch (e) { throw translated(e); }
}

function decisionOf(body) {
  if (!Number.isInteger(body?.expectedRevision)) throw invalid(CODE, "send { expectedRevision } — the campaign revision this page read");
  return { expected: body.expectedRevision, because: typeof body.because === "string" ? body.because.slice(0, 240) : undefined };
}

export async function decided(ctx, key, id, act, body) {
  const d = decisionOf(body);
  const result = await guarded(CODE, () => translatedCall(() => improvementDecision(improvementOf(ctx, key, "control"), id, act, d)));
  return { result, ...improvementCampaign(ctx, key, id) };
}

// The bounds of self-improvement, written into the PROJECT's automation document: they only narrow what the machine
// allows, and nothing outside the improvement block is written from this page.
function changesOf(body) {
  const s = body?.settings;
  if (!s || typeof s !== "object" || Array.isArray(s)) throw invalid(AUTOMATION_SETTINGS_INVALID, "send { settings: { <improvement field>: value }, revision }");
  return { improvement: s };
}

export async function putImprovementSettings(ctx, key, body) {
  readProject(ctx, key);
  const changes = changesOf(body);
  await guarded(AUTOMATION_SETTINGS_INVALID, () => writeAutomation(ctx.world.io, projectFile(ctx, key), changes, { revision: body.revision ?? null, by: "person", door: "control", at: ctx.now().toISOString() }));
  return { saved: settingsView(ctx, key) };
}
