import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDIT_EVENTS, pickData, verifyChain, type AuditEvent } from "./audit.js";
import { findingsOf, FINDING_KINDS, type Finding } from "./auditor.js";
import { canonicalJson, digestOf } from "./canonical.js";
import { dailyReport, renderReport } from "./report.js";
import { chainOf, sha256, type Sketch } from "./testing.spec-helpers.js";

const decision = (action: string, resource: string, outcome: string, over: Partial<Sketch> = {}): Sketch => ({ type: "policy.decision", outcome, data: { action, resource, environment: "local", enforcement: "boundary", fingerprint: "f", scope: "GOVERNED_WORKSPACE" }, reasonCodes: ["RULE_MATCHED"], ...over });
const kinds = (findings: Finding[]): string[] => findings.map((f) => `${f.kind}/${f.status}`);
const read = (events: AuditEvent[], complete = true): Finding[] => findingsOf({ events, chain: verifyChain(events, sha256), complete });

test("the canonical form does not depend on the order keys were written in", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } }), '{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
  assert.equal(digestOf({ a: 1, b: 2 }, sha256), digestOf({ b: 2, a: 1 }, sha256));
  assert.notEqual(digestOf({ a: 1 }, sha256), digestOf({ a: 2 }, sha256));
});

test("an audit record carries only the metadata its type declares, bounded", () => {
  assert.deepEqual(pickData("policy.decision", { action: "repository.push", resource: "o/r", prompt: "do it", token: "ghp_x" }), { action: "repository.push", resource: "o/r" });
  assert.equal(String(pickData("authz.denied", { route: "x".repeat(2000) }).route).length, 500);
  const [event] = chainOf([{ type: "operator.signed_in", data: { sessionId: "s1", password: "hunter2" } }]);
  assert.deepEqual(event?.data, { sessionId: "s1" });
  for (const type of Object.keys(AUDIT_EVENTS)) assert.ok(AUDIT_EVENTS[type as keyof typeof AUDIT_EVENTS].summary.length > 0, type);
});

test("the chain holds as written, and a changed, removed or reordered record is found at the place it breaks", () => {
  const events = chainOf([{ type: "governance.initialized" }, decision("repository.write", "ws-1", "allow"), decision("repository.push", "o/r", "require_approval"), { type: "session.deleted" }]);
  const ok = verifyChain(events, sha256);
  assert.deepEqual(ok, { ok: true, count: 4, head: events[3]?.hash });
  assert.equal(events[0]?.previousHash, null);
  assert.equal(events[1]?.previousHash, events[0]?.hash);

  const edited = events.map((e) => (e.seq === 2 ? { ...e, outcome: "deny" } : e));
  assert.deepEqual(verifyChain(edited, sha256), { ok: false, count: 4, brokenAt: 2, eventId: "evt-2", problem: "HASH_MISMATCH" });
  const dataEdited = events.map((e) => (e.seq === 3 ? { ...e, data: { ...e.data, resource: "o/other" } } : e));
  assert.equal((verifyChain(dataEdited, sha256) as { brokenAt: number }).brokenAt, 3);
  const removed = events.filter((e) => e.seq !== 2);
  assert.deepEqual(verifyChain(removed, sha256), { ok: false, count: 3, brokenAt: 3, eventId: "evt-3", problem: "SEQUENCE_GAP" });
  const renumbered = removed.map((e, i) => ({ ...e, seq: i + 1 }));
  assert.equal((verifyChain(renumbered, sha256) as { problem: string }).problem, "LINK_MISMATCH");
  const swapped = [events[0], events[2], events[1], events[3]] as AuditEvent[];
  assert.equal(verifyChain(swapped, sha256).ok, false);
  // Rewriting a record AND its own hash still breaks the link the next record holds.
  const forged = events.map((e) => (e.seq === 2 ? chainOf([{ type: "governance.initialized" }, decision("repository.write", "ws-1", "deny")])[1] : e)) as AuditEvent[];
  assert.deepEqual([verifyChain(forged, sha256).ok, (verifyChain(forged, sha256) as { brokenAt: number }).brokenAt], [false, 3]);
  // A check can go on from a head already held.
  assert.deepEqual(verifyChain(events.slice(2), sha256, { seq: 2, hash: events[1]?.hash ?? null }), { ok: true, count: 2, head: events[3]?.hash });
  assert.deepEqual(verifyChain([], sha256), { ok: true, count: 0, head: null });
});

test("every finding names the records it stands on, and the same records give the same findings", () => {
  const events = chainOf([
    decision("network.egress", "evil.example:443", "deny"),
    decision("network.egress", "evil.example:443", "deny"),
    decision("network.egress", "evil.example:443", "deny"),
    decision("repository.write", "ws-1", "allow"),
    decision("credential.read_raw", "github", "deny"),
    decision("governance.policy.modify", "org-1", "deny"),
    { type: "boundary.violation", data: { kind: "agent_outside_gateway", route: "PATCH /api/settings", target: "settings" } },
    { type: "boundary.violation", data: { kind: "cross_workspace", route: "POST /api/agent/requests", target: "ws-2" } },
    { type: "approval.consume.refused", principalType: "human", principalId: "op-1", agentId: null, data: { approvalId: "apr-1", fingerprint: "f", cause: "APPROVAL_CONSUMED" } },
    { type: "settings.privileged.refused", principalType: "anonymous", principalId: "anonymous", agentId: null, workspaceId: null, data: { setting: "githubForClaude", cause: "OPERATOR_REQUIRED" } },
    { type: "authz.denied", principalType: "human", principalId: "op-2", agentId: null, workspaceId: null, data: { permission: "constitution.publish", route: "POST /api/governance/revisions/r/publish", cause: "PERMISSION" } },
  ]);
  const findings = read(events);
  assert.deepEqual(read(events), findings);
  assert.deepEqual([...new Set(kinds(findings))].sort(), [
    "AGENT_PRIVILEGE_ESCALATION/CONFIRMED",
    "AGENT_PRIVILEGE_ESCALATION/SUSPECTED",
    "APPROVAL_REPLAY/CONFIRMED",
    "CREDENTIAL_ACCESS_ATTEMPT/CONFIRMED",
    "CROSS_WORKSPACE_ACCESS/CONFIRMED",
    "POLICY_DENIED_ACTION/CONFIRMED",
    "REPEATED_DENIED_ACCESS/CONFIRMED",
    "UNAUTHORIZED_POLICY_CHANGE/CONFIRMED",
  ]);
  const ids = new Set(events.map((e) => e.eventId));
  for (const f of findings) {
    assert.ok(f.evidenceIds.length > 0, f.id);
    assert.ok(f.evidenceIds.every((id) => ids.has(id)), f.id);
    assert.equal(f.count, f.evidenceIds.length, f.id);
  }
  const repeated = findings.find((f) => f.kind === "REPEATED_DENIED_ACCESS");
  assert.deepEqual([repeated?.evidenceIds, repeated?.id], [["evt-1", "evt-2", "evt-3"], "REPEATED_DENIED_ACCESS:evt-1"]);
  // An allowed action is no finding, and severity orders the list.
  assert.equal(findings.some((f) => f.evidenceIds.includes("evt-4")), false);
  assert.equal(findings[0]?.severity, "critical");
  assert.equal(findings.at(-1)?.severity, "low");
  // Two denials are not yet "repeated".
  assert.equal(read(chainOf([decision("tool.web", "ws-1", "deny"), decision("tool.web", "ws-1", "deny")])).some((f) => f.kind === "REPEATED_DENIED_ACCESS"), false);
});

test("a publication with no recorded approval of its content is suspected, or inconclusive when the records do not reach back", () => {
  const approved: Sketch = { type: "constitution.approved", principalType: "human", principalId: "op-2", agentId: null, workspaceId: null, data: { revisionId: "rev-2", digest: "d2", risk: "low" } };
  const published = (digest: string): Sketch => ({ type: "constitution.published", principalType: "human", principalId: "op-1", agentId: null, workspaceId: null, data: { revisionId: "rev-2", revision: 2, digest, replaces: "rev-1", risk: "low" } });
  assert.deepEqual(read(chainOf([approved, published("d2")])), []);
  assert.deepEqual(kinds(read(chainOf([approved, published("d-other")]))), ["UNAUTHORIZED_POLICY_CHANGE/SUSPECTED"]);
  assert.deepEqual(kinds(read(chainOf([published("d2")]))), ["UNAUTHORIZED_POLICY_CHANGE/SUSPECTED"]);
  assert.deepEqual(kinds(read(chainOf([published("d2")]), false)), ["UNAUTHORIZED_POLICY_CHANGE/INCONCLUSIVE"]);
});

test("a chain that does not hold is the first finding, naming the record where it breaks", () => {
  const events = chainOf([{ type: "governance.initialized" }, decision("repository.write", "ws-1", "allow"), { type: "session.deleted" }]);
  const tampered = events.map((e) => (e.seq === 2 ? { ...e, outcome: "deny" } : e));
  const findings = findingsOf({ events: tampered, chain: verifyChain(tampered, sha256), complete: true });
  assert.deepEqual([findings[0]?.kind, findings[0]?.status, findings[0]?.evidenceIds, findings[0]?.id], ["AUDIT_INTEGRITY_FAILURE", "CONFIRMED", ["evt-2"], "AUDIT_INTEGRITY_FAILURE:evt-2"]);
  assert.equal(FINDING_KINDS.length, 8);
});

test("the daily report counts the day's records and cites them, and says when the chain does not hold", () => {
  const events = chainOf([
    { type: "run.started", data: { scope: "GOVERNED_WORKSPACE", runtime: "claude-code", runtimeVersion: "2.1.328", mode: "autonomous", isolation: "attested" } },
    decision("repository.write", "ws-1", "allow"),
    decision("network.egress", "evil.example:443", "deny"),
    decision("repository.push", "o/r", "require_approval"),
    { type: "approval.requested", data: { approvalId: "apr-1", action: "repository.push", fingerprint: "abcdef0123456789ff", expiresAt: "2026-11-20T11:00:00.000Z" } },
    { type: "approval.granted", principalType: "human", principalId: "op-1", agentId: null, data: { approvalId: "apr-1", fingerprint: "abcdef0123456789ff" } },
    { type: "approval.consumed", principalType: "system", principalId: "orbit-web", agentId: null, data: { approvalId: "apr-1", fingerprint: "abcdef0123456789ff" } },
    { type: "protected.completed", principalType: "system", principalId: "orbit-web", agentId: null, data: { approvalId: "apr-1", action: "repository.push", fingerprint: "abcdef0123456789ff" } },
    { type: "run.finished", outcome: "completed", data: { status: "idle", exitCode: 0 } },
  ]);
  const chain = verifyChain(events, sha256);
  const findings = findingsOf({ events, chain, complete: true });
  const input = { day: "2026-11-20", organizationId: "org-1", generatedAt: "2026-11-21T00:00:05.000Z", events, chain, findings, resolved: [] };
  const report = dailyReport(input);
  assert.deepEqual(dailyReport(input), report);
  assert.deepEqual(report.authorization, { total: 3, byVerdict: { allow: 1, deny: 1, require_approval: 1 }, byAction: { "repository.write": 1, "network.egress": 1, "repository.push": 1 }, evidenceIds: ["evt-2", "evt-3", "evt-4"] });
  assert.deepEqual(report.agents.map((a) => [a.agentId, a.runsStarted, a.runsFinished, a.decisions]), [["agt-1", 1, 1, { allow: 1, deny: 1, require_approval: 1 }]]);
  assert.deepEqual(report.denied.map((d) => [d.eventId, d.action, d.resource, d.enforcement]), [["evt-3", "network.egress", "evil.example:443", "boundary"]]);
  assert.deepEqual(report.approvals, [{ approvalId: "apr-1", action: "repository.push", fingerprint: "abcdef0123456789ff", state: "protected.completed", evidenceIds: ["evt-5", "evt-6", "evt-7", "evt-8"] }]);
  assert.deepEqual(report.unresolved, findings.map((f) => f.id));
  assert.deepEqual(dailyReport({ ...input, resolved: findings.map((f) => f.id) }).unresolved, []);
  assert.deepEqual([report.integrity.ok, report.integrity.head], [true, events.at(-1)?.hash]);
  const text = renderReport(report);
  for (const needle of ["# Governance audit report — 2026-11-20", "The chain holds: 9 record(s)", "network.egress on `evil.example:443`", "[evt-3]", "`apr-1` · repository.push · `abcdef0123456789`", "**POLICY_DENIED_ACTION** · CONFIRMED"]) assert.ok(text.includes(needle), needle);

  const broken = events.map((e) => (e.seq === 3 ? { ...e, outcome: "allow" } : e));
  const bad = dailyReport({ ...input, events: broken, chain: verifyChain(broken, sha256) });
  assert.deepEqual([bad.integrity.ok, bad.integrity.brokenAt, bad.integrity.problem], [false, 3, "HASH_MISMATCH"]);
  assert.ok(renderReport(bad).includes("**The chain does not hold**: record 3"));
  assert.ok(renderReport(dailyReport({ ...input, events: [], findings: [] })).includes("No agent did anything that was recorded."));
});
