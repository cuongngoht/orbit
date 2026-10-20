// Discovery over real project shapes: what a checkout NEEDS, read from its
// evidence files and nothing else -- through the ecosystem registry, never a
// parallel one, and with every command offered only because a file declared it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { builtinEcosystems } from "../src/ecosystems/builtin.mjs";
import { createEcosystemRegistry } from "../src/ecosystems/registry.mjs";
import { discover } from "../src/runtime/discover/index.mjs";
import { DEVCONTAINER_JSONC, FRAMEWORK_BACKEND, NODE_AND_DOTNET, POLYGLOT, SHARED_TARGETS, SHIPPED_CATALOG, UNKNOWN_STACK, discovered } from "./fakes/runtime.mjs";

// The commands a project DECLARED: restoring dependencies is implied by the catalog, and is asked of on its own.
const of = (out, kind) => out.facts.filter((f) => f.kind === kind && !(kind === "command" && f.implied));
const impliedOf = (out) => out.facts.filter((f) => f.kind === "command" && f.implied).map((f) => [f.component, f.declaredAs, f.purpose, f.argv.join(" "), f.safe]).sort();
const component = (out, key) => of(out, "component").find((f) => f.key === key);
const requirementsOf = (out, comp) => of(out, "requirement").filter((f) => f.component === comp).map((f) => [f.requirement, f.range ?? null, f.confidence]).sort();
const commandsOf = (out, comp) => of(out, "command").filter((f) => f.component === comp).map((f) => [f.declaredAs, f.argv.join(" "), f.safe]).sort();

test("Scenario A: a Node client and a modern .NET API are two components with what each needs and can run", () => {
  const { out } = discovered(NODE_AND_DOTNET);
  assert.deepEqual(of(out, "component").map((f) => [f.key, f.componentKind]).sort(), [["dotnet:api", "web"], ["dotnet:tests/Api.Tests", "test-harness"], ["node:web", "custom-service"]]);
  assert.deepEqual(requirementsOf(out, "node:web"), [["node", ">=22", "certain"], ["npm", null, "certain"], ["playwright", null, "certain"]]);
  assert.equal(of(out, "requirement").find((f) => f.requirement === "playwright").stage, "development", "a development dependency is not needed to RUN the component");
  assert.deepEqual(requirementsOf(out, "dotnet:api"), [["dotnet", ">=8.0", "certain"]]);
  assert.deepEqual(commandsOf(out, "node:web"), [["build", "npm run build", true], ["dev", "npm run dev", true], ["lint", "npm run lint", true], ["test", "npm run test", true]], "deploy is a script, and nothing here would offer to run it; lint names a check of what is there");
  assert.equal(of(out, "command").find((f) => f.declaredAs === "lint").purpose, "verify");
  assert.deepEqual(commandsOf(out, "dotnet:api"), [["start:http", "dotnet run --launch-profile http", true]]);
  assert.deepEqual(commandsOf(out, "dotnet:tests/Api.Tests"), [["test", "dotnet test", true]]);
  assert.deepEqual(of(out, "port").map((f) => [f.component, f.port]), [["dotnet:api", 5000]]);
});

test("a pipeline says where the project is KNOWN to run, and never that it runs nowhere else", () => {
  const { out } = discovered(NODE_AND_DOTNET);
  const [os] = of(out, "os-constraint");
  assert.deepEqual([os.os, os.exclusive, os.confidence, os.source], [["linux", "win32"], false, "possible", "ci"]);
});

test("Scenario F: a classic framework target is a requirement of its own, and the modern one is not touched", () => {
  const { out } = discovered(FRAMEWORK_BACKEND);
  assert.deepEqual(requirementsOf(out, "dotnet:legacy"), [["dotnet-framework", ">=4.8", "certain"]]);
  assert.deepEqual(requirementsOf(out, "node:web"), [["node", ">=22", "certain"], ["npm", null, "certain"]]);
  assert.deepEqual(commandsOf(out, "dotnet:legacy"), [["start:Legacy", "dotnet run --launch-profile Legacy", true]]);
});

test("a target set once in a shared build file is what each project beneath it requires -- unless it sets its own", () => {
  const { out } = discovered(SHARED_TARGETS);
  assert.deepEqual(requirementsOf(out, "dotnet:backend/Api"), [["dotnet", ">=10.0", "certain"]], "the project that states no target takes the shared one");
  assert.deepEqual(requirementsOf(out, "dotnet:backend/Worker"), [["dotnet", ">=8.0", "certain"]], "its own target is the answer, and the shared default is not also held against it");
  assert.deepEqual(requirementsOf(out, "dotnet:backend/Legacy/Old"), [["dotnet-framework", ">=4.8", "certain"]], "the NEAREST shared file speaks, and the one above it does not");
  assert.deepEqual(requirementsOf(out, "node:backend/tools/web"), [["npm", null, "certain"]], "a package of another ecosystem in the same folder tree inherits nothing");
  assert.deepEqual(of(out, "requirement").filter((f) => !f.component), [], "nothing is said of the checkout as a whole, so no project is held to another's target");
});

test("an inherited requirement is evidenced by the shared file, and goes stale with it or with the project", () => {
  const { out } = discovered(SHARED_TARGETS);
  const inherited = of(out, "requirement").find((f) => f.component === "dotnet:backend/Api" && f.requirement === "dotnet");
  assert.deepEqual(inherited.evidence, ["backend/Directory.Build.props"]);
  assert.deepEqual(inherited.scope, ["backend/Directory.Build.props", "backend/Api/Api.csproj"], "a project that began to set its own target would change the answer");
  assert.match(inherited.because, /backend\/Directory.Build.props states it for every unit beneath it that states none of its own/);
  assert.equal(inherited.statement, "Api requires dotnet >=10.0");
});

test("Scenario E: an unknown stack is PARTIAL knowledge, never a failure -- a Makefile and a Dockerfile still say how to build, run and test", () => {
  const { out } = discovered(UNKNOWN_STACK);
  assert.deepEqual(of(out, "component").map((f) => [f.key, f.componentKind, f.source]), [["make:.", "custom-service", "script"]]);
  assert.deepEqual(commandsOf(out, "make:."), [["build", "make build", true], ["run", "make run", true], ["test", "make test", true]]);
  assert.deepEqual(of(out, "port").map((f) => [f.port, f.confidence]), [[8080, "possible"]], "EXPOSE says where a container listens, not that anything does");
  assert.deepEqual(requirementsOf(out, "make:."), [["make", null, "certain"]]);
  assert.equal(of(out, "requirement").some((f) => f.requirement === "ubuntu"), false, "an image the catalog has no row for implies nothing");
});

test("a checkout with no evidence at all is understood as exactly that, with a sentence", () => {
  const { out } = discovered({ "README.md": "# nothing here", "src/main.xyz": "?" });
  assert.deepEqual(out.facts, []);
  assert.match(out.unknowns[0], /no component could be identified/);
});

test("Scenario D: a polyglot checkout -- a Node client, a Python worker, two servers -- is the same model, with no case for any of them", () => {
  const { out } = discovered(POLYGLOT);
  assert.deepEqual(of(out, "component").map((f) => f.key).sort(), ["make:worker", "node:web"]);
  assert.deepEqual(requirementsOf(out, "make:worker"), [["make", null, "certain"], ["python", ">=3.13 <4", "certain"]]);
  assert.deepEqual(of(out, "service").map((f) => [f.service, f.port, f.image]).sort(), [["postgres", 5432, "postgres:16"], ["redis", 6379, "redis:7"]], "the service that only BUILDS is the project's own code, not a dependency");
});

test("version files pin a major line; a pin that is not a version is said, not guessed", () => {
  const { out } = discovered({ ".nvmrc": "v22.1.0\n", "tools/.python-version": "system\n", ".tool-versions": "nodejs 20.11.0\nterraform 1.7.0\npython 3.12 3.11\n" });
  const reqs = of(out, "requirement").map((f) => [f.requirement, f.range, f.evidence[0]]).sort();
  assert.deepEqual(reqs, [["node", ">=20.11.0 <21", ".tool-versions"], ["node", ">=22.1.0 <23", ".nvmrc"], ["python", ">=3.12 <4", ".tool-versions"]]);
  assert.ok(out.unknowns.some((u) => /"system" is not a version this reads/.test(u)));
  assert.ok(out.unknowns.some((u) => /1 entry name a tool the catalog has no row for/.test(u)));
});

test("an existing dev container is summarised by what it PROVIDES -- never what it runs, never what it sets", () => {
  const { out } = discovered({ ".devcontainer/devcontainer.json": DEVCONTAINER_JSONC, ".devcontainer/Dockerfile": "FROM mcr.microsoft.com/windows/servercore:ltsc2022\n" });
  const [def] = of(out, "environment-definition");
  assert.equal(def.key, ".devcontainer/devcontainer.json");
  assert.deepEqual(def.definition.features.map((f) => [f.id, f.tag, f.version]), [["ghcr.io/devcontainers/features/node", "1", "20"], ["ghcr.io/devcontainers/features/dotnet", "2", "8.0"]]);
  assert.deepEqual([def.definition.forwardPorts, def.definition.hooks, def.definition.remoteEnv], [[5173, 5000], ["postCreateCommand"], ["API_TOKEN"]]);
  assert.equal(JSON.stringify(def).includes("do-not-keep-this-value"), false, "a value is never kept");
  assert.equal(JSON.stringify(def).includes("npm ci"), false, "a hook's text is never kept");
});

test("a dev container that does not parse costs its own facts and is said", () => {
  const { out } = discovered({ ".devcontainer/devcontainer.json": "{ not json" });
  assert.deepEqual(out.facts, []);
  assert.match(out.unknowns.join("\n"), /devcontainer.json: it does not parse/);
});

test("a command that needs a shell is kept as EVIDENCE and never as something to launch", () => {
  const files = { "package.json": JSON.stringify({ scripts: { start: "NODE_ENV=production node server.js", build: "tsc && vite build" } }), "package-lock.json": "{}" };
  const registry = builtinEcosystems();
  const { out } = discovered(files, { ecosystems: registry });
  assert.deepEqual(of(out, "command").map((f) => [f.declaredAs, f.argv.join(" "), f.safe]).sort(), [["build", "npm run build", true], ["start", "npm run start", true]], "the SCRIPT is run by its package manager, which is the shell the author meant");
});

test("a node unit with scripts and no lock file offers no command, and says why", () => {
  const { out } = discovered({ "package.json": JSON.stringify({ scripts: { start: "node ." } }) });
  assert.deepEqual(of(out, "command").map((f) => [f.declaredAs, f.safe, f.argv]), [["start", false, []]]);
  assert.match(of(out, "command")[0].because, /nothing in the tree says which tool runs them/);
  assert.ok(out.unknowns.some((u) => /package.json: node scripts are declared here/.test(u)));
});

test("an unsafe script NAME is never put in front of a package manager", () => {
  const { out } = discovered({ "package.json": JSON.stringify({ scripts: { "dev --evil": "x", dev: "vite" } }), "package-lock.json": "{}" });
  assert.deepEqual(of(out, "command").map((f) => [f.declaredAs, f.safe]).sort(), [["dev", true]], "a name with a space is not even a purpose");
});

test("discovery reads evidence files and nothing else, once each, and names them", () => {
  const files = { ...NODE_AND_DOTNET, "src/Program.cs": "class Program {}", "web/src/app.ts": "export {}", "docs/guide.md": "# hi" };
  const { out, source } = discovered(files);
  assert.deepEqual(out.inventory, [".github/workflows/ci.yml", "api/Api.csproj", "api/Properties/launchSettings.json", "tests/Api.Tests/Api.Tests.csproj", "web/package.json"]);
  assert.deepEqual([...new Set(source.calls.paths)].sort(), out.inventory, "only evidence was read");
  assert.equal(source.calls.search, 0);
  assert.equal(source.calls.fingerprints, 0);
});

test("a command runs from its COMPONENT's directory, not from the folder the file that declares it sits in", () => {
  const { out } = discovered(NODE_AND_DOTNET);
  const cwds = Object.fromEntries(of(out, "command").map((f) => [f.key.split("|")[0] + "|" + f.declaredAs, f.cwd]));
  assert.equal(cwds["dotnet:api|start:http"], "api", "a launch profile under api/Properties starts the api project, from api/");
  assert.equal(cwds["node:web|dev"], "web");
});

test("a reader that throws costs its own facts and says so; the others still read", () => {
  const { source, input } = discovered(NODE_AND_DOTNET);
  const boom = { ...input, read: (p) => { if (p.endsWith("ci.yml")) throw new Error("the source port failed"); return source.read(p); } };
  const out = discover(boom);
  assert.ok(out.unknowns.some((u) => /the pipelines reader failed \(the source port failed\)/.test(u)));
  assert.equal(of(out, "os-constraint").length, 0);
  assert.equal(of(out, "component").length, 3, "the manifests were still read");
});

test("a project's own adapter reaches discovery through the registry with no change here", () => {
  const registry = builtinEcosystems();
  registry.register({ id: "gopher", doc: "a Go module", detects: (p) => p === "go.mod", parseManifest: () => ({ unit: true, requires: { go: ">=1.22" }, commands: [["run", "go run ."]], kinds: ["api"] }) }, "project");
  const { out } = discovered({ "go.mod": "module x\n" }, { ecosystems: registry });
  assert.deepEqual(of(out, "component").map((f) => [f.key, f.componentKind]), [["gopher:.", "api"]]);
  assert.deepEqual(requirementsOf(out, "gopher:."), [["go", ">=1.22", "certain"]]);
  assert.deepEqual(commandsOf(out, "gopher:."), [["run", "go run .", true]]);
});

test("an adapter that cannot read its file costs that manifest, with its own sentence", () => {
  const { out } = discovered({ "package.json": "{ torn" });
  assert.deepEqual(out.facts, []);
  assert.ok(out.unknowns.some((u) => /package.json/.test(u)));
});

test("what read it is part of the answer, so a new reader or a new catalog reads again", () => {
  const a = discovered(NODE_AND_DOTNET).out.readers;
  assert.equal(a, discovered(NODE_AND_DOTNET).out.readers);
  const fewer = createEcosystemRegistry(builtinEcosystems().list().slice(0, 1));
  assert.notEqual(a, discovered(NODE_AND_DOTNET, { ecosystems: fewer }).out.readers);
  assert.notEqual(a, discovered(NODE_AND_DOTNET, { catalog: { ...SHIPPED_CATALOG, digest: "other" } }).out.readers);
});

test("a file that starts with a byte-order mark -- Visual Studio writes one -- is read like any other", () => {
  const bom = (text) => "\uFEFF" + text;
  const { out } = discovered({
    "api/Api.csproj": bom('<Project Sdk="Vendor.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>'),
    "api/Properties/launchSettings.json": bom(JSON.stringify({ profiles: { http: { commandName: "Project", applicationUrl: "http://localhost:5172" } } })),
    "web/package.json": bom(JSON.stringify({ name: "web", engines: { node: ">=22" }, scripts: { dev: "vite" } })),
    "web/package-lock.json": "{}",
    Dockerfile: bom("FROM node:22\nEXPOSE 3000\n"),
  });
  assert.deepEqual(out.gaps, [], "nothing could not be read");
  assert.deepEqual(of(out, "component").map((f) => f.key).sort(), ["dotnet:api", "node:web"]);
  assert.deepEqual(of(out, "port").map((f) => f.port).sort((a, b) => a - b), [3000, 5172], "the launch profile's port, and the Dockerfile's");
  assert.deepEqual(commandsOf(out, "dotnet:api"), [["start:http", "dotnet run --launch-profile http", true]]);
});

test("a checkout whose every script where it is run from is of one family is POSSIBLY run there -- a mix, or a script deeper in, says nothing", () => {
  const os = (files) => discovered(files).out.facts.filter((f) => f.kind === "os-constraint");
  const windows = os({ "build.ps1": "Write-Output hi", "scripts/deploy.cmd": "echo", "src/tool.sh": "echo" });
  assert.deepEqual(windows.map((f) => [f.os, f.source, f.confidence, f.exclusive, f.evidence]), [[["win32"], "script", "possible", false, ["build.ps1"]], [["win32"], "script", "possible", false, ["scripts/deploy.cmd"]]]);
  assert.match(windows[0].because, /PowerShell scripts; that says where it may be run, not where it cannot/);
  assert.deepEqual(os({ "build.ps1": "x", "build.sh": "y" }), [], "a mix says nothing");
  assert.deepEqual(os({ "tools/deep/run.ps1": "x" }), [], "a script deeper in is not where a person runs things from");
});

test("restoring dependencies is IMPLIED by the catalog -- the lock file's own tool, or the one every unit of an ecosystem has -- and is never a declared command", () => {
  const { out } = discovered(NODE_AND_DOTNET);
  assert.deepEqual(impliedOf(out), [["dotnet:api", "restore:implied", "restore", "dotnet restore", true], ["dotnet:tests/Api.Tests", "restore:implied", "restore", "dotnet restore", true], ["node:web", "restore:implied", "restore", "npm ci", true]]);
  assert.ok(of(out, "command").every((f) => f.purpose !== "restore"), "none of what a project declared is a restore");
});

test("the lock file picks the restore tool; with no lock file a script unit has none to imply", () => {
  const pnpm = discovered({ "package.json": JSON.stringify({ scripts: { dev: "vite" } }), "pnpm-lock.yaml": "" }).out;
  assert.deepEqual(impliedOf(pnpm).map((r) => r[3]), ["pnpm install --frozen-lockfile"]);
  const none = discovered({ "package.json": JSON.stringify({ scripts: { dev: "vite" } }) }).out;
  assert.deepEqual(impliedOf(none), [], "nothing in the tree says which tool fetches the dependencies");
});

test("a project script NAMED restore is evidence that it exists and is never the implied one", () => {
  const { out } = discovered({ "package.json": JSON.stringify({ scripts: { restore: "node fetch.js", dev: "vite" } }), "package-lock.json": "{}" });
  assert.deepEqual(of(out, "command").map((f) => [f.declaredAs, f.purpose]).sort(), [["dev", "start"], ["restore", "restore"]]);
  assert.deepEqual(impliedOf(out).map((r) => r[3]), ["npm ci"]);
});

// ---- what depends on what (1.8.4) ---------------------------------------------------------------------------

const MONOREPO = {
  "package.json": JSON.stringify({ name: "shop", workspaces: ["web", "contracts"] }),
  "package-lock.json": "{}",
  "web/package.json": JSON.stringify({ name: "@shop/web", dependencies: { "@shop/contracts": "workspace:*", react: "19.0.0" }, scripts: { build: "vite build", test: "vitest run" } }),
  "contracts/package.json": JSON.stringify({ name: "@shop/contracts", scripts: { test: "spectral lint" } }),
  "backend/Directory.Build.props": "<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>",
  "backend/Api/Api.csproj": '<Project Sdk="Vendor.NET.Sdk.Web"><ItemGroup><ProjectReference Include="..\\Lib\\Lib.csproj" /><ProjectReference Include="..\\Gone\\Gone.csproj" /></ItemGroup></Project>',
  "backend/Lib/Lib.csproj": '<Project Sdk="Vendor.NET.Sdk"></Project>',
};

const edges = (out) => of(out, "dependency").map((f) => [f.component, f.dependsOn ?? null, f.via, f.reference]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

test("what depends on what is read from the files: a reference by path, a unit of this checkout by its own name, a shared file by what it reaches", () => {
  const { out } = discovered(MONOREPO);
  assert.deepEqual(edges(out), [
    ["dotnet:backend/Api", "dotnet:backend/Lib", "manifest", "../Lib/Lib.csproj"],
    ["dotnet:backend/Api", null, "manifest", "../Gone/Gone.csproj"],
    ["dotnet:backend/Api", null, "shared", "backend/Directory.Build.props"],
    ["dotnet:backend/Lib", null, "shared", "backend/Directory.Build.props"],
    ["node:web", "node:contracts", "manifest", "@shop/contracts"],
  ]);
  assert.equal(of(out, "dependency").some((f) => f.reference === "react"), false, "a package from elsewhere is not a relation between components");
});

test("a reference nothing read resolves is kept and said -- what depends on it is unknown, never absent", () => {
  const { out } = discovered(MONOREPO);
  const gone = of(out, "dependency").find((f) => f.reference === "../Gone/Gone.csproj");
  assert.equal(gone.dependsOn, undefined);
  assert.match(gone.statement, /names \.\.\/Gone\/Gone\.csproj, which no unit read here resolves/);
  assert.ok(out.unknowns.some((u) => /Gone\.csproj, which no unit read here resolves -- what depends on it is unknown/.test(u)));
  assert.equal(out.gaps.some((g) => /Gone/.test(g)), false, "an unknown, not a reason to call the whole understanding partial");
});

test("a component's dependencies are part of what understanding says of it", async () => {
  const { componentsOf } = await import("../src/runtime/components.mjs");
  const { out } = discovered(MONOREPO);
  const web = componentsOf(out.facts).components.find((c) => c.key === "node:web");
  assert.deepEqual(web.dependencies.map((d) => [d.dependsOn, d.via, d.reference]), [["node:contracts", "manifest", "@shop/contracts"]]);
});
