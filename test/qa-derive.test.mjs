// Test obligations are DERIVED (doc §4.1 step 2; ADR 0031): where an accepted criterion's structured
// expectations, the kinds of property it names and the graph node it is about meet a shape. Nothing
// is guessed: a criterion naming no kind is a question, a shape nobody declared is refused, a node
// the graph does not hold -- or one taking part in none of the shape's relations -- leaves the
// obligation UNKNOWN with what would settle it, and the same inputs derive the same obligations.
import assert from "node:assert/strict";
import { test } from "node:test";
import { derivedObligations } from "../src/qa/obligations/derive.mjs";

const plan = (criteria) => ({ id: "invoice-read", revision: "r3", criteria });
const binding = { id: "bnd-plan001", authority: "accepted" };
const graph = { nodes: [{ key: "endpoint:invoices-api", name: "invoices-api", role: "interface" }, { key: "principal-class:tenant-b", name: "tenant-b", role: "principal" }, { key: "queue:billing-reminders", name: "billing.reminders", role: "channel" }], relations: [{ key: "principal-class:tenant-b permission endpoint:invoices-api", from: "principal-class:tenant-b", to: "endpoint:invoices-api", role: "permission" }] };
const AC2 = { id: "API-AC-2", says: "another tenant's invoice reads as not found", about: "invoices-api", obligations: ["permission-enforced"], expects: [{ id: "E1", property: "response.status", op: "eq", value: 404 }] };

test("an accepted criterion that names its kind and what it is about derives one applicable obligation per kind", () => {
  const out = derivedObligations({ plan: plan([AC2]), binding, graph });
  assert.deepEqual([out.questions, out.refused], [[], []]);
  const [o] = out.obligations;
  assert.match(o.obligation, /^tob-[0-9a-f]{12}$/);
  assert.deepEqual([o.shape, o.target, o.expected, o.authority, o.boundary, o.method, o.applicability.state], ["permission-enforced", "endpoint:invoices-api", ["API-AC-2/E1"], "accepted", "synchronous", "runtime-test", "applicable"]);
  assert.deepEqual(derivedObligations({ plan: plan([AC2]), binding, graph }).obligations, out.obligations, "the same inputs derive the same obligations");
});

test("nothing is guessed: no kind is a question, an unknown kind is refused, and what the graph cannot place stays unknown", () => {
  const out = derivedObligations({ plan: plan([{ ...AC2, id: "AC9", obligations: [] }, { ...AC2, id: "AC8", obligations: ["telepathy"] }, { ...AC2, id: "AC7", about: "ghost" }, { ...AC2, id: "AC6", about: "billing-reminders", obligations: ["effect-once-per-key"] }]), binding, graph });
  assert.deepEqual(out.questions.map((q) => q.criterion), ["AC9"]);
  assert.match(out.refused[0], /AC8: "telepathy" is not an obligation shape/);
  const byId = { AC7: out.obligations.find((o) => o.target === "ghost"), AC6: out.obligations.find((o) => o.shape === "effect-once-per-key") };
  assert.deepEqual(byId.AC6.expected, [], "AC6 states no count -- nothing effect-once-per-key rules with");
  assert.match(byId.AC6.missing[0], /AC6 states nothing the effect-once-per-key obligation rules with \(count-eq\)/);
  assert.deepEqual(byId.AC7.expected, ["AC7/E1"], "a slot the shape rules with is the obligation's own");
  assert.equal(byId.AC7.applicability.state, "unknown");
  assert.match(byId.AC7.applicability.why, /holds no ghost/);
  assert.equal(byId.AC6.applicability.state, "unknown", "the queue takes part in no consume or data-write relation the graph records");
  assert.match(byId.AC6.applicability.settles, /relation the graph records/);
});

test("a draft plan's obligations carry its weaker authority, and prose alone derives nothing", () => {
  const out = derivedObligations({ plan: plan([AC2, { id: "AC1", says: "it should feel fast" }]), binding: { id: "bnd-draft01", authority: "draft" }, graph });
  assert.equal(out.obligations.length, 1);
  assert.equal(out.obligations[0].authority, "draft");
});
