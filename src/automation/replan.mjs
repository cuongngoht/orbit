// Why a coordinated workflow's plan is REVISED, and how (1.8.6) -- an ordered table over facts a journal or an
// owner can DEMONSTRATE, never a model's opinion of how things are going: the engine calls no model, and new
// evidence reaches a plan only as a receipt or an owner's record these rows read.
//
//   TRIGGERS    the first row of its moment (`at`) that holds decides; each moment's last row always does
//     blocked   a step's provider could not be selected     CAPABILITY_MISSING · DEPENDENCY_BLOCKED
//     settled   a step settled and the workflow goes on     REQUIREMENT_CHANGED · ENVIRONMENT_CHANGED · NONE
//     failed    a step failed on its evidence or its host   VERIFICATION_FAILED · TASK_FAILED
//   RESPONSES   what a trigger does to the plan:
//     insert-generation    draft and register steps go in before the playbook step nothing provides yet
//     insert-verification  a QA step of the running change goes in, now that something can be started
//     reset-from           the steps built on what changed are planned again, from the step that reads it
//     retry                the failed step and what waits on it are planned again (plan.mjs replanOf)
//     block · fail · none  no revision: the loop blocks, fails or goes on, as it would have
//
// A STRUCTURAL response (one that revises the plan on new evidence, not after a failure) is bounded (SPENT) by
// `execution.maxReplans`, by the playbooks one task may draft (`skillFactory.maxSkillsPerTask`, the bound the
// planner itself drafts within) and by the plan's own rules (`execution.maxPlanSteps`); past any of them the trigger
// is answered as BUDGET_EXHAUSTED with its fallback (`otherwise`) -- a block for a missing capability, a failure for
// a requirement that moved, nothing for a verification that would only have been added. A step a revision adds
// gets the retries its kind is allowed, as one planned from the start would. Every revision is a new artifact naming
// the one it replaced and why; no receipt is rewritten, no evidence is lost.
//
//   respond(c) -> { trigger, response, revision?, reset?, cause?, because? }
//   c: { at, step, needs?, plan, values, generates?, linked?, latest?, startable?, runtimeDone?, ran?, violated?, ref? }
import { Refused } from "../errors.mjs";
import { generationFor, withSteps } from "./graph.mjs";
import { downstreamOf, retriesOf, revisionOf, validate } from "./plan.mjs";

const clip = (text) => String(text ?? "").slice(0, 240) || undefined;

const hasKind = (plan, kind) => plan.steps.some((s) => s.kind === kind);

const capabilityOf = (s) => s.for ?? null;

// A draft step for the playbook step's capability is already planned (one with no capability drafts the plan's one).
const drafting = (plan, step) => plan.steps.some((s) => s.kind === "propose-skill" && (s.for === capabilityOf(step)));

export const TRIGGERS = [
  { id: "CAPABILITY_MISSING", at: "blocked", response: "insert-generation", otherwise: "block", when: (c) => c.step.kind === "playbook" && c.needs === "capability" && c.generates === true && !drafting(c.plan, c.step), say: (c) => `nothing here provides ${capabilityOf(c.step)}, and a person lets the skill factory draft it: a draft and a register step go in before ${c.step.id}` },
  { id: "DEPENDENCY_BLOCKED", at: "blocked", response: "block", when: () => true, say: (c) => `${c.step.id} waits for ${c.needs ?? "someone"} — nothing is planned around it` },
  { id: "REQUIREMENT_CHANGED", at: "settled", response: "reset-from", from: "requirement", otherwise: "fail", when: (c) => Boolean(c.linked) && Boolean(c.latest) && c.latest !== c.linked, say: (c) => `the requirement's newest snapshot is ${c.latest}, not ${c.linked}: every step built on it is planned again` },
  { id: "ENVIRONMENT_CHANGED", at: "settled", response: "insert-verification", otherwise: "none", when: (c) => c.runtimeDone === true && hasKind(c.plan, "engineering") && !hasKind(c.plan, "qa") && (c.startable ?? 0) > 0, say: (c) => `runtime understanding now finds ${c.startable} startable component(s): a QA step of the running change goes in` },
  { id: "NONE", at: "settled", response: "none", when: () => true, say: () => "nothing the evidence shows asks for a new plan" },
  { id: "VERIFICATION_FAILED", at: "failed", response: "retry", when: (c) => c.violated === true, say: (c) => `${c.step.id} failed on its owner's record` },
  { id: "TASK_FAILED", at: "failed", response: "retry", when: () => true, say: (c) => `${c.step.id} failed` },
];

export const TRIGGER_IDS = TRIGGERS.map((t) => t.id);

const resetFrom = (c, row) => downstreamOf(c.plan, c.plan.steps.filter((s) => s.kind === row.from).map((s) => s.id)).map((s) => s.id);

// A QA step put in after its dependents already ran plans them again: what waited on nothing now waits on it.
const afterQa = (c, steps) => downstreamOf({ steps }, steps.filter((s) => s.kind === "qa").map((s) => s.id)).map((s) => s.id).filter((id) => (c.ran ?? []).includes(id));

const withQa = (c) => ((steps) => ({ steps, reset: afterQa(c, steps) }))(withSteps(c.plan, ["qa"], c));

export const RESPONSES = [
  { id: "insert-generation", revise: (c) => ({ steps: withSteps(c.plan, generationFor(c.step), c), reset: [c.step.id] }) },
  { id: "insert-verification", revise: withQa },
  { id: "reset-from", revise: (c, row) => ({ steps: c.plan.steps, reset: resetFrom(c, row) }) },
  { id: "retry", revise: null },
  { id: "block", revise: null },
  { id: "fail", revise: null },
  { id: "none", revise: null },
];

export const RESPONSE_IDS = RESPONSES.map((r) => r.id);

const responseOf = (id) => RESPONSES.find((r) => r.id === id);

const STRUCTURAL = RESPONSES.filter((r) => r.revise).map((r) => r.id);

// How many times this plan was revised on new evidence -- the count `execution.maxReplans` bounds.
export const structuralOf = (plan) => (plan.replans ?? []).filter((r) => STRUCTURAL.includes(r.response)).length;

const holds = (plan) => {
  try { return (validate(plan), null); }
  catch (e) { if (e instanceof Refused) return e.message; throw e; }
};

const draftsIn = (plan) => plan.steps.filter((s) => s.kind === "propose-skill").length;

// What a structural revision may never go past, first that holds: the reason it is not made.
const SPENT = [
  { when: (c) => structuralOf(c.plan) >= c.values.execution.maxReplans, why: (c) => `the revisions on new evidence a person allows are spent (execution.maxReplans ${c.values.execution.maxReplans})` },
  { when: (c, response) => response.id === "insert-generation" && draftsIn(c.plan) >= c.values.skillFactory.maxSkillsPerTask, why: (c) => `the playbooks one task may draft are spent (skillFactory.maxSkillsPerTask ${c.values.skillFactory.maxSkillsPerTask})` },
];

const spentOf = (c, response) => SPENT.find((r) => r.when(c, response))?.why(c) ?? null;

const brokenOf = (plan) => ((broken) => (broken ? `the revision would break the plan's own rules (${broken.slice(0, 90)})` : null))(holds(plan));

// The retries a revised plan carries: what the old one had left, and for a kind it did not have, the kind's own.
const retriesAfter = (c, steps) => ({ ...retriesOf(c.values, steps), ...c.plan.retries });

export function respond(c) {
  const row = TRIGGERS.find((t) => t.at === c.at && t.when(c));
  const response = responseOf(row.response);
  if (!response.revise) return { trigger: row.id, response: response.id, because: clip(row.say(c)) };
  return revised(c, row, response);
}

function revised(c, row, response) {
  const r = response.revise(c, row);
  const plan = revisionOf(c.plan, { steps: r.steps, retries: retriesAfter(c, r.steps) }, { trigger: row.id, response: response.id, step: c.step?.id ?? null, summary: clip(row.say(c)) });
  const why = spentOf(c, response) ?? brokenOf(plan);
  if (why) return { trigger: "BUDGET_EXHAUSTED", cause: row.id, response: row.otherwise, because: clip(`${row.id} not acted on — ${why}: ${row.say(c)}`) };
  return { trigger: row.id, response: response.id, revision: plan, reset: r.reset, because: clip(row.say(c)) };
}
