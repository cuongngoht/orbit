// Autonomous QA over a TASK'S SANDBOX: the environment a task owns, projected at run time from the runtime and
// never declared, the runtime's answer about it, and the gate that holds QA when the code under test is not the
// code the task now holds. Every runtime shape here is handed IN (the investigation imports none of it), so
// what is under test is the engine's half: the entry rows, the projection, RUNTIME_STALE, and what the journal
// keeps of the binding.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Blocked, Refused } from "../src/errors.mjs";
import { sandboxAnswer } from "../skills/orbit-runtime/bind.mjs";
import { GATES } from "../src/investigation/gates.mjs";
import { act, begin, contextFor, loopWorld, modelOf, planFor, readSettings, step, writeSettings } from "../src/investigation/index.mjs";
import { receiptsOf } from "../src/investigation/receipts.mjs";
import { ENTRY, entryOf, sandboxEnvironment, sandboxRuntime } from "../src/investigation/sandbox.mjs";
import { ENVIRONMENT_KINDS, KINDS } from "../src/investigation/vocab.mjs";
import { createContext } from "../src/run/context.mjs";
import { aqaWorld, SANDBOX_PORT, SAVE_CHAIN, sandboxView, sandboxWorld, TREE_A, TREE_B } from "./autonomous-qa.harness.mjs";
import { fixtureProject, FIXTURES } from "./fakes/context.mjs";

const view = sandboxView;
const http = (component, port) => ({ component, endpoint: { component, kind: "http", port } });
const gotos = (t) => t.browser.calls.filter((c) => c[0] === "goto").length;
const journalOf = (t) => t.w.store.read(t.id);

// ------------------------------------------------------------- the entry
test("entry: the component a person's policy names, then the only http endpoint, then nobody -- and the last row always answers", () => {
  const named = view({ components: [http("node:web", 42001), http("node:admin", 42002)], qa: { modes: [], entry: "node:admin", browser: "isolated" } });
  assert.equal(entryOf(named).port, 42002, "the policy's word outranks the number of endpoints");
  assert.equal(entryOf(view()).port, SANDBOX_PORT, "one http endpoint is the only one a browser can open");
  const two = view({ components: [http("node:web", 42001), http("node:admin", 42002)] });
  assert.throws(() => entryOf(two), (e) => e instanceof Refused && /a person names which endpoint the browser opens \(sandbox policy qa\.entry, in Orbit Control\)/.test(e.message));
  assert.throws(() => entryOf(view({ components: [] })), Refused);
  assert.deepEqual(ENTRY.map((r) => r.id), ["POLICY", "ONLY_HTTP", "NONE"]);
  assert.ok(ENTRY.every((r) => r.say && r.say.length > 0), "a sentence per row");
  assert.equal(ENTRY.at(-1).when({}), true, "the last row always matches");
});

test("entry: a policy that names a component with no endpoint, a database that speaks no http, and a browser this release does not have are all Refused", () => {
  assert.throws(() => entryOf(view({ qa: { modes: [], entry: "node:db", browser: "isolated" } })), /no endpoint for node:db, which sandbox policy qa\.entry names/);
  const tcpOnly = view({ components: [{ component: "node:db", endpoint: { component: "node:db", kind: "tcp", port: 42002 } }] });
  assert.throws(() => entryOf(tcpOnly), Refused, "a tcp endpoint is not something a browser opens");
  assert.throws(() => entryOf(view({ qa: { modes: [], entry: null, browser: "attached" } })), (e) => e instanceof Refused && /not in this release/.test(e.message));
  assert.doesNotThrow(() => entryOf(view({ qa: { modes: [], entry: null, browser: null } })));
});

// --------------------------------------------------------- the projection
test("projection: an environment of kind sandbox on the sandbox's loopback entry, bound to its task and its tree", () => {
  const a = view();
  assert.deepEqual(sandboxEnvironment(a), { id: a.environment, origin: `http://127.0.0.1:${SANDBOX_PORT}`, kind: "sandbox", modes: ["observe", "explore-write"], task: a.owner.id, sourceTree: TREE_A });
  assert.deepEqual(sandboxRuntime(a, true), { component: "node:web", port: SANDBOX_PORT, served: true, next: `start the sandbox (sandbox-start, task ${a.owner.id}), then act again`, environment: a.environment, task: a.owner.id, sourceTree: TREE_A, taskTree: TREE_A, current: true });
  assert.equal(sandboxRuntime(a, undefined).served, false, "a probe that could not say is not an answer");
});

test("projection: modes come ONLY from the person's policy -- none means observe, and the CLI has no word in it", () => {
  assert.deepEqual(sandboxEnvironment(view({ qa: { modes: [], entry: null, browser: "isolated" } })).modes, ["observe"]);
  assert.deepEqual(sandboxEnvironment(view({ qa: { modes: ["observe", "security-test"], entry: null, browser: "isolated" } })).modes, ["observe", "security-test"]);
  assert.equal(sandboxEnvironment.length, 1, "it takes the runtime's view and nothing else: no flag reaches it");
});

test("modes: --mode=explore-write on a policy without it is NOT_APPROVED, in the plan and before the browser", () => {
  const observeOnly = sandboxWorld({ view: { qa: { modes: [], entry: null, browser: "isolated" } }, world: { mode: "explore-write" } });
  assert.deepEqual(planFor(observeOnly.w, { objective: "explore", scope: "" }).blockers.filter((b) => b.id === "NOT_APPROVED").map((b) => b.stop), ["refused"]);
  assert.throws(() => act(observeOnly.w, SAVE_CHAIN[0]), (e) => e instanceof Refused && /explore-write is not approved on env-0123456789ab/.test(e.message));
  assert.equal(gotos(observeOnly), 0);
  const approved = sandboxWorld({ world: { mode: "explore-write" } });
  assert.equal(planFor(approved.w, { objective: "explore", scope: "" }).blockers.some((b) => b.id === "NOT_APPROVED"), false);
});

test("a sandbox environment drives the loop: it needs no declaring, and `enabled` is still a person's", () => {
  const t = sandboxWorld();
  assert.equal(t.w.environment.kind, "sandbox");
  assert.doesNotThrow(() => act(t.w, SAVE_CHAIN[0]));
  const off = sandboxWorld({ world: { settings: { enabled: false } } });
  assert.throws(() => act(off.w, SAVE_CHAIN[0]), /autonomous QA is off/);
  const named = aqaWorld({ env: "no-such-env" });
  assert.equal(named.make().environment, null, "nothing declared is nothing projected");
});

// --------------------------------------------------------- declared kinds
test("settings: a declared environment of kind sandbox is refused -- it is projected from a task's sandbox, never declared", () => {
  assert.ok(ENVIRONMENT_KINDS.includes("sandbox"));
  const t = aqaWorld();
  const w = t.make();
  const { revision } = readSettings(w.store.paths, w.io);
  const declared = { id: "mine", origin: "http://127.0.0.1:42001", kind: "sandbox", modes: ["observe"] };
  const attempt = () => writeSettings(w.store.paths, w.io, { next: { ...w.settings, environments: [declared] }, revision, by: "person", now: "2026-10-07T00:00:00Z" });
  assert.throws(attempt, (e) => e instanceof Refused && /a sandbox environment is projected from a task's sandbox at run time .* never declared here/.test(e.message));
  assert.deepEqual(readSettings(w.store.paths, w.io).settings.environments.map((e) => e.kind), ["test"], "nothing was kept");
});

// ------------------------------------------------------------ RUNTIME_STALE
const STALE = { stale: true, currentTree: TREE_B };

test("gates: RUNTIME_STALE sits right after RUNTIME_BLOCKED and is the machine's news, never a finding", () => {
  const ids = GATES.map((g) => g.id);
  assert.equal(ids.indexOf("RUNTIME_STALE"), ids.indexOf("RUNTIME_BLOCKED") + 1);
  assert.equal(GATES.find((g) => g.id === "RUNTIME_STALE").stop, "blocked");
});

test("gates: a sandbox that runs another tree than its task holds blocks act with the exact sentence, before the browser", () => {
  const t = sandboxWorld({ view: STALE });
  const sentence = `the approved sandbox ${t.view.environment} runs source tree ${TREE_A}, but task ${t.view.owner.id} now holds source tree ${TREE_B}; restart the sandbox before verifying it`;
  assert.throws(() => act(t.w, SAVE_CHAIN[0]), (e) => e instanceof Blocked && e.message === sentence);
  assert.equal(gotos(t), 0, "refused before any browser call");
  assert.equal(modelOf(journalOf(t)).actions.length, 0);
  assert.deepEqual(journalOf(t).map((r) => r.kind).filter((k) => k !== "created" && k !== "input" && k !== "plan"), [], "no action, observation or finding: the stop is not news about the product");
});

test("gates: a decision to act on a stale sandbox does not reach the browser either", () => {
  const t = sandboxWorld({ view: STALE, world: { mode: "explore-write" } });
  const ctx = contextFor(t.w);
  const decision = { schemaVersion: 1, decisionId: "stale-1", expectedRevision: ctx.position, target: ctx.frontier[0].id, action: { kind: "act", do: "goto", url: "/home" }, reason: "look at the first screen" };
  const settled = step(t.w, decision);
  assert.equal(settled.state, "blocked", "settled as the machine's news, not run and not a finding");
  assert.match(settled.why, /^the approved sandbox env-0123456789ab runs source tree .*restart the sandbox before verifying it$/);
  assert.equal(gotos(t), 0);
  assert.equal(modelOf(journalOf(t)).actions.length, 0);
});

test("plan: the stale sandbox is a blocker the plan prints, with its stop, and a current one is silent", () => {
  const t = sandboxWorld({ view: STALE });
  const plan = planFor(t.w, { objective: "explore", scope: "" });
  assert.deepEqual(plan.blockers.filter((b) => b.id === "RUNTIME_STALE").map((b) => b.stop), ["blocked"]);
  assert.equal(t.browser.calls.length, 0);
  const current = sandboxWorld();
  assert.equal(planFor(current.w, { objective: "explore", scope: "" }).blockers.some((b) => b.id === "RUNTIME_STALE"), false);
  assert.doesNotThrow(() => act(current.w, SAVE_CHAIN[0]));
});

test("gates: a sandbox nothing answers on is BLOCKED by the runtime's own row, ahead of the stale one", () => {
  const t = sandboxWorld({ view: STALE, served: false });
  assert.throws(() => act(t.w, SAVE_CHAIN[0]), (e) => e instanceof Blocked && /node:web at http:\/\/127\.0\.0\.1:42001, and nothing answers there — start the sandbox \(sandbox-start, task tsk-/.test(e.message));
});

test("gates: no runtime answer, or one that names no sandbox, is silent here", () => {
  const t = aqaWorld({});
  const { id } = begin(t.make(), { objective: "x", scope: "" });
  assert.doesNotThrow(() => act(t.make({ id, runtime: { component: "dotnet:api", port: 5000, served: true, next: "" } }), SAVE_CHAIN[0]));
});

// ----------------------------------------------------- what the journal keeps
test("created.runtime is exactly the sandbox, the task and the source tree; an environment that is not a sandbox keeps none", () => {
  assert.ok(KINDS.created.includes("runtime"));
  const t = sandboxWorld();
  const meta = modelOf(journalOf(t)).meta;
  assert.deepEqual(meta.runtime, { environment: t.view.environment, task: t.view.owner.id, sourceTree: TREE_A });
  assert.deepEqual(meta.environment, { id: t.view.environment, origin: `http://127.0.0.1:${SANDBOX_PORT}`, kind: "sandbox" });
  const plain = aqaWorld({});
  const { id } = begin(plain.make(), { objective: "x", scope: "" });
  assert.equal("runtime" in modelOf(plain.make({ id }).store.read(id)).meta, false);
});

test("receipts: every result's context carries the same binding the journal was created with", () => {
  const t = sandboxWorld();
  const lw = { ...loopWorld(t.w), obligations: [{ id: "obl-1", status: "satisfied", evidence: ["act-1"], kind: "control-effect", subject: "dlg-thing/Save", layer: "ui", oracle: { kind: "observation" }, why: "seen" }] };
  const [receipt] = receiptsOf(lw, {});
  assert.deepEqual(receipt.context.runtime, modelOf(journalOf(t)).meta.runtime);
  const plain = aqaWorld({});
  const { id } = begin(plain.make(), { objective: "x", scope: "" });
  const [none] = receiptsOf({ ...lw, model: modelOf(plain.make({ id }).store.read(id)) }, {});
  assert.equal(none.context.runtime, null);
});

test("the journal keeps no path and no port beyond what created.environment already keeps", () => {
  const t = sandboxWorld({ world: { mode: "explore-write" } });
  SAVE_CHAIN.forEach((s) => act(t.w, s));
  const origin = `http://127.0.0.1:${SANDBOX_PORT}`;
  const text = JSON.stringify(journalOf(t)).replaceAll(origin, "<origin>");
  assert.equal(text.includes(String(SANDBOX_PORT)), false, "the port is the origin's and nowhere else");
  assert.equal(text.includes(tmpdir()), false, "no path of this machine");
  assert.ok(!/[\\/](Users|home)[\\/]/.test(text), "no home directory");
});

// ------------------------------------------------------------- the browser
test("a task-scoped run dir gives the investigation its own browser session, apart from the checkout's", () => {
  const project = fixtureProject();
  const options = (runDir) => ({ project, graph: {}, ...(runDir ? { runDir } : {}) });
  const shared = createContext(options(), {}, FIXTURES);
  const mine = createContext(options(join(project.config.runDir, "sandbox", "env-0123456789ab")), {}, FIXTURES);
  const other = createContext(options(join(project.config.runDir, "sandbox", "env-ba9876543210")), {}, FIXTURES);
  assert.match(shared.browser.session(), /^orbit-[0-9a-f]+$/, "the checkout has its own current session");
  assert.notEqual(shared.browser.session(), mine.browser.session());
  assert.match(mine.browser.session(), /^orbit-[0-9a-f]+$/, "a task's browser is named for its own run directory");
  assert.notEqual(mine.browser.session(), other.browser.session());
  assert.equal(mine.browser.dir(), join(project.config.runDir, "sandbox", "env-0123456789ab"));
});

// 1.8.0's known limit: `plan --sandbox` printed the project's run directory, while the investigation looks for its browser
// in the sandbox's own -- a browser opened exactly as printed was never found. The printed directory is now the bound
// browser's own answer, the one the test above holds to <runDir>/sandbox/<env>.
test("the browser a sandbox plan says to open is opened in the directory the investigation's browser lives in", () => {
  const cli = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "autonomous-qa.mjs"), "utf8");
  const line = cli.split("\n").find((l) => l.startsWith("const browserLine"));
  assert.match(line, /--run-dir \$\{BOUND\.ctx\.browser\.dir\(\)\}/);
  assert.doesNotMatch(line, /config\.runDir/);
});

// ---------------------------------------------------------- the runtime pieces
const sandboxes = (...rows) => ({ sandboxes: rows, staleLeases: [] });

function fakeRuntime({ rows, answer, tcp }) {
  const asked = { sandboxes: 0, sandbox: [], bound: [], tcp: [] };
  const ctx = { probe: { tcp: async (port) => { asked.tcp.push(port); return tcp(port); } } };
  const commands = async () => ({ sandboxes: { run: async () => { asked.sandboxes += 1; return sandboxes(...rows); } }, sandbox: { run: async (c) => { asked.sandbox.push(c); return answer; } } });
  const bindOwned = (where) => { asked.bound.push(where.task); return ctx; };
  return { asked, deps: { commands, bind: () => ({ person: true }), bindOwned } };
}

const WHERE = { pluginRoot: "/plugin", env: {}, cwd: join(tmpdir(), "checkout") };

test("sandboxAnswer: finds the sandbox of this checkout, binds it as its task, and probes the entry port", async () => {
  const t = fakeRuntime({ rows: [{ id: "env-0123456789ab", owner: { kind: "task", id: "tsk-20261007-aaaa" } }], answer: view(), tcp: () => ({ ok: true }) });
  const found = await sandboxAnswer(WHERE, "env-0123456789ab", t.deps);
  assert.deepEqual(found, { view: view(), served: true });
  assert.deepEqual(t.asked.bound, ["tsk-20261007-aaaa"]);
  assert.deepEqual(t.asked.tcp, [SANDBOX_PORT]);
});

test("sandboxAnswer: an owner spelled as an id works, and a probe that throws or says no is served: false", async () => {
  const row = [{ id: "env-0123456789ab", owner: "tsk-20261007-aaaa" }];
  const down = fakeRuntime({ rows: row, answer: view(), tcp: () => { throw new Error("EPERM"); } });
  assert.equal((await sandboxAnswer(WHERE, "env-0123456789ab", down.deps)).served, false);
  assert.deepEqual(down.asked.bound, ["tsk-20261007-aaaa"]);
  const closed = fakeRuntime({ rows: row, answer: view(), tcp: () => ({ ok: false }) });
  assert.equal((await sandboxAnswer(WHERE, "env-0123456789ab", closed.deps)).served, false);
});

test("sandboxAnswer: another checkout's sandbox is never verified from here, and a sandbox nobody can choose an entry for is Refused, not unserved", async () => {
  const t = fakeRuntime({ rows: [{ id: "env-0123456789ab", owner: { id: "tsk-1" } }], answer: view(), tcp: () => ({ ok: true }) });
  await assert.rejects(() => sandboxAnswer(WHERE, "env-ffffffffffff", t.deps), (e) => e instanceof Refused && /no sandbox env-ffffffffffff is known in this checkout; another checkout's sandbox is never verified from here/.test(e.message));
  assert.equal(t.asked.sandbox.length, 0, "nothing of the other sandbox was read");
  const two = fakeRuntime({ rows: [{ id: "env-0123456789ab", owner: { id: "tsk-1" } }], answer: view({ components: [http("node:web", 42001), http("node:admin", 42002)] }), tcp: () => ({ ok: true }) });
  await assert.rejects(() => sandboxAnswer(WHERE, "env-0123456789ab", two.deps), Refused);
  assert.deepEqual(two.asked.tcp, []);
});

test("sandboxAnswer: a runtime without sandbox commands is Refused by name", async () => {
  await assert.rejects(() => sandboxAnswer(WHERE, "env-0123456789ab", { commands: async () => ({}), bind: () => ({}), bindOwned: () => ({}) }), /no sandbox commands/);
});

test("sandboxAnswer: a checkout the runtime cannot be bound to has no sandbox, said as a refusal and never as a crash", async () => {
  const deps = { commands: async () => ({ sandboxes: {}, sandbox: {} }), bind: () => { throw new TypeError("storeBase is undefined"); }, bindOwned: () => ({}) };
  await assert.rejects(() => sandboxAnswer(WHERE, "env-0123456789ab", deps), (e) => e instanceof Refused && /has no sandbox/.test(e.message));
});
