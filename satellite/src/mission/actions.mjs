// THE ACTIONS a decision may take -- every one an existing, gated operation of this engine, never a command line.
// Each row says what fields it takes, how its mode, operation kind, provider and profile are DERIVED, what its
// contract refuses, and how it runs (inside the lock) or is called (outside it, through an owner's port).
import { analyze } from "./actions/analyze.mjs";
import { checkpoint } from "./actions/checkpoint.mjs";
import { dispatch } from "./actions/dispatch.mjs";
import { invoke } from "./actions/invoke.mjs";
import { cancelUnit, plan, replan, skip } from "./actions/plan.mjs";
import { recall } from "./actions/recall.mjs";
import { registerSkill, resolveSkill, validateSkill, writeSkill } from "./actions/skills.mjs";
import { resolveRole, resolveTemplate } from "./actions/staff.mjs";
import { resolveWorkflow } from "./actions/workflows.mjs";
import { lifecycleOf } from "./state.mjs";
import { TERMINAL } from "./vocab.mjs";

export const ACTIONS = Object.freeze({ analyze, recall, plan, replan, "resolve-role": resolveRole, "resolve-template": resolveTemplate, "resolve-skill": resolveSkill, "write-skill": writeSkill, "validate-skill": validateSkill, "register-skill": registerSkill, "resolve-workflow": resolveWorkflow, dispatch, invoke, skip, "cancel-unit": cancelUnit, checkpoint });

export const ACTION_KINDS = Object.freeze(Object.keys(ACTIONS));

const BEFORE_PLAN = ["analyze", "recall", "plan", "resolve-skill", "write-skill", "validate-skill", "register-skill", "resolve-workflow", "checkpoint"];

const ALLOWED = [
  { when: (lw) => TERMINAL.includes(lifecycleOf(lw.m)), kinds: () => [] },
  { when: (lw) => !lw.m.intent, kinds: () => ["analyze", "recall", "checkpoint"] },
  { when: (lw) => lw.m.plans.length === 0, kinds: () => BEFORE_PLAN },
  { when: () => true, kinds: () => ACTION_KINDS.filter((k) => k !== "plan") },
];

export const allowedNow = (lw) => ALLOWED.find((r) => r.when(lw)).kinds(lw);

export const actionShapes = () => Object.fromEntries(ACTION_KINDS.map((k) => [k, { fields: ACTIONS[k].fields, required: ACTIONS[k].required }]));
