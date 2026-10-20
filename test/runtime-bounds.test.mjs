// What a checkout can make discovery COST. Every file discovery reads is the checkout's to write, so
// a line, a file or a directory built to be slow must not be: each reader's work is linear in what it
// reads, and how many files a scan reads is bounded. The assertions are generous about time (an
// order of magnitude or more over a healthy run) so they hold on a slow machine, and each input was
// minutes or hours long before the reader it exercises was made linear.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sealed } from "./home.mjs";
import { MAX_EVIDENCE_FILES, evidenceOf } from "../src/runtime/discover/readers/index.mjs";
import { parseYaml } from "../src/runtime/discover/yaml-lite.mjs";
import { parse } from "../src/runtime/jsonc.mjs";
import { builtinEcosystems } from "../src/ecosystems/builtin.mjs";
import { SHIPPED_CATALOG, discovered } from "./fakes/runtime.mjs";

const quickly = (ms, fn) => {
  const at = Date.now();
  const out = fn();
  assert.ok(Date.now() - at < ms, `took ${Date.now() - at} ms, the bound is ${ms}`);
  return out;
};

test("a recipe line that is a name and a long run of spaces is read in linear time, and real recipes still read", () => {
  const hostile = `a${" ".repeat(20000)}b\nbuild:\n\techo\n`;
  const { out } = quickly(3000, () => discovered({ justfile: hostile }));
  assert.deepEqual(out.facts.filter((f) => f.kind === "command").map((f) => f.declaredAs), ["build"]);
  const real = discovered({ justfile: "set shell := [\"bash\", \"-c\"]\nbuild target:\n  echo\ntest: build\n  echo\nalias t := test\n" });
  assert.deepEqual(real.out.facts.filter((f) => f.kind === "command").map((f) => f.declaredAs).sort(), ["build", "test"]);
});

test("a make target line of spaces and names is read in linear time", () => {
  const hostile = `build ${"x ".repeat(8000)}\nbuild:\n\techo\n`;
  quickly(3000, () => discovered({ Makefile: hostile }));
});

test("a flow collection that runs over thousands of lines is read in linear time, and one never closed stops at a bound", () => {
  const long = `tasks:\n  build:\n    cmds: [${"\n      a,".repeat(30000)}\n    ]\n`;
  const read = quickly(3000, () => parseYaml(long));
  assert.ok(read.value, "it still reads");
  const never = `x: [${"\n  a,".repeat(5000)}`;
  assert.ok(quickly(3000, () => parseYaml(never)) !== undefined);
});

test("an object with tens of thousands of keys is parsed in linear time, and a duplicate key is still found", () => {
  const keys = Array.from({ length: 60000 }, (_, i) => `"k${i}": ${i}`).join(",\n");
  const done = quickly(3000, () => parse(`{ ${keys} }`));
  assert.equal(done.ok, true);
  const twice = quickly(3000, () => parse(`{ ${keys}, "k7": 1 }`));
  assert.equal(twice.ok, false);
  assert.match(twice.error, /the key "k7" is there twice/);
});

test("how many evidence files one scan reads is bounded, the bound is the same for the read and for the check for what moved, and what was left out is said", () => {
  const files = Object.fromEntries(Array.from({ length: MAX_EVIDENCE_FILES + 150 }, (_, i) => [`svc${String(i).padStart(4, "0")}/Dockerfile`, "FROM scratch\n"]));
  const { out, input } = discovered(files);
  assert.equal(out.inventory.length, MAX_EVIDENCE_FILES);
  assert.deepEqual(out.inventory, evidenceOf(input.files, input), "what the read recorded is what the check compares against");
  assert.ok(out.gaps.some((g) => /150 evidence file\(s\) past the 1000 a checkout keeps were not read/.test(g)));
  assert.equal(builtinEcosystems().ids().length > 0 && SHIPPED_CATALOG.digest.length > 0, true);
});

// A reader that loops forever cannot be timed from inside the process that is looping, so these ask a
// child process, with a deadline: a regression is a failed test and never a hung suite.
const YAML = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "src", "runtime", "discover", "yaml-lite.mjs")).href;

function parsedInChild(text) {
  const code = `import { readFileSync } from "node:fs"; import { parseYaml } from ${JSON.stringify(YAML)}; process.stdout.write(JSON.stringify(parseYaml(readFileSync(0, "utf8"))));`;
  const run = spawnSync(process.execPath, ["--input-type=module", "-e", code], { input: text, timeout: 5000, encoding: "utf8", maxBuffer: 1 << 22, env: sealed() });
  assert.equal(run.error, undefined, `it did not come back in time: ${run.error?.code}`);
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test("a closer of the wrong kind inside a flow collection is skipped and said -- it can never keep a loop at one place", () => {
  const cases = [["ports: [}", { ports: [] }], ["a: {]", { a: {} }], ["ports: [a, b}", { ports: ["a", "b"] }], ["a: {b: c]", { a: { b: "c" } }], ["a: [x, {y: [z}]", { a: ["x", { y: ["z"] }] }]];
  for (const [text, value] of cases) {
    const read = parsedInChild(text);
    assert.deepEqual(read.value, value, text);
    assert.ok(read.notes.some((n) => /closes nothing/.test(n)), `${text}: it says what it skipped`);
  }
});

test("a file built to nest deeply is cut at a depth and said, in flow and in block form, and the reader still never throws", () => {
  const nests = {
    "flow brackets": `a: ${"[".repeat(200000)}`,
    "flow braces": `a: ${"{a: ".repeat(50000)}`,
    "a chain of dashes": `${"- ".repeat(200000)}x`,
    "indentation": Array.from({ length: 1500 }, (_, i) => `${" ".repeat(i)}k${i}:`).join("\n"),
  };
  for (const [name, text] of Object.entries(nests)) {
    const read = quickly(3000, () => parseYaml(text));
    assert.ok(read.notes.some((n) => /deeper than \d+ levels was not read/.test(n)), `${name}: it says what it dropped`);
  }
  const real = parseYaml("services:\n  web:\n    image: nginx:1.27\n    ports: [\"8080:80\", 9090]\n    environment: {A: 1, B: [x, y]}\n");
  assert.deepEqual(real.notes, [], "a real file says nothing of the kind");
  assert.deepEqual(real.value.services.web.environment, { A: 1, B: ["x", "y"] });
});

test("an MSBuild file built so that nothing it opens ever closes is read in linear time, and a real one reads exactly as before", () => {
  const manifests = builtinEcosystems();
  const big = (unit) => `<Project>${unit.repeat(Math.floor((512 * 1024) / unit.length))}`;
  const hostile = ["<!--", "<ItemGroup ", "<ItemGroup>", "<PackageReference ", "<Sdk ", '<Project Sdk="', "<TargetFramework "].map(big);
  for (const text of [...hostile, `<Project><Sdk ${"x".repeat(500000)} /></Project>`]) quickly(3000, () => manifests.read("api/Api.csproj", () => text));
  const real = manifests.read("api/Api.csproj", () => `<Project Sdk="Vendor.NET.Sdk.Web"><!-- <PackageReference Include="Gone" Version="1" /> --><ItemGroup Condition="'$(X)' == 'y'"><PackageReference Include="Kept" Version="1" /></ItemGroup><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup></Project>`);
  assert.deepEqual([real.dependencies.map((d) => [d.name, d.conditional === true]), real.targets], [[["Kept", true]], ["net8.0"]]);
});
