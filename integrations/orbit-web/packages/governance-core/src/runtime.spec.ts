import assert from "node:assert/strict";
import { test } from "node:test";
import { checkConstitution, defaultAccountPolicy, type Constitution } from "./constitution.js";
import { checkDepartmentPolicy, departmentPolicyErrors, type DepartmentPolicy } from "./department.js";
import { departmentImpactOf, impactOf } from "./risk.js";
import { composeRuntimeSecurity, RUNTIME_CONTROLS, runtimeSecurityOf } from "./runtime.js";
import { ACCOUNT } from "./testing.spec-helpers.js";

const company = (runtimeSecurity?: Constitution["runtimeSecurity"]): Constitution => {
  const p = defaultAccountPolicy(ACCOUNT, "single");
  if (runtimeSecurity === undefined) {
    const rest: Partial<Constitution> = { ...p };
    delete rest.runtimeSecurity;
    return rest as Constitution;
  }
  return { ...p, runtimeSecurity };
};
const dept = (runtimeSecurity?: DepartmentPolicy["runtimeSecurity"]): DepartmentPolicy => ({ apiVersion: "orbit.governance/v2", kind: "DepartmentPolicy", metadata: { accountId: ACCOUNT, departmentId: "dept-finance", name: "Finance" }, rules: [], ...(runtimeSecurity !== undefined ? { runtimeSecurity } : {}) });

test("a new account's policy says runtime security is DISABLED (0.8.0 behaviour), with the shared-areas control ready for when it is turned on", () => {
  for (const deployment of ["single", "governed"] as const) {
    const p = defaultAccountPolicy(ACCOUNT, deployment);
    assert.deepEqual(p.runtimeSecurity, { mode: "disabled", controls: ["exec.shared-areas"] });
    assert.equal(checkConstitution(p).ok, true, JSON.stringify(checkConstitution(p)));
  }
});

test("a policy that does not say runtimeSecurity means disabled with no control", () => {
  assert.deepEqual(runtimeSecurityOf(company()), { mode: "disabled", controls: [] });
});

test("the section is held to its words: a mode it knows, controls from the catalog, each once, nothing else", () => {
  const bad = (runtimeSecurity: unknown) => checkConstitution({ ...company(), runtimeSecurity } as unknown);
  assert.deepEqual(checkConstitution(company({ mode: "enforce", controls: ["exec.shared-areas"] })).ok, true);
  assert.match(String(!bad({ mode: "paranoid", controls: [] }).ok && (bad({ mode: "paranoid", controls: [] }) as { errors: string[] }).errors.join()), /runtimeSecurity\.mode/);
  assert.match((bad({ mode: "observe", controls: ["exec.everything"] }) as { errors: string[] }).errors.join(), /runtimeSecurity\.controls\[0\]/);
  assert.match((bad({ mode: "observe", controls: ["exec.shared-areas", "exec.shared-areas"] }) as { errors: string[] }).errors.join(), /twice/);
  assert.match((bad({ mode: "observe", controls: [], yaml: "kind: TracingPolicy" }) as { errors: string[] }).errors.join(), /runtimeSecurity\.yaml/);
  assert.match((bad({ controls: [] }) as { errors: string[] }).errors.join(), /runtimeSecurity\.mode/);
  assert.match((bad("enforce") as { errors: string[] }).errors.join(), /runtimeSecurity must be an object/);
});

test("a control in the catalog says what it prevents AND what it does not -- never a guarantee it cannot keep", () => {
  for (const spec of Object.values(RUNTIME_CONTROLS)) {
    assert.ok(spec.prevents.length > 0 && spec.doesNotPrevent.length > 0, spec.id);
    assert.ok(spec.planes.length > 0, spec.id);
  }
});

test("composition: the strictest of the deployment's floor, the company and the department; controls are the union", () => {
  const c = company({ mode: "observe", controls: ["exec.shared-areas"] });
  assert.deepEqual(composeRuntimeSecurity(c, null, "disabled"), { mode: "observe", controls: ["exec.shared-areas"], floor: "disabled", from: { mode: "company" } });
  // The deployment's floor wins over a company that asks for less.
  assert.deepEqual(composeRuntimeSecurity(company({ mode: "disabled", controls: [] }), null, "observe").mode, "observe");
  assert.equal(composeRuntimeSecurity(company({ mode: "disabled", controls: [] }), null, "observe").from.mode, "deployment");
  // A department raises its own employees to enforce.
  const finance = dept({ mode: "enforce" });
  const e = composeRuntimeSecurity(c, finance, "disabled");
  assert.equal(e.mode, "enforce");
  assert.equal(e.from.mode, "department");
  assert.deepEqual(e.controls, ["exec.shared-areas"]);
  // Nothing a department says lowers what the company requires.
  assert.equal(composeRuntimeSecurity(company({ mode: "enforce", controls: [] }), dept({ mode: "disabled" }), "disabled").mode, "enforce");
  // A company with no control and a department that adds one: the department's control is in effect for its employees.
  assert.deepEqual(composeRuntimeSecurity(company({ mode: "enforce", controls: [] }), dept({ controls: ["exec.shared-areas"] }), "disabled").controls, ["exec.shared-areas"]);
  // A tie is credited to the higher authority.
  assert.equal(composeRuntimeSecurity(company({ mode: "enforce", controls: [] }), dept({ mode: "enforce" }), "enforce").from.mode, "deployment");
});

test("a department's runtime security is checked for its shape, and against the company: it may only tighten", () => {
  assert.equal(checkDepartmentPolicy(dept({ mode: "enforce", controls: ["exec.shared-areas"] })).ok, true);
  assert.equal(checkDepartmentPolicy(dept({})).ok, true);
  assert.match((checkDepartmentPolicy({ ...dept(), runtimeSecurity: { mode: "loose" } }) as { errors: string[] }).errors.join(), /runtimeSecurity\.mode/);
  assert.match((checkDepartmentPolicy({ ...dept(), runtimeSecurity: { floor: "x" } }) as { errors: string[] }).errors.join(), /runtimeSecurity\.floor/);
  const c = company({ mode: "enforce", controls: ["exec.shared-areas"] });
  assert.deepEqual(departmentPolicyErrors(dept({ mode: "enforce" }), c), []);
  assert.match(departmentPolicyErrors(dept({ mode: "observe" }), c).join(), /runtimeSecurity\.mode: the company requires at least enforce/);
});

test("risk: lowering the mode or removing a control WEAKENS the policy (high risk); raising it does not", () => {
  const base = company({ mode: "enforce", controls: ["exec.shared-areas"] });
  const lowered = impactOf(base, company({ mode: "observe", controls: ["exec.shared-areas"] }));
  assert.equal(lowered.risk, "high");
  assert.ok(lowered.obligations.some((o) => o.field === "runtimeSecurity.mode" && o.weakened && o.before === "enforce" && o.after === "observe"));
  assert.ok(lowered.reasons.some((r) => /runtimeSecurity\.mode/.test(r)));
  const dropped = impactOf(base, company({ mode: "enforce", controls: [] }));
  assert.equal(dropped.risk, "high");
  assert.ok(dropped.obligations.some((o) => o.field === "runtimeSecurity.controls" && o.weakened));
  const raised = impactOf(company({ mode: "disabled", controls: [] }), company({ mode: "enforce", controls: ["exec.shared-areas"] }));
  assert.equal(raised.risk, "low");
  assert.ok(raised.obligations.every((o) => !o.weakened));
});

test("a department that stops tightening weakens what its employees are held to", () => {
  const c = company({ mode: "observe", controls: [] });
  const impact = departmentImpactOf(c, dept({ mode: "enforce", controls: ["exec.shared-areas"] }), dept({}));
  assert.equal(impact.risk, "high");
  assert.ok(impact.obligations.some((o) => o.field === "runtimeSecurity.mode" && o.weakened));
  assert.ok(impact.obligations.some((o) => o.field === "runtimeSecurity.controls" && o.weakened));
});

test("runtime security's decisions have audit rows of their own, each declaring the keys it may carry (raw telemetry never does)", async () => {
  const { AUDIT_EVENTS } = await import("./audit.js");
  const rows = AUDIT_EVENTS as Record<string, { data: readonly string[] }>;
  const expected: Record<string, string[]> = {
    "runtime_security.protection.verified": ["runId", "mode", "policy", "digest", "backend"],
    "runtime_security.protection.lost": ["runId", "mode", "cause", "contained"],
    "runtime_security.admission.refused": ["runId", "mode", "cause"],
    "runtime_security.incident.opened": ["incidentId", "runId", "category", "severity"],
    "runtime_security.incident.reviewed": ["incidentId", "state", "decision"],
    "runtime_security.containment.requested": ["incidentId", "runId", "reason"],
    "runtime_security.containment.confirmed": ["incidentId", "runId", "outcome"],
    "runtime_security.retry.authorized": ["incidentId", "assignmentId"],
    "runtime_security.sensor.changed": ["state", "generation", "cause"],
    "runtime_security.capability.probed": ["backend", "version", "observation", "prevention", "scope"],
  };
  for (const [type, keys] of Object.entries(expected)) {
    assert.ok(rows[type] !== undefined, `${type} is declared`);
    for (const k of keys) assert.ok(rows[type].data.includes(k), `${type} carries ${k}`);
    for (const k of rows[type].data) assert.ok(!/argument|environment|content|token|payload/i.test(k), `${type} never declares ${k}`);
  }
});
