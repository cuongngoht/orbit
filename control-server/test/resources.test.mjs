// The resource manager over HTTP -- the Router Inspector, MCP and Tools -- over
// a real socket, a real store in a temporary directory, an in-memory host that
// can only be READ, and installers whose download is a fixed buffer. And the
// one scenario this feature is FOR: the plugin directory is replaced, and
// nothing a person set up goes with it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { createControlServer, listen } from "../src/server.mjs";
import { TOKEN_HEADER } from "../src/security.mjs";
import { fakeMcpHost } from "../../test/fakes/mcp-host.mjs";
import { catalogsInto, contextFor, copyPlugin, fixture, TOKEN, worldFor } from "./fixture.mjs";

const SECRET = "Bearer sk-live-never-leaves-this-process";

async function started(t, ctx) {
  const server = createControlServer(ctx);
  const port = await listen(server, 0);
  t.after(() => new Promise((done) => { server.closeAllConnections(); server.close(done); }));
  const seen = [];
  const send = (method, path, body, headers) => sent(port, method, path, body, headers).then((r) => (seen.push(r.text), r));
  return { port, seen, send, get: (p) => send("GET", p), post: (p, b) => send("POST", p, b, mutation(port, b)), put: (p, b) => send("PUT", p, b, mutation(port, b)), del: (p) => send("DELETE", p, undefined, mutation(port)) };
}

const mutation = (port, body) => ({ origin: `http://127.0.0.1:${port}`, [TOKEN_HEADER]: TOKEN, ...(body === undefined ? {} : { "content-type": "application/json" }) });

function sent(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => { const text = Buffer.concat(chunks).toString("utf8"); resolve({ status: res.statusCode, text, json: text ? JSON.parse(text) : null }); });
    });
    req.on("error", reject);
    req.end(body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
  });
}

const CORP = { definition: { id: "corp-docs", name: "Corp docs", transport: "http", url: "https://docs.corp.example/mcp", requiredHeaders: [{ name: "Authorization", env: "CORP_DOCS_AUTH" }], provides: ["documentation.search"] } };
const neverLeaked = (texts) => { for (const t of texts) assert.equal(t.includes("sk-live-never"), false, "a secret reached a response or a file"); };
const files = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)])) : []);
const hostSeed = [{ name: "github", transport: "http", url: "https://api.githubcopilot.com/mcp/", headers: [{ name: "Authorization", value: "Bearer gh-host-secret" }] }];

test("the Router Inspector shows the router's own view and resolves a prompt -- graph, candidates, eligibility -- without executing anything", async (t) => {
  const { root } = fixture(t);
  const api = await started(t, contextFor(root, worldFor(root, { host: fakeMcpHost({ seed: hostSeed }) })));
  const resources = await api.get("/api/v1/router/resources");
  assert.deepEqual(resources.json.summary.map((f) => [f.family, f.total]), [["skills", 2], ["agents", 0], ["mcp", 2], ["tools", 2], ["capabilities", 1]], "the router reads the SAVED host snapshot -- none yet -- and two catalog rows are known, not added");
  // The panel types this exact shape (control-panel/src/features/router/router.types.ts
  // EffectiveResources): the registry itself, its version and problems BESIDE the
  // families -- which is why a page iterates the family names, never Object.values.
  assert.deepEqual(Object.keys(resources.json.resources), ["version", "skills", "agents", "mcp", "tools", "capabilities", "problems"]);
  const resolved = await api.send("POST", "/api/v1/router/resolve", { prompt: "check architecture of this project" }, { "content-type": "application/json" });
  assert.equal(resolved.status, 200);
  assert.deepEqual([resolved.json.executed, resolved.json.decision.version, resolved.json.decision.selected.map((e) => e.id)], [false, 2, ["alpha"]]);
  assert.ok(resolved.json.decision.graph.nodes.find((n) => n.requirement === "architecture.context").candidates.length >= 1);
  assert.match(resolved.json.context, /Orbit routing context/);
  assert.equal((await api.send("POST", "/api/v1/router/resolve", { nope: 1 }, { "content-type": "application/json" })).json.error.code, "INVALID_PROMPT");
  assert.equal((await api.send("POST", "/api/v1/router/resolve", "{bad", { "content-type": "application/json" })).json.error.code, "INVALID_JSON");
  assert.equal((await api.get("/api/v1/router/resolve")).status, 405);
});

test("MCP overview: what Orbit manages, what the host has (observe only), and the catalog -- three different things", async (t) => {
  const { root } = fixture(t);
  const api = await started(t, contextFor(root, worldFor(root, { host: fakeMcpHost({ seed: hostSeed }) })));
  const all = (await api.get("/api/v1/mcp")).json;
  assert.deepEqual(all.managed, []);
  assert.equal("legacy" in all, false);
  assert.equal("migration" in all, false);
  assert.deepEqual(all.external.map((s) => [s.key, s.ownership, s.eligible, s.state]), [["external:github", "external", false, "external"]]);
  const learn = (await api.get("/api/v1/mcp-catalog")).json.entries.find((e) => e.id === "microsoft-learn");
  assert.deepEqual([learn.addable, learn.added, learn.transport, learn.install.strategy], [true, false, "http", "remote-http"]);
  assert.equal((await api.get("/api/v1/mcp-catalog")).json.entries.find((e) => e.id === "github").observedInHost, true, "the host's github is recognised -- and still not Orbit's");
  neverLeaked(api.seen);
});

test("ADD TO Orbit creates a managed resource in the machine store -- and writes nothing to the host", async (t) => {
  const { root } = fixture(t);
  const host = fakeMcpHost();
  const api = await started(t, contextFor(root, worldFor(root, { host })));
  assert.equal((await api.send("POST", "/api/v1/mcp/managed", { catalog: "microsoft-learn" }, { "content-type": "application/json" })).status, 403, "no token, no change");
  const added = await api.post("/api/v1/mcp/managed", { catalog: "microsoft-learn" });
  assert.equal(added.status, 200, added.text);
  assert.deepEqual([added.json.key, added.json.ownership, added.json.origin, added.json.state, added.json.eligible, added.json.runtime.kind], ["managed:microsoft-learn", "orbit-managed", "catalog", "ready", true, "remote"]);
  assert.deepEqual(host.calls, [], "the host was not asked anything, let alone written");
  assert.equal(host.raw.size, 0);
  assert.ok(existsSync(join(worldFor(root).rooms.mcp, "managed.json")));
  assert.equal((await api.post("/api/v1/mcp/managed", { catalog: "microsoft-learn" })).status, 409);
  assert.equal((await api.post("/api/v1/mcp/managed", { catalog: "github" })).status, 400, "a recognition-only row cannot be added");
  assert.equal((await api.get("/api/v1/mcp-catalog")).json.entries.find((e) => e.id === "microsoft-learn").added, true);
});

test("a custom server NAMES its secret; a definition carrying a value, or a runtime of its own, is refused with every problem", async (t) => {
  const { root } = fixture(t);
  const probed = [];
  const api = await started(t, contextFor(root, worldFor(root, { env: { CORP_DOCS_AUTH: SECRET }, probed })));
  const added = await api.post("/api/v1/mcp/managed", CORP);
  assert.deepEqual([added.status, added.json.state, added.json.definition.requiredHeaders], [200, "ready", [{ name: "Authorization", env: "CORP_DOCS_AUTH", set: true }]]);
  const bad = await api.post("/api/v1/mcp/managed", { definition: { id: "../x", transport: "http", url: "https://u:p@x/mcp", requiredHeaders: [{ name: "Authorization", env: "T", value: "Bearer leak" }] } });
  assert.deepEqual([bad.status, bad.json.error.code, bad.json.error.details.length], [400, "MCP_ADD_FAILED", 3]);
  assert.equal((await api.post("/api/v1/mcp/managed", { definition: { id: "sneaky", transport: "stdio", commandRef: "managed-runtime" } })).status, 400);
  const tested = await api.post("/api/v1/mcp/managed/corp-docs/test");
  assert.deepEqual([tested.status, tested.json.check.status, tested.json.server.status], [200, "connected", "connected"]);
  assert.deepEqual(probed[0].headers, [{ name: "Authorization", value: SECRET }], "the value is read from the environment at the moment of connecting");
  await api.get("/api/v1/mcp");
  await api.get("/api/v1/mcp/managed/corp-docs");
  neverLeaked([...api.seen, ...files(root.store).map((f) => readFileSync(f, "utf8"))]);
});

test("Test an unsaved definition: the verdict is returned and kept nowhere; a secret not set answers needs-auth without reaching anything", async (t) => {
  const { root } = fixture(t);
  const probed = [];
  const api = await started(t, contextFor(root, worldFor(root, { probed })));
  const unset = await api.post("/api/v1/mcp/test", CORP);
  assert.deepEqual([unset.status, unset.json.check.status, probed.length], [200, "needs-auth", 0]);
  assert.match(unset.json.check.reason, /CORP_DOCS_AUTH is not set/);
  assert.equal(existsSync(join(worldFor(root).rooms.mcp, "checks.json")), false);
  assert.equal((await api.post("/api/v1/mcp/test", { definition: { id: "x", transport: "ftp" } })).json.error.code, "INVALID_MCP_DEFINITION");
});

test("enable · disable · selection · policy · approve: each behind the token, and the router sees every one", async (t) => {
  const { root } = fixture(t);
  const api = await started(t, contextFor(root, worldFor(root)));
  await api.post("/api/v1/mcp/managed", { catalog: "microsoft-learn" });
  const route = async () => (await api.send("POST", "/api/v1/router/resolve", { prompt: "How does EF Core ExecuteUpdateAsync work?" }, { "content-type": "application/json" })).json.decision;
  assert.ok((await route()).selected.some((e) => e.key === "managed:microsoft-learn"));
  assert.equal((await api.post("/api/v1/mcp/managed/microsoft-learn/disable")).json.enabled, false);
  assert.equal((await route()).selected.some((e) => e.key === "managed:microsoft-learn"), false, "disabled is never selected");
  await api.post("/api/v1/mcp/managed/microsoft-learn/enable");
  assert.equal((await api.put("/api/v1/mcp/managed/microsoft-learn/selection", { selection: "approval" })).json.selection, "approval");
  assert.ok((await route()).approval.some((e) => e.key === "managed:microsoft-learn"), "approval mode is identified, not selected");
  assert.equal((await api.put("/api/v1/mcp/managed/microsoft-learn/selection", { selection: "sometimes" })).status, 400);
  await api.put("/api/v1/mcp/managed/microsoft-learn/selection", { selection: "automatic" });
  assert.equal((await api.put("/api/v1/mcp/managed/microsoft-learn/policy", { policy: { capabilities: { "documentation.search": "deny" } } })).json.policy.capabilities["documentation.search"], "deny");
  assert.ok((await route()).blocked.some((e) => e.key === "managed:microsoft-learn"), "policy deny is blocked");
  assert.equal((await api.put("/api/v1/mcp/managed/microsoft-learn/policy", { policy: { default: "maybe" } })).status, 400);
  const approved = await api.post("/api/v1/mcp/managed/microsoft-learn/approve", { minutes: 30 });
  assert.ok(Date.parse(approved.json.until) > Date.now());
  assert.equal(approved.json.server.approval.until, approved.json.until);
  assert.equal((await api.del("/api/v1/mcp/managed/microsoft-learn/approval")).json.approval, null);
  assert.equal((await api.post("/api/v1/mcp/managed/microsoft-learn/approve", { minutes: 0 })).status, 400);
});

test("a local runtime: Install places it in the machine store with a receipt; Remove keeps it; Delete runtime removes only it", async (t) => {
  const { root } = fixture(t);
  const downloads = { n: 0 };
  const api = await started(t, contextFor(root, worldFor(root, { downloads })));
  const added = await api.post("/api/v1/mcp/managed", { catalog: "local-docs" });
  assert.deepEqual([added.json.state, added.json.runtime.kind, added.json.install.supported], ["not-installed", "managed", true]);
  assert.equal((await api.send("POST", "/api/v1/mcp/managed/local-docs/install")).status, 403);
  const installed = await api.post("/api/v1/mcp/managed/local-docs/install");
  assert.equal(installed.status, 200, installed.text);
  assert.deepEqual([installed.json.receipt.version, installed.json.receipt.reused, installed.json.server.state, installed.json.server.runtime.receipt.verified, downloads.n], ["1.2.0", false, "ready", true, 1]);
  const runtime = join(worldFor(root).rooms.mcpRuntimes, "local-docs", "1.2.0-linux-x64", "bin", "server.js");
  assert.ok(existsSync(runtime));
  assert.equal(installed.text.includes(root.store), false, "no path reaches the page");
  await api.post("/api/v1/mcp/managed", { catalog: "microsoft-learn" });
  assert.equal((await api.post("/api/v1/mcp/managed/microsoft-learn/install")).json.error.code, "MCP_NOTHING_TO_INSTALL");
  assert.deepEqual((await api.del("/api/v1/mcp/managed/local-docs")).json, { id: "local-docs", removed: true, runtimeKept: true });
  assert.ok(existsSync(runtime), "removing from Orbit is not deleting files");
  assert.equal((await api.get("/api/v1/mcp/managed/local-docs")).status, 404);
  assert.deepEqual((await api.del("/api/v1/mcp/managed/local-docs/runtime")).json, { id: "local-docs", removed: true, receipts: 1 });
  assert.equal(existsSync(join(worldFor(root).rooms.mcpRuntimes, "local-docs")), false);
  assert.equal((await api.del("/api/v1/mcp/managed/..%2F..%2Fvictim/runtime")).json.error.code, "INVALID_MCP_ID");
});

test("External: listed, refreshed into its own snapshot, testable -- and its verdict never counts as a managed server's", async (t) => {
  const { root } = fixture(t);
  const host = fakeMcpHost({ seed: hostSeed });
  const api = await started(t, contextFor(root, worldFor(root, { host })));
  await api.post("/api/v1/mcp/managed", { definition: { id: "github", transport: "http", url: "https://api.githubcopilot.com/mcp/", provides: ["repository.read"] } });
  assert.equal((await api.post("/api/v1/mcp/external/refresh")).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(join(worldFor(root).rooms.mcp, "external.json"), "utf8")).servers.map((s) => s.id), ["github"]);
  const tested = await api.post("/api/v1/mcp/external/github/test");
  assert.deepEqual([tested.json.server.key, tested.json.server.status, tested.json.server.eligible], ["external:github", "connected", false]);
  assert.deepEqual(host.calls, [["test", "github"]]);
  const managed = (await api.get("/api/v1/mcp/managed/github")).json;
  assert.deepEqual([managed.key, managed.status, managed.eligible], ["managed:github", "unknown", true], "same name, two owners, two verdicts");
  assert.equal((await api.get("/api/v1/mcp/external/nope")).status, 404);
  neverLeaked(api.seen);
  assert.equal(api.seen.join("").includes("gh-host-secret"), false);
});

test("a managed server's page lists who COULD use it -- derived from the capability graph, never stored", async (t) => {
  const { root } = fixture(t);
  const api = await started(t, contextFor(root, worldFor(root)));
  await api.post("/api/v1/mcp/managed", { catalog: "microsoft-learn" });
  const learn = (await api.get("/api/v1/mcp/managed/microsoft-learn")).json;
  assert.deepEqual(learn.consumers.map((c) => [c.id, c.requirement, c.level]).sort(), [["beta", "documentation.microsoft", "optional"], ["beta", "documentation.search", "optional"]]);
  const beta = (await api.get("/api/v1/skills/beta/resources")).json;
  assert.deepEqual(beta.provides, ["qa.execution"]);
  assert.deepEqual(beta.needs.map((n) => [n.requirement, n.level, n.status, n.provider?.key ?? null]), [["project.context", "required", "selected", "orbit:project-context"], ["documentation.search", "optional", "when-named", "managed:microsoft-learn"], ["documentation.microsoft", "optional", "when-named", "managed:microsoft-learn"]]);
  assert.equal((await api.get("/api/v1/skills/..%2F..%2Fetc/resources")).json.error.code, "INVALID_SKILL_ID");
});


test("workflow exceptions: validated, kept, and shown with every managed server's policy", async (t) => {
  const { root } = fixture(t);
  const api = await started(t, contextFor(root, worldFor(root)));
  await api.post("/api/v1/mcp/managed", { catalog: "microsoft-learn" });
  assert.equal((await api.put("/api/v1/mcp/policies/workflows", { workflows: { "orbit-code-review": { "repository.write": "maybe" } } })).status, 400);
  const saved = (await api.put("/api/v1/mcp/policies/workflows", { workflows: { "orbit-code-review": { "repository.write": "deny" } } })).json;
  assert.deepEqual([saved.workflows, saved.verdicts, saved.resources.map((r) => r.key)], [{ "orbit-code-review": { "repository.write": "deny" } }, ["allow", "approval", "deny"], ["managed:microsoft-learn"]]);
  assert.deepEqual((await api.get("/api/v1/mcp/policies")).json.workflows, saved.workflows);
});

test("Tools: nothing is detected on a GET; refresh looks; Install installs privately, once, and only on request", async (t) => {
  const { root } = fixture(t);
  const downloads = { n: 0 };
  const api = await started(t, contextFor(root, worldFor(root, { downloads })));
  const listed = (await api.get("/api/v1/tools")).json.tools;
  assert.deepEqual(listed.map((x) => [x.id, x.status]), [["sqlcmd", "unknown"], ["git", "unknown"]]);
  assert.equal((await api.post("/api/v1/tools/sqlcmd/refresh")).json.status, "missing");
  assert.equal((await api.send("POST", "/api/v1/tools/sqlcmd/install")).status, 403, "installing needs the token");
  const installed = await api.post("/api/v1/tools/sqlcmd/install");
  assert.equal(installed.status, 200, installed.text);
  assert.deepEqual([installed.json.receipt.version, installed.json.tool.status, installed.json.tool.source, downloads.n], ["1.10.0", "ready", "orbit-managed", 1]);
  assert.ok(existsSync(join(worldFor(root).rooms.toolRuntimes, "sqlcmd", "1.10.0-linux-x64", "sqlcmd")));
  assert.equal((await api.post("/api/v1/tools/sqlcmd/install")).json.error.code, "TOOL_ALREADY_AVAILABLE");
  assert.equal((await api.post("/api/v1/tools/sqlcmd/update")).json.error.code, "TOOL_UP_TO_DATE");
  const manual = await api.post("/api/v1/tools/git/install");
  assert.deepEqual([manual.status, /Install Git yourself/.test(manual.json.error.message)], [400, true]);
  assert.equal((await api.get("/api/v1/tools/nope")).status, 404);
  assert.equal((await api.get("/api/v1/tools/..%2F..")).json.error.code, "INVALID_TOOL_ID");
});

test("Tools: `autonomous` says whether Orbit may fetch its own pinned copy by itself -- the catalog row's fact, which looking and installing never change", async (t) => {
  const { root } = fixture(t);
  const file = join(root.plugin, "catalog", "tools.json");
  const catalog = JSON.parse(readFileSync(file, "utf8"));
  catalog.tools.find((x) => x.id === "sqlcmd").install.autonomous = true;
  writeFileSync(file, JSON.stringify(catalog));
  const api = await started(t, contextFor(root, worldFor(root)));
  assert.deepEqual((await api.get("/api/v1/tools")).json.tools.map((x) => [x.id, x.autonomous]), [["sqlcmd", true], ["git", false]], "a row that does not say so is not autonomous");
  assert.equal((await api.get("/api/v1/tools/sqlcmd")).json.autonomous, true);
  assert.equal((await api.post("/api/v1/tools/sqlcmd/refresh")).json.autonomous, true);
  const installed = await api.post("/api/v1/tools/sqlcmd/install");
  assert.deepEqual([installed.status, installed.json.tool.autonomous, installed.json.tool.install.strategy], [200, true, "archive"]);
  assert.equal((await api.post("/api/v1/tools/git/refresh")).json.autonomous, false);
});

test("there is no generic command endpoint, no way to write a host's configuration, and every route answers only its own methods", async (t) => {
  const { ctx } = fixture(t);
  const api = await started(t, ctx);
  for (const path of ["/api/v1/exec", "/api/v1/run", "/api/v1/mcp/x/run", "/api/v1/mcp/managed/x/run", "/api/v1/mcp/external/x/exec", "/api/v1/tools/sqlcmd/exec", "/api/v1/router", "/api/v1/mcp/host", "/api/v1/mcp/external/github/adopt"]) assert.equal((await api.send("POST", path, undefined, mutation(api.port))).status, 404, path);
  for (const [method, path] of [["DELETE", "/api/v1/tools/sqlcmd"], ["GET", "/api/v1/tools/sqlcmd/install"], ["PUT", "/api/v1/mcp-catalog"], ["DELETE", "/api/v1/mcp/external/github"], ["PUT", "/api/v1/mcp/external/github"], ["POST", "/api/v1/mcp"]]) assert.equal((await api.send(method, path, undefined, mutation(api.port))).status, 405, `${method} ${path}`);
});

// ---- the primary acceptance criterion -------------------------------------------

test("UPGRADE SURVIVAL: replace the plugin directory, start again, and everything a person set up is still there", async (t) => {
  const { root } = fixture(t);
  const host = fakeMcpHost({ seed: hostSeed });
  const a = await started(t, contextFor(root, worldFor(root, { host, env: { CORP_DOCS_AUTH: SECRET } })));
  assert.equal((await a.post("/api/v1/mcp/managed", CORP)).status, 200);
  assert.equal((await a.post("/api/v1/mcp/managed", { catalog: "microsoft-learn" })).status, 200);
  assert.equal((await a.post("/api/v1/mcp/managed", { catalog: "local-docs" })).status, 200);
  assert.equal((await a.post("/api/v1/mcp/managed/local-docs/install")).status, 200);
  assert.equal((await a.put("/api/v1/mcp/managed/microsoft-learn/selection", { selection: "approval" })).status, 200);
  assert.equal((await a.put("/api/v1/mcp/managed/corp-docs/policy", { policy: { default: "approval" } })).status, 200);
  assert.equal((await a.post("/api/v1/tools/sqlcmd/install")).status, 200);

  // Version B: a NEW plugin directory, a catalog that changed, and version A gone.
  const pluginB = join(root.base, "plugin-b");
  copyPlugin(root.plugin, pluginB);
  catalogsInto(pluginB, { learnDescription: "Microsoft Learn, as the 2.0 catalog describes it" });
  rmSync(root.plugin, { recursive: true, force: true });
  const downloads = { n: 0 };
  const b = await started(t, { ...contextFor({ ...root, skills: join(pluginB, "skills"), public: join(pluginB, "public") }, worldFor(root, { host, pluginRoot: pluginB, downloads, env: { CORP_DOCS_AUTH: SECRET } })) });

  const all = (await b.get("/api/v1/mcp")).json;
  const managed = Object.fromEntries(all.managed.map((s) => [s.id, s]));
  assert.deepEqual([managed["corp-docs"].origin, managed["corp-docs"].policy.default, managed["corp-docs"].definition.requiredHeaders[0].env], ["custom", "approval", "CORP_DOCS_AUTH"], "custom definition and its policy remain");
  assert.deepEqual([managed["microsoft-learn"].selection, managed["microsoft-learn"].description], ["approval", "Microsoft Learn, as the 2.0 catalog describes it"], "the person's choice kept, the NEW catalog read");
  assert.deepEqual([managed["local-docs"].state, managed["local-docs"].runtime.receipt.verified], ["ready", true], "the managed runtime is found again by its receipt");
  assert.deepEqual(all.external.map((s) => [s.key, s.eligible]), [["external:github", false]], "the host server is rediscovered, still external");
  const sqlcmd = (await b.post("/api/v1/tools/sqlcmd/refresh")).json;
  assert.deepEqual([sqlcmd.status, sqlcmd.source, sqlcmd.managed.version, downloads.n], ["ready", "orbit-managed", "1.10.0", 0], "the managed tool is reused, not reinstalled");
  const summary = Object.fromEntries((await b.get("/api/v1/router/resources")).json.summary.map((f) => [f.family, f]));
  assert.deepEqual([summary.mcp.total, summary.mcp.available, summary.mcp.eligible, summary.tools.available], [3, 3, 3, 1], "effective resources are recomputed from the store alone");
  neverLeaked([...a.seen, ...b.seen]);
  assert.ok(statSync(join(worldFor(root).rooms.mcp, "managed.json")).isFile());
});

// ---- the top bar: who is signed in to Claude on THIS machine ---------------------

test("GET /api/v1/account: this machine's Claude profile through an allow-list -- a token never reaches the page", async (t) => {
  const { root } = fixture(t);
  const signedIn = await started(t, contextFor(root, worldFor(root)));
  const answer = await signedIn.get("/api/v1/account");
  assert.deepEqual(answer.json, { host: "fake", signedIn: true, displayName: "Test Person", email: "person@example.test", organization: "Example Org", role: "admin" });
  assert.equal(answer.text.includes("sk-ant-oat01"), false);
  const none = await started(t, contextFor(root, worldFor(root, { account: () => ({ signedIn: false }) })));
  assert.deepEqual((await none.get("/api/v1/account")).json, { host: "fake", signedIn: false });
  const broken = await started(t, contextFor(root, worldFor(root, { account: () => { throw new Error("EACCES /home/x/.claude.json"); } })));
  const failed = await broken.get("/api/v1/account");
  assert.deepEqual([failed.status, failed.json], [200, { host: "fake", signedIn: false }], "an unreadable configuration is 'no profile', and no path reaches the page");
  assert.equal((await signedIn.send("POST", "/api/v1/account", undefined, mutation(signedIn.port))).status, 405, "read-only");
});

test("removed MCP migration endpoints are unknown routes", async (t) => {
  const { root } = fixture(t);
  const api = await started(t, contextFor(root, worldFor(root)));
  assert.equal((await api.post("/api/v1/mcp/migrate")).status, 404);
  assert.equal((await api.post("/api/v1/mcp/legacy/old-custom/adopt", { definition: {} })).status, 404);
  assert.equal((await api.del("/api/v1/mcp/legacy/old-custom")).status, 404);
});
