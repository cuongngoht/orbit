// The CLI over a REAL repository, for a requirement-backed task: the item's newest snapshot, its
// work, one task per work, and a newer snapshot frozen under a running task. Its own file, so the
// runner runs it beside the other CLI scenario rather than after it (each is real processes).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequirements } from "../src/requirements/store.mjs";
import { rootId, sourceRecord, workitemText } from "../src/sources/model.mjs";
import { createSources } from "../src/sources/store.mjs";
import { realIo } from "../src/store/io.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "cli", "autonomous-engineering.mjs");
const REQ_CLI = join(ROOT, "cli", "requirements.mjs");
const INIT = join(ROOT, "cli", "init.mjs");
const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

function repository(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-ae-req-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  mkdirSync(repo);
  writeFileSync(join(repo, "README.md"), "refunds\n");
  for (const args of [["init", "-q", "."], ["add", "-A"], ["commit", "-qm", "init"]]) spawnSync("git", args, { cwd: repo, env: sealed(IDENTITY) });
  return { base, repo, store: join(base, "store") };
}

const parsed = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

const run = (at, cwd = at.repo) => (script, args, input) => {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, input, env: sealed({ ORBIT_STORE_DIR: at.store, ...IDENTITY }), encoding: "utf8", timeout: 180000 });
  return { status: r.status, out: r.stdout, err: r.stderr, json: parsed(r.stdout) };
};

const ok = (r) => {
  assert.equal(r.status, 0, `${r.err}${r.out}`);
  return r.json;
};

// A requirement the way an acquisition would have left it: a source record and the requirement's
// identity -- then a fact recorded and a snapshot frozen through the requirements CLI itself.
function acquired(at) {
  const identity = { provider: "tracker", organization: "acme", project: "Shop", id: "482" };
  const store = run(at)(REQ_CLI, ["where", "--json"]).json.store;
  const rec = sourceRecord({ identity, kind: "workitem", ref: "482", revision: "7", text: workitemText({ title: "Refund validation", body: "a refund may not exceed what was paid" }), now: new Date().toISOString() });
  createSources(store, realIo()).saveRecord(rec);
  const root = rootId(identity);
  const port = createRequirements(store, realIo()).open(root);
  port.transact(() => port.setState({ sources: {}, position: 0, lastSnapshot: null, identity }));
  return { root, cite: `source:${rec.id}@7` };
}

const fact = (cite, aspect, says) => `${JSON.stringify({ subject: "refund", aspect, says, sources: [`${cite}#ac-1`] })}\n`;

test("a requirement-backed task through the real binding: the item's newest snapshot, its work, one task per work -- and a newer snapshot frozen under it blocks it, never adopted", (t) => {
  const at = repository(t);
  assert.equal(run(at)(INIT, [at.repo, "--origin=http://localhost:3000"]).status, 0);
  spawnSync("git", ["add", "-A"], { cwd: at.repo, env: sealed(IDENTITY) });
  spawnSync("git", ["commit", "-qm", "ui-tests"], { cwd: at.repo, env: sealed(IDENTITY) });
  const { root, cite } = acquired(at);
  assert.equal(run(at)(REQ_CLI, ["record", root], fact(cite, "limit", "A refund may not exceed the paid amount")).status, 0);
  const frozen = run(at)(REQ_CLI, ["snapshot", root, "--json"]).json.snapshot;
  const started = ok(run(at)(CLI, ["start", "--ref=482", "--json"]));
  assert.deepEqual([started.created, started.context.stage, started.context.task.snapshot, started.context.task.work], [true, "CONTEXT", frozen, `w-${root.slice(4)}`]);
  const again = ok(run(at)(CLI, ["start", "--ref=482", "--json"]));
  assert.deepEqual([again.created, again.resumed, again.task], [false, true, started.task], "one task per work");
  assert.equal(ok(run(at)(CLI, ["resume", "482", "--json"])).task, started.task);
  run(at)(REQ_CLI, ["record", root], fact(cite, "currency", "A refund is in the currency it was paid in"));
  const newer = run(at)(REQ_CLI, ["snapshot", root, "--json"]).json.snapshot;
  assert.notEqual(newer, frozen);
  const decision = JSON.stringify({ schemaVersion: 1, expectedRevision: started.context.revision, action: { kind: "gather-context" }, observed: "the task is in CONTEXT", hypothesis: "the project's context comes next" });
  const stopped = ok(run(at)(CLI, ["step", started.task, "--json"], decision));
  assert.deepEqual([stopped.state, stopped.stop], ["stopped", "requirement-moved"]);
  const c = ok(run(at)(CLI, ["context", started.task, "--json"]));
  assert.deepEqual([c.lifecycle, c.blocked.stop, c.task.snapshot, c.allowed], ["BLOCKED", "REQUIREMENT_BLOCKED", frozen, ["check-requirement"]]);
});
