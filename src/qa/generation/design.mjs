// A DESIGN, held whole and turned into the case a generated test runs (doc §4.1 steps 3-4; PBI 11).
//
// The host proposes; the engine decides. Each row below is asked in order and the first that fails
// stops with its own word -- a contract the proposal broke, a control its shape needs, a rule an
// asynchronous design breaks, an assertion that does not map, a case the REAL grammar refuses --
// so a person reads why, and a repair knows what it may change. What survives is assembled by the
// engine: the skeleton's steps, each verdict the compiler wrote from an accepted criterion, each
// window from that criterion's own `within`; and the case is validated with the same DSL
// validator a run uses, with the project's own extensions, and every call's input against its
// capability -- never a lighter check, because a validator is not a sandbox and a draft that only
// a weaker check accepted is a test that fails for a reason nobody wrote down.
//
// The outcome words are the verification outcomes' (src/investigation/verification.mjs), as data:
// this module reads no investigation.
import { needsPage } from "../../dsl/page.mjs";
import { canonicalJson, sha } from "../../hash.mjs";
import { correlationFindings } from "../backend/correlation.mjs";
import { observationFindings } from "../backend/observations.mjs";
import { temporalFindings } from "../backend/temporal.mjs";
import { proposalFindings } from "../obligations/validate.mjs";
import { compileDesign } from "./compile.mjs";
import { controlFindings } from "./controls.mjs";
import { pageFindings, pageStepOf } from "./page.mjs";

const said = (findings) => findings.map((f) => (typeof f === "string" ? f : `${f.rule}: ${f.say}`));

// The verbs that rule on their own answer: a generated one carries a compiled verdict or is not made. A report reads a
// page for nothing else.
const RULING = ["call", "sql", "report"];

const STAGES = [
  { id: "contract", outcome: "GENERATION_FAILED", findings: (p) => proposalFindings("design", p.proposal) },
  { id: "controls", outcome: "GENERATION_FAILED", findings: (p, cx) => said(controlFindings(p.proposal, cx.shape)) },
  { id: "rules", outcome: "GENERATION_FAILED", findings: (p, cx) => said([...observationFindings(p.proposal, cx), ...correlationFindings(p.proposal), ...temporalFindings(p.proposal, cx), ...pageFindings(p.proposal)]) },
  { id: "mapping", outcome: (p) => (p.compiled.mapping.some((m) => /ACCEPTED criterion/.test(m.why ?? "")) ? "REQUIRES_REQUIREMENT" : "GENERATION_FAILED"), findings: (p) => p.compiled.mapping.filter((m) => m.verdict === "refused").map((m) => `step ${m.step} (${m.criterionRef ?? m.structural}): ${m.why}`) },
  { id: "coverage", outcome: "GENERATION_FAILED", findings: (p, cx) => (cx.expected ?? []).filter((slot) => !(p.proposal.assertions ?? []).some((a) => a.criterionRef === slot)).map((slot) => `${slot} is a slot of this obligation's own criterion, and nothing in the design rules on it — a design that rules only on other criteria tests something else`) },
  { id: "verdicts", outcome: "GENERATION_FAILED", findings: (p) => (p.case.steps ?? []).flatMap((s, n) => (RULING.includes(s.do) && !s.expect ? [`step ${n + 1} (${s.do}) rules on nothing — every ${s.do} rules on its answer, and nothing accepted was mapped to it`] : [])) },
  { id: "validate", outcome: "INVALID_TEST", findings: (p, cx) => [...(cx.validate?.(p.case) ?? ["nothing here validates a case — the composition root binds the DSL validator"]), ...stepInputs(p.case, cx)] },
];

export function generatedCase(proposal, cx) {
  const p = { proposal, compiled: compileDesign(proposal, cx) };
  const assembled = { ...p, case: caseOf(proposal, p.compiled, cx) };
  const stop = firstStop(assembled, cx);
  if (stop) return stop;
  return { ok: true, case: assembled.case, channel: needsPage(assembled.case, cx.dsl, cx.pageOf ?? (() => undefined)) ? "ui" : "pageless", design: stamped(proposal, assembled.compiled), digests: assembled.compiled.digests };
}

function firstStop(p, cx) {
  for (const stage of STAGES) {
    const found = stage.findings(p, cx);
    if (found.length) return { ok: false, stage: stage.id, outcome: typeof stage.outcome === "function" ? stage.outcome(p) : stage.outcome, findings: found };
  }
  return null;
}

// The skeleton's steps, each compiled verdict in its place and each window on its observation.
function caseOf(proposal, compiled, cx) {
  const steps = (proposal.skeleton?.steps ?? []).map((step, n) => placed(step, String(n + 1), compiled));
  return { id: cx.caseId, name: String(cx.title ?? proposal.obligation ?? "generated").slice(0, 120), seen: "src", ...(usesFixture(proposal) ? { params: [{ n: "FIXTURE", required: true }] } : {}), steps };
}

// A skeleton that names what it creates inside the run's own namespace says ${FIXTURE}: the case declares it, and the
// worker is handed the namespace (src/investigation/run-version.mjs) -- so a second attempt never finds the first's.
const usesFixture = (proposal) => canonicalJson(proposal.skeleton ?? {}).includes("${FIXTURE}");

// A compiled verdict, and the layer it proves for a call (a sql step's layer is its verb's); a page step as the engine
// writes it (src/qa/generation/page.mjs) -- an api witness carrying only the status it rules on, never an expect.
function placed(step, i, compiled) {
  const c = compiled.steps[i];
  const verdict = c && step.do !== "api" ? { expect: c.expect, ...(step.do === "call" ? { proves: c.proves } : {}) } : {};
  const window = compiled.windows.find((w) => String(w.step) === i);
  return { ...pageStepOf(step, c), ...verdict, ...(window ? { input: { ...step.input, request: { ...(step.input?.request ?? {}), waitMs: window.waitMs } } } : {}) };
}

const stepInputs = (c, cx) => (c.steps ?? []).flatMap((s, n) => (s.do === "call" ? (cx.inputFindings?.(s) ?? []).map((f) => `step ${n + 1}: ${f}`) : []));

// What only the engine writes on a design: its id and digest, the compiled assertions, the mapping
// verdict and the temporal contract -- from the compiler, never from the proposal.
function stamped(proposal, compiled) {
  const body = { ...proposal, compiled: Object.entries(compiled.steps).map(([step, s]) => ({ step: Number(step), digest: s.digest })), mapping: { assertions: compiled.mapping }, ...(compiled.windows.length ? { temporalContract: { windows: compiled.windows } } : {}) };
  const digest = sha(canonicalJson(body));
  return { ...body, id: `tds-${digest.slice(0, 16)}`, digest };
}
