import assert from "node:assert/strict";
import { test } from "node:test";
import { checkConstitution, defaultConstitution, type Constitution, type Rule } from "./constitution.js";
import { boxesOf, effectOf, egressHostOf, tableOf, withTable, type ConstitutionTable } from "./table.js";
import { ACTION_KINDS, CLAUDE_ACCOUNT_HOSTS, type ActionKind, type Effect } from "./vocabulary.js";
import { ORG } from "./testing.spec-helpers.js";

const base = (): Constitution => defaultConstitution(ORG);
const tick = (t: ConstitutionTable, action: ActionKind, effect: Effect): ConstitutionTable => ({ ...t, rows: t.rows.map((r) => (r.action === action ? { ...r, effect, stated: true } : r)) });
const ruleOf = (c: Constitution, action: ActionKind): Rule[] => c.rules.filter((r) => r.action === action);

test("a row's two boxes are the three effects: neither ticked is denied", () => {
  assert.deepEqual([effectOf(false, false), effectOf(false, true), effectOf(true, false), effectOf(true, true)], ["deny", "deny", "allow", "require_approval"]);
  for (const e of ["allow", "require_approval", "deny"] as const) {
    const b = boxesOf(e);
    assert.equal(effectOf(b.allowed, b.approval), e);
  }
});

test("the default Constitution read into the table and written back is the same document", () => {
  const t = tableOf(base());
  assert.deepEqual(t.rows.map((r) => r.action), ACTION_KINDS);
  assert.deepEqual(withTable(base(), t), base());
  assert.deepEqual(t.egressHosts, CLAUDE_ACCOUNT_HOSTS.map((h) => `${h.host}:${h.port}`));
  // What the table cannot show is kept as written: the rules that name a principal type.
  assert.deepEqual(t.kept.map((r) => r.id), ["privileged-settings", "modify-governance"]);
  const row = (a: ActionKind) => t.rows.find((r) => r.action === a);
  assert.deepEqual(row("tool.web"), { action: "tool.web", effect: "deny", stated: true });
  assert.deepEqual(row("governance.role.grant"), { action: "governance.role.grant", effect: "deny", stated: false }, "no rule: the default decision");
});

test("ticking a row changes its own rule in its place, or adds one; nothing else moves", () => {
  const before = base();
  const after = withTable(before, tick(tick(tableOf(before), "tool.web", "allow"), "governance.role.grant", "require_approval"));
  assert.deepEqual(ruleOf(after, "tool.web"), [{ id: "web-tools", action: "tool.web", effect: "allow" }]);
  assert.equal(after.rules.findIndex((r) => r.id === "web-tools"), before.rules.findIndex((r) => r.id === "web-tools"));
  assert.deepEqual(after.rules.at(-1), { id: "governance-role-grant", action: "governance.role.grant", effect: "require_approval" });
  assert.deepEqual(after.rules.slice(0, before.rules.length).filter((r) => r.id !== "web-tools"), before.rules.filter((r) => r.id !== "web-tools"));
  assert.equal(checkConstitution(after).ok, true);
});

test("a row nobody ticked follows the default decision; one a rule states does not", () => {
  const t = { ...tableOf(base()), defaultDecision: "require_approval" as const };
  const after = withTable(base(), t);
  assert.equal(after.defaults.decision, "require_approval");
  const read = tableOf(after);
  assert.equal(read.rows.find((r) => r.action === "governance.role.grant")?.effect, "require_approval");
  assert.equal(read.rows.find((r) => r.action === "tool.web")?.effect, "deny");
});

test("the hosts the agent may reach are a list: added as allow rules, removed with their rule, never twice", () => {
  const t = tableOf(base());
  const after = withTable(base(), { ...t, egressHosts: [...t.egressHosts.filter((h) => h !== "claude.ai:443"), "registry.npmjs.org:443", "registry.npmjs.org:443"] });
  const egress = ruleOf(after, "network.egress");
  assert.deepEqual(egress.map((r) => r.resource), ["api.anthropic.com:443", "platform.claude.com:443", "registry.npmjs.org:443"]);
  assert.deepEqual(egress.at(-1), { id: "egress-registry-npmjs-org-443", action: "network.egress", resource: "registry.npmjs.org:443", effect: "allow" });
  assert.equal(checkConstitution(after).ok, true);
  assert.deepEqual([egressHostOf(" Registry.NPMJS.org:443 "), egressHostOf("example.com"), egressHostOf("example.com:0"), egressHostOf("example.com:70000"), egressHostOf("*.example.com:443"), egressHostOf("a b:443")], ["registry.npmjs.org:443", null, null, null, null, null]);
});

test("several rules for one action read as the strictest, and are written back as one", () => {
  const c: Constitution = { ...base(), rules: [...base().rules, { id: "web-tools-again", action: "tool.web", effect: "allow" }] };
  const t = tableOf(c);
  assert.equal(t.rows.find((r) => r.action === "tool.web")?.effect, "deny");
  assert.deepEqual(ruleOf(withTable(c, tick(t, "tool.web", "allow")), "tool.web"), [{ id: "web-tools", action: "tool.web", effect: "allow" }]);
});

test("the obligations are boxes, and a new rule's id never takes one already used", () => {
  const c: Constitution = { ...base(), rules: [...base().rules, { id: "governance-role-grant", action: "governance.role.grant", principalType: "human", effect: "allow" }] };
  const t = tableOf(c);
  const after = withTable(c, { ...tick(t, "governance.role.grant", "deny"), obligations: { auditDecisions: "non_allow", dailyReport: false, isolation: "optional" } });
  assert.deepEqual(after.obligations, { auditDecisions: "non_allow", dailyReport: false, isolation: "optional" });
  assert.deepEqual(ruleOf(after, "governance.role.grant").map((r) => r.id), ["governance-role-grant", "governance-role-grant-2"]);
  assert.equal(checkConstitution(after).ok, true);
});
