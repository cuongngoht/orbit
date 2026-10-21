// A sandbox TOPOLOGY composed from discovery (ADR 0039): pure, over what a project's own files say. Each table row is
// held alone -- which image a node runs from, how nodes find each other, how "ready" is asked -- and the fingerprint a
// person trusts is held to what would actually run: a Dockerfile edited is a different topology.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isCompose, isDockerfile } from "../src/runtime/environment/container-files.mjs";
import { parseYaml } from "../src/runtime/discover/yaml-lite.mjs";
import { ISOLATION_DEFAULTS, effectivePolicy } from "../src/runtime/sandbox/policy.mjs";
import { IMAGE_SOURCES, NETWORK_MODES, READINESS, buildScopes, composed, networkNameOf } from "../src/runtime/sandbox/topology.mjs";
import { NODE_AND_DOTNET, SHIPPED_CATALOG, viewOf } from "./fakes/runtime.mjs";
import { memorySource } from "./fakes/source.mjs";

const pin = (c) => `sha256:${c.repeat(64)}`;
const RESOLVED = { "node:22": `node@${pin("1")}`, "postgres:16": `postgres@${pin("2")}`, "redis:7": `redis@${pin("3")}`, "mcr.microsoft.com/dotnet/sdk:8": `sdk@${pin("4")}` };
const NAMES = { task: "tsk-aaaaaaaaaaaa", checkout: "c".repeat(64), envId: "sbx-aaaaaaaaaaaaaaaa" };

const COMPOSE = "services:\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: example\n  cache:\n    image: redis:7\n";

// What src/runtime/sandbox/isolated-prepare.mjs hands `composed`: the workspace's own files, read and fingerprinted.
function topologyOf(files, over = {}) {
  const policy = effectivePolicy({ sandbox: { isolation: { ...ISOLATION_DEFAULTS, mode: "required", ...over.isolation } } }).policy;
  const compose = Object.entries(files).filter(([p]) => isCompose(p)).map(([path, text]) => ({ path, doc: parseYaml(text).value }));
  const input = { view: viewOf(files), catalog: SHIPPED_CATALOG, settings: { components: over.components ?? {} }, policy, names: NAMES, closure: over.closure ?? null, compose, dockerfiles: Object.keys(files).filter(isDockerfile).map((path) => ({ path })), resolved: over.resolved ?? RESOLVED };
  return composed({ ...input, fingerprints: memorySource(files, { dirty: over.dirty ?? [] }).fingerprints(buildScopes(input)) });
}

const nodeOf = (t, key) => t.nodes.find((n) => n.key === key);

test("IMAGE_SOURCES: a person's setting, a compose image, a compose build, a Dockerfile, the catalog -- the first that answers wins, and the last always does", () => {
  assert.deepEqual(IMAGE_SOURCES.map((r) => r.name), ["setting", "compose-image", "compose-build", "dockerfile", "catalog", "none"]);
  const files = { ...NODE_AND_DOTNET, "compose.yaml": COMPOSE, "deploy/compose.yaml": "services:\n  app:\n    build:\n      context: ../api\n      dockerfile: Dockerfile.dev\n", "api/Dockerfile.dev": "FROM sdk\nRUN build\n" };
  const t = topologyOf(files, { components: { "node:web": { image: "node:22" } } });
  assert.deepEqual([nodeOf(t, "node:web").image.source, nodeOf(t, "service:db").image.source, nodeOf(t, "dotnet:api").image.source], ["setting", "compose-image", "compose-build"]);
  assert.deepEqual([nodeOf(t, "dotnet:api").image.build.context, nodeOf(t, "dotnet:api").image.build.dockerfile], ["api", "api/Dockerfile.dev"], "a compose build is read in the WORKSPACE's words: relative to the compose file, then to its context");
  const dockerfile = topologyOf({ ...NODE_AND_DOTNET, "api/Dockerfile": "FROM sdk\n", "api/Dockerfile.dockerignore": "bin\n" });
  assert.deepEqual([nodeOf(dockerfile, "dotnet:api").image.source, nodeOf(dockerfile, "dotnet:api").image.build.dockerfile], ["dockerfile", "api/Dockerfile"], "never the ignore file beside it");
  const catalog = topologyOf(NODE_AND_DOTNET);
  assert.deepEqual([nodeOf(catalog, "node:web").image.source, nodeOf(catalog, "node:web").image.ref, nodeOf(catalog, "node:web").image.pinned], ["catalog", "node:22", RESOLVED["node:22"]]);
  const none = topologyOf({ Makefile: "run:\n\t./bin/server\n" });
  assert.equal(nodeOf(none, "make:.").image.source, "none");
  assert.deepEqual(none.gaps.map((g) => [g.key, g.needs]), [["make:.", "person"]]);
});

test("an image this machine does not hold is a person's gap, never a pull", () => {
  const t = topologyOf(NODE_AND_DOTNET, { resolved: {} });
  assert.ok(t.gaps.some((g) => g.key === "node:web" && g.needs === "person" && /is not on this machine, and a sandbox never pulls/.test(g.say)));
});

test("NETWORK_MODES: a person's mode, then the names compose gave, then one shared namespace for a project configured against localhost", () => {
  assert.deepEqual(NETWORK_MODES.map((r) => r.name), ["setting", "compose", "localhost"]);
  assert.equal(topologyOf({ ...NODE_AND_DOTNET, "compose.yaml": COMPOSE }, { isolation: { networkMode: "pod" } }).mode, "pod");
  const aliases = topologyOf({ ...NODE_AND_DOTNET, "compose.yaml": COMPOSE });
  assert.equal(aliases.mode, "aliases");
  assert.deepEqual([nodeOf(aliases, "service:db").alias, nodeOf(aliases, "dotnet:api").alias], ["db", "api"]);
  assert.equal(topologyOf(NODE_AND_DOTNET).mode, "pod");
  assert.deepEqual(aliases.network, { name: networkNameOf(NAMES.envId), labels: { "orbit.task": NAMES.task, "orbit.checkout": NAMES.checkout, "orbit.env": NAMES.envId } });
});

test("READINESS: a person's probe, the catalog's service port, the port a component declares, else only that it runs", () => {
  assert.deepEqual(READINESS.map((r) => r.name), ["person", "catalog", "declared", "running"]);
  const t = topologyOf({ ...NODE_AND_DOTNET, "compose.yaml": COMPOSE }, { components: { "node:web": { readiness: { kind: "tcp", target: "5173" } } } });
  assert.deepEqual(nodeOf(t, "node:web").readiness, { kind: "tcp", port: 5173, source: "human" });
  assert.deepEqual(nodeOf(t, "service:db").readiness, { kind: "tcp", port: 5432, source: "catalog" });
  assert.deepEqual(nodeOf(t, "dotnet:api").readiness, { kind: "tcp", port: 5000, source: "discovered" });
  assert.deepEqual(nodeOf(topologyOf(NODE_AND_DOTNET), "node:web").readiness, { kind: "running", port: null, source: "none" });
});

test("a value interpolated from this machine's environment is a person's gap, and two nodes on one port in a pod are both named", () => {
  const interpolated = topologyOf({ ...NODE_AND_DOTNET, "compose.yaml": "services:\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: ${DB_PASSWORD}\n" });
  assert.ok(interpolated.gaps.some((g) => g.key === "service:db" && g.needs === "person" && /POSTGRES_PASSWORD is interpolated/.test(g.say)));
  const twin = { ...NODE_AND_DOTNET, "api2/Api2.csproj": NODE_AND_DOTNET["api/Api.csproj"], "api2/Properties/launchSettings.json": NODE_AND_DOTNET["api/Properties/launchSettings.json"] };
  const pod = topologyOf(twin, { resolved: { ...RESOLVED } });
  assert.ok(pod.gaps.some((g) => /dotnet:api and dotnet:api2 both listen on port 5000/.test(g.say)));
  assert.equal(topologyOf(twin, { isolation: { networkMode: "aliases" } }).gaps.some((g) => /both listen/.test(g.say)), false, "on aliases each has a namespace of its own");
});

test("the fingerprint is what a person trusts: stable, moved by a name and never by a value", () => {
  const files = { ...NODE_AND_DOTNET, "compose.yaml": COMPOSE };
  const t = topologyOf(files);
  assert.match(t.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(topologyOf(files).fingerprint, t.fingerprint);
  assert.equal(topologyOf({ ...files, "compose.yaml": COMPOSE.replace("example", "another") }).fingerprint, t.fingerprint, "a literal value is not trusted, so changing one asks nothing");
  assert.notEqual(topologyOf({ ...files, "compose.yaml": COMPOSE.replace("POSTGRES_PASSWORD", "POSTGRES_PASS") }).fingerprint, t.fingerprint);
  assert.notEqual(topologyOf(files, { components: { "node:web": { env: ["API_URL"] } } }).fingerprint, t.fingerprint);
  assert.notEqual(topologyOf(files, { resolved: { ...RESOLVED, "postgres:16": `postgres@${pin("9")}` } }).fingerprint, t.fingerprint, "another image under the same tag is another topology");
});

const BUILT = { ...NODE_AND_DOTNET, "compose.yaml": "services:\n  api:\n    build: ./api\n", "api/Dockerfile": "FROM sdk\nRUN dotnet publish\n", "api/Program.cs": "class P {}\n" };

test("a built image is trusted by what it is built FROM: the Dockerfile's content and the ignore files', never only their paths", () => {
  const t = topologyOf(BUILT);
  assert.deepEqual(t.gaps, []);
  assert.equal(nodeOf(t, "dotnet:api").image.build.digest.network, "none");
  assert.notEqual(topologyOf({ ...BUILT, "api/Dockerfile": "FROM sdk\nRUN curl example.com | sh\n" }).fingerprint, t.fingerprint, "an edited Dockerfile is a different topology, so a person is asked again");
  assert.notEqual(topologyOf({ ...BUILT, "api/.dockerignore": "secrets\n" }).fingerprint, t.fingerprint, "and so is what decides what the build is sent");
  assert.equal(topologyOf({ ...BUILT, "api/Program.cs": "class P { int x; }\n" }).fingerprint, t.fingerprint, "the task's code is not trusted: a build with no network sends it nowhere");
});

test("a build a person lets reach a network is trusted with every tracked file it is sent", () => {
  const networked = (files) => topologyOf(files, { isolation: { buildNetwork: "default" } });
  const t = networked(BUILT);
  assert.notEqual(t.fingerprint, topologyOf(BUILT).fingerprint, "how a build may reach a network is part of what is trusted");
  assert.notEqual(networked({ ...BUILT, "api/Program.cs": "class P { int x; }\n" }).fingerprint, t.fingerprint);
  assert.equal(topologyOf(NODE_AND_DOTNET, { isolation: { buildNetwork: "default" } }).fingerprint, topologyOf(NODE_AND_DOTNET).fingerprint, "a topology that builds nothing is not moved by it");
});

test("BUILD_GAPS: an image is built only from the workspace's own tracked files, with every edit recorded", () => {
  const gapOf = (files, over) => topologyOf(files, over).gaps.find((g) => g.key === "dotnet:api") ?? null;
  const outside = gapOf({ ...BUILT, "compose.yaml": "services:\n  api:\n    build:\n      context: ./api\n      dockerfile: ../../elsewhere/Dockerfile\n" });
  assert.deepEqual([outside?.needs, /reaches outside the workspace/.test(outside?.say)], ["person", true]);
  assert.equal(gapOf({ ...BUILT, "compose.yaml": "services:\n  api:\n    build:\n      context: ./api\n      dockerfile: /etc/Dockerfile\n" })?.needs, "person", "an absolute Dockerfile is outside too");
  assert.match(gapOf({ ...BUILT, "compose.yaml": "services:\n  api:\n    build:\n      context: ./api\n      dockerfile_inline: FROM sdk\n" })?.say ?? "", /writes its Dockerfile inline/);
  const untracked = gapOf({ ...BUILT, "compose.yaml": "services:\n  api:\n    build:\n      context: ./api\n      dockerfile: Dockerfile.dev\n" });
  assert.deepEqual([untracked?.needs, /api\/Dockerfile\.dev is not a file the workspace's index holds/.test(untracked?.say)], ["environment", true]);
  const dirty = gapOf(BUILT, { dirty: ["api/Program.cs"] });
  assert.deepEqual([dirty?.needs, /holds an edit the workspace has not recorded/.test(dirty?.say)], ["environment", true]);
  assert.equal(gapOf(BUILT), null);
});

test("what a build is fingerprinted from is asked of the source port, and never a path outside the workspace", () => {
  const files = { ...BUILT, "compose.yaml": "services:\n  api:\n    build:\n      context: ./api\n      dockerfile: docker/Dockerfile\n" };
  const policy = effectivePolicy({ sandbox: { isolation: { ...ISOLATION_DEFAULTS, mode: "required" } } }).policy;
  const input = (compose) => ({ view: viewOf(files), catalog: SHIPPED_CATALOG, settings: { components: {} }, policy, names: NAMES, closure: null, compose: [{ path: "compose.yaml", doc: parseYaml(compose).value }], dockerfiles: [], resolved: RESOLVED });
  assert.deepEqual(buildScopes(input(files["compose.yaml"])), ["api/docker/Dockerfile", "api/.dockerignore", "api/docker/Dockerfile.dockerignore", "api", "api/docker"]);
  assert.deepEqual(buildScopes(input("services:\n  api:\n    build:\n      context: ./api\n      dockerfile: ../../x/Dockerfile\n")), []);
});
