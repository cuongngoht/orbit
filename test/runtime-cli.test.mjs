// The runtime composition root, as a person or a model runs it: the real CLI over real processes,
// a real Git checkout and a store in a temporary directory. The command table is held to the usage
// the CLI prints (so the session trail may name each subcommand and nothing else), every command
// that only looks leaves the repository exactly as committed, the exit codes mean what the header
// says, and the one command that writes the repository writes only what a proposal named.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMANDS, COMMAND_NAMES } from "../src/runtime/index.mjs";
import { documented, headerOf } from "../src/trace/commands.mjs";
import { sealed } from "./home.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(REPO, "cli", "runtime.mjs");

const IDENTITY = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd, ...args) => spawnSync("git", args, { cwd, encoding: "utf8", env: sealed(IDENTITY) });

function checkout(t) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "orbit-runtime-cli-")));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "shop");
  mkdirSync(join(repo, "web"), { recursive: true });
  writeFileSync(join(repo, "web", "package.json"), JSON.stringify({ name: "web", engines: { node: ">=18" }, scripts: { dev: "vite", test: "vitest run" } }));
  writeFileSync(join(repo, "web", "package-lock.json"), "{}");
  for (const args of [["init", "-q", "."], ["add", "-A"], ["commit", "-qm", "init"]]) git(repo, ...args);
  return { repo, base, env: sealed({ ORBIT_STORE_DIR: join(base, "store") }) };
}

const run = (c, ...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: c.repo, encoding: "utf8", env: c.env });
const status = (repo) => git(repo, "status", "--porcelain", "--ignored").stdout.trim();

test("the usage header documents every subcommand, so the session trail may name each and nothing else", () => {
  const subs = documented(headerOf(readFileSync(CLI, "utf8")), "runtime");
  assert.deepEqual([...subs].sort(), [...COMMAND_NAMES].sort());
});

// `--host` and `--protocol` choose the HOST on every Orbit command, before a command sees its arguments
// (skills/orbit-learn/hosts/settings.mjs): a runtime flag of either name would never reach the engine.
test("no runtime flag is one the host selection reads first: a reach target's server is --address", () => {
  assert.doesNotMatch(headerOf(readFileSync(CLI, "utf8")), /--(host|protocol)=/);
});

test("a reach target is set, read, checked and retried through the real CLI, against a real port on this machine", async (t) => {
  const c = checkout(t);
  const server = createServer((socket) => socket.end());
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => server.close());
  const set = run(c, "configure", "--human", "--reach=local-db", "--address=127.0.0.1", `--port=${server.address().port}`, "--check-from=native", "--retry-attempts=2", "--retry-interval-ms=250", "--retry-timeout-ms=1000");
  assert.equal(set.status, 0, set.stderr);
  const seen = JSON.parse(run(c, "connectivity", "--json").stdout);
  assert.deepEqual(seen.targets.map((x) => [x.id, x.host, x.observations.native.state]), [["local-db", "127.0.0.1", "NOT_CHECKED"]]);
  const checked = run(c, "check", "local-db", "--json");
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).results.native.state, "REACHABLE");
  await new Promise((done) => server.close(done));
  const retried = JSON.parse(run(c, "retry", "local-db", "--json").stdout);
  assert.deepEqual([retried.results.native.state, retried.results.native.attemptsUsed], ["UNREACHABLE", 2]);
  assert.equal(status(c.repo), "", "nothing of it is in the repository");
});

test("with no command, or --help, it prints the usage and exits 0; a command it does not have is bad usage (2), never the product's failure (1)", (t) => {
  const c = checkout(t);
  for (const args of [[], ["--help"]]) {
    const got = run(c, ...args);
    assert.equal(got.status, 0);
    assert.match(got.stdout, /RUNTIME: what a checkout needs in order to run/);
  }
  const unknown = run(c, "teleport");
  assert.equal(unknown.status, 2);
  assert.match(unknown.stdout, /RUNTIME: what a checkout needs in order to run/, "it still says what the commands are");
});

test("outside a Git checkout it is REFUSED (2) with a sentence, and nothing is written anywhere", (t) => {
  const c = checkout(t);
  const outside = mkdtempSync(join(tmpdir(), "orbit-runtime-outside-"));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const got = spawnSync(process.execPath, [CLI, "discover"], { cwd: outside, encoding: "utf8", env: c.env });
  assert.equal(got.status, 2);
  assert.match(got.stderr, /is not inside a Git checkout/);
  assert.equal(existsSync(join(c.base, "store")), false, "no store was made for something that is not a project");
});

test("every command that only looks leaves the repository exactly as committed -- not a file, not an ignored one", (t) => {
  const c = checkout(t);
  for (const args of [["discover"], ["discover", "--dry"], ["status"], ["doctor"], ["design"], ["proposal"], ["prepare"], ["settings"], ["projects"]]) {
    const got = run(c, ...args);
    assert.equal(got.status, 0, `${args.join(" ")}: ${got.stderr}`);
    assert.equal(status(c.repo), "", `${args.join(" ")} wrote into the repository`);
  }
});

test("--json prints the same answer as data, for Orbit Control and for a model to read", (t) => {
  const c = checkout(t);
  run(c, "discover");
  const got = JSON.parse(run(c, "status", "--json").stdout);
  assert.deepEqual([got.understanding.state, got.plan.components.map((x) => x.key)], ["CURRENT", ["node:web"]]);
  assert.equal(JSON.parse(run(c, "projects", "--json").stdout).length, 1);
});

test("adopting is a person's: without --human it is refused (2) before a thing is touched, with it exactly the proposal's file is written", (t) => {
  const c = checkout(t);
  run(c, "discover");
  const proposal = JSON.parse(run(c, "design", "--json").stdout);
  const refused = run(c, "adopt", proposal.id);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /relay it with --human/);
  assert.equal(status(c.repo), "");
  const done = run(c, "adopt", proposal.id, "--human");
  assert.equal(done.status, 0, done.stderr);
  assert.equal(status(c.repo), "?? .devcontainer/", "exactly the proposal's path is new, and nothing is committed");
});

test("start with nothing known is BLOCKED or REFUSED, never a guess -- and never a failure of the product (1)", (t) => {
  const c = checkout(t);
  const before = run(c, "start");
  assert.ok([2, 3].includes(before.status), `exit ${before.status}`);
  assert.notEqual(before.status, 1);
  assert.equal(status(c.repo), "");
});

test("a command's table row says what it writes, and the one that writes the repository is a person's", () => {
  assert.deepEqual(Object.entries(COMMANDS).filter(([, c]) => c.writes === "repository").map(([n]) => n), ["adopt"]);
  assert.deepEqual(Object.entries(COMMANDS).filter(([, c]) => c.needs === "machine").map(([n]) => n), ["projects", "forget"]);
});
