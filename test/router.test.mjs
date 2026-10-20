// The prompt router as a PLANNER: prompt + the Effective Resource Registry ->
// one RouteDecision, and at most 2 KB of context -- or nothing at all.
//
// The registry here is the real one, over this plugin's own tree and catalogs,
// with Orbit's MCP records, the host's observed servers and the tool observation
// handed in as data. So a test says "Microsoft Learn is managed by Orbit" by
// putting it in managed state, and "the host has it" by observing it -- and the
// router has to find its way on its own. Only the first may ever be chosen.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveMcp } from "../src/mcp/effective.mjs";
import { managedRecord } from "../src/mcp/managed.mjs";
import { envSecrets } from "../src/secrets.mjs";
import { mcpCatalogAt, toolCatalogAt } from "../src/resources/compose.mjs";
import { pluginBuiltins, pluginComponents } from "../src/resources/plugin.mjs";
import { PROVIDERS } from "../src/resources/providers/index.mjs";
import { getEffectiveResources, everyResource } from "../src/resources/registry.mjs";
import { classify } from "../src/routing/classify.mjs";
import { BUDGET_BYTES, formatDecision } from "../src/routing/format.mjs";
import { INTENTS, REFINEMENTS } from "../src/routing/intents.mjs";
import { MAX_SELECTED, ROUTE_DECISION_VERSION, route } from "../src/routing/resolve.mjs";
import { GRAM_LIMIT, termsOf } from "../src/routing/terms.mjs";
import { resource } from "../src/resources/model.mjs";
import { effectiveTools } from "../src/tools/effective.mjs";
import { realIo } from "../src/store/io.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const io = realIo();
const NOW = Date.parse("2026-09-23T12:00:00.000Z");
const AT = new Date(NOW - 60_000).toISOString();
const COMPONENTS = pluginComponents(REPO, io);
const BUILTINS = pluginBuiltins(REPO, io);
const MCP_CATALOG = mcpCatalogAt(REPO, io);
const TOOL_CATALOG = toolCatalogAt(REPO, io);

const hostServer = (id, over = {}) => ({ id, name: id, host: "claude", scope: "user", transport: "http", url: null, command: null, args: [], headers: [], env: [], hostEnabled: true, status: "unknown", readOnly: false, ...over });
const EXTERNAL_LEARN = hostServer("microsoft-learn", { url: "https://learn.microsoft.com/api/mcp" });
const EXTERNAL_GITHUB = hostServer("github", { url: "https://api.githubcopilot.com/mcp/", headers: [{ name: "Authorization", configured: true }] });

const fromCatalog = (id, over = {}) => {
  const e = MCP_CATALOG.find((x) => x.id === id);
  return managedRecord({ ...e.definition, id, name: e.name, provides: e.provides, signals: e.signals, requiresSignal: e.requiresSignal, ...over }, { origin: "catalog", catalog: id, at: AT });
};
const custom = (id, over = {}) => managedRecord({ id, transport: "http", url: `https://${id}.example/mcp`, ...over }, { origin: "custom", at: AT });
const LEARN = { "microsoft-learn": fromCatalog("microsoft-learn") };
const GITHUB = { github: custom("github", { url: "https://api.githubcopilot.com/mcp/", requiredHeaders: [{ name: "Authorization", env: "GH_MCP_AUTH" }], provides: ["repository.read", "repository.search", "repository.write", "code.review"], signals: ["github", "pr", "pull request"], requiresSignal: true }) };
const PLAYWRIGHT = { playwright: managedRecord({ id: "playwright", transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp"], provides: ["browser.automation"], signals: ["browser", "screenshot", "page"] }, { origin: "custom", at: AT }) };

const seen = (status, over = {}) => ({ status, source: status === "ready" ? "system" : null, version: status === "ready" ? "1.0.0" : null, path: null, sources: [], reason: null, checkedAt: AT, ...over });
const ALL_READY = Object.fromEntries(TOOL_CATALOG.map((t) => [t.id, seen("ready")]));

function registry({ env = {}, managed = {}, external = [], policies = {}, tools = ALL_READY, capabilities = [], secrets = { GH_MCP_AUTH: "Bearer x" }, builtins = BUILTINS } = {}) {
  const context = {
    env,
    plugin: "orbit",
    components: () => COMPONENTS,
    builtins: () => builtins,
    capabilities: () => capabilities,
    mcp: () => effectiveMcp({ catalog: MCP_CATALOG, state: { managed: { servers: managed, legacy: {} }, external: { host: "claude", observedAt: AT, servers: external }, checks: { checks: {} }, policies }, receipts: [], secrets: envSecrets(secrets), now: NOW, platform: "linux", arch: "x64" }),
    tools: () => effectiveTools({ catalog: TOOL_CATALOG, desired: {}, observed: { tools }, receipts: [], now: NOW, platform: "linux", arch: "x64", installers: {} }),
  };
  return getEffectiveResources(context, PROVIDERS);
}

const ids = (entries) => entries.map((e) => `${e.kind}:${e.id}`);
const keys = (entries) => entries.map((e) => `${e.kind}:${e.key}`);

test("the decision is a versioned contract: intent, requirements, the graph, what was chosen and why -- and nothing was executed", () => {
  const d = route("check architecture of this project", registry());
  assert.equal(d.version, ROUTE_DECISION_VERSION);
  assert.equal(ROUTE_DECISION_VERSION, 2);
  assert.deepEqual(Object.keys(d).sort(), ["approval", "blocked", "cues", "graph", "intent", "missing", "plan", "requirements", "selected", "version"]);
  assert.deepEqual(Object.keys(d.intent).sort(), ["confidence", "id"]);
  for (const e of [...d.selected, ...d.missing]) assert.deepEqual(Object.keys(e).sort(), ["id", "implicit", "key", "kind", "reason", "requirement", "summary"]);
  assert.deepEqual(Object.keys(d.graph).sort(), ["cycles", "nodes", "truncated"]);
});

test("a general prompt routes nowhere and adds nothing to the session", () => {
  for (const p of ["hello", "thanks!", "good morning", ""]) {
    const d = route(p, registry());
    assert.equal(d.intent.id, "general", p);
    assert.deepEqual([d.selected, d.missing, d.graph.nodes], [[], [], []], p);
    assert.equal(formatDecision(d), null, p);
  }
});

test("an architecture prompt names orbit-architecture while it is switched on, and never once it is off", () => {
  assert.ok(ids(route("check architecture of this project", registry()).selected).includes("skill:orbit-architecture"));
  const off = route("check architecture of this project", registry({ env: { CLAUDE_PLUGIN_OPTION_SKILL_ARCHITECTURE: "false" } }));
  assert.equal(ids(off.selected).includes("skill:orbit-architecture"), false);
  assert.match(off.missing.find((e) => e.id === "orbit-architecture").reason, /switched off/);
});

// The requests autonomous QA exists for, in both languages -- and the ordinary
// QA questions that must never pay for an investigation.
const INVESTIGATIONS = [
  "Explore this application and identify bugs.",
  "Check why this frontend sends two API requests.",
  "Test this feature from UI to database.",
  "Check whether tenant B can access tenant A's data.",
  "Investigate why saving succeeds on the UI but no database record exists.",
  "Explore this workspace management feature.",
  "Run autonomous QA on the application.",
  "check whether tenant B can read tenant A's records",
  "investigate why the frontend sends two requests when Save is clicked",
  "find a bug in the workspace management screen",
  "pls find bug in https://app.example.test/admin/dashboard",
  "find a bug on the settings page",
];

test("an investigation request names orbit-qa", () => {
  for (const p of INVESTIGATIONS) {
    const d = route(p, registry());
    assert.equal(d.intent.id, "investigation", p);
    assert.ok(ids(d.selected).includes("skill:orbit-qa"), p);
  }
});

test("an ordinary QA question never routes to an autonomous investigation", () => {
  for (const p of ["run regression tests", "write a test case for the Save dialog", "add a case for creating a thing", "why did the smoke test fail", "write test cases for the Save screen"]) {
    assert.equal(ids(route(p, registry()).selected).includes("skill:orbit-qa"), false, p);
  }
});

test("fixing a named bug in the code stays a change to the code, not an investigation", () => {
  for (const p of ["fix the bug in the save handler", "bug fix for the login endpoint"]) assert.equal(route(p, registry()).intent.id, "development", p);
});

test("fixing bugs so their tests pass is a change to the code, never a test question or a review (1.8.6)", () => {
  const asked = "Fix the two refund bugs so their tests pass, and change nothing else. The ledger's sign conventions also need a review";
  assert.equal(route(asked, registry()).intent.id, "development", "a native host's request planned a code review with no engineering step");
  assert.equal(route("fix the failing test", registry()).intent.id, "qa", "a failing test to fix stays a test question on the tie");
  assert.equal(route("Explore this application and identify bugs.", registry()).intent.id, "investigation", "finding bugs keeps more words of an investigation");
});

test("switched off, orbit-qa is never recommended, and the router says why", () => {
  const off = route(INVESTIGATIONS[1], registry({ env: { CLAUDE_PLUGIN_OPTION_SKILL_AUTONOMOUS_QA: "false", CLAUDE_PLUGIN_OPTION_AGENT_QA_AGENT: "false" } }));
  assert.equal(ids(off.selected).includes("skill:orbit-qa"), false);
  assert.match(off.missing.find((e) => e.id === "orbit-qa").reason, /switched off/);
});

test("run regression tests names orbit-test-suite first", () => {
  const d = route("run regression tests", registry());
  assert.equal(d.intent.id, "qa");
  assert.equal(d.intent.confidence, "high");
  assert.equal(d.selected[0].id, "orbit-test-suite");
});

test("a .NET documentation question names Microsoft Learn when Orbit manages it -- and never the copy the HOST has", () => {
  const prompt = "How does EF Core ExecuteUpdateAsync work?";
  const managed = route(prompt, registry({ managed: LEARN }));
  assert.equal(managed.intent.id, "documentation");
  assert.ok(keys(managed.selected).includes("mcp:managed:microsoft-learn"));
  const hostOnly = route(prompt, registry({ external: [EXTERNAL_LEARN] }));
  assert.equal(ids(hostOnly.selected).includes("mcp:microsoft-learn"), false, "external is observe-only");
  assert.match(hostOnly.missing.find((e) => e.id === "microsoft-learn").reason, /Orbit does not route to it/);
  const neither = route(prompt, registry());
  assert.match(neither.missing.find((e) => e.id === "microsoft-learn").reason, /not added to Orbit/, "a recommended catalog row is KNOWN, never selected");
});

test("a documentation question with no Microsoft word never reaches for Microsoft Learn", () => {
  const d = route("How does React useEffect cleanup work?", registry({ managed: LEARN }));
  assert.equal(ids(d.selected).includes("mcp:microsoft-learn"), false);
  assert.equal(ids(d.missing).includes("mcp:microsoft-learn"), false);
});

test("a server the host has under a plugin's name stays external; the managed one answers the documentation question", () => {
  const plugin = hostServer("plugin:microsoft-docs:microsoft-learn", { scope: "plugin", url: "https://learn.microsoft.com/api/mcp", readOnly: true });
  const d = route("What is the difference between Graph delegated permissions and application permissions?", registry({ managed: LEARN, external: [plugin] }));
  assert.equal(d.intent.id, "documentation");
  assert.equal(d.intent.confidence, "high");
  assert.ok(keys(d.selected).includes("mcp:managed:microsoft-learn"));
  assert.equal(keys(d.selected).some((k) => k.includes("external:")), false);
});

test("Review PR 123 names the GitHub MCP Orbit manages, never the host's, and the same name under two owners stays two resources", () => {
  const both = registry({ managed: GITHUB, external: [EXTERNAL_GITHUB] });
  assert.deepEqual(both.mcp.filter((r) => r.id === "github").map((r) => [r.key, r.ownership, r.eligible]).sort(), [["external:github", "external", false], ["managed:github", "orbit-managed", true]]);
  const d = route("Review PR 123", both);
  assert.ok(keys(d.selected).includes("mcp:managed:github"));
  assert.equal(keys(d.selected).includes("mcp:external:github"), false);
  const hostOnly = route("Review PR 123", registry({ external: [EXTERNAL_GITHUB] }));
  assert.equal(ids(hostOnly.selected).includes("mcp:github"), false);
});

test("a managed server disabled in Orbit, or whose selection is disabled, is never selected", () => {
  const prompt = "How does EF Core ExecuteUpdateAsync work?";
  const off = route(prompt, registry({ managed: { "microsoft-learn": { ...LEARN["microsoft-learn"], enabled: false } } }));
  assert.equal(ids(off.selected).includes("mcp:microsoft-learn"), false);
  assert.match(off.missing.find((e) => e.id === "microsoft-learn").reason, /disabled in Orbit/);
  const unselected = route(prompt, registry({ managed: { "microsoft-learn": { ...LEARN["microsoft-learn"], selection: "disabled" } } }));
  assert.equal(ids(unselected.selected).includes("mcp:microsoft-learn"), false);
  assert.match(unselected.missing.find((e) => e.id === "microsoft-learn").reason, /selection mode is disabled/);
});

test("ENABLE IS NOT INJECT: three enabled managed servers, a simple change, and not one of them is chosen", () => {
  const effective = registry({ managed: { ...LEARN, ...GITHUB, ...PLAYWRIGHT } });
  assert.equal(effective.mcp.filter((r) => r.eligible).length, 3);
  const d = route("rename local helper method", effective);
  assert.equal(d.intent.id, "development");
  assert.deepEqual(ids(d.selected), ["skill:orbit-develop", "capability:project-context", "capability:local-checkout"]);
  assert.equal(d.selected.some((e) => e.kind === "mcp"), false);
  assert.doesNotMatch(formatDecision(d), /local-checkout/, "what the session already has is never a line");
});

test("policy DENY blocks a server for that capability, and APPROVAL marks it approval-required instead of selecting it", () => {
  const denied = route("Review PR 123", registry({ managed: GITHUB, policies: { resources: { "managed:github": { capabilities: { "code.review": "deny" } } } } }));
  assert.equal(keys(denied.selected).includes("mcp:managed:github") && denied.selected.find((e) => e.key === "managed:github").requirement === "code.review", false);
  assert.deepEqual(denied.blocked.map((e) => [e.key, e.requirement]), [["managed:github", "code.review"]]);
  assert.match(denied.blocked[0].reason, /policy denies it/);
  const approval = route("Review PR 123", registry({ managed: { github: { ...GITHUB.github, selection: "approval" } } }));
  assert.deepEqual(approval.approval.map((e) => e.key), ["managed:github"]);
  assert.equal(keys(approval.selected).includes("mcp:managed:github"), false);
  assert.match(formatDecision(approval), /approve it in Orbit Control first/);
  const byPolicy = route("Review PR 123", registry({ managed: GITHUB, policies: { resources: { "managed:github": { default: "approval" } } } }));
  assert.deepEqual(byPolicy.approval.map((e) => e.key), ["managed:github"]);
});

test("a WORKFLOW exception is asked first, for the skill a requirement serves -- and nothing else", () => {
  const withSkill = (policies) => route("implement the Microsoft Graph subscription renewal handler", registry({ managed: LEARN, policies }));
  assert.ok(keys(withSkill({}).selected).includes("mcp:managed:microsoft-learn"));
  const exception = withSkill({ workflows: { "orbit-develop": { "documentation.search": "deny", "documentation.microsoft": "deny" } } });
  assert.equal(keys(exception.selected).includes("mcp:managed:microsoft-learn"), false);
  assert.ok(exception.blocked.some((e) => e.key === "managed:microsoft-learn"));
  const elsewhere = route("How does EF Core ExecuteUpdateAsync work?", registry({ managed: LEARN, policies: { workflows: { "orbit-develop": { "documentation.search": "deny" } } } }));
  assert.ok(keys(elsewhere.selected).includes("mcp:managed:microsoft-learn"), "a documentation question is not orbit-develop's workflow");
});

test("several providers for one requirement: the same inputs choose the same one, whatever order they are listed in", () => {
  const docs = { "docs-b": custom("docs-b", { provides: ["documentation.search"] }), "docs-a": custom("docs-a", { provides: ["documentation.search"] }) };
  const once = route("what is the documentation for the billing API?", registry({ managed: docs }));
  const again = route("what is the documentation for the billing API?", registry({ managed: { "docs-a": docs["docs-a"], "docs-b": docs["docs-b"] } }));
  assert.deepEqual(keys(once.selected), keys(again.selected));
  assert.ok(keys(once.selected).includes("mcp:managed:docs-a"), "a stable id breaks the tie");
  const preferred = route("what is the documentation for the billing API?", registry({ managed: { ...docs, "docs-b": { ...docs["docs-b"], priority: 10 } } }));
  assert.ok(keys(preferred.selected).includes("mcp:managed:docs-b"), "a person's priority comes before the id");
});

test("the graph says why every node is there, and a cycle is recorded and not followed", () => {
  const d = route("rename local helper method", registry());
  const node = (r) => d.graph.nodes.find((n) => n.requirement === r);
  assert.deepEqual([node("development.implementation").level, node("development.implementation").transitive], ["required", false]);
  assert.deepEqual([node("project.context").level, node("project.context").transitive, node("project.context").via, node("project.context").status], ["required", true, "orbit-develop", "selected"]);
  assert.deepEqual([node("architecture.context").level, node("architecture.context").status], ["optional", "skipped"]);
  assert.deepEqual(d.plan.map((s) => s.id).slice(-1), ["orbit-develop"], "what a provider needs comes before the provider");
  const loop = [resource("skill", { id: "a", enabled: true, available: true, state: "ready", provides: ["x.one"], needs: ["x.two"] }), resource("skill", { id: "b", enabled: true, available: true, state: "ready", provides: ["x.two"], needs: ["x.one"] })];
  const cyc = route("run regression tests", { skills: [resource("skill", { id: "root", enabled: true, available: true, state: "ready", provides: ["qa.execution"], needs: ["x.one"] }), ...loop], agents: [], mcp: [], tools: [], capabilities: [] });
  assert.ok(cyc.graph.cycles.some((c) => c.join(">").includes("x.one>x.two>x.one")));
});

test("SQL Server verification names orbit-sql, and sqlcmd -- selected when ready, missing when not", () => {
  const prompt = "Verify SQL Server row after order creation";
  const ready = route(prompt, registry());
  assert.deepEqual(ids(ready.selected).slice(0, 2), ["skill:orbit-sql", "tool:sqlcmd"]);
  const absent = route(prompt, registry({ tools: { ...ALL_READY, sqlcmd: seen("missing") } }));
  assert.ok(ids(absent.selected).includes("skill:orbit-sql"));
  const sqlcmd = absent.missing.find((e) => e.id === "sqlcmd");
  assert.match(sqlcmd.reason, /orbit-sql needs sqlserver\.query/);
  assert.match(sqlcmd.reason, /not installed/);
});

test("a tool nobody has looked for yet is not called missing: unknown is not absent", () => {
  const d = route("Verify SQL Server row after order creation", registry({ tools: {} }));
  assert.equal(ids(d.missing).includes("tool:sqlcmd"), false);
  assert.equal(ids(d.selected).includes("tool:sqlcmd"), false);
});

test("a capability is matched by what it provides, and names the command it needs", () => {
  const cap = { id: "postgres.query", apiVersion: "orbit.capability/v1", doc: "read a row from the orders database", tools: ["psql"], from: "orders-db" };
  const effective = registry({ capabilities: [cap] });
  const found = effective.capabilities.find((c) => c.id === "postgres.query");
  assert.deepEqual([found.ownership, found.routing.needs], ["project", ["command:psql"]]);
  assert.deepEqual(effective.capabilities.filter((c) => c.detail?.builtin).map((c) => c.id), ["project-context", "local-checkout"]);
});

test("whatever is switched off, nothing selected is ever a resource the resolver may not use", () => {
  const env = Object.fromEntries(COMPONENTS.map((c) => [`CLAUDE_PLUGIN_OPTION_${c.kind.toUpperCase()}_${c.name.replace(/^orbit-/, "").replace(/^orbit-/, "").replace(/-/g, "_").toUpperCase()}`, "false"]));
  const effective = registry({ env, managed: { ...LEARN, github: { ...GITHUB.github, enabled: false } }, external: [EXTERNAL_LEARN, EXTERNAL_GITHUB], tools: {} });
  const eligible = new Set(everyResource(effective).filter((r) => r.eligible).map((r) => `${r.kind}:${r.key}`));
  for (const p of ["run regression tests", "check architecture", "Review PR 9", "How does EF Core work", "Verify SQL Server row", "write a test plan", "explore the login screen", "implement the Graph webhook"]) {
    for (const e of [...route(p, effective).selected, ...route(p, effective).approval]) assert.ok(eligible.has(`${e.kind}:${e.key}`), `${p}: ${e.kind}:${e.key}`);
  }
});

test("the context is held to 2 KB and at most MAX_SELECTED resources, however many match", () => {
  const many = Array.from({ length: 60 }, (_, i) => resource("skill", { id: `bulk-${i}`, enabled: true, available: true, state: "ready", source: "plugin", summary: "x".repeat(150), provides: ["qa.execution", `need-${i}`], needs: [`need-${(i + 1) % 60}`] }));
  const d = route("run regression tests", { skills: many, agents: [], mcp: [], tools: [], capabilities: [] });
  assert.ok(d.selected.length <= MAX_SELECTED);
  const text = formatDecision(d);
  assert.ok(Buffer.byteLength(text) <= BUDGET_BYTES, `${Buffer.byteLength(text)} bytes`);
  assert.doesNotMatch(text, /you must/i, "it recommends; it never instructs");
  assert.ok(d.graph.nodes.length <= 24, "the graph is bounded");
});

test("the decision and the context carry table words and resource ids -- never a fragment of the prompt", () => {
  const prompt = "How does EF Core work? my token is sk-live-DO-NOT-KEEP-12345 and password=hunter2";
  const d = route(prompt, registry({ managed: LEARN }));
  const said = JSON.stringify(d) + formatDecision(d, { callVia: "node /p/cli/mcp.mjs call" });
  for (const secret of ["sk-live", "DO-NOT-KEEP", "12345", "hunter2", "token is"]) assert.equal(said.includes(secret), false, secret);
});

test("a recommended managed server comes with how to reach it, since the host's own tool list does not have it", () => {
  const d = route("How does EF Core ExecuteUpdateAsync work?", registry({ managed: LEARN }));
  assert.match(formatDecision(d, { callVia: "node /p/cli/mcp.mjs call" }), /reach it through: node \/p\/cli\/mcp\.mjs call <server> <tool>/);
  assert.match(formatDecision(d, { callVia: "node /p/cli/mcp.mjs call" }), /microsoft-learn \(MCP, Orbit-managed\)/);
  assert.doesNotMatch(formatDecision(route("check architecture", registry())) ?? "", /reach it through/);
});

test("the classifier is deterministic, its cues fit in a gram, and a pasted file costs the same as a sentence", () => {
  assert.deepEqual(classify("Review PR 123").intent, classify("Review PR 123").intent);
  for (const row of [...INTENTS, ...REFINEMENTS]) for (const cue of row.cues) assert.ok(termsOf(cue).length <= GRAM_LIMIT && termsOf(cue).length > 0, cue);
  const huge = `review this PR\n${"const x = 1;\n".repeat(200000)}`;
  const started = process.hrtime.bigint();
  assert.equal(classify(huge).intent.id, "code-review");
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 2000, "bounded by TEXT_LIMIT");
});

// A PO report is its own kind of help: more of its words than code review's in
// "the PO report on PR review time", and a "test report" stays a test question
// on the tie, because `reporting` sits after `qa`.
test("reporting prompts reach the project reporter, and a test report stays a test question", () => {
  const intent = (p) => classify(p).intent.id;
  assert.equal(intent("run the PO report on PR review time"), "reporting");
  assert.equal(intent("the sprint report for July and August"), "reporting");
  assert.equal(intent("PR aging report for the product owner"), "reporting");
  assert.equal(intent("forecast when the backlog will be done"), "reporting");
  assert.equal(intent("test report"), "qa");
  assert.equal(intent("code review report"), "code-review");
  assert.deepEqual(classify("PO report for July").requirements, ["project.reporting"]);
});

// ---- a work item is settled before it is built --------------------------------------------------

test("a task that names a work item routes to requirements; the words of a code change, a test plan or an investigation keep theirs", () => {
  const intent = (p) => classify(p).intent.id;
  assert.equal(intent("Implement PBI 4312"), "requirements", "one development word and one requirement word: the item is settled first");
  assert.equal(intent("check PBI 7 refund rules"), "requirements");
  assert.equal(intent("check PBI-7 refund rules"), "general", "a hyphenated id is ONE term, as a technology's name is (terms.mjs), so it is not the word pbi");
  assert.equal(intent("continue issue number 88"), "requirements");
  assert.equal(intent("what does the user story say about refunds"), "requirements");
  assert.equal(intent("implement the ZETA-9181 webhook"), "development", "no work-item word, so nothing changes");
  assert.equal(intent("write a test plan for PBI 4312"), "qa", "two QA words outweigh one");
  assert.equal(intent("investigate tenant isolation for PBI 4312"), "investigation");
  assert.equal(intent("there is an issue with the login handler"), "development", "a bare \"issue\" is about code, not about an item");
});

test("the requirements intent asks for a snapshot, and only a skill of Orbit's provides one", () => {
  const d = route("Implement PBI 4312", registry());
  assert.deepEqual(d.intent, { id: "requirements", confidence: "low" });
  assert.deepEqual(d.requirements, ["requirement.snapshot"]);
  assert.equal(ids(d.selected).includes("skill:orbit-requirements"), true);
  assert.equal(ids(d.selected).includes("skill:orbit-develop"), false, "the change is not started until the item is settled");
});

test("inside another intent a work-item word adds the snapshot to what the task needs, and nothing else", () => {
  const d = route("investigate tenant isolation for PBI 4312", registry());
  assert.equal(d.intent.id, "investigation");
  assert.deepEqual([...d.requirements].sort(), ["qa.investigation", "requirement.snapshot"]);
  assert.equal(route("investigate tenant isolation", registry()).requirements.includes("requirement.snapshot"), false);
});

test("every cue of the requirements intent is generic: no product, no vendor, at most three terms", () => {
  const row = INTENTS.find((i) => i.id === "requirements");
  assert.ok(row.cues.length >= 6);
  for (const cue of row.cues) assert.ok(termsOf(cue).length > 0 && cue.split(" ").length <= GRAM_LIMIT, cue);
  assert.doesNotMatch(row.cues.join(" "), /github|azure|devops|jira|gitlab|linear|microsoft/i);
  assert.equal(row.cues.includes("issue"), false, "a bare issue would take a code question for a work item");
  assert.equal(INTENTS.length, 15, "and the header that says fifteen is right");
});

// ---- running a project is its own question --------------------------------------------------------

test("a prompt about running a project or the place it runs routes to the environment intent; a test, a change or a report keeps its own", () => {
  const intent = (p) => classify(p).intent.id;
  assert.equal(intent("how do I run the app locally"), "environment", "one documentation word ties one environment phrase, and running it is the question");
  assert.equal(intent("can you start the application for me"), "environment");
  assert.equal(intent("design a dev container for this project"), "environment");
  assert.equal(intent("is there a port conflict on the dev environment"), "environment");
  assert.equal(intent("I just cloned this repository. What does it take to get it running on my machine?"), "environment", "the way a person asks it, which the native smoke found routed nowhere");
  assert.equal(intent("what does this project need to run, and on which operating systems"), "environment");
  assert.equal(intent("the tests fail on my machine, can you look"), "qa", "a test word ties a machine phrase, and the test is the question");
  assert.equal(intent("run the project tests"), "qa", "a test word of its own: still a test question");
  assert.equal(intent("run the regression tests"), "qa");
  assert.equal(intent("implement the handler and run the app"), "development", "two development words outweigh one environment phrase");
  assert.equal(intent("run the project report for July"), "reporting");
});

test("the environment intent asks for runtime discovery, and the runtime skill is what provides it -- while it is switched on", () => {
  const d = route("how do I run the app locally", registry());
  assert.equal(d.intent.id, "environment");
  assert.deepEqual(d.requirements, ["runtime.discovery"]);
  assert.ok(ids(d.selected).includes("skill:orbit-runtime"));
  assert.deepEqual(d.missing, [], "what it needs is the project context and the checkout, both of which a session has");
  const off = route("how do I run the app locally", registry({ env: { CLAUDE_PLUGIN_OPTION_SKILL_RUNTIME_DISCOVER: "false" } }));
  assert.equal(ids(off.selected).includes("skill:orbit-runtime"), false);
  assert.match(off.missing.find((e) => e.id === "orbit-runtime").reason, /switched off/);
});

test("every cue of the environment intent is generic: no language, no package manager, no vendor, at most three terms", () => {
  const row = INTENTS.find((i) => i.id === "environment");
  assert.ok(row.cues.length >= 10);
  for (const cue of row.cues) assert.ok(termsOf(cue).length > 0 && termsOf(cue).length <= GRAM_LIMIT, cue);
  assert.doesNotMatch(row.cues.join(" "), /docker|node|npm|dotnet|python|java|rust|kubernetes|compose|vscode|codespaces|nuget|maven/i);
  assert.equal(row.cues.includes("run"), false, "a bare run is every test prompt");
  assert.equal(row.cues.includes("runtime"), false, "and a bare runtime is a managed server's word");
});
