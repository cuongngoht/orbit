import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fromEnv } from "../src/project/env.mjs";
import { loadProject } from "../src/project/index.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { readAutomation, writeAutomation } from "../src/automation/settings.mjs";
import { loadExtensions } from "../src/extensions/loader.mjs";
import { emptyRegistries } from "../src/extensions/registries.mjs";
import { caseInPage } from "../src/case-block.mjs";
import { providerProblems } from "../src/runtime/providers/contract-v1.mjs";
import { native } from "../src/runtime/providers/native.mjs";
import { readState, writeState } from "../src/store/control.mjs";
import { readSpec } from "../src/goal/spec.mjs";
import { createGeneratedSkills } from "../src/skill-factory/store.mjs";
import { currentJournal } from "../src/memory/journal.mjs";
import { realIo } from "../src/store/io.mjs";
import { canonical } from "../skills/orbit-sql/settings.mjs";
import { sealed } from "./home.mjs";

const REJECTED_ENV = { LEGACY_STORE_DIR: "/ignored", LEGACY_UI_TESTS: "/ignored", ORBIT_LEARN_DIR: "/ignored", ORBIT_MEMORY_DIR: "/ignored" };
const REJECTED_HOME = ".legacy";
const REJECTED_API = "legacy.extension/v1";
const REJECTED_CAP_API = "legacy.capability/v1";
const REJECTED_CASE = '<pre id="legacy-case">{"id":"x"}</pre>';
const REJECTED_SQL = "LEGACY_SQL_SERVER";
const ROOT = resolve(".");

function room(t) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-current-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const cli = (cwd, env, command, args = [], input) => spawnSync(process.execPath, [join(ROOT, "cli", `${command}.mjs`), ...args], { cwd, env, input, encoding: "utf8" });

test("a fresh HOME initializes a project, persists a current goal, and reads it back", (t) => {
  const dir = room(t);
  const repo = join(dir, "repo");
  const home = join(dir, "home");
  mkdirSync(home);
  execFileSync("git", ["init", "-q", repo]);
  const env = sealed({ HOME: home, USERPROFILE: home, ORBIT_STORE_DIR: join(dir, "store") });
  for (const args of [["--help"], ["--version"], ["doctor", "--json"]]) {
    const r = cli(repo, env, "orbit", args);
    assert.equal(r.status, 0, r.stderr + r.stdout);
  }
  const init = cli(repo, env, "init", [repo]);
  assert.equal(init.status, 0, init.stderr);
  const project = loadProject(env, repo);
  assert.equal(project.layout, 3);
  assert.equal(project.dataHome, "store");
  assert.deepEqual(readdirSync(repo), [".git"]);
  const start = cli(repo, env, "orbit", ["goal", "start", "--stdin", "--json"], "Verify the declared checks\nAcceptance: declared checks pass.\n");
  assert.equal(start.status, 0, start.stderr);
  const goal = JSON.parse(start.stdout);
  const status = cli(repo, env, "orbit", ["goal", "status", goal.id, "--json"]);
  assert.equal(status.status, 0, status.stderr);
  const spec = JSON.parse(readFileSync(join(project.storeRoot, "goals", goal.id, "spec.json"), "utf8"));
  assert.equal(spec.api, "orbit.goal/v1");
  assert.ok(spec.body.includes("Acceptance"));
  assert.equal(JSON.parse(readFileSync(join(project.dataRoot, "project.json"), "utf8")).name, "repo");
});

test("only current environment names and an explicit data location affect project resolution", (t) => {
  const dir = room(t);
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo]);
  mkdirSync(join(dir, REJECTED_HOME));
  writeFileSync(join(dir, REJECTED_HOME, "sql.env"), "poison");
  const env = sealed({ ORBIT_STORE_DIR: join(dir, "store") });
  const expected = loadProject(env, repo);
  assert.deepEqual(loadProject({ ...env, ...REJECTED_ENV }, repo), expected);
  assert.equal(storeBase({ ...env, ...REJECTED_ENV }), storeBase(env));
  assert.equal(fromEnv(REJECTED_ENV, "STORE_DIR"), undefined);
  assert.equal(canonical(REJECTED_SQL), null);
  assert.equal(canonical("SQL_SERVER"), null);
  assert.equal(canonical("ORBIT_SQL_SERVER"), "SERVER");
  assert.ok(caseInPage(REJECTED_CASE, "report.html")._broken);
  const homeEnv = sealed({ HOME: dir, USERPROFILE: dir, ...REJECTED_ENV });
  delete homeEnv.ORBIT_STORE_DIR;
  const current = cli(repo, homeEnv, "orbit", ["doctor", "--json"]);
  assert.equal(current.status, 0, current.stderr);
  assert.ok(JSON.parse(current.stdout).store.startsWith(join(dir, ".orbit", "projects")));
  assert.equal(readFileSync(join(dir, REJECTED_HOME, "sql.env"), "utf8"), "poison");

});

test("unsupported extension APIs are refused before importing any declared code", async (t) => {
  const dir = room(t);
  const marker = join(dir, "executed");
  writeFileSync(join(dir, "capabilities.mjs"), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); export default [];`);
  for (const apiVersion of [REJECTED_API, "orbit.extension/v1", "orbit.extension/v99"]) {
    const registries = emptyRegistries();
    const tools = { ids: () => ["probe"], readManifest: () => JSON.stringify({ id: "probe", version: "1.0.0", apiVersion, status: "active", capabilities: "./capabilities.mjs" }), dirOf: () => dir };
    const result = await loadExtensions(registries, { tools });
    assert.equal(result.loaded.length, 0);
    assert.equal(result.refused.length, 1);
    assert.equal(existsSync(marker), false);
    assert.deepEqual(registries.capabilities.list(), []);
  }
  const capabilities = emptyRegistries().capabilities;
  assert.throws(() => capabilities.register({ id: "probe.read", apiVersion: REJECTED_CAP_API, doc: "probe", invoke: () => null }), /apiVersion/);
  assert.ok(providerProblems({ ...native, apiVersion: "orbit.runtime-provider/v99" }).length);
});

test("invalid state is never converted, backed up or overwritten", (t) => {
  const dir = room(t);
  const file = join(dir, "settings.json");
  const io = realIo();
  for (const text of ['{bad', '{"schema":1,"enabled":false}', '{"schema":3,"mode":"supervised"}', '{"schema":99}']) {
    writeFileSync(file, text);
    assert.throws(() => readAutomation(io, file));
    assert.throws(() => writeAutomation(io, file, { execution: { maxAttempts: 2 } }, { door: "control", revision: null }));
    assert.equal(readFileSync(file, "utf8"), text);
  }
  writeFileSync(file, '{"schema":999}');
  assert.throws(() => readState(io, file, {}));
  assert.throws(() => writeState(io, file, {}));
  assert.deepEqual(readdirSync(dir), ["settings.json"]);
});

test("removed commands and options are rejected before reading project state", (t) => {
  const dir = room(t);
  const env = sealed({ ORBIT_STORE_DIR: join(dir, "store") });
  for (const [command, args] of [["orbit", ["goal", "start", "--migrate", "x"]], ["mcp", ["migrate"]], ["mcp", ["list", "--dry"]], ["project-report", ["import", "missing.json"]], ["project-report", ["status", "--import=missing.json"]]]) {
    const r = cli(dir, env, command, args);
    assert.equal(r.status, 2, `${command}: ${r.stderr}`);
    assert.equal(existsSync(join(dir, "store")), false);
  }
});

test("unsupported goal specifications and journal versions remain unchanged", (t) => {
  const dir = room(t);
  const file = join(dir, "spec.json");
  for (const text of ["null", "{bad", '{"api":"orbit.goal/v99","body":"x"}', '{"api":"orbit.goal/v1","body":"x","migration":true}']) {
    writeFileSync(file, text);
    assert.throws(() => readSpec(realIo(), dir), /specification/);
    assert.equal(readFileSync(file, "utf8"), text);
  }
  for (const v of [undefined, 1, 2, 99]) assert.throws(() => currentJournal([{ v }]), /journal version/);
  assert.deepEqual(currentJournal([{ v: 3 }]), [{ v: 3 }]);
  assert.throws(() => currentJournal([{ v: 3, baseline: {} }]), /journal version/);
});

test("unsupported generated-playbook registries are never normalized", (t) => {
  const dir = room(t);
  const store = createGeneratedSkills(dir, realIo());
  mkdirSync(store.paths.room, { recursive: true });
  for (const text of ['{"schema":1,"skills":[]}', '{"schema":2,"skills":[],"migration":true}', '{bad']) {
    writeFileSync(store.paths.registry, text);
    assert.throws(() => store.registry(), /registry schema/);
    assert.equal(readFileSync(store.paths.registry, "utf8"), text);
  }
});
