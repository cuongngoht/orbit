import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { COMMANDS, COMMAND_NAMES } from "../src/intelligence/index.mjs";
import { sealed } from "./home.mjs";
import { SHAREPOINT } from "./fixtures/intelligence/sharepoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const temp = (tag) => mkdtempSync(join(tmpdir(), `orbit-${tag}-`));

// A COMMITTED checkout, for the reason test/architecture-cli.test.mjs gives:
// an uncommitted edit makes a scope unknown, so pointing at this repository's
// own fixtures would test the state of somebody's afternoon.
function project() {
  const dir = temp("intel-project");
  const files = { ...SHAREPOINT, "ui-tests/project.json": JSON.stringify({ name: "demo", origin: "https://demo.test" }), "ui-tests/graph/meta.json": JSON.stringify({ schema: 2 }), "ui-tests/graph/screens.json": "[]", "ui-tests/graph/edges.json": "[]", "ui-tests/graph/effects.json": "[]" };
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, dirname(p)), { recursive: true });
    writeFileSync(join(dir, p), text);
  }
  for (const args of [["init", "-q", "."], ["add", "-A"], ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]]) spawnSync("git", args, { cwd: dir });
  return dir;
}

const PROJECT = project();

const intel = (args, store) => spawnSync(process.execPath, [join(ROOT, "cli", "intelligence.mjs"), ...args], { encoding: "utf8", cwd: PROJECT, env: sealed({ ORBIT_UI_TESTS: join(PROJECT, "ui-tests"), ORBIT_STORE_DIR: store }) });

const ARGS = {
  ensure: ["ensure"],
  scan: ["scan"],
  facts: ["facts"],
  why: ["why", "microsoft-graph"],
  ecosystems: ["ecosystems"],
  dependencies: ["dependencies", "--unmatched"],
  technologies: ["technologies"],
  integrations: ["integrations"],
  wiring: ["wiring"],
  resolve: ["resolve", "read", "sharepoint", "list"],
  propose: ["propose", "--dry"],
  descriptors: ["descriptors"],
  where: ["where"],
};

test("every command is exercised here, and says what it writes", () => {
  for (const name of COMMAND_NAMES) assert.ok(ARGS[name], `${name} is in the table but not exercised below`);
  for (const name of COMMAND_NAMES) assert.ok(["nothing", "store", "engineering"].includes(COMMANDS[name].writes), `${name} does not declare what it writes`);
});

function snapshot(dir, out = {}) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) snapshot(p, out);
    else out[p] = `${statSync(p).size}:${statSync(p).mtimeMs}`;
  }
  return out;
}

const status = (dir) => spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" }).stdout;

test("no intelligence command modifies the project it reads, or the plugin reading it", () => {
  const store = temp("intel-store");
  const before = { project: snapshot(PROJECT), plugin: snapshot(ROOT), git: status(PROJECT) };
  for (const name of COMMAND_NAMES) assert.notEqual(intel(ARGS[name], store).status, 1, `${name} exited 1`);
  assert.equal(status(PROJECT), before.git);
  assert.deepEqual(snapshot(PROJECT), before.project);
  assert.deepEqual(snapshot(ROOT), before.plugin);
});

test("memory first: a second ensure is CURRENT and reads nothing", () => {
  const store = temp("intel-store");
  const first = intel(["ensure"], store);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /INTELLIGENCE BOOTSTRAP/);
  const second = intel(["ensure"], store);
  assert.match(second.stdout, /INTELLIGENCE CURRENT/);
  assert.match(second.stdout, /skipped — the snapshot answers this/);
});

test("a dry ensure writes nothing, not even the store", () => {
  const store = temp("intel-store");
  const dry = intel(["ensure", "--dry"], store);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /--dry: \d+ fact\(s\) would be recorded/);
  assert.deepEqual(readdirSync(store), []);
});

test("the views say what the code does, per system and operation", () => {
  const store = temp("intel-store");
  intel(["ensure"], store);
  const integrations = intel(["integrations"], store).stdout;
  assert.match(integrations, /sharepoint\/files\s+microsoft-graph/);
  assert.match(integrations, /sharepoint\/lists\s+sharepoint-csom/);
  assert.match(intel(["technologies", "microsoft-graph"], store).stdout, /used-for\s+sharepoint\/files/);
  assert.match(intel(["dependencies", "--unmatched"], store).stdout, /Acme\.Internal\.Widgets/);
  assert.match(intel(["wiring"], store).stdout, /IGraphDriveService\s+-> GraphDriveService\s+microsoft-graph/);
});

test("resolve answers with a decision and its evidence, as text or JSON", () => {
  const store = temp("intel-store");
  intel(["ensure"], store);
  const json = JSON.parse(intel(["resolve", "read", "sharepoint", "list", "--json"], store).stdout);
  assert.deepEqual([json.decision, json.technology], ["build", "sharepoint-csom"]);
  assert.ok(json.evidence.includes("src/Infrastructure/SharePoint/CsomListService.cs"));
});

test("a project's own descriptor, as data in the store, is recognised — and a bad one is refused out loud", () => {
  const store = temp("intel-store");
  intel(["where"], store);
  const room = /your own\s+(\S+)/.exec(intel(["where"], store).stdout)[1];
  mkdirSync(room, { recursive: true });
  writeFileSync(join(room, "acme.json"), JSON.stringify({ id: "acme-widgets", category: "sdk", matchers: [{ ecosystem: "dotnet", dependency: "Acme.Internal.*" }] }));
  writeFileSync(join(room, "broken.json"), "{ not json");
  writeFileSync(join(room, "clash.json"), JSON.stringify({ id: "microsoft-graph", category: "sdk", matchers: [{ ecosystem: "dotnet", dependency: "X" }] }));
  const described = intel(["descriptors"], store).stdout;
  assert.match(described, /1 loaded, 2 refused/);
  assert.match(described, /already registered by orbit-dotnet-intelligence/);
  intel(["ensure"], store);
  assert.match(intel(["technologies", "acme-widgets"], store).stdout, /technology: acme-widgets/);
});

test("it never exits 1 — 0 done, 2 refused", () => {
  const store = temp("intel-store");
  assert.equal(intel(["why", "intel-nothing-00000000"], store).status, 2);
  assert.equal(intel(["resolve"], store).status, 2, "no intent is bad usage");
  assert.equal(intel([], store).status, 0, "no command prints the help");
  assert.match(intel([], store).stdout, /PROJECT INTELLIGENCE/);
});
