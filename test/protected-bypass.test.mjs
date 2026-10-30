// NO BYPASS (0.2.0): a protected action is reached only as an engineering task's action a person approved once in Orbit
// Control. Every other route -- a UI case's `call`, a work's need, a playbook step, a mission, a worker, a direct MCP
// call, a git push from inside a workspace -- meets the same boundary at the door it must pass, and only Orbit Control
// can be a person's door.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createCapabilityRegistry } from "../src/capability/registry.mjs";
import { invokeCapability } from "../src/capability/invoke.mjs";
import { Refused } from "../src/errors.mjs";
import { createLocalClones } from "../src/frontend/local-clones.mjs";
import { activityLog } from "../src/mcp/activity.mjs";
import { mcpCatalog } from "../src/mcp/catalog.mjs";
import { effectiveMcp } from "../src/mcp/effective.mjs";
import { invokeMcp } from "../src/mcp/invoke.mjs";
import { addCustom } from "../src/mcp/manage.mjs";
import { createMcpState } from "../src/mcp/state.mjs";
import { createProcess } from "../src/process/index.mjs";
import { baseEnv } from "../src/process/env.mjs";
import { actionFingerprint, authorize } from "../src/protected/authorize.mjs";
import { capabilityAction } from "../src/protected/capability.mjs";
import { envSecrets } from "../src/secrets.mjs";
import { catalogFile, readCatalog } from "../src/catalog.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { NOT_SATELLITE } from "../satellite/src/governance.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeTools } from "./fakes/tools.mjs";

const ROOT = join(import.meta.dirname, "..");

// ---- the capability pipeline: the one door every capability call passes ---------------------------------------------

const CAP = (over) => ({ apiVersion: "orbit.capability/v1", doc: "a capability", page: false, invoke: () => ({ ok: true }), ...over });
const DEPLOY = CAP({ id: "orders.deploy", mutates: true, effects: ["deploy"], environment: "production" });
const SEED = CAP({ id: "orders.seed", mutates: true, effects: ["write"], environment: "production" });

function called(cap, run, input = { artifact: "orders:2" }) {
  const capabilities = createCapabilityRegistry();
  capabilities.register(cap, "acme");
  const ctx = { ...fakeContext(), capabilities, tools: fakeTools({}) };
  return invokeCapability(ctx, { values: {}, log: { record: () => {} }, ...run }, { capability: cap.id, input });
}

const fingerprintFor = (cap, input) => actionFingerprint(authorize(capabilityAction(cap, input)));

test("a capability that declares a production deploy is refused at the pipeline from EVERY route that carries no spent approval of exactly it", () => {
  const routes = {
    "a UI case's call, run --force-destructive": { c: { id: "case", destructive: true } },
    "a work's need (no case)": { c: { id: "work" } },
    "a playbook step or a mission, reading only": { c: { id: "skill-run" } },
    "a generated test in a worker, under a grant": { c: { id: "worker" }, grants: { check: () => null, spend: () => null } },
    "an approval for a different action": { c: { id: "autonomous-engineering", destructive: true }, authorized: { action: "0".repeat(16) } },
  };
  for (const [route, run] of Object.entries(routes)) assert.throws(() => called(DEPLOY, run), (e) => e instanceof Refused && e.authorization === true && /Production deployment — deploys orders:2 to production.*protected boundary/.test(e.message), route);
});

test("only the orchestrator's authorization -- the fingerprint of exactly the approved call -- lets it through; a changed input does not", () => {
  const input = { artifact: "orders:2" };
  const run = { c: { id: "autonomous-engineering", destructive: true }, authorized: { action: fingerprintFor(DEPLOY, input) } };
  assert.deepEqual(called(DEPLOY, run, input), { ok: true });
  assert.throws(() => called(DEPLOY, run, { artifact: "orders:3" }), /protected boundary/, "the approval was for orders:2");
});

// 0.2.2, ADR 0044: an identity is never an authority. A run reference, a host agent, an agent run id, a mode, a role's
// name or an attribution word -- on the structured action, on the run, or handed in as if it were an approval -- moves
// no verdict and opens no door.
test("a run's identity grants nothing: a forged run reference, host agent, mode or attribution word changes no verdict", () => {
  const identity = { agentRunId: "arn-1", run: "msn-0123456789ab/arn-1", hostAgent: "claude:00000000000000aa", agent: "claude:00000000000000aa", attribution: "RUNTIME_BOUND", mode: "VERIFYING", role: "ReleaseApprover", by: "host" };
  const action = capabilityAction(DEPLOY, { artifact: "orders:2" });
  assert.deepEqual(authorize({ ...identity, ...action }), authorize(action), "the same verdict, whatever identity rides along");
  assert.equal(authorize({ ...identity, ...action }).decision, "approve_once");
  assert.throws(() => called(DEPLOY, { c: { id: "skill-run", ...identity }, ...identity }), (e) => e instanceof Refused && e.authorization === true, "a run that names itself is still a run with no approval");
  assert.throws(() => called(DEPLOY, { c: { id: "autonomous-engineering", destructive: true }, authorized: { action: identity.run } }), /protected boundary/, "a run reference is no approval's fingerprint");
  assert.throws(() => called(DEPLOY, { c: { id: "autonomous-engineering", destructive: true }, authorized: { action: identity.hostAgent } }), /protected boundary/, "nor is a host agent's id");
});

test("an ordinary production write that DECLARES what it is crosses no boundary: the pipeline holds it to its own mutation rule only", () => {
  assert.deepEqual(called(SEED, { c: { id: "autonomous-engineering", destructive: true } }), { ok: true });
  assert.throws(() => called(SEED, { c: { id: "case" } }), (e) => /declares that it can change external state, and nothing allows this run to/.test(e.message), "a case that writes still says so");
});

// ---- the MCP broker: a tool the catalog declares a push is never called directly ---------------------------------------

const response = (body) => ({ status: 200, ok: true, headers: { get: (k) => ({ "content-type": "application/json" })[k.toLowerCase()] ?? null }, text: async () => JSON.stringify(body), body: { cancel: async () => {} } });

function forge() {
  const asked = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    asked.push(body.method === "tools/call" ? body.params.name : body.method);
    if (!body.id) return { ...response({}), text: async () => "" };
    if (body.method === "tools/list") return response({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "push_files" }, { name: "merge_pull_request" }, { name: "create_issue" }, { name: "get_file_contents", annotations: { readOnlyHint: true } }] } });
    return response({ jsonrpc: "2.0", id: body.id, result: body.method === "initialize" ? {} : { content: [{ type: "text", text: "done" }] } });
  };
  return { fetch, asked };
}

function mcpWorld(t) {
  const base = mkdtempSync(join(tmpdir(), "orbit-bypass-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const rooms = stateRooms(base);
  const io = realIo();
  const catalog = mcpCatalog(readCatalog(io, catalogFile(ROOT, "mcp")));
  const state = createMcpState(rooms, io);
  addCustom({ state, catalog, now: () => "2026-10-28T08:00:00.000Z" }, { id: "github", transport: "http", url: "https://api.githubcopilot.com/mcp/" });
  const server = forge();
  const ctx = { entries: effectiveMcp({ catalog, state: state.all(), receipts: [], secrets: envSecrets({}), now: Date.parse("2026-10-28T08:00:01.000Z"), platform: "linux", arch: "x64" }), records: state.read("managed").servers, connect: { secrets: envSecrets({}), rooms, receipts: [], catalog, exists: () => false, platform: "linux", arch: "x64", node: "/node" }, session: { fetch: server.fetch, env: baseEnv({}), timeoutMs: 1000 }, activity: activityLog(rooms, io), now: () => Date.now() };
  return { server, call: (ask) => invokeMcp(ctx, ask) };
}

test("a push or a merge through a recognised MCP server is a protected boundary: refused before the tool is called, from any caller; an issue is an ordinary write", async (t) => {
  const w = mcpWorld(t);
  for (const tool of ["push_files", "merge_pull_request"]) await assert.rejects(w.call({ id: "github", tool, args: { branch: "main" } }), (e) => e instanceof Refused && /Git push.*protected boundary.*never through a direct tool call/s.test(e.message), tool);
  assert.equal(w.server.asked.filter((m) => ["push_files", "merge_pull_request"].includes(m)).length, 0, "the server was never asked to push");
  assert.equal((await w.call({ id: "github", tool: "create_issue", args: { title: "x" } })).tool, "create_issue", "an ordinary integration write is autonomous");
  assert.equal((await w.call({ id: "github", tool: "get_file_contents", args: {} })).operation, "read");
});

// ---- the task workspace: nothing inside it can push into the developer's checkout -------------------------------------

test("a task's workspace keeps no remote: a push from inside it names nothing, so it cannot write the primary checkout's .git", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-ws-origin-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const primary = join(dir, "primary");
  execFileSync("git", ["init", "-q", primary]);
  writeFileSync(join(primary, "a.txt"), "a\n");
  execFileSync("git", ["-C", primary, "add", "."]);
  execFileSync("git", ["-C", primary, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "init"]);
  const clones = createLocalClones(primary, createProcess(), { noHooks: join(dir, "no-hooks") });
  const ws = join(dir, "ws");
  clones.add(ws, clones.head());
  assert.equal(execFileSync("git", ["-C", ws, "remote"], { encoding: "utf8" }).trim(), "", "no origin pointing at the checkout");
  const pushed = spawnSync("git", ["-C", ws, "push", "--quiet"], { encoding: "utf8" });
  assert.notEqual(pushed.status, 0, "a bare `git push` from the workspace has nowhere to go");
  assert.deepEqual(execFileSync("git", ["-C", primary, "for-each-ref", "--format=%(refname)"], { encoding: "utf8" }).trim().split("\n"), [execFileSync("git", ["-C", primary, "symbolic-ref", "HEAD"], { encoding: "utf8" }).trim()], "the checkout's refs are as they were");
});

test("a commit and an approved push never go through the workspace's own .git: a URL rewrite, a hook or a .git naming the checkout changes nothing", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-ws-deliver-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const [primary, remote, elsewhere, hooks] = ["primary", "remote.git", "elsewhere.git", "hooks"].map((n) => join(dir, n));
  git("init", "-q", primary);
  git("init", "-q", "--bare", remote);
  git("init", "-q", "--bare", elsewhere);
  writeFileSync(join(primary, "a.txt"), "a\n");
  git("-C", primary, "add", ".");
  git("-C", primary, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-qm", "init");
  git("-C", primary, "remote", "add", "origin", remote);
  const refsBefore = git("-C", primary, "for-each-ref", "--format=%(refname) %(objectname)");
  const clones = createLocalClones(primary, createProcess(), { noHooks: join(dir, "no-hooks") });
  const [ws, store, base] = [join(dir, "room", "tree"), join(dir, "room", "delivery"), clones.head()];
  clones.add(ws, base);
  writeFileSync(join(ws, "b.txt"), "b\n");
  git("-C", ws, "config", `url.${elsewhere}.pushInsteadOf`, remote);
  git("-C", ws, "config", "core.hooksPath", hooks);
  mkdirSync(hooks);
  writeFileSync(join(hooks, "post-commit"), `#!/bin/sh\ntouch "${join(dir, "HOOK-RAN")}"\n`, { mode: 0o755 });

  const sha = clones.commit({ tree: ws, store, base }, "orbit/tsk-1", "the change");
  assert.notEqual(sha, base);
  assert.equal(clones.headOf(store), sha, "the store's branch names the commit");
  assert.equal(git("-C", ws, "rev-parse", "HEAD"), base, "the workspace's own .git is never committed in");
  assert.deepEqual(git(`--git-dir=${store}`, "ls-tree", "--name-only", sha).split("\n"), ["a.txt", "b.txt"], "what the workspace holds");
  const pushed = clones.push(store, clones.remoteOf("origin"), sha, "refs/heads/orbit/tsk-1", false);
  assert.equal(pushed.ok, true, pushed.reason);
  assert.equal(git(`--git-dir=${remote}`, "rev-parse", "refs/heads/orbit/tsk-1"), sha, "the URL the push was given");
  assert.equal(git(`--git-dir=${elsewhere}`, "for-each-ref"), "", "never where the workspace's configuration pointed");
  assert.equal(existsSync(join(dir, "HOOK-RAN")), false, "no hook ran");

  rmSync(join(ws, ".git"), { recursive: true, force: true });
  writeFileSync(join(ws, ".git"), `gitdir: ${join(primary, ".git")}\n`);
  assert.throws(() => clones.changes(ws, base), Refused, "a .git naming the checkout's is never read or written through");
  assert.equal(clones.listed(ws), false, "nor is it a clone of its own");
  assert.notEqual(clones.commit({ tree: ws, store, base }, "orbit/tsk-1", "again"), base, "a commit reads the files, never that .git");
  assert.equal(git("-C", primary, "status", "--porcelain"), "", "the checkout's index and files are as they were");
  assert.equal(git("-C", primary, "for-each-ref", "--format=%(refname) %(objectname)"), refsBefore, "and its refs");
});

// ---- only Orbit Control is a person's door ---------------------------------------------------------------------------

const walk = (d) => readdirSync(d).filter((n) => n !== "node_modules").flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const code = (p) => readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

test("no engine, CLI, skill or Satellite file can say it is Orbit Control's door: only control-server composes one, after its mutation token", () => {
  const files = ["src", "cli", "skills", "satellite"].flatMap((d) => walk(join(ROOT, d))).filter((p) => p.endsWith(".mjs") && !p.includes(`${join("satellite", "test")}`));
  // src/task/index.mjs NAMES the door a command needs (approve, resume) -- a requirement on its row, never a context.
  const hits = files.filter((p) => /door:\s*["']control["']/.test(code(p))).map((p) => relative(ROOT, p));
  assert.deepEqual(hits, [join("src", "task", "index.mjs")]);
  assert.match(code(join(ROOT, "src", "task", "index.mjs")), /approve: \{ \.\.\.record\(verdict\("approve", \(\) => \(\{\}\)\)\), door: "control" \}/);
  const composers = walk(join(ROOT, "control-server", "src")).filter((p) => p.endsWith(".mjs") && /door:\s*["']control["']/.test(code(p))).map((p) => relative(ROOT, p));
  assert.ok(composers.length > 0 && composers.every((p) => p.startsWith(join("control-server", "src"))));
});

test("Satellite never writes a task journal or grants an approval: it imports no task write door, and names the grant as what it never does", () => {
  const files = ["satellite/src", "satellite/cli"].flatMap((d) => walk(join(ROOT, d))).filter((p) => p.endsWith(".mjs"));
  assert.deepEqual(files.filter((p) => /from\s+"[^"]*src\/task\/(ops|index)\.mjs"/.test(code(p))).map((p) => relative(ROOT, p)), []);
  assert.ok(NOT_SATELLITE.includes("HUMAN_APPROVAL_GRANT") && NOT_SATELLITE.includes("ORBIT_JOURNAL_WRITE"));
});
