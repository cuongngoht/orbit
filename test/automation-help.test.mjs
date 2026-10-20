// orbit-help as the entry point: a named task a coordinated workflow fits goes to the coordinator BY DEFAULT,
// with no settings document at all; a read-only question, a task no workflow fits, or a restriction a person kept
// from before autonomy was the default gets the navigator's answer exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recommend } from "../src/help/vocab.mjs";
import { sealed } from "./home.mjs";
import { stateRooms } from "../src/store/control.mjs";

const known = { architecture: { total: 4, stale: 0 }, map: { screens: 2 }, qa: { plans: 1, errors: 0 }, work: { open: 0 } };

const on = () => ({ coordinates: true, workflow: "engineering" });

test("a task a workflow fits: NEXT is the coordinator", () => {
  assert.equal(recommend({ ...known, task: { intent: "development" }, automation: on() }).id, "automation");
  assert.equal(recommend({ ...known, task: { intent: "development" }, automation: on() }).id, "automation");
});

test("nothing to coordinate: the navigator answers", () => {
  for (const automation of [null, { coordinates: false }]) {
    assert.equal(recommend({ ...known, task: { intent: "development" }, automation }).id, "developer");
  }
  assert.equal(recommend({ ...known, task: null, automation: null }).id, "run-tests", "no task: recommendations as before");
});

test("a task asking for a change taken to a verified result goes to orbit-engineering-agent while a restriction is kept", () => {
  assert.equal(recommend({ ...known, task: { intent: "autonomous-engineering" }, automation: null }).run, "orbit-engineer");
});

test("help stays read-only: coordinating by default, it writes nothing to the store", (t) => {
  const store = mkdtempSync(join(tmpdir(), "orbit-help-auto-"));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  const out = execFileSync(process.execPath, ["cli/help.mjs", "--for=implement the refund validation and test it", "--json"], { env: sealed({ ORBIT_STORE_DIR: store, ORBIT_UI_TESTS: "test/fixtures/ui-tests" }), encoding: "utf8" });
  assert.deepEqual(Object.keys(JSON.parse(out)), ["project", "status", "understanding", "unknown", "blockers", "capabilities", "next", "run", "because"]);
  assert.deepEqual(readdirSync(store).filter((n) => n.includes("automation")), []);
});

test("in a checkout with no UI test data (1.8.9), a task a workflow fits gets the coordinator with no settings at all; anything else gets the navigator's own answer, never a refusal, and the checkout stays untouched", (t) => {
  const base = mkdtempSync(join(tmpdir(), "orbit-help-plain-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  const store = join(base, "store");
  execFileSync("git", ["init", "-q", repo]);
  const env = sealed({ ORBIT_STORE_DIR: store });
  const ask = (task) => spawnSync(process.execPath, [join(process.cwd(), "cli/help.mjs"), `--for=${task}`, "--json"], { cwd: repo, env, encoding: "utf8" });
  const on = ask("implement the refund validation and test it");
  assert.equal(on.status, 0, "a fresh install: nothing to turn on");
  assert.equal(JSON.parse(on.stdout).next, "automation");
  assert.match(JSON.parse(on.stdout).because, /nothing to turn on/);
  const control = ask("add the github MCP server");
  assert.equal(control.status, 0, "a task no workflow fits: the navigator answers it now, with no UI test data needed");
  assert.equal(JSON.parse(control.stdout).next, "control");
  const file = join(stateRooms(store).automation, "settings.json");
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ schema: 1, enabled: false })}\n`);
  const kept = ask("implement the refund validation and test it");
  assert.equal(kept.status, 2);
  assert.match(kept.stderr, /schema|unsupported/i);
  assert.deepEqual(readdirSync(repo), [".git"], "nothing was written into the checkout");
});
