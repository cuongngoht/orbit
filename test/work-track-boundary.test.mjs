// The boundaries unified work tracking keeps, as a grep and as tables: src/work/track imports no task, no live core and no host
// (the composition roots bind them and hand them in), it reads no environment and spawns nothing, it writes only through the work
// store, and every table the docs name is the table the code holds. These are structure; the behaviour is test/work-track.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { repositoryPaths } from "../src/project/repository.mjs";
import { workingSetDir } from "../src/project/runtime.mjs";
import { KINDS } from "../src/work/vocab.mjs";
import { COVERAGE, UNKNOWN_HOST, coverageOf, hostFrom } from "../src/work/track/coverage.mjs";
import { COMMANDS } from "../src/work/track/index.mjs";
import { workingSetRoom } from "../src/work/track/tail.mjs";
import { LIFECYCLE } from "../src/work/track/vocab.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { sealed } from "./home.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRACK = join(REPO, "src", "work", "track");
const files = readdirSync(TRACK).filter((f) => f.endsWith(".mjs")).map((f) => join(TRACK, f));
const code = (file) => readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "");
const importsOf = (file) => [...code(file).matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);

test("src/work/track imports leaves and the work store, and never a task, the live core, a host, a runtime or a node built-in that reads the world", () => {
  for (const f of files) {
    for (const spec of importsOf(f)) {
      if (spec.startsWith("node:")) assert.match(spec, /^node:path$/, `${relative(REPO, f)} imports ${spec}`);
      if (spec.startsWith(".")) assert.doesNotMatch(relative(join(REPO, "src"), resolve(dirname(f), spec)).split("\\").join("/"), /^(task|live|orchestration|runtime|investigation|automation|requirements|engineering|trace|resources|routing|mcp|host|skills)(\/|$)/, `${relative(REPO, f)} imports ${spec}`);
    }
  }
});

test("src/work/track reads no environment and no clock and spawns nothing: every effect is a port a root hands in", () => {
  for (const f of files) assert.doesNotMatch(code(f), /process\.env|process\.cwd|child_process|\bspawn|\bexec|Date\.now\(|new Date\(\)|setTimeout|fetch\(/, relative(REPO, f));
});

test("tracking opens no viewer and starts no workflow: nothing under src/work/track names a command of live, automation, runtime or tasks", () => {
  for (const f of files) assert.doesNotMatch(code(f), /live\.mjs|automation\.mjs|runtime\.mjs|task\.mjs|--human/i, relative(REPO, f));
});

test("a tracked work's kinds are the ones the docs name, each allow-listed, and none has a field named `kind` or a field for what must never be kept", () => {
  for (const kind of ["bound", "handoff", "linked", "state", "report"]) assert.ok(KINDS[kind], kind);
  for (const [kind, fields] of Object.entries(KINDS)) assert.ok(!fields.includes("kind"), kind);
  const all = ["bound", "handoff", "linked", "state", "report"].flatMap((k) => KINDS[k]);
  for (const forbidden of ["prompt", "reply", "response", "command", "argv", "args", "transcript", "reasoning", "secret", "token", "password", "outcome_of_check", "verdict", "verified"]) assert.ok(!all.includes(forbidden), forbidden);
});

test("the CLI's commands are the table's, documented in its usage header, with the writes and needs columns every table of commands has", () => {
  const header = readFileSync(join(REPO, "cli", "track.mjs"), "utf8").split("\n").filter((l) => l.startsWith("//")).join("\n");
  for (const [name, row] of Object.entries(COMMANDS)) {
    assert.match(header, new RegExp(`node track\\.mjs ${name}\\b`), `${name} is documented in cli/track.mjs`);
    assert.ok(["nothing", "store"].includes(row.writes) && ["store", "view"].includes(row.needs), name);
    assert.equal(typeof row.say, "function");
  }
});

test("every host the coverage table has a row for is a host docs/hosts.md names, and a host with no row is explicit-only", () => {
  const docs = readFileSync(join(REPO, "docs", "hosts.md"), "utf8");
  assert.match(docs, /Work tracking \(`cli\/track\.mjs`/);
  assert.deepEqual(Object.keys(COVERAGE).sort(), ["antigravity", "claude", "codex", "grok"]);
  assert.match(docs, /Grok Build v2/, "Grok Build (1.8.9) has its column in docs/hosts.md");
  assert.equal(COVERAGE.grok.outcome.startsWith("exit status"), true, "Grok reports a command's exit code");
  assert.deepEqual(coverageOf("no-such-host"), { host: "no-such-host", ...UNKNOWN_HOST });
  assert.equal(coverageOf("no-such-host").observation, "explicit");
  assert.equal(COVERAGE.antigravity.sessionEnd, false, "docs/hosts.md: AGY never synthesises a SessionEnd");
  assert.equal(COVERAGE.codex.outcome.startsWith("unknown"), true);
  assert.deepEqual([hostFrom({ ORBIT_HOST: "codex" }), hostFrom({ ORBIT_HOST: "Bad Host" }), hostFrom({})], ["codex", "claude", "claude"]);
});

// 0.2.2, ADR 0044: whether a host's payload names WHICH subagent made a call is a column of the same table, true of the
// payload docs/hosts.md records -- a host that shows none says so, and a host nobody measured is unknown, never "none".
test("every host says whether its calls name an agent, and how one call is named", () => {
  for (const row of [...Object.values(COVERAGE), UNKNOWN_HOST]) assert.ok(typeof row.agents === "string" && typeof row.calls === "string");
  assert.deepEqual(Object.fromEntries(Object.entries(COVERAGE).map(([h, r]) => [h, r.agents.split(":")[0]])), { claude: "observed", codex: "none", antigravity: "none", grok: "unknown" });
  assert.match(COVERAGE.claude.agents, /only its commands are seen starting/, "a subagent's running READ is never claimed");
  assert.deepEqual(Object.fromEntries(Object.entries(COVERAGE).map(([h, r]) => [h, r.namesAgents])), { claude: true, codex: false, antigravity: false, grok: null }, "only a host that names every subagent's call lets a call with no agent be the session's own");
  assert.equal(UNKNOWN_HOST.namesAgents, null);
});

test("the lifecycle words in the docs are the table's", () => {
  const readme = readFileSync(join(REPO, "README.md"), "utf8");
  for (const row of LIFECYCLE) assert.match(readme, new RegExp(`\`${row.state}\``), `README §4.18 names ${row.state}`);
});

test("Orbit Control's room for a checkout's working sets is the room the hooks write to", (t) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-track-room-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  const paths = repositoryPaths(repo, { ORBIT_STORE_DIR: join(dir, "store"), HOME: dir, USERPROFILE: dir });
  assert.equal(workingSetRoom(paths.storeRoot, paths.runtime.split(/[\\/]/).at(-1), paths.checkoutId), workingSetDir(paths));
  assert.ok(existsSync(REPO));
});

test("the skills that tell a host about tracking say that general guidance creates no work and that tracking never blocks", () => {
  const help = readFileSync(join(REPO, "skills", "orbit-help", "SKILL.md"), "utf8");
  assert.match(help, /General guidance creates no work/);
  assert.match(help, /tracking never blocks the work/);
  assert.match(help, /cli\/track\.mjs track "<the task, in one sentence, in English>" --route=<NEXT> --because=/);
  assert.match(help, /--continue=<w-…>/);
  for (const skill of ["orbit-develop", "orbit-engineer"]) assert.match(readFileSync(join(REPO, "skills", skill, "SKILL.md"), "utf8"), /track\.mjs/);
});
