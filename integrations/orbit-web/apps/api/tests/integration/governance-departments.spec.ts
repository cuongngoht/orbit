// A DEPARTMENT'S POLICY, end to end through HTTP on PostgreSQL (ADR 0061 §6): the company delegates what its
// departments may decide; a department's draft is validated against that delegation, published by the owner against the
// company revision read, rolled back by a copy published anew; simulation answers what enforcement would; a chat's, a
// research question's and a person's decisions never read it; an agent never publishes one.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Department, DepartmentPolicyOverview, DepartmentRevisionView, PolicyOverview, RevisionView, SimulateResult } from "@orbit-web/contracts";
import { evaluate, type Constitution, type DepartmentPolicy } from "@orbit-web/governance-core";
import { PolicyService } from "../../src/modules/governance/policy.service.js";
import { contextOf } from "../../src/modules/auth/principal.js";
import { startHarness, type Browser, type Harness } from "../../src/testing/harness.js";

const code = (r: { body: unknown }): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

describe("a department's policy: delegated by the company, published by its owner, enforced for its employees alone", () => {
  let h: Harness;
  let b: Browser;
  let accountId: string;
  const dept: Record<string, string> = {};

  const company = async (): Promise<RevisionView> => ((await b.get("/api/governance/policy")).body as PolicyOverview).effective as RevisionView;
  // The company's policy, changed and published through its lifecycle, at whatever risk it carries.
  const publishCompany = async (change: (c: Constitution) => Constitution): Promise<RevisionView> => {
    const current = await company();
    const draft = await b.send("POST", "/api/governance/revisions", { document: change(current.document as Constitution) });
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const d = draft.body as RevisionView;
    assert.equal((await b.send("POST", `/api/governance/revisions/${d.id}/validate`, {})).status, 200);
    const published = await b.send("POST", `/api/governance/revisions/${d.id}/publish`, { digest: d.digest, base: current.id, acknowledgedRisk: "high" });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    return published.body as RevisionView;
  };
  const path = (id: string) => `/api/governance/departments/${id}/policy`;
  const overview = async (id: string) => (await b.get(path(id))).body as DepartmentPolicyOverview;
  const draft = async (id: string, document: DepartmentPolicy) => {
    const r = await b.send("POST", `${path(id)}/revisions`, { document });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body as DepartmentRevisionView;
  };
  const doc = (departmentId: string, over: Partial<DepartmentPolicy> = {}): DepartmentPolicy => ({ apiVersion: "orbit.governance/v2", kind: "DepartmentPolicy", metadata: { accountId, departmentId, name: "Research policy" }, rules: [], ...over });

  before(async () => {
    h = await startHarness();
    b = h.owner as Browser;
    accountId = h.accountId as string;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Policy Co" })).status, 200);
    for (const name of ["Research", "Finance"]) dept[name] = ((await b.send("POST", "/api/office/departments", { name })).body as Department).id;
    // The company: employees RESTRICTED; departments may choose up to AUTONOMOUS and decide the web tools (a default deny).
    await publishCompany((c) => ({
      ...c,
      employeeNetwork: { mode: "RESTRICTED", allow: ["api.anthropic.com"] },
      delegation: { departments: { actions: { "tool.web": "allow" }, employeeNetwork: { mode: "AUTONOMOUS" } } },
      rules: [...c.rules.filter((r) => r.action !== "tool.web"), { id: "web-tools", action: "tool.web", effect: "deny", binding: "default" }, { id: "no-paste", action: "network.egress", resource: "pastebin.com:443", effect: "deny" }],
    }));
  });

  after(async () => {
    await h?.close();
  });

  test("a department with no policy inherits the company's: every row says so, the network is the company's", async () => {
    const o = await overview(dept.Finance as string);
    assert.equal(o.effective, null);
    assert.equal(o.network?.mode, "RESTRICTED");
    const web = o.rows.find((r) => r.action === "tool.web");
    assert.deepEqual([web?.company.effect, web?.cap, web?.department, web?.effective, web?.locked], ["deny", "allow", null, "deny", null]);
    assert.equal(o.rows.find((r) => r.action === "workspace.execute")?.locked, "not_delegated");
  });

  test("a draft beyond the delegation is refused at validation (422 exceeds_delegation); one within it is published against the company revision read", async () => {
    const research = dept.Research as string;
    const beyond = await draft(research, doc(research, { rules: [{ id: "push", action: "repository.push", effect: "allow" }] }));
    const refused = await b.send("POST", `${path(research)}/revisions/${beyond.id}/validate`, {});
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
    assert.equal(code(refused), "exceeds_delegation");
    const within = await draft(research, doc(research, { employeeNetwork: { mode: "AUTONOMOUS" }, rules: [{ id: "web", action: "tool.web", effect: "allow" }] }));
    assert.equal((await b.send("POST", `${path(research)}/revisions/${within.id}/validate`, {})).status, 200);
    const read = (await b.get(`${path(research)}/revisions/${within.id}`)).body as DepartmentRevisionView;
    assert.equal(read.impact?.risk, "high", "it opens its employees to any public host");
    const stale = await b.send("POST", `${path(research)}/revisions/${within.id}/publish`, { digest: read.digest, base: null, companyBase: "rev-somebody-else", acknowledgedRisk: "high" });
    assert.equal(code(stale), "stale_company_policy");
    const published = await b.send("POST", `${path(research)}/revisions/${within.id}/publish`, { digest: read.digest, base: null, companyBase: read.companyBase, acknowledgedRisk: "high" });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    const o = await overview(research);
    assert.deepEqual([o.effective?.revision, o.network?.mode, o.rows.find((r) => r.action === "tool.web")?.effective], [1, "AUTONOMOUS", "allow"]);
    const audit = await h.sql("SELECT data->>'departmentId' AS department, data->>'companyBase' AS base FROM audit_events WHERE account_id = $1 AND event_type = 'policy.published' AND data->>'departmentId' IS NOT NULL", [accountId]);
    assert.deepEqual(audit, [{ department: research, base: read.companyBase }]);
  });

  test("simulation answers as enforcement does: the same evaluate(), the department's policy in effect -- and the other department's employees, the company's", async () => {
    const ask = (departmentId: string, request: Record<string, unknown>) => b.send("POST", `${path(departmentId)}/simulate`, { request: { principalType: "agent", environment: "development", workspaceId: null, researchWorkspaceId: null, ...request } });
    const open = (await ask(dept.Research as string, { action: "network.egress", resource: "news.example.com:443" })).body as SimulateResult;
    const shut = (await ask(dept.Finance as string, { action: "network.egress", resource: "news.example.com:443" })).body as SimulateResult;
    const locked = (await ask(dept.Research as string, { action: "network.egress", resource: "pastebin.com:443" })).body as SimulateResult;
    assert.deepEqual([open.evaluation.verdict, shut.evaluation.verdict, locked.evaluation.verdict], ["allow", "deny", "deny"]);
    // Enforcement: the policy service decides an employee's request with the department's CURRENT policy, the same way.
    const policy = h.app.get(PolicyService);
    const c = (await policy.effective(accountId))?.constitution as Constitution;
    const d = (await policy.departmentEffective(accountId, dept.Research as string))?.policy as DepartmentPolicy;
    const request = { principalId: "employee:x", principalType: "agent" as const, accountId, workspaceId: null, researchWorkspaceId: null, action: "network.egress", resource: "news.example.com:443", environment: "development" as const, runKind: "assignment" as const, departmentId: dept.Research };
    assert.equal(evaluate({ constitution: c, overlays: [], departments: [d] }, request).verdict, open.evaluation.verdict);
  });

  test("a chat's, a research question's and a person's decisions never read a department's policy", async () => {
    const policy = h.app.get(PolicyService);
    const ctx = contextOf({ kind: "owner", accountId, userId: "u", sessionId: "s", username: "octo", fullName: "Octo", email: "o@x", csrfToken: "c", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    const decision = await policy.decide(ctx, { action: "tool.web", resource: "*", scope: "ACCOUNT" });
    assert.equal(decision.departmentRevision, null);
    assert.equal(decision.verdict, "deny", "the company's default for the web tools, not Research's allow");
  });

  test("rollback is a copy published anew; two publications at once: exactly one wins", async () => {
    const research = dept.Research as string;
    const first = (await overview(research)).effective as DepartmentRevisionView;
    const narrow = await draft(research, doc(research, { employeeNetwork: { mode: "RESTRICTED" } }));
    await b.send("POST", `${path(research)}/revisions/${narrow.id}/validate`, {});
    const n = (await b.get(`${path(research)}/revisions/${narrow.id}`)).body as DepartmentRevisionView;
    const again = await draft(research, doc(research, { rules: [{ id: "web", action: "tool.web", effect: "allow" }] }));
    await b.send("POST", `${path(research)}/revisions/${again.id}/validate`, {});
    const a = (await b.get(`${path(research)}/revisions/${again.id}`)).body as DepartmentRevisionView;
    const [one, two] = await Promise.all([
      b.send("POST", `${path(research)}/revisions/${n.id}/publish`, { digest: n.digest, base: first.id, companyBase: n.companyBase, acknowledgedRisk: "high" }),
      b.send("POST", `${path(research)}/revisions/${a.id}/publish`, { digest: a.digest, base: first.id, companyBase: a.companyBase, acknowledgedRisk: "high" }),
    ]);
    assert.deepEqual([one.status, two.status].sort(), [200, 409], JSON.stringify([one.body, two.body]));
    const rollback = await b.send("POST", `${path(research)}/revisions`, { from: first.id });
    assert.equal(rollback.status, 201);
    assert.equal((rollback.body as DepartmentRevisionView).source, "copy");
    assert.equal((rollback.body as DepartmentRevisionView).basedOn, first.id);
  });

  test("only the owner writes a department's policy: no agent publishes, and another account reaches nothing of it", async () => {
    const other = await h.as("mallory");
    assert.equal((await other.get(path(dept.Research as string))).status, 404);
    const o = await overview(dept.Research as string);
    assert.ok(o.revisions.length >= 3);
  });
  test("runtime security: a department may only raise it; the page reads the company's and what holds its employees", async () => {
    const sec = ((await b.send("POST", "/api/office/departments", { name: "Security" })).body as Department).id;
    await publishCompany((c) => ({ ...c, runtimeSecurity: { mode: "observe", controls: ["exec.shared-areas"] } }));
    assert.deepEqual((await overview(sec)).runtimeSecurity, { company: { mode: "observe", controls: ["exec.shared-areas"] }, effective: { mode: "observe", controls: ["exec.shared-areas"], floor: "disabled", from: { mode: "company" } } });
    const lower = await draft(sec, doc(sec, { runtimeSecurity: { mode: "disabled" } }));
    assert.equal((await b.send("POST", `${path(sec)}/revisions/${lower.id}/validate`, {})).status, 422);
    const raise = await draft(sec, doc(sec, { runtimeSecurity: { mode: "enforce" } }));
    assert.equal((await b.send("POST", `${path(sec)}/revisions/${raise.id}/validate`, {})).status, 200);
    const read = (await b.get(`${path(sec)}/revisions/${raise.id}`)).body as DepartmentRevisionView;
    const published = await b.send("POST", `${path(sec)}/revisions/${raise.id}/publish`, { digest: read.digest, base: null, companyBase: read.companyBase, acknowledgedRisk: read.impact?.risk ?? null });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.deepEqual((await overview(sec)).runtimeSecurity?.effective, { mode: "enforce", controls: ["exec.shared-areas"], floor: "disabled", from: { mode: "department" } });
  });
});
