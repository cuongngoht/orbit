import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { builtinEcosystems } from "../src/ecosystems/builtin.mjs";
import { createEcosystemRegistry } from "../src/ecosystems/registry.mjs";
import { RELATIONSHIPS, declares } from "../src/ecosystems/contract.mjs";
import { dotnet } from "../src/ecosystems/dotnet.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const registry = builtinEcosystems();
const read = (path, text) => registry.read(path, () => text);
const names = (m) => m.dependencies.map((d) => d.name);

const project = (body, sdk = "Some.Sdk") => `<Project Sdk="${sdk}">\n${body}\n</Project>`;

test("a project file: every PackageReference Include, in any attribute order and either quote", () => {
  const m = read("src/Api/Api.csproj", project(`<ItemGroup>
    <PackageReference Include="Alpha.Client" Version="1.0.0" />
    <PackageReference Version="2.0.0" Include='Beta.Client' />
    <PackageReference Include="Gamma.One;Gamma.Two" />
    <PackageReference Update="Delta.Pinned" Version="3.0.0" />
  </ItemGroup>`));
  assert.equal(m.ecosystem, "dotnet");
  assert.equal(m.unit, true);
  assert.deepEqual(names(m), ["Alpha.Client", "Beta.Client", "Gamma.One", "Gamma.Two"], "Update changes a reference; it never makes one");
  assert.ok(m.dependencies.every((d) => d.relationship === "direct"));
});

test("a reference somebody commented out is not a dependency", () => {
  const m = read("App.csproj", project(`<ItemGroup>
    <!-- <PackageReference Include="Old.Thing" Version="1" /> -->
    <PackageReference Include="Kept.Thing" />
  </ItemGroup>`));
  assert.deepEqual(names(m), ["Kept.Thing"]);
});

test("F# and VB project files are the same kind of unit", () => {
  for (const path of ["src/Lib/Lib.fsproj", "src/Old/Old.vbproj"]) {
    const m = read(path, project(`<ItemGroup><PackageReference Include="Shared.Lib" /></ItemGroup>`));
    assert.equal(m.unit, true, path);
    assert.deepEqual(names(m), ["Shared.Lib"], path);
  }
});

test("a condition on the item or its group is carried, never evaluated", () => {
  const m = read("App.csproj", project(`<ItemGroup Condition="'$(Configuration)'=='Debug'"><PackageReference Include="Debug.Only" /></ItemGroup>
  <ItemGroup><PackageReference Include="Always" /><PackageReference Include="Sometimes" Condition="'$(X)'=='1'" /></ItemGroup>`));
  assert.deepEqual(m.dependencies, [
    { name: "Debug.Only", relationship: "direct", conditional: true },
    { name: "Always", relationship: "direct" },
    { name: "Sometimes", relationship: "direct", conditional: true },
  ]);
});

test("Directory.Build.props injects references: IMPORTED, recorded against itself, reaching the subtree", () => {
  const m = read("src/Directory.Build.props", project(`<ItemGroup><PackageReference Include="Analyzer.Pack" /></ItemGroup>`, ""));
  assert.equal(m.unit, false, "a shared build file is inherited, not built");
  assert.equal(m.reach, "subtree");
  assert.equal(m.path, "src/Directory.Build.props");
  assert.deepEqual(m.dependencies, [{ name: "Analyzer.Pack", relationship: "imported" }]);
  assert.equal(read("Directory.Build.targets", project(`<ItemGroup><PackageReference Include="T" /></ItemGroup>`)).dependencies[0].relationship, "imported");
});

// The false positive this adapter exists to refuse.
test("Directory.Packages.props: a PackageVersion is MANAGED and declares nothing", () => {
  const m = read("Directory.Packages.props", project(`<ItemGroup>
    <PackageVersion Include="Vendor.Sdk" Version="5.0.0" />
    <GlobalPackageReference Include="Style.Analyzers" Version="1.0.0" />
  </ItemGroup>`, ""));
  assert.equal(m.unit, false);
  assert.deepEqual(m.dependencies, [{ name: "Vendor.Sdk", relationship: "managed" }, { name: "Style.Analyzers", relationship: "imported" }]);
  assert.equal(declares("managed"), false, "a version made available is not a dependency of anything");
  assert.equal(declares("imported"), true, "a global reference is applied to every project");
});

test("central package management: the project's own versionless reference is the declaration", () => {
  const m = read("src/Api/Api.csproj", project(`<ItemGroup><PackageReference Include="Vendor.Sdk" /></ItemGroup>`));
  assert.deepEqual(m.dependencies, [{ name: "Vendor.Sdk", relationship: "direct" }]);
});

test("TargetFramework and TargetFrameworks are read into targets; a computed one is said, not guessed", () => {
  assert.deepEqual(read("A.csproj", project("<PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>")).targets, ["net8.0"]);
  const multi = read("B.csproj", project("<PropertyGroup><TargetFrameworks> net8.0; net9.0 ;</TargetFrameworks></PropertyGroup>"));
  assert.deepEqual(multi.targets, ["net8.0", "net9.0"]);
  assert.equal(multi.runtime, "dotnet");
  const computed = read("C.csproj", project("<PropertyGroup><TargetFramework>$(DefaultTarget)</TargetFramework></PropertyGroup>"));
  assert.deepEqual(computed.targets, []);
  assert.ok(computed.unknowns.some((u) => /computed from a property/.test(u)));
});

test("an SDK's declared kind is read off its name, and nothing about behaviour is inferred", () => {
  assert.deepEqual(read("Web.csproj", project("", "Vendor.NET.Sdk.Web")).kinds, ["web"]);
  assert.deepEqual(read("Lib.csproj", project("", "Vendor.NET.Sdk")).kinds, []);
  assert.deepEqual(read("W.csproj", `<Project><Sdk Name="Vendor.NET.Sdk.Worker" /></Project>`).kinds, ["worker"]);
});

test("global.json pins the toolchain, and says so when it does not", () => {
  const m = read("global.json", JSON.stringify({ sdk: { version: "8.0.100", rollForward: "latestFeature" } }));
  assert.equal(m.sdk, "8.0.100");
  assert.equal(m.runtime, "dotnet");
  assert.equal(m.reach, "subtree");
  assert.ok(read("global.json", "{}").unknowns.some((u) => /names no version/.test(u)));
  assert.equal(read("global.json", "{ torn").unreadable, true);
});

test("malformed XML is fail-soft: what cannot be read is said, and nothing throws", () => {
  const garbage = read("Broken.csproj", "this is not xml at all <<<");
  assert.equal(garbage.unit, true);
  assert.deepEqual(garbage.dependencies, []);
  assert.ok(garbage.unknowns.some((u) => /no <Project> element/.test(u)));
  const unclosed = read("Torn.csproj", `<Project><ItemGroup><PackageReference Include="Lost.Thing" /></Project>`);
  assert.deepEqual(unclosed.dependencies, []);
  assert.ok(unclosed.unknowns.some((u) => /outside a closed ItemGroup/.test(u)));
});

test("a manifest nothing recognises is no answer at all, never a crash", () => {
  assert.equal(registry.forPath("pom.xml"), null);
  assert.equal(read("pom.xml", "<project/>"), null);
  assert.equal(read("src/readme.txt", "x"), null);
});

test("a secondary checkout's manifest reaches its adapter WITHOUT the namespace", () => {
  const seen = [];
  const spy = { id: "spy", doc: "a spy", detects: (p) => (seen.push(p), p.endsWith(".spy")), parseManifest: (p) => ({ unit: true, dependencies: [{ name: p, relationship: "direct" }] }) };
  const m = createEcosystemRegistry([spy]).read("worker::src/a.spy", () => "x");
  assert.deepEqual(seen, ["src/a.spy"]);
  assert.equal(m.path, "worker::src/a.spy", "the record keeps the namespaced path");
  assert.deepEqual(names(m), ["src/a.spy"]);
});

test("an adapter that throws costs that manifest, with the reason", () => {
  const boom = { id: "boom", doc: "a boom", detects: () => true, parseManifest: () => { throw new Error("torn"); } };
  const m = createEcosystemRegistry([boom]).read("x.boom", () => "x");
  assert.equal(m.unreadable, true);
  assert.match(m.unknowns[0], /the boom adapter could not read x.boom — torn/);
});

test("an adapter's field of the wrong shape is dropped and said, never passed on", () => {
  const sloppy = { id: "sloppy", doc: "sloppy", detects: () => true, parseManifest: () => ({ unit: "yes", targets: "net8.0", dependencies: [{ name: "ok", relationship: "direct" }, { name: 3 }, { name: "x", relationship: "maybe" }], extra: 1 }) };
  const m = createEcosystemRegistry([sloppy]).read("a", () => "x");
  assert.equal(m.unit, false);
  assert.deepEqual(m.targets, []);
  assert.deepEqual(names(m), ["ok"]);
  assert.ok(m.unknowns.some((u) => /returned a unit/.test(u)));
  assert.ok(m.unknowns.some((u) => /2 dependency record\(s\) were not in the shape/.test(u)));
});

test("the registry refuses a duplicate, a malformed adapter, and one with no reader", () => {
  const reg = createEcosystemRegistry([dotnet]);
  assert.throws(() => reg.register({ ...dotnet }, "a project"), /already registered by core/);
  assert.throws(() => reg.register({ id: "Bad Id", doc: "x", detects: () => false, parseManifest: () => null }), /id does not look like/);
  assert.throws(() => reg.register({ id: "half", doc: "x", detects: () => false }), /has no parseManifest\(\)/);
  assert.throws(() => reg.register(null), /an adapter is an object/);
});

test("the relationship table is the one place `declares` is decided", () => {
  assert.deepEqual(RELATIONSHIPS.filter((r) => r.declares).map((r) => r.name), ["direct", "imported"]);
  assert.equal(declares("transitive"), false, "a transitive package is the resolver's decision, not this project's");
});

// The contract and the registry are the CORE of the adapter layer: they name no
// ecosystem at all, so a new one is a registration and never an edit here.
test("the adapter contract and registry name no ecosystem and no format", () => {
  const banned = /\b(dotnet|csproj|nuget|msbuild|packagereference|package\.json|npm|maven|gradle|pom\.xml)\b/i;
  for (const file of ["contract.mjs", "registry.mjs"]) assert.ok(!banned.test(readFileSync(join(ROOT, "src", "ecosystems", file), "utf8")), `src/ecosystems/${file} names an ecosystem`);
});

test("no adapter names a product or a vendor — a format is not a product", () => {
  const banned = /\b(microsoft|azure|aws|postgres|redis|kafka|rabbitmq|sharepoint)\b/i;
  for (const file of readdirSync(join(ROOT, "src", "ecosystems"))) assert.ok(!banned.test(readFileSync(join(ROOT, "src", "ecosystems", file), "utf8")), `src/ecosystems/${file} names a product`);
});

test("a unit says its own name, and the units of its tree it names by path -- either separator, as written", () => {
  const pkg = read("web/package.json", JSON.stringify({ name: "@shop/web", dependencies: { "@shop/contracts": "1" } }));
  assert.equal(pkg.name, "@shop/web");
  assert.deepEqual(pkg.references, []);
  const proj = read("api/Api.csproj", project('<ItemGroup><ProjectReference Include="..\\Lib\\Lib.csproj" /><ProjectReference Include="../Other/Other.fsproj" /></ItemGroup>'));
  assert.deepEqual(proj.references, [{ path: "../Lib/Lib.csproj" }, { path: "../Other/Other.fsproj" }]);
  assert.deepEqual(names(proj), [], "a project reference is not a package");
});

test("a reference record in a shape this engine does not read is dropped and said", () => {
  const custom = createEcosystemRegistry([{ id: "toy", doc: "a toy manifest", detects: (p) => p.endsWith(".toy"), parseManifest: () => ({ unit: true, references: [{ path: "../a" }, { nope: 1 }] }) }]);
  const m = custom.read("x/y.toy", () => "?");
  assert.deepEqual(m.references, [{ path: "../a" }]);
  assert.ok(m.unknowns.some((u) => /1 reference record\(s\) were not in the shape/.test(u)));
});

test("a reference this read cannot evaluate is kept as written, so it resolves to nothing and reads as unknown -- never dropped", () => {
  const proj = read("api/Api.csproj", project('<ItemGroup><ProjectReference Include="$(Root)\\Lib\\Lib.csproj" /></ItemGroup>'));
  assert.deepEqual(proj.references, [{ path: "$(Root)/Lib/Lib.csproj" }]);
  const pkg = read("web/package.json", JSON.stringify({ name: "web", dependencies: { lib: "file:../lib", react: "19" } }));
  assert.deepEqual(pkg.references, [{ path: "../lib" }], "a dependency declared by path is a relation between units");
});
