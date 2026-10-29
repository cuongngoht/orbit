// The Effective Resource Registry: one provider per family, each isolated, and
// the SAME answer about a skill's switch as the PreToolUse hook gives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync } from "node:fs";
import { resolveHost } from "../skills/orbit-learn/hosts/index.mjs";
import { createCapabilityRegistry } from "../src/capability/registry.mjs";
import { EVENTS, EVENT_NAMES, lifecycleEvent } from "../src/lifecycle/event.mjs";
import { switches } from "../src/lifecycle/subscribers/switches.mjs";
import { componentOn } from "../src/project/components.mjs";
import { catalogFile, readCatalog } from "../src/catalog.mjs";
import { resource } from "../src/resources/model.mjs";
import { pluginComponents } from "../src/resources/plugin.mjs";
import { PROVIDERS } from "../src/resources/providers/index.mjs";
import { capabilityProvider } from "../src/resources/providers/capabilities.mjs";
import { getEffectiveResources, summarize } from "../src/resources/registry.mjs";
import { mcpCatalog } from "../src/mcp/catalog.mjs";
import { toolCatalog } from "../src/tools/catalog.mjs";
import { realIo } from "../src/store/io.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const io = realIo();
const COMPONENTS = pluginComponents(REPO, io);
const context = (over = {}) => ({ env: {}, plugin: "orbit", components: () => COMPONENTS, capabilities: () => [], mcp: () => [], tools: () => [], ...over });

test("UserPromptSubmit is the user-prompt event, and the event list is still derived from the table", () => {
  assert.equal(EVENTS.UserPromptSubmit, "user-prompt");
  assert.deepEqual(EVENT_NAMES, [...new Set(Object.values(EVENTS))]);
  const e = lifecycleEvent(resolveHost({ hook_event_name: "UserPromptSubmit" }), { hook_event_name: "UserPromptSubmit", session_id: "raw-s", cwd: "/repo", prompt: "review PR 1" });
  assert.equal(e.event, "user-prompt");
  assert.equal(e.prompt, "review PR 1", "the router reads it in memory");
  assert.equal(e.cwd, "/repo");
  assert.match(e.session, /^claude:[0-9a-f]{16}$/);
  const tool = lifecycleEvent(resolveHost({ hook_event_name: "PostToolUse" }), { hook_event_name: "PostToolUse", prompt: "never read here", tool_name: "Read" });
  assert.equal(tool.prompt, null, "a prompt is only ever read off UserPromptSubmit");
});

test("the Claude adapter spells a prompt's context the way UserPromptSubmit reads it, and the fallback says nothing", async () => {
  const claude = await import("../skills/orbit-learn/hosts/claude.mjs");
  assert.deepEqual(claude.formatPromptContext("ctx"), { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "ctx" } });
  assert.equal(claude.formatPromptContext(""), null);
  assert.equal(resolveHost({ nothing: true }).formatPromptContext("ctx"), null);
});

test("every family is answered, and one provider that throws empties only its own", () => {
  const broken = [...PROVIDERS.filter((p) => p.family !== "mcp"), { family: "mcp", list: () => { throw new Error("snapshot corrupt"); } }];
  const effective = getEffectiveResources(context(), broken);
  assert.deepEqual(effective.mcp, []);
  assert.equal(effective.skills.length, COMPONENTS.filter((c) => c.kind === "skill").length);
  assert.deepEqual(effective.problems.map((p) => p.family), ["mcp"]);
  assert.doesNotMatch(JSON.stringify(effective.problems), /snapshot corrupt/, "a provider's own error text is not repeated");
});

test("a provider that answers something that is not a list, or whose data thunk throws, is isolated the same way", () => {
  const effective = getEffectiveResources(context({ components: () => { throw new Error("no tree"); }, tools: () => "not a list" }), PROVIDERS);
  assert.deepEqual([effective.skills, effective.agents, effective.tools], [[], [], []]);
  assert.deepEqual(effective.problems.map((p) => p.family).sort(), ["agents", "skills", "tools"]);
  assert.deepEqual(summarize(effective).map((f) => f.family), ["skills", "agents", "mcp", "tools", "capabilities"]);
});

test("a skill the router calls usable is exactly a skill the PreToolUse hook lets start", () => {
  const envs = [{}, { CLAUDE_PLUGIN_OPTION_SKILL_MAP_UI: "false" }, { CLAUDE_PLUGIN_OPTION_SKILL_MAP_UI: "false", ORBIT_SKILL_MAP_UI: "on" }, { ORBIT_AGENT_MAP_HEALER: "off" }];
  const host = { formatDeny: (reason) => ({ deny: reason }) };
  for (const env of envs) {
    const effective = getEffectiveResources(context({ env }), PROVIDERS);
    for (const r of [...effective.skills, ...effective.agents]) {
      const refused = switches.run({ invokes: { kind: r.kind, name: `orbit:${r.id}` } }, { env, plugin: "orbit", host, input: {} }) !== null;
      assert.equal(r.available, !refused, `${r.kind} ${r.id} under ${JSON.stringify(env)}`);
      assert.equal(r.available, componentOn({ kind: r.kind, name: r.id }, env, "orbit"));
    }
  }
});

test("capabilities come off the ONE capability registry, and a project with none answers none", () => {
  const registry = createCapabilityRegistry();
  assert.deepEqual(capabilityProvider.list({ capabilities: () => registry.list() }), []);
  registry.register({ id: "orders.row", apiVersion: "orbit.capability/v1", doc: "one order row", tools: ["psql"], invoke: () => ({}) }, "orders-tool");
  const [cap] = capabilityProvider.list({ capabilities: () => registry.list() });
  assert.deepEqual([cap.id, cap.source, cap.available, cap.routing.provides, cap.routing.needs], ["orders.row", "orders-tool", true, ["orders.row"], ["command:psql"]]);
});

test("the four answers are kept apart and each implies the one before: eligible -> available -> enabled", () => {
  assert.equal(resource("mcp", { id: "x", enabled: false, available: true }).available, false);
  assert.equal(resource("tool", { id: "x", enabled: true, available: true }).available, true);
  assert.equal(resource("tool", { id: "x" }).state, "disabled");
  const external = resource("mcp", { id: "gh", key: "external:gh", ownership: "external", enabled: false, runtimeReady: true, available: false, eligible: false });
  assert.deepEqual([external.runtimeReady, external.available, external.eligible, external.key], [true, false, false, "external:gh"], "the host can run it; Orbit may not route to it");
  const unselected = resource("mcp", { id: "m", enabled: true, available: true, selection: "disabled" });
  assert.deepEqual([unselected.available, unselected.eligible], [true, false]);
  assert.equal(resource("mcp", { id: "p", enabled: true, available: true, eligible: false }).eligible, false, "policy may leave it nothing to be used for");
  assert.equal(resource("skill", { id: "s", enabled: true, available: true }).key, "s", "a key defaults to the id");
});

// ---- the plugin's catalogs ---------------------------------------------------

const shipped = (kind) => COMPONENTS.filter((c) => c.kind === kind).map((c) => c.name).sort();

test("catalog/components.json has one routing row per shipped skill and agent, and none for anything that is not shipped", () => {
  const rows = readCatalog(io, catalogFile(REPO, "components"));
  assert.deepEqual(Object.keys(rows.skills).sort(), shipped("skill"));
  assert.deepEqual(Object.keys(rows.agents).sort(), shipped("agent"));
  for (const row of [...Object.values(rows.skills), ...Object.values(rows.agents)]) {
    assert.ok(row.summary && row.summary.length <= 160, row.summary);
    assert.ok(Array.isArray(row.provides) && row.provides.length, JSON.stringify(row));
    if (row.requiresSignal) assert.ok(row.signals?.length, `${row.summary}: requiresSignal with no signals can never be recommended`);
  }
});

test("the MCP catalog ships Microsoft Learn as a recommended row Orbit can manage with no install -- and no row carries a secret", () => {
  const data = readCatalog(io, catalogFile(REPO, "mcp"));
  const entries = mcpCatalog(data);
  const learn = entries.find((e) => e.id === "microsoft-learn");
  assert.equal(learn.recommended, true);
  assert.deepEqual(learn.definition, { transport: "http", url: "https://learn.microsoft.com/api/mcp", requiredHeaders: [] });
  assert.equal(learn.install.strategy, "remote-http", "a URL is connected to on demand; nothing pretends it has a binary");
  assert.ok(learn.provides.includes("documentation.search") && learn.provides.includes("documentation.microsoft"));
  assert.doesNotMatch(JSON.stringify(data), /"value"|bearer|token/i);
  for (const e of entries.filter((x) => !x.definition)) assert.equal(e.recommended, false, `${e.id} cannot be added, so it is recognition only`);
});

test("every archive install in the tool catalog is pinned: https, a SHA-256 and a binary inside the archive", () => {
  const data = readCatalog(io, catalogFile(REPO, "tools"));
  const tools = toolCatalog(data);
  // 1.7.6: the rows after `python` are the machine tools a project's runtime is checked against
  // (src/runtime/); every one is manual -- Orbit only ever asks what version a machine has.
  assert.deepEqual(tools.map((t) => t.id).sort(), ["azure-cli", "azure-cli-private", "azure-cli-private-win", "devcontainer", "docker", "docker-daemon", "dotnet", "git", "github-cli", "go", "java", "just", "make", "node", "node-control", "npm", "playwright", "pnpm", "python", "python3", "ruby", "sqlcmd", "task", "yarn"]);
  for (const row of data.tools.filter((t) => t.install?.strategy === "archive")) {
    const parsed = tools.find((t) => t.id === row.id);
    assert.deepEqual(Object.keys(parsed.install.assets).sort(), Object.keys(row.install.assets).sort(), `${row.id}: every pin survives validation`);
    assert.ok(row.install.version);
  }
  for (const id of ["git", "github-cli", "azure-cli"]) assert.equal(tools.find((t) => t.id === id).install.strategy, "manual", `${id} belongs to the whole machine, so Orbit does not install it`);
  const runtimeTools = ["node", "npm", "pnpm", "yarn", "dotnet", "python3", "go", "java", "ruby", "make", "task", "just", "docker", "docker-daemon", "devcontainer"];
  for (const id of runtimeTools) assert.equal(tools.find((t) => t.id === id).install.strategy, "manual", `${id} belongs to the whole machine, so Orbit does not install it`);
});

// The rule every other part of src/ keeps: no product, vendor or host name is
// something this code KNOWS. They arrive as catalog data.
test("nothing under src/resources, src/routing, src/mcp, src/context, the project report, connections, the secret port, the policy leaf or the tool manager names a product", () => {
  const files = ["resources", "routing", "mcp", "context", "project-report", "connections"].flatMap((d) => walk(join(REPO, "src", d))).concat(["catalog", "detect", "effective", "install", "archive", "observe", "state", "real", "launch", "ensure", "pylock", "lock"].map((f) => join(REPO, "src", "tools", `${f}.mjs`)), [join(REPO, "src", "policy.mjs"), join(REPO, "src", "secrets.mjs"), join(REPO, "src", "process", "env.mjs"), join(REPO, "src", "store", "archive.mjs"), join(REPO, "src", "store", "control.mjs"), join(REPO, "src", "help", "vocab.mjs")], ["reporting-v1", "reporting-parts", "fingerprint"].map((f) => join(REPO, "src", "extensions", `${f}.mjs`)));
  const PRODUCTS = /microsoft|azure|github|sqlcmd|sql server|playwright|nodejs\.org|entra|sharepoint|dotnet|\.net\b/i;
  for (const f of files) assert.doesNotMatch(readFileSync(f, "utf8").replace(/^\s*\/\/.*$/gm, ""), PRODUCTS, f);
});

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".mjs") ? [join(dir, e.name)] : []));

test("a capability that says it provides something is listed as a provider of it, beside its own id; a connection is a detail, never a need", () => {
  const registry = createCapabilityRegistry();
  registry.register({ id: "tracker.read", apiVersion: "orbit.capability/v1", doc: "reads an item", tools: ["tracker"], provides: ["workitem.read", "tracker.read"], connection: "tracker-a", invoke: () => ({}) }, "tracker-tool");
  const [cap] = capabilityProvider.list({ capabilities: () => registry.list() });
  assert.deepEqual(cap.routing.provides, ["tracker.read", "workitem.read"].sort(), "its own id once, and what it provides");
  assert.deepEqual(cap.routing.needs, ["command:tracker"], "the command it shells out to, and no connection: that is asked when it is invoked");
  assert.equal(cap.detail.connection, "tracker-a");
});
