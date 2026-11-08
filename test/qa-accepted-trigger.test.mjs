// What the 0.5.0 release ship's ORBIT-QA-001 row found (shp-0bf04b1b1151, Sonnet 5.5 at medium effort, the real Claude
// Code host, bnr-2fc9adb2480f): the planted defect was MISSED because every design the host proposed for its
// persisted-after-write obligation was refused at generation and the obligation's design budget was spent. The trigger
// of each was an HTTP write, whose operation shows nothing of being accepted on its own (src/adapters/families.mjs
// `accepted`), so an accepted criterion must rule on it -- and neither the refusal nor the obligation's template said
// WHICH one. The obligation's own criterion (UI-AC-2) states what accepted means for that write (E3, a create answers
// 201), and a passing run of the same case (bnr-a326e602f088) ruled the write by it; this host never read that:
//
//   persisted-trigger-unruled  the write as the trigger and nothing ruling it: refused at mapping
//   persisted-trigger-count    E1 (count-eq) put on the write as value-eq: refused at mapping (E1 compiles to count-eq)
//   persisted-trigger-moved    the trigger moved to the read: the write then rules on nothing, refused at verdicts
//
// The fixtures are those hosts' own designs (test/fixtures/qa-refusals/), made here through the QA generation port a
// host's design goes through (skills/orbit-qa/ports.mjs), with the shipped packs loaded, against the invoice
// application's accepted plan on a graph that holds what the frozen run's graph holds for that interface. Each refusal
// now names the slot that could rule the write and the template it compiles to -- derived by compiling each slot of the
// obligation's own criterion at that step, never another criterion's -- within what a host reads of a finding; the
// design it points to is made; and what compiles is unchanged.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { graphDigestOf } from "../src/architecture/graph-view.mjs";
import { loadExtensions } from "../src/extensions/index.mjs";
import { qcToolPaths } from "../src/extensions/store.mjs";
import { generated } from "../src/investigation/generate.mjs";
import { planDigestOf } from "../src/investigation/input.mjs";
import { resultView } from "../src/investigation/loop.mjs";
import { modelOf } from "../src/investigation/model.mjs";
import { createInvestigations, eventIdOf } from "../src/investigation/store.mjs";
import { rulingSaid, slotsRuling } from "../src/qa/generation/compile.mjs";
import { generatedCase } from "../src/qa/generation/design.mjs";
import { derivedObligations } from "../src/qa/obligations/derive.mjs";
import { generationPort } from "../skills/orbit-qa/ports.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "test", "fixtures", "qa-refusals");
const fixture = (name) => JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8"));
const PLAN = JSON.parse(readFileSync(join(ROOT, "acceptance", "projects", "_shared", "ui-tests", "screens", "_no-screen", "invoice.plan.json"), "utf8"));
const ID = "inv-20261108-063402-95c9";
const PERSISTED = "persisted-after-write";

// The invoice application's create interface as the frozen run's graph holds it: the endpoint under its component's
// base path, the table it writes and the identity that writes it.
const node = (key, of, role, attributes = {}) => ({ key, name: key.split(":")[1], role, ...(of ? { of } : {}), attributes });
const BARE = { nodes: [
  node("component:invoice-a", null, "component", { hooksPort: "9090" }),
  node("endpoint:invoice-create", "component:invoice-a", "interface", { path: "/api", port: "8080" }),
  node("table:invoices", "component:db", "data-resource", { table: "invoices", key: "name" }),
  node("principal-class:tenant-a-writer", "component:invoice-a", "principal"),
], relations: [{ key: "endpoint:invoice-create writes table:invoices", from: "endpoint:invoice-create", to: "table:invoices", relation: "writes", role: "data-write" }] };
const GRAPH = { ...BARE, digest: graphDigestOf(BARE) };
const TOPOLOGY = { mode: "network", fingerprint: "f".repeat(64), nodes: [{ key: "server:db", role: "server", name: "db", alias: "db", service: "postgres", ports: [5432], argv: [], compose: { env: [] }, env: { names: [], values: {} } }, { key: "npm:.", role: "component", name: "invoice-a", alias: "invoice-a", ports: [8080, 9090], argv: [], compose: { env: [] }, env: { names: [], values: {} } }] };
const SERVICES = { postgres: { id: "postgres", transports: [{ id: "postgres-wire", port: 5432 }] } };
const TENANCY = { tenants: { "tenant-a": "tenant-a" }, identities: { "tenant-a-writer": ["tenant-a"] } };

async function packed() {
  const store = mkdtempSync(join(tmpdir(), "orbit-qa-refusals-"));
  mkdirSync(qcToolPaths(store).root, { recursive: true });
  const base = fakeContext();
  const ctx = { ...base, store: () => store, config: { ...base.config, packs: ["orbit-api-test", "orbit-backend-test"] } };
  await loadExtensions(ctx, { pluginRoot: ROOT });
  return { ctx, store };
}

const OBLIGATIONS = derivedObligations({ plan: PLAN, binding: { id: "bnd-p", authority: "accepted" }, graph: GRAPH }).obligations;
const OBLIGATION = OBLIGATIONS.find((o) => o.shape === PERSISTED);

function investigation(ctx) {
  const io = fakeIo();
  const store = createInvestigations("/store/repo-1", io);
  store.create({ id: ID, objective: "find the defects of the invoice application" });
  store.appendOnce(ID, "binding", { id: "bnd-1", eventId: eventIdOf("binding", "bnd-p", 0, "d"), binding: "bnd-p", type: "plan", ref: PLAN.id, revision: PLAN.revision, digest: planDigestOf(PLAN), authority: "accepted", state: "fresh" });
  OBLIGATIONS.forEach((o, n) => store.appendOnce(ID, "obligation", { id: `obr-${n + 1}`, eventId: eventIdOf("obligation", o.obligation, 0, o.digest), ...o }));
  const generation = generationPort({ ctx, model: () => modelOf(store.read(ID)), planOf: () => PLAN, graph: () => GRAPH, topology: () => TOPOLOGY, services: SERVICES, tenancy: TENANCY, drafts: { save: () => {} } });
  return { w: { id: ID, store, io, generation }, generation };
}

const contextOf = (generation, design) => generation.contextFor(OBLIGATION, { design });
const judged = (generation, design) => generatedCase({ ...design, obligation: OBLIGATION.obligation }, contextOf(generation, design));
const sent = (w, design) => generated(w, { obligation: OBLIGATION.obligation, design: { ...design, obligation: OBLIGATION.obligation } });

const NAMED = "rule it by UI-AC-2/E3 (value-eq: response.status eq 201)";

test("the obligation's own criterion is what the frozen run had: E1 is its expected slot, E3 says what the create answers", () => {
  assert.deepEqual([OBLIGATION.expected, OBLIGATION.target], [["UI-AC-2/E1"], "endpoint:invoice-create"]);
});

test("a write as the trigger that nothing rules is refused naming the slot of its own criterion that rules it, with its template, within what a host reads", async () => {
  const { ctx, store } = await packed();
  const { w, generation } = investigation(ctx);
  const out = sent(w, fixture("persisted-trigger-unruled"));
  assert.deepEqual([out.outcome, out.stage], ["GENERATION_FAILED", "mapping"], JSON.stringify(out));
  assert.deepEqual(out.findings, [`step 1 (trigger-accepted): the trigger step (1) asks orbit.http.write, whose answer shows nothing of being accepted: ${NAMED} — an accepted criterion must rule on it`]);
  assert.ok(resultView(out).findings[0].includes(NAMED), `what a host reads of the finding names it whole: ${resultView(out).findings[0]}`);
  assert.ok(w.store.read(ID).some((e) => e.kind === "designed" && e.why.includes(NAMED)), "and so does the journal's own record of the failed design");
  assert.deepEqual(slotsRuling(1, contextOf(generation, fixture("persisted-trigger-unruled"))).map((s) => [s.ref, s.template]), [["UI-AC-2/E3", "value-eq"]], "another criterion's response.status (API-AC-1/E1, a read's 200) compiles there too, and is never named");
  rmSync(store, { recursive: true, force: true });
});

test("the slot put on the write with a template it does not compile to is still refused as before; the design the refusal names is made", async () => {
  const { ctx, store } = await packed();
  const { generation } = investigation(ctx);
  const wrong = judged(generation, fixture("persisted-trigger-count"));
  assert.deepEqual([wrong.stage, wrong.findings], ["mapping", ["step 1 (UI-AC-2/E1): UI-AC-2/E1 says count-eq, which compiles to count-eq — not to value-eq"]]);
  const own = fixture("persisted-trigger-unruled");
  const made = judged(generation, { ...own, assertions: [{ criterionRef: "UI-AC-2/E3", template: "value-eq", step: 1 }, ...own.assertions] });
  assert.equal(made.ok, true, `${made.stage} ${JSON.stringify(made.findings)}`);
  assert.deepEqual(made.case.steps.map((s) => Boolean(s.expect)), [true, true], "both steps rule: the write on its status, the read on its count");
  rmSync(store, { recursive: true, force: true });
});

test("the trigger moved off the write leaves the write ruling on nothing, and that refusal names the same slot", async () => {
  const { ctx, store } = await packed();
  const { generation } = investigation(ctx);
  const out = judged(generation, fixture("persisted-trigger-moved"));
  assert.deepEqual([out.stage, out.findings], ["verdicts", [`step 1 (call) rules on nothing — every call rules on its answer, and nothing accepted was mapped to it: ${NAMED}`]]);
  rmSync(store, { recursive: true, force: true });
});

test("a criterion that states nothing the trigger's answer carries is said plainly as that, naming what the answer does carry", async () => {
  const { ctx, store } = await packed();
  const { generation } = investigation(ctx);
  const cx = contextOf(generation, fixture("persisted-trigger-unruled"));
  const bare = { ...cx, expectations: new Map([...cx.expectations].filter(([ref]) => ref !== "UI-AC-2/E3")) };
  assert.deepEqual(slotsRuling(1, bare), []);
  assert.match(rulingSaid(1, bare), /^no slot of UI-AC-2 states what its answer carries \(response\.status, response\.headers, response\.body\), so its criterion's source must state one$/);
  rmSync(store, { recursive: true, force: true });
});
