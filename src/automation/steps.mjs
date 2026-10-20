// The KINDS of step a coordinated workflow is made of, as a table. Each kind is something an OWNER already
// does -- the coordinator never does the work itself, it hands a step to the owner and reads the owner's
// evidence back:
//
//   provides   the capability the step needs a provider for (the resolver's word, never a skill's name)
//   stage      the task stage the coordinator's journal moves to when the step starts, so every viewer's
//              stage strip, lifecycle and machine counts work unchanged
//   skill      the shipped skill a host runs the step with when the resolver selects no other; `agent` the
//              agent a host with native agents dispatches instead
//   engine     the step runs in the engine, through an owner's port, when this answers true for the facts
//   strict     a host's word with no readable evidence cannot settle it: only an owner's journal can
//   domains    the evidence it accepts, as receipt domains whose owner the engine can read back
//   retryFrom  where a failure sends the workflow back to: a QA finding is fixed by engineering, not by QA
//   class      the action class (src/automation/policy.mjs) that governs dispatching it
import { DOMAIN, STAGE } from "./vocab.mjs";

export const STEP_KINDS = [
  { id: "requirement", provides: "requirement.snapshot", stage: STAGE.REQUIREMENT, skill: "orbit-requirements", agent: null, engine: (f) => f.requirement?.ready === true, strict: true, domains: [DOMAIN.REQUIREMENT], retryFrom: "requirement", class: "dispatch-skill", goal: "a frozen snapshot of the requirement that no open question blocks", obligation: "a frozen snapshot of the requirement exists and no question blocks it" },
  { id: "context", provides: "project.context", stage: STAGE.CONTEXT, skill: null, agent: null, engine: () => true, strict: false, domains: [], retryFrom: "context", class: "read-context", goal: "what the project already knows, memory first", obligation: "project context was gathered" },
  { id: "runtime", provides: "runtime.discovery", stage: STAGE.ENVIRONMENT, skill: null, agent: null, engine: () => true, strict: true, domains: [DOMAIN.RUNTIME], retryFrom: "runtime", class: "read-context", goal: "what the checkout needs to run and whether it runs here", obligation: "the checkout's runtime is understood" },
  { id: "engineering", provides: "engineering.execution", stage: STAGE.IMPLEMENTING, skill: "orbit-engineer", agent: "orbit-engineering-agent", engine: () => false, strict: true, domains: [DOMAIN.TASK], retryFrom: "engineering", class: "dispatch-child-task", goal: "the change made, built, tested and reviewed in its own engineering task", obligation: "the engineering task completed on its own journal's proof" },
  { id: "qa", provides: "qa.investigation", stage: STAGE.TESTING, skill: "orbit-qa", agent: "orbit-qa-agent", engine: () => false, strict: true, domains: [DOMAIN.INVESTIGATION], retryFrom: "engineering", class: "dispatch-skill", goal: "an investigation of the running change", obligation: "an investigation of the running change ended with no defect" },
  { id: "regression", provides: "qa.execution", stage: STAGE.REGRESSION, skill: null, agent: null, engine: () => true, strict: true, domains: [DOMAIN.TASK], retryFrom: "engineering", class: "read-context", goal: "every declared test passed after the last change", obligation: "every declared test of the change passed after its last change" },
  { id: "review", provides: "code.review", stage: STAGE.REVIEWING, skill: null, agent: null, engine: () => true, strict: true, domains: [DOMAIN.TASK], retryFrom: "engineering", class: "read-context", goal: "the change reviewed against its plan", obligation: "the change was reviewed against its plan" },
  { id: "propose-skill", provides: null, stage: null, skill: "orbit-help", agent: null, engine: () => false, strict: true, domains: [DOMAIN.SKILL], retryFrom: "propose-skill", class: "generate-instruction-skill", goal: "a draft playbook for the workflow nothing here provides", obligation: "a draft playbook was written for the gap" },
  { id: "register-skill", provides: null, stage: null, skill: null, agent: null, engine: () => true, strict: true, domains: [DOMAIN.SKILL], retryFrom: "propose-skill", class: "generate-instruction-skill", goal: "the draft held to the contract and registered for this project", obligation: "the playbook verified and was registered" },
  { id: "playbook", provides: null, stage: null, skill: null, agent: null, engine: () => false, strict: false, domains: [DOMAIN.INVESTIGATION, DOMAIN.TASK, DOMAIN.SKILLRUN], retryFrom: "playbook", class: "dispatch-skill", goal: "the workflow the objective asks for, as its playbook says", obligation: "the playbook was followed" },
];

export const kindOf = (id) => STEP_KINDS.find((k) => k.id === id) ?? null;

export const KIND_IDS = STEP_KINDS.map((k) => k.id);
