// PO Reports, changed by a PERSON: the settings, a part switched on or off, a
// replacement approved, an extension verified again or rolled back.
//
// Every change names the settings revision the page read, so a page open for an
// hour cannot overwrite what a session changed a minute ago: that is a 409
// with the reason. Approving a part that replaces a standard one is exactly
// the person's act the composition rules ask for (src/project-report/compose.mjs),
// which is why it exists here and nowhere a session could reach on its own.
import { checkReport, createProcess, createQcTools, publicProviders, readSettings, registeredState, reportStore, rollbackTool, STALE_REVISION, verifyTool, writeSettings } from "../core.mjs";
import { conflict, guarded, invalid, missing } from "../errors.mjs";
import { NOT_IN_CHECKOUT, inCheckout, reportOf } from "./project.mjs";

function checkout(ctx) {
  const found = inCheckout(ctx);
  if (!found) throw conflict("NOT_IN_CHECKOUT", NOT_IN_CHECKOUT);
  return found;
}

// A stale revision is somebody else's change, not a mistake in this one.
const saved = (ctx, found, next, revision) => guarded("REPORT_SETTINGS_INVALID", () => written(ctx, found, next, revision));

function written(ctx, found, next, revision) {
  try {
    return writeSettings(found.room, found.io, { next, revision: revision ?? null, by: "person", providers: publicProviders(), now: ctx.world.io.now() });
  } catch (e) {
    throw e?.code === STALE_REVISION ? conflict(STALE_REVISION, "These settings were changed since you opened them. Reload, then make your change again.") : e;
  }
}

export async function putReportSettings(ctx, body) {
  const found = checkout(ctx);
  if (!body || typeof body.settings !== "object" || body.settings === null) throw invalid("REPORT_SETTINGS_INVALID", "send { settings, revision }");
  return { saved: await saved(ctx, found, body.settings, body.revision) };
}

// { part, revision } -> that part's switch in the project's settings.
const SWITCHES = {
  enable: (was) => ({ ...was, enabled: true }),
  disable: (was) => ({ ...was, enabled: false }),
  approve: (was) => ({ ...was, enabled: true, replace: true }),
  unapprove: (was) => ({ ...was, replace: false }),
};

export async function switchPart(ctx, action, body) {
  const found = checkout(ctx);
  if (typeof body?.part !== "string" || !/^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(body.part)) throw invalid("PART_INVALID", "name the part: { part, revision }");
  const current = readSettings(found.room, found.io).settings;
  const next = { ...current, parts: { ...(current.parts ?? {}), [body.part]: SWITCHES[action](current.parts?.[body.part] ?? {}) } };
  return { saved: await saved(ctx, found, next, body.revision) };
}

// Verified AGAIN, as a person asked: the real loader, then the report checks
// -- the part run for real on a snapshot.
export async function verifyExtension(ctx, body) {
  const { found, ctx: store } = storeOf(ctx);
  const dir = extensionDir(found, body?.extension);
  const verdict = await verifyTool(store, dir, found.io);
  const findings = verdict.ok ? await checkReport(dir, verdict.manifest, await checkDeps(ctx, true)) : verdict.findings;
  return { extension: body.extension, ok: findings.length === 0, findings, fingerprint: registeredState(dir, found.io).state };
}

export async function rollbackExtension(ctx, body) {
  const { found, ctx: store } = storeOf(ctx);
  extensionDir(found, body?.extension);
  const deps = await checkDeps(ctx, true);
  const kept = await guarded("ROLLBACK_FAILED", () => rollbackTool(store, body.extension, found.io, { to: typeof body.to === "string" ? body.to : null, human: true, check: (dir, verdict) => checkReport(dir, verdict.manifest, deps) }));
  return { extension: kept.id, version: kept.entry.rolledBackTo ?? null };
}

function storeOf(ctx) {
  checkout(ctx);
  return reportStore(ctx.world.env, ctx.world.projectRoot);
}

function extensionDir(found, id) {
  const tools = createQcTools(found.store.root, found.io);
  if (typeof id !== "string" || !tools.ids().includes(id)) throw missing("EXTENSION_NOT_FOUND", "this project has no extension by that name");
  return tools.dirOf(id);
}

async function checkDeps(ctx, human) {
  const b = await reportOf(ctx);
  return { python: b.rctx.python?.file ?? null, process: createProcess(), env: ctx.world.env, io: b.rctx.io, human, latest: null };
}
