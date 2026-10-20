// The pack's readers, the two command line tools and the recognised servers as the
// ONE Effective Resource Registry lists them -- and what the existing resolver says
// of `workitem.read` because of them. Nothing here is a second registry or a second
// selector: it is the same recipe and the same table, asked a new question.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createCapabilityRegistry } from "../src/capability/registry.mjs";
import { resolved } from "../src/knowledge/verify.mjs";
import { managedRecord } from "../src/mcp/managed.mjs";
import { effectiveMcp } from "../src/mcp/effective.mjs";
import { pluginBuiltins, pluginComponents } from "../src/resources/plugin.mjs";
import { capabilityProvider } from "../src/resources/providers/capabilities.mjs";
import { PROVIDERS } from "../src/resources/providers/index.mjs";
import { getEffectiveResources } from "../src/resources/registry.mjs";
import { mcpCatalogAt } from "../src/resources/compose.mjs";
import { envSecrets } from "../src/secrets.mjs";
import { realIo } from "../src/store/io.mjs";
import { readerResources } from "../skills/orbit-requirements/bind.mjs";
import { sealed } from "./home.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const io = realIo();
const COMPONENTS = pluginComponents(REPO, io);
const CATALOG = mcpCatalogAt(REPO, io);
const AT = "2026-09-30T08:00:00.000Z";
const NEED = [{ capability: "workitem.read", proves: { subject: "source" } }];

// What connections.list() shows: which exist, and only whether a credential is set.
const connection = (provider, organization = "acme") => ({ id: `${provider}-${organization}`, provider, organization, host: "https://example.test", credential: { set: true, from: "env", name: "SOME_TOKEN" } });
const connectionsOf = (list) => ({ list: () => list, record: () => ({ credential: "SOME_TOKEN" }) });

// A registry the way the recipe builds one: real components, builtins and catalogs,
// with what a test wants to vary handed in.
function registry({ connections = [], managed = {}, external = [], caps = [], pack = () => readerResources(connectionsOf(connections)) } = {}) {
  const mcp = () => effectiveMcp({ catalog: CATALOG, state: { managed: { servers: managed }, external: { host: "claude", observedAt: AT, servers: external } }, secrets: envSecrets({}), now: Date.parse(AT), platform: "linux", arch: "x64" });
  return getEffectiveResources({ env: {}, plugin: "orbit", components: () => COMPONENTS, builtins: () => pluginBuiltins(REPO, io), capabilities: () => caps, packCapabilities: pack, tools: () => [], mcp }, PROVIDERS);
}

const capsWith = (...rows) => {
  const r = createCapabilityRegistry();
  for (const c of rows) r.register({ apiVersion: "orbit.capability/v1", doc: "reads an item", invoke: () => ({}), ...c }, "adapter");
  return r.list();
};

const outcome = (effective) => resolved(NEED, effective).results[0];

test("nothing provides workitem.read on an empty machine, and the answer is to ENABLE what could -- never to build first", () => {
  const r = outcome(registry());
  assert.deepEqual([r.outcome, r.gap, r.remedy], ["gap", true, "enable"]);
  assert.ok(r.candidates.length >= 2 && r.candidates.every((c) => !c.selectable), "the readers exist and are waiting for a connection");
  assert.deepEqual(r.candidates.map((c) => c.key).filter((k) => k.startsWith("pack:")).sort(), ["pack:orbit-requirements/azure-devops", "pack:orbit-requirements/github"]);
});

test("a connection makes its reader provide it, chosen by the existing resolver, and no MCP server is needed", () => {
  const r = outcome(registry({ connections: [connection("azure-devops")] }));
  assert.deepEqual([r.outcome, r.provider.key, r.provider.ownership, r.provider.kind], ["provided", "pack:orbit-requirements/azure-devops", "plugin", "capability"]);
});

test("a server the HOST configured is recognised and is still never used: observed is not eligible", () => {
  const external = [{ id: "ado", transport: "http", url: "https://example.test/mcp", hostEnabled: true }];
  const effective = registry({ external });
  const seen = effective.mcp.find((m) => m.key === "external:ado");
  assert.deepEqual([seen.ownership, seen.eligible, seen.available, seen.detail.catalog], ["external", false, false, "azure-devops"]);
  assert.ok(seen.routing.provides.includes("workitem.read") && seen.routing.provides.includes("workitem.history.read"), "the catalog row says what it would provide");
  const r = outcome(effective);
  assert.equal(r.outcome, "gap", "recognised, observed, and still not something Orbit may call");
  assert.ok(r.candidates.some((c) => c.key === "external:ado" && c.eligible === false));
  assert.equal(outcome(registry({ external, connections: [connection("azure-devops")] })).provider.key, "pack:orbit-requirements/azure-devops");
});

test("a Orbit-managed server that provides it is used when no connection is set up -- and needs no pack", () => {
  const tracker = managedRecord({ id: "tracker", transport: "http", url: "https://example.test/mcp", provides: ["workitem.read"] }, { origin: "custom", at: AT });
  const r = outcome(registry({ managed: { tracker } }));
  assert.deepEqual([r.outcome, r.provider.key, r.provider.ownership], ["provided", "managed:tracker", "orbit-managed"]);
});

test("an existing project capability satisfies it, and nothing is generated", () => {
  const r = outcome(registry({ caps: capsWith({ id: "tracker.item", provides: ["workitem.read"] }) }));
  assert.deepEqual([r.outcome, r.gap, r.provider.key, r.provider.ownership], ["provided", false, "tracker.item", "project"]);
});

test("a project capability whose command is not here is IMPAIRED, not a gap: the adapter exists and is kept", () => {
  const r = outcome(registry({ caps: capsWith({ id: "tracker.item", provides: ["workitem.read"], tools: ["tracker-cli"] }) }));
  assert.deepEqual([r.outcome, r.gap, r.provider.key], ["impaired", false, "tracker.item"]);
  assert.match(r.why, /command:tracker-cli/);
});

test("between two ready providers the existing order decides, the same way every time", () => {
  const caps = capsWith({ id: "tracker.item", provides: ["workitem.read"] });
  const keys = Array.from({ length: 3 }, () => outcome(registry({ caps, connections: [connection("github")] })).provider.key);
  assert.deepEqual(keys, ["pack:orbit-requirements/github", "pack:orbit-requirements/github", "pack:orbit-requirements/github"], "a shipped reader outranks a project capability, by TRUST -- not by anything this feature added");
});

test("a pack that cannot answer lists nothing of its own and takes nobody else's rows down", () => {
  const caps = capsWith({ id: "tracker.item", provides: ["workitem.read"] });
  const effective = registry({ caps, pack: () => { throw new Error("connection store unreadable"); } });
  assert.deepEqual(effective.problems, []);
  assert.deepEqual(effective.capabilities.map((c) => c.key), ["orbit:project-context", "orbit:local-checkout", "tracker.item"]);
  assert.deepEqual(capabilityProvider.list({ builtins: () => pluginBuiltins(REPO, io), capabilities: () => [], packCapabilities: () => { throw new Error("x"); } }).map((c) => c.id), ["project-context", "local-checkout"]);
});

test("the two command line tools are catalog rows the registry lists as providing their command", () => {
  const rows = getEffectiveResources({ env: {}, plugin: "orbit", components: () => [], capabilities: () => [], mcp: () => [], tools: () => [{ id: "azure-cli", name: "Azure CLI", enabled: true, status: "missing", provides: ["command:az"] }, { id: "github-cli", name: "GitHub CLI", enabled: true, status: "missing", provides: ["command:gh"] }] }, PROVIDERS).tools;
  assert.deepEqual(rows.map((t) => t.routing.provides), [["command:az"], ["command:gh"]]);
});

// ---- the real CLIs ------------------------------------------------------------------------

test("the real resources listing shows the pack's readers waiting for a connection, and reading it spawned and asked nothing", () => {
  const env = sealed({ ORBIT_STORE_DIR: mkdtempSync(join(tmpdir(), "orbit-reg-")), ORBIT_UI_TESTS: join(REPO, "test", "fixtures", "ui-tests") });
  const run = spawnSync(process.execPath, [join(REPO, "cli", "resources.mjs"), "list", "--json"], { env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const list = JSON.parse(run.stdout);
  const pack = list.capabilities.filter((c) => c.key.startsWith("pack:"));
  assert.deepEqual(pack.map((c) => [c.key, c.state, c.available]), [["pack:orbit-requirements/github", "needs-attention", false], ["pack:orbit-requirements/azure-devops", "needs-attention", false]]);
  assert.deepEqual(list.tools.filter((t) => ["azure-cli", "github-cli"].includes(t.id)).map((t) => [t.id, t.state]), [["github-cli", "unknown"], ["azure-cli", "unknown"]], "nobody has looked, so nobody says missing");
  assert.ok(list.capabilities.some((c) => c.key === "orbit:project-context"));
});
