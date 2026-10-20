// Learning is ON by default (1.8.9), bounded exactly as it was, opt-out everywhere it was opt-in -- and the hooks
// observe only a checkout the machine KNOWS: opening a repository with the plugin enabled writes nothing about it
// until a person asks for Orbit there. A protocol-2 host (Codex, Antigravity) is no longer a blind spot: its
// checkpoint is drained by a process of its own.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, effectiveSettings } from "../src/host/config.mjs";
import { switchOf } from "../src/project/env.mjs";
import { hostEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
import { hostFlags, protocolTwo } from "../skills/orbit-learn/hosts/drain.mjs";
import { hostSession } from "../src/memory/session.mjs";
import { MILESTONES } from "../src/engineering/observe/milestone.mjs";
import { FINDING_KINDS, doctorView } from "../src/engineering/views/doctor.mjs";
import { eventOf } from "../src/trace/events.mjs";
import { traceLog } from "../src/trace/log.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { sealed } from "./home.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST = JSON.parse(readFileSync(join(ROOT, ".claude-plugin", "plugin.json"), "utf8"));
const temp = realpathSync.native(mkdtempSync(join(tmpdir(), "orbit-learning-default-")));
after(() => rmSync(temp, { recursive: true, force: true }));

test("one default, declared for the dialog and for a host that never sends the option, and both say on", () => {
  assert.equal(DEFAULTS.engineering_observe, true);
  assert.equal(MANIFEST.userConfig.engineering_observe.default, DEFAULTS.engineering_observe, "the manifest and the hosts' defaults agree");
  assert.match(MANIFEST.userConfig.engineering_observe.description, /ORBIT_ENGINEERING_OBSERVE=off/, "the dialog says how to turn it off");
  assert.equal(effectiveSettings({}).engineering_observe, true);
  assert.equal(switchOf({ ORBIT_ENGINEERING_OBSERVE: "off" }, "ENGINEERING_OBSERVE", "engineering_observe", true), false);
  assert.equal(switchOf({ CLAUDE_PLUGIN_OPTION_ENGINEERING_OBSERVE: "false" }, "ENGINEERING_OBSERVE", "engineering_observe", true), false);
  for (const name of ["codex", "antigravity", "grok"]) assert.equal(hostEnvironment(sealed({}), { name, protocol: 2 }).ORBIT_ENGINEERING_OBSERVE, "on", name);
  assert.match(MILESTONES[0].say(), /turned off on this machine/, "OFF now reads as a person's choice");
});

test("a protocol-2 session is recognised by its environment or its flags, and its flags are handed on", () => {
  assert.equal(protocolTwo({ ORBIT_HOST_PROTOCOL: "2" }), true);
  assert.equal(protocolTwo({}, ["--host=codex", "--protocol=2"]), true);
  assert.equal(protocolTwo({}, []), false);
  assert.deepEqual(hostFlags(["--for=x", "--host=codex", "--protocol=2", "--json"]), ["--host=codex", "--protocol=2"]);
});

// A checkout the observer can learn a pattern from by file names alone.
const FILES = ["src/Infrastructure/OrderRepository.cs", "src/Infrastructure/CustomerRepository.cs", "src/Infrastructure/InvoiceRepository.cs", "src/Domain/IRepository.cs", "README.md"];

function checkout(name) {
  const dir = join(temp, name);
  for (const f of FILES) {
    mkdirSync(join(dir, dirname(f)), { recursive: true });
    writeFileSync(join(dir, f), "//\n");
  }
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "add", "-A"]);
  execFileSync("git", ["-C", dir, "-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "init"]);
  return dir;
}

const storeOf = (name) => join(temp, `${name}-store`);
const envOf = (name, extra = {}) => Object.fromEntries(Object.entries(sealed({ ORBIT_STORE_DIR: storeOf(name), ...extra })).filter(([k]) => k !== "CLAUDE_PROJECT_DIR"));
const hook = (dir, env, input, argv = []) => spawnSync(process.execPath, [join(ROOT, "cli", "learn-hook.mjs"), ...argv], { cwd: dir, env, input: JSON.stringify({ session_id: "sess-1", cwd: dir, ...input }), encoding: "utf8" });
const cli = (dir, env, name, args = []) => spawnSync(process.execPath, [join(ROOT, "cli", `${name}.mjs`), ...args], { cwd: dir, env, encoding: "utf8" });
const edit = (dir) => ({ hook_event_name: "PostToolUse", tool_name: "Edit", tool_input: { file_path: join(dir, "src/Infrastructure/OrderRepository.cs") } });
const commit = { hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "git commit -am wip" } };
const filesUnder = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }) : []);

test("a checkout nobody used Orbit in is not observed: the hooks write nothing about it", () => {
  const dir = checkout("unknown");
  const env = envOf("unknown");
  for (const input of [{ hook_event_name: "SessionStart" }, edit(dir), commit]) assert.equal(hook(dir, env, input).status, 0);
  assert.deepEqual(filesUnder(storeOf("unknown")).filter((f) => !String(f).startsWith("control") && !String(f).startsWith("state")), [], "no project room, no working set, no fact");
  assert.match(cli(dir, env, "engineering", ["facts"]).stdout, /nothing has recorded/);
});

test("once a person used Orbit there, the same hooks learn -- on by default, at a milestone, never stronger than possible", () => {
  const dir = checkout("known");
  const env = envOf("known");
  assert.equal(cli(dir, env, "help").status, 0, "the person's /orbit-help binds the checkout");
  assert.equal(hook(dir, env, edit(dir)).status, 0);
  assert.match(cli(dir, env, "engineering", ["facts"]).stdout, /nothing has recorded/, "one edit is not a milestone");
  assert.equal(hook(dir, env, commit).status, 0);
  assert.match(cli(dir, env, "engineering", ["facts"]).stdout, /observed\s+fresh\s+possible\s+pattern\s+repository is a pattern/);
});

test("a known checkout with ORBIT_ENGINEERING_OBSERVE=off learns nothing", () => {
  const dir = checkout("off");
  const env = envOf("off", { ORBIT_ENGINEERING_OBSERVE: "off" });
  assert.equal(cli(dir, env, "help").status, 0);
  hook(dir, env, edit(dir));
  hook(dir, env, commit);
  assert.match(cli(dir, env, "engineering", ["facts"]).stdout, /nothing has recorded/);
});

// Codex's own payloads: an apply_patch edit, then the end of the session. Its hook budget is two seconds, so the
// checkpoint is queued and drained by a process of its own -- and by the session's next command if that one let go.
test("a Codex session is no longer a blind spot: its checkpoint is drained and the session is learned from", async () => {
  const dir = checkout("codex");
  const env = envOf("codex");
  assert.equal(cli(dir, env, "help").status, 0);
  const codex = ["--host=codex", "--protocol=2"];
  const patch = { hook_event_name: "PostToolUse", turn_id: "t-1", tool_use_id: "u-1", tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Update File: src/Infrastructure/OrderRepository.cs\n*** End Patch" } };
  assert.equal(hook(dir, env, patch, codex).status, 0);
  assert.equal(hook(dir, env, { hook_event_name: "SessionEnd" }, codex).status, 0);
  const bound = { ...env, ORBIT_HOST: "codex", ORBIT_HOST_PROTOCOL: "2", ORBIT_SESSION: hostSession("codex", "sess-1") };
  const drained = cli(dir, bound, "finalize", ["--hook"]);
  assert.equal(drained.status, 0);
  assert.equal(drained.stdout, "", "a hook's drain says nothing");
  let facts = "";
  for (let i = 0; i < 50 && !/repository is a pattern/.test(facts); i += 1) {
    facts = cli(dir, env, "engineering", ["facts"]).stdout;
    if (!/repository is a pattern/.test(facts)) await new Promise((done) => setTimeout(done, 200));
  }
  assert.match(facts, /observed\s+fresh\s+possible\s+pattern\s+repository is a pattern/, "the session's end was the milestone");
  const said = traceLog(stateRooms(storeOf("codex")), realIo()).read().filter((e) => e.type === "learning.observed");
  assert.ok(said.some((e) => e.data.milestone === "SESSION_END" && e.data.accepted > 0), "the trail says the observer ran, and how much it kept");
  assert.ok(said.every((e) => !JSON.stringify(e).includes(dir)), "and never where");
});

test("finalize --hook outside any project, or for a checkout nobody knows, is silent and exits 0", () => {
  const loose = join(temp, "nowhere");
  mkdirSync(loose);
  const r = cli(loose, envOf("nowhere"), "finalize", ["--hook"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, "");
  const dir = checkout("unbound-drain");
  const unbound = cli(dir, envOf("unbound-drain", { ORBIT_HOST: "codex", ORBIT_HOST_PROTOCOL: "2", ORBIT_SESSION: hostSession("codex", "sess-1") }), "finalize");
  assert.equal(unbound.status, 0, unbound.stderr);
  assert.equal(unbound.stdout.trim(), "[]", "nothing is drained for a checkout the machine does not know");
});

test("the trail's learning.observed keeps counts and words only: an undeclared field never reaches it", () => {
  const e = eventOf("learning.observed", { host: "laptop", milestone: "COMMITTED", operation: "task:tsk-0123456789ab", candidates: 3, accepted: 2, path: "/Users/someone/repo/src/a.cs", statement: "a fact" }, { id: "e-1", at: "2026-10-18T00:00:00.000Z" });
  assert.deepEqual(Object.keys(e.data).sort(), ["accepted", "candidates", "host", "milestone", "operation"]);
});

test("engineering doctor says what is on, who set it, what ran per host, and the findings a refusal left", () => {
  const eng = { observations: () => [{ at: "2026-10-18T01:00:00.000Z", seenBy: { host: "codex" } }, { at: "2026-10-18T02:00:00.000Z", seenBy: { host: "codex" } }, { at: "2026-10-17T09:00:00.000Z", seenBy: { host: "claude" } }], findings: () => [{ at: "t1", kind: "observer-candidate-refused", candidateKey: "verified-by-test-x", say: "scope \"src/new\" matches no tracked file" }, { at: "t2", kind: "lock-broken", say: "not the doctor's" }] };
  const view = doctorView({ eng, switches: () => [{ name: "engineering_observe", on: true, source: "default" }], queue: () => ({ pending: 1, leased: 0 }) });
  assert.deepEqual(view.observations, [{ host: "claude", count: 1, last: "2026-10-17T09:00:00.000Z" }, { host: "codex", count: 2, last: "2026-10-18T02:00:00.000Z" }]);
  assert.deepEqual(view.findings.map((f) => f.kind), ["observer-candidate-refused"], "only the observer's own findings");
  assert.deepEqual(FINDING_KINDS, ["subscriber-failed", "observer-candidate-refused"]);
  const dir = checkout("doctor");
  const env = envOf("doctor", { ORBIT_ENGINEERING_OBSERVE: "off" });
  const shown = cli(dir, env, "engineering", ["doctor"]);
  assert.equal(shown.status, 0, shown.stderr);
  assert.match(shown.stdout, /engineering_observe\s+off\s+\(ORBIT_ENGINEERING_OBSERVE\)/, "a person's switch, and where it came from");
  assert.ok(!existsSync(join(storeOf("doctor"))) || filesUnder(storeOf("doctor")).every((f) => !String(f).includes("engineering")), "the doctor reads, and writes nothing");
});
