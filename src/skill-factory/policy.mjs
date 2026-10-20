// WHETHER the factory may draft or register a playbook now, under the automation settings a person set
// (src/automation/settings.mjs, handed in as effective values). An ordered table, first failing row
// refuses, nothing written:
//
//   skillFactory.reuseFirst          an ACTIVE playbook already providing the capability is used, not redrafted
//   skillFactory.scope               a playbook never wider than a person allows (task < project)
//   skillFactory.maxSkillsPerTask    playbooks one task may draft
//   skillFactory.maxGenerationAttempts  registrations one playbook may try before the task stops trying
import { Refused } from "../errors.mjs";
import { SCOPES } from "./vocab.mjs";


// c: { values, provides, scope, drafted, attempts, active }
export const RULES = [
  { id: "SF_REUSE", fails: (c) => c.values.skillFactory.reuseFirst && c.active !== null, say: (c) => `${c.active} already provides ${c.provides} and is active — it is used, not drafted again` },
  { id: "SF_SCOPE", fails: (c) => SCOPES.indexOf(c.scope ?? "project") > SCOPES.indexOf(c.values.skillFactory.scope), say: (c) => `a playbook's scope is at most ${c.values.skillFactory.scope}` },
  { id: "SF_BUDGET_SKILLS", fails: (c) => c.drafted >= c.values.skillFactory.maxSkillsPerTask, say: (c) => `this task drafted ${c.drafted} playbook(s), the most a person allows (maxSkillsPerTask)` },
  { id: "SF_BUDGET_ATTEMPTS", fails: (c) => c.attempts >= c.values.skillFactory.maxGenerationAttempts, say: (c) => `this playbook was held to the contract ${c.attempts} time(s), the most a person allows (maxGenerationAttempts)` },
];

export function allowed(c) {
  const failed = RULES.find((r) => r.fails(c));
  if (failed) throw Object.assign(new Refused(`${failed.id}: ${failed.say(c)}`), { code: failed.id });
}

// Verified instruction-only registrations are active within their declared bounds.
export const activationOf = () => "active";
