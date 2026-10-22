// The POLICY CHECK every action passes before anything is dispatched: the profile it acts under, the operation it
// carries and the mode it works in, judged TOGETHER, then the owner a write must go through and what was granted.
// An ordered table; the first row that fails denies, and a denial is always a journal line (permission.denied), so a
// viewer shows it. A role's NAME is never asked: only the profile it requested, bounded by grants.mjs.
import { MODES } from "../execution/modes.mjs";
import { OPERATION_KINDS, effectOf } from "./operations.mjs";
import { PROFILES } from "./profiles.mjs";

const ownersOf = (c) => OPERATION_KINDS[c.operationKind].owners ?? null;

// c: { profile, operationKind, mode, provider, grants: [operation kinds] }
export const EVALUATION = Object.freeze([
  { rule: "UNKNOWN_KIND", fails: (c) => !OPERATION_KINDS[c.operationKind], say: (c) => `${c.operationKind} is not an operation kind Satellite knows` },
  { rule: "UNKNOWN_MODE", fails: (c) => !MODES[c.mode], say: (c) => `${c.mode} is not a mode of ${Object.keys(MODES).length} Satellite knows` },
  { rule: "UNKNOWN_PROFILE", fails: (c) => !PROFILES[c.profile], say: (c) => `${c.profile} is not a permission profile` },
  { rule: "WRITE_IN_READ_MODE", fails: (c) => MODES[c.mode].reads && effectOf(c.operationKind) !== "read", say: (c) => `${c.mode} is a reading mode: a ${effectOf(c.operationKind)} operation (${c.operationKind}) can never ride it` },
  { rule: "WRITE_ON_READ_PROFILE", fails: (c) => c.profile === "READ_ONLY" && effectOf(c.operationKind) !== "read", say: (c) => `a READ_ONLY actor never carries ${c.operationKind}` },
  { rule: "MODE_FORBIDS", fails: (c) => !MODES[c.mode].kinds.includes(c.operationKind), say: (c) => `${c.mode} does not carry ${c.operationKind}` },
  { rule: "PROFILE_MODE", fails: (c) => !MODES[c.mode].profiles.includes(c.profile), say: (c) => `a ${c.profile} actor does not work in ${c.mode}` },
  { rule: "PROFILE_FORBIDS", fails: (c) => !PROFILES[c.profile].kinds.includes(c.operationKind), say: (c) => `the ${c.profile} profile does not carry ${c.operationKind}` },
  { rule: "OWNER_REQUIRED", fails: (c) => Boolean(ownersOf(c)) && !ownersOf(c).includes(c.provider), say: (c) => `${c.operationKind} happens only through ${ownersOf(c).join(", ")}, never through ${c.provider}` },
  { rule: "NOT_GRANTED", fails: (c) => !(c.grants ?? []).includes(c.operationKind), say: (c) => `${c.operationKind} is not granted here: ${c.why ?? "a limit, the budget or a parent run withholds it"}` },
]);

export const RULE_IDS = Object.freeze([...EVALUATION.map((r) => r.rule), "ALLOW"]);

export function evaluate(c) {
  const failed = EVALUATION.find((r) => r.fails(c));
  return failed ? { verdict: "deny", rule: failed.rule, say: failed.say(c) } : { verdict: "allow", rule: "ALLOW", say: `${c.profile} may carry ${c.operationKind} in ${c.mode}` };
}
