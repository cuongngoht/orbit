// AUTONOMOUS IMPROVEMENT, as a person reads it (0.3.0, ADR 0045): what the engine found, what it is doing about each
// finding, the evidence every decision stands on, and the settings that bound it. Every campaign is the SAME projection
// `improve show` prints and Orbit Live draws (src/improvement/views.mjs). Read-only: a read creates no file.
import { AUTOMATION_FIELDS, campaignRow, campaignView, improvementEvents, improvementModel, improvementPhases, improvementQuality, opportunityView } from "../core.mjs";
import { missing } from "../errors.mjs";
import { improvementOf, settingsOf } from "./project.mjs";

const CAMPAIGN = /^imp-[a-f0-9]{12}$/;

const fieldRow = (f) => ({ key: f.path.at(-1), path: f.path.join("."), type: f.type, values: f.values ?? null, min: f.min ?? null, max: f.max ?? null, default: f.default, narrow: f.narrow, say: f.say });

const IMPROVEMENT_FIELDS = AUTOMATION_FIELDS.filter((f) => f.path[0] === "improvement");

// The bounds a person sets, what each is now and which document set it -- the project's narrows the machine's.
export const settingsView = (ctx, key) => ((s) => ({ fields: IMPROVEMENT_FIELDS.map(fieldRow), values: s.effective.values.improvement, by: Object.fromEntries(IMPROVEMENT_FIELDS.map((f) => [f.path.at(-1), s.effective.fields[f.path.join(".")]?.by ?? "default"])), revision: s.project.revision, machineRevision: s.machine.revision }))(settingsOf(ctx, key));

const modelsOf = (p) => p.store.list().map((id) => ({ id, m: improvementModel(p.store.read(id) ?? []) })).filter((x) => x.m.meta);

export function improvementOverview(ctx, key) {
  const p = improvementOf(ctx, key);
  const models = modelsOf(p);
  const opportunities = p.store.opportunities();
  return { version: 1, project: key, settings: settingsView(ctx, key), analysed: p.store.analysed(), phases: improvementPhases(models.map((x) => x.m)), opportunities: { total: opportunities.length, eligible: opportunities.filter((o) => o?.eligible).length, unreadable: opportunities.filter((o) => o?.unreadable).length }, campaigns: models.map((x) => campaignRow(campaignView(x.id, x.m, p.values()))), metrics: improvementQuality({ campaigns: models.map((x) => x.m), opportunities }) };
}

export const improvementOpportunities = (ctx, key) => ({ version: 1, project: key, opportunities: improvementOf(ctx, key).store.opportunities().map(opportunityView) });

export function improvementCampaign(ctx, key, id) {
  const p = improvementOf(ctx, key);
  const lines = CAMPAIGN.test(String(id)) ? p.store.read(id) : null;
  if (!lines) throw missing("IMP_UNKNOWN", "no improvement campaign like that in this project");
  return { version: 1, project: key, campaign: { ...campaignView(id, improvementModel(lines), p.values()), events: improvementEvents(id, lines) } };
}
