// THIS SESSION'S TOOL CALLS beside a mission: read from the working set Orbit's hooks keep -- only this session's file,
// only its tail, never written -- and shown attributed to NO agent run. A viewer with no session, a switched-off working
// set or a file it cannot read says so instead of an empty block.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { noSessionActivity, sessionActivityOf } from "../../src/live/session.mjs";
import { sealed } from "../../test/home.mjs";
import { bindPorts, sessionFileFor } from "../cli/bind.mjs";
import { VIEWS } from "../src/live/tui/views.mjs";
import { liveViewOf } from "../src/live/view.mjs";
import { emptyModel } from "../src/mission/fold.mjs";

const T0 = Date.parse("2026-10-22T08:00:00.000Z");
const at = (s) => new Date(T0 + s * 1000).toISOString();
const edit = (s, path) => ({ t: at(s), ev: "post-tool", tool: "edit", paths: [path], tokens: [], cmd: null });
const command = (s, ok = true) => ({ t: at(s), ev: ok ? "post-tool" : "post-tool-failure", tool: "command", paths: [], tokens: [], cmd: { class: "test", exe: "node", ok } });

const toolsText = (view) => VIEWS.find((v) => v.id === "tools").rows(view).map((row) => row.map((s) => s.text).join("")).join("\n");

test("the session's tool calls are shown beside the mission, attributed to no agent run", () => {
  const view = liveViewOf(emptyModel(), [], sessionActivityOf([edit(1, "src/client.mjs"), command(2, false)], { nowMs: T0 + 3000, checks: ["test"] }));
  assert.deepEqual([view.tools.session.observed, view.tools.session.attribution, view.tools.session.recent.map((e) => e.kind)], [2, "UNOBSERVED", ["command", "edit"]]);
  assert.match(toolsText(view), /THIS SESSION'S TOOL CALLS\s+2 observed · 0 running · attributed to no agent run[\s\S]*src\/client\.mjs/);
  assert.match(toolsText(liveViewOf(emptyModel(), [], noSessionActivity("off"))), /switched off here/);
  assert.match(toolsText(liveViewOf(emptyModel(), [])), /not read by this viewer/);
});

function checkout(t) {
  const dir = mkdtempSync(join(tmpdir(), "sat-session-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  mkdirSync(repo);
  for (const args of [["init", "-q"], ["commit", "-q", "--allow-empty", "-m", "init"]]) spawnSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args], { cwd: repo });
  return { repo, store: join(dir, "store") };
}

test("the composition root reads this session's own working set, and says why when it reads none", (t) => {
  const w = checkout(t);
  const ports = bindPorts(sealed({ ORBIT_STORE_DIR: w.store, ORBIT_SESSION: "claude:0123456789abcdef", ORBIT_HOST: "claude" }), w.repo);
  const file = sessionFileFor(ports);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${[edit(1, "src/a.mjs"), command(2)].map((l) => JSON.stringify(l)).join("\n")}\n`);
  assert.deepEqual([ports.sessionActivity(T0 + 5000).source, ports.sessionActivity(T0 + 5000).observed], ["ok", 2]);
  assert.equal(bindPorts(sealed({ ORBIT_STORE_DIR: w.store, ORBIT_SESSION: "claude:0123456789abcdef", ORBIT_WORKING_SET: "off" }), w.repo).sessionActivity(T0).source, "off");
  assert.equal(bindPorts(sealed({ ORBIT_STORE_DIR: w.store }), w.repo).sessionActivity(T0).source, "no-session");
});
