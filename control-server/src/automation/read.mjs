// Automation, as a person reads it: autonomy is the default, so what is shown is what is NOT a switch -- the
// limits an administrator may narrow (budgets, the skill factory's bounds, how Live looks), the effective value
// of every field and which document set it, the RESTRICTIONS a person kept from before autonomy was the default
// (lifted only by them, through Health), the policy matrix those values give, and what each agentic host can
// actually do here. Read-only: a read creates no file, and nothing here starts a workflow.
import { join } from "node:path";
import { AUTOMATION_FIXED, AUTOMATION_SETTABLE, catalogFile, effectiveOf, LIVE_FIELDS, matrixOf, ownsStatusLine, projectStoreRoot, readAutomation, readCatalog, readLive, statusLineTarget } from "../core.mjs";
import { readProject } from "../projects/read.mjs";

export const machineFile = (ctx) => join(ctx.world.rooms.automation, "settings.json");

export const projectFile = (ctx, key) => join(projectStoreRoot(ctx.world.storeBase, key), "automation", "settings.json");

export const liveFile = (ctx) => join(ctx.world.rooms.live, "settings.json");

const fieldRow = (f) => ({ path: f.path.join("."), type: f.type, values: f.values ?? null, min: f.min ?? null, max: f.max ?? null, default: f.default, narrow: f.narrow, say: f.say });

const docOf = (d) => ({ settings: d.settings, set: d.content, revision: d.revision, exists: d.exists, unreadable: d.unreadable, updatedAt: d.updatedAt });

const parsed = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

function statusLineInstalled(ctx) {
  try { return ownsStatusLine(parsed(ctx.world.io.read(statusLineTarget(ctx.world.env ?? {})))?.statusLine, ctx.world.rooms); }
  catch { return false; }
}

// What each host can do for a coordinated workflow, from the host catalog -- and the status line as installed.
const hostsOf = (ctx) => {
  try { return readCatalog(ctx.world.io, catalogFile(ctx.world.pluginRoot, "hosts")).hosts ?? []; }
  catch { return []; }
};

export function readinessOf(ctx) {
  const hosts = hostsOf(ctx);
  return hosts.map((h) => ({ id: h.id, name: h.name, agents: h.capabilities?.nativeAgents === true, promptRouter: h.capabilities?.promptRouter === true, statusLine: h.capabilities?.statusLine === true ? (statusLineInstalled(ctx) ? "installed" : "not-installed") : "unavailable" }));
}

const effectiveView = (e) => ({ values: e.values, fields: e.fields, matrix: matrixOf(e.values) });

export function automationOverview(ctx) {
  const machine = readAutomation(ctx.world.io, machineFile(ctx));
  return { version: 1, fields: AUTOMATION_SETTABLE.map(fieldRow), fixed: AUTOMATION_FIXED, machine: docOf(machine), effective: effectiveView(effectiveOf([{ by: "machine", content: machine.content }])), live: liveSettings(ctx), readiness: readinessOf(ctx) };
}

export function projectAutomation(ctx, key) {
  readProject(ctx, key);
  const machine = readAutomation(ctx.world.io, machineFile(ctx));
  const project = readAutomation(ctx.world.io, projectFile(ctx, key));
  return { version: 1, project: key, machine: docOf(machine), settings: docOf(project), effective: effectiveView(effectiveOf([{ by: "machine", content: machine.content }, { by: "project", content: project.content }])) };
}

export function liveSettings(ctx) {
  const doc = readLive(ctx.world.io, liveFile(ctx));
  return { fields: LIVE_FIELDS.map(fieldRow), settings: doc.settings, revision: doc.revision, exists: doc.exists };
}
