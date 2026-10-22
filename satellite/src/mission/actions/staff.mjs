// STAFFING a unit: the role that answers for its responsibilities (src/factories/role/) and the agent template that
// runs that role through the unit's provider (src/factories/template/). Each is reuse-first and each pins what it
// resolved onto the unit (unit.updated), where dispatch reads it.
import { planRole, roleModeOf, runRole } from "../../factories/role/factory.mjs";
import { ROLE_PROPOSAL_FIELDS } from "../../factories/role/vocab.mjs";
import { planTemplate, runTemplate, templateModeOf } from "../../factories/template/factory.mjs";
import { ENGINE, ORCHESTRATOR, finding, stateIn, unitIn } from "./common.mjs";

const STAFFABLE = ["planned", "ready", "blocked", "failed", "unresolved"];

const unitContract = (lw, a) => (a.unit && !unitIn(lw, a.unit) ? finding("UNIT_UNKNOWN", `no unit ${a.unit} in this mission`) : a.unit && !STAFFABLE.includes(stateIn(lw, a.unit)) ? finding("UNIT_STATE", `${a.unit} is ${stateIn(lw, a.unit)}; a role or template is resolved only for a unit not yet done, running or left`) : null);

const asResult = (r) => ({ outcome: r.outcome, level: r.pin ? "CONTRACT_MET" : "UNKNOWN", summary: r.summary, refs: r.pin ? [`definition:${r.pin}`] : [], evidence: r.pin ? [{ owner: "definition", ref: `definition:${r.pin}`, level: "CONTRACT_MET", independent: false, digest: r.pin.split(":")[2], say: r.summary }] : [], result: { pin: r.pin } });

export const resolveRole = {
  fields: ROLE_PROPOSAL_FIELDS.filter((f) => f !== "kind"),
  required: ["responsibilities", "profile"],
  plan: planRole,
  mode: (plan) => roleModeOf(plan),
  operation: (plan) => ({ REUSE: "store.read", REJECT: "schema.validate" })[plan.word] ?? "definition.register",
  provider: ENGINE,
  profile: ORCHESTRATOR,
  contract: (ports, lw, a) => unitContract(lw, a),
  run: (ports, lw, a, plan) => asResult(runRole(ports, lw, a, plan)),
};

export const resolveTemplate = {
  fields: ["unit", "provider", "skillPins"],
  required: ["unit"],
  plan: planTemplate,
  mode: (plan) => templateModeOf(plan),
  operation: (plan) => ({ GENERATE: "definition.register", REJECT: "schema.validate" })[plan.word] ?? "store.read",
  provider: ENGINE,
  profile: ORCHESTRATOR,
  contract: (ports, lw, a, plan) => unitContract(lw, a) ?? (plan.word === "REJECT" ? finding(plan.findings[0].id, plan.findings[0].say) : null),
  run: (ports, lw, a, plan) => asResult(runTemplate(ports, lw, a, plan)),
};
