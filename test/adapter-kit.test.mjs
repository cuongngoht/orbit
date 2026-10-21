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
