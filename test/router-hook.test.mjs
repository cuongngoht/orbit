// cli/router-hook.mjs as the host runs it: a process, a JSON payload on stdin,
// and whatever it prints. Two promises are held here that no unit test can
// hold: it ALWAYS exits 0 with the prompt untouched, whatever is broken, and
// the prompt it was handed is nowhere on disk afterwards.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUTOMATION_SCHEMA } from "../src/automation/settings.mjs";
import { dispatch } from "../src/lifecycle/dispatch.mjs";
import { router } from "../src/lifecycle/subscribers/router.mjs";
import { mcpCatalog } from "../src/mcp/catalog.mjs";
import { addFromCatalog } from "../src/mcp/manage.mjs";
import { createMcpState, observedAs } from "../src/mcp/state.mjs";
import { hostSession } from "../src/memory/session.mjs";
import { stateRooms, writeState } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { EMPTY_HOME, EMPTY_TMP, sealed } from "./home.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = join(REPO, "cli", "router-hook.mjs");
const OBSERVE = join(REPO, "cli", "resources.mjs");
const SECRET = "SECRET-PROMPT-7f3a9c";

function storeDir(t) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-router-store-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const CATALOG = mcpCatalog(JSON.parse(readFileSync(join(REPO, "catalog", "mcp.json"), "utf8")));
const stateAt = (store) => createMcpState(stateRooms(store), realIo());
const learnManaged = (store) => addFromCatalog({ state: stateAt(store), catalog: CATALOG, now: () => new Date().toISOString() }, "microsoft-learn");
const learnInHost = (store) => stateAt(store).change("external", (doc) => observedAs(doc, "claude", [{ id: "microsoft-learn", name: "microsoft-learn", host: "claude", scope: "user", transport: "http", url: "https://learn.microsoft.com/api/mcp", args: [], headers: [], env: [], hostEnabled: true, status: "unknown" }], new Date().toISOString()));

const payload = (prompt, cwd = EMPTY_TMP) => JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: "session-raw-1", cwd, prompt });

function hook(input, env) {
  const r = spawnSync(process.execPath, [HOOK], { input, env: sealed(env), encoding: "utf8", cwd: EMPTY_TMP, timeout: 20000 });
  return { code: r.status, out: r.stdout, err: r.stderr, json: r.stdout ? JSON.parse(r.stdout) : null };
}

test("a documentation prompt gets the Microsoft Learn Orbit manages as additionalContext, with how to reach it", (t) => {
  const store = storeDir(t);
  learnManaged(store);
  const r = hook(payload("How does EF Core ExecuteUpdateAsync work?"), { ORBIT_STORE_DIR: store });
  assert.equal(r.code, 0);
  assert.equal(r.json.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  const context = r.json.hookSpecificOutput.additionalContext;
  assert.match(context, /Relevant and available here:\n(.*\n)*- microsoft-learn \(MCP, Orbit-managed\)/);
  assert.match(context, /reach it through: node .*cli[\\/]mcp\.mjs call <server> <tool>/);
  assert.ok(Buffer.byteLength(context) <= 2048);
});

test("the SAME server configured only in the host is observed, never offered as usable", (t) => {
  const store = storeDir(t);
  learnInHost(store);
  const context = hook(payload("How does EF Core ExecuteUpdateAsync work?"), { ORBIT_STORE_DIR: store }).json.hookSpecificOutput.additionalContext;
  assert.doesNotMatch(context, /Relevant and available here:\n(- .*\n)*- microsoft-learn/);
  assert.match(context, /Relevant, but not usable here:\n(- .*\n)*- microsoft-learn \(MCP\).*Orbit does not route to it/);
});

test("a prompt that requires nothing, a router switched off, and a payload that is not a prompt all print nothing", (t) => {
  const store = storeDir(t);
  for (const [input, env] of [[payload("hello"), {}], [payload("How does EF Core work?"), { ORBIT_PROMPT_ROUTER: "off" }], [payload("How does EF Core work?"), { CLAUDE_PLUGIN_OPTION_PROMPT_ROUTER: "false" }], [JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Read" }), {}]]) {
    const r = hook(input, { ORBIT_STORE_DIR: store, ...env });
    assert.deepEqual([r.code, r.out], [0, ""], input);
  }
});

test("FAIL OPEN: garbage stdin, a corrupt snapshot, no project, and a store that cannot be named all exit 0", (t) => {
  const store = storeDir(t);
  const rooms = stateRooms(store);
  mkdirSync(rooms.mcp, { recursive: true });
  mkdirSync(rooms.tools, { recursive: true });
  writeFileSync(join(rooms.mcp, "observed.json"), "{ this is not json");
  writeFileSync(join(rooms.mcp, "managed.json"), "{ neither is this");
  writeFileSync(join(rooms.tools, "observed.json"), JSON.stringify({ schema: 99, tools: {} }));
  const cases = [["not json at all", { ORBIT_STORE_DIR: store }], ["", { ORBIT_STORE_DIR: store }], [payload("check architecture of this project"), { ORBIT_STORE_DIR: store }], [payload("check architecture of this project", "/no/such/project/anywhere"), { ORBIT_STORE_DIR: store }], [payload("check architecture"), { ORBIT_MEMORY_DIR: "/retired" }]];
  for (const [input, env] of cases) {
    const r = hook(input, env);
    assert.equal(r.code, 0, `${input} ${JSON.stringify(env)}: ${r.err}`);
    assert.equal(r.err, "", "nothing on stderr either: the host shows stderr to the person");
  }
  assert.match(hook(payload("check architecture of this project"), { ORBIT_STORE_DIR: store }).out, /orbit-architecture/, "a corrupt MCP snapshot costs MCP, not the skills");
});

test("a router whose registry throws is isolated by the dispatcher: no output, no error", () => {
  const world = { routing: () => true, resources: () => { throw new Error("resolver bug"); }, host: { formatPromptContext: (t) => ({ t }) } };
  assert.equal(dispatch({ event: "user-prompt", prompt: "review PR 1" }, world, [router]), null);
});

test("the prompt is never written: not to the store, not to the working set, not to a temp file", (t) => {
  const store = storeDir(t);
  learnManaged(store);
  const before = snapshot([store, EMPTY_HOME, EMPTY_TMP]);
  const r = hook(payload(`How does EF Core ExecuteUpdateAsync work? my key is ${SECRET} password=${SECRET}`), { ORBIT_STORE_DIR: store, ORBIT_TRACE: "off" });
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, new RegExp(SECRET), "not even echoed into the context");
  const after = snapshot([store, EMPTY_HOME, EMPTY_TMP]);
  assert.deepEqual(after.filter((f) => !before.includes(f)), [], "with the session trail off, the hook wrote no file at all");
  for (const f of files([store, EMPTY_HOME, EMPTY_TMP])) assert.equal(readFileSync(f, "utf8").includes(SECRET), false, f);
});

// With the session trail ON (the default), the router hook writes exactly the
// trail's shard and its salt -- and neither holds a word of what was typed.
test("with the session trail on, the only thing written is one prompt event that carries no fragment of the prompt", (t) => {
  const store = storeDir(t);
  learnManaged(store);
  const before = snapshot([store, EMPTY_HOME, EMPTY_TMP]);
  const r = hook(payload(`How does EF Core ExecuteUpdateAsync work? my key is ${SECRET} password=${SECRET}`), { ORBIT_STORE_DIR: store });
  assert.equal(r.code, 0);
  const written = snapshot([store, EMPTY_HOME, EMPTY_TMP]).filter((f) => !before.includes(f));
  assert.deepEqual(written.map((f) => f.replace(/\\/g, "/").replace(/^.*\/control\/activity\/trace\//, "trace/").replace(/\d{4}-\d{2}-\d{2}-.*\.jsonl$/, "<day>-<host>.jsonl")).sort(), ["trace/<day>-<host>.jsonl", "trace/salt"]);
  const events = readFileSync(written.find((f) => f.endsWith(".jsonl")), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual([events.length, events[0].type, events[0].data.routing, typeof events[0].data.prompt.hash, events[0].data.prompt.chars > 0], [1, "prompt.submitted", "on", "string", true]);
  for (const f of files([store, EMPTY_HOME, EMPTY_TMP])) assert.equal(readFileSync(f, "utf8").includes(SECRET), false, f);
  for (const word of ["ExecuteUpdateAsync", "password", "session-raw-1"]) assert.equal(JSON.stringify(events).includes(word), false, `${word} reached the trail`);
});

test("the session-start observer saves both snapshots, prints nothing, and does nothing when the router is off", (t) => {
  const store = storeDir(t);
  const run = (env) => spawnSync(process.execPath, [OBSERVE, "observe", "--hook"], { input: JSON.stringify({ hook_event_name: "SessionStart", cwd: EMPTY_TMP }), env: sealed({ ORBIT_STORE_DIR: store, PATH: "", ...env }), encoding: "utf8", cwd: EMPTY_TMP, timeout: 30000 });
  const off = run({ ORBIT_PROMPT_ROUTER: "off" });
  assert.deepEqual([off.status, off.stdout], [0, ""]);
  assert.deepEqual(files([store]), []);
  const on = run({});
  assert.deepEqual([on.status, on.stdout], [0, ""]);
  const rooms = stateRooms(store);
  const mcp = JSON.parse(readFileSync(join(rooms.mcp, "external.json"), "utf8"));
  const tools = JSON.parse(readFileSync(join(rooms.tools, "observed.json"), "utf8"));
  assert.deepEqual([mcp.schema, mcp.host, mcp.servers], [3, "claude", []], "the host's servers are saved as EXTERNAL");
  assert.equal(existsSync(join(rooms.mcp, "managed.json")), false, "an observation owns nothing");
  assert.equal(tools.tools.sqlcmd.status, "missing", "an empty PATH finds nothing, and says so");
});

function files(roots) {
  return roots.flatMap((r) => walk(r));
}

function walk(dir) {
  let names;
  try { names = readdirSync(dir); }
  catch { return []; }
  return names.flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
}

const snapshot = (roots) => files(roots).sort();

// Declared twice -- the settings dialog's default and the hook's fallback -- so
// the two are held together, the way plugin-options.test.mjs holds the others.
test("hooks.json wires UserPromptSubmit to the router and an async session-start observer, and prompt_router defaults on", () => {
  const hooks = JSON.parse(readFileSync(join(REPO, "hooks", "hooks.json"), "utf8")).hooks;
  const prompt = hooks.UserPromptSubmit.flatMap((h) => h.hooks);
  assert.deepEqual(prompt.map((h) => h.command), ['node "${CLAUDE_PLUGIN_ROOT}/cli/router-hook.mjs"']);
  assert.ok(prompt[0].timeout <= 10, "the hot path has a short leash");
  const observer = hooks.SessionStart.flatMap((h) => h.hooks).find((h) => h.command.includes("resources.mjs"));
  assert.deepEqual([observer.async, observer.command.endsWith("observe --hook")], [true, true]);
  const option = JSON.parse(readFileSync(join(REPO, ".claude-plugin", "plugin.json"), "utf8")).userConfig.prompt_router;
  assert.deepEqual([option.type, option.default], ["boolean", true]);
  for (const file of ["cli/router-hook.mjs", "cli/resources.mjs"]) assert.match(readFileSync(join(REPO, file), "utf8"), /"PROMPT_ROUTER", "prompt_router", true/, file);
});

// ---- router v3 (0.5.0, B22 M2, ADR 0050): how much Orbit, said in one line, or nothing at all ----------------

const trailOf = (store) => readdirSync(join(stateRooms(store).trace)).filter((n) => n.endsWith(".jsonl")).flatMap((n) => readFileSync(join(stateRooms(store).trace, n), "utf8").trim().split("\n")).map((l) => JSON.parse(l));
const lastPrompt = (store) => trailOf(store).filter((e) => e.type === "prompt.submitted").at(-1).data;
const NOTIFICATION = JSON.parse(readFileSync(join(REPO, "test", "fixtures", "hooks", "claude", "UserPromptSubmit-task-notification.json"), "utf8")).input;

test("a prompt the host wrote itself -- a background task's notification -- gets nothing, and the trail says so", (t) => {
  const store = storeDir(t);
  const r = hook(JSON.stringify({ ...NOTIFICATION, cwd: EMPTY_TMP }), { ORBIT_STORE_DIR: store });
  assert.deepEqual([r.code, r.out, r.err], [0, "", ""], "its report said investigate, explore and regression, and it is still nobody's request");
  const said = lastPrompt(store);
  assert.deepEqual([said.routing, said.synthetic, said.strategy, said.activation, said.injected], ["on", true, { word: "NONE", row: "envelope" }, { path: "none", id: null }, false]);
  assert.deepEqual([said.intent, said.selected], ["general", []], "it was not classified at all");
  const off = storeDir(t);
  hook(JSON.stringify({ ...NOTIFICATION, cwd: EMPTY_TMP }), { ORBIT_STORE_DIR: off, ORBIT_PROMPT_ROUTER: "off" });
  assert.deepEqual([lastPrompt(off).routing, lastPrompt(off).synthetic], ["off", true], "with routing off the trail still knows it was the host's");
});

test("a greeting, a status question and an opt-out get no text at all, in either language, and the trail keeps the strategy", (t) => {
  const store = storeDir(t);
  for (const [prompt, row] of [["hello", "conversational"], ["how far along are we?", "conversational"], ["tới đâu rồi, report sao rồi?", "conversational"], ["without orbit, rename qty to quantity in orders.mjs", "opted-out"], ["không dùng orbit, đổi tên qty thành quantity", "opted-out"]]) {
    const r = hook(payload(prompt), { ORBIT_STORE_DIR: store });
    assert.deepEqual([r.code, r.out], [0, ""], prompt);
    assert.deepEqual(lastPrompt(store).strategy, { word: "NONE", row }, prompt);
  }
});

test("a request one specialist answers opens with ONE strategy line, then every line it had, and no coordination advice", (t) => {
  const store = storeDir(t);
  const context = hook(payload("check architecture of this project"), { ORBIT_STORE_DIR: store }).json.hookSpecificOutput.additionalContext;
  assert.match(context, /^Orbit strategy: DIRECT -- one specialist provides architecture\.context: Skill orbit:orbit-architecture\.\nOrbit routing context\nIntent: architecture/);
  assert.doesNotMatch(context, /Orbit coordinates a task by default/, "advice is for a coordinated workflow alone");
  assert.ok(Buffer.byteLength(context) <= 2048);
  assert.deepEqual(lastPrompt(store).activation, { path: "skill", id: "orbit-architecture" });
});

test("a change that spans a work item is COORDINATED, with its one command and the advice -- and neither once a person said the router may not", (t) => {
  const store = storeDir(t);
  const context = hook(payload("Implement PBI 4312"), { ORBIT_STORE_DIR: store }).json.hookSpecificOutput.additionalContext;
  assert.match(context, /^Orbit strategy: COORDINATED -- a change several owners take in turn \(development, requirements\): orbit-help starts the workflow: node \S+cli[\\/]automation\.mjs start --for="<the task>"\./);
  assert.match(context, /\nOrbit coordinates a task by default: a workflow could take this/);
  assert.ok(Buffer.byteLength(context) <= 2048);
  writeState(realIo(), join(stateRooms(store).automation, "settings.json"), { trigger: { arbitraryPrompt: false } }, AUTOMATION_SCHEMA);
  const held = hook(payload("Implement PBI 4312"), { ORBIT_STORE_DIR: store });
  assert.equal(lastPrompt(store).strategy.word, "DIRECT");
  assert.doesNotMatch(held.out, /COORDINATED|Orbit coordinates a task by default/);
});

// The tracked work a person continues, in a REAL Git checkout and store, as cli/track.mjs left it.
function trackedRepo(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-router-resume-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const checkout = join(dir, "repo");
  execFileSync("git", ["init", "-q", checkout], { env: sealed() });
  execFileSync("git", ["-C", checkout, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  return { checkout, store: join(dir, "store") };
}

const tracking = (p, args) => JSON.parse(execFileSync(process.execPath, [join(REPO, "cli", "track.mjs"), ...args, "--json"], { cwd: p.checkout, env: sealed({ ORBIT_STORE_DIR: p.store, ORBIT_TRACE: "off", ORBIT_SESSION: hostSession("claude", "session-raw-1") }), encoding: "utf8" }));

test("an open work this checkout tracked under the reference the prompt names is RESUMEd through its owner's read; a closed one is not", (t) => {
  const p = trackedRepo(t);
  const work = tracking(p, ["track", "the refund approval rule", "--ref=ORD-12"]).work;
  tracking(p, ["link", work, "--workflow=tsk-0123456789ab"]);
  const resumed = hook(payload("Continue ORD-12.", p.checkout), { ORBIT_STORE_DIR: p.store }).json.hookSpecificOutput.additionalContext;
  assert.match(resumed, new RegExp(`^Orbit strategy: RESUME -- open work ${work} is governed by workflow tsk-0123456789ab: node \\S+cli[\\\\/]automation\\.mjs resume tsk-0123456789ab\\.`));
  assert.deepEqual(lastPrompt(p.store).activation, { path: "resume", id: work });
  const mine = hook(payload("continue", p.checkout), { ORBIT_STORE_DIR: p.store });
  assert.match(mine.out, /RESUME/, "this session's own work, and the prompt said continue");
  assert.equal(hook(payload("continue", p.checkout).replace("session-raw-1", "another-session"), { ORBIT_STORE_DIR: p.store }).out, "", "another session's work is not this one's to continue");
  tracking(p, ["state", work, "--state=cancelled"]);
  assert.equal(hook(payload("Continue ORD-12.", p.checkout), { ORBIT_STORE_DIR: p.store }).out, "", "a cancelled work is not picked up again");
});

// The lookup reads journals in the hot path, and must leave the store and the checkout exactly as it found them.
const contents = (roots) => Object.fromEntries(files(roots).filter((f) => !/[\\/]\.git[\\/]/.test(f)).map((f) => [f, readFileSync(f, "utf8")]));

test("looking for the open work a prompt names or continues reads the journals and writes nothing", (t) => {
  const p = trackedRepo(t);
  const work = tracking(p, ["track", "the refund approval rule", "--ref=ORD-12"]).work;
  tracking(p, ["link", work, "--workflow=tsk-0123456789ab"]);
  const before = contents([p.store, p.checkout]);
  for (const prompt of ["Continue ORD-12.", "continue", "fix bug ORD-77 in the invoice export", "continue PBI-482"]) assert.equal(hook(payload(prompt, p.checkout), { ORBIT_STORE_DIR: p.store, ORBIT_TRACE: "off" }).code, 0, prompt);
  assert.deepEqual(contents([p.store, p.checkout]), before, "no file created, removed or changed");
});
