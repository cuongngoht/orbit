// The messaging conformance kit (doc §5.10; ADR 0035) knows no transport: where a scenario's
// resources go is the adapter's own conformance.params, filled with {ns} {id} {obs} {key}; a
// scenario whose semantics are unknown or unmet is not applicable, never a pass; and the
// non-stealing scenario asks the system's WITNESS, never the adapter under test.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SCENARIOS, filled, scenarioResult } from "../skills/orbit-adapter-kit/messaging.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADAPTERS = JSON.parse(readFileSync(join(ROOT, "skills/orbit-backend-test/adapters.json"), "utf8")).adapters;

test("templates are filled at any depth, and nothing but the four placeholders is read", () => {
  assert.deepEqual(filled({ q: "{ns}.{obs}", list: [{ k: "{ns}.{key}" }], n: 3, other: "{nope}" }, { ns: "kit", obs: "o1", key: "a.b" }), { q: "kit.o1", list: [{ k: "kit.a.b" }], n: 3, other: "{nope}" });
});

test("every messaging reference adapter declares where the kit's resources go", () => {
  for (const a of ADAPTERS.filter((x) => x.family === "messaging")) {
    for (const k of ["channel", "observer", "sink", "witness"]) assert.ok(a.conformance?.params?.[k], `${a.id} conformance.params.${k}`);
  }
});

// A scripted system that answers like a well-behaved broker -- and a witness that says the sink kept it.
function kit(semantics, over = {}) {
  const asked = [];
  const answers = {
    "fixture.prepare": () => ({ ok: true, value: { namespace: "kit" } }),
    "fixture.cleanup": (bound) => (bound.fixtureRef.namespace.endsWith("x") ? { ok: false, class: "refused" } : { ok: true, value: { cleanup: { removed: ["kit.q"], left: [] } } }),
    publish: (bound, request) => ({ ok: true, value: { messageId: request.messageId, outcome: /nobody/.test(JSON.stringify(bound)) ? "returned" : "confirmed" } }),
    observe: () => ({ ok: true, value: { completeness: "armed" } }),
    "observe.await": (bound, request) => ({ ok: true, value: { completeness: "complete", messages: asked.filter((a) => a.op === "observe.await").length % 2 ? [{ id: request.count ? "kit-m-4" : "kit-m-3" }] : [] } }),
    ...over,
  };
  const ask = (op, request, bound) => (asked.push({ op, bound }), answers[op](bound, request));
  return { asked, k: { adapter: { id: "example.mq", transports: ["example-mq"], semantics }, params: ADAPTERS.find((a) => a.id === "amqp.reference").conformance.params, ns: "kit", ask, system: { endpoint: { host: "broker", port: 1 }, credential: {}, witness: { pending: () => 1 } } } };
}

const SEMANTICS = { publishAck: "broker-confirm", unroutable: "returned", observation: ["shadow-subscription"] };

test("a system that behaves passes every scenario, through resources placed by the adapter's own templates", () => {
  const { k, asked } = kit(SEMANTICS);
  assert.deepEqual(SCENARIOS.map((s) => scenarioResult(k, s).outcome), ["passed", "passed", "passed", "passed", "passed"]);
  assert.ok(asked.some((a) => a.op === "observe" && a.bound.observerRef.queue === "kit.obswindow"), "the observer's queue came from the template");
});

test("unknown or unmet semantics make a scenario NOT APPLICABLE -- never a pass", () => {
  const { k } = kit({ observation: "unknown" });
  const words = Object.fromEntries(SCENARIOS.map((s) => [s.id, scenarioResult(k, s).outcome]));
  assert.equal(words["observe-complete-window"], "not-applicable");
  assert.equal(words["publish-confirmed"], "not-applicable", "publishAck was never stated");
  assert.equal(words["fixture-own-namespace"], "passed", "a scenario that needs nothing still runs");
});

test("an observer that took the application's message fails non-stealing on the WITNESS's word", () => {
  const { k } = kit(SEMANTICS);
  k.system.witness = { pending: () => 0 };
  assert.equal(scenarioResult(k, SCENARIOS.find((s) => s.id === "observer-non-stealing")).outcome, "failed");
  const confirmedNowhere = kit(SEMANTICS, { publish: (bound, request) => ({ ok: true, value: { messageId: request.messageId, outcome: "confirmed" } }) });
  assert.equal(scenarioResult(confirmedNowhere.k, SCENARIOS.find((s) => s.id === "unroutable-not-confirmed")).outcome, "failed", "a publication nothing routed reported confirmed");
});

// The test-hook kit (skills/orbit-adapter-kit/hooks.mjs): which schedule, clock and workload is the
// system's, and whether a dispatch really happened is the WITNESS's word.
import { SCENARIOS as HOOK_SCENARIOS, scenarioResult as hookResult } from "../skills/orbit-adapter-kit/hooks.mjs";
import { SCENARIOS as STATE_SCENARIOS, scenarioResult as stateResult } from "../skills/orbit-adapter-kit/state.mjs";

function hookKit(semantics, executed = true, issued = () => `syn_${Math.random().toString(16).slice(2)}_0123456789`) {
  const answers = {
    trigger: () => ({ ok: true, value: { executionRef: "exe-1" } }),
    decisions: (request) => ({ ok: true, value: { decisions: request.since ? [] : [{ occurrenceId: "o-1" }], through: 4, completeness: "complete" } }),
    advance: (request) => ({ ok: true, value: { evaluatedThrough: request.to } }),
    control: (request) => ({ ok: true, value: { status: request.action === "stop" ? "stopped" : "running" } }),
    attempts: () => ({ ok: true, value: { attempts: [], through: 0, completeness: "complete" } }),
    issue: () => ({ ok: true, value: { principal: "tenant-a-reader", token: issued() } }),
  };
  return { adapter: { semantics }, ask: (op, request) => answers[op](request), system: { bound: { schedule: {}, clock: {}, workload: {}, identity: { principal: "tenant-a-reader", tenant: "tenant-a" } }, witness: { executed: () => executed, authenticates: (token, principal) => token.startsWith("syn_") && principal === "tenant-a-reader" }, now: () => Date.parse("2026-10-22T02:00:00Z") } };
}

test("the hook kit passes a system that behaves, and a dispatch the witness cannot find fails", () => {
  const k = hookKit({ decisionReceipts: "cursor", clockInjection: "live" });
  assert.deepEqual(HOOK_SCENARIOS.map((s) => hookResult(k, s).outcome), ["passed", "passed", "passed", "passed", "passed", "passed"]);
  const identity = HOOK_SCENARIOS.find((s) => s.id === "identity-issued");
  assert.equal(hookResult(hookKit({}, true, () => "syn_the_same_token_000"), identity).outcome, "failed", "two identities issued are two tokens");
  assert.equal(JSON.stringify(hookResult(k, identity)).includes("syn_"), false, "a receipt keeps whether they differed, never a token");
  assert.equal(hookResult(hookKit({}, false), HOOK_SCENARIOS[0]).outcome, "failed", "an execution ref the system has no record of");
  assert.equal(hookResult(hookKit({ clockInjection: "none" }), HOOK_SCENARIOS.find((s) => s.id === "clock-barrier")).outcome, "not-applicable");
});

function stateKit(answer, store = { rows: 3, total: 4 }) {
  return { adapter: { semantics: { observation: ["read-only-query"] } }, ask: (op, request) => answer(request, store), system: { bound: { key: "k-1", state: { table: "kit.Reminders" } }, witness: { count: (key) => (key === "k-1" ? store.rows : 0), total: () => store.total }, nonce: "n" } };
}

const honest = (request) => (request.match ? { ok: false, class: "refused" } : { ok: true, value: request.key === "k-1" ? { count: 3, rows: [{}, {}] } : { count: 0, rows: [] } });

test("the state kit passes a store that reads what was written, and catches one that counts a value as SQL or a name as a name", () => {
  assert.deepEqual(STATE_SCENARIOS.map((s) => stateResult(stateKit(honest), s).outcome), ["passed", "passed", "passed", "passed"]);
  const injectable = (request, store) => (request.key?.includes("DELETE") ? ((store.total = 0), { ok: true, value: { count: 4, rows: [] } }) : honest(request));
  assert.equal(stateResult(stateKit(injectable), STATE_SCENARIOS.find((s) => s.id === "values-are-parameters")).outcome, "failed", "a value that changed the store is no read");
  const lax = (request) => (request.match ? { ok: true, value: { count: 4, rows: [] } } : honest(request));
  assert.equal(stateResult(stateKit(lax), STATE_SCENARIOS.find((s) => s.id === "names-are-refused")).outcome, "failed");
  assert.equal(stateResult(stateKit((r) => ({ ok: true, value: { count: 2, rows: [{}, {}] } })), STATE_SCENARIOS[0]).outcome, "failed", "a count that is not the witness's");
});
