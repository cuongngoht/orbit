// Reading a project's own QC tools out of the store and registering them.
//
// Every refusal is RECORDED and returned, never thrown and never silent. That is
// the rule this file exists to keep: an extension that failed to load is the
// likeliest cause of the next confusing error, and "no capability postgres.query
// is registered" with no mention of the manifest that failed three lines earlier
// is how somebody spends an afternoon.
//
// The order is deterministic -- ids sorted -- so two machines loading the same
// store register the same things in the same order, and a duplicate is always
// refused against the same winner rather than against whichever one the
// filesystem happened to list first.
//
// Loading is ASYNC because importing a module is, and it is the only async thing
// in this engine. It is done ONCE, by the composition root, before anything runs;
// nothing downstream ever awaits anything.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { contained } from "../project/boundary.mjs";
import { realIo } from "../store/io.mjs";
import { engineVersion, pluginRoot } from "../version.mjs";
import { MANIFEST_FILE, MODULE_FORMS, MODULES } from "./contract.mjs";
import { satisfies } from "./engine-range.mjs";
import { isLoadable, manifestFindings, notLoadableWhy } from "./manifest.mjs";
import { packRoom } from "./packs.mjs";
import { createReportingParts } from "./reporting-parts.mjs";
import { createQcTools } from "./store.mjs";

// `deps.tools` is how a tool that is not in the store YET gets loaded: the
// builder verifies a scratch directory by handing in a one-entry room over it,
// against a throwaway context, so a candidate is held to exactly the contract a
// registered one is -- before it is trusted anywhere. One loader, one set of
// checks, no second "validation mode" that could drift from the real thing.
//
// A context without a knowledge registry is a composition-root bug, refused
// LOUDLY before anything loads: src/extensions/registries.mjs builds one for
// every throwaway, src/run/context.mjs for every run.
//
// `deps.dataOnly` loads what extensions DECLARE as data and imports none of
// their code: the project-report runner holds a credential in this process
// while it collects, and a capability module imported now would run beside it.
// What it needs from an extension is data anyway -- the parts it runs are
// scripts started as their own processes.
//
// The packs a project opts into (project.json `packs`, ADR 0034) are loaded FIRST, where the
// plugin keeps them, then the project's own room -- so a project's tool can never take an id a
// pack it asked for already holds, and the order two machines load in is the same.
export async function loadExtensions(ctx, deps = {}) {
  if (typeof ctx.knowledge?.register !== "function") throw new TypeError("loadExtensions needs a knowledge registry on its context — src/extensions/registries.mjs emptyRegistries() builds one");
  if (deps.tools) return gathered(ctx, { ...deps.tools, dataOnly: Boolean(deps.dataOnly) });
  const io = deps.io ?? realIo();
  const packs = await packsOf(ctx, io, deps);
  return merged(packs, await ownOf(ctx, io, deps));
}

async function packsOf(ctx, io, deps) {
  const ids = ctx.config?.packs ?? [];
  if (!ids.length) return { loaded: [], refused: [], room: null };
  const asked = packRoom(deps.pluginRoot ?? pluginRoot(), ids, io);
  const out = await gathered(ctx, { ...asked.room, dataOnly: Boolean(deps.dataOnly) });
  return { ...out, refused: [...asked.refused, ...out.refused] };
}

async function ownOf(ctx, io, deps) {
  const room = roomOf(ctx, io);
  if (!room.tools) return { loaded: [], refused: [], room: room.why };
  return gathered(ctx, { ...room.tools, dataOnly: Boolean(deps.dataOnly) });
}

const merged = (a, b) => ({ loaded: [...a.loaded, ...b.loaded], refused: [...a.refused, ...b.refused], room: b.room ?? a.room ?? null });

// Reading never creates, so the store is asked for WITHOUT preparing it. A
// machine with nowhere to write has no extensions rather than an error: a
// command that then needs to write finds out from the writer, in its own words.
function roomOf(ctx, io) {
  try { return { tools: createQcTools(ctx.store(false), io) }; }
  catch (e) { return { tools: null, why: `this project's QC tools could not be read — ${e.message}` }; }
}

async function gathered(ctx, tools) {
  const out = { loaded: [], refused: [], room: null };
  for (const id of tools.ids()) await one(ctx, tools, id, out);
  return out;
}

async function one(ctx, tools, id, out) {
  const read = manifestAt(tools, id);
  if (read.why) return void out.refused.push({ id, why: read.why });
  const stop = gateOf(read.manifest, id);
  if (stop) return void out.refused.push({ id, status: read.manifest.status, why: stop });
  await register(ctx, tools, id, read.manifest, out);
}

function manifestAt(tools, id) {
  const raw = parsed(tools, id);
  if (raw.why) return raw;
  const wrong = manifestFindings(raw.manifest, `${id}/${MANIFEST_FILE}`);
  return wrong.length ? { why: wrong.join("; ") } : { manifest: raw.manifest };
}

function parsed(tools, id) {
  const text = tools.readManifest(id);
  if (text === null || text === undefined) return { why: `${MANIFEST_FILE} is not there` };
  try { return { manifest: JSON.parse(text) }; }
  catch (e) { return { why: `${MANIFEST_FILE} is not readable JSON — ${e.message}` }; }
}

// Two questions, both of which must be YES, and neither of which is the other.
// A draft is well formed and not trusted; an engine mismatch is trusted and not
// this engine. Saying which is what tells somebody whether to verify or upgrade.
function gateOf(manifest, id) {
  if (!isLoadable(manifest)) return notLoadableWhy(manifest);
  return engineProblem(manifest);
}

// A range this engine cannot READ is reported as unknown rather than as
// unsatisfied, and it does not stop the load: telling somebody their working
// extension does not run here, because their range used a syntax we never
// published, would send them to rewrite the wrong thing.
function engineProblem(manifest) {
  if (!manifest.engine) return null;
  const verdict = satisfies(engineVersion(), manifest.engine);
  return verdict.ok || !verdict.tell ? null : verdict.why;
}

async function register(ctx, tools, id, manifest, out) {
  try { out.loaded.push(await registered(ctx, tools, id, manifest)); }
  catch (e) { out.refused.push({ id, status: manifest.status, why: e.message }); }
}

// `from` is who a registry records as the owner: the extension's id, or `pack:<id>` for a pack
// the plugin ships -- asked of the room, so nothing a manifest says can claim to be a pack.
async function registered(ctx, tools, id, manifest) {
  const modules = await imported(tools, id, manifest);
  const shaped = { ...moduleValues(manifest, modules), home: { dir: tools.dirOf(id), tools: manifest.tools ?? [] } };
  const from = tools.fromOf?.(id) ?? id;
  applied(ctx, from, coherent(ctx, shaped, from));
  return { id, from, version: manifest.version, apiVersion: manifest.apiVersion, status: manifest.status, tools: manifest.tools ?? [], mutates: Boolean(manifest.mutates), ...counted(shaped) };
}

// Checked BEFORE a single registration, because the registries are append-only
// and there is nothing to roll back to. A verb an extension declares and cannot
// run would otherwise be caught by agree() at the very end -- after everything
// else had registered -- and one broken extension would stop the whole run
// rather than only itself. What it teaches project knowledge is held to its
// contract here too, for the same reason.
function coherent(ctx, shaped, id) {
  runnable(shaped);
  declared(ctx, shaped, id);
  taught(ctx, shaped);
  reported(ctx, shaped, id);
  return adapted(ctx, shaped);
}

// An adapter declaration is judged whole BEFORE anything of the extension registers, against the
// semantics vocabulary in effect (ADR 0035); a context that holds no adapters refuses one loudly.
function adapted(ctx, shaped) {
  if (shaped.adapters.length && typeof ctx.adapters?.check !== "function") throw new Error("it declares adapters and this context holds none — src/run/context.mjs binds an adapter registry");
  const wrong = shaped.adapters.flatMap((a) => ctx.adapters.check(a));
  if (wrong.length) throw new Error(`what it declares as adapters does not hold — ${wrong.join("; ")} — so nothing of it was registered`);
  return shaped;
}

// A report part is checked against the rows of its OWN contract before anything
// of the extension registers. A context built before 1.6.0 carries no reporting
// registry; its parts are still held to the contract, against a fresh one.
function reported(ctx, shaped, id) {
  const wrong = reportingOf(ctx).check(shaped.reporting.parts, id);
  if (wrong.length) throw new Error(`what it declares for the project report does not hold — ${wrong.join("; ")} — so nothing of it was registered`);
}

const reportingOf = (ctx) => ctx.reporting ?? (ctx.reporting = createReportingParts());

function runnable(shaped) {
  const known = new Set(shaped.executors.map((e) => e?.name));
  const owed = shaped.dsl.verbs.map((v) => v?.name).filter((n) => !known.has(n));
  if (owed.length) throw new Error(`it declares the verb(s) ${owed.join(", ")} and ships no behaviour for them — a case using one would validate and then have nothing to run`);
}

// What a capability says it provides is held to the contract before any of it
// registers, for the reason above: nothing can be taken back afterwards.
function declared(ctx, shaped, from) {
  const wrong = shaped.capabilities.flatMap((c) => ctx.capabilities.check(c, from));
  if (wrong.length) throw new Error(`what it declares as provided does not hold — ${wrong.join("; ")} — so nothing of it was registered`);
}

function taught(ctx, shaped) {
  const wrong = ctx.knowledge.check(shaped.knowledge);
  if (wrong.length) throw new Error(`what it teaches project knowledge does not hold — ${wrong.join("; ")} — so nothing of it was registered`);
}

const counted = (s) => ({ capabilities: s.capabilities.map((c) => c.id), verbs: s.dsl.verbs.map((v) => v.name), fields: Object.keys(s.dsl.fields), validators: s.validators.map((v) => v.id), relations: s.knowledge.relations.map((r) => r.id), interpreters: s.knowledge.interpreters.map((i) => i.id), reportParts: s.reporting.parts.map((p) => p.id), adapters: s.adapters.map((a) => a.id) });

// A module the manifest NAMED and that is not there is a refusal, not a shrug:
// half a declared extension is worse than none, because the half that loaded
// makes the missing half look like it was never wanted.
async function imported(tools, id, manifest) {
  const named = MODULES.filter((k) => manifest[k] && (!tools.dataOnly || MODULE_FORMS[k] === "json"));
  const pairs = await Promise.all(named.map(async (k) => [k, await importOne(tools, id, manifest[k], k)]));
  return Object.fromEntries(pairs);
}

async function importOne(tools, id, relative, key) {
  const dir = tools.dirOf(id);
  const file = contained(dir, join(dir, relative.replace(/^\.\//, "")));
  if (MODULE_FORMS[key] === "json") return parsedData(tools, file, relative, key);
  try { return await import(pathToFileURL(file).href); }
  catch (e) { throw new Error(`${key} module ${relative} could not be loaded — ${e.message}`); }
}

// DATA is read and parsed, never imported: nothing in it can run.
function parsedData(tools, file, relative, key) {
  const text = tools.readFile(file);
  if (text === null || text === undefined) throw new Error(`${key} file ${relative} is not there`);
  try { return JSON.parse(text); }
  catch (e) { throw new Error(`${key} file ${relative} is not readable JSON — ${e.message}`); }
}

// The DSL first, because an executor is refused unless a verb row declares it,
// and a capability is what most extensions are actually for.
function applied(ctx, id, shaped) {
  vocabulary(ctx, id, shaped);
  behaviours(ctx, id, shaped);
}

function vocabulary(ctx, id, shaped) {
  for (const [name, def] of Object.entries(shaped.dsl.fields)) ctx.dsl.registerField(name, def, id);
  for (const verb of shaped.dsl.verbs) ctx.dsl.registerVerb(verb, id);
}

// Knowledge LAST, and with no `?.`: the guard in loadExtensions has already
// said every context carries a knowledge registry, and an optional call would
// skip its own arguments -- the one way a registry nobody bound could turn a
// validation into silence.
function behaviours(ctx, id, shaped) {
  for (const impl of shaped.executors) ctx.executors.register(impl, id);
  for (const cap of shaped.capabilities) ctx.capabilities.register(cap, id);
  ctx.validators?.register?.(shaped.validators, id);
  ctx.knowledge.register(shaped.knowledge, id);
  declaredData(ctx, id, shaped);
}

// What an extension declares as DATA, registered last: its report parts and its adapters -- and,
// when anything of it is reached through a helper, where that helper lives and the tools its
// manifest declared, for the launcher the composition root bound (src/run/worker.mjs).
function declaredData(ctx, id, shaped) {
  if (shaped.reporting.parts.length) reportingOf(ctx).register(shaped.reporting.parts, id);
  for (const a of shaped.adapters) ctx.adapters.register(a, id);
  if (shaped.adapters.length || shaped.capabilities.some((c) => c?.helper)) ctx.helpers?.home?.(id, shaped.home);
}

// Module values are validated as declared. No version conversion or coercion.
function moduleValues(manifest, modules) {
  for (const name of MODULES.filter((key) => manifest[key])) validateModule(name, modules[name]);
  return { capabilities: modules.capabilities?.default ?? [], executors: modules.executors?.default ?? [], validators: modules.validators?.default ?? [], dsl: modules.dsl?.default ?? { verbs: [], fields: {} }, knowledge: modules.knowledge?.default ?? { relations: [], interpreters: [] }, reporting: modules.reporting ?? { parts: [] }, adapters: modules.adapters?.adapters ?? [] };
}

function validateModule(name, module) {
  const value = MODULE_FORMS[name] === "json" ? module : module?.default;
  const list = ["capabilities", "executors", "validators"].includes(name);
  if (list ? !Array.isArray(value) : !value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name}: needs ${list ? "a default array export" : "an object"}`);
  if (DATA_LISTS[name] && !Array.isArray(value[DATA_LISTS[name]])) throw new Error(`${name}: needs { ${DATA_LISTS[name]}: [...] }`);
}

// The one list each DATA module carries.
const DATA_LISTS = { reporting: "parts", adapters: "adapters" };

