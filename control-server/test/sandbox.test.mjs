// A task's SANDBOX in Orbit Control, over HTTP. What is promised:
//
//   * a task with no sandbox receipt says so, and nothing is bound, started or written to say it;
//   * the sandbox is found from the task's OWN journal (its latest `sandbox` receipt) and checked against
//     the checkout's own sandboxes -- another task's is a 409, an unknown one a 404, a malformed id a 400
//     before any runtime is bound -- and no path, command or environment ever comes from a request;
//   * Stop and Release are a person's, with the page's token, and a body of exactly `{ human: true }`;
//   * logs come through the runtime's own bounded, scrubbed door, and trust is Control's grant, by
//     fingerprint, against the settings revision the page read.
//
// Three groups. The first needs nothing of the runtime's sandbox commands. The second installs a FAKE of
// those commands for one test and proves what CONTROL does around them (which arguments, which context,
// which status). The third runs the REAL commands and is marked `needs the runtime commands (lead)`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { Refused, RUNTIME_COMMANDS, bindRuntime, bindSandbox } from "../src/core.mjs";
import { createLocalClones } from "../../src/frontend/local-clones.mjs";
import { createWorkspaces } from "../../src/orchestration/workspace.mjs";
import { createProcess } from "../../src/process/index.mjs";
import { projectStoreRoot } from "../../src/project/repository.mjs";
import { guardedIo } from "../../src/store/guard.mjs";
import { realIo } from "../../src/store/io.mjs";
import { sealed } from "../../test/home.mjs";
import { taskWorld } from "../../test/task.harness.mjs";
import { TOKEN_HEADER } from "../src/security.mjs";
import { ROUTES } from "../src/router.mjs";
import { TOKEN, fixture } from "./fixture.mjs";
import { REPO, gitCheckout, runtimeWorld, serve } from "./checkout.mjs";
import { PAYMENTS, SHOP, machine, snapshot } from "./machine.mjs";
import { stream } from "./live.mjs";

const taskAt = (p, tail = "") => `/api/v1/projects/${encodeURIComponent(p.key)}/checkouts/${p.checkout}/tasks${tail}`;
const runtimeAt = (p, tail = "") => `/api/v1/projects/${encodeURIComponent(p.key)}/checkouts/${p.checkout}/runtime${tail}`;

const ENV = `env-${"a".repeat(12)}`;
const OTHER_ENV = `env-${"b".repeat(12)}`;
const SESSION = `rs-${"c".repeat(12)}`;
const TREE = "1".repeat(40);
const FP = "0123456789abcdef".repeat(4);

// The sandbox receipt a task keeps, written the way the orchestrator's `link-receipt` writes it.
const receipt = (world, task, ref) => world.tasks.append(task, "receipt", { domain: "sandbox", ref, outcome: "READY", summary: "the sandbox is ready" });

async function served(t) {
  const m = machine(t);
  return { ...m, api: await serve(t, m.root, runtimeWorld(m.root)) };
}

// ---- group one: what Control decides before the runtime is asked -----------------------------------

test("a task with no sandbox receipt says so: nothing is bound, started or written to say it", async (t) => {
  const m = await served(t);
  const before = snapshot(m.root.store);
  const got = await m.api.get(taskAt(SHOP, `/${m.working}/sandbox`));
  assert.equal(got.status, 200);
  assert.equal(got.json.sandbox, null);
  assert.match(got.json.because, /has not asked for a sandbox/);
  assert.deepEqual(snapshot(m.root.store), before, "reading a task's sandbox writes nothing in the store");
});

test("an unknown task is a 404, a malformed task or session id a 400, and another checkout cannot address this checkout's task", async (t) => {
  const m = await served(t);
  const unknown = await m.api.get(taskAt(PAYMENTS, "/tsk-000000000000/sandbox"));
  assert.deepEqual([unknown.status, unknown.json.error.code], [404, "TASK_UNKNOWN"]);
  const malformed = await m.api.get(taskAt(PAYMENTS, "/tsk-..%2F..%2Fx/sandbox"));
  assert.deepEqual([malformed.status, malformed.json.error.code], [400, "INVALID_TASK_ID"]);
  const project = await m.api.get(taskAt({ key: "repo-nobody", checkout: PAYMENTS.checkout }, `/${m.waiting}/sandbox`));
  assert.deepEqual([project.status, project.json.error.code], [404, "PROJECT_UNKNOWN"]);
  const foreign = await m.api.get(taskAt(SHOP, `/${m.waiting}/sandbox`));
  assert.deepEqual([foreign.status, foreign.json.error.code], [404, "TASK_UNKNOWN"], "a task of another checkout is unknown here");
});

test("a malformed environment in a receipt is a 400 before any runtime is bound -- and this checkout is not even a repository", async (t) => {
  const m = await served(t);
  receipt(m.shop, m.working, "env-not-hex");
  const got = await m.api.get(taskAt(SHOP, `/${m.working}/sandbox`));
  assert.deepEqual([got.status, got.json.error.code], [400, "INVALID_ENVIRONMENT_ID"]);
  const stop = await m.api.post(taskAt(SHOP, `/${m.working}/sandbox/stop`), { human: true });
  assert.deepEqual([stop.status, stop.json.error.code], [400, "INVALID_ENVIRONMENT_ID"]);
});

test("every change to a sandbox or its trust needs the page's token and its origin: without them nothing is read, bound or asked", async (t) => {
  const m = await served(t);
  const rows = [[taskAt(SHOP, `/${m.working}/sandbox/stop`), { human: true }], [taskAt(SHOP, `/${m.working}/sandbox/release`), { human: true }], [runtimeAt(SHOP, "/sandbox/trust"), { kind: "restore", fingerprint: FP, revision: null }], [runtimeAt(SHOP, "/sandbox/revoke"), { kind: "restore", fingerprint: FP, revision: null }]];
  for (const [path, body] of rows) {
    const bare = await m.api.bare("POST", path, body);
    assert.deepEqual([bare.status, bare.json.error.code], [403, "MUTATION_TOKEN_REQUIRED"], path);
    const evil = await m.api.raw("POST", path, body, { "content-type": "application/json", origin: "https://evil.example", [TOKEN_HEADER]: TOKEN });
    assert.deepEqual([evil.status, evil.json.error.code], [403, "ORIGIN_NOT_ALLOWED"], path);
  }
});

test("Stop and Release take { human: true } and nothing else: an environment, a session, a command, an array or __proto__ is a 400, and {} is HUMAN_REQUIRED, the journal unchanged", async (t) => {
  const m = await served(t);
  receipt(m.shop, m.working, ENV);
  const before = m.shop.text(m.working);
  for (const tail of ["stop", "release"]) {
    const at = taskAt(SHOP, `/${m.working}/sandbox/${tail}`);
    for (const body of [{ human: true, env: OTHER_ENV }, { human: true, session: SESSION }, { human: true, command: "rm -rf /" }, [], JSON.parse('{"__proto__": 1, "human": true}'), { human: "yes" }]) {
      const got = await m.api.post(at, body);
      assert.deepEqual([got.status, got.json.error.code], [400, "SANDBOX_BODY_INVALID"], `${tail} ${JSON.stringify(body)}`);
    }
    for (const body of [{}, { human: false }]) {
      const got = await m.api.post(at, body);
      assert.deepEqual([got.status, got.json.error.code], [400, "HUMAN_REQUIRED"], `${tail} ${JSON.stringify(body)}`);
    }
  }
  assert.equal(m.shop.text(m.working), before, "the task's journal is byte for byte what it was");
});

test("logs name a session by its shape, a stream and a bounded tail, and a traversal never reaches the runtime", async (t) => {
  const m = await served(t);
  receipt(m.shop, m.working, ENV);
  const at = (tail) => taskAt(SHOP, `/${m.working}/sandbox/logs/${tail}`);
  for (const session of ["..%2F..%2Fsettings", "rs-short", "%00", "rs-%E0%A4%A", `rs-${"C".repeat(12)}`]) {
    const got = await m.api.get(at(session));
    assert.equal(got.status, 400, session);
    assert.match(got.json.error.code, /^INVALID_(SESSION_ID|TASK_ID)$/, session);
  }
  for (const query of ["stream=trace", "stream=../out", "tail=0", "tail=1001", "tail=-1", "tail=abc", "tail=1e3"]) {
    const got = await m.api.get(`${at(SESSION)}?${query}`);
    assert.deepEqual([got.status, got.json.error.code], [400, "SANDBOX_QUERY_INVALID"], query);
  }
});

test("a trust body is a kind, a fingerprint and the settings revision read, each the shape it has -- and nothing else, refused before the runtime is asked", async (t) => {
  const m = await served(t);
  const good = { kind: "restore", fingerprint: FP, revision: "fedcba9876543210" };
  for (const tail of ["trust", "revoke"]) {
    for (const body of [{ ...good, kind: "script" }, { ...good, kind: "RESTORE" }, { ...good, fingerprint: "xyz" }, { ...good, fingerprint: FP.toUpperCase() }, { ...good, fingerprint: "a".repeat(16) }, { ...good, fingerprint: "a".repeat(63) }, { ...good, fingerprint: "a".repeat(65) }, { ...good, revision: 3 }, { ...good, revision: "short" }, { ...good, command: "x" }, { ...good, env: ENV }, { kind: "restore", fingerprint: good.fingerprint }, { kind: "restore", revision: null }, {}, [], JSON.parse('{"__proto__": 1}')]) {
      const got = await m.api.post(runtimeAt(SHOP, `/sandbox/${tail}`), body);
      assert.deepEqual([got.status, got.json.error.code], [400, "RUNTIME_BODY_INVALID"], `${tail} ${JSON.stringify(body)}`);
    }
  }
});

test("there is no way to start, restart or build a sandbox from here, and no route name says command, shell, exec or restart", async (t) => {
  const m = await served(t);
  for (const tail of ["start", "restart", "prepare", "build", "up"]) {
    const got = await m.api.post(taskAt(SHOP, `/${m.working}/sandbox/${tail}`), { human: true });
    assert.deepEqual([got.status, got.json.error.code], [404, "NOT_FOUND"], tail);
  }
  assert.equal((await m.api.post(runtimeAt(SHOP, "/sandbox/start"), {})).status, 404);
  const words = ROUTES.filter((r) => /sandbox/.test(String(r.path)));
  assert.equal(words.length, 8, "the sandbox's eight rows (its live log stream among them), and no more");
  assert.deepEqual(words.filter((r) => r.method !== "GET" && !r.mutates), [], "every sandbox row that is not a read is a person's");
  assert.deepEqual(words.filter((r) => r.stream).map((r) => r.method), ["GET"], "the one sandbox stream is a read");
  assert.deepEqual(words.filter((r) => /command|shell|exec|restart/i.test(String(r.path))), []);
});

// ---- group two: what Control does around the runtime's commands (a FAKE of them, for one test) ------

// One real checkout Orbit has been used from, a real task of it with a real workspace of its own (what a
// sandbox context asks for), and Control over it.
async function sandboxed(t) {
  const { root } = fixture(t);
  const world = runtimeWorld(root);
  gitCheckout(root.project, { "web/package.json": JSON.stringify({ name: "web", engines: { node: ">=18" }, scripts: { dev: "node serve.js" } }), "web/package-lock.json": "{}", "web/serve.js": "setInterval(() => {}, 1000);\n" });
  const cli = () => bindRuntime({ pluginRoot: REPO, env: world.env, cwd: root.project });
  await RUNTIME_COMMANDS.discover.run(cli(), []);
  await RUNTIME_COMMANDS.doctor.run(cli(), []);
  const api = await serve(t, root, world);
  const [project] = (await api.get("/api/v1/projects")).json.projects;
  const at = { key: project.key, checkout: project.checkouts[0].id };
  const tasks = taskWorld(t, { dir: projectStoreRoot(root.store, at.key), project: at.key, checkout: at.checkout });
  return { root, world, api, at, tasks, cli, task: owned(tasks, root, cli()) };
}

// A task of that checkout, and the workspace its owner prepared -- what `bindSandbox` is Refused without.
function owned(tasks, root, ctx) {
  const task = tasks.create({ objective: "PBI-482 Refund validation" });
  const store = ctx.storeRoot;
  const trees = createLocalClones(root.project, createProcess(), { noHooks: join(store, "workspaces", ".no-hooks"), env: sealed({ GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" }) });
  createWorkspaces({ root: store, io: guardedIo(store, realIo()), trees, host: "laptop-a", now: () => "2026-10-07T10:00:00.000Z" }).prepare({ task, project: ctx.project.storeKey, checkout: ctx.checkout, baseRevision: trees.head() });
  return task;
}

// The runtime's sandbox commands, replaced for ONE test by fakes that keep what they were asked.
function faked(t, answers = {}) {
  const calls = [];
  const names = ["sandboxes", "sandbox", "sandbox-stop", "sandbox-release", "sandbox-logs", "trust"];
  const originals = Object.fromEntries(names.map((n) => [n, RUNTIME_COMMANDS[n]]));
  for (const name of names) RUNTIME_COMMANDS[name] = { ...originals[name], run: async (ctx, argv) => (calls.push({ name, argv, door: ctx.door ?? null, task: ctx.task ?? null, sandboxId: ctx.sandboxId ?? null }), answers[name](ctx, argv)) };
  t.after(() => names.forEach((n) => (originals[n] ? (RUNTIME_COMMANDS[n] = originals[n]) : delete RUNTIME_COMMANDS[n])));
  return calls;
}

const sandboxView = (over = {}) => ({ environment: ENV, owner: { kind: "task", id: "tsk-000000000000" }, workspace: "ws-000000000000", state: "READY", tree: TREE, currentTree: TREE, stale: false, components: [{ component: "node:web", execution: "native", session: SESSION, requestedAt: "2026-10-07T10:00:00.000Z", state: "RUNNING", readiness: { state: "READY" }, endpoint: "http://127.0.0.1:42000" }], leases: [{ port: 42000, component: "node:web", since: "2026-10-07T10:00:00.000Z" }], connectivity: [], ownership: { processes: 1, containers: 0, external: 0 }, dataIsolation: { state: "unknown", because: "nothing declared" }, qa: { modes: [], entry: null, browser: "isolated" }, createdAt: "2026-10-07T10:00:00.000Z", updatedAt: "2026-10-07T10:00:00.000Z", ...over });

const rowOf = (id, owner, state = "READY") => ({ id, owner: { kind: "task", id: owner }, workspace: "ws-000000000000", state, tree: TREE, stale: false, components: 1, leases: [42000], updatedAt: "2026-10-07T10:00:00.000Z" });

test("the sandbox a task shows is the one its LATEST receipt names, read through the runtime bound to that task, and no path is in the answer", async (t) => {
  const w = await sandboxed(t);
  const calls = faked(t, { sandboxes: () => ({ sandboxes: [rowOf(OTHER_ENV, w.task), rowOf(ENV, w.task)], staleLeases: [] }), sandbox: (ctx) => sandboxView({ environment: ctx.sandboxId, owner: { kind: "task", id: ctx.task } }) });
  receipt(w.tasks, w.task, OTHER_ENV);
  w.tasks.tick();
  receipt(w.tasks, w.task, ENV);
  const got = await w.api.get(taskAt(w.at, `/${w.task}/sandbox`));
  assert.equal(got.status, 200, got.text);
  assert.equal(got.json.sandbox.owner.id, w.task);
  assert.deepEqual(calls.map((c) => [c.name, c.door]), [["sandboxes", null], ["sandbox", null]]);
  assert.equal(calls[1].task, w.task, "the runtime was bound to the task the PATH names");
  for (const secret of [w.root.base, w.root.project, w.root.store, "workspaces"]) assert.equal(got.text.includes(secret), false, secret);
});

test("another task's sandbox in this task's journal is a 409, one nobody has a 404, and the sandbox is bound for neither", async (t) => {
  const w = await sandboxed(t);
  const calls = faked(t, { sandboxes: () => ({ sandboxes: [rowOf(OTHER_ENV, "tsk-999999999999")], staleLeases: [] }), sandbox: () => sandboxView() });
  receipt(w.tasks, w.task, OTHER_ENV);
  const mismatch = await w.api.get(taskAt(w.at, `/${w.task}/sandbox`));
  assert.deepEqual([mismatch.status, mismatch.json.error.code], [409, "SANDBOX_OWNER_MISMATCH"]);
  const release = await w.api.post(taskAt(w.at, `/${w.task}/sandbox/release`), { human: true });
  assert.deepEqual([release.status, release.json.error.code], [409, "SANDBOX_OWNER_MISMATCH"]);
  w.tasks.tick();
  receipt(w.tasks, w.task, `env-${"0".repeat(12)}`);
  const unknown = await w.api.get(taskAt(w.at, `/${w.task}/sandbox`));
  assert.deepEqual([unknown.status, unknown.json.error.code], [404, "SANDBOX_UNKNOWN"]);
  assert.equal(calls.some((c) => c.name !== "sandboxes"), false, "no sandbox command ran: only the checkout's own list was read");
});

test("Stop and Release are the runtime's own commands over this task's sandbox, once each, and answer what it said with the sandbox as it now stands; nothing in the task's journal moves", async (t) => {
  const w = await sandboxed(t);
  const state = { released: false };
  const calls = faked(t, {
    sandboxes: () => ({ sandboxes: [rowOf(ENV, w.task)], staleLeases: [] }),
    sandbox: (ctx) => sandboxView({ owner: { kind: "task", id: ctx.task }, state: state.released ? "RELEASED" : "READY" }),
    "sandbox-stop": () => ({ stopped: [SESSION], gone: [], refused: [] }),
    "sandbox-release": () => { if (state.released) throw Object.assign(new Refused(`${ENV} is released already`), { code: "SANDBOX_RELEASED" }); state.released = true; return { released: true, environment: ENV, leases: [42000], containers: [] }; },
  });
  receipt(w.tasks, w.task, ENV);
  const journal = w.tasks.text(w.task);
  const stopped = await w.api.post(taskAt(w.at, `/${w.task}/sandbox/stop`), { human: true });
  assert.equal(stopped.status, 200, stopped.text);
  assert.deepEqual(stopped.json.result, { stopped: [SESSION], gone: [], refused: [] });
  assert.equal(stopped.json.sandbox.state, "READY");
  const released = await w.api.post(taskAt(w.at, `/${w.task}/sandbox/release`), { human: true });
  assert.deepEqual([released.status, released.json.result.released, released.json.sandbox.state], [200, true, "RELEASED"]);
  const again = await w.api.post(taskAt(w.at, `/${w.task}/sandbox/release`), { human: true });
  assert.deepEqual([again.status, again.json.error.code], [409, "SANDBOX_RELEASED"]);
  assert.deepEqual(calls.filter((c) => /^sandbox-/.test(c.name)).map((c) => [c.name, c.argv]), [["sandbox-stop", [`--task=${w.task}`]], ["sandbox-release", [`--task=${w.task}`]], ["sandbox-release", [`--task=${w.task}`]]]);
  assert.equal(w.tasks.text(w.task), journal, "a sandbox is not a task's journal: nothing was written to it");
});

test("logs go through the runtime's own door with the arguments Control validated, an unknown session is the runtime's 404, and the body is the runtime's bounded answer", async (t) => {
  const w = await sandboxed(t);
  const calls = faked(t, { sandboxes: () => ({ sandboxes: [rowOf(ENV, w.task)], staleLeases: [] }), "sandbox-logs": (ctx, argv) => { if (argv.includes(`--session=rs-${"d".repeat(12)}`)) throw Object.assign(new Refused("no such session in this sandbox"), { code: "SESSION_UNKNOWN" }); return { session: SESSION, stream: "out", lines: ["listening"], truncated: false, bytes: 9 }; } });
  receipt(w.tasks, w.task, ENV);
  const got = await w.api.get(taskAt(w.at, `/${w.task}/sandbox/logs/${SESSION}?stream=err&tail=40`));
  assert.deepEqual([got.status, got.json.lines, got.json.truncated], [200, ["listening"], false]);
  assert.deepEqual(calls.find((c) => c.name === "sandbox-logs").argv, [`--task=${w.task}`, `--session=${SESSION}`, "--stream=err", "--tail=40"]);
  const unknown = await w.api.get(taskAt(w.at, `/${w.task}/sandbox/logs/rs-${"d".repeat(12)}`));
  assert.deepEqual([unknown.status, unknown.json.error.code], [404, "SESSION_UNKNOWN"]);
  const dflt = await w.api.get(taskAt(w.at, `/${w.task}/sandbox/logs/${SESSION}`));
  assert.equal(dflt.status, 200);
  assert.deepEqual(calls.filter((c) => c.name === "sandbox-logs").at(-1).argv.slice(2), ["--stream=out", "--tail=200"]);
});

// A log the fake runtime answers from a byte offset, as src/runtime/sandbox/view.mjs does.
const logFrom = (state) => (ctx, argv) => {
  const from = Number(argv.find((a) => a.startsWith("--from="))?.slice(7) ?? 0);
  const end = state.text.lastIndexOf("\n") + 1;
  return { session: SESSION, stream: "out", from, next: Math.max(from, end), size: state.text.length, lines: state.text.slice(from, end).split("\n").filter(Boolean), truncated: false, bytes: Math.max(0, end - from) };
};

test("a log read from an offset passes --from and no --tail, and an offset that is not a whole number is a 400", async (t) => {
  const w = await sandboxed(t);
  const calls = faked(t, { sandboxes: () => ({ sandboxes: [rowOf(ENV, w.task)], staleLeases: [] }), "sandbox-logs": logFrom({ text: "a\nb\n" }) });
  receipt(w.tasks, w.task, ENV);
  const got = await w.api.get(taskAt(w.at, `/${w.task}/sandbox/logs/${SESSION}?from=2`));
  assert.deepEqual([got.status, got.json.lines, got.json.next], [200, ["b"], 4]);
  assert.deepEqual(calls.find((c) => c.name === "sandbox-logs").argv.slice(2), ["--stream=out", "--from=2"]);
  const bad = await w.api.get(taskAt(w.at, `/${w.task}/sandbox/logs/${SESSION}?from=-3`));
  assert.deepEqual([bad.status, bad.json.error.code], [400, "SANDBOX_QUERY_INVALID"]);
});

test("the live log stream checks the session, the stream and the task's own sandbox before any header, then reads only what is new", async (t) => {
  const w = await sandboxed(t);
  const state = { text: "first\n", owner: w.task };
  const calls = faked(t, { sandboxes: () => ({ sandboxes: [rowOf(ENV, state.owner)], staleLeases: [] }), "sandbox-logs": logFrom(state) });
  receipt(w.tasks, w.task, ENV);
  const at = (tail) => taskAt(w.at, `/${w.task}/sandbox/logs/${tail}`);
  for (const [path, status, code] of [[at("rs-bad/stream"), 400, "INVALID_SESSION_ID"], [at(`${SESSION}/stream?stream=env`), 400, "SANDBOX_QUERY_INVALID"]]) {
    const refused = await stream(w.api.port, path);
    assert.deepEqual([refused.status, refused.json.error.code, /json/.test(refused.type)], [status, code, true], path);
  }
  setTimeout(() => { state.text += "second\nthird"; }, 60);
  const got = await stream(w.api.port, at(`${SESSION}/stream`), { until: (fs) => fs.some((f) => f.event === "log" && f.data.lines.includes("second")) });
  const logs = got.frames.filter((f) => f.event === "log");
  assert.deepEqual(logs.map((f) => [f.id, f.data.lines]), [["o=6", ["first"]], ["o=13", ["second"]]], "a line still being written waits");
  const resumed = await stream(w.api.port, at(`${SESSION}/stream`), { headers: { "last-event-id": "o=6" }, until: (fs) => fs.some((f) => f.event === "log") });
  assert.deepEqual(resumed.frames.find((f) => f.event === "log").data.lines, ["second"]);
  assert.ok(calls.filter((c) => c.name === "sandbox-logs").every((c) => c.argv.some((a) => a.startsWith("--from=")) && !c.argv.some((a) => a.startsWith("--tail="))));
  state.owner = "tsk-999999999999";
  const mismatch = await stream(w.api.port, at(`${SESSION}/stream`));
  assert.deepEqual([mismatch.status, mismatch.json.error.code], [409, "SANDBOX_OWNER_MISMATCH"]);
});

test("trust and revoke are the runtime's trust command from CONTROL's door, with the fingerprint and the revision read -- and a stale revision is a 409", async (t) => {
  const w = await sandboxed(t);
  const calls = faked(t, { trust: (ctx, argv) => { if (argv.includes("--revision=0000000000000000")) throw Object.assign(new Refused("the settings changed since they were read"), { code: "STALE_REVISION" }); return { saved: { revision: "1111111111111111", settings: {} } }; } });
  const fp = FP;
  const restore = await w.api.post(runtimeAt(w.at, "/sandbox/trust"), { kind: "restore", fingerprint: fp, revision: "fedcba9876543210" });
  assert.deepEqual([restore.status, restore.json.saved.revision], [200, "1111111111111111"]);
  const revoke = await w.api.post(runtimeAt(w.at, "/sandbox/revoke"), { kind: "definition", fingerprint: fp, revision: null });
  assert.equal(revoke.status, 200);
  const stale = await w.api.post(runtimeAt(w.at, "/sandbox/trust"), { kind: "restore", fingerprint: fp, revision: "0000000000000000" });
  assert.deepEqual([stale.status, stale.json.error.code], [409, "STALE_REVISION"]);
  assert.deepEqual(calls.map((c) => [c.argv, c.door]), [[[`--restore=${fp}`, "--revision=fedcba9876543210"], "control"], [[`--definition=${fp}`, "--revoke"], "control"], [[`--restore=${fp}`, "--revision=0000000000000000"], "control"]]);
});

test("the list of a checkout's sandboxes is the runtime's table, asked of nothing else, and a reader starts nothing", async (t) => {
  const w = await sandboxed(t);
  const calls = faked(t, { sandboxes: () => ({ sandboxes: [rowOf(ENV, w.task)], staleLeases: [{ port: 42001, owner: "tsk-999999999999", component: "node:web" }] }) });
  const got = await w.api.get(runtimeAt(w.at, "/sandboxes"));
  assert.deepEqual([got.status, got.json.sandboxes.map((s) => s.id), got.json.staleLeases.length], [200, [ENV], 1]);
  assert.deepEqual(calls.map((c) => c.name), ["sandboxes"]);
  assert.equal(calls[0].door, null, "listing is a person's reading, not a grant");
});

// ---- group three: the REAL commands -----------------------------------------------------------------
// needs the runtime commands (lead): `sandboxes`, `sandbox`, `sandbox-prepare`, `sandbox-start`,
// `sandbox-stop`, `sandbox-release`, `sandbox-logs` and `trust` in src/runtime/index.mjs, and the
// settings `sandbox` block. Each test below says which of them it stands on.

const hasNpm = createProcess().run("npm", ["--version"], { timeoutMs: 30000 }).ok;
const live = process.platform === "win32" ? "a real start on Windows is not yet proven by this suite: it runs on POSIX" : hasNpm ? false : "needs npm on the PATH";

const freePort = () => new Promise((resolve) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

// needs the runtime commands (lead): `sandboxes`, answering { sandboxes, staleLeases } as the contract says (it answers `leases` today)
test("on a checkout nobody has a sandbox in, the list is empty and reading it starts and writes nothing", async (t) => {
  const w = await sandboxed(t);
  const before = snapshot(w.root.store);
  const got = await w.api.get(runtimeAt(w.at, "/sandboxes"));
  assert.deepEqual([got.status, got.json.sandboxes, got.json.staleLeases], [200, [], []]);
  assert.deepEqual(snapshot(w.root.store), before);
});

// needs the runtime commands (lead): `trust`, and the settings `sandbox` block (`restore.trusted`, `trustedDefinitions`)
test("trust lands in the settings' sandbox block and in nothing else: every other field is byte for byte what it was, a stale revision is a 409, and revoke takes it back", async (t) => {
  const w = await sandboxed(t);
  const base = runtimeAt(w.at);
  const first = (await w.api.get(`${base}/settings`)).json;
  const fp = FP;
  const saved = await w.api.put(`${base}/settings`, { settings: { ...first.settings, strategy: "native" }, revision: first.revision });
  assert.equal(saved.status, 200, saved.text);
  const read = (await w.api.get(`${base}/settings`)).json;
  const trusted = await w.api.post(`${base}/sandbox/trust`, { kind: "restore", fingerprint: fp, revision: read.revision });
  assert.equal(trusted.status, 200, trusted.text);
  const after = (await w.api.get(`${base}/settings`)).json;
  assert.deepEqual(after.settings.sandbox.restore.trusted, [fp]);
  const { sandbox: was, ...others } = read.settings;
  const { sandbox: now, ...rest } = after.settings;
  assert.equal(JSON.stringify(rest), JSON.stringify(others), "every other field is byte-equal");
  assert.equal(JSON.stringify({ ...now, restore: { ...now.restore, trusted: [] } }), JSON.stringify(was), "and so is the rest of the sandbox block");
  const stale = await w.api.post(`${base}/sandbox/trust`, { kind: "definition", fingerprint: fp, revision: read.revision });
  assert.deepEqual([stale.status, stale.json.error.code], [409, "STALE_REVISION"]);
  const revoked = await w.api.post(`${base}/sandbox/revoke`, { kind: "restore", fingerprint: fp, revision: after.revision });
  assert.equal(revoked.status, 200, revoked.text);
  assert.deepEqual((await w.api.get(`${base}/settings`)).json.settings.sandbox.restore.trusted, []);
});

// needs the runtime commands (lead): every sandbox command, and the settings' component `port.override`
test("a real sandbox of a tiny Node server is prepared, started on a leased port, read, its output shown, stopped and released from here", { skip: live, timeout: 180000 }, async (t) => {
  const w = await sandboxed(t);
  const base = runtimeAt(w.at);
  const current = (await w.api.get(`${base}/settings`)).json;
  const sandbox = { ...current.settings.sandbox, restore: { ...current.settings.sandbox.restore, mode: "manual" } };
  const components = { "node:web": { port: { override: { kind: "env", name: "PORT", format: "{port}" } } } };
  assert.equal((await w.api.put(`${base}/settings`, { settings: { ...current.settings, sandbox, components }, revision: current.revision })).status, 200);
  writeFileSync(join(workspaceOf(w), "web", "serve.js"), 'const s = require("http").createServer((q, r) => r.end("ok")).listen(Number(process.env.PORT), "127.0.0.1", () => console.log("listening on " + process.env.PORT));\n');
  const sbx = () => bindSandbox({ pluginRoot: REPO, env: w.world.env, cwd: w.root.project, task: w.task });
  const prepared = await RUNTIME_COMMANDS["sandbox-prepare"].run(sbx(), [`--task=${w.task}`]);
  assert.equal(prepared.state, "READY", JSON.stringify(prepared));
  const started = await RUNTIME_COMMANDS["sandbox-start"].run(sbx(), [`--task=${w.task}`]);
  w.tasks.tick();
  receipt(w.tasks, w.task, prepared.environment);
  try {
    const got = await w.api.get(taskAt(w.at, `/${w.task}/sandbox`));
    assert.equal(got.status, 200, got.text);
    assert.deepEqual([got.json.sandbox.owner.id, got.json.sandbox.state, got.json.sandbox.stale], [w.task, "READY", false]);
    assert.equal(got.text.includes(w.root.base), false, "no path of this machine reaches the page");
    const session = started.started[0].session;
    const logs = await printed(() => w.api.get(taskAt(w.at, `/${w.task}/sandbox/logs/${session}?tail=20`)), /listening on 42\d{3}/);
    assert.equal(logs.status, 200, logs.text);
    assert.match(logs.json.lines.join("\n"), /listening on 42\d{3}/);
    const stopped = await w.api.post(taskAt(w.at, `/${w.task}/sandbox/stop`), { human: true });
    assert.equal(stopped.status, 200, stopped.text);
  } finally {
    const released = await w.api.post(taskAt(w.at, `/${w.task}/sandbox/release`), { human: true });
    assert.equal(released.status, 200, released.text);
  }
  const twice = await w.api.post(taskAt(w.at, `/${w.task}/sandbox/release`), { human: true });
  assert.deepEqual([twice.status, twice.json.error.code], [409, "SANDBOX_RELEASED"]);
  assert.equal((await w.api.get(taskAt(w.at, `/${w.task}/sandbox`))).json.sandbox.state, "RELEASED");
});

// A process's first words take a moment to reach its log: ask again, a few times, until they are there.
async function printed(read, wanted) {
  const last = { got: await read() };
  for (let n = 0; n < 40 && !wanted.test((last.got.json?.lines ?? []).join("\n")); n++) {
    await new Promise((done) => setTimeout(done, 150));
    last.got = await read();
  }
  return last.got;
}

const workspaceOf = (w) => bindSandbox({ pluginRoot: REPO, env: w.world.env, cwd: w.root.project, task: w.task }).root;
