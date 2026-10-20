import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { UI_TESTS, fixtureProject } from "./fakes/context.mjs";
import { storeRootIn } from "./fakes/store.mjs";
import { verifies } from "../src/qa/vocab.mjs";
import { sealed } from "./home.mjs";

// Every CLI under cli/ was covered only through the functions it wraps, so argv
// parsing, usage text and EXIT CODES had no test at all -- and the exit code is
// the entire interface for CI and for an agent. These spawn the real thing.
const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli");

const run = (script, args, uiTests = UI_TESTS) =>
  spawnSync(process.execPath, [join(CLI, script), ...args], { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: uiTests }) });

// A copy of the fixture project, so a deliberately broken map stays contained.
function brokenProject(change) {
  const dir = join(mkdtempSync(join(tmpdir(), "orbit-cli-")), "ui-tests");
  cpSync(UI_TESTS, dir, { recursive: true });
  change(dir);
  return dir;
}

test("query check exits 0 on a clean project and non-zero on a hard finding", () => {
  const clean = run("query.mjs", ["check"]);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /screens, .*controls/);

  const broken = brokenProject((dir) =>
    writeFileSync(join(dir, "graph", "edges.json"), JSON.stringify([{ from: "nowhere", via: "Gone", kind: "button", selector: "x", opens: "none" }])));
  const bad = run("query.mjs", ["check"], broken);
  assert.equal(bad.status, 1, "a dangling edge has to fail the command CI runs");
  assert.match(bad.stdout, /dangling from: nowhere/);
  assert.match(bad.stdout, /\d+ hard finding\(s\)/);
});

// An advisory is a heuristic. It must never be able to break a build.
test("query check stays 0 when only advisories print", () => {
  const r = run("query.mjs", ["check"]);
  assert.match(r.stdout, /declare no identity/, "the fixture does print advisories");
  assert.equal(r.status, 0);
});

test("run-case maps each outcome to the exit code its callers branch on", () => {
  assert.equal(run("run-case.mjs", ["create-thing", "NAME=TC-1", "--dry"]).status, 0, "a dry run");

  const noParam = run("run-case.mjs", ["create-thing", "--dry"]);
  assert.equal(noParam.status, 2, "a missing required param is REFUSED");
  assert.match(noParam.stderr, /missing param NAME/);

  const noCase = run("run-case.mjs", ["nope"]);
  assert.equal(noCase.status, 2);
  assert.match(noCase.stderr, /no case nope/);

  const badSlice = run("run-case.mjs", ["create-thing", "NAME=TC-1", "--from=abc", "--dry"]);
  assert.equal(badSlice.status, 2);
  assert.match(badSlice.stderr, /--from=abc is not a step number/);
});

test("the five-lines checker fails on a violation and says where", () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-lint-"));
  writeFileSync(join(dir, "bad.mjs"), "function f() {\n  const a = 1;\n  const b = 2;\n  const c = 3;\n  const d = 4;\n  const e = 5;\n  return a + b + c + d + e;\n}\n");
  const r = spawnSync(process.execPath, [join(CLI, "check-five-lines.mjs"), dir, "--strict"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /6 statements/);

  const clean = spawnSync(process.execPath, [join(CLI, "check-five-lines.mjs"), "src", "cli", "skills", "--strict"], { encoding: "utf8" });
  assert.equal(clean.status, 0, clean.stdout);
  assert.match(clean.stdout, /0 finding\(s\)/);
});

test("schema.mjs prints the generated schema, and the copy on disk matches it", () => {
  const printed = run("schema.mjs", []);
  assert.equal(printed.status, 0);
  assert.deepEqual(JSON.parse(printed.stdout).title, "UI test case (orbit)");
  assert.ok(JSON.parse(printed.stdout).definitions.step.properties.into, "into is published to the editor");
});

// schemaDrift compared the file on disk BYTE for byte against a freshly
// generated string, so every CRLF checkout reported drift that was not there --
// and after 2.0.0 that means `check` exits 1 on a clean clone.
test("a CRLF checkout of the generated schema is not reported as drift", () => {
  const dir = brokenProject((d) => {
    const file = join(d, "schema", "case.schema.json");
    writeFileSync(file, readFileSync(file, "utf8").replace(/\r?\n/g, "\r\n"));
  });
  const r = run("query.mjs", ["check"], dir);
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /out of date with the DSL/);
});

// A gate stop leaves EVIDENCE ABOUT THE MACHINE, and it used to leave none.
// Nothing was observed about the product -- which is why REFUSED can never
// raise coverage -- but "this laptop refuses twice a week" is a fact a team
// needs, and its only trace was a line in a terminal that scrolled away.
test("a run stopped by a gate is recorded, marked as a gate stop, and verifies nothing", () => {
  const store = mkdtempSync(join(tmpdir(), "orbit-gate-"));
  const stopped = spawnSync(process.execPath, [join(CLI, "run-case.mjs"), "create-thing", "--dry"],
    { encoding: "utf8", env: sealed({ ORBIT_UI_TESTS: UI_TESTS, ORBIT_STORE_DIR: store }) });
  assert.equal(stopped.status, 2, "a missing param is REFUSED, and that has not changed");
  assert.match(stopped.stderr, /missing param NAME/);

  const [line] = readdirSync(join(storeRootIn(store, fixtureProject()), "runs")).map((f) =>
    JSON.parse(readFileSync(join(storeRootIn(store, fixtureProject()), "runs", f), "utf8").trim()));
  assert.equal(line.status, "REFUSED");
  assert.equal(line.stoppedBy, "gate", "so nothing reads it as a product verdict");
  assert.equal(line.case, "create-thing", "what was ASKED for — a stop can happen before a case is even found");
  assert.equal(line.done, 0);
  assert.ok(!verifies(line.status), "and it may never raise coverage");
});
