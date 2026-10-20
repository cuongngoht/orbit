// Autonomous QA, read: what a person approved, what is still missing before it
// may act, and every investigation the engine kept -- each one's findings and
// its (redacted) page.
//
// Reading runs nothing: no browser is opened, no investigation is started and
// nothing is probed. An investigation runs from the skill or the CLI; the page
// shows what it kept. The resolved capabilities the skill needs are the Skills
// page's existing view (/api/v1/skills/orbit-qa/resources), not a
// second one here.
import { AQA_MODES, aqaBlockers, componentOn, investigationHtml, investigationJson, investigationModel, investigationSummaries, readAqaSettings } from "../core.mjs";
import { invalid, missing } from "../errors.mjs";
import { aqaProject, NOT_IN_CHECKOUT } from "./project.mjs";

const unavailable = () => ({ available: false, why: NOT_IN_CHECKOUT });

export function autonomousQaOverview(ctx) {
  const found = aqaProject(ctx);
  if (!found) return unavailable();
  const read = readAqaSettings(found.store.paths, found.io);
  return { available: true, version: 1, project: { name: found.project.name, root: found.project.root }, settings: read.settings, revision: read.revision, exists: read.exists, unreadable: read.unreadable, modes: AQA_MODES.map(({ id, mutates, crossIdentity, production, say }) => ({ id, mutates, crossIdentity, production, say })), switchedOn: switchedOn(ctx), blockers: blockersOf(ctx, read.settings), investigations: investigationSummaries(found.store) };
}

const switchedOn = (ctx) => componentOn({ kind: "skill", name: "orbit-qa-agent" }, ctx.world.env, ctx.world.plugin ?? "orbit");

// Per approved environment, what still stands between it and a first action:
// the same gate table every action asks, with no browser in the world.
function blockersOf(ctx, settings) {
  const envs = settings.environments.length ? settings.environments : [null];
  return envs.map((environment) => ({ environment: environment?.id ?? null, blockers: aqaBlockers({ on: switchedOn(ctx), settings, environment, mode: "observe" }) }));
}

function opened(ctx, id) {
  const found = aqaProject(ctx);
  if (!found) throw missing("NOT_IN_CHECKOUT", NOT_IN_CHECKOUT);
  if (!/^inv-[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$/.test(String(id))) throw invalid("INVALID_INVESTIGATION", "an investigation id looks like inv-20260925-120000-ab12");
  if (!found.store.exists(id)) throw missing("NO_INVESTIGATION", `no investigation ${id} in this project`);
  return { found, model: investigationModel(found.store.read(id)) };
}

export function autonomousQaInvestigation(ctx, id) {
  const { found, model } = opened(ctx, id);
  return { version: 1, investigation: investigationJson(model, { project: found.project.name }) };
}

// Always REDACTED here. An unredacted page is the CLI's, where a person who set
// reports.internal asks for it by name.
export function autonomousQaReport(ctx, id) {
  const { found, model } = opened(ctx, id);
  return { version: 1, html: investigationHtml(model, { project: found.project.name, generated: ctx.now().toISOString(), evidenceDir: found.store.evidenceDir(id), bytes: (p) => found.io.bytes?.(p) ?? null }) };
}
