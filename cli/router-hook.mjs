#!/usr/bin/env node
// The host's UserPromptSubmit hook, wired to the prompt router.
//
//   stdin (the host's JSON) -> the host adapter's `normalize`
//     -> ONE lifecycle event (src/lifecycle/event.mjs), `user-prompt`
//     -> the router subscriber (src/lifecycle/subscribers/router.mjs)
//     -> additionalContext, or nothing
//
// A composition root of its own, beside cli/learn-hook.mjs rather than inside
// it: routing a prompt and learning from a session are two jobs, and one file
// doing both is how a hook becomes the thing everything is added to.
//
// It is the HOT PATH -- it runs before the model sees every prompt -- so it
// binds only local reads: the plugin's catalogs and tree, Orbit's records in the
// machine store (the MCP servers it manages, the host's configuration as last
// observed, the last tool detection), and the project's registered
// capabilities. No network, no MCP handshake, no child process, no Control
// server. The router plans; the one write is the SESSION TRAIL's
// `prompt.submitted` event (src/trace/) -- a salted fingerprint of the prompt,
// its length and the decision's table words and ids, never the text -- and it
// is switched off by the plugin option `trace` or ORBIT_TRACE=off.
//
// FAIL OPEN, always. It exits 0 whatever happens, and when anything at all
// goes wrong -- no project, a corrupt snapshot, a provider that throws, a bug
// here, even a module that no longer loads (everything is imported INSIDE the
// guard for that reason) -- the host gets no routing context and the prompt
// goes through untouched. The prompt itself is never written anywhere.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let ENV = process.env;
const MODULES = { settings: "skills/orbit-learn/hosts/settings.mjs", hosts: "skills/orbit-learn/hosts/index.mjs", event: "src/lifecycle/event.mjs", dispatch: "src/lifecycle/dispatch.mjs", router: "src/lifecycle/subscribers/router.mjs", project: "src/project/index.mjs", env: "src/project/env.mjs", repository: "src/project/repository.mjs", compose: "src/resources/compose.mjs", control: "src/store/control.mjs", io: "src/store/io.mjs", version: "src/version.mjs", capabilities: "src/extensions/capabilities.mjs", pack: "skills/orbit-requirements/bind.mjs", emit: "src/trace/emit.mjs", log: "src/trace/log.mjs", prompt: "src/trace/prompt.mjs", hash: "src/hash.mjs", factory: "skills/orbit-help/factory.mjs", automation: "src/automation/settings.mjs" };

async function main() {
  const input = stdin();
  const m = await loaded();
  const host = await m.hosts.resolveHookHost(input, process.argv);
  ENV = m.settings.hostEnvironment(process.env, host);
  return normalizedAnswer(m, host, input);
}

function normalizedAnswer(m, host, input) {
  const event = quietly(() => m.event.lifecycleEvent(host, input, process.argv));
  if (event?.protocol === 2 && event.session) ENV = { ...ENV, ORBIT_SESSION: event.session };
  return answer(m, host, input, event);
}

async function loaded() {
  const pairs = await Promise.all(Object.entries(MODULES).map(async ([k, rel]) => [k, await import(new URL(`../${rel}`, import.meta.url))]));
  return Object.fromEntries(pairs);
}

// Loading a project's extensions is the one step here that imports anybody's
// code, so it happens only for a prompt, and only when routing is on.
async function answer(m, host, input, event) {
  const routing = () => m.env.switchOf(ENV, "PROMPT_ROUTER", "prompt_router", true);
  const project = event?.event === "user-prompt" && routing() ? quietly(() => m.project.loadProject(ENV, event.cwd)) : null;
  const caps = project ? await m.capabilities.projectCapabilities(project, ENV) : [];
  const storeRoot = event?.event === "user-prompt" && routing() ? quietly(() => project?.storeRoot ?? m.repository.repositoryPaths(event.cwd, ENV)?.storeRoot) : null;
  return quietly(() => m.dispatch.dispatch(event, world(m, { host, input, routing, caps, event, project, storeRoot }), [m.router.router]));
}

// The automation settings a person set, machine then project, narrowed -- read, never written.
function automationValues(m, rooms, storeRoot) {
  const io = m.io.realIo();
  const docs = [{ by: "machine", content: m.automation.readAutomation(io, resolve(rooms.automation, "settings.json")).content }, ...(storeRoot ? [{ by: "project", content: m.automation.readAutomation(io, resolve(storeRoot, "automation", "settings.json")).content }] : [])];
  return m.automation.effectiveOf(docs).values;
}

// This project's generated playbooks, as the skills family lists them -- the same rows Control and a workflow see.
const playbooksOf = (m, storeRoot, values) => (storeRoot && values ? m.factory.projectSkillsOf({ paths: { storeRoot }, io: m.io.realIo() }, values)() : []);

function world(m, b) {
  const plugin = m.version.engineName();
  const rooms = quietly(() => m.control.stateRooms(m.repository.storeBase(ENV)));
  const trail = rooms ? quietly(() => trailOf(m, rooms, b)) : null;
  const automation = rooms ? quietly(() => automationValues(m, rooms, b.storeRoot)) : null;
  return { automation: () => automation, host: b.host, input: b.input, env: ENV, plugin, routing: b.routing, callVia: `node ${resolve(PLUGIN_ROOT, "cli", "mcp.mjs")} call`, resources: () => m.compose.effectiveResourcesOf({ pluginRoot: PLUGIN_ROOT, rooms, io: m.io.realIo(), env: ENV, plugin, platform: process.platform, arch: process.arch, componentReady: b.event?.protocol === 2 ? (c) => c.kind === "skill" : undefined, capabilities: () => b.caps, projectSkills: () => playbooksOf(m, b.storeRoot, automation), packCapabilities: () => m.pack.readerResources(m.pack.connectionReader(rooms, m.io.realIo())) }), salt: () => trail?.salt() ?? null, traced: (decision, facts, injected) => quietly(() => trail?.emit("prompt.submitted", { prompt: facts, ...m.prompt.decisionFacts(decision, injected) })) };
}

// The trail, bound for this one prompt: its session (hashed already) and a
// short hash of the project's store key -- never a path.
function trailOf(m, rooms, b) {
  if (!m.env.switchOf(ENV, "TRACE", "trace", true)) return null;
  const io = m.io.realIo();
  const project = b.project ? m.hash.short(b.project.storeKey ?? `root:${b.project.root}`, 12) : null;
  return { salt: () => m.prompt.saltOf(io, rooms.trace), emit: m.emit.createEmitter({ log: m.log.traceLog(rooms, io), now: io.now, meta: b.event?.protocol === 2 ? { v: 2, agentHost: b.event.host, turn: b.event.turn } : {}, session: b.event?.session ?? null, project }) };
}

function quietly(fn) {
  try { return fn(); }
  catch { return null; }
}

function stdin() {
  try { return JSON.parse(readFileSync(0, "utf8") || "null"); }
  catch { return null; }
}

// Exit only once stdout has taken the answer: a pipe may be asynchronous, and
// an exit that races it would drop the context the router just built.
function finish(payload) {
  const text = quietly(() => (payload == null ? null : `${JSON.stringify(payload)}\n`));
  if (!text) return process.exit(0);
  process.stdout.write(text, () => process.exit(0));
}

main().then(finish, () => finish(null));
