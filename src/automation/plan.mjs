// A coordinated workflow's PLAN: the steps it will take, what each waits for, and how often a failed step may be
// planned again. A plan is an ARTIFACT beside the journal (the coordinator's room), written before the
// receipt that names it by digest -- never a state: where each step stands is read off the journal every
// time (`stateOf`), from the step's own receipt, so a plan file and a page can never disagree about it.
//
// Since 1.8.6 a plan is a GRAPH (schema 2): graph.mjs draws its edges from a table and lists its steps in
// dependency order, several steps may be ready at once and the host picks one, and every REVISION is a new
// artifact naming the one it replaced (`prev`) and why (`replans`). A plan with no `schema` is a plan an
// earlier release wrote: a chain, read exactly as it was.
//
//   planOf(facts, values)        -> plan, or null when the objective's workflow has no steps
//   validate(plan)               -> nothing; throws Refused for the first rule a plan breaks
//   digestOf(plan)               -> 16 hex over the plan without its digest
//   stateOf(plan, view)          -> [{ id, kind, provides, after, state, action, outcome, summary }]
//   readyOf(states)              -> the steps whose turn it is
//   replanOf(plan, failed, why)  -> { plan, reset } the next revision after a failure, or null when no retry is left
//   revisionOf(plan, changes, replan) -> the next revision, sealed: n+1, `prev`, the replan appended
//   downstreamOf(plan, ids)      -> the steps that wait, directly or through others, on any of `ids` -- and those
import { Refused } from "../errors.mjs";
import { canonicalJson, short } from "../hash.mjs";
import { graphOf } from "./graph.mjs";
import { KIND_IDS, kindOf } from "./steps.mjs";
import { DOMAIN, MAX_REVISIONS, MAX_STEPS, PLAN_SCHEMA, STEP_WORD } from "./vocab.mjs";
import { workflowOf } from "./workflows.mjs";

// How often each step may be planned again, keyed by KIND (a plan may hold several steps of one kind). Drafting
// and registering a playbook share ONE budget, the skill factory's own (`maxGenerationAttempts`): a refused draft
// is the host's to write again, that many times.
const GENERATION = ["propose-skill", "register-skill"];

const retryKey = (kind) => (GENERATION.includes(kind) ? "propose-skill" : kind);

export const retriesOf = (values, steps) => Object.fromEntries([...new Set(steps.map((s) => retryKey(s.kind)))].map((k) => [k, k === "propose-skill" ? values.skillFactory.maxGenerationAttempts - 1 : values.execution.retries[k] ?? 0]));

export const digestOf = (plan) => short(canonicalJson({ ...plan, digest: undefined }), 16);

const sealed = (plan) => ({ ...plan, digest: digestOf(plan) });

export function planOf(facts, values) {
  const workflow = workflowOf(facts);
  const steps = graphOf(workflow.steps(facts, values), facts, values);
  if (!steps.length) return null;
  return sealed({ schema: PLAN_SCHEMA, n: 1, workflow: workflow.id, intent: facts.intent, objective: facts.objective, steps, retries: retriesOf(values, steps), limit: values.execution.maxPlanSteps, replans: [] });
}

// ---- a plan's own rules ----------------------------------------------------------------------------------

const limitOf = (p) => Math.min(p.limit ?? MAX_STEPS, MAX_STEPS);

// A draft step is followed by the step that registers it, and that by the playbook step that uses it -- all for
// the same capability: generation is never planned half.
const followedBy = (p, s, kind) => p.steps.some((x) => x.kind === kind && x.for === s.for && x.after.includes(s.id));

const unpaired = (p) => p.steps.some((s) => (s.kind === "propose-skill" && !followedBy(p, s, "register-skill")) || (s.kind === "register-skill" && !followedBy(p, s, "playbook")));

const badRevision = (p) => !Number.isInteger(p.n) || p.n < 1 || (p.n > 1 && !/^[a-f0-9]{16}$/.test(String(p.prev ?? ""))) || (p.replans ?? []).length > MAX_REVISIONS;

// Bounded, every step a known kind, unique ids, `after` naming only an EARLIER step -- which is what makes a plan
// acyclic -- generation planned whole, and a revision that says which plan it replaced.
const RULES = [
  { id: "BOUNDED", fails: (p) => !Array.isArray(p.steps) || p.steps.length === 0 || p.steps.length > limitOf(p), say: (p) => `a plan has 1 to ${limitOf(p)} steps (execution.maxPlanSteps)` },
  { id: "KNOWN_KIND", fails: (p) => p.steps.some((s) => !KIND_IDS.includes(s.kind)), say: () => `every step is one of ${KIND_IDS.join(", ")}` },
  { id: "UNIQUE_ID", fails: (p) => new Set(p.steps.map((s) => s.id)).size !== p.steps.length, say: () => "every step has its own id" },
  { id: "NO_FORWARD_REF", fails: (p) => p.steps.some((s, i) => s.after.some((a) => !p.steps.slice(0, i).some((e) => e.id === a))), say: () => "a step waits only for steps before it — a plan never waits in a circle" },
  { id: "GENERATION_PAIRED", fails: unpaired, say: () => "a draft step is followed by the step that registers it, and that by the playbook step that uses it, for the same capability" },
  { id: "REVISION", fails: badRevision, say: () => `a revision counts from 1, names the plan it replaced, and keeps at most ${MAX_REVISIONS} replans` },
];

export const RULE_IDS = RULES.map((r) => r.id);

export function validate(plan) {
  if (plan?.schema !== PLAN_SCHEMA) throw new Refused(`unsupported workflow plan schema; expected ${PLAN_SCHEMA}`);
  const failed = RULES.find((r) => r.fails(plan));
  if (failed) throw Object.assign(new Refused(`PLAN_${failed.id}: ${failed.say(plan)}`), { code: `PLAN_${failed.id}` });
}

// ---- where each step stands, from the journal ---------------------------------------------------

const receiptOf = (view, id) => view.receipts.find((r) => r.domain === DOMAIN.STEP && r.ref === id) ?? null;

const STATE_OF = { [STEP_WORD.PENDING]: "pending", [STEP_WORD.RUNNING]: "running", [STEP_WORD.SUCCEEDED]: "succeeded", [STEP_WORD.FAILED]: "failed", [STEP_WORD.BLOCKED]: "blocked", [STEP_WORD.REPORTED]: "reported", [STEP_WORD.SKIPPED]: "skipped" };

const stateRow = (view) => (s) => ((r) => ({ ...s, state: STATE_OF[r?.outcome] ?? "pending", action: r?.action ?? null, summary: r?.summary ?? null, at: r?.at ?? null }))(receiptOf(view, s.id));

export const stateOf = (plan, view) => plan.steps.map(stateRow(view));

// Done for what comes after it: succeeded, skipped, or reported where its kind may stand on a report.
export const doneFor = (s) => ["succeeded", "skipped"].includes(s.state) || (s.state === "reported" && !kindOf(s.kind).strict);

export const readyOf = (states) => states.filter((s) => ["pending", "blocked"].includes(s.state) && s.after.every((a) => doneFor(states.find((x) => x.id === a))));

export const allDone = (states) => states.every(doneFor);

// ---- planning again -----------------------------------------------------------------------------

// Every step that waits on any of `ids`, directly or through another -- and those -- in plan order.
export function downstreamOf(plan, ids) {
  const more = plan.steps.filter((s) => !ids.includes(s.id) && s.after.some((a) => ids.includes(a))).map((s) => s.id);
  if (more.length) return downstreamOf(plan, [...ids, ...more]);
  return plan.steps.filter((s) => ids.includes(s.id));
}

// Where a failure sends the workflow back to: the step its kind says to retry from (a QA finding goes back to
// engineering) -- for the same capability when it is one's -- or the failed step itself when there is none.
const originOf = (plan, failed) => ((from) => (from === failed.kind ? failed : plan.steps.find((s) => s.kind === from && (s.for === undefined || s.for === failed.for)) ?? failed))(kindOf(failed.kind).retryFrom);

export const revisionOf = (plan, changes, replan) => sealed({ ...plan, ...changes, schema: PLAN_SCHEMA, n: plan.n + 1, prev: plan.digest, replans: [...(plan.replans ?? []), { n: plan.n + 1, ...replan }] });

// why: { trigger, summary } -- the replan row (replan.mjs) that asked for it.
export function replanOf(plan, failed, why = {}) {
  const key = retryKey(kindOf(failed.kind).retryFrom);
  if ((plan.retries[key] ?? 0) < 1) return null;
  const next = revisionOf(plan, { retries: { ...plan.retries, [key]: plan.retries[key] - 1 } }, { trigger: why.trigger ?? "TASK_FAILED", response: "retry", step: failed.id, ...(why.summary ? { summary: why.summary } : {}) });
  return { plan: next, reset: downstreamOf(plan, [originOf(plan, failed).id]).map((s) => s.id) };
}
