import assert from "node:assert/strict";
import { test } from "node:test";
import { declared, manifests } from "../src/architecture/analyzers/manifests.mjs";
import { look } from "../src/architecture/capability.mjs";
import { ANALYZERS, analyseWith } from "../src/architecture/analyzers/index.mjs";
import { scan } from "../src/architecture/scan.mjs";
import { fakeFrontend } from "./fakes/frontend.mjs";

// CHARACTERIZATION: what the manifest analysis produces today, pinned object by
// object before the manifest reading moved behind an ecosystem adapter
// registry. A refactor that changes any of these is a behaviour change, and
// has to say so by editing this file on purpose.

const NODE = JSON.stringify({
  name: "demo",
  engines: { node: ">=20" },
  scripts: { test: "node --test", lint: "check-lines", start: "node server.mjs", "build:web": "vite build" },
  dependencies: { "widget-client": "^2.0.0", "@acme/thing": "1.0.0" },
  devDependencies: { "gadget-tool": "^1.0.0" },
});

const PROJECT = `<Project Sdk="Some.Sdk">
  <ItemGroup>
    <PackageReference Include="Some.Vendor.Package" Version="1.2.3" />
    <PackageReference Include="Other.Thing" Version="4.0.0"></PackageReference>
  </ItemGroup>
</Project>`;

const input = (sources) => ({ files: Object.keys(sources), read: (p) => sources[p] ?? null, facts: [] });

test("package.json: dependencies and devDependencies are one count, engines ride in the statement", () => {
  const { facts } = manifests(input({ "package.json": NODE }));
  const stack = facts.find((f) => f.kind === "stack");
  assert.deepEqual(stack, {
    kind: "stack",
    key: "package.json",
    statement: "package.json declares 3 dependency(ies), and requires node >=20",
    scope: ["package.json"],
    evidence: ["package.json"],
    source: "package-manifest",
    confidence: "certain",
    unknowns: ["whether each declared dependency is actually imported anywhere — a manifest says what is allowed, not what is used"],
  });
});

test("package.json: only scripts named like a gate become invariants, with the command quoted", () => {
  const gates = manifests(input({ "package.json": NODE })).facts.filter((f) => f.kind === "invariant");
  assert.deepEqual(gates.map((g) => g.key), ["package.json#test", "package.json#lint", "package.json#build:web"]);
  assert.deepEqual(gates[0], {
    kind: "invariant",
    key: "package.json#test",
    statement: "this project runs its own test gate",
    scope: ["package.json"],
    evidence: ["package.json"],
    source: "package-manifest",
    confidence: "certain",
    because: "declared as `node --test`",
    unknowns: ["whether the gate passes right now — this read the declaration, and ran nothing"],
  });
});

test("declared() hands the capability search names, scripts and engines — never a version", () => {
  assert.deepEqual(declared(input({ "package.json": NODE })), [
    {
      path: "package.json",
      deps: ["widget-client", "@acme/thing", "gadget-tool"],
      scripts: [["test", "node --test"], ["lint", "check-lines"], ["start", "node server.mjs"], ["build:web", "vite build"]],
      engines: { node: ">=20" },
    },
  ]);
});

test("a manifest with no dependency and no engine is no stack fact at all", () => {
  const { facts } = manifests(input({ "package.json": JSON.stringify({ name: "bare", scripts: { start: "x" } }) }));
  assert.deepEqual(facts, []);
});

test("a package.json that is not JSON is skipped, not a crash", () => {
  const out = manifests(input({ "package.json": "{ nope" }));
  assert.deepEqual(out.facts, []);
  assert.equal(out.unknowns.length, 1);
  assert.match(out.unknowns[0], /no manifest shape this engine reads was found/);
});

// 1.7.6: runtime discovery needs a repository's packages as units, so a nested
// manifest IS read now -- the one deliberate change to what this analyser sees,
// recorded in src/ecosystems/node.mjs. A vendored one still is not.
test("changed on purpose: a nested package.json is a manifest too, and one under node_modules is not", () => {
  assert.deepEqual(declared(input({ "packages/a/package.json": NODE })).map((m) => m.path), ["packages/a/package.json"]);
  assert.deepEqual(declared(input({ "node_modules/dep/package.json": NODE, "packages/a/node_modules/dep/package.json": NODE })), []);
});

test("a .NET project file: each PackageReference Include is a dependency name", () => {
  const found = declared(input({ "src/App/App.csproj": PROJECT }));
  assert.deepEqual(found, [{ path: "src/App/App.csproj", deps: ["Some.Vendor.Package", "Other.Thing"], scripts: [], engines: {} }]);
  const stack = manifests(input({ "src/App/App.csproj": PROJECT })).facts;
  assert.deepEqual(stack.map((f) => f.statement), ["src/App/App.csproj declares 2 dependency(ies)"]);
});

// The two DELIBERATE changes the adapter registry made to this reading. Each
// was a place the one-regex read of a project file was wrong.
test("changed on purpose: a commented-out reference is not counted, and attribute order is not a reason to miss one", () => {
  const text = `<Project><ItemGroup>
    <!-- <PackageReference Include="Gone.Thing" Version="1" /> -->
    <PackageReference Version="2" Include="Late.Include" />
  </ItemGroup></Project>`;
  assert.deepEqual(declared(input({ "App.csproj": text }))[0].deps, ["Late.Include"]);
});

test("changed on purpose: a shared build file or a central version list is no stack fact of its own", () => {
  const props = `<Project><ItemGroup><PackageVersion Include="Some.Vendor.Package" Version="1" /></ItemGroup></Project>`;
  assert.deepEqual(declared(input({ "Directory.Packages.props": props, "Directory.Build.props": props })), []);
});

test("changed on purpose: a secondary checkout's package.json files are read, as the primary's are", () => {
  assert.deepEqual(declared(input({ "worker::package.json": NODE, "worker::packages/a/package.json": NODE })).map((m) => m.path), ["worker::package.json", "worker::packages/a/package.json"]);
});

test("a project file in a SECONDARY checkout is still recognised by its extension", () => {
  assert.deepEqual(declared(input({ "worker::src/Worker.csproj": PROJECT })).map((m) => m.path), ["worker::src/Worker.csproj"]);
});

test("a pipeline definition is one invariant over every workflow file", () => {
  const facts = manifests(input({ "package.json": NODE, ".github/workflows/ci.yml": "x", ".github/workflows/rel.yaml": "y" })).facts;
  const ci = facts.find((f) => f.key === "ci");
  assert.equal(ci.statement, "2 pipeline definition(s) run on this project automatically");
  assert.deepEqual(ci.scope, [".github/workflows/ci.yml", ".github/workflows/rel.yaml"]);
});

test("a dependency name matches a capability token by its parts, and that is certain", () => {
  const found = look(["vendor"], { ...input({ "src/App/App.csproj": PROJECT }), config: {} }).facts;
  assert.equal(found[0].confidence, "certain");
  assert.equal(found[0].providedBy, "some.vendor.package");
});

// The failure isolation the scan relies on: the manifests row throwing costs
// the manifests answer and nothing else.
test("a manifest analysis that throws costs its own facts and names itself", () => {
  const exploding = { files: ["package.json", "src/a/x.mjs", "src/a/y.mjs", "src/a/z.mjs"], read: () => { throw new Error("torn read"); }, search: () => [], facts: [] };
  const out = analyseWith(ANALYZERS.filter((a) => ["manifests", "shape"].includes(a.name)), exploding);
  assert.ok(out.unknowns.some((u) => /the manifests analysis could not read this tree — torn read/.test(u)));
  assert.ok(out.facts.some((f) => f.kind === "module"), "shape still answered");
});

test("a scanned manifest fact is stamped with its OWN scope's fingerprint", () => {
  const source = fakeFrontend({ files: ["package.json"], sources: { "package.json": NODE }, fingerprints: { "package.json": { hash: "h-pkg", files: 1, dirty: 0 } } });
  const done = scan({ source, now: () => "2026-09-23T00:00:00.000Z" }, { scan: "asked" }, {});
  const stack = done.facts.find((f) => f.kind === "stack");
  assert.equal(stack.fingerprint, "h-pkg");
  assert.equal(stack.status, "fresh");
  assert.equal(stack.commit, "abc1234");
  assert.match(stack.id, /^arch-stack-[0-9a-f]+$/);
});
