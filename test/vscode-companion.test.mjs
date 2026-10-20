// THE VS CODE COMPANION (integrations/vscode-orbit-live, 1.8.5): Orbit Live split beside the terminal an AI CLI runs in,
// through VS Code's own Terminal API -- tested against a fake of that API and a real store on disk. It opens Orbit's
// viewer and nothing else, beside the terminal whose shell is among the asking process's ancestors, gives that
// terminal the keyboard back, leaves another window's request alone, and never opens one request twice.
// An AI agent runs as the person, so from inside its sandbox it can write files they own; the companion runs outside
// it. So what runs is never a request's: `node` is the one the person named, and the viewer is a Orbit install inside a
// host's own plugin folder, whole and nobody else's to write. Requests come only from the person's stores (a workspace
// cannot name one), from a room and a file of theirs nobody else may write (never through a link), and speak only for
// the store they were left in. Then the engine's half: `live open` in a VS Code terminal leaves the request (and
// nothing is started from there), and the companion opens it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { createCompanion, requestOk } = require("../integrations/vscode-orbit-live/companion.js");
const fs = require("node:fs");

// Folders and files made here are what a plugin manager makes under the usual umask: nobody else may write them. (A
// umask that lets a group write is refused by the companion, and its own test says so.)
process.umask(0o022);

const NOW = Date.parse("2026-10-15T07:00:00.000Z");
const LEASE = `--lease=${"a".repeat(16)}.${"b".repeat(16)}`;
const TASK = "tsk-0123456789ab";
const UID = typeof process.getuid === "function" ? process.getuid() : undefined;
const NO_BITS = UID === undefined && "Windows keeps no owner or mode bits";
// The node a person names in `orbit.live.nodePath` is theirs (or root's) and writable by nobody else, or the companion
// refuses it -- rightly. The node running this suite usually is; a CI runner's tool cache is not (GitHub's images leave
// it writable by everyone), so there the person's node is a copy of it kept the way an installed node is kept.
const ownOnly = (st) => (st.uid === UID || st.uid === 0) && (st.mode & 0o022) === 0;

function personsNode() {
  const real = realpathSync(process.execPath);
  if (UID === undefined || ownOnly(fs.statSync(real))) return real;
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-node-")));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  cpSync(real, join(dir, path.basename(real)));
  chmodSync(join(dir, path.basename(real)), 0o755);
  return join(dir, path.basename(real));
}

const PERSONS_NODE = personsNode();
const NODE = PERSONS_NODE;

// VS Code, as far as the companion asks it: the window's terminals (each with its shell's pid), what was created, what
// it was told, and the settings -- the person's own values, and what a workspace says, which `get` would merge in.
function fakeVscode(pids = [4321], user = {}, workspace = {}) {
  const created = [];
  const shown = [];
  const warned = [];
  const terminals = pids.map((pid) => ({ pid, processId: Promise.resolve(pid), show: (keep) => shown.push({ pid, keep }) }));
  const window = { terminals, showWarningMessage: (m) => warned.push(m), createTerminal: (o) => (created.push(o), { show: (keep) => shown.push({ viewer: true, keep }) }) };
  const inspect = (k) => ({ key: `orbit.live.${k}`, globalValue: user[k], workspaceValue: workspace[k] });
  const get = (k) => workspace[k] ?? user[k];
  return { created, shown, warned, terminals, api: { window, workspace: { getConfiguration: () => ({ inspect, get }) } } };
}

// A Orbit install as a plugin manager leaves one: its manifest, its viewer and the modules it imports.
function installed(root, name = "orbit") {
  mkdirSync(join(root, "cli"), { recursive: true });
  mkdirSync(join(root, "src", "live"), { recursive: true });
  writeFileSync(join(root, "plugin.json"), JSON.stringify({ name, version: "1.8.5" }));
  writeFileSync(join(root, "cli", "live.mjs"), 'import "../src/live/view.mjs";\n');
  writeFileSync(join(root, "src", "live", "view.mjs"), "// Orbit Live\n");
  return root;
}

const hostFolder = (home) => join(home, ".codex", "plugins", "cache");

function world(t, over = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-vscode-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = join(dir, "store");
  const home = join(dir, "home");
  const v = fakeVscode(over.pids, { storeDirs: [store], nodePath: PERSONS_NODE });
  const timers = [];
  const deps = { vscode: v.api, fs, path, os: { homedir: () => home }, env: {}, pid: over.pid ?? 777, uid: UID, now: () => over.now ?? NOW, every: (ms, fn) => (timers.push({ ms, fn }), () => timers.splice(timers.findIndex((x) => x.fn === fn), 1)) };
  const plugin = installed(join(hostFolder(home), "orbit", "orbit", "2.0.0"));
  return { dir, store, home, plugin, v, deps, timers, requests: join(store, "control", "live", "requests"), checkout: join(dir, "checkout") };
}

const script = (w) => join(w.plugin, "cli", "live.mjs");

const request = (w, over = {}) => ({ version: 1, kind: "open-viewer", argv: [process.execPath, script(w), "tui", TASK, LEASE], cwd: w.checkout, env: { ORBIT_STORE_DIR: w.store, ORBIT_SESSION: "codex:0123456789abcdef" }, ancestry: [9001, 4321, 1], width: 36, focusCli: true, at: new Date(NOW - 2000).toISOString(), ...over });

// A request left as Orbit leaves one: a file of yours that nobody else may write, unless `mode` says otherwise.
function left(w, name, r, mode = 0o644, room = w.requests) {
  mkdirSync(room, { recursive: true });
  mkdirSync(w.checkout, { recursive: true });
  writeFileSync(join(room, `${name}.json`), JSON.stringify(r));
  chmodSync(join(room, `${name}.json`), mode);
  return join(room, `${name}.json`);
}

// What an agent running as the person can write inside its sandbox: a `node` of its own and a whole Orbit of its own,
// both the person's files, writable by them alone.
function planted(w) {
  const bin = join(w.dir, "sandbox", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "node"), "#!/bin/sh\ntouch escaped\n");
  chmodSync(join(bin, "node"), 0o755);
  return { node: join(bin, "node"), script: join(installed(join(w.dir, "sandbox", "orbit")), "cli", "live.mjs") };
}

test("a request beside a terminal of this window opens Orbit's viewer in a split of THAT terminal and gives it the keyboard back", async (t) => {
  const w = world(t);
  const file = left(w, "viewer-k1", request(w));
  const c = createCompanion(w.deps);
  assert.deepEqual(await c.tick(), ["opened"]);
  assert.equal(w.v.created.length, 1);
  const o = w.v.created[0];
  assert.equal(o.location.parentTerminal, w.v.terminals[0], "a split of the asking terminal's group");
  assert.deepEqual([o.shellPath, ...o.shellArgs], [NODE, script(w), "tui", TASK, LEASE], "your node and the installed viewer, as resolved");
  assert.deepEqual([o.cwd, o.env, o.name], [w.checkout, request(w).env, "Orbit Live"]);
  assert.deepEqual(w.v.shown, [{ viewer: true, keep: true }, { pid: 4321, keep: false }], "the viewer shown without the keyboard, the CLI's terminal given it");
  assert.equal(existsSync(file), false, "taken once");
  assert.deepEqual(w.v.warned, []);
  c.dispose();
});

test("anything but Orbit's own viewer, with Orbit's own variables, asked now, is refused and removed -- nothing is started", async (t) => {
  const w = world(t);
  mkdirSync(join(w.dir, "other-store"), { recursive: true });
  const bad = {
    shell: request(w, { argv: ["/bin/sh", "-c", "touch /tmp/x"] }),
    other: request(w, { argv: [process.execPath, join(w.plugin, "cli", "run-case.mjs"), "tui"] }),
    extra: request(w, { argv: [process.execPath, script(w), "tui", "--x;rm -rf ~"] }),
    nowhere: request(w, { argv: [process.execPath, join(w.dir, "elsewhere", "cli", "live.mjs"), "tui"] }),
    env: request(w, { env: { NODE_OPTIONS: "--require /tmp/evil.js" } }),
    otherStore: request(w, { env: { ORBIT_STORE_DIR: join(w.dir, "other-store") } }),
    control: request(w, { cwd: `${w.checkout}\u0007` }),
    relative: request(w, { cwd: "checkout" }),
    kind: request(w, { kind: "run-command" }),
    future: request(w, { at: new Date(NOW + 120_000).toISOString() }),
    deep: request(w, { ancestry: Array.from({ length: 33 }, (_, i) => 4321 + i) }),
    noChain: request(w, { ancestry: [] }),
  };
  for (const [name, r] of Object.entries(bad)) left(w, name, r);
  left(w, "garbage", "not a request");
  const c = createCompanion(w.deps);
  assert.deepEqual(await c.tick(), []);
  assert.equal(w.v.created.length, 0);
  assert.deepEqual(readdirSync(w.requests), [], "each refused whole and removed");
  for (const [name, r] of Object.entries(bad)) assert.equal(requestOk(w.deps, r, w.store), false, name);
  c.dispose();
});

test("a request no terminal of this window answers is left for another window; one older than a minute is removed", async (t) => {
  const w = world(t, { pids: [5555] });
  const theirs = left(w, "theirs", request(w));
  const stale = left(w, "stale", request(w, { at: new Date(NOW - 120_000).toISOString() }));
  const c = createCompanion(w.deps);
  assert.deepEqual(await c.tick(), []);
  assert.equal(existsSync(theirs), true, "another window's companion may own it");
  assert.equal(existsSync(stale), false, "nobody took it in time");
  assert.equal(w.v.created.length, 0);
  c.dispose();
});

test("two windows that both see the request open it once: the first to claim it", async (t) => {
  const w = world(t);
  left(w, "viewer-k1", request(w));
  const other = fakeVscode([4321], { storeDirs: [w.store], nodePath: PERSONS_NODE });
  const a = createCompanion(w.deps);
  const b = createCompanion({ ...w.deps, vscode: other.api, pid: 888 });
  const both = await Promise.all([a.tick(), b.tick()]);
  assert.equal(both.flat().length, 1);
  assert.equal(w.v.created.length + other.created.length, 1);
  a.dispose();
  b.dispose();
});

test("a person who keeps the keyboard in the viewer: the CLI's terminal is not refocused", async (t) => {
  const w = world(t);
  left(w, "viewer-k1", request(w, { focusCli: false }));
  const c = createCompanion(w.deps);
  await c.tick();
  assert.deepEqual(w.v.shown, [{ viewer: true, keep: true }]);
  c.dispose();
});

test("it says it is there by a heartbeat in each store's live room, and takes it away when it stops", async (t) => {
  const w = world(t);
  const c = createCompanion(w.deps);
  c.heartbeat();
  const beat = join(w.store, "control", "live", "companions", "vscode-777.json");
  const doc = JSON.parse(readFileSync(beat, "utf8"));
  assert.deepEqual([doc.kind, doc.pid, doc.version, doc.heartbeatAt], ["vscode", 777, "1.8.5", new Date(NOW).toISOString()]);
  assert.ok(existsSync(join(w.home, ".orbit", "projects", "control", "live", "companions", "vscode-777.json")), "the default store too");
  assert.deepEqual(w.timers.map((x) => x.ms).sort((a, b) => a - b), [1000, 10000], "a poll and a heartbeat, nothing else");
  c.dispose();
  assert.equal(existsSync(beat), false);
  assert.equal(w.timers.length, 0);
});

// ---- what runs is never a request's ---------------------------------------------------------------------------------

test("an agent that runs as you cannot make it run what the agent wrote: its own Orbit is refused, its node is never used", async (t) => {
  const w = world(t);
  const agent = planted(w);
  const theirs = left(w, "viewer-theirs", request(w, { argv: [process.execPath, agent.script, "tui"] }));
  const c = createCompanion(w.deps);
  assert.deepEqual(await c.tick(), [], "a whole Orbit of the agent's own, outside every host's plugin folder");
  assert.equal(existsSync(theirs), false, "refused and removed");
  left(w, "viewer-node", request(w, { argv: [agent.node, script(w), "tui", TASK] }));
  assert.deepEqual(await c.tick(), ["opened"]);
  assert.equal(w.v.created[0].shellPath, NODE, "your node, never the one the request named");
  assert.equal(existsSync(join(w.checkout, "escaped")), false);
  c.dispose();
});

test("node is only the one you named: unset, nothing opens and you are told once; no PATH is searched; a workspace's is ignored", async (t) => {
  const w = world(t);
  const agent = planted(w);
  const unset = fakeVscode([4321], { storeDirs: [w.store] }, { nodePath: agent.node });
  const c = createCompanion({ ...w.deps, vscode: unset.api, env: { PATH: dirname(NODE) } });
  left(w, "viewer-1", request(w));
  left(w, "viewer-2", request(w));
  assert.deepEqual(await c.tick(), []);
  assert.equal(unset.created.length, 0, "neither the node on PATH nor the workspace's");
  assert.equal(unset.warned.length, 1, "told once");
  assert.match(unset.warned[0], /orbit\.live\.nodePath/);
  c.dispose();
});

test("Orbit runs only from a host's plugin folder: a checkout of it elsewhere, or another plugin named live.mjs, is never run", async (t) => {
  const w = world(t);
  const checkout = installed(join(w.dir, "Repo", "orbit"));
  const impostor = installed(join(hostFolder(w.home), "other", "tool", "1.0.0"), "tool");
  for (const [what, root] of [["a checkout elsewhere", checkout], ["a plugin that is not Orbit", impostor]]) {
    left(w, "viewer-k1", request(w, { argv: [process.execPath, join(root, "cli", "live.mjs"), "tui"] }));
    const c = createCompanion(w.deps);
    assert.deepEqual(await c.tick(), [], what);
    c.dispose();
  }
  assert.equal(w.v.created.length, 0);
});

test("the whole install is checked: a file or folder anywhere in it, or above it, that anybody may write -- never run", { skip: NO_BITS }, async (t) => {
  const loosened = {
    "a module the viewer imports": (w) => chmodSync(join(w.plugin, "src", "live", "view.mjs"), 0o666),
    "a folder inside the install": (w) => chmodSync(join(w.plugin, "src"), 0o777),
    "the install folder": (w) => chmodSync(w.plugin, 0o777),
    "a folder between the host's plugin folder and the install": (w) => chmodSync(join(hostFolder(w.home), "orbit"), 0o777),
  };
  for (const [what, loosen] of Object.entries(loosened)) {
    const w = world(t);
    loosen(w);
    left(w, "viewer-k1", request(w));
    const c = createCompanion(w.deps);
    assert.deepEqual(await c.tick(), [], what);
    assert.equal(w.v.created.length, 0, what);
    c.dispose();
  }
});

test("a link inside an install is held to its owner and never followed: an install that carries one still opens", { skip: NO_BITS }, async (t) => {
  const w = world(t);
  mkdirSync(join(w.plugin, ".agents"));
  symlinkSync("../cli", join(w.plugin, ".agents", "cli"));
  assert.equal(lstatSync(join(w.plugin, ".agents", "cli")).isSymbolicLink(), true);
  left(w, "viewer-k1", request(w));
  const c = createCompanion(w.deps);
  assert.deepEqual(await c.tick(), ["opened"]);
  c.dispose();
});

// ---- where requests come from ---------------------------------------------------------------------------------------

test("a repository cannot name a store: a workspace's orbit.live.storeDirs is ignored -- no request taken there, no heartbeat written", async (t) => {
  const w = world(t);
  const repoStore = join(w.dir, "repo", ".orbit");
  const v = fakeVscode([4321], { storeDirs: [w.store], nodePath: PERSONS_NODE }, { storeDirs: [repoStore] });
  const file = left(w, "viewer-k1", request(w, { env: { ORBIT_STORE_DIR: repoStore } }), 0o644, join(repoStore, "control", "live", "requests"));
  const c = createCompanion({ ...w.deps, vscode: v.api });
  assert.deepEqual(await c.tick(), []);
  assert.equal(v.created.length, 0, "nothing opened from a room a workspace named");
  assert.equal(existsSync(file), true, "and nothing there touched");
  assert.equal(existsSync(join(repoStore, "control", "live", "companions")), false, "no heartbeat written there");
  c.dispose();
});

test("a live room somebody else may write, another person's, or one that is a link, is not read at all", { skip: NO_BITS }, async (t) => {
  const open = world(t);
  const file = left(open, "viewer-k1", request(open));
  chmodSync(open.requests, 0o777);
  const c = createCompanion(open.deps);
  assert.deepEqual(await c.tick(), []);
  assert.equal(existsSync(file), true, "not read, not touched");
  c.dispose();
  const theirs = world(t);
  const kept = left(theirs, "viewer-k1", request(theirs));
  const someone = createCompanion({ ...theirs.deps, uid: UID + 1 });
  assert.deepEqual(await someone.tick(), [], "seen by a companion that runs as somebody else");
  assert.equal(existsSync(kept), true, "another person's room is theirs");
  someone.dispose();
  const linked = world(t);
  const elsewhere = join(linked.dir, "elsewhere");
  left(linked, "viewer-k1", request(linked), 0o644, elsewhere);
  mkdirSync(dirname(linked.requests), { recursive: true });
  symlinkSync(elsewhere, linked.requests);
  const d = createCompanion(linked.deps);
  assert.deepEqual(await d.tick(), []);
  assert.equal(linked.v.created.length, 0);
  d.dispose();
});

test("only a request file nobody but you could have written is taken: another person's is left alone, one anybody may write is refused", { skip: NO_BITS }, async (t) => {
  const w = world(t);
  const theirs = left(w, "viewer-theirs", request(w));
  const ownedBy = (uid) => ({ ...fs, fstatSync: (fd) => Object.assign(Object.create(Object.getPrototypeOf(fs.fstatSync(fd))), fs.fstatSync(fd), { uid }) });
  const someone = createCompanion({ ...w.deps, fs: ownedBy(UID + 1) });
  assert.deepEqual(await someone.tick(), [], "a file of somebody else's in your room");
  assert.equal(existsSync(theirs), true, "another person's request is theirs to judge: left alone");
  someone.dispose();
  rmSync(theirs);
  const loose = left(w, "viewer-loose", request(w), 0o666);
  const c = createCompanion(w.deps);
  assert.deepEqual(await c.tick(), []);
  assert.equal(existsSync(loose), false, "yours, but anybody could have written it: refused and removed");
  assert.equal(w.v.created.length, 0);
  c.dispose();
});

test("a request file a group may write is refused -- a group whose id matches yours too: that proves nothing about who is in it", { skip: NO_BITS }, async (t) => {
  const asIf = (gid) => ({ ...fs, fstatSync: (fd) => Object.assign(Object.create(Object.getPrototypeOf(fs.fstatSync(fd))), fs.fstatSync(fd), { mode: 0o100664, gid }) });
  for (const gid of [UID, UID + 1]) {
    const w = world(t);
    left(w, "viewer-k1", request(w));
    const c = createCompanion({ ...w.deps, fs: asIf(gid) });
    assert.deepEqual(await c.tick(), [], `group ${gid}`);
    c.dispose();
  }
});

test("a request file that is a link is never followed, whatever it points at", { skip: NO_BITS }, async (t) => {
  const w = world(t);
  const real = left(w, "real", request(w), 0o644, join(w.dir, "elsewhere"));
  mkdirSync(w.requests, { recursive: true });
  symlinkSync(real, join(w.requests, "viewer-k1.json"));
  const c = createCompanion(w.deps);
  assert.deepEqual(await c.tick(), []);
  assert.equal(w.v.created.length, 0);
  c.dispose();
});

// ---- the engine's half: `live open` in a VS Code terminal ----------------------------------------------------------

// The engine as a host's plugin manager installs it: what `live open` needs, copied into Codex's plugin folder.
function engineInstalled(w) {
  const at = join(hostFolder(w.home), "orbit", "orbit", "2.0.0");
  for (const part of ["cli", "src", "skills", "catalog", "plugin.json", "package.json"]) cpSync(join(ROOT, part), join(at, part), { recursive: true });
  return at;
}

test("`live open` in a VS Code terminal with a companion alive leaves the request -- and the companion opens it beside this terminal", async (t) => {
  const w = world(t);
  const engine = engineInstalled(w);
  const repo = join(w.dir, "repo");
  spawnSync("git", ["init", "-q", repo], { env: sealed() });
  spawnSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  createCompanion({ ...w.deps, now: () => Date.now() }).heartbeat();
  const env = sealed({ ORBIT_STORE_DIR: w.store, ORBIT_TRACE: "off", TERM_PROGRAM: "vscode" });
  const r = spawnSync(process.execPath, [join(engine, "cli", "live.mjs"), "open", "--json"], { cwd: repo, env, encoding: "utf8" });
  const answer = JSON.parse(r.stdout);
  assert.deepEqual([answer.opener, answer.started], ["vscode", true], r.stderr);
  const files = readdirSync(w.requests);
  assert.equal(files.length, 1);
  const req = JSON.parse(readFileSync(join(w.requests, files[0]), "utf8"));
  assert.deepEqual([realpathSync(req.argv[1]), ...req.argv.slice(2)], [join(engine, "cli", "live.mjs"), "tui", "--until-done"]);
  assert.ok(req.ancestry.includes(process.pid), "the asking process's ancestors include the shell it runs under (here: this test)");
  const v = fakeVscode([process.pid], { storeDirs: [w.store], nodePath: PERSONS_NODE });
  const c = createCompanion({ ...w.deps, vscode: v.api, now: () => Date.now() });
  assert.deepEqual(await c.tick(), ["opened"]);
  assert.equal(v.created[0].location.parentTerminal, v.terminals[0]);
  assert.deepEqual([v.created[0].shellPath, ...v.created[0].shellArgs.slice(0, 2)], [NODE, join(engine, "cli", "live.mjs"), "tui"]);
  c.dispose();
});

test("`live ensure` in a VS Code terminal with no companion opens nothing and says how to get the split", (t) => {
  const w = world(t);
  const repo = join(w.dir, "repo");
  spawnSync("git", ["init", "-q", repo], { env: sealed() });
  spawnSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  const env = sealed({ ORBIT_STORE_DIR: w.store, ORBIT_TRACE: "off", TERM_PROGRAM: "vscode", CLAUDECODE: "1", CLAUDE_CODE_SESSION_ATTENDED: "1", ORBIT_SESSION: "claude:0123456789abcdef" });
  const r = spawnSync(process.execPath, [join(ROOT, "cli", "live.mjs"), "ensure", "--json"], { cwd: repo, env, encoding: "utf8" });
  const answer = JSON.parse(r.stdout);
  assert.equal(answer.status, "UNSUPPORTED_TERMINAL");
  assert.match(answer.why, /Orbit Live companion/);
  assert.match(answer.command, /'tui'$/);
  assert.equal(existsSync(w.requests), false, "no request left for a companion that is not there");
});
