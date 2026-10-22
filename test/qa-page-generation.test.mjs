// A generated UI test (doc §15.1; PBI 12): a host proposes WHAT a page step waits for and reads -- a selector, an
// attribute, a value -- and the engine writes every line of script the browser evaluates, from templates that only read
// the page; an api witness rules on the status its call answered and nothing else; and the case it makes is the same
// grammar a person's UI case is, judged by compiled predicates.
import assert from "node:assert/strict";
import { test } from "node:test";
import { familyCapabilities } from "../src/adapters/core.mjs";
import { inputFindings } from "../src/capability/invoke.mjs";
import { CORE } from "../src/dsl/registry.mjs";
import { validate } from "../src/dsl/validate.mjs";
import { generatedCase } from "../src/qa/generation/design.mjs";
import { conditionJs, pageOutputsOf, readerJs } from "../src/qa/generation/page.mjs";
import { shapeOf } from "../src/qa/obligations/shapes.mjs";
import { judgeStep } from "../src/run/evaluator.mjs";
import { fakeContext } from "./fakes/context.mjs";

const caps = new Map(familyCapabilities().map((c) => [c.id, { ...c, from: "pack:orbit-backend-test" }]));
const graph = fakeContext().graph;
const NAME = "Acme Synthetic";

const expectations = new Map([
  ["UI-AC-1/E1", { id: "E1", property: "ui.text", op: "contains", value: NAME }],
  ["UI-AC-1/E2", { id: "E2", property: "response.status", op: "eq", value: 200 }],
  ["UI-AC-1/E3", { id: "E3", property: "effect.count", op: "count-eq", value: 1 }],
  ["UI-AC-1/E4", { id: "E4", property: "response.status", op: "in", value: [200, 201], for: [] }],
]);

const STEPS = [
  { do: "goto", url: "/invoices", until: { selector: "[data-testid=search]" } },
  { do: "fill", selector: "[data-testid=search]", value: NAME },
  { do: "click", selector: "[data-testid=search-submit]", until: { selector: "[data-testid=results]", attribute: "data-loading", equals: "false" } },
  { do: "api", match: "/api/invoices\\?q=", method: "GET" },
  { do: "call", capability: "orbit.state.read", input: { stateRef: "invoices", request: { key: NAME } } },
  { do: "report", reads: { selector: "[data-testid=results]" } },
];

const proposal = (over = {}) => ({
  obligation: "tob-0123456789ab",
  skeleton: { steps: STEPS },
  assertions: [{ criterionRef: "UI-AC-1/E2", template: "value-eq", step: 4 }, { criterionRef: "UI-AC-1/E3", template: "count-eq", step: 5 }, { criterionRef: "UI-AC-1/E1", template: "value-includes", step: 6 }],
  controls: [{ role: "positive", why: "the owner's search shows the seeded invoice" }],
  page: { endpointRef: "invoices", identityRef: "tenant-a-reader" },
  effectScope: "fixture",
  ...over,
});

const context = (steps = STEPS) => ({
  expectations,
  expected: ["UI-AC-1/E1", "UI-AC-1/E2", "UI-AC-1/E3"],
  outputsOf: (i) => pageOutputsOf(steps[i - 1]) ?? (steps[i - 1]?.capability === "orbit.state.read" ? { count: "effect.count" } : null),
  semanticsOf: () => ({}),
  observerSemantics: () => ({}),
  shape: shapeOf("screen-shows-result"),
  caseId: "gen-ui-search",
  title: "a search shows the seeded invoice",
  validate: (c) => validate(c, graph, CORE, undefined, (id) => caps.get(id) ?? null),
  inputFindings: (s) => inputFindings(caps.get(s.capability), s.input),
  dsl: CORE,
  pageOf: (id) => caps.get(id)?.page,
});

test("a UI design becomes a page case: every wait and reader written by the engine, the witness ruling on its status, each verdict compiled", () => {
  const out = generatedCase(proposal(), context());
  assert.equal(out.ok, true, JSON.stringify(out.findings));
  assert.equal(out.channel, "ui");
  const [go, , click, api, state, report] = out.case.steps;
  assert.equal(go.wait, conditionJs({ selector: "[data-testid=search]" }));
  assert.equal(click.wait, conditionJs(STEPS[2].until));
  assert.ok(!("until" in click) && !("reads" in report), "what a host proposed is turned into what the grammar has");
  assert.deepEqual([api.match, api.method, api.status, api.expect], ["/api/invoices\\?q=", "GET", 200, undefined]);
  assert.equal(report.js, readerJs("[data-testid=results]"));
  assert.match(report.expect, /^compiled:.*"template":"value-includes".*"value":"Acme Synthetic"/);
  assert.match(state.expect, /"template":"count-eq"/);
  assert.deepEqual(out.case.steps.map((s) => CORE.provedBy(s)), [null, null, null, "api", "sql", "ui"]);
});

test("the reader a report runs is judged by the compiled predicate, on what it read -- a text that does not contain the name is a contradiction", () => {
  const report = generatedCase(proposal(), context()).case.steps[5];
  assert.doesNotThrow(() => judgeStep({ ...report, i: 6 }, { count: 1, text: `${NAME} (120)` }, {}));
  assert.throws(() => judgeStep({ ...report, i: 6 }, { count: 0, text: null }, {}), (e) => e.contradiction === true);
});

test("the templates only read the page: a selector is a JSON literal, and the scripts call nothing but the DOM's own lookups", () => {
  const tricky = `[data-x="a'b"]`;
  assert.equal(readerJs(tricky).includes(JSON.stringify(tricky)), true);
  for (const js of [readerJs("#r"), conditionJs({ selector: "#r" }), conditionJs({ selector: "#r", attribute: "hidden", equals: null })]) {
    assert.doesNotMatch(js, /fetch|XMLHttpRequest|click\(|submit|location|document\.cookie|eval|Function|import/);
  }
});

test("each page rule refuses with its own word, before the design is compiled into anything", () => {
  const stop = (p) => ((r) => [r.stage, (r.findings ?? []).join(" | ")])(generatedCase(p, context(p.skeleton?.steps)));
  const holds = ([stage, said], pattern, why) => assert.ok(stage === "rules" && pattern.test(said), `${why}: ${stage} — ${said}`);
  const swap = (i, step) => STEPS.map((s, n) => (n === i ? step : s));
  holds(stop(proposal({ skeleton: { steps: swap(2, { ...STEPS[2], wait: "window.done === true" }) } })), /carries wait/, "a skeleton carries no page script");
  holds(stop(proposal({ skeleton: { steps: swap(3, { ...STEPS[3], status: 200 }) } })), /carries status/, "nor the status a witness rules on");
  holds(stop(proposal({ skeleton: { steps: swap(5, { do: "report", reads: { selector: "[data-testid=results]" }, until: { selector: "#x" } }) } })), /only a step that drives the page waits/, "until on a report");
  holds(stop(proposal({ skeleton: { steps: swap(5, { do: "report" }) } })), /names nothing it reads/, "a report with no reads");
  holds(stop(proposal({ skeleton: { steps: swap(1, { ...STEPS[1], selector: "`;alert(1)//" }) } })), /not one/, "a selector outside the alphabet");
  holds(stop(proposal({ page: undefined })), /names the screen it drives/, "a page design names its screen");
});

test("an api witness rules on the status its call answered, and nothing else is turned into an expect the verb does not have", () => {
  const out = generatedCase(proposal({ assertions: [...proposal().assertions, { criterionRef: "UI-AC-1/E4", template: "value-in", step: 4 }] }), context());
  assert.equal(out.stage, "mapping");
  assert.match(out.findings.join(), /rules only on the status its call answered/);
});
