// What a QA case's engine is set up with, as a person sets it in Control: the investigation's own minutes are the
// case's runner minutes -- the time the host's brief promises (round.mjs) -- never the setting's 20-minute default,
// which stopped real hosts with most of their obligations open (ORBIT-QA-003, ship 11).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { movedTo, sandboxDown, settingsOf } from "../benchmark/lib/qa/engine.mjs";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { sealed } from "./home.mjs";

const ROOT = join(import.meta.dirname, "..");
const caseOf = (id) => JSON.parse(readFileSync(join(ROOT, "benchmark", "suites", "orbit-qa", id, "case.json"), "utf8"));
const TARGET = { tenancy: { claim: "tid" } };

test("the investigation is given the case's runner minutes, within the setting's bound", () => {
  const set = new Map(settingsOf(TARGET, caseOf("orbit-qa-003").limits));
  assert.equal(set.get("limits.minutes"), String(caseOf("orbit-qa-003").limits.runner.minutes));
  assert.equal(new Map(settingsOf(TARGET, { runner: { minutes: 600 } })).get("limits.minutes"), "240", "never past the setting's own maximum");
  assert.equal(new Map(settingsOf(TARGET, {})).has("limits.minutes"), false, "a case that declares no runner minutes keeps the default");
  assert.equal(set.get("enabled"), "true");
});

// A run that stopped part-way releases every engine's sandbox on its way out (qa/flow.mjs `releasedAll`). An engine whose
// task never got a workspace refuses to bind a sandbox by THROWING, before any promise exists -- ORBIT-SES-001's and
// -002's controls (0.5.0) died there, the release's throw hiding the error that had stopped the run.
test("a sandbox release that cannot even bind answers its error and never throws, so it never hides why a run stopped", async () => {
  const refusing = { rt: { bindSandbox: () => { throw new Error("tsk-0000000000a1 has no workspace of its own here — prepare-workspace comes first"); }, COMMANDS: { "sandbox-release": { run: async () => ({ released: true }) } } }, env: {}, dir: "/nowhere", task: "tsk-0000000000a1" };
  assert.deepEqual(await sandboxDown({ engineDir: "/nowhere" }, refusing), { error: "tsk-0000000000a1 has no workspace of its own here — prepare-workspace comes first" });
  const failing = { ...refusing, rt: { bindSandbox: () => ({}), COMMANDS: { "sandbox-release": { run: async () => { throw new Error("busy"); } } } } };
  assert.deepEqual(await sandboxDown({ engineDir: "/nowhere" }, failing), { error: "busy" });
  assert.deepEqual(await sandboxDown({ engineDir: "/nowhere" }, { rt: null }), { released: "nothing was started" });
});

// A sessions case that learns on the clean application moves the code under the shared checkout before its second session
// (sessions/flow.mjs `movedOf`). The acceptance assembly refuses a directory that is not empty, and the checkout keeps its
// `.git` -- so ORBIT-SES-003 never reached its second session (0.5.0). The variant is assembled beside it and laid over it.
test("the code moved under a shared checkout keeps its history: the variant replaces every file but .git, and is committed there", async (t) => {
  const base = mkdtempSync(join(tmpdir(), "orbit-moved-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, "invoice-a");
  const env = sealed({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@orbit.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@orbit.invalid" });
  const { assemble } = await import(pathToFileURL(join(ROOT, "acceptance", "projects", "assemble.mjs")).href);
  assemble("invoice-a", dir, { variant: "correct" });
  for (const a of [["init", "-q", "."], ["add", "-A"], ["commit", "-qm", "clean"]]) spawnSync("git", a, { cwd: dir, env });
  const e = { dir, target: { assembled: async (engineDir, stack, variant, dest) => assemble(stack, dest, { variant }) } };
  const before = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, env, encoding: "utf8" }).stdout.trim();
  const after = await movedTo({ engineDir: ROOT, case: { target: { stack: "invoice-a" } }, env }, e, "no-db-write");
  assert.notEqual(after, before, "a commit of its own over the clean one");
  assert.equal(spawnSync("git", ["rev-list", "--count", "HEAD"], { cwd: dir, env, encoding: "utf8" }).stdout.trim(), "2", "the same history, one commit longer");
  assert.equal(existsSync(join(base, ".invoice-a-no-db-write")), false, "nothing is left beside it");
});
