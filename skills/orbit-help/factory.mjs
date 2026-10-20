// The ONE real binding of the SKILL FACTORY (src/skill-factory/), for cli/automation.mjs, cli/skill-factory.mjs,
// Orbit Control and the prompt router's hook: the project's own room, what the plugin SHIPS (so a playbook never
// takes a shipped identity, provides what a shipped component provides, or claims tools wider than a shipped
// workflow allows itself), which subcommands each Orbit CLI documents, this engine's version, and the resolver a
// composition root hands in. src/skill-factory/ reads none of these itself.
//
//   factoryPort(h, values, resolve)   -> { scaffold, put, verify, register, status, pinned, playbook, list, ... }
//   gapPort(h, resolve)               -> (resolved, values, needs) -> { kind, word, generates, because, shape }
//   projectSkillsOf(h, values)        -> () -> registry rows for the skills family
//   depsOf(pluginRoot, io, resolve)   -> what validation holds a draft against
//
// `h`: { paths: { storeRoot }, io } -- the checkout a composition root found.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { satisfies } from "../../src/extensions/engine-range.mjs";
import { printable } from "../../src/printable.mjs";
import { pluginComponents } from "../../src/resources/plugin.mjs";
import { frontmatter } from "../../src/skill-factory/frontmatter.mjs";
import { discoveryOf } from "../../src/skill-factory/discover.mjs";
import { gapOf } from "../../src/skill-factory/gap.mjs";
import { contractOf, inputFor, orderOf, outputsOf, stepOf } from "../../src/skill-factory/interpret.mjs";
import { historyOf } from "../../src/skill-factory/history.mjs";
import { reviewOf } from "../../src/skill-factory/review.mjs";
import { projectionOf } from "../../src/skill-factory/source.mjs";
import { archive, draftsOf, listOf, pinned, playbookOf, put, register, revalidate, rollback, scaffold, setStatus, verifyDraft, workflowOf } from "../../src/skill-factory/lifecycle.mjs";
import { skillRows } from "../../src/skill-factory/register.mjs";
import { createGeneratedSkills } from "../../src/skill-factory/store.mjs";
import { documented, headerOf } from "../../src/trace/commands.mjs";
import { engineVersion } from "../../src/version.mjs";

const PLUGIN_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

const readJson = (file) => {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch { return {}; }
};

// What the plugin ships: names, and every capability a shipped skill, agent or builtin provides.
function shippedOf(pluginRoot, io) {
  const catalog = readJson(join(pluginRoot, "catalog", "components.json"));
  const rows = [...Object.values(catalog.skills ?? {}), ...Object.values(catalog.agents ?? {}), ...Object.values(catalog.builtins ?? {})];
  return { names: new Set(pluginComponents(pluginRoot, io).map((c) => c.name)), provides: new Set(rows.flatMap((r) => r.provides ?? [])) };
}

// The tools a shipped workflow allows itself, read off its own SKILL.md -- or null for a skill that is not shipped.
function toolsOf(pluginRoot, workflow) {
  const file = join(pluginRoot, "skills", String(workflow), "SKILL.md");
  if (!/^orbit-[a-z0-9-]+$/.test(String(workflow)) || !existsSync(file)) return null;
  const tools = frontmatter(readFileSync(file, "utf8"))?.["allowed-tools"] ?? [];
  return (Array.isArray(tools) ? tools : String(tools).split(/,\s*/)).filter(Boolean);
}

// Whether `node …/cli/<tool>.mjs <sub>` is a command that CLI's own usage header documents.
function documentedBy(pluginRoot, tool, sub) {
  const file = join(pluginRoot, "cli", `${tool}.mjs`);
  return /^[a-z][a-z-]*$/.test(tool) && existsSync(file) && documented(headerOf(readFileSync(file, "utf8")), tool).has(sub);
}

export const depsOf = (pluginRoot, io, resolve) => ({ shipped: shippedOf(pluginRoot, io), toolsOf: (w) => toolsOf(pluginRoot, w), documented: (tool, sub) => documentedBy(pluginRoot, tool, sub), resolve, engineVersion: engineVersion(), satisfies });

const storeOf = (h) => createGeneratedSkills(h.paths.storeRoot, h.io);

const now = () => new Date().toISOString();

// How a declared workflow is carried (src/skill-factory/interpret.mjs), handed to the coordinator's skill runner: the
// runner imports no subject, so what validation proved and what runs are the same functions, bound here.
export const INTERPRETER = { orderOf, stepOf, inputFor, outputsOf, contractOf };

// The registry row of the playbook a resolver answer names, when it names a project playbook.
const rowFor = (store, resolved) => (resolved?.provider?.ownership === "project" && resolved.provider.kind === "skill" ? listOf(store).find((r) => r.id === resolved.provider.id) ?? null : null);

// ---- what a declared playbook's runs did (0.0.4): read back from the project's coordinators, never kept ----------
//
// A composition root hands in `opts.history`: `tasks()` -- the project's coordinated workflows, each as its view, its
// journal lines and its session -- and `runsOf`, the live core's one reading of a run (src/live/plan.mjs skillRunsOf).
// Only a composition root may reach either; a port bound without them has no history to tell.
const quietly = (fn) => {
  try { return fn(); }
  catch { return null; }
};

const unbound = () => {
  throw new Error("this factory port was bound with no run history: a composition root hands in opts.history");
};

const historyFor = (store, history, id) => historyOf({ id, tasks: history?.tasks?.() ?? unbound(), skillRunsOf: history.runsOf, projectionOf: (pin) => quietly(() => projectionOf(workflowOf(store, pin))) });

// Every version a run held or the registry keeps, and whether its workflow holds to the contract today.
const versionsOf = (store, id, runs) => [...new Set([...listOf(store).filter((r) => r.id === id).map((r) => r.pin), ...runs.map((r) => r.pin)])].map((pin) => ((v) => ({ pin, version: pin.split(":")[1], status: v?.status ?? "unreadable", holds: Boolean(v) }))(quietly(() => workflowOf(store, pin))));

const reviewFor = (store, history, id) => ((runs) => reviewOf({ id, runs, versions: versionsOf(store, id, runs) }))(historyFor(store, history, id));

export function factoryPort(h, values, resolve, opts = {}) {
  const store = storeOf(h);
  const deps = () => depsOf(opts.pluginRoot ?? PLUGIN_ROOT, h.io, resolve);
  const registered = (id, r) => register(store, id, { values: values(), deps: deps(), by: r.by ?? "session", at: now(), engineVersion: engineVersion() });
  return { store, runs: (id) => historyFor(store, opts.history, id), review: (id) => reviewFor(store, opts.history, id), workflow: (pin) => workflowOf(store, pin), current: (id) => listOf(store).find((r) => r.id === id) ?? null, discover: (x) => discoveryOf({ ...x, row: rowFor(store, x.resolved) }), interpreter: INTERPRETER, scaffold: async (s) => scaffold(store, { ...s, values: values(), engineVersion: engineVersion() }), put: (p) => put(store, p), verify: (id) => verifyDraft(store, id, deps()), revalidate: (id) => revalidate(store, id, deps()), register: async (id, r = {}) => registered(id, r), status: (id, status, o = {}) => setStatus(store, id, status, { by: o.by ?? "person", at: now() }), pinned: (pin) => pinned(store, pin), playbook: (ref) => playbookOf(store, ref, printable), list: () => listOf(store), archive: (id, o = {}) => archive(store, id, { by: o.by ?? "person", at: now() }), rollback: (id, version, r = {}) => rollback(store, id, version, { values: values(), deps: deps(), by: r.by ?? "person", at: now(), engineVersion: engineVersion() }), drafts: () => store.drafts(), draftRows: () => draftsOf(store) };
}

export const gapPort = () => (resolved, values, needs) => gapOf(resolved, needs ?? []);

export const projectSkillsOf = (h, values) => () => skillRows(listOf(storeOf(h)), values);
