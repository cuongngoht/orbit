// What the two shipped adapters now say about the RUNTIME a unit needs -- the
// evidence src/runtime/ reads through the ecosystem registry and never from a
// file of its own. The modern runtime and the classic framework are different
// requirements with different names; that is the whole point of these cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { builtinEcosystems } from "../src/ecosystems/builtin.mjs";
import { createEcosystemRegistry } from "../src/ecosystems/registry.mjs";
import { requirementsOf, classified, lowest } from "../src/ecosystems/dotnet-targets.mjs";

const registry = builtinEcosystems();
const read = (path, text) => registry.read(path, () => text);
const csproj = (props, sdk = "Vendor.NET.Sdk", items = "") => `<Project Sdk="${sdk}"><PropertyGroup>${props}</PropertyGroup><ItemGroup>${items}</ItemGroup></Project>`;

test("a modern target is a `dotnet` requirement, at its own version", () => {
  const m = read("api/Api.csproj", csproj("<TargetFramework>net8.0</TargetFramework>"));
  assert.deepEqual(m.requires, { dotnet: ">=8.0" });
  assert.deepEqual(m.targets, ["net8.0"]);
});

test("a classic framework target -- compact or versioned -- is a DIFFERENT requirement, never `dotnet`", () => {
  assert.deepEqual(read("a.csproj", csproj("<TargetFramework>net48</TargetFramework>")).requires, { "dotnet-framework": ">=4.8" });
  assert.deepEqual(read("a.csproj", csproj("<TargetFrameworkVersion>v4.8</TargetFrameworkVersion>")).requires, { "dotnet-framework": ">=4.8" });
  assert.deepEqual(read("a.csproj", csproj("<TargetFramework>net472</TargetFramework>")).requires, { "dotnet-framework": ">=4.7.2" });
  assert.deepEqual(read("a.csproj", csproj("<TargetFrameworkVersion>v4.8</TargetFrameworkVersion>")).targets, ["v4.8"]);
});

test("a unit that targets both is held to the modern one only, and says so", () => {
  const m = read("a.csproj", csproj("<TargetFrameworks>net48;net8.0</TargetFrameworks>"));
  assert.deepEqual(m.requires, { dotnet: ">=8.0" });
  assert.ok(m.unknowns.some((u) => /also targets the classic framework/.test(u)));
});

test("several modern targets are held to the lowest; a library target and an unknown one are said, not counted", () => {
  assert.deepEqual(read("a.csproj", csproj("<TargetFrameworks>net9.0;net8.0</TargetFrameworks>")).requires, { dotnet: ">=8.0" });
  const lib = read("lib.csproj", csproj("<TargetFramework>netstandard2.0</TargetFramework>"));
  assert.deepEqual(lib.requires, {});
  assert.ok(lib.unknowns.some((u) => /library target/.test(u)));
  assert.ok(read("x.csproj", csproj("<TargetFramework>uap10.0</TargetFramework>")).unknowns.some((u) => /does not recognise/.test(u)));
});

test("a modern target that names Windows, with none that names no platform, is Windows's alone -- another platform is said", () => {
  const only = read("w.csproj", csproj("<TargetFramework>net8.0-windows</TargetFramework>"));
  assert.deepEqual([only.requires, only.unknowns.some((u) => /names a platform/.test(u))], [{ "dotnet-windows": ">=8.0" }, false]);
  const both = read("w.csproj", csproj("<TargetFrameworks>net8.0;net8.0-windows</TargetFrameworks>"));
  assert.deepEqual(both.requires, { dotnet: ">=8.0" }, "a target without a platform runs anywhere, so it is the one held");
  const mobile = read("m.csproj", csproj("<TargetFramework>net8.0-android</TargetFramework>"));
  assert.deepEqual(mobile.requires, { dotnet: ">=8.0" });
  assert.ok(mobile.unknowns.some((u) => /names a platform \(android\)/.test(u)));
  const classic = read("w.csproj", csproj("<TargetFrameworks>net8.0-windows;net48</TargetFrameworks>"));
  assert.deepEqual(classic.requires, { "dotnet-windows": ">=8.0" });
  assert.ok(classic.unknowns.some((u) => /also targets the classic framework/.test(u)));
});

test("a shared build file says what its target REQUIRES, as a default for the units beneath it", () => {
  const shared = (name, props) => read(name, `<Project><PropertyGroup>${props}</PropertyGroup></Project>`);
  const modern = shared("backend/Directory.Build.props", "<TargetFramework>net10.0</TargetFramework>");
  assert.deepEqual([modern.unit, modern.reach, modern.requires, modern.targets], [false, "subtree", { dotnet: ">=10.0" }, ["net10.0"]]);
  assert.deepEqual(shared("Directory.Build.targets", "<TargetFrameworkVersion>v4.8</TargetFrameworkVersion>").requires, { "dotnet-framework": ">=4.8" });
  assert.deepEqual(read("backend/Directory.Build.props", `<Project><ItemGroup><PackageReference Include="Serilog" /></ItemGroup></Project>`).requires, {}, "a file that sets no target requires nothing");
  assert.ok(shared("Directory.Build.props", "<TargetFrameworks>net48;net8.0</TargetFrameworks>").unknowns.some((u) => /also targets the classic framework/.test(u)));
});

test("versions compare part by part: 4.7.2 is below 4.8 and 5.0 below 10.0", () => {
  assert.equal(lowest(["4.8", "4.7.2"]), "4.7.2");
  assert.equal(lowest(["10.0", "5.0"]), "5.0");
  assert.deepEqual(classified(["net6.0", "netcoreapp3.1", "net461"]), { modern: ["6.0", "3.1"], windows: [], framework: ["4.6.1"], standard: [], other: [] });
  assert.deepEqual(requirementsOf([]), { requires: {}, unknowns: [] });
});

test("a test project is DECLARED by a property or by the package that makes it one -- and no command is invented for it", () => {
  const byProperty = read("t/T.csproj", csproj("<TargetFramework>net8.0</TargetFramework><IsTestProject>true</IsTestProject>"));
  const byPackage = read("t/T.csproj", csproj("<TargetFramework>net8.0</TargetFramework>", "Vendor.NET.Sdk", `<PackageReference Include="Vendor.NET.Test.Sdk" Version="1" />`));
  assert.deepEqual([byProperty.kinds, byPackage.kinds], [["test"], ["test"]]);
  assert.deepEqual([byProperty.commands, byPackage.commands], [[], []]);
  assert.deepEqual(read("a/A.csproj", csproj("<TargetFramework>net8.0</TargetFramework>")).kinds, []);
});

test("launch settings: each runnable profile is a `start:<name>` command, its ports are read, the rest is said", () => {
  const settings = { profiles: { http: { commandName: "Project", applicationUrl: "http://localhost:5001;https://localhost:7001" }, "IIS Express": { commandName: "IISExpress" }, "a b": { commandName: "Project", applicationUrl: "http://localhost:5900" }, noUrl: { commandName: "Project" } } };
  const m = read("api/Properties/launchSettings.json", JSON.stringify(settings));
  assert.equal(m.ecosystem, "dotnet");
  assert.equal(m.unit, false);
  const how = { kind: "argv", after: "--", flag: "--urls", format: "http://127.0.0.1:{port}" };
  assert.deepEqual(m.commands, [["start:http", "dotnet run --launch-profile http", [5001, 7001], how], ["start:noUrl", "dotnet run --launch-profile noUrl", [], how]], "each command carries the ports ITS profile listens on, and how it is told another");
  assert.deepEqual(m.ports, [5001, 7001]);
  assert.ok(m.unknowns.some((u) => /1 launch profile\(s\) do not run the project itself/.test(u)));
  assert.ok(m.unknowns.some((u) => /1 launch profile name\(s\) cannot be carried/.test(u)));
});

test("launch settings that are not JSON, or not an object, are an unreadable manifest and nothing else", () => {
  assert.equal(read("Properties/launchSettings.json", "{ torn").unreadable, true);
  assert.equal(read("Properties/launchSettings.json", "[]").unreadable, true);
});

test("the node adapter reads a package.json anywhere outside node_modules, and says what `workspaces` leaves unread", () => {
  const root = JSON.stringify({ name: "mono", workspaces: ["apps/*"], scripts: { dev: "turbo dev" }, engines: { node: ">=22" } });
  assert.equal(read("package.json", root).unit, true);
  assert.deepEqual(read("apps/web/package.json", JSON.stringify({ scripts: { dev: "vite" } })).commands, [["dev", "vite"]]);
  assert.ok(read("package.json", root).unknowns.some((u) => /declares workspaces/.test(u)));
  assert.equal(read("node_modules/x/package.json", "{}"), null);
  assert.equal(read("apps/web/node_modules/x/package.json", "{}"), null);
  assert.deepEqual(read("package.json", root).requires, { node: ">=22" });
});

test("a manifest can declare the ports it listens on; a list with a non-integer in it is dropped whole, and said", () => {
  const adapter = (ports) => ({ id: "probe", doc: "a probe", detects: () => true, parseManifest: () => ({ ports }) });
  const good = createEcosystemRegistry([adapter([8080, 9090])]).read("x", () => "");
  const bad = createEcosystemRegistry([adapter([8080, "9090"])]).read("x", () => "");
  assert.deepEqual(good.ports, [8080, 9090]);
  assert.deepEqual(bad.ports, []);
  assert.ok(bad.unknowns.some((u) => /returned a ports this engine does not accept/.test(u)));
});

test("an old-style project that declares a window program (WinExe) is a desktop unit -- not a library -- and a plain one stays unclassified", () => {
  const classic = (type) => `<Project ToolsVersion="15.0"><PropertyGroup><OutputType>${type}</OutputType><TargetFrameworkVersion>v4.8</TargetFrameworkVersion></PropertyGroup></Project>`;
  assert.deepEqual(read("legacy/Legacy.csproj", classic("WinExe")).kinds, ["desktop"]);
  assert.deepEqual(read("legacy/Legacy.csproj", classic("Library")).kinds, []);
  assert.deepEqual(read("legacy/Legacy.csproj", classic("Exe")).kinds, [], "a console program is not claimed to be anything: whether it is long-running is not in the file");
  assert.deepEqual(read("app/App.csproj", '<Project Sdk="Vendor.NET.Sdk"><PropertyGroup><OutputType>WinExe</OutputType><TargetFramework>net8.0-windows</TargetFramework><UseWPF>true</UseWPF></PropertyGroup></Project>').kinds, ["desktop"]);
});

test("an old-style project filed under the WEB APPLICATION project type is a web unit -- its library output is hosted, not a library to use", () => {
  const classic = (guids) => `<Project ToolsVersion="15.0"><PropertyGroup><ProjectTypeGuids>${guids}</ProjectTypeGuids><OutputType>Library</OutputType><TargetFrameworkVersion>v4.8</TargetFrameworkVersion></PropertyGroup></Project>`;
  assert.deepEqual(read("legacy/Legacy.Web.csproj", classic("{349c5851-65df-11da-9384-00065b846f21};{fae04ec0-301f-11d3-bf4b-00c04f79efbc}")).kinds, ["web"]);
  assert.deepEqual(read("legacy/Legacy.Web.csproj", classic("{349C5851-65DF-11DA-9384-00065B846F21}")).kinds, ["web"], "the GUID in either case");
  assert.deepEqual(read("legacy/Legacy.csproj", classic("{fae04ec0-301f-11d3-bf4b-00c04f79efbc}")).kinds, [], "the C# language type alone says nothing of what the project is");
});

test("a launch profile URL with no port names its scheme's own, and several are all declared", () => {
  const ports = (url) => read("api/Properties/launchSettings.json", JSON.stringify({ profiles: { http: { commandName: "Project", applicationUrl: url } } })).ports;
  assert.deepEqual(ports("http://localhost"), [80]);
  assert.deepEqual(ports("https://localhost"), [443]);
  assert.deepEqual(ports("http://localhost:5000;https://localhost:5001"), [5000, 5001]);
});
