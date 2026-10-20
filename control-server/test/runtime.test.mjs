// A checkout's runtime in Orbit Control, over HTTP: the same commands the CLI has, over the same
// binding, on the checkout the path names. What is promised: reading starts nothing and writes
// nothing; every change needs the page's token; no command, path or flag comes from a body; the one
// operation that writes the repository is a person's, for a proposal that is still true; settings
// name the revision they read; and a real dev server can be started, asked and ended from here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { RUNTIME_COMMANDS, bindRuntime } from "../src/core.mjs";
import { createProcess } from "../../src/process/index.mjs";
import { fixture } from "./fixture.mjs";
import { gitCheckout, gitStatus, REPO, runtimeWorld, serve } from "./checkout.mjs";

// Asked through the Process port the runtime launches with, so a Windows `npm.cmd` counts.
const hasNpm = createProcess().run("npm", ["--version"], { timeoutMs: 30000 }).ok;
const live = process.platform === "win32" ? "a real start on Windows is not yet proven by this suite: it runs on POSIX" : hasNpm ? false : "needs npm on the PATH";

const freePort = () => new Promise((resolve) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => resolve(port));
  });
});

const web = (serve = "setInterval(() => {}, 1000);\n") => ({ "web/package.json": JSON.stringify({ name: "web", engines: { node: ">=18" }, scripts: { dev: "node serve.js" } }), "web/package-lock.json": "{}", "web/serve.js": serve });

// A Control over a checkout Orbit has been used from, and the path of its runtime.
async function opened(t, files = web()) {
  const { root } = fixture(t);
  const world = runtimeWorld(root);
  gitCheckout(root.project, files);
  const cli = () => bindRuntime({ pluginRoot: REPO, env: world.env, cwd: root.project });
  await RUNTIME_COMMANDS.discover.run(cli(), []);
  await RUNTIME_COMMANDS.doctor.run(cli(), []);
  const api = await serve(t, root, world);
  const [project] = (await api.get("/api/v1/projects")).json.projects;
  const base = `/api/v1/projects/${encodeURIComponent(project.key)}/checkouts/${project.checkouts[0].id}/runtime`;
  return { root, api, base, cli };
}

test("reading the runtime says what is understood and how it would run here, and starts, probes and writes nothing in the repository", async (t) => {
  const { root, api, base } = await opened(t);
  const before = gitStatus(root.project);
  const got = await api.get(base);
  assert.equal(got.status, 200);
  assert.deepEqual([got.json.understanding.state, got.json.plan.overall, got.json.sessions], ["CURRENT", "READY", []]);
  assert.ok(got.json.plan.components.some((c) => c.key === "node:web" && c.state === "ready"));
  assert.equal(gitStatus(root.project), before);
});

test("every change needs the page's token: without it nothing runs, whatever the body says", async (t) => {
  const { api, base } = await opened(t);
  for (const [method, tail] of [["POST", "/discover"], ["POST", "/design"], ["POST", "/doctor"], ["POST", "/prepare"], ["POST", "/validate"], ["POST", "/start"], ["POST", "/stop"], ["PUT", "/settings"], ["POST", "/connectivity/db/check"], ["POST", "/connectivity/db/retry"]]) {
    const got = await api.bare(method, `${base}${tail}`);
    assert.deepEqual([got.status, got.json.error.code], [403, "MUTATION_TOKEN_REQUIRED"], `${method} ${tail}`);
  }
});

test("a body is a choice among things that exist: no command, no path, no flag the operation did not name", async (t) => {
  const { api, base } = await opened(t);
  for (const [tail, body] of [["/start", { command: "rm -rf /" }], ["/start", { component: 5 }], ["/start", { wait: 9999 }], ["/stop", { release: "rs-000000000000", human: true }], ["/discover", { cwd: "/" }], ["/prepare", []], ["/prepare", { apply: true }], ["/start", JSON.parse('{"constructor": 1, "__proto__": 2}')], ["/design", { dry: true }]]) {
    const got = await api.post(`${base}${tail}`, body);
    assert.deepEqual([got.status, got.json.error.code], [400, "RUNTIME_BODY_INVALID"], `${tail} ${JSON.stringify(body)}`);
  }
  const unknown = await api.post(`${base}/start`, { component: "node:nothing" });
  assert.equal(unknown.status, 400);
  assert.match(unknown.json.error.message, /no component "node:nothing" is known here/);
});

test("bringing an environment up is a person's: without human:true nothing is asked of the machine, and a plan needs no one", async (t) => {
  const { api, base } = await opened(t);
  const refused = await api.post(`${base}/validate`, {});
  assert.deepEqual([refused.status, refused.json.error.code], [400, "HUMAN_REQUIRED"]);
  const falsy = await api.post(`${base}/validate`, { human: false });
  assert.deepEqual([falsy.status, falsy.json.error.code], [400, "HUMAN_REQUIRED"]);
  const plan = await api.post(`${base}/prepare`, {});
  assert.deepEqual([plan.status, plan.json.apply], [200, false], "a plan acts on nothing");
});

test("discover again asks nothing of the repository's files when nothing moved, and a dry look writes nothing", async (t) => {
  const { api, base } = await opened(t);
  const again = await api.post(`${base}/discover`, {});
  assert.deepEqual([again.status, again.json.decision.name, again.json.state], [200, "CURRENT", "CURRENT"]);
  const dry = await api.post(`${base}/discover`, { dry: true, rescan: true });
  assert.deepEqual([dry.status, dry.json.decision.dry], [200, true]);
});

test("a design is a proposal kept for review and writes no file in the repository; adopting it is a person's, and writes only what it says", async (t) => {
  const { root, api, base } = await opened(t);
  const before = gitStatus(root.project);
  const design = await api.post(`${base}/design`, {});
  assert.equal(design.status, 200);
  assert.match(design.json.id, /^ep-[a-f0-9]{12}$/);
  assert.equal(design.json.state, "CREATE");
  assert.equal(gitStatus(root.project), before, "designing wrote nothing in the repository");
  const read = await api.get(`${base}/proposals/${design.json.id}`);
  assert.deepEqual([read.status, read.json.id], [200, design.json.id]);
  const unrelayed = await api.post(`${base}/proposals/${design.json.id}/adopt`, {});
  assert.deepEqual([unrelayed.status, unrelayed.json.error.code], [400, "HUMAN_REQUIRED"]);
  assert.equal(gitStatus(root.project), before, "an unrelayed adopt wrote nothing");
  const adopted = await api.post(`${base}/proposals/${design.json.id}/adopt`, { human: true });
  assert.equal(adopted.status, 200, adopted.text);
  assert.ok(existsSync(join(root.project, ".devcontainer", "devcontainer.json")));
  assert.match(gitStatus(root.project), /^\?\? \.devcontainer\/$/m, "exactly the proposal's file, and nothing else, is new");
  const twice = await api.post(`${base}/proposals/${design.json.id}/adopt`, { human: true });
  assert.deepEqual([twice.status, twice.json.error.code], [400, "RUNTIME_OPERATION_FAILED"]);
});

test("a proposal that stopped being true is a 409 STALE_PROPOSAL, and what somebody else wrote in the meantime is left exactly as it is", async (t) => {
  const { root, api, base } = await opened(t);
  const design = (await api.post(`${base}/design`, {})).json;
  mkdirSync(join(root.project, ".devcontainer"), { recursive: true });
  writeFileSync(join(root.project, ".devcontainer", "devcontainer.json"), '{ "name": "written by hand" }\n');
  const got = await api.post(`${base}/proposals/${design.id}/adopt`, { human: true });
  assert.deepEqual([got.status, got.json.error.code], [409, "STALE_PROPOSAL"]);
  assert.equal(readFileSync(join(root.project, ".devcontainer", "devcontainer.json"), "utf8"), '{ "name": "written by hand" }\n');
});

test("a proposal id is the shape an id has, before anything looks for it", async (t) => {
  const { api, base } = await opened(t);
  const got = await api.get(`${base}/proposals/..%2F..%2Fsettings`);
  assert.deepEqual([got.status, got.json.error.code], [400, "INVALID_PROPOSAL_ID"]);
  const none = await api.get(`${base}/proposals/ep-000000000000`);
  assert.equal(none.status, 400);
  assert.match(none.json.error.message, /no proposal ep-000000000000 is kept for this checkout/);
});

test("settings are a person's: written against the revision the page read, refused when it is stale, and never a command", async (t) => {
  const { api, base } = await opened(t);
  const first = (await api.get(`${base}/settings`)).json;
  assert.deepEqual([first.revision, first.settings.strategy], [null, "auto"]);
  const saved = await api.put(`${base}/settings`, { settings: { ...first.settings, strategy: "native" }, revision: first.revision });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.saved.settings.strategy, "native");
  const stale = await api.put(`${base}/settings`, { settings: { ...first.settings, strategy: "auto" }, revision: first.revision });
  assert.deepEqual([stale.status, stale.json.error.code], [409, "STALE_REVISION"]);
  const fresh = (await api.get(`${base}/settings`)).json;
  assert.equal(fresh.settings.strategy, "native", "the stale write changed nothing");
  const forced = await api.put(`${base}/settings`, { settings: { ...fresh.settings, strategy: "force" }, revision: fresh.revision });
  assert.deepEqual([forced.status, forced.json.error.code], [400, "RUNTIME_SETTINGS_INVALID"]);
  const shape = await api.put(`${base}/settings`, { revision: fresh.revision });
  assert.deepEqual([shape.status, shape.json.error.code], [400, "RUNTIME_SETTINGS_INVALID"]);
});

test("a sandbox block that is not the shape a policy has is refused whole as RUNTIME_SETTINGS_INVALID, and the saved settings do not move", async (t) => {
  const { api, base } = await opened(t);
  const first = (await api.get(`${base}/settings`)).json;
  const bad = [{ ...first.settings.sandbox, limits: { active: 99 } }, { ...first.settings.sandbox, strategy: "docker" }, { ...first.settings.sandbox, extra: true }, { ...first.settings.sandbox, restore: { mode: "approved", trusted: ["not-a-fingerprint"] } }, { ...first.settings.sandbox, ports: { mode: "lease", from: 80, to: 90 } }, { ...first.settings.sandbox, qa: { modes: [], entry: null, browser: "profile" } }];
  for (const sandbox of bad) {
    const got = await api.put(`${base}/settings`, { settings: { ...first.settings, sandbox }, revision: first.revision });
    assert.deepEqual([got.status, got.json.error.code], [400, "RUNTIME_SETTINGS_INVALID"], JSON.stringify(sandbox));
  }
  assert.deepEqual((await api.get(`${base}/settings`)).json, first);
});

test("a doctor asks this machine only what the checkout's requirements name", async (t) => {
  const { api, base } = await opened(t);
  const got = await api.post(`${base}/doctor`, {});
  assert.equal(got.status, 200);
  assert.ok(Object.keys(got.json.machine.tools).includes("node"));
  assert.equal(Object.keys(got.json.machine.tools).includes("docker"), false, "a container host is asked about only when it matters");
});

test("a real dev server is started, asked and ended from here, and the listing says where it ended up", { skip: live, timeout: 120000 }, async (t) => {
  const port = await freePort();
  const { api, base } = await opened(t, web(`require("net").createServer((s) => s.on("error", () => {})).listen(${port}, "127.0.0.1");\nsetInterval(() => {}, 1000);\n`));
  try {
    const current = (await api.get(`${base}/settings`)).json;
    const set = { ...current.settings, components: { "node:web": { readiness: { kind: "tcp", target: port } } } };
    assert.equal((await api.put(`${base}/settings`, { settings: set, revision: current.revision })).status, 200);
    const started = await api.post(`${base}/start`, { wait: 30 });
    assert.equal(started.status, 200, started.text);
    assert.deepEqual([started.json.started[0].component, started.json.started[0].readiness.state], ["node:web", "READY"]);
    const status = (await api.get(base)).json;
    assert.deepEqual([status.sessions[0].state, status.sessions[0].ownership, status.sessions[0].readiness.state], ["RUNNING", "ORBIT_OWNED", "READY"]);
    assert.equal((await api.get("/api/v1/projects")).json.projects[0].checkouts[0].summary.runtime, "RUNNING");
  } finally {
    await api.post(`${base}/stop`, {});
  }
  const ended = (await api.get(base)).json;
  assert.equal(ended.sessions[0].state === "RUNNING", false, "nothing of Orbit's is left running");
  assert.equal((await api.get("/api/v1/projects")).json.projects[0].checkouts[0].summary.runtime, "STOPPED");
});

// ---- connectivity: reach targets a PERSON configured, asked from where things run -----------------

// A listener on this machine's loopback that counts the connections it is asked for.
async function counting(t) {
  const seen = { hits: 0 };
  const server = createServer((s) => (seen.hits++, s.on("error", () => {}), s.destroy()));
  const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
  t.after(() => server.close());
  return { seen, port, close: () => new Promise((resolve) => server.close(resolve)) };
}

const reachTarget = (port, over = {}) => ({ label: "Database", host: "127.0.0.1", port, protocol: "tcp", requiredBy: ["node:web"], checkFrom: ["native"], beforeStart: false, ...over });

async function withTarget(api, base, port, over = {}, retry = { attempts: 2, intervalMs: 250, timeoutMs: 1000 }) {
  const read = (await api.get(`${base}/settings`)).json;
  return api.put(`${base}/settings`, { settings: { ...read.settings, connectivity: { retry, targets: { db: reachTarget(port, over) } } }, revision: read.revision });
}

test("connectivity with nothing configured is an empty list -- and reading it, or a configured one, opens no connection", async (t) => {
  const { api, base } = await opened(t);
  const empty = await api.get(`${base}/connectivity`);
  assert.deepEqual([empty.status, empty.json.targets, empty.json.retry], [200, [], { attempts: 3, intervalMs: 1000, timeoutMs: 3000 }]);
  const db = await counting(t);
  assert.equal((await withTarget(api, base, db.port, { checkFrom: ["native", "devcontainer"] })).status, 200);
  const read = (await api.get(`${base}/connectivity`)).json;
  await api.get(base);
  assert.deepEqual(Object.values(read.targets[0].observations).map((o) => [o.provider, o.state, o.checkedAt, o.attemptsUsed]), [["native", "NOT_CHECKED", null, 0], ["devcontainer", "NOT_CHECKED", null, 0]]);
  assert.equal(db.seen.hits, 0, "neither the connectivity read nor the runtime status made a connection");
});

test("Check once is ONE attempt at the setting's host and port from the location the body names; Retry is the saved policy -- up, down, and said", async (t) => {
  const { api, base } = await opened(t);
  const db = await counting(t);
  await withTarget(api, base, db.port);
  const once = await api.post(`${base}/connectivity/db/check`, { provider: "native" });
  assert.equal(once.status, 200);
  assert.deepEqual([once.json.mode, once.json.results.native.state, once.json.results.native.resolution, once.json.results.native.transport, once.json.results.native.attemptsUsed, once.json.results.native.configuredAttempts], ["check", "REACHABLE", "NOT_ATTEMPTED", "REACHABLE", 1, 1]);
  assert.equal(db.seen.hits, 1, "exactly one connection: the server does not loop a check");
  const read = (await api.get(`${base}/connectivity`)).json.targets[0].observations.native;
  assert.deepEqual([read.state, read.freshness.stale], ["REACHABLE", false], "what was observed is what is read back");
  await db.close();
  const retried = await api.post(`${base}/connectivity/db/retry`, {});
  assert.deepEqual([retried.json.mode, retried.json.results.native.state, retried.json.results.native.attemptsUsed, retried.json.results.native.attempts.length], ["retry", "UNREACHABLE", 2, 2], "the saved attempts, and no more");
  assert.match(retried.json.results.native.because, /could not be reached/);
});

test("a check from the dev container with no environment up is BLOCKED and said, while the host's answer stands on its own", async (t) => {
  const { api, base } = await opened(t);
  const db = await counting(t);
  await withTarget(api, base, db.port, { checkFrom: ["native", "devcontainer"] });
  const both = await api.post(`${base}/connectivity/db/check`, {});
  assert.equal(both.status, 200);
  assert.deepEqual([both.json.results.native.state, both.json.results.devcontainer.state, both.json.results.devcontainer.attemptsUsed], ["REACHABLE", "BLOCKED", 1]);
  assert.match(both.json.results.devcontainer.because, /not up|could not be asked|no environment has been adopted/);
});

test("a check names a target by its id and chooses only a location: a host, a port, a URL or a command in the body is refused before anything is looked up", async (t) => {
  const { api, base } = await opened(t);
  const db = await counting(t);
  await withTarget(api, base, db.port);
  for (const body of [{ host: "10.0.0.1", port: 22 }, { url: "tcp://10.0.0.1:22" }, { command: "nc -z 10.0.0.1 22" }, { provider: "ssh" }, { provider: "native", port: 1 }, [], JSON.parse('{"__proto__": {"host": "10.0.0.1"}}')]) {
    const got = await api.post(`${base}/connectivity/db/check`, body);
    assert.deepEqual([got.status, got.json.error.code], [400, "RUNTIME_BODY_INVALID"], JSON.stringify(body));
  }
  assert.equal(db.seen.hits, 0, "nothing was asked of the network");
  assert.deepEqual([(await api.post(`${base}/connectivity/Db/check`, {})).json.error.code, (await api.post(`${base}/connectivity/..%2Fx/check`, {})).json.error.code], ["INVALID_TARGET_ID", "INVALID_TARGET_ID"]);
  const ghost = await api.post(`${base}/connectivity/ghost/check`, { provider: "native" });
  assert.deepEqual([ghost.status, ghost.json.error.code], [404, "TARGET_UNKNOWN"]);
  assert.match(ghost.json.error.message, /no connectivity target "ghost" is set for this machine/);
  assert.equal((await api.get(`${base}/connectivity/ghost/check`)).status, 405);
});

test("reach targets ride the same revisioned settings write: a stale write changes no target, and a target that is not a host and a port is refused", async (t) => {
  const { api, base } = await opened(t);
  const db = await counting(t);
  const first = await withTarget(api, base, db.port);
  assert.deepEqual([first.status, first.json.saved.settings.connectivity.targets.db.port], [200, db.port]);
  const stale = await api.put(`${base}/settings`, { settings: { ...first.json.saved.settings, connectivity: { retry: { attempts: 3, intervalMs: 1000, timeoutMs: 3000 }, targets: {} } }, revision: "0000000000000000" });
  assert.deepEqual([stale.status, stale.json.error.code], [409, "STALE_REVISION"]);
  assert.deepEqual((await api.get(`${base}/connectivity`)).json.targets.map((x) => x.id), ["db"], "the target is still there");
  for (const over of [{ host: "http://db" }, { port: 70000 }, { command: "nc" }, { note: "token=abcdef0123456789" }]) {
    const read = (await api.get(`${base}/settings`)).json;
    const bad = await api.put(`${base}/settings`, { settings: { ...read.settings, connectivity: { retry: read.settings.connectivity.retry, targets: { db: reachTarget(db.port, over) } } }, revision: read.revision });
    assert.deepEqual([bad.status, bad.json.error.code], [400, "RUNTIME_SETTINGS_INVALID"], JSON.stringify(over));
  }
  const policy = (await api.get(`${base}/settings`)).json;
  const tooMany = await api.put(`${base}/settings`, { settings: { ...policy.settings, connectivity: { ...policy.settings.connectivity, retry: { attempts: 1000000, intervalMs: 1000, timeoutMs: 3000 } } }, revision: policy.revision });
  assert.deepEqual([tooMany.status, tooMany.json.error.code], [400, "RUNTIME_SETTINGS_INVALID"]);
  assert.match(tooMany.json.error.message, /retry\.attempts is 1 to 10/);
});

test("nothing a connectivity answer carries is a value from this machine's environment", async (t) => {
  const { root } = fixture(t);
  const world = runtimeWorld(root);
  world.env.ORBIT_TEST_CANARY = "canary-6b1f0c2e9a7d";
  world.env.DB_PASSWORD = "canary-6b1f0c2e9a7d";
  gitCheckout(root.project, web());
  await RUNTIME_COMMANDS.discover.run(bindRuntime({ pluginRoot: REPO, env: world.env, cwd: root.project }), []);
  const api = await serve(t, root, world);
  const [project] = (await api.get("/api/v1/projects")).json.projects;
  const base = `/api/v1/projects/${encodeURIComponent(project.key)}/checkouts/${project.checkouts[0].id}/runtime`;
  const db = await counting(t);
  await withTarget(api, base, db.port, { note: "set from the terminal", checkFrom: ["native", "devcontainer"] });
  const texts = [(await api.get(base)).text, (await api.get(`${base}/settings`)).text, (await api.get(`${base}/connectivity`)).text, (await api.post(`${base}/connectivity/db/check`, {})).text, (await api.post(`${base}/connectivity/db/retry`, { provider: "native" })).text];
  for (const text of texts) assert.equal(text.includes("canary-6b1f0c2e9a7d") || text.includes("ORBIT_TEST_CANARY"), false);
});
