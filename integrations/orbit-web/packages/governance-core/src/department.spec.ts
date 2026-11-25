import assert from "node:assert/strict";
import { test } from "node:test";
import { checkConstitution, defaultAccountPolicy, lintDelegation, type Constitution, type Rule } from "./constitution.js";
import { checkDepartmentPolicy, composeEmployeeModels, composeEmployeeNetwork, departmentPolicyErrors, modelAllowed, type DepartmentPolicy } from "./department.js";
import { evaluate, type GovernanceRequest } from "./evaluate.js";
import { confirmationRefusal } from "./lifecycle.js";
import { departmentImpactOf, impactOf, ruleChanges } from "./risk.js";
import { departmentTableOf, tableOf, withTable } from "./table.js";
import { ACTION_KINDS, ENVIRONMENTS, PRINCIPAL_TYPES, type Effect } from "./vocabulary.js";
import { ACCOUNT, ask } from "./testing.spec-helpers.js";

const RESEARCH = "dept-research";
const FINANCE = "dept-finance";

// The company of the acceptance example: employees RESTRICTED to its own hosts; departments may choose up to AUTONOMOUS
// (public web) and may decide tool.web; a mandatory deny on one host and a mandatory approval of connector writes.
function company(over: Partial<Constitution> = {}): Constitution {
  const p = defaultAccountPolicy(ACCOUNT, "single");
  const rules: Rule[] = [
    ...p.rules.filter((r) => r.action !== "tool.web"),
    { id: "web-tools", action: "tool.web", effect: "deny", binding: "default" },
    { id: "no-paste", action: "network.egress", resource: "pastebin.com:443", effect: "deny" },
  ];
  return { ...p, employeeNetwork: { mode: "RESTRICTED", allow: ["api.anthropic.com"] }, delegation: { departments: { actions: { "tool.web": "allow" }, employeeNetwork: { mode: "AUTONOMOUS" } } }, rules, ...over };
}

const department = (departmentId: string, over: Partial<DepartmentPolicy> = {}): DepartmentPolicy => ({ apiVersion: "orbit.governance/v2", kind: "DepartmentPolicy", metadata: { accountId: ACCOUNT, departmentId, name: departmentId }, rules: [], ...over });
const research = (): DepartmentPolicy => department(RESEARCH, { employeeNetwork: { mode: "AUTONOMOUS" }, rules: [{ id: "web", action: "tool.web", effect: "allow" }] });

const employee = (departmentId: string, over: Partial<GovernanceRequest> = {}): GovernanceRequest => ask({ principalType: "agent", workspaceId: null, runKind: "assignment", employeeId: "emp-1", departmentId, ...over });
const decide = (c: Constitution, depts: DepartmentPolicy[], r: GovernanceRequest): Effect => evaluate({ constitution: c, overlays: [], departments: depts }, r).verdict;

test("the acceptance example: Research opens the public web within its delegation, Finance keeps the company's RESTRICTED -- and the company's locks bind both", () => {
  const c = company();
  const depts = [research()];
  assert.equal(checkConstitution(c).ok, true, JSON.stringify(checkConstitution(c)));
  assert.equal(checkDepartmentPolicy(research()).ok, true);
  assert.deepEqual(departmentPolicyErrors(research(), c), []);
  // Public web: Research AUTONOMOUS reaches any public host on 443; Finance (no policy of its own) inherits RESTRICTED.
  assert.equal(decide(c, depts, employee(RESEARCH, { action: "network.egress", resource: "news.example.com:443" })), "allow");
  assert.equal(decide(c, depts, employee(FINANCE, { action: "network.egress", resource: "news.example.com:443" })), "deny");
  assert.equal(decide(c, depts, employee(FINANCE, { action: "network.egress", resource: "api.anthropic.com:443" })), "allow");
  // The web tools: delegated -- Research allows them, Finance follows the company's default (deny).
  assert.equal(decide(c, depts, employee(RESEARCH, { action: "tool.web", resource: "*" })), "allow");
  assert.equal(decide(c, depts, employee(FINANCE, { action: "tool.web", resource: "*" })), "deny");
  // A destination the company locks is locked for both, AUTONOMOUS or not.
  for (const d of [RESEARCH, FINANCE]) assert.equal(decide(c, depts, employee(d, { action: "network.egress", resource: "pastebin.com:443" })), "deny", d);
  // An approval the company requires binds both, whatever a department says (it is not delegated).
  const asks = department(RESEARCH, { rules: [{ id: "writes", action: "connector.write", effect: "allow" }] });
  assert.match(departmentPolicyErrors(asks, c).join(" "), /not delegated/);
  for (const d of [RESEARCH, FINANCE]) assert.equal(decide(c, [asks], employee(d, { action: "connector.write", resource: "github:o/r" })), "require_approval", d);
});

test("an employee's answer in CEO Chat (run kind executive) is decided with its department's policy, as its assignments are", () => {
  const c = company();
  const depts = [research()];
  assert.equal(decide(c, depts, employee(RESEARCH, { runKind: "executive", action: "tool.web", resource: "*" })), "allow");
  assert.equal(decide(c, depts, employee(FINANCE, { runKind: "executive", action: "tool.web", resource: "*" })), "deny");
  assert.equal(decide(c, depts, employee(RESEARCH, { runKind: "executive", action: "connector.write", resource: "github:o/r" })), "require_approval", "the company's mandatory approval binds it too");
});

test("a chat, a research question and a person decide exactly as without departments, bindings or delegation -- for every action, principal and environment", () => {
  const c = company();
  const plain: Constitution = { ...c, delegation: undefined, rules: c.rules.map(({ binding: _b, ...r }) => r) };
  const depts = [research(), department(FINANCE, { employeeNetwork: { mode: "RESTRICTED", allow: [] }, rules: [{ id: "no-run", action: "agent.run.start", effect: "deny" }] })];
  for (const action of ACTION_KINDS) {
    for (const principalType of PRINCIPAL_TYPES) {
      for (const environment of ENVIRONMENTS) {
        for (const r of [ask({ action, principalType, environment, resource: "x" }), ask({ action, principalType, environment, resource: "x", runKind: "chat", departmentId: RESEARCH }), ask({ action, principalType, environment, resource: "x", runKind: "research", workspaceId: null, researchWorkspaceId: "rw", departmentId: FINANCE })]) {
          assert.deepEqual(evaluate({ constitution: c, overlays: [], departments: depts }, r), evaluate({ constitution: plain, overlays: [] }, r), `${action} ${principalType} ${environment} ${r.runKind ?? "person"}`);
        }
      }
    }
  }
});

test("a delegated action: the department's answer replaces the company's default, held to the delegation -- a lowered cap caps it; a department narrows what is not delegated", () => {
  const c = company();
  const decision = evaluate({ constitution: c, overlays: [], departments: [research()] }, employee(RESEARCH, { action: "tool.web", resource: "*" }));
  assert.deepEqual([decision.verdict, decision.matchedRules, decision.reasonCodes], ["allow", [`department:${RESEARCH}:web`], ["DEPARTMENT_DECIDED"]]);
  const lowered = company({ delegation: { departments: { actions: { "tool.web": "require_approval" }, employeeNetwork: { mode: "AUTONOMOUS" } } } });
  const capped = evaluate({ constitution: lowered, overlays: [], departments: [research()] }, employee(RESEARCH, { action: "tool.web", resource: "*" }));
  assert.deepEqual([capped.verdict, capped.reasonCodes], ["require_approval", ["DEPARTMENT_DECIDED", "DELEGATION_CAPPED"]]);
  assert.match(departmentPolicyErrors(research(), lowered).join(" "), /at most "require_approval"/, "and it is refused when validated");
  // Not delegated: a department may narrow (here, deny its employees a shell) and never widen.
  const narrow = department(FINANCE, { rules: [{ id: "no-shell", action: "workspace.execute", effect: "deny" }] });
  assert.deepEqual(departmentPolicyErrors(narrow, c), []);
  const n = evaluate({ constitution: c, overlays: [], departments: [narrow] }, employee(FINANCE, { action: "workspace.execute", resource: "ws" }));
  assert.deepEqual([n.verdict, n.reasonCodes], ["deny", ["DEPARTMENT_NARROWED", "RULE_MATCHED"]]);
  // A mandatory company rule binds a delegated action too.
  const mandatory = company({ rules: [...company().rules.filter((r) => r.id !== "web-tools"), { id: "web-tools", action: "tool.web", effect: "deny" }] });
  assert.equal(decide(mandatory, [research()], employee(RESEARCH, { action: "tool.web", resource: "*" })), "deny");
  assert.deepEqual(lintDelegation(mandatory).length, 0);
  assert.deepEqual(lintDelegation({ rules: [{ id: "x", action: "repository.read", effect: "allow", binding: "default" }], delegation: undefined }).map((w) => w.code), ["DEFAULT_NOT_DELEGATED"]);
});

test("the network access composed per kind: mode within the cap, an allow-list unset inherits and [] names none, a limit at most the cap, the daily download the company's", () => {
  const c = company({ employeeNetwork: { mode: "RESTRICTED", allow: ["api.anthropic.com", "*.example.com"], limits: { downloadBytesPerRun: 100, downloadBytesPerDay: 1000 } }, delegation: { departments: { employeeNetwork: { mode: "RESTRICTED", allowWithin: ["*.example.com"], limits: { downloadBytesPerRun: 50 } } } } });
  assert.deepEqual(composeEmployeeNetwork(c, null).allow, ["api.anthropic.com", "*.example.com"]);
  const inherit = composeEmployeeNetwork(c, department(FINANCE, { employeeNetwork: { mode: "RESTRICTED" } }));
  assert.deepEqual([inherit.allow, inherit.from.allow], [["api.anthropic.com", "*.example.com"], "company"], "unset inherits");
  const none = composeEmployeeNetwork(c, department(FINANCE, { employeeNetwork: { allow: [] } }));
  assert.deepEqual(none.allow, [], "[] names none");
  const tooMuch = department(RESEARCH, { employeeNetwork: { mode: "AUTONOMOUS", allow: ["docs.example.com", "evil.test"], limits: { downloadBytesPerRun: 80 } } });
  assert.deepEqual(departmentPolicyErrors(tooMuch, c).length, 3, JSON.stringify(departmentPolicyErrors(tooMuch, c)));
  const composed = composeEmployeeNetwork(c, tooMuch);
  assert.deepEqual([composed.mode, composed.allow, composed.limits?.downloadBytesPerRun, composed.limits?.downloadBytesPerDay], ["RESTRICTED", ["docs.example.com"], 50, 1000]);
  assert.deepEqual(composed.capped.sort(), ["employeeNetwork.allow", "employeeNetwork.limits.downloadBytesPerRun", "employeeNetwork.mode"]);
  assert.equal(checkDepartmentPolicy(department(RESEARCH, { employeeNetwork: { limits: { downloadBytesPerDay: 5 } } })).ok, false, "the account-wide daily download is the company's alone");
});

test("models: sets intersect downward -- unset inherits, a department chooses within the company's delegation", () => {
  const c = company({ employeeModels: { allow: ["claude:sonnet", "claude:opus", "codex:gpt-6.1-sol"] }, delegation: { departments: { models: { allow: ["claude:sonnet", "claude:opus"] } } } });
  assert.deepEqual(composeEmployeeModels(c, null).allow, ["claude:sonnet", "claude:opus", "codex:gpt-6.1-sol"]);
  assert.deepEqual(composeEmployeeModels(c, department(FINANCE)).allow, ["claude:sonnet", "claude:opus", "codex:gpt-6.1-sol"], "unset inherits the company's");
  const d = department(RESEARCH, { employeeModels: { allow: ["claude:sonnet", "codex:gpt-6.1-sol"] } });
  assert.deepEqual(composeEmployeeModels(c, d), { allow: ["claude:sonnet"], capped: true });
  assert.match(departmentPolicyErrors(d, c).join(" "), /codex:gpt-6.1-sol is not a model/);
  assert.equal(modelAllowed(["claude:sonnet"], "claude", "opus"), false);
  assert.equal(modelAllowed(null, "claude", "opus"), true, "no list: any the catalog offers");
});

test("a grant the decision needs that the principal does not hold is a deny, whatever the rules say", () => {
  const c = company();
  const r = employee(FINANCE, { action: "tool.connector", resource: "github:o/r" });
  assert.equal(evaluate({ constitution: c, overlays: [] }, r).verdict, "allow");
  const refused = evaluate({ constitution: c, overlays: [] }, r, { grant: "not_held" });
  assert.deepEqual([refused.verdict, refused.reasonCodes.at(-1)], ["deny", "NO_GRANT"]);
  assert.equal(evaluate({ constitution: c, overlays: [] }, r, { grant: "held" }).verdict, "allow");
});

test("what a change does: a binding moved is a changed rule; a delegation loosened is a HIGH-risk weakening; a department's impact is its employees'", () => {
  const before = company();
  const after: Constitution = { ...before, rules: before.rules.map((r) => (r.id === "no-paste" ? { ...r, binding: "default" as const } : r)) };
  assert.deepEqual(ruleChanges(before.rules, after.rules).map((x) => [x.id, x.change]), [["no-paste", "changed"]]);
  const opened = impactOf(before, { ...before, delegation: { departments: { actions: { "tool.web": "allow", "repository.push": "allow" }, employeeNetwork: { mode: "AUTONOMOUS" } } } });
  assert.equal(opened.risk, "high");
  assert.ok(opened.obligations.some((o) => o.field === "delegation.departments.actions.repository.push" && o.weakened));
  const impact = departmentImpactOf(before, null, research());
  assert.equal(impact.risk, "high", "the department opens its employees to any public host");
  assert.ok(impact.widened.some((cell) => cell.action === "tool.web"));
  assert.ok(impact.obligations.some((o) => o.field === "employeeNetwork.mode" && o.weakened));
});

test("a department's revision is confirmed against the COMPANY policy read too", () => {
  const base = { actorType: "human" as const, risk: "low" as const, acknowledgedRisk: null, readDigest: "d", digest: "d", readBase: null, base: null };
  assert.equal(confirmationRefusal({ ...base, readCompanyBase: "rev-1", companyBase: "rev-2" }), "STALE_COMPANY_POLICY");
  assert.equal(confirmationRefusal({ ...base, readCompanyBase: "rev-2", companyBase: "rev-2" }), null);
  assert.equal(confirmationRefusal(base), null, "the company's own policy names no company base");
});

test("the tables: the company's binding per row round-trips; a department's rows say inherited, overridden, effective and why locked", () => {
  const c = company();
  const t = tableOf(c);
  assert.equal(t.rows.find((r) => r.action === "tool.web")?.binding, "default");
  assert.deepEqual(withTable(c, t).rules.find((r) => r.id === "web-tools"), { id: "web-tools", action: "tool.web", effect: "deny", binding: "default" });
  assert.equal(withTable(c, t).delegation?.departments?.actions?.["tool.web"], "allow", "the delegation is kept");
  const rows = departmentTableOf(c, research(), RESEARCH);
  const web = rows.find((r) => r.action === "tool.web");
  assert.deepEqual([web?.company.effect, web?.cap, web?.department, web?.effective, web?.locked], ["deny", "allow", "allow", "allow", null]);
  assert.equal(rows.find((r) => r.action === "workspace.execute")?.locked, "not_delegated");
  assert.equal(rows.find((r) => r.action === "governance.policy.modify")?.locked, "ceiling");
});
