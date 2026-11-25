import assert from "node:assert/strict";
import { test } from "node:test";
import { checkConstitution, checkOverlay, defaultAccountPolicy, lintRules, type Constitution, type PolicyOverlay, type Rule } from "./constitution.js";
import { evaluate, resourceMatches } from "./evaluate.js";
import { impactOf } from "./risk.js";
import { ACTION_KINDS, ACTIONS, CLAUDE_ACCOUNT_HOSTS, isClaudeAccountHost, strictest } from "./vocabulary.js";
import { ACCOUNT, ask } from "./testing.spec-helpers.js";

const base = (): Constitution => defaultAccountPolicy(ACCOUNT, "governed");
const withRules = (rules: Rule[], over: Partial<Constitution> = {}): Constitution => ({ ...base(), rules, ...over });
const policy = (constitution: Constitution | null, overlays: PolicyOverlay[] = []) => ({ constitution, overlays });
const overlay = (level: PolicyOverlay["metadata"]["level"], target: string, rules: Rule[]): PolicyOverlay => ({ apiVersion: "orbit.governance/v2", kind: "PolicyOverride", metadata: { accountId: ACCOUNT, level, target, name: "narrow" }, rules });

test("the vocabulary is closed: every action says where it is enforced and what an approval of it is bound to", () => {
  for (const kind of ACTION_KINDS) {
    const spec = ACTIONS[kind];
    assert.ok(["boundary", "control", "runtime", "none"].includes(spec.enforcement), kind);
    assert.ok(spec.fingerprint.length > 0, kind);
  }
  assert.equal(strictest("allow", "deny"), "deny");
  assert.equal(strictest("require_approval", "allow"), "require_approval");
  assert.equal(strictest("deny", "require_approval"), "deny");
});

test("a decision is deterministic: the same policy and request give the same answer, with its reasons", () => {
  const a = evaluate(policy(base()), ask());
  const b = evaluate(policy(base()), ask());
  assert.deepEqual(a, b);
  assert.deepEqual(a, { verdict: "allow", matchedRules: ["account:workspace-write"], reasonCodes: ["RULE_MATCHED"], enforcement: "runtime" });
});

test("deny overrides allow, and approval overrides allow, whatever order the rules are written in", () => {
  const rules: Rule[] = [
    { id: "a", action: "network.egress", effect: "allow" },
    { id: "b", action: "network.egress", resource: "evil.example:443", effect: "deny" },
    { id: "c", action: "network.egress", resource: "partner.example:443", effect: "require_approval" },
  ];
  for (const order of [rules, [...rules].reverse()]) {
    assert.equal(evaluate(policy(withRules(order)), ask({ action: "network.egress", resource: "evil.example:443" })).verdict, "deny");
    assert.equal(evaluate(policy(withRules(order)), ask({ action: "network.egress", resource: "partner.example:443" })).verdict, "require_approval");
    assert.equal(evaluate(policy(withRules(order)), ask({ action: "network.egress", resource: "api.anthropic.com:443" })).verdict, "allow");
  }
});

test("what cannot be judged is denied: no policy, no verified identity, an unknown action, another account", () => {
  assert.deepEqual(evaluate(policy(null), ask()).reasonCodes, ["NO_PUBLISHED_POLICY"]);
  assert.deepEqual(evaluate(policy(base()), ask({ principalId: null })).reasonCodes, ["NO_VERIFIED_IDENTITY"]);
  assert.deepEqual(evaluate(policy(base()), ask({ principalId: "" })).reasonCodes, ["NO_VERIFIED_IDENTITY"]);
  assert.deepEqual(evaluate(policy(base()), ask({ action: "system.reboot" })), { verdict: "deny", matchedRules: [], reasonCodes: ["UNKNOWN_ACTION"], enforcement: "none" });
  assert.deepEqual(evaluate(policy(base()), ask({ accountId: "other" })).reasonCodes, ["ACCOUNT_MISMATCH"]);
  for (const r of [evaluate(policy(null), ask()), evaluate(policy(base()), ask({ principalId: null })), evaluate(policy(base()), ask({ accountId: "other" }))]) assert.equal(r.verdict, "deny");
});

test("the Claude account's hosts are declared once: the default policy lets an agent reach exactly them", () => {
  const reach = (resource: string) => evaluate(policy(base()), ask({ action: "network.egress", resource })).verdict;
  assert.deepEqual(CLAUDE_ACCOUNT_HOSTS.map((h) => reach(`${h.host}:${h.port}`)), CLAUDE_ACCOUNT_HOSTS.map(() => "allow"));
  assert.deepEqual(CLAUDE_ACCOUNT_HOSTS.map((h) => [h.host, h.port]), [["api.anthropic.com", 443], ["platform.claude.com", 443], ["claude.ai", 443]]);
  assert.deepEqual([reach("example.com:443"), reach("api.anthropic.com:80")], ["deny", "deny"]);
  assert.deepEqual([isClaudeAccountHost("PLATFORM.claude.com", 443), isClaudeAccountHost("platform.claude.com", 80), isClaudeAccountHost("claude.ai.example.com", 443)], [true, false, false]);
});

test("an action no rule names gets the default decision, which is never allow", () => {
  const empty = withRules([]);
  assert.deepEqual(evaluate(policy(empty), ask({ action: "repository.read" })), { verdict: "deny", matchedRules: [], reasonCodes: ["DEFAULT_DECISION"], enforcement: "runtime" });
  assert.equal(evaluate(policy(withRules([], { defaults: { decision: "require_approval" } })), ask({ action: "repository.read" })).verdict, "require_approval");
  assert.equal(checkConstitution({ ...empty, defaults: { decision: "allow" } }).ok, false);
});

test("an agent can never be granted authority over its own governance, whatever a rule says", () => {
  const generous = withRules([
    { id: "all-modify", action: "governance.policy.modify", effect: "allow" },
    { id: "all-settings", action: "settings.privileged.write", effect: "allow" },
    { id: "all-approve", action: "governance.approval.decide", effect: "allow" },
    { id: "all-secrets", action: "credential.read_raw", effect: "allow" },
    { id: "all-audit", action: "governance.audit.modify", effect: "allow" },
  ]);
  for (const action of ["governance.policy.modify", "settings.privileged.write", "governance.approval.decide", "credential.read_raw", "governance.audit.modify"]) {
    const r = evaluate(policy(generous), ask({ action }));
    assert.equal(r.verdict, "deny", action);
    assert.ok(r.reasonCodes.includes("PRINCIPAL_CEILING"), action);
  }
  // The account's owner may be allowed the people-only ones; nobody is ever allowed a raw credential or an audit change.
  assert.equal(evaluate(policy(generous), ask({ principalType: "human", principalId: "owner:acc-1", action: "settings.privileged.write" })).verdict, "allow");
  assert.equal(evaluate(policy(generous), ask({ principalType: "human", principalId: "owner:acc-1", action: "credential.read_raw" })).verdict, "deny");
  assert.equal(evaluate(policy(generous), ask({ principalType: "human", principalId: "owner:acc-1", action: "governance.audit.modify" })).verdict, "deny");
});

test("git is the account policy's to decide for an agent: allowed, it pushes; by default it waits for one approval", () => {
  const generous = withRules([{ id: "push", action: "repository.push", effect: "allow" }]);
  const r = evaluate(policy(generous), ask({ action: "repository.push", resource: "github.com/o/r" }));
  assert.deepEqual([r.verdict, r.reasonCodes, r.enforcement], ["allow", ["RULE_MATCHED"], "boundary"]);
  assert.equal(evaluate(policy(base()), ask({ action: "repository.push", resource: "github.com/o/r" })).verdict, "require_approval");
  assert.equal(evaluate(policy(withRules([{ id: "push", action: "repository.push", effect: "deny" }])), ask({ action: "repository.push", resource: "github.com/o/r" })).verdict, "deny");
});

test("an employee's write through a connector waits for one approval by default, in either deployment; the policy may allow or forbid it", () => {
  for (const deployment of ["single", "governed"] as const) {
    const r = evaluate(policy(defaultAccountPolicy(ACCOUNT, deployment)), ask({ action: "connector.write", resource: "azure-devops:Fabrikam/Fiber" }));
    assert.deepEqual([r.verdict, r.enforcement], ["require_approval", "boundary"], deployment);
  }
  assert.equal(evaluate(policy(withRules([{ id: "w", action: "connector.write", effect: "allow" }])), ask({ action: "connector.write", resource: "github:o/r" })).verdict, "allow");
  assert.equal(evaluate(policy(withRules([{ id: "w", action: "connector.write", effect: "deny" }])), ask({ action: "connector.write", resource: "github:o/r" })).verdict, "deny");
  assert.deepEqual(ACTIONS["connector.write"].fingerprint, ["connector", "target", "operation", "digest"]);
});

test("an employee's desk is a person's to look into and to clean up, never an agent's: allowed by default, every decision recorded", () => {
  const owner = { principalType: "human", principalId: "owner:acc-1" } as const;
  for (const deployment of ["single", "governed"] as const) {
    for (const action of ["employee.desk.read", "employee.desk.clean"] as const) {
      const p = policy(defaultAccountPolicy(ACCOUNT, deployment));
      assert.equal(evaluate(p, ask({ ...owner, action, resource: "emp-1" })).verdict, "allow", `${deployment} ${action}`);
      const agent = evaluate(policy(withRules([{ id: "all", action, effect: "allow" }])), ask({ action, resource: "emp-1" }));
      assert.equal(agent.verdict, "deny", action);
      assert.ok(agent.reasonCodes.includes("PRINCIPAL_CEILING"), action);
    }
  }
  for (const action of ["employee.desk.read", "employee.desk.clean"] as const) {
    assert.equal(ACTIONS[action].sensitive, true, `${action} is recorded even where only refusals are`);
    assert.deepEqual(ACTIONS[action].fingerprint, ["employee"]);
  }
});

test("a lead engages a temporary assistant within its quota (a grant it holds or not); hiring a permanent employee is never an agent's", () => {
  const lead = { principalType: "agent", principalId: "employee:lead-1", runKind: "assignment", employeeId: "lead-1" } as const;
  for (const deployment of ["single", "governed"] as const) {
    const p = policy(defaultAccountPolicy(ACCOUNT, deployment));
    const engaged = evaluate(p, ask({ ...lead, action: "employee.hire_assistant", resource: "emp-9" }), { grant: "held" });
    assert.deepEqual([engaged.verdict, engaged.matchedRules], ["allow", ["account:office-assistants"]], deployment);
    const full = evaluate(p, ask({ ...lead, action: "employee.hire_assistant", resource: "emp-9" }), { grant: "not_held" });
    assert.deepEqual([full.verdict, full.reasonCodes], ["deny", ["RULE_MATCHED", "NO_GRANT"]], `${deployment}: its quota is full`);
  }
  const generous = policy(withRules([{ id: "all-hire", action: "employee.hire", effect: "allow" }, { id: "assist", action: "employee.hire_assistant", effect: "deny" }]));
  const hire = evaluate(generous, ask({ ...lead, action: "employee.hire", resource: "emp-9" }));
  assert.deepEqual([hire.verdict, hire.reasonCodes.includes("PRINCIPAL_CEILING")], ["deny", true], "a permanent hire stays people-only, whatever a rule says");
  assert.equal(evaluate(generous, ask({ principalType: "human", principalId: "owner:acc-1", action: "employee.hire", resource: "emp-9" })).verdict, "allow");
  assert.equal(evaluate(generous, ask({ ...lead, action: "employee.hire_assistant", resource: "emp-9" }), { grant: "held" }).verdict, "deny", "the policy may refuse assistants altogether");
  assert.deepEqual(ACTIONS["employee.hire_assistant"].fingerprint, ["mission", "employee"]);
});

test("a production action is never simply allowed to an agent: the most it gets is one approval", () => {
  for (const action of ["deployment.production", "database.production.migrate", "data.production.destroy"] as const) {
    const most = (ACTIONS[action].ceiling as Partial<Record<string, string>>).agent;
    assert.equal(most, "require_approval", action);
  }
});

test("an action nothing can carry out is denied, even when a rule allows it", () => {
  const generous = withRules([{ id: "deploy", action: "deployment.production", effect: "require_approval" }]);
  const r = evaluate(policy(generous), ask({ action: "deployment.production", resource: "prod", environment: "production" }));
  assert.deepEqual([r.verdict, r.reasonCodes.at(-1)], ["deny", "NO_EXECUTOR"]);
  assert.deepEqual(lintRules(generous.rules).map((w) => w.code), ["NO_EXECUTOR"]);
});

test("an override only narrows: its deny binds, its allow changes nothing, and it applies only to its own target", () => {
  const narrow = overlay("workspace", "ws-1", [{ id: "no-write", action: "repository.write", effect: "deny" }]);
  const r = evaluate(policy(base(), [narrow]), ask());
  assert.deepEqual(r, { verdict: "deny", matchedRules: ["account:workspace-write", "workspace:ws-1:no-write"], reasonCodes: ["RULE_MATCHED", "OVERLAY_NARROWED"], enforcement: "runtime" });
  assert.equal(evaluate(policy(base(), [narrow]), ask({ workspaceId: "ws-2", resource: "ws-2" })).verdict, "allow");
  const widen = overlay("workspace", "ws-1", [{ id: "push-free", action: "repository.push", effect: "allow" }, { id: "web", action: "tool.web", effect: "allow" }]);
  assert.equal(evaluate(policy(base(), [widen]), ask({ action: "tool.web" })).verdict, "deny");
  assert.equal(evaluate(policy(base(), [widen]), ask({ action: "repository.push", resource: "x" })).verdict, "require_approval");
  assert.deepEqual(lintRules(widen.rules, true).map((w) => w.code), ["OVERLAY_CANNOT_WIDEN", "OVERLAY_CANNOT_WIDEN"]);
  // A research workspace's override reaches only requests about that research workspace.
  const research = overlay("research_workspace", "rws-9", [{ id: "x", action: "repository.write", effect: "deny" }]);
  assert.equal(evaluate(policy(base(), [research]), ask()).verdict, "allow");
  assert.equal(evaluate(policy(base(), [research]), ask({ workspaceId: null, researchWorkspaceId: "rws-9" })).verdict, "deny");
  // Another account's override never applies, even to the same target.
  const foreign = { ...narrow, metadata: { ...narrow.metadata, accountId: "acc-2" } };
  assert.equal(evaluate(policy(base(), [foreign]), ask()).verdict, "allow");
  assert.equal(checkOverlay(narrow).ok, true);
  assert.equal(checkOverlay({ ...narrow, metadata: { ...narrow.metadata, level: "galaxy" } }).ok, false);
});

test("a rule's resource is a name or a prefix, and its principal and environment narrow whom it speaks to", () => {
  assert.equal(resourceMatches(undefined, "anything"), true);
  assert.equal(resourceMatches("a.example:443", "a.example:443"), true);
  assert.equal(resourceMatches("a.example:443", "a.example:4430"), false);
  assert.equal(resourceMatches("github.com/acme/*", "github.com/acme/app"), true);
  assert.equal(resourceMatches("github.com/acme/*", "github.com/other/app"), false);
  const p = withRules([{ id: "prod-only", action: "repository.write", environment: "production", effect: "deny" }, { id: "write", action: "repository.write", effect: "allow" }]);
  assert.equal(evaluate(policy(p), ask({ environment: "production" })).verdict, "deny");
  assert.equal(evaluate(policy(p), ask({ environment: "unknown" })).verdict, "allow");
});

test("a Constitution is refused for anything it does not declare correctly, and every problem is named", () => {
  assert.equal(checkConstitution(base()).ok, true);
  assert.equal(checkConstitution("rules: allow everything").ok, false);
  const bad = checkConstitution({
    apiVersion: "v0",
    kind: "AccountPolicy",
    metadata: { accountId: ACCOUNT, name: "x", revision: 3 },
    defaults: { decision: "deny" },
    obligations: { auditDecisions: "none", dailyReport: "yes", isolation: "required" },
    rules: [
      { id: "Bad Id", action: "repository.write", effect: "allow" },
      { id: "a", action: "launch.missiles", effect: "allow" },
      { id: "a", action: "repository.write", effect: "maybe" },
      { id: "b", action: "network.egress", resource: "a*b", effect: "allow" },
      { id: "c", action: "governance.policy.modify", principalType: "agent", effect: "allow" },
      { id: "d", action: "repository.write", effect: "allow", command: "rm -rf /" },
    ],
    extra: true,
  });
  assert.equal(bad.ok, false);
  const errors = bad.ok ? [] : bad.errors;
  for (const needle of ["extra is not a known field", "apiVersion must be", "metadata.revision is not a known field", "obligations.auditDecisions", "obligations.dailyReport", "rules[0].id", "rules[1].action", "rules[2].effect", "rules[3].resource", 'can never be more than "deny" for an agent', "rules[5].command is not a known field", 'the rule id "a" is used twice']) {
    assert.ok(errors.some((e) => e.includes(needle)), `${needle} in ${errors.join(" | ")}`);
  }
});

test("a change that loosens a sensitive action, or weakens an obligation, is high risk -- worked out from the policies", () => {
  const b = base();
  assert.deepEqual([impactOf(b, b).risk, impactOf(b, b).widened.length, impactOf(b, b).rules.length], ["low", 0, 0]);

  const tighter = withRules(b.rules.map((r) => (r.id === "workspace-execute" ? { ...r, effect: "deny" as const } : r)));
  const narrowed = impactOf(b, tighter);
  assert.deepEqual([narrowed.risk, narrowed.widened.length, narrowed.narrowed.length > 0, narrowed.rules.map((r) => r.change)], ["low", 0, true, ["changed"]]);

  const moreEgress = withRules([...b.rules, { id: "egress-github", action: "network.egress", resource: "github.com:443", effect: "allow" }]);
  const wide = impactOf(b, moreEgress);
  assert.equal(wide.risk, "high");
  assert.deepEqual(wide.widened.map((c) => [c.action, c.resource, c.before, c.after, c.environments.length]), [
    ["network.egress", "github.com:443", "deny", "allow", 6],
    ["network.egress", "github.com:443", "deny", "allow", 6],
    ["network.egress", "github.com:443", "deny", "allow", 6],
  ]);
  assert.deepEqual(wide.reasons, ["It loosens network.egress, a sensitive action."]);

  const noAudit = { ...b, obligations: { ...b.obligations, auditDecisions: "non_allow" as const } };
  assert.deepEqual([impactOf(b, noAudit).risk, impactOf(b, noAudit).obligations], ["high", [{ field: "auditDecisions", before: "all", after: "non_allow", weakened: true }]]);
  const noIsolation = { ...b, obligations: { ...b.obligations, isolation: "optional" as const } };
  assert.equal(impactOf(b, noIsolation).risk, "high");
  const softDefault = { ...b, defaults: { decision: "require_approval" as const } };
  assert.equal(impactOf(b, softDefault).risk, "high");

  // Removing the approval requirement frees an agent's git as much as a person's: high, so the owner acknowledges it.
  const pushFree = withRules(b.rules.map((r) => (r.id === "git-push" ? { ...r, effect: "allow" as const } : r)));
  const freed = impactOf(b, pushFree);
  assert.deepEqual([freed.risk, [...new Set(freed.widened.map((c) => c.principalType))]], ["high", ["human", "agent", "service"]]);

  // A prefix rule is asked about with a resource under it, and one outside it stays as it was.
  const prefix = withRules([...b.rules, { id: "egress-corp", action: "network.egress", resource: "corp.example/*", effect: "allow" }]);
  assert.deepEqual([...new Set(impactOf(b, prefix).widened.map((c) => c.resource))], ["corp.example/*"]);

  const elevated = impactOf(withRules(b.rules.filter((r) => r.id !== "workspace-execute")), b);
  assert.deepEqual([elevated.risk, elevated.reasons], ["elevated", ["It loosens an action that is not sensitive."]]);
});

test("an account starts from the default of its deployment: one container keeps what it always allowed, the governed one is strict", () => {
  const single = defaultAccountPolicy(ACCOUNT, "single");
  const governed = defaultAccountPolicy(ACCOUNT, "governed");
  for (const p of [single, governed]) {
    assert.equal(checkConstitution(p).ok, true);
    assert.deepEqual([p.kind, p.metadata.accountId, p.defaults.decision], ["AccountPolicy", ACCOUNT, "deny"]);
  }
  const verdict = (p: Constitution, action: string) => evaluate(policy(p), ask({ action, resource: "x" })).verdict;
  assert.deepEqual([single.obligations.isolation, verdict(single, "tool.web"), verdict(single, "tool.connector")], ["optional", "allow", "allow"]);
  assert.deepEqual([governed.obligations.isolation, verdict(governed, "tool.web"), verdict(governed, "tool.connector")], ["required", "deny", "deny"]);
  for (const p of [single, governed]) {
    assert.equal(verdict(p, "repository.push"), "require_approval");
    assert.equal(verdict(p, "governance.policy.modify"), "deny");
    assert.equal(evaluate(policy(p), ask({ principalType: "human", principalId: "owner:acc-1", action: "settings.privileged.write", resource: "githubForClaude" })).verdict, "allow");
  }
  // A connector is decided one by one: a rule may name one connector and leave the others to the rest of the policy.
  const one = withRules([{ id: "docs-only", action: "tool.connector", resource: "claude.ai Claude Docs", effect: "allow" }]);
  assert.equal(evaluate(policy(one), ask({ action: "tool.connector", resource: "claude.ai Claude Docs" })).verdict, "allow");
  assert.equal(evaluate(policy(one), ask({ action: "tool.connector", resource: "claude.ai Gmail" })).verdict, "deny");
  assert.deepEqual(ACTIONS["tool.connector"].fingerprint, ["connector"]);
});
