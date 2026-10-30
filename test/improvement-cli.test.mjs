// `improve` as a host and a hook run it (0.3.0, ADR 0045): real processes, a fresh repository, a sealed home. A read
// creates nothing; the hook's own process is silent, ends well and is debounced; an id this project does not keep is
// REFUSED; and no command promotes, reverts, rejects or changes a setting.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { roomsOf } from "../satellite/src/store/rooms.mjs";
import { IMPROVABLE, improvable } from "../skills/orbit-learn/hosts/drain.mjs";
import { DIR as IMPROVEMENT_DIR } from "../src/improvement/store.mjs";
import { DIR as FACTORY_DIR } from "../src/skill-factory/vocab.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function repo(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-improve-cli-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = join(dir, "repo");
  execFileSync("git", ["init", "-q", r], { env: sealed() });
  execFileSync("git", ["-C", r, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  return { dir, repo: r, store: join(dir, "store") };
}

const cli = (p, args, cwd = p.repo) => spawnSync(process.execPath, [join(ROOT, "cli", "improve.mjs"), ...args], { cwd, env: sealed({ ORBIT_STORE_DIR: p.store, ORBIT_TRACE: "off" }), encoding: "utf8" });

test("every read answers and creates nothing at all", (t) => {
  const p = repo(t);
  for (const args of [["status"], ["opportunities"], ["candidates"], ["metrics"], ["doctor"], ["where"], ["history", "release-x"], ["analyse", "--dry"]]) {
    const r = cli(p, [...args, "--json"]);
    assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`);
    JSON.parse(r.stdout);
  }
  assert.equal(existsSync(p.store), false, "no read made the store");
});

test("an id this project does not keep is refused, and a person's word is no command here", (t) => {
  const p = repo(t);
  assert.equal(cli(p, ["step", "imp-000000000000"]).status, 2);
  assert.equal(cli(p, ["show", "nonsense"]).status, 2);
  assert.equal(cli(p, ["start", "opp-0000000000000000"]).status, 2);
  for (const word of ["promote", "revert", "reject", "settings"]) {
    const r = cli(p, [word, "imp-000000000000"]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /node improve\.mjs status/, `${word} is not a command: the usage is printed`);
  }
});

test("the hook's own process is silent, always ends well, and is debounced in its own room", (t) => {
  const p = repo(t);
  const outside = cli(p, ["analyse", "--hook"], p.dir);
  assert.deepEqual([outside.status, outside.stdout, outside.stderr], [0, "", ""], "outside a checkout: nothing said, nothing failed");
  const first = cli(p, ["analyse", "--hook"]);
  assert.deepEqual([first.status, first.stdout], [0, ""]);
  const project = readdirSync(p.store).find((n) => n.startsWith("repo-"));
  const analysed = join(p.store, project, "improvement", "state", "analysed.json");
  const at = statSync(analysed).mtimeMs;
  cli(p, ["analyse", "--hook"]);
  assert.equal(statSync(analysed).mtimeMs, at, "debounced: the second run wrote nothing");
});

test("a hook's process started outside the checkout analyses the checkout it is told, and nothing else", (t) => {
  const p = repo(t);
  const told = cli(p, ["analyse", "--hook", `--checkout=${p.repo}`], tmpdir());
  assert.deepEqual([told.status, told.stdout, told.stderr], [0, "", ""]);
  const project = readdirSync(p.store).find((n) => n.startsWith("repo-"));
  assert.ok(project && existsSync(join(p.store, project, "improvement", "state", "analysed.json")), "the told checkout's room was analysed");
  const ignored = cli(p, ["status", "--json", `--checkout=${tmpdir()}`]);
  assert.equal(ignored.status, 0, "only a hook's own process takes --checkout: a command keeps its own checkout");
});

test("a hook starts no process for a project that keeps nothing to improve: no playbook, no mission, no campaign", (t) => {
  const root = join(repo(t).dir, "store-root");
  assert.deepEqual(IMPROVABLE.map((parts) => join(root, ...parts)).sort(), [join(root, FACTORY_DIR), roomsOf(root).missions, join(root, IMPROVEMENT_DIR, "campaigns")].sort(), "each room is named by its owner");
  assert.deepEqual([improvable(root), improvable(null)], [false, false]);
  for (const parts of IMPROVABLE) {
    mkdirSync(join(root, ...parts), { recursive: true });
    assert.equal(improvable(root), true, parts.join("/"));
    rmSync(join(root, parts[0]), { recursive: true, force: true });
  }
});
