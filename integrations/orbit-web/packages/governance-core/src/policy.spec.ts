import assert from "node:assert/strict";
import { test } from "node:test";
import { checkConstitution, checkOverlay, defaultConstitution, lintRules, type Constitution, type PolicyOverlay, type Rule } from "./constitution.js";
import { evaluate, resourceMatches } from "./evaluate.js";
import { impactOf } from "./risk.js";
import { ACTION_KINDS, ACTIONS, CLAUDE_ACCOUNT_HOSTS, isClaudeAccountHost, strictest } from "./vocabulary.js";
import { ask, ORG } from "./testing.spec-helpers.js";

const base = (): Constitution => defaultConstitution(ORG);
const withRules = (rules: Rule[], over: Partial<Constitution> = {}): Constitution => ({ ...base(), rules, ...over });
const policy = (constitution: Constitution | null, overlays: PolicyOverlay[] = []) => ({ constitution, overlays });
const overlay = (level: PolicyOverlay["metadata"]["level"], target: string, rules: Rule[]): PolicyOverlay => ({ apiVersion: "orbit.governance/v1", kind: "PolicyOverlay", metadata: { organizationId: ORG, level, target, name: "narrow" }, rules });

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
  assert.deepEqual(a, { verdict: "allow", matchedRules: ["organization:workspace-write"], reasonCodes: ["RULE_MATCHED"], enforcement: "runtime" });
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

test("what cannot be judged is denied: no policy, no verified identity, an unknown action, another organization", () => {
  assert.deepEqual(evaluate(policy(null), ask()).reasonCodes, ["NO_PUBLISHED_POLICY"]);
  assert.deepEqual(evaluate(policy(base()), ask({ principalId: null })).reasonCodes, ["NO_VERIFIED_IDENTITY"]);
  assert.deepEqual(evaluate(policy(base()), ask({ principalId: "" })).reasonCodes, ["NO_VERIFIED_IDENTITY"]);
  assert.deepEqual(evaluate(policy(base()), ask({ action: "system.reboot" })), { verdict: "deny", matchedRules: [], reasonCodes: ["UNKNOWN_ACTION"], enforcement: "none" });
  assert.deepEqual(evaluate(policy(base()), ask({ organizationId: "other" })).reasonCodes, ["ORGANIZATION_MISMATCH"]);
  for (const r of [evaluate(policy(null), ask()), evaluate(policy(base()), ask({ principalId: null })), evaluate(policy(base()), ask({ organizationId: "other" }))]) assert.equal(r.verdict, "deny");
});

test("the Claude account's hosts are declared once: the default Constitution lets an agent reach exactly them", () => {
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
    { id: "all-roles", action: "governance.role.grant", effect: "allow" },
    { id: "all-settings", action: "settings.privileged.write", effect: "allow" },
    { id: "all-approve", action: "governance.approval.decide", effect: "allow" },
    { id: "all-secrets", action: "credential.read_raw", effect: "allow" },
    { id: "all-audit", action: "governance.audit.modify", effect: "allow" },
  ]);
  for (const action of ["governance.policy.modify", "governance.role.grant", "settings.privileged.write", "governance.approval.decide", "credential.read_raw", "governance.audit.modify"]) {
    const r = evaluate(policy(generous), ask({ action }));
    assert.equal(r.verdict, "deny", action);
    assert.ok(r.reasonCodes.includes("PRINCIPAL_CEILING"), action);
  }
  // A person may be allowed the people-only ones; nobody is ever allowed a raw credential or an audit change.
  assert.equal(evaluate(policy(generous), ask({ principalType: "human", principalId: "op-1", action: "settings.privileged.write" })).verdict, "allow");
  assert.equal(evaluate(policy(generous), ask({ principalType: "human", principalId: "op-1", action: "credential.read_raw" })).verdict, "deny");
  assert.equal(evaluate(policy(generous), ask({ principalType: "human", principalId: "op-1", action: "governance.audit.modify" })).verdict, "deny");
});

test("git is the Constitution's to decide for an agent: allowed, it pushes; by default it waits for one approval", () => {
  const generous = withRules([{ id: "push", action: "repository.push", effect: "allow" }]);
  const r = evaluate(policy(generous), ask({ action: "repository.push", resource: "github.com/o/r" }));
  assert.deepEqual([r.verdict, r.reasonCodes, r.enforcement], ["allow", ["RULE_MATCHED"], "boundary"]);
  assert.equal(evaluate(policy(base()), ask({ action: "repository.push", resource: "github.com/o/r" })).verdict, "require_approval");
  assert.equal(evaluate(policy(withRules([{ id: "push", action: "repository.push", effect: "deny" }])), ask({ action: "repository.push", resource: "github.com/o/r" })).verdict, "deny");
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

test("an overlay only narrows: its deny binds, its allow changes nothing, and it applies only to its own target", () => {
  const narrow = overlay("workspace", "ws-1", [{ id: "no-write", action: "repository.write", effect: "deny" }]);
  const r = evaluate(policy(base(), [narrow]), ask());
  assert.deepEqual(r, { verdict: "deny", matchedRules: ["organization:workspace-write", "workspace:ws-1:no-write"], reasonCodes: ["RULE_MATCHED", "OVERLAY_NARROWED"], enforcement: "runtime" });
  assert.equal(evaluate(policy(base(), [narrow]), ask({ workspaceId: "ws-2", resource: "ws-2" })).verdict, "allow");
  const widen = overlay("workspace", "ws-1", [{ id: "push-free", action: "repository.push", effect: "allow" }, { id: "web", action: "tool.web", effect: "allow" }]);
  assert.equal(evaluate(policy(base(), [widen]), ask({ action: "tool.web" })).verdict, "deny");
  assert.equal(evaluate(policy(base(), [widen]), ask({ action: "repository.push", resource: "x" })).verdict, "require_approval");
  assert.deepEqual(lintRules(widen.rules, true).map((w) => w.code), ["OVERLAY_CANNOT_WIDEN", "OVERLAY_CANNOT_WIDEN"]);
  const agentOnly = overlay("agent", "agt-9", [{ id: "x", action: "repository.write", effect: "deny" }]);
  assert.equal(evaluate(policy(base(), [agentOnly]), ask()).verdict, "allow");
  assert.equal(evaluate(policy(base(), [agentOnly]), ask({ agentId: "agt-9", principalId: "agt-9" })).verdict, "deny");
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
    kind: "CompanyConstitution",
    metadata: { organizationId: ORG, name: "x", revision: 3 },
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

  // Removing the approval requirement frees an agent's git as much as a person's: high, so somebody else approves it.
  const pushFree = withRules(b.rules.map((r) => (r.id === "git-push" ? { ...r, effect: "allow" as const } : r)));
  const freed = impactOf(b, pushFree);
  assert.deepEqual([freed.risk, [...new Set(freed.widened.map((c) => c.principalType))]], ["high", ["human", "agent", "service"]]);

  // A prefix rule is asked about with a resource under it, and one outside it stays as it was.
  const prefix = withRules([...b.rules, { id: "egress-corp", action: "network.egress", resource: "corp.example/*", effect: "allow" }]);
  assert.deepEqual([...new Set(impactOf(b, prefix).widened.map((c) => c.resource))], ["corp.example/*"]);

  const elevated = impactOf(withRules(b.rules.filter((r) => r.id !== "workspace-execute")), b);
  assert.deepEqual([elevated.risk, elevated.reasons], ["elevated", ["It loosens an action that is not sensitive."]]);
});
