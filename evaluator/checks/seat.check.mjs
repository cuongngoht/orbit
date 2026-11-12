// THE SEAT (lib/arms/plugin.mjs, lib/container/entry.mjs): an arm that carries the plugin may be seated -- the plugin's
// own adoption command run once in the checkout before the agent, with the run's HOME and store and no credential --
// and the seat holds only when the command ended 0 and the checkout is byte for byte what it was. A seat that failed or
// wrote the checkout ends the run INFRA_ERROR (SEAT) and no agent runs. Only an arm that carries a plugin may be
// seated, and a seated run's manifest says so with the command's argv.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { armOf } from "../lib/arms/index.mjs";
import { SEAT_ARGV } from "../lib/arms/plugin.mjs";
import { WRITING_SEAT } from "../lib/arms/scripted.mjs";
import { changedOf, seatOf, treeOf } from "../lib/container/entry.mjs";
import { CLAUDE_CODE_VERSION } from "../lib/core/versions.mjs";
import { readJson } from "../lib/core/util.mjs";
import { infraAfter, seatsHere } from "../lib/run/attempt.mjs";
import { roomOf, startCampaign } from "../lib/run/campaign.mjs";

const withDir = async (f) => {
  const dir = mkdtempSync(join(tmpdir(), "evl-seat-"));
  try { return await f(dir); }
  finally { rmSync(dir, { recursive: true, force: true }); }
};

// A checkout with a history, an executable and a link: what a task container's repository is.
function checkout(dir) {
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "a.py"), "x = 1\n");
  writeFileSync(join(repo, "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
  execFileSync("git", ["init", "-q"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=e", "-c", "user.email=e@e", "add", "-A"], { cwd: repo });
  execFileSync("git", ["-c", "user.name=e", "-c", "user.email=e@e", "commit", "-qm", "start"], { cwd: repo });
  mkdirSync(join(dir, "store"));
  return repo;
}

const node = (code) => [process.execPath, "-e", code];

const briefOf = (dir, repo, argv) => ({ repo, seat: { argv, dropEnv: ["CLAUDE_CODE_OAUTH_TOKEN"], store: join(dir, "store"), log: join(dir, "seat.out"), timeoutMs: 20000 } });

test("a seat that writes only the store holds: the checkout unchanged, what it wrote in the store listed, no credential handed to it", () => withDir(async (dir) => {
  const repo = checkout(dir);
  process.env.CLAUDE_CODE_OAUTH_TOKEN = "not-a-real-credential";
  try {
    const argv = node(`const fs = require("node:fs"); fs.mkdirSync("${join(dir, "store", "state", "checkouts")}", { recursive: true }); fs.writeFileSync("${join(dir, "store", "state", "checkouts", "c1.json")}", JSON.stringify({ credential: "CLAUDE_CODE_OAUTH_TOKEN" in process.env, cwd: process.cwd() })); console.log("seated");`);
    const s = await seatOf(briefOf(dir, repo, argv));
    assert.deepEqual([s.holds, s.exit, s.unchanged, s.changed, s.why], [true, 0, true, [], null]);
    assert.deepEqual(s.storeFiles, ["state/checkouts/c1.json"]);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "store", "state", "checkouts", "c1.json"), "utf8")), { credential: false, cwd: repo }, "run in the checkout, with no credential name in its environment");
    assert.equal(readFileSync(join(dir, "seat.out"), "utf8"), "seated\n");
    assert.deepEqual(s.argv, argv);
  } finally {
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
  }
}));

test("a seat that writes the checkout, or changes a file's bytes or mode, does not hold, and says which path", () => withDir(async (dir) => {
  const repo = checkout(dir);
  const added = await seatOf(briefOf(dir, repo, node('require("node:fs").writeFileSync("seat-wrote-this.txt", "x")')));
  assert.deepEqual([added.holds, added.exit, added.unchanged, added.changed], [false, 0, false, ["seat-wrote-this.txt"]]);
  assert.match(added.why, /the seat wrote the checkout \(seat-wrote-this\.txt\): a seat writes only the store/);
  const before = treeOf(repo);
  execFileSync("chmod", ["-x", join(repo, "run.sh")]);
  writeFileSync(join(repo, "src", "a.py"), "x = 2\n");
  assert.deepEqual(changedOf(before, treeOf(repo)), ["run.sh", "src/a.py"]);
}));

test("a seat command that fails, or runs past its time, does not hold; what it did in .git alone is said and never fatal", () => withDir(async (dir) => {
  const repo = checkout(dir);
  const failed = await seatOf(briefOf(dir, repo, node("process.exit(2)")));
  assert.deepEqual([failed.holds, failed.why], [false, "the seat command ended with exit 2"]);
  const slow = await seatOf({ ...briefOf(dir, repo, node("setTimeout(() => null, 60000)")), seat: { ...briefOf(dir, repo, []).seat, argv: node("setTimeout(() => null, 60000)"), timeoutMs: 300 } });
  assert.deepEqual([slow.holds, slow.timedOut, slow.why], [false, true, "the seat command ran past its time and was stopped"]);
  const git = await seatOf(briefOf(dir, repo, ["git", "update-index", "--refresh"]));
  assert.equal(git.holds, true, "the checkout's own .git is not the checkout the patch is taken from");
}));

test("only an arm that carries the plugin is seated, with the plugin's own adoption command; every other seat is refused by name", () => {
  assert.deepEqual(armOf("o", { kind: "claude+orbit", rev: "v0.5.0", seat: true }).seat, { argv: SEAT_ARGV });
  assert.deepEqual(armOf("m", { kind: "mini+orbit", rev: "v0.5.0", seat: true }).seat, { argv: SEAT_ARGV });
  assert.equal(armOf("o", { kind: "claude+orbit", rev: "v0.5.0" }).seat, null, "an arm not seated is the registered condition");
  assert.equal(armOf("o", { kind: "claude+orbit", rev: "v0.5.0", seat: false }).seat, null);
  assert.match(SEAT_ARGV.join(" "), /^\/opt\/eval\/bin\/node \/opt\/orbit-plugin\/cli\/help\.mjs$/);
  assert.throws(() => armOf("p", { kind: "claude", seat: true }), /an arm that carries no plugin has nothing to seat/);
  assert.throws(() => armOf("p", { kind: "mini", seat: true }), /an arm that carries no plugin has nothing to seat/);
  assert.throws(() => armOf("o", { kind: "claude+orbit", rev: "v0.5.0", seat: "yes" }), /seat is true or false/);
  assert.throws(() => armOf("s", { kind: "scripted", behaviour: "noop", seat: "plugin" }), /rev \(the plugin to seat\)/);
  assert.throws(() => armOf("s", { kind: "scripted", behaviour: "noop", rev: "HEAD" }), /rev \(the plugin to seat\)/);
  assert.throws(() => armOf("s", { kind: "scripted", behaviour: "noop", seat: "anything" }), /seat must be one of plugin, writes-checkout/);
  assert.deepEqual(armOf("s", { kind: "scripted", behaviour: "noop", seat: "writes-checkout" }).seat, { argv: WRITING_SEAT });
});

test("a seat that did not hold is the run's INFRA_ERROR (SEAT), said before anything the agent would have done", () => {
  const entry = { phase: "seat", seat: { holds: false, why: "the seat wrote the checkout (x): a seat writes only the store" } };
  assert.deepEqual(infraAfter({}, entry, { exitCode: 5 }, {}, {}), { code: "SEAT", says: "the seat did not hold before the agent started: the seat wrote the checkout (x): a seat writes only the store" });
});

test("a seated run's manifest says seated, with the command's argv; an unseated one says not seated", async () => withDir(async (home) => {
  const LIMITS = { usd: 0, turns: 10, minutes: 10, cpus: 2, memoryMb: 2048, pids: 512 };
  const def = { schema: 1, id: "seat-manifest", budgetUsd: 0, limits: LIMITS, arms: { seated: { kind: "scripted", behaviour: "noop", seat: "writes-checkout" }, plain: { kind: "scripted", behaviour: "noop" } }, runs: [{ arm: "seated", task: "pack:orders-e2e-001", trial: 1 }, { arm: "plain", task: "pack:orders-e2e-001", trial: 1 }] };
  writeFileSync(join(home, "c.json"), JSON.stringify(def));
  const tools = () => ({ ok: true, volume: "evl-tools-fake", claudeCode: CLAUDE_CODE_VERSION, node: "v22" });
  await startCampaign(join(home, "c.json"), { home, ports: { tools, dockerAnswers: () => true, execute: async () => ({ infra: null, summary: { started: true }, patch: { bytes: 0 } }) } });
  const manifest = (arm) => readJson(join(roomOf(home, "seat-manifest"), "runs", `${arm}-pack-orders-e2e-001-t1`, "a1", "manifest.json"));
  assert.deepEqual([manifest("seated").seated, manifest("seated").seat], [true, { argv: WRITING_SEAT, ranHere: true }]);
  assert.deepEqual([manifest("plain").seated, manifest("plain").seat], [false, undefined]);
}));

test("a memory track is seated once, in its first task's checkout: its later steps carry the store that seat bound", () => {
  const arm = armOf("o", { kind: "claude+orbit", rev: "v0.5.0", seat: true });
  assert.equal(seatsHere({ arm, run: { key: "k" } }), true, "a run on no track is seated");
  assert.equal(seatsHere({ arm, run: { key: "k", track: "pair1", step: 1 } }), true);
  assert.equal(seatsHere({ arm, run: { key: "k", track: "pair1", step: 2 } }), false);
  assert.equal(seatsHere({ arm: armOf("o", { kind: "claude+orbit", rev: "v0.5.0" }), run: { key: "k" } }), false);
});
