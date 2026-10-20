// An in-memory stand-in for the Router, MCP, Tools and skill-resources
// endpoints of control-server, in the shapes the real ones answer with. Like
// fakeServer, it replaces fetch and nothing else. It never answers a secret
// VALUE -- the real server never does -- so a page that showed one would have
// had to invent it.
import { isSelection, isTransport, isVerdict } from "../features/mcp/guards";
import type { CatalogEntry, ExternalServer, ManagedInput, ManagedServer, PoliciesView, Policy, Verdict } from "../features/mcp/mcp.types";
import type { Resource, RouteDecision, RouterResources } from "../features/router/router.types";
import type { SkillResources } from "../features/skills/api/skills.types";
import type { Tool } from "../features/tools/tools.types";
import { reply, type Call } from "./fakeServer";
import { fieldOf, isRecord, textOf, textsOf } from "./required";

// ---- the bodies this fake reads, each checked field by field ------------------

function definitionIn(body: unknown): ManagedInput | null {
  const d = fieldOf(body, "definition");
  if (!isRecord(d) || typeof d.id !== "string" || !isTransport(d.transport)) return null;
  const headers = Array.isArray(d.requiredHeaders) ? d.requiredHeaders.filter(isRecord).map((h) => ({ name: textOf(h.name) ?? "", env: textOf(h.env) ?? "" })) : undefined;
  return { id: d.id, transport: d.transport, name: textOf(d.name), url: textOf(d.url), command: textOf(d.command), args: textsOf(d.args), provides: textsOf(d.provides), requiredEnv: textsOf(d.requiredEnv), requiredHeaders: headers, selection: isSelection(d.selection) ? d.selection : undefined };
}

const verdicts = (value: unknown): Record<string, Verdict> => (isRecord(value) ? Object.fromEntries(Object.entries(value).filter((e): e is [string, Verdict] => isVerdict(e[1]))) : {});

function policyIn(body: unknown): Policy {
  const p = fieldOf(body, "policy");
  const chosen = fieldOf(p, "default");
  const operations = Object.fromEntries(Object.entries(verdicts(fieldOf(p, "operations"))).filter(([op]) => op === "read" || op === "write"));
  return { default: isVerdict(chosen) ? chosen : "allow", capabilities: verdicts(fieldOf(p, "capabilities")), operations };
}

function workflowsIn(body: unknown): PoliciesView["workflows"] {
  const table = fieldOf(body, "workflows");
  return isRecord(table) ? Object.fromEntries(Object.entries(table).map(([skill, caps]) => [skill, verdicts(caps)])) : {};
}

const ALLOW: Policy = { default: "allow", capabilities: {}, operations: {} };

export function fakeManaged(id: string, over: Partial<ManagedServer> = {}): ManagedServer {
  return { key: `managed:${id}`, id, name: id, description: "", ownership: "orbit-managed", origin: "custom", catalog: null, transport: "http", provides: ["documentation.search"], signals: [], requiresSignal: false, enabled: true, runtimeReady: true, available: true, eligible: true, selection: "automatic", priority: 0, state: "ready", why: null, status: "unknown", checkedAt: null, lastStatus: null, checkFresh: false, reason: null, toolCount: null, definition: { transport: "http", url: `https://${id}.example/mcp`, requiredHeaders: [] }, secrets: { missing: [] }, runtime: { kind: "remote", present: true, receipt: null }, install: { strategy: "remote-http", supported: true, reason: null, version: null, source: null }, policy: ALLOW, approval: null, createdAt: "2026-09-24T08:00:00.000Z", updatedAt: "2026-09-24T08:00:00.000Z", ...over };
}

export function fakeExternal(id: string, over: Partial<ExternalServer> = {}): ExternalServer {
  return { key: `external:${id}`, id, name: id, description: "", ownership: "external", catalog: null, transport: "http", provides: [], signals: [], requiresSignal: false, enabled: false, runtimeReady: true, available: false, eligible: false, selection: "disabled", state: "external", why: "observed in claude's own configuration -- Orbit does not route to it", status: "unknown", checkedAt: null, lastStatus: null, checkFresh: false, reason: null, toolCount: null, host: "claude", scope: "user", url: `https://${id}.example/mcp`, command: null, args: [], headers: [], env: [], hostEnabled: true, observed: true, stale: false, readOnly: false, ...over };
}

export function fakeTool(id: string, over: Partial<Tool> = {}): Tool {
  return { id, name: id.toUpperCase(), summary: `the ${id} tool`, provides: [`${id}.thing`], enabled: true, status: "ready", available: true, state: "ready", source: "system", version: "1.0.0", path: `/usr/bin/${id}`, sources: [{ source: "project", found: false, ok: false, path: null, version: null }, { source: "orbit-managed", found: false, ok: false, path: null, version: null }, { source: "system", found: true, ok: true, path: `/usr/bin/${id}`, version: "1.0.0" }], reason: null, checkedAt: "2026-09-23T09:00:00.000Z", stale: false, install: { strategy: "manual", supported: false, reason: `install ${id} yourself`, version: null, source: null, instructions: `install ${id} yourself` }, managed: null, update: null, ...over };
}

const LEARN = { id: "microsoft-learn", name: "Microsoft Learn", description: "Microsoft documentation and learning resources", provides: ["documentation.search", "documentation.microsoft"] };
const LOCAL = { id: "local-docs", name: "Local docs", description: "documentation served by a private runtime", provides: ["documentation.search"] };

const res = (kind: Resource["kind"], id: string, routing: Partial<Resource["routing"]>): Resource => ({ kind, id, key: id, source: "plugin", ownership: "plugin", enabled: true, runtimeReady: true, available: true, eligible: true, selection: "automatic", state: "ready", summary: "", routing: { provides: [], optional: [], signals: [], needs: [], requiresSignal: false, ...routing } });

const RESOURCES: RouterResources = {
  version: 2,
  summary: [
    { family: "skills", total: 15, enabled: 13, available: 13, eligible: 13 },
    { family: "agents", total: 7, enabled: 7, available: 7, eligible: 7 },
    { family: "mcp", total: 3, enabled: 1, available: 1, eligible: 1 },
    { family: "tools", total: 4, enabled: 4, available: 4, eligible: 4 },
    { family: "capabilities", total: 5, enabled: 5, available: 5, eligible: 5 },
  ],
  // Exactly the shape the real server sends: the registry itself, so its
  // version and problems sit beside the families.
  resources: {
    version: 2,
    problems: [],
    skills: [res("skill", "orbit-develop", { provides: ["development.implementation"], needs: ["project.context", "repository.read"], optional: ["documentation.search", "documentation.microsoft"] })],
    agents: [],
    mcp: [res("mcp", "microsoft-learn", { provides: ["documentation.search", "documentation.microsoft", "azure.documentation"] })],
    tools: [res("tool", "sqlcmd", { provides: ["sqlserver.query", "command:sqlcmd"] })],
    capabilities: [res("capability", "project-context", { provides: ["project.context"] })],
  },
  problems: [],
};

const entry = (kind: RouteDecision["selected"][number]["kind"], id: string, requirement: string, reason: string, key = id) => ({ kind, id, key, summary: "", requirement, reason, implicit: false });

function decided(prompt: string): RouteDecision {
  const base = { version: 2, cues: [], graph: { nodes: [], cycles: [], truncated: false }, approval: [], blocked: [], plan: [] };
  if (/sql/i.test(prompt)) return { ...base, intent: { id: "database", confidence: "high" }, requirements: ["database.query"], selected: [entry("skill", "orbit-sql", "database.query", "relevant to database.query (mentions sql server)")], missing: [entry("tool", "sqlcmd", "sqlserver.query", "orbit-sql needs sqlserver.query, but sqlcmd -- not installed on this machine")] };
  if (/review/i.test(prompt)) return { ...base, intent: { id: "code-review", confidence: "high" }, requirements: ["code.review", "repository.read"], selected: [], approval: [entry("mcp", "github", "code.review", "relevant to code.review, but its selection mode asks for a person's approval before it is used", "managed:github")], blocked: [entry("mcp", "gitlab", "repository.read", "relevant to repository.read, but policy denies it", "managed:gitlab")], missing: [] };
  return {
    ...base,
    intent: { id: "development", confidence: "high" },
    requirements: ["development.implementation"],
    graph: {
      nodes: [
        { requirement: "development.implementation", level: "required", transitive: false, from: [], via: null, because: "intent development", workflow: null, status: "selected", provider: { kind: "skill", key: "orbit-develop", id: "orbit-develop" }, why: null, candidates: [{ kind: "skill", key: "orbit-develop", id: "orbit-develop", ownership: "plugin", eligible: true, selectable: true, verdict: "allow", signals: [], state: "ready", why: null }] },
        { requirement: "documentation.microsoft", level: "optional", transitive: true, from: ["development.implementation"], via: "orbit-develop", because: "orbit-develop can use it", workflow: "orbit-develop", status: "selected", provider: { kind: "mcp", key: "managed:microsoft-learn", id: "microsoft-learn" }, why: null, candidates: [{ kind: "mcp", key: "managed:microsoft-learn", id: "microsoft-learn", ownership: "orbit-managed", eligible: true, selectable: true, verdict: "allow", signals: ["microsoft graph"], state: "ready", why: null }, { kind: "mcp", key: "external:microsoft-learn", id: "microsoft-learn", ownership: "external", eligible: false, selectable: false, verdict: "allow", signals: ["microsoft graph"], state: "external", why: "observed in claude's own configuration -- Orbit does not route to it" }] },
      ],
      cycles: [],
      truncated: false,
    },
    selected: [entry("skill", "orbit-develop", "development.implementation", "relevant to development.implementation"), entry("mcp", "microsoft-learn", "documentation.microsoft", "provides documentation.microsoft for orbit-develop (mentions microsoft graph)", "managed:microsoft-learn")],
    missing: [],
    plan: [{ step: 1, requirement: "documentation.microsoft", kind: "mcp", key: "managed:microsoft-learn", id: "microsoft-learn", approval: false, implicit: false }, { step: 2, requirement: "development.implementation", kind: "skill", key: "orbit-develop", id: "orbit-develop", approval: false, implicit: false }],
  };
}

const SKILL_RESOURCES: SkillResources = { id: "alpha", available: true, state: "ready", provides: ["development.implementation"], needs: [{ requirement: "project.context", level: "required", status: "selected", provider: { kind: "capability", key: "orbit:project-context", id: "project-context", ownership: "orbit" }, why: null }, { requirement: "repository.read", level: "required", status: "missing", provider: null, why: null }, { requirement: "documentation.microsoft", level: "optional", status: "when-named", provider: { kind: "mcp", key: "managed:microsoft-learn", id: "microsoft-learn", ownership: "orbit-managed" }, why: null }] };

export function fakeResources() {
  const managed = new Map<string, ManagedServer>([["local-docs", fakeManaged("local-docs", { name: "Local docs", origin: "catalog", catalog: "local-docs", transport: "stdio", definition: { transport: "stdio", commandRef: "managed-runtime", command: null, args: ["--stdio"], requiredEnv: [{ name: "DOCS_TOKEN", set: true }] }, runtime: { kind: "managed", present: true, receipt: { version: "1.2.0", platform: "linux", arch: "x64", installedAt: "2026-09-24T08:00:00.000Z", source: "https://example.test/local-docs.tgz", checksum: "sha256:abc123", verified: true } }, install: { strategy: "archive", supported: true, reason: null, version: "1.2.0", source: "https://example.test" } })]]);
  const external = [fakeExternal("github", { name: "GitHub", headers: [{ name: "Authorization", configured: true }], catalog: "github", provides: ["repository.read"] })];
  const workflows: PoliciesView["workflows"] = {};
  const state = { failResolve: false, failInstall: false };
  const check = { status: "connected" as const, checkedAt: "2026-09-23T10:00:00.000Z", reason: null, toolCount: 2, tools: [{ name: "search", description: "Search" }, { name: "fetch", description: "Fetch a page" }] };
  const tools = new Map<string, Tool>([
    ["git", fakeTool("git")],
    ["sqlcmd", fakeTool("sqlcmd", { name: "SQLCMD", summary: "required for SQL Server verification", status: "missing", available: false, state: "not-installed", source: null, version: null, path: null, sources: [{ source: "project", found: false, ok: false, path: null, version: null }, { source: "orbit-managed", found: false, ok: false, path: null, version: null }, { source: "system", found: false, ok: false, path: null, version: null }], install: { strategy: "archive", supported: true, reason: null, version: "1.10.0", source: "https://example.test/sqlcmd", instructions: null } })],
  ]);

  const catalog = (): CatalogEntry[] => [LEARN, LOCAL].map((e) => ({ ...e, recommended: true, transport: e.id === "local-docs" ? "stdio" : "http", install: { strategy: e.id === "local-docs" ? "archive" : "remote-http", version: null, source: null }, addable: true, added: managed.has(e.id), observedInHost: false }));
  const overview = () => ({ host: "claude", managed: [...managed.values()], external });
  const policies = (): PoliciesView => ({ verdicts: ["allow", "approval", "deny"], selections: ["automatic", "approval", "disabled"], resources: [...managed.values()].map((s) => ({ key: s.key, id: s.id, name: s.name, provides: s.provides, selection: s.selection, policy: s.policy })), workflows });

  const fromCatalog = (id: string): ManagedServer | null => {
    const row = [LEARN, LOCAL].find((e) => e.id === id);
    return row ? fakeManaged(row.id, { name: row.name, description: row.description, origin: "catalog", catalog: row.id, provides: row.provides }) : null;
  };
  const fromDefinition = (d: ManagedInput): ManagedServer => fakeManaged(d.id, { name: d.name ?? d.id, transport: d.transport, provides: d.provides ?? [], selection: d.selection ?? "automatic", definition: d.transport === "http" ? { transport: "http", url: d.url ?? null, requiredHeaders: (d.requiredHeaders ?? []).map((h) => ({ ...h, set: false })) } : { transport: "stdio", command: d.command ?? null, commandRef: null, args: d.args ?? [], requiredEnv: (d.requiredEnv ?? []).map((name) => ({ name, set: false })) } });
  const added = (server: ManagedServer | null): Response => {
    if (!server) return reply(400, { error: { code: "MCP_ADD_FAILED", message: "send { catalog } or { definition }" } });
    if (managed.has(server.id)) return reply(409, { error: { code: "MCP_ADD_FAILED", message: `Orbit already manages an MCP server named ${server.id}` } });
    managed.set(server.id, server);
    return reply(200, server);
  };
  const addedFrom = (body: unknown): Response => {
    const catalogId = textOf(fieldOf(body, "catalog"));
    const definition = definitionIn(body);
    return added(catalogId ? fromCatalog(catalogId) : definition ? fromDefinition(definition) : null);
  };
  const patched = (server: ManagedServer, patch: Partial<ManagedServer>) => {
    const next = { ...server, ...patch };
    managed.set(server.id, next);
    return reply(200, next);
  };
  const managedOne = (call: Call, id: string, action?: string): Response => {
    const server = managed.get(id);
    if (!server) return reply(404, { error: { code: "MCP_NOT_FOUND", message: `Orbit manages no MCP server named ${id}` } });
    if (action === "tools") return reply(200, { id, checkedAt: server.checkedAt, fresh: server.checkFresh, tools: server.checkedAt ? check.tools : null });
    if (action === "test") return (managed.set(id, { ...server, status: "connected", checkedAt: check.checkedAt, checkFresh: true, toolCount: 2 }), reply(200, { server: managed.get(id), check }));
    if (action === "enable" || action === "disable") return patched(server, { enabled: action === "enable", available: action === "enable", eligible: action === "enable", state: action === "enable" ? "ready" : "disabled" });
    if (action === "selection") return selected(server, fieldOf(call.body, "selection"));
    if (action === "policy") return patched(server, { policy: policyIn(call.body) });
    if (action === "approve") return (managed.set(id, { ...server, approval: { until: "2026-09-24T09:00:00.000Z" } }), reply(200, { id, until: "2026-09-24T09:00:00.000Z", server: managed.get(id) }));
    if (action === "approval") return patched(server, { approval: null });
    if (action === "install") return state.failInstall ? reply(503, { error: { code: "MCP_INSTALL_FAILED", message: "the archive does not match the SHA-256 the catalog pins for it; nothing was installed" } }) : reply(200, { receipt: { version: "1.2.0", reused: false }, server });
    if (action === "runtime") return reply(200, { id, removed: true, receipts: 1 });
    if (call.method === "DELETE") return (managed.delete(id), reply(200, { id, removed: true, runtimeKept: server.runtime.receipt !== null }));
    if (call.method === "PUT") return patched(server, { definition: { ...server.definition, url: definitionIn(call.body)?.url ?? null } });
    return reply(200, { ...server, consumers: [{ kind: "skill", id: "orbit-develop", requirement: "documentation.search", level: "optional" }] });
  };
  const selected = (server: ManagedServer, selection: unknown): Response => (isSelection(selection) ? patched(server, { selection, eligible: selection !== "disabled" }) : reply(400, { error: { code: "INVALID_SELECTION", message: "selection is one of automatic, approval, disabled" } }));
  const externalOne = (call: Call, id: string, action?: string): Response => {
    const server = external.find((s) => s.id === id);
    if (!server) return reply(404, { error: { code: "MCP_NOT_FOUND", message: `the host has no MCP server named ${id}` } });
    if (action === "test") return reply(200, { server: { ...server, status: "connected", checkedAt: check.checkedAt }, check });
    if (action === "tools") return reply(200, { id, checkedAt: null, fresh: false, tools: null });
    return call.method === "GET" ? reply(200, server) : reply(405, { error: { code: "METHOD_NOT_ALLOWED", message: "no" } });
  };
  const toolOne = (id: string, action?: string): Response => {
    const tool = tools.get(id);
    if (!tool) return reply(404, { error: { code: "TOOL_NOT_FOUND", message: `no tool ${id}` } });
    if (action === "install" && state.failInstall) return reply(503, { error: { code: "TOOL_INSTALL_FAILED", message: "sqlcmd-linux-x64.tar.bz2 does not match the SHA-256 the catalog pins for it; nothing was installed" } });
    if (action === "install") return (tools.set(id, { ...tool, status: "ready", available: true, state: "ready", source: "orbit-managed", version: "1.10.0", managed: { version: "1.10.0", installedAt: "2026-09-23T10:00:00.000Z", source: "https://example.test", checksum: "sha256:abcdef0123456789abcdef" } }), reply(200, { receipt: { tool: id, version: "1.10.0", platform: "linux", arch: "x64", installedAt: "2026-09-23T10:00:00.000Z", source: "https://example.test", checksum: "sha256:abcdef0123456789abcdef", reused: false }, tool: tools.get(id) }));
    return reply(200, tool);
  };
  const mcp = (call: Call, parts: string[]): Response | null => {
    const [area, rawId, action] = parts;
    const id = rawId ? decodeURIComponent(rawId) : undefined;
    if (!area) return call.method === "GET" ? reply(200, overview()) : null;
    if (area === "policies") return rawId === "workflows" ? (Object.assign(workflows, workflowsIn(call.body)), reply(200, policies())) : reply(200, policies());
    if (area === "activity") return reply(200, { events: [{ at: "2026-09-24T08:05:00.000Z", kind: "mcp-invoked", resource: "managed:microsoft-learn", tool: "microsoft_docs_search", capability: "documentation.microsoft", workflow: "orbit-develop", outcome: "ok", ms: 812 }] });
    if (area === "test") return reply(200, { check: definitionIn(call.body)?.requiredHeaders?.length ? { ...check, status: "needs-auth", reason: "CORP_DOCS_AUTH is not set in this environment", toolCount: null, tools: null } : check });
    if (area === "managed" && !id) return call.method === "POST" ? addedFrom(call.body) : reply(200, { servers: [...managed.values()] });
    if (area === "managed" && id) return managedOne(call, id, action);
    if (area === "external" && id === "refresh") return reply(200, { servers: external });
    if (area === "external" && id) return externalOne(call, id, action);
    return null;
  };

  const handle = (call: Call): Response | null => {
    const parts = call.path.split("/").slice(3);
    if (call.path === "/api/v1/router/resources") return reply(200, RESOURCES);
    if (call.path === "/api/v1/router/resolve") return state.failResolve ? reply(500, { error: { code: "INTERNAL_ERROR", message: "the server could not complete that request" } }) : reply(200, { decision: decided(textOf(fieldOf(call.body, "prompt")) ?? ""), context: "Orbit routing context\n…", executed: false });
    if (call.path === "/api/v1/mcp-catalog") return reply(200, { entries: catalog() });
    if (parts[0] === "skills" && parts[2] === "resources") return reply(200, { ...SKILL_RESOURCES, id: decodeURIComponent(parts[1]) });
    if (parts[0] === "mcp") return mcp(call, parts.slice(1));
    if (parts[0] === "tools" && !parts[1]) return reply(200, { tools: [...tools.values()] });
    if (parts[0] === "tools" && parts[1]) return toolOne(decodeURIComponent(parts[1]), parts[2]);
    return null;
  };
  return { handle, managed, external, tools, state };
}
