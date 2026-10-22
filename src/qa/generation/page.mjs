// What a generated test may ask of a PAGE (doc §15.1; PBI 12). A step a host proposes names WHAT to wait for or to
// read -- a selector, an attribute and the value it should have -- and the ENGINE writes the JavaScript the browser
// evaluates, from fixed templates that only READ the page. A model never hands a browser a line of its own: a script
// that can read a page can also click, fetch and write, past every grant a run was minted (ADR 0037). So a skeleton
// carries no `js`, `wait`, `expect` or `status` (src/qa/backend/temporal.mjs NO_VERDICT_TEXT), and this module is the
// one place a generated test's page script comes from.
//
//   until: { selector, attribute?, equals? }   on a goto, click, fill or press: what holds before the next step runs
//   reads: { selector }                         on a report: what it reads -- the first match's text, how many match
//
// A selector is a CSS selector of a conservative alphabet, bounded, and carried into a script only as a JSON string
// literal: what it names is looked up, never run.
import { parsedPredicate } from "../../predicate.mjs";

export const SELECTOR = /^[A-Za-z0-9 _\-[\]=:."'#>~+*(),|^$]{1,200}$/;
export const ATTRIBUTE = /^[a-z][a-z0-9-]{0,63}$/;

// The verbs that drive the page, which may say what must hold before the next step.
export const ACT_VERBS = Object.freeze(["goto", "click", "fill", "press"]);

// What a reader's answer carries, by meaning (src/topology/vocab.mjs MEANINGS), and what an api witness's does.
export const READER_OUTPUTS = Object.freeze({ text: "ui.text", count: "ui.count" });
export const WITNESS_OUTPUTS = Object.freeze({ status: "response.status" });

const literal = (v) => JSON.stringify(v);

// One reader: how many elements match, and the first one's text, trimmed.
export const readerJs = (selector) => `(() => { const n = document.querySelectorAll(${literal(selector)}); return { count: n.length, text: n.length ? n[0].textContent.trim() : null }; })()`;

// One condition: the element is there -- or one of its attributes has the value asked (null: the attribute is absent).
export const conditionJs = (until) => (until.attribute ? `(() => { const e = document.querySelector(${literal(until.selector)}); return e !== null && e.getAttribute(${literal(until.attribute)}) === ${literal(until.equals ?? null)}; })()` : `document.querySelector(${literal(until.selector)}) !== null`);

// What a page step's answer carries, by meaning -- or null for a step that is not one.
export const pageOutputsOf = (step) => (step?.do === "report" && step.reads ? READER_OUTPUTS : step?.do === "api" ? WITNESS_OUTPUTS : null);

// A page step as the case holds it: its `until` as the `wait` it compiles to, its `reads` as the script its report
// evaluates, and the status an api witness rules on, from the one criterion that states it.
export function pageStepOf(step, verdict) {
  const { until, reads, ...rest } = step;
  const status = step.do === "api" && verdict?.expect ? witnessStatusOf(parsedPredicate(verdict.expect)) : undefined;
  return { ...rest, ...(until ? { wait: conditionJs(until) } : {}), ...(reads ? { js: readerJs(reads.selector) } : {}), ...(status !== undefined ? { status } : {}) };
}

// The status an api witness rules on: a compiled `value-eq` on what its call answered, and nothing else.
export const witnessStatusOf = (tree) => (tree?.template === "value-eq" && tree.means === "response.status" && Number.isInteger(tree.value) ? tree.value : undefined);

const selectorsOf = (s) => [s.selector, s.until?.selector, s.reads?.selector].filter((x) => x !== undefined);

const pageStepsOf = (d) => (Array.isArray(d.skeleton?.steps) ? d.skeleton.steps : []).map((step, n) => ({ step, i: n + 1 }));

const PAGE_VERBS = [...ACT_VERBS, "report", "api", "screenshot"];

// Each rule a page design is held to, as a row; what the DSL validator already says of a case stays its own.
export const PAGE_RULES = [
  { id: "SELECTOR", findings: (d) => pageStepsOf(d).flatMap(({ step, i }) => selectorsOf(step).filter((x) => typeof x !== "string" || !SELECTOR.test(x)).map((x) => `step ${i} names a selector that is not one: ${String(x).slice(0, 60)} — a CSS selector of letters, digits and selector punctuation, at most 200 characters`)) },
  { id: "UNTIL_ON_ACT", findings: (d) => pageStepsOf(d).filter(({ step }) => step.until !== undefined && !ACT_VERBS.includes(step.do)).map(({ i, step }) => `step ${i} (${step.do}) says what to wait for, and only a step that drives the page waits — ${ACT_VERBS.join(", ")}`) },
  { id: "UNTIL_SHAPE", findings: (d) => pageStepsOf(d).filter(({ step }) => step.until !== undefined && (typeof step.until?.selector !== "string" || (step.until.attribute !== undefined && !ATTRIBUTE.test(String(step.until.attribute))) || (step.until.equals !== undefined && step.until.equals !== null && typeof step.until.equals !== "string"))).map(({ i }) => `step ${i}: until is { selector, attribute?, equals? } — an attribute is a lowercase name, and equals a string or null (the attribute absent)`) },
  { id: "READS", findings: (d) => pageStepsOf(d).filter(({ step }) => (step.do === "report") !== (step.reads !== undefined) || (step.reads !== undefined && typeof step.reads?.selector !== "string")).map(({ i, step }) => (step.do === "report" ? `step ${i} (report) names nothing it reads — reads: { selector }` : `step ${i} (${step.do}) reads, and only a report does`)) },
  { id: "PAGE_REF", findings: (d) => (pageStepsOf(d).some(({ step }) => PAGE_VERBS.includes(step.do)) && typeof d.page?.endpointRef !== "string" ? ["a design that drives a page names the screen it drives — page: { endpointRef, identityRef? }, by the interface's alias"] : []) },
];

export const pageFindings = (design) => PAGE_RULES.flatMap((rule) => rule.findings(design ?? {}).map((say) => ({ rule: rule.id, say })));
