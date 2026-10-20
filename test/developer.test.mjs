// orbit-develop: a workflow that declares what it NEEDS as capabilities, gets
// project context before anything else, is handed a resource only when the
// task asks for one -- and never provisions anything itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogFile, readCatalog } from "../src/catalog.mjs";
import { effectiveMcp } from "../src/mcp/effective.mjs";
import { managedRecord } from "../src/mcp/managed.mjs";
import { envSecrets } from "../src/secrets.mjs";
import { mcpCatalogAt } from "../src/resources/compose.mjs";
import { pluginBuiltins, pluginComponents } from "../src/resources/plugin.mjs";
import { PROVIDERS } from "../src/resources/providers/index.mjs";
import { getEffectiveResources } from "../src/resources/registry.mjs";
import { route } from "../src/routing/resolve.mjs";
import { realIo } from "../src/store/io.mjs";
import { sealed } from "./home.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const io = realIo();
const COMPONENTS = pluginComponents(REPO, io);
const MCP_CATALOG = mcpCatalogAt(REPO, io);
const AT = "2026-09-24T08:00:00.000Z";
const learn = () => {
  const e = MCP_CATALOG.find((x) => x.id === "microsoft-learn");
  return { "microsoft-learn": managedRecord({ ...e.definition, id: e.id, provides: e.provides, signals: e.signals, requiresSignal: e.requiresSignal }, { origin: "catalog", catalog: e.id, at: AT }) };
};
const everything = () => ({ ...learn(), github: managedRecord({ id: "github", transport: "http", url: "https://api.githubcopilot.com/mcp/", provides: ["repository.read", "code.review"], signals: ["github", "pr"], requiresSignal: true }, { origin: "custom", at: AT }), docs: managedRecord({ id: "docs", transport: "http", url: "https://docs.example/mcp", provides: ["documentation.search"] }, { origin: "custom", at: AT }) });

function registry({ managed = {}, builtins = pluginBuiltins(REPO, io), env = {} } = {}) {
  const mcp = () => effectiveMcp({ catalog: MCP_CATALOG, state: { managed: { servers: managed } }, secrets: envSecrets({}), now: Date.parse(AT), platform: "linux", arch: "x64" });
  return getEffectiveResources({ env, plugin: "orbit", components: () => COMPONENTS, builtins: () => builtins, capabilities: () => [], tools: () => [], mcp }, PROVIDERS);
}

const node = (d, requirement) => d.graph.nodes.find((n) => n.requirement === requirement);

test("a development task selects orbit-develop, and PROJECT CONTEXT is required before it", () => {
  for (const prompt of ["implement the new invoice export feature", "What should I use to implement this backend feature?", "fix the bug in the payment handler", "refactor the order service class"]) {
    const d = route(prompt, registry());
    assert.equal(d.intent.id, "development", prompt);
    assert.equal(d.selected[0].id, "orbit-develop", prompt);
    assert.deepEqual([node(d, "project.context").level, node(d, "project.context").status, node(d, "project.context").provider.key], ["required", "selected", "orbit:project-context"], prompt);
    assert.ok(d.plan.findIndex((s) => s.id === "project-context") < d.plan.findIndex((s) => s.id === "orbit-develop"), `${prompt}: context comes first`);
  }
});

test("a simple change triggers no MCP server, however many are enabled", () => {
  const d = route("rename local helper method", registry({ managed: everything() }));
  assert.equal(d.selected.some((e) => e.kind === "mcp"), false);
  assert.deepEqual([node(d, "documentation.search").status, node(d, "repository.read").provider.key], ["skipped", "orbit:local-checkout"], "optional needs no evidence; the session's own checkout reads the repository");
});

test("a Microsoft Graph task can require Microsoft docs, and the resolver finds the provider -- the skill never names it", () => {
  const d = route("implement the Microsoft Graph subscription renewal handler", registry({ managed: learn() }));
  assert.deepEqual([node(d, "documentation.microsoft").status, node(d, "documentation.microsoft").provider.key, node(d, "documentation.microsoft").via], ["selected", "managed:microsoft-learn", "orbit-develop"]);
  const hostOnly = route("implement the Microsoft Graph subscription renewal handler", registry());
  assert.equal(hostOnly.selected.some((e) => e.id === "microsoft-learn"), false);
  assert.match(hostOnly.missing.find((e) => e.id === "microsoft-learn").reason, /orbit-develop needs documentation\.(search|microsoft), but microsoft-learn -- in Orbit's catalog but not added/);
});

test("a need nothing provides is surfaced, with who needs it", () => {
  const d = route("implement the invoice export feature", registry({ builtins: {} }));
  assert.match(d.missing.find((e) => e.id === "project.context").reason, /orbit-develop needs project\.context, and nothing here provides it/);
});

// ---- capability-first, both ways ---------------------------------------------------------

const catalogs = () => ({ components: readCatalog(io, catalogFile(REPO, "components")), mcp: readCatalog(io, catalogFile(REPO, "mcp")) });

test("a SKILL never names an MCP server: every skill's needs and optional needs are capabilities", () => {
  const { components, mcp } = catalogs();
  const servers = new Set(mcp.servers.flatMap((s) => [s.id, ...(s.match?.ids ?? [])]));
  for (const [name, row] of Object.entries(components.skills)) for (const need of [...(row.needs ?? []), ...(row.optional ?? [])]) assert.equal(servers.has(need), false, `${name} names ${need}`);
  assert.deepEqual(components.skills["orbit-develop"].needs, ["project.context", "repository.read"]);
});

test("an MCP server never chooses a skill: what it provides and the words that make it relevant name no skill or agent", () => {
  const { components, mcp } = catalogs();
  const workflows = new Set([...Object.keys(components.skills), ...Object.keys(components.agents)]);
  for (const s of mcp.servers) for (const word of [...(s.provides ?? []), ...(s.routing?.signals ?? [])]) assert.equal(workflows.has(word), false, `${s.id} names ${word}`);
});

// ---- it never provisions anything ------------------------------------------------------------

// It may READ project knowledge and ask what would prove a change -- and a
// person's decision (`decide`) or a new claim (`record`) is never pre-approved:
// the host asks the person, which is the point.
test("orbit-develop can read, route and CALL through the broker -- and nothing it may run adds, enables, installs or approves", () => {
  const skill = readFileSync(join(REPO, "skills", "orbit-develop", "SKILL.md"), "utf8");
  const allowed = [...skill.matchAll(/^\s+- (Bash\(.*\))$/gm)].map((m) => m[1]);
  assert.deepEqual(allowed, ["Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/context.mjs*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/resources.mjs route*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/mcp.mjs list*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/mcp.mjs tools*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/mcp.mjs call*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/engineering.mjs recall*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/knowledge.mjs claims*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/knowledge.mjs why*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/knowledge.mjs verify*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/knowledge.mjs opportunities*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/requirements.mjs show*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/requirements.mjs status*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/requirements.mjs ask*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/work.mjs show*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/work.mjs need*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/work.mjs resolve*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/work.mjs settle*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/work.mjs checkpoint*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/track.mjs status*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/track.mjs state*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/track.mjs report*)", "Bash(node ${CLAUDE_PLUGIN_ROOT}/cli/track.mjs current*)"]);
  assert.equal(allowed.some((a) => /knowledge\.mjs (record|decide)/.test(a)), false, "a claim or a decision always goes past a person");
  assert.equal(allowed.some((a) => /requirements\.mjs (answer|accept|bind|record|withdraw|snapshot|acquire)|work\.mjs (invoke|claim|start|resume)/.test(a)), false, "a developer asks and reads; a person answers, and the requirement skill records, freezes and starts");
  assert.equal(allowed.some((a) => /track\.mjs (track|link|handoff)/.test(a)), false, "a developer reports where the work stands; /orbit-help starts it, and the engine joins a task to it");
  assert.match(skill, /Do \*\*not\*\* install, enable, add or configure anything yourself/);
  assert.match(skill, /development\s+continues/);
  const cli = readFileSync(join(REPO, "cli", "mcp.mjs"), "utf8");
  const commands = /const COMMANDS = \{([\s\S]*?)\n\};/.exec(cli)[1];
  assert.deepEqual([...commands.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]), ["list", "tools", "call"]);
});

test("the project context CLI answers memory-first sections for a task and says what it could not know", () => {
  const store = mkdtempSync(join(tmpdir(), "orbit-context-"));
  const r = spawnSync(process.execPath, [join(REPO, "cli", "context.mjs"), "--for=rename the local helper method; echo pwned"], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: join(REPO, "test", "fixtures", "ui-tests"), ORBIT_STORE_DIR: store }), timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  for (const title of ["== ARCHITECTURE ==", "== TECHNOLOGY ==", "== ENGINEERING ==", "== KNOWLEDGE ==", "== WORK ==", "== WORKING SET ==", "== RESOURCES =="]) assert.ok(r.stdout.includes(title), title);
  assert.match(r.stdout, /orbit-develop \(skill\)/);
  assert.match(r.stdout, /UNKNOWN\n {2}working-set/);
  assert.match(r.stdout, /== WORK ==\nno work is in progress here/, "an empty machine says so, and the section is known, not a gap");
  assert.equal(r.stdout.split("\n").some((l) => l.trim() === "pwned"), false, "a task is one argument, never a second command");
  assert.equal(spawnSync(process.execPath, [join(REPO, "cli", "context.mjs")], { encoding: "utf8", env: sealed({ ORBIT_STORE_DIR: store }) }).status, 2);
});
