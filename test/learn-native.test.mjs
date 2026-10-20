import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { autoMemoryOff, cacheVerdict, discover, memoryDirOf, refreshDue, settingsMemoryDir, settingsLayers } from "../skills/orbit-learn/native.mjs";

// Built with resolve+join, like the code under test: native.mjs calls
// resolve(transcriptPath) before walking up, and on Windows a rootless
// "/Users/x/..." resolves against the current drive (e.g. "D:\..."). A plain
// join() never gained that drive letter, so it stopped matching what
// projectDirOf actually returns.
const PROJECT_DIR = resolve("/Users/x/.claude/projects/-Users-x-Repo-acme");
const MAIN = join(PROJECT_DIR, "1f0c8a3e.jsonl");
const SUBAGENT = join(PROJECT_DIR, "1f0c8a3e", "subagents", "agent-7.jsonl");
const MEMORY = join(PROJECT_DIR, "memory");

const found = (over = {}) =>
  discover({ transcriptPath: MAIN, env: {}, home: "/Users/x", cwd: "/r/acme", host: "laptop-a", read: () => null, now: () => "2026-09-20T00:00:00.000Z", ...over });

// The bug this exists to prevent: a subagent's transcript sits two levels deeper,
// so dirname() hands back <project>/<sessionId>/subagents -- a directory that is
// not the project's, and a memory dir invented underneath it.
test("the memory directory is found by walking up to the dir whose parent is projects, not by dirname", () => {
  assert.equal(memoryDirOf(MAIN), MEMORY);
  assert.equal(memoryDirOf(SUBAGENT), MEMORY, "a subagent transcript must land on the same directory");
});

// We never reproduce the host's own encoding of <project>: it is lossy, it is not
// a published contract, and a wrong guess would write into somebody else's memory.
test("a transcript outside a projects tree yields nothing rather than a guess", () => {
  assert.equal(memoryDirOf("/tmp/elsewhere/session.jsonl"), null);
  assert.equal(memoryDirOf(null), null);
  assert.equal(found({ transcriptPath: "/tmp/x.jsonl" }).how, "none");
});

// When a setting relocates the memory, the transcript does NOT move with it, so
// the walk-up is not stale -- it is wrong. The setting has to win outright.
test("autoMemoryDirectory relocates the memory dir, and local beats project beats user", () => {
  const read = (f) => (f.endsWith("settings.local.json") ? JSON.stringify({ autoMemoryDirectory: "~/local-memory" }) : JSON.stringify({ autoMemoryDirectory: "/user-memory" }));
  const rec = found({ read });
  assert.equal(rec.dir, join("/Users/x", "local-memory"), "~/ is expanded, and local wins");
  assert.equal(rec.how, "settings");
  assert.equal(rec.scope, "local");

  const userFile = join("/Users/x", ".claude", "settings.json");
  const onlyUser = found({ read: (f) => (f === userFile ? JSON.stringify({ autoMemoryDirectory: "/user-memory" }) : null) });
  assert.equal(onlyUser.dir, "/user-memory");
  assert.equal(onlyUser.scope, "user");
});

// A child process cannot see the workspace trust state. Dropping a setting the
// user can read in their own file would be worse than saying we are unsure.
test("a project-scope setting is carried with a caveat rather than dropped", () => {
  const projectFile = join("/r/acme", ".claude", "settings.json");
  const read = (f) => (f === projectFile ? JSON.stringify({ autoMemoryDirectory: "/repo-memory" }) : null);
  const rec = found({ read });
  assert.equal(rec.scope, "project");
  assert.equal(rec.untrusted, true);
});

test("a relative autoMemoryDirectory is refused rather than resolved against a guessed base", () => {
  const read = (f) => (f.endsWith("settings.local.json") ? JSON.stringify({ autoMemoryDirectory: "some/where" }) : null);
  assert.equal(found({ read }).dir, null);
});

test("every off switch is recognised, and each names itself", () => {
  assert.equal(autoMemoryOff({ CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" }, []), "CLAUDE_CODE_DISABLE_AUTO_MEMORY is set");
  const layers = settingsLayers("/Users/x", "/r", (f) => (f.endsWith("settings.local.json") ? JSON.stringify({ autoMemoryEnabled: false }) : null));
  assert.match(autoMemoryOff({}, layers), /autoMemoryEnabled is false in the local settings/);
  assert.equal(autoMemoryOff({}, settingsLayers("/Users/x", "/r", () => null)), null);
  assert.equal(settingsMemoryDir(settingsLayers("/Users/x", "/r", () => "not json"), "/Users/x"), null);
});

// Age alone must never invalidate it. The path changes when the repo moves or a
// setting relocates it -- both of which show up as "it is gone", not as "it is
// old" -- and an expiry firing for no reason would make the target flap.
test("a cached directory that still exists is usable however old it is; one that is gone is not", () => {
  const rec = found();
  const there = { host: "laptop-a", exists: () => true };
  assert.equal(cacheVerdict(rec, there).usable, true);
  assert.equal(cacheVerdict(rec, there).dir, MEMORY);

  assert.equal(cacheVerdict(rec, { host: "laptop-a", exists: () => false }).usable, false);
  assert.match(cacheVerdict(rec, { host: "laptop-a", exists: () => false }).why, /is gone/);
  assert.match(cacheVerdict(null, there).why, /no session has cached/);
  assert.match(cacheVerdict({ ...rec, v: 99 }, there).why, /different version/);
  assert.match(cacheVerdict({ ...rec, off: "CLAUDE_CODE_DISABLE_AUTO_MEMORY is set" }, there).why, /auto memory is off/);
});

// A roaming or synced home directory would otherwise hand this machine another
// machine's path.
test("a record cached on another machine is ignored", () => {
  assert.match(cacheVerdict(found(), { host: "laptop-b", exists: () => true }).why, /cached on laptop-a, not on this machine/);
});

// Whether to rewrite the file is a write-rate question, deliberately separate
// from whether the record is valid.
test("refreshing the cache is a separate question from trusting it", () => {
  const rec = found();
  const fresh = Date.parse(rec.at) + 1000;
  assert.equal(refreshDue(rec, fresh), false);
  assert.equal(refreshDue(rec, fresh + 13 * 60 * 60 * 1000), true);
  assert.equal(refreshDue(null, fresh), true);
});
