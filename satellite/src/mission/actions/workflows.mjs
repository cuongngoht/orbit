// RESOLVE-WORKFLOW: reuse a workflow template by its pin, or generate one -- validated against the workflow contract
// (cycles, recursion, impossible branches, the mission's bounds, what each unit's mode can carry) and published as an
// immutable definition. A plan then INSTANTIATES it (`plan { workflow: <pin>, params }`) into fresh units.
import { WORKFLOW_SCHEMA, workflowFindings, workflowIdOf } from "../../factories/workflow/workflow.mjs";
import { clip, quietly } from "../../store/text.mjs";
import { ENGINE, ORCHESTRATOR, finding } from "./common.mjs";

function planWorkflow(ports, lw, a) {
  if (a.pin) return ((r) => ({ word: r && !ports.definitions.revoked(a.pin) ? "REUSE" : "REJECT", record: r, findings: r ? [] : [{ id: "WF_PIN", say: `${a.pin} cannot be read back intact` }] }))(quietly(() => ports.definitions.read(a.pin)));
  const findings = workflowFindings(a.template, { limits: lw.limits });
  return { word: findings.length ? "REJECT" : "GENERATE", findings };
}

const reused = (lw, a, plan) => (lw.append("workflow.reused", { pin: a.pin, workflowId: plan.record.id, action: lw.action }), { outcome: "reused", level: "CONTRACT_MET", summary: `${a.pin} reused`, refs: [`definition:${a.pin}`], result: { pin: a.pin } });

function generated(ports, lw, a) {
  lw.append("workflow.validated", { workflowId: workflowIdOf(a.template.name), ok: true, findings: [], action: lw.action });
  const w = ports.definitions.write({ id: workflowIdOf(a.template.name), kind: "workflow", schemaVersion: WORKFLOW_SCHEMA, scope: "project", dependencies: [], compatibility: {}, content: a.template, provenance: { by: "engine", mission: lw.id, at: ports.now(), reason: "a workflow template the host proposed, held to the workflow contract" } });
  lw.append(w.reused ? "workflow.reused" : "workflow.generated", { pin: w.pin, workflowId: w.record.id, action: lw.action });
  if (!w.reused) lw.append("workflow.registered", { pin: w.pin, version: w.record.version, action: lw.action });
  return { outcome: w.reused ? "reused" : "generated", level: "CONTRACT_MET", summary: `${w.pin} ${w.reused ? "reused" : "generated"}`, refs: [`definition:${w.pin}`], result: { pin: w.pin } };
}

const rejected = (lw, a, plan) => (lw.append("workflow.validated", { workflowId: a.template?.name ? workflowIdOf(a.template.name) : "wft-unnamed", ok: false, findings: plan.findings.map((f) => f.id), action: lw.action }), { outcome: "rejected", level: "UNKNOWN", summary: clip(plan.findings.map((f) => `${f.id}: ${f.say}`).join("; ")) });

const STEPS = { REUSE: (ports, lw, a, plan) => reused(lw, a, plan), GENERATE: (ports, lw, a) => generated(ports, lw, a), REJECT: (ports, lw, a, plan) => rejected(lw, a, plan) };

export const resolveWorkflow = {
  fields: ["pin", "template"],
  required: [],
  plan: planWorkflow,
  mode: (plan) => (plan.word === "REUSE" ? "REUSING" : "DESIGNING"),
  operation: (plan) => ({ GENERATE: "definition.register", REJECT: "schema.validate" })[plan.word] ?? "store.read",
  provider: ENGINE,
  profile: ORCHESTRATOR,
  contract: (ports, lw, a) => (Boolean(a.pin) === Boolean(a.template) ? finding("WORKFLOW_ONE_OF", "resolve-workflow takes either a pin to reuse or a template to generate") : null),
  run: (ports, lw, a, plan) => STEPS[plan.word](ports, lw, a, plan),
};
