// The DERIVE step (PBI 02): an investigation's accepted plans, read against the system graph, become
// its `binding` and `obligation` records -- and a `question` for a criterion that names no kind --
// each written once, so deriving again adds nothing; an input it never read derives nothing.
import assert from "node:assert/strict";
import { test } from "node:test";
import { derivedInto } from "../src/investigation/derive.mjs";
import { modelOf } from "../src/investigation/model.mjs";
import { createInvestigations } from "../src/investigation/store.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ID = "inv-20261022-120000-abcd";
const PLAN = { id: "invoice-read", revision: "r3", criteria: [
  { id: "API-AC-2", says: "another tenant's invoice reads as not found", about: "invoices-api", obligations: ["permission-enforced"], expects: [{ id: "E1", property: "response.status", op: "eq", value: 404 }] },
  { id: "API-AC-9", says: "it lists only the caller's own invoices", expects: [{ id: "E1", property: "response.status", op: "eq", value: 200 }] },
] };
const GRAPH = { nodes: [{ key: "endpoint:invoices-api", name: "invoices-api", role: "interface" }], relations: [{ key: "p", from: "principal-class:b", to: "endpoint:invoices-api", role: "permission" }] };

function world(inputs) {
  const io = fakeIo();
  const store = createInvestigations("/store/repo-1", io);
  store.create({ id: ID, objective: "tenant isolation" });
  inputs.forEach((i, n) => store.append(ID, "input", { id: `inp-${n + 1}`, ...i }));
  return { w: { id: ID, store, io }, model: () => modelOf(store.read(ID)) };
}

const reads = { planOf: (ref) => (ref === "invoice-read" ? PLAN : null), graph: GRAPH };

test("an accepted plan the investigation read derives its binding, its obligations and a question for the kind nobody named", () => {
  const t = world([{ type: "plan", ref: "invoice-read", revision: "r3", digest: "d".repeat(64), authority: "accepted", state: "read" }]);
  const out = derivedInto(t.w, reads);
  assert.deepEqual([out.obligations, out.questions, out.refused], [1, 1, []]);
  const m = t.model();
  assert.deepEqual([m.bindings.length, m.bindings[0].type, m.bindings[0].authority], [1, "plan", "accepted"]);
  assert.deepEqual([m.obligations[0].shape, m.obligations[0].target, m.obligations[0].applicability.state, m.obligations[0].authority], ["permission-enforced", "endpoint:invoices-api", "applicable", "accepted"]);
  assert.match(m.questions[0].asks, /API-AC-9 states expectations and names no kind of property/);
});

test("deriving again on the same inputs adds nothing", () => {
  const t = world([{ type: "plan", ref: "invoice-read", revision: "r3", digest: "d".repeat(64), authority: "accepted", state: "read" }]);
  derivedInto(t.w, reads);
  const again = derivedInto(t.w, reads);
  assert.deepEqual([again.obligations, again.questions], [0, 0]);
  const m = t.model();
  assert.deepEqual([m.bindings.length, m.obligations.length, m.questions.length], [1, 1, 1]);
});

test("an input the investigation could not read derives nothing, and a plan that cannot be read now is said", () => {
  const unread = world([{ type: "plan", ref: "invoice-read", state: "unavailable", why: "gone" }]);
  assert.deepEqual(derivedInto(unread.w, reads), { obligations: 0, questions: 0, refused: [] });
  const vanished = world([{ type: "plan", ref: "vanished", revision: "r1", digest: "e".repeat(64), authority: "accepted", state: "read" }]);
  assert.match(derivedInto(vanished.w, reads).refused[0], /vanished: the plan could not be read now/);
});
