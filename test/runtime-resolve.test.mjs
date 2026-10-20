// Compatibility is resolved BEFORE anything is started, per component, and a
// preference only ever chooses among the ways that work. The scenarios of the
// release, as tables: what runs where, and why what does not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PROVIDERS } from "../src/runtime/providers/index.mjs";
import { resolve } from "../src/runtime/resolve/plan.mjs";
import { DEVCONTAINER_JSONC, FRAMEWORK_BACKEND, NODE_AND_DOTNET, POLYGLOT, UNKNOWN_STACK, FULL_TOOLS, worldOf } from "./fakes/runtime.mjs";

const plan = (files, opts = {}, settings = {}) => resolve(worldOf(files, opts), settings, PROVIDERS);
const by = (p, key) => p.components.find((c) => c.key === key);
const row = (p, key) => [by(p, key).state, by(p, key).provider];
const VALIDATED = { id: "env-devcontainer", provider: "devcontainer", state: "VALIDATED" };

test("Scenario A: Node and .NET, no dev container, a Mac that has both -- everything runs NATIVE, and no container is mentioned as required", () => {
  const p = plan(NODE_AND_DOTNET);
  assert.deepEqual([row(p, "node:web"), row(p, "dotnet:api")], [["ready", "native"], ["ready", "native"]]);
  assert.equal(by(p, "dotnet:tests/Api.Tests").state, "not-startable");
  assert.equal(p.overall, "READY");
  assert.deepEqual(by(p, "node:web").command, { declaredAs: "dev", text: "vite", argv: ["npm", "run", "dev"], cwd: "web", ports: null });
  const container = by(p, "node:web").alternatives.find((a) => a.provider === "devcontainer");
  assert.equal(container.state, "needs-environment", "a container is a possibility, never a requirement");
});

test("a HYBRID checkout: each component runs where a person placed it -- one in the dev container, one on the host -- and the project is READY", () => {
  const placed = { components: { "node:web": { provider: "devcontainer" }, "dotnet:api": { provider: "native" } } };
  const p = plan(NODE_AND_DOTNET, { instances: [VALIDATED] }, placed);
  assert.deepEqual([row(p, "node:web"), row(p, "dotnet:api")], [["ready", "devcontainer"], ["ready", "native"]]);
  assert.equal(p.overall, "READY");
  const onlyOne = plan(NODE_AND_DOTNET, { instances: [VALIDATED] }, { strategy: "auto", components: { "node:web": { provider: "devcontainer" } } });
  assert.deepEqual([row(onlyOne, "node:web"), row(onlyOne, "dotnet:api")], [["ready", "devcontainer"], ["ready", "native"]], "a component nobody placed is AUTO, and auto is native first");
});

// What the connectivity checks last saw, as the world hands it in: fresh answers of before-start targets only.
const SAW = (native, devcontainer) => ({ "dotnet:api": { ...(native ? { native: { state: native, target: "corporate-sql", label: "Corporate SQL", host: "sql.internal.example", port: 1433, checkedAt: "2026-10-03T10:00:00.000Z", age: 120000 } } : {}), ...(devcontainer ? { devcontainer: { state: devcontainer, target: "corporate-sql", label: "Corporate SQL", host: "sql.internal.example", port: 1433, checkedAt: "2026-10-03T10:00:00.000Z", age: 120000 } } : {}) } });

test("under AUTO, a way whose before-start target was freshly UNREACHABLE is passed over for one where it answered -- and the reason names the target", () => {
  const p = plan(NODE_AND_DOTNET, { instances: [VALIDATED], reach: SAW("UNREACHABLE", "REACHABLE") });
  assert.deepEqual([row(p, "dotnet:api"), row(p, "node:web")], [["ready", "devcontainer"], ["ready", "native"]], "only the component that needs the target moves");
  const native = by(p, "dotnet:api").alternatives.find((a) => a.provider === "native");
  assert.equal(native.state, "unreachable");
  assert.match(native.because, /but Corporate SQL \(sql\.internal\.example:1433\) was not reachable from native when last checked, 2 min ago/);
});

test("a provider a person NAMED is never switched by what a check saw: native stays native, the container stays the container -- the start's gate says why", () => {
  const native = plan(NODE_AND_DOTNET, { instances: [VALIDATED], reach: SAW("UNREACHABLE", "REACHABLE") }, { components: { "dotnet:api": { provider: "native" } } });
  assert.deepEqual(row(native, "dotnet:api"), ["ready", "native"]);
  const container = plan(NODE_AND_DOTNET, { instances: [VALIDATED], reach: SAW("REACHABLE", "UNREACHABLE") }, { components: { "dotnet:api": { provider: "devcontainer" } } });
  assert.deepEqual(row(container, "dotnet:api"), ["ready", "devcontainer"]);
  const strategy = plan(NODE_AND_DOTNET, { instances: [VALIDATED], reach: SAW("UNREACHABLE", "REACHABLE") }, { strategy: "native" });
  assert.deepEqual(row(strategy, "dotnet:api"), ["ready", "native"], "a strategy a person set is a named provider too");
});

test("unreachable from every way is BLOCKED on the target, with what to do -- and an answer that is not a fresh UNREACHABLE moves nothing", () => {
  const nowhere = by(plan(NODE_AND_DOTNET, { instances: [VALIDATED], reach: SAW("UNREACHABLE", "UNREACHABLE") }), "dotnet:api");
  assert.deepEqual([nowhere.state, nowhere.provider, nowhere.blocking], ["blocked", "native", ["make Corporate SQL reachable from native, or check again: runtime retry corporate-sql"]]);
  for (const said of ["UNKNOWN", "NOT_CHECKED", "BLOCKED", "REACHABLE"]) assert.deepEqual(row(plan(NODE_AND_DOTNET, { instances: [VALIDATED], reach: SAW(said, "REACHABLE") }), "dotnet:api"), ["ready", "native"], said);
});

test("a project that can run natively never asks for a container, even when one is ready", () => {
  const p = plan(NODE_AND_DOTNET, { instances: [VALIDATED] });
  assert.equal(row(p, "node:web")[1], "native", "native is preferred when both work");
});

test("a missing tool is BLOCKED with what to do -- and a version that is too old says which", () => {
  const none = plan(NODE_AND_DOTNET, { tools: { ...FULL_TOOLS, node: false } });
  assert.deepEqual([by(none, "node:web").state, by(none, "node:web").blocking], ["blocked", ["install Node.js"]]);
  const old = plan(NODE_AND_DOTNET, { tools: { ...FULL_TOOLS, node: "18.19.0" } });
  assert.deepEqual(by(old, "node:web").blocking, ["install Node.js >=22"]);
  assert.equal(old.overall, "PARTIAL", "the API still runs");
  const why = by(old, "node:web").candidates.find((c) => c.provider === "native").because;
  assert.match(why, /18\.19\.0 does not satisfy >=22/, "said about the TOOL, in this subject's words");
  assert.doesNotMatch(why, /this engine|the extension/, "not the extension loader's sentence about an engine");
});

test("a tool nobody asked about is UNKNOWN, never reported as missing or incompatible", () => {
  const p = plan(NODE_AND_DOTNET, { tools: { npm: "10.8.1" } });
  assert.deepEqual([by(p, "node:web").state, by(p, "dotnet:api").state, p.overall], ["unknown", "unknown", "UNKNOWN"]);
  assert.match(by(p, "node:web").because, /has not been asked about/);
});

test("Scenario F: a React client runs, a classic Windows backend cannot -- the project is PARTIAL, not failed, and a Linux container does not solve it", () => {
  const p = plan(FRAMEWORK_BACKEND);
  assert.deepEqual([row(p, "node:web"), row(p, "dotnet:legacy")], [["ready", "native"], ["unresolved", null]]);
  assert.equal(p.overall, "PARTIAL");
  const legacy = by(p, "dotnet:legacy");
  const [nativeWay, containerWay] = ["native", "devcontainer"].map((id) => legacy.candidates.find((c) => c.provider === id));
  assert.deepEqual([nativeWay.state, containerWay.state], ["incompatible", "incompatible"]);
  assert.match(nativeWay.because, /can only be met on Windows, and this machine is macOS/);
  assert.match(containerWay.because, /not something a Linux dev container provides/);
});

test("a person's preference cannot make an impossible option valid, and never falls back to one they did not ask for", () => {
  const forced = plan(FRAMEWORK_BACKEND, { instances: [VALIDATED] }, { strategy: "native" });
  assert.equal(by(forced, "dotnet:legacy").state, "unresolved");
  const each = plan(FRAMEWORK_BACKEND, {}, { components: { "dotnet:legacy": { provider: "native" } } });
  assert.equal(by(each, "dotnet:legacy").state, "unresolved");
  const notFalling = plan(NODE_AND_DOTNET, { tools: { ...FULL_TOOLS, node: false }, instances: [VALIDATED] }, { strategy: "native" });
  assert.deepEqual([row(notFalling, "node:web"), by(notFalling, "node:web").provider], [["blocked", "native"], "native"], "native was asked for, so native is what is reported");
});

test("the same classic backend on Windows is UNKNOWN, not compatible: nothing here can tell whether the framework is installed", () => {
  const p = plan(FRAMEWORK_BACKEND, { platform: "win32" });
  assert.equal(by(p, "dotnet:legacy").state, "unknown");
  assert.match(by(p, "dotnet:legacy").because, /nothing here can tell whether \.NET Framework/);
});

test("Scenario G: a Linux dev container on a Mac is compatible once an environment is VALIDATED, and blocked until then", () => {
  const without = plan(NODE_AND_DOTNET, {}, { strategy: "devcontainer" });
  assert.deepEqual([by(without, "node:web").state, by(without, "node:web").blocking], ["blocked", ["design and adopt a dev container"]]);
  const adopted = plan(NODE_AND_DOTNET, { instances: [{ ...VALIDATED, state: "ADOPTED" }] }, { strategy: "devcontainer" });
  assert.deepEqual(by(adopted, "node:web").blocking, ["validate the environment"]);
  const ready = plan(NODE_AND_DOTNET, { instances: [VALIDATED] }, { strategy: "devcontainer" });
  assert.deepEqual([row(ready, "node:web"), row(ready, "dotnet:api")], [["ready", "devcontainer"], ["ready", "devcontainer"]]);
});

test("Scenario H: a Windows dev container on a Mac is INCOMPATIBLE, and is never started", () => {
  const files = { ...NODE_AND_DOTNET, ".devcontainer/devcontainer.json": JSON.stringify({ build: { dockerfile: "Dockerfile" } }), ".devcontainer/Dockerfile": "FROM mcr.microsoft.com/windows/servercore:ltsc2022\n" };
  const p = plan(files, { instances: [VALIDATED] }, { strategy: "devcontainer" });
  assert.equal(by(p, "node:web").state, "unresolved");
  assert.match(by(p, "node:web").because, /a Windows one, and a local container runtime on darwin runs Linux containers/);
  assert.equal(p.overall, "UNRESOLVED");
  assert.equal(row(plan(files), "node:web")[1], "native", "native is untouched by it");
});

test("the container host tells three things apart: no Docker command, no daemon behind it, and a daemon that did not answer", () => {
  const states = (tools) => by(plan(NODE_AND_DOTNET, { tools: { ...FULL_TOOLS, ...tools } }, { strategy: "devcontainer" }), "node:web");
  assert.deepEqual(states({ docker: false, "docker-daemon": false }).blocking.sort(), ["install Docker", "start Docker"]);
  assert.deepEqual(states({ "docker-daemon": { reason: "docker is installed, but its daemon is not reachable" } }).blocking, ["start Docker"]);
  assert.equal(states({ "docker-daemon": undefined, "docker": "27.3.1" }).state, "unknown", "a probe that timed out says nothing either way");
  assert.deepEqual(states({ devcontainer: false }).blocking, ["install the Dev Containers CLI"]);
});

test("a component with no declared way to start is BLOCKED and says so -- no command is ever guessed", () => {
  const p = plan({ "package.json": JSON.stringify({ engines: { node: ">=22" }, scripts: { build: "tsc" } }), "package-lock.json": "{}" });
  assert.equal(by(p, "node:.").state, "not-startable", "it declares nothing to start, so it is code others use");
  const worker = plan({ "package.json": JSON.stringify({ engines: { node: ">=22" }, scripts: { start: "NODE_ENV=production node ." } }) });
  assert.deepEqual([by(worker, "node:.").state, by(worker, "node:.").blocking.length], ["blocked", 1]);
  assert.match(by(worker, "node:.").because, /nothing in the tree says which tool runs them/);
});

test("a start command is chosen BY NAME among the ones a file declares -- never typed in", () => {
  const files = { "package.json": JSON.stringify({ engines: { node: ">=22" }, scripts: { dev: "vite", start: "vite preview", serve: "x" } }), "package-lock.json": "{}" };
  assert.equal(by(plan(files), "node:.").command.declaredAs, "dev", "the project's own names order the default");
  assert.deepEqual(by(plan(files), "node:.").startAlternatives, ["start", "serve"]);
  assert.equal(by(plan(files, {}, { components: { "node:.": { command: "start" } } }), "node:.").command.argv.join(" "), "npm run start");
  const bad = by(plan(files, {}, { components: { "node:.": { command: "rm -rf /" } } }), "node:.");
  assert.deepEqual([bad.state, bad.blocking.length], ["blocked", 1]);
  assert.match(bad.because, /no file declares one of that name/);
});

test("only what a file DECLARES is held against a machine: a base image's guess is shown, never counted", () => {
  const p = plan({ ...UNKNOWN_STACK, Dockerfile: "FROM node:22\nEXPOSE 8080\n" }, { tools: { make: "4.3" } });
  assert.equal(by(p, "make:.").state, "ready", "Node is possibly needed, and is not held against a machine without it");
  assert.ok(by(p, "make:.").candidates[0].notes.some((n) => /node may also be needed/.test(n)));
});

test("a browser driver listed under development dependencies is for developing and testing, and is not held against STARTING the client", () => {
  const p = plan(NODE_AND_DOTNET);
  const notes = by(p, "node:web").candidates[0].notes;
  assert.ok(notes.some((n) => /playwright may also be needed \(to develop and test it\)/.test(n)), notes.join(" | "));
  assert.equal(by(p, "node:web").state, "ready");
});

test("Scenario D: a polyglot project is the same model -- a component per thing, what each needs, the servers it is defined with", () => {
  const p = plan(POLYGLOT);
  assert.deepEqual(p.components.map((c) => [c.key, c.state]), [["make:worker", "ready"], ["node:web", "ready"]]);
  assert.deepEqual(p.services.map((s) => s.service).sort(), ["postgres", "redis"]);
  assert.equal(p.overall, "READY");
});

test("nothing to start is EMPTY, and a project of only libraries is not blocked by them", () => {
  assert.equal(plan({ "README.md": "x" }).overall, "EMPTY");
  assert.equal(plan({ "package.json": JSON.stringify({ engines: { node: ">=22" } }) }).overall, "EMPTY");
});

test("an unknown provider named in a setting is said, not silently ignored", () => {
  const p = plan(NODE_AND_DOTNET, {}, { strategy: "teleporter" });
  assert.equal(by(p, "node:web").state, "unresolved");
  assert.match(by(p, "node:web").because, /teleporter is not a provider this engine has/);
});

test("a native way that cannot be judged is UNKNOWN -- a container route that would need Docker does not make it blocked, and nobody is told to install it", () => {
  const files = { "web/package.json": JSON.stringify({ name: "web", engines: { node: "workspace:*" }, scripts: { dev: "vite" } }), "web/package-lock.json": "{}" };
  const p = plan(files, { tools: { ...FULL_TOOLS, docker: false, "docker-daemon": false, devcontainer: false } });
  const web = by(p, "node:web");
  assert.equal(web.state, "unknown");
  assert.deepEqual(web.blocking, [], "nothing to install: the question is whether native works, which nothing could tell");
  assert.match(web.because, /native: .*not known/);
  const decided = plan({ ...files, "web/package.json": JSON.stringify({ name: "web", engines: { node: ">=999" }, scripts: { dev: "vite" } }) }, { tools: { ...FULL_TOOLS, docker: false, "docker-daemon": false, devcontainer: false } });
  assert.deepEqual([by(decided, "node:web").state, by(decided, "node:web").blocking], ["blocked", ["install Node.js >=999"]], "a native way that is KNOWN to need something still says what");
});

test("the usual manifest ranges are read: a caret, an alternative and a bare major no longer block a machine that runs the thing", () => {
  for (const range of ["^20 || >=22", "22", "20.x || 22.x", "~22.1"]) {
    const p = plan({ "web/package.json": JSON.stringify({ name: "web", engines: { node: range }, scripts: { dev: "vite" } }), "web/package-lock.json": "{}" }, { tools: FULL_TOOLS });
    assert.equal(by(p, "node:web").state, "ready", range);
  }
});

test("a classic Windows desktop application on a Mac is UNRESOLVED -- the plan says so -- and not 'a library is not something to start'", () => {
  const files = { "legacy/Legacy.csproj": '<Project ToolsVersion="15.0"><PropertyGroup><OutputType>WinExe</OutputType><TargetFrameworkVersion>v4.8</TargetFrameworkVersion></PropertyGroup></Project>' };
  const p = plan(files, { tools: FULL_TOOLS });
  const legacy = by(p, "dotnet:legacy");
  assert.equal(legacy.kind, "desktop");
  assert.equal(legacy.state, "unresolved");
  assert.match(legacy.because, /\.NET Framework .*can only be met on Windows/);
  assert.equal(p.overall, "UNRESOLVED", "nothing in this project can run here, and the plan says that rather than that there is nothing to start");
});

test("a classic WEB application on a Mac is a web component that cannot run here -- not a library -- and why is said", () => {
  const files = { "legacy/Legacy.Web.csproj": '<Project ToolsVersion="15.0"><PropertyGroup><ProjectTypeGuids>{349c5851-65df-11da-9384-00065b846f21};{fae04ec0-301f-11d3-bf4b-00c04f79efbc}</ProjectTypeGuids><OutputType>Library</OutputType><TargetFrameworkVersion>v4.8</TargetFrameworkVersion></PropertyGroup></Project>' };
  const legacy = by(plan(files, { tools: FULL_TOOLS }), "dotnet:legacy");
  assert.deepEqual([legacy.kind, legacy.state], ["web", "unresolved"]);
  assert.match(legacy.because, /\.NET Framework .*can only be met on Windows/);
});

// The brief's own example: the matrix is per component, and never one word for the project.
const cells = (p, key) => Object.fromEntries(Object.entries(by(p, key).os).map(([os, c]) => [os, c.state]));

test("the operating systems are a matrix per COMPONENT: a classic backend is Windows's alone while its web client runs anywhere -- and the matrix does not depend on the machine asking", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    const p = plan(FRAMEWORK_BACKEND, { platform });
    assert.deepEqual([cells(p, "node:web"), cells(p, "dotnet:legacy")], [{ win32: "yes", linux: "yes", darwin: "yes" }, { win32: "yes", linux: "no", darwin: "no" }], platform);
    assert.match(by(p, "dotnet:legacy").os.darwin.because, /\.NET Framework \(classic\) can only be met on Windows/);
    assert.deepEqual(p.platforms.map((x) => x.name), ["Windows", "Linux", "macOS"]);
  }
});

test("a modern Windows-only target is Windows's alone in the matrix AND judged so on a Mac; nothing evidenced is unknown, never yes", () => {
  const desktop = { "app/App.csproj": `<Project Sdk="Vendor.NET.Sdk"><PropertyGroup><OutputType>WinExe</OutputType><TargetFramework>net8.0-windows</TargetFramework></PropertyGroup></Project>` };
  const p = plan(desktop);
  assert.deepEqual(cells(p, "dotnet:app"), { win32: "yes", linux: "no", darwin: "no" });
  assert.equal(by(p, "dotnet:app").candidates.find((c) => c.provider === "native").state, "incompatible", "a Mac cannot run it natively, however much .NET it has");
  const bare = plan({ "web/package.json": JSON.stringify({ name: "web", scripts: { dev: "vite" } }) });
  assert.deepEqual(cells(bare, "node:web"), { win32: "unknown", linux: "unknown", darwin: "unknown" }, "nothing declares what it needs, so nothing is claimed");
  assert.deepEqual(cells(plan(UNKNOWN_STACK), "make:."), { win32: "yes", linux: "yes", darwin: "yes" }, "a task runner the catalog says runs anywhere");
});

test("where the checkout's own files show it is built is EVIDENCE beside the matrix, never a requirement", () => {
  const p = plan({ ...NODE_AND_DOTNET, ".github/workflows/ci.yml": "jobs:\n  build:\n    runs-on: windows-latest\n" });
  assert.deepEqual(p.osEvidence.map((e) => [e.os, e.exclusive, e.evidence]), [[["win32"], false, [".github/workflows/ci.yml"]]]);
  assert.deepEqual(cells(p, "node:web"), { win32: "yes", linux: "yes", darwin: "yes" }, "a pipeline on Windows does not make the web client Windows-only");
});

test("evidence is one line per thing said, with every file that said it -- a pipeline is where it runs, scripts what they are written for", () => {
  const p = plan({ ...NODE_AND_DOTNET, "build.ps1": "x", "scripts/release.cmd": "y", ".github/workflows/ci.yml": "jobs:\n  a:\n    runs-on: ubuntu-latest\n" });
  assert.deepEqual(p.osEvidence.map((e) => [e.source, e.os, e.evidence]), [["ci", ["linux"], [".github/workflows/ci.yml"]], ["script", ["win32"], ["build.ps1", "scripts/release.cmd"]]]);
});

// What a real frontend showed: a package.json with a `start` script, a lockfile, and no Node range at
// all. npm comes with Node.js, and a dev container can be given Node.js -- so the app can run there,
// whether or not it NAMES Node.js. It was `unknown` for the container, and a start a person placed
// there was refused.
const NPM_ONLY = { "ui/package.json": JSON.stringify({ name: "ui", scripts: { start: "webpack serve" } }), "ui/package-lock.json": "{}" };

test("an app that names only npm can run in a dev container: npm comes with Node.js, which the container can be given", () => {
  const p = plan(NPM_ONLY, { instances: [VALIDATED] }, { components: { "node:ui": { provider: "devcontainer" } } });
  assert.deepEqual(row(p, "node:ui"), ["ready", "devcontainer"]);
  const inside = by(p, "node:ui").candidates.find((c) => c.provider === "devcontainer");
  assert.equal(inside.state, "compatible");
});
