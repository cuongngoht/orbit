// THE ACCOUNT'S POLICY THROUGH ITS LIFECYCLE, with one owner. Every account starts with its deployment's default policy
// in effect. Its owner drafts a revision, edits it on the content read, validates it and publishes it -- confirming
// exactly that content, against exactly the revision in effect it was compared with, at the risk the server works out
// from what the change does. Nobody else is asked, and the confirmation is never recorded as an approval. A published
// revision never changes (the database refuses it too); a rollback is a copy published anew. An override narrows one
// chat and nothing else; a simulation decides nothing; a deleted chat keeps its record; findings and the daily report
// stand on audit records.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import type { AuditPage, ChainVerification, FindingList, GovernanceOverview, PolicyOverview, ReportView, ResourceGovernanceList, ResourceGovernanceView, RevisionView, SessionDetail, SessionSummary, SimulateResult } from "@orbit-web/contracts";
import type { Constitution, Rule } from "@orbit-web/governance-core";
import type { RunBinding } from "../../src/infra/governance/stores.js";
import { contextOf } from "../../src/modules/auth/principal.js";
import { AuditService } from "../../src/modules/governance/audit.service.js";
import { PolicyService } from "../../src/modules/governance/policy.service.js";
import { RevisionsService } from "../../src/modules/governance/revisions.service.js";
import { eventually, startHarness, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";

const code = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

function ok<T>(r: Reply): T {
  assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body as T;
}

const rev = (r: Reply): RevisionView => ok<RevisionView>(r);

const auditOf = async (b: Browser, query = "limit=200"): Promise<AuditPage["events"]> => ok<AuditPage>(await b.get(`/api/governance/audit?${query}`)).events;

// A revision drafted from the policy in effect, edited, validated -- and published with the owner's confirmation of
// what was read: its digest, the revision in effect it was compared with, and the risk the server worked out.
async function publish(b: Browser, edit: (c: Constitution) => Constitution): Promise<RevisionView> {
  const draft = rev(await b.send("POST", "/api/governance/revisions", {}));
  rev(await b.send("PUT", `/api/governance/revisions/${draft.id}`, { document: edit(draft.document as Constitution), expectedDigest: draft.digest }));
  const read = rev(await b.send("POST", `/api/governance/revisions/${draft.id}/validate`));
  return rev(await b.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: read.digest, base: read.base, acknowledgedRisk: read.impact?.risk ?? null }));
}

const EGRESS_GITHUB: Rule = { id: "egress-github", action: "network.egress", resource: "github.com:443", effect: "allow" };

describe("the account's policy, through its lifecycle -- one owner, nobody else asked", () => {
  let h: Harness;
  let owner: string;
  let first: RevisionView;
  let second: RevisionView;
  let third: RevisionView;
  let fourth: RevisionView;
  let current: RevisionView;

  before(async () => {
    h = await startHarness();
    owner = `owner:${h.accountId}`;
  });
  after(() => h.close());

  test("an account starts with its deployment's default policy in effect: revision 1, published by Orbit Web when the account was made", async () => {
    const overview = ok<PolicyOverview>(await h.get("/api/governance/policy"));
    first = overview.effective as RevisionView;
    assert.deepEqual([first.revision, first.state, first.source, first.createdBy, first.publishedBy, first.confirmedBy], [1, "PUBLISHED", "default", "system:provisioning", "system:provisioning", null]);
    const doc = first.document as Constitution;
    assert.deepEqual([doc.apiVersion, doc.kind, doc.metadata.accountId], ["orbit.governance/v2", "AccountPolicy", h.accountId]);
    assert.equal(doc.defaults.decision, "deny");
    assert.equal(doc.obligations.isolation, "optional", "one container can never prove isolation: requiring it by default would refuse every run");
    assert.deepEqual(first.history.map((s) => s.what), ["provisioned"]);
    assert.deepEqual(overview.revisions.map((r) => r.id), [first.id]);
    const oldest = (await auditOf(h)).reverse();
    assert.deepEqual(oldest.slice(0, 2).map((e) => [e.eventType, e.principalType, e.principalId]), [
      ["account.created", "system", "provisioning"],
      ["policy.provisioned", "system", "provisioning"],
    ]);
    assert.ok(oldest.some((e) => e.eventType === "auth.signed_in" && e.principalType === "human"));
    const at = ok<GovernanceOverview>(await h.get("/api/governance/overview"));
    assert.deepEqual([at.account.id, at.account.email, at.deployment, at.effective?.id, at.effective?.revision, at.effective?.source, at.counts.draftRevisions], [h.accountId, "octo@example.com", "single", first.id, 1, "default", 0]);
    assert.equal(at.isolation.state, "not_proven", "an account id is not isolation: one container proves none");
  });

  test("the owner drafts, edits on the content read, validates and publishes a narrowing: low risk, confirmed by the owner alone", async () => {
    const draft = rev(await h.send("POST", "/api/governance/revisions", {}));
    assert.deepEqual([draft.state, draft.source, draft.basedOn, draft.errors, draft.impact?.risk, draft.base, draft.revision], ["DRAFT", "copy", first.id, [], "low", first.id, null]);
    const doc = draft.document as Constitution;
    const tighter: Constitution = { ...doc, metadata: { ...doc.metadata, name: "tighter" }, rules: doc.rules.map((r) => (r.id === "web-tools" ? { ...r, effect: "deny" as const } : r)) };
    const stale = await h.send("PUT", `/api/governance/revisions/${draft.id}`, { document: tighter, expectedDigest: "0".repeat(64) });
    assert.deepEqual([stale.status, code(stale)], [409, "stale_revision"]);
    const saved = rev(await h.send("PUT", `/api/governance/revisions/${draft.id}`, { document: tighter, expectedDigest: draft.digest }));
    assert.deepEqual([saved.name, saved.impact?.risk, saved.impact?.widened.length], ["tighter", "low", 0]);
    assert.ok(saved.impact?.narrowed.some((c) => c.action === "tool.web"));
    const early = await h.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: saved.digest, base: first.id, acknowledgedRisk: null });
    assert.deepEqual([early.status, code(early)], [409, "wrong_state"], "only a validated revision is published");
    const read = rev(await h.send("POST", `/api/governance/revisions/${draft.id}/validate`));
    assert.equal(read.state, "VALIDATED");
    second = rev(await h.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: read.digest, base: read.base, acknowledgedRisk: null }));
    assert.deepEqual([second.state, second.revision, second.risk, second.confirmedBy, second.publishedBy], ["PUBLISHED", 2, "low", owner, owner]);
    assert.deepEqual(second.history.map((s) => s.what), ["created", "edited", "validated", "confirmed", "published"]);
    assert.equal(rev(await h.get(`/api/governance/revisions/${first.id}`)).state, "SUPERSEDED");
    const types = (await auditOf(h)).map((e) => e.eventType);
    assert.equal(types.some((t) => t.startsWith("approval.")), false, "a confirmation by the one owner is never recorded as an approval");
    const findings = ok<FindingList>(await h.get("/api/governance/findings")).findings;
    assert.equal(findings.some((f) => f.kind === "UNAUTHORIZED_POLICY_CHANGE"), false, "both publications stand on what they need: the provisioning, and the owner's confirmation");
  });

  test("a change that loosens a sensitive action is high risk -- worked out from what it does -- and the owner confirms it at that risk", async () => {
    const draft = rev(await h.send("POST", "/api/governance/revisions", {}));
    const doc = draft.document as Constitution;
    const saved = rev(await h.send("PUT", `/api/governance/revisions/${draft.id}`, { document: { ...doc, rules: [...doc.rules, EGRESS_GITHUB] }, expectedDigest: draft.digest }));
    assert.equal(saved.impact?.risk, "high");
    assert.deepEqual(saved.impact?.reasons, ["It loosens network.egress, a sensitive action."]);
    const read = rev(await h.send("POST", `/api/governance/revisions/${draft.id}/validate`));
    for (const acknowledgedRisk of [null, "low", "elevated"]) {
      const r = await h.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: read.digest, base: read.base, acknowledgedRisk });
      assert.deepEqual([r.status, code(r)], [409, "risk_not_acknowledged"], `acknowledged ${String(acknowledgedRisk)}`);
    }
    const other = await h.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: second.digest, base: read.base, acknowledgedRisk: "high" });
    assert.deepEqual([other.status, code(other)], [409, "stale_revision"], "a confirmation of other content is no confirmation of this one");
    third = rev(await h.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: read.digest, base: read.base, acknowledgedRisk: "high" }));
    assert.deepEqual([third.revision, third.risk, third.confirmedBy], [3, "high", owner]);
    const events = await auditOf(h, "type=policy.confirmed,policy.published&limit=4");
    assert.deepEqual(events.map((e) => [e.eventType, e.data.revisionId, e.principalType, e.principalId]), [
      ["policy.published", third.id, "human", owner],
      ["policy.confirmed", third.id, "human", owner],
      ["policy.published", second.id, "human", owner],
      ["policy.confirmed", second.id, "human", owner],
    ]);
    assert.deepEqual([events[1]?.data.risk, events[1]?.data.base, events[1]?.data.digest], ["high", second.id, read.digest]);
  });

  test("a revision compared with a policy no longer in effect is never published -- the base moved -- and a discarded draft stays discarded", async () => {
    const late = rev(await h.send("POST", "/api/governance/revisions", {}));
    const lateRead = rev(await h.send("POST", `/api/governance/revisions/${late.id}/validate`));
    assert.equal(lateRead.base, third.id);
    fourth = await publish(h, (c) => ({ ...c, metadata: { ...c.metadata, name: "meanwhile" } }));
    assert.equal(fourth.revision, 4);
    const moved = await h.send("POST", `/api/governance/revisions/${late.id}/publish`, { digest: lateRead.digest, base: lateRead.base, acknowledgedRisk: null });
    assert.deepEqual([moved.status, code(moved)], [409, "stale_base"]);
    assert.equal(rev(await h.get(`/api/governance/revisions/${late.id}`)).base, fourth.id, "read again, it is compared with the revision in effect now");
    const discarded = rev(await h.send("POST", `/api/governance/revisions/${late.id}/discard`, { digest: lateRead.digest }));
    assert.equal(discarded.state, "DISCARDED");
    assert.equal(code(await h.send("POST", `/api/governance/revisions/${late.id}/publish`, { digest: lateRead.digest, base: fourth.id, acknowledgedRisk: null })), "wrong_state");
    assert.equal(code(await h.send("PUT", `/api/governance/revisions/${late.id}`, { document: lateRead.document, expectedDigest: lateRead.digest })), "wrong_state");
  });

  test("a rollback is a copy of an earlier revision, taken through the lifecycle and published anew", async () => {
    const copy = rev(await h.send("POST", "/api/governance/revisions", { from: second.id }));
    assert.deepEqual([copy.source, copy.basedOn, copy.digest, copy.impact?.risk], ["copy", second.id, second.digest, "low"]);
    const read = rev(await h.send("POST", `/api/governance/revisions/${copy.id}/validate`));
    current = rev(await h.send("POST", `/api/governance/revisions/${copy.id}/publish`, { digest: read.digest, base: read.base, acknowledgedRisk: null }));
    assert.deepEqual([current.revision, current.digest], [5, second.digest]);
    const published = await auditOf(h, "type=policy.published,policy.provisioned&limit=10");
    assert.deepEqual(published.map((e) => [e.eventType, e.data.revision, e.data.replaces ?? null]), [
      ["policy.published", 5, fourth.id],
      ["policy.published", 4, third.id],
      ["policy.published", 3, second.id],
      ["policy.published", 2, first.id],
      ["policy.provisioned", 1, null],
    ]);
    const states = ok<PolicyOverview>(await h.get("/api/governance/policy")).revisions.filter((r) => r.revision !== null).map((r) => [r.revision, r.state]);
    assert.deepEqual(
      states.sort((a, b) => Number(a[0]) - Number(b[0])),
      [
        [1, "SUPERSEDED"],
        [2, "SUPERSEDED"],
        [3, "SUPERSEDED"],
        [4, "SUPERSEDED"],
        [5, "PUBLISHED"],
      ],
    );
  });

  test("a draft that names another account, or is not a valid policy, is never validated", async () => {
    const draft = rev(await h.send("POST", "/api/governance/revisions", {}));
    const doc = draft.document as Constitution;
    const foreign = rev(await h.send("PUT", `/api/governance/revisions/${draft.id}`, { document: { ...doc, metadata: { ...doc.metadata, accountId: randomUUID() } }, expectedDigest: draft.digest }));
    assert.match(foreign.errors.join(" "), /this account's id/);
    const refused = await h.send("POST", `/api/governance/revisions/${draft.id}/validate`);
    assert.deepEqual([refused.status, code(refused)], [422, "invalid_policy"]);
    const loose = rev(await h.send("PUT", `/api/governance/revisions/${draft.id}`, { document: { ...doc, defaults: { decision: "allow" } }, expectedDigest: foreign.digest }));
    assert.ok(loose.errors.some((e) => e.includes("defaults.decision")), loose.errors.join("; "));
    const written = rev(await h.send("POST", "/api/governance/revisions", { document: { apiVersion: "orbit.governance/v2", kind: "AccountPolicy" } }));
    assert.equal(written.source, "owner");
    assert.ok(written.errors.length > 0);
    assert.equal((await h.send("POST", "/api/governance/revisions", { document: doc, from: first.id })).status, 400, "a document or a copy, not both");
    assert.equal((await h.send("POST", "/api/governance/revisions", { accountId: randomUUID() })).status, 400, "no request names an account");
  });

  test("a published revision never changes -- through the API, and not even in the database behind it", async () => {
    assert.equal(code(await h.send("PUT", `/api/governance/revisions/${current.id}`, { document: {}, expectedDigest: current.digest })), "wrong_state");
    assert.equal(code(await h.send("POST", `/api/governance/revisions/${current.id}/validate`)), "wrong_state");
    assert.equal(code(await h.send("POST", `/api/governance/revisions/${current.id}/discard`, { digest: current.digest })), "wrong_state");
    await assert.rejects(h.sql("UPDATE governance.policy_revisions SET document = '{}' WHERE id = $1", [current.id]), /a published revision never changes/);
    await assert.rejects(h.sql("UPDATE governance.policy_revisions SET state = 'DRAFT' WHERE id = $1", [current.id]), /a published revision never changes/);
    await assert.rejects(h.sql("UPDATE governance.policy_revisions SET confirmed_by = 'somebody' WHERE id = $1", [second.id]), /a published revision never changes/);
    await assert.rejects(h.sql("DELETE FROM governance.policy_revisions WHERE id = $1", [first.id]), /a published revision is never removed/);
    await assert.rejects(h.sql("UPDATE governance.audit_events SET outcome = 'x' WHERE seq = 1"), /an audit record is never changed/);
    await assert.rejects(h.sql("DELETE FROM governance.audit_events WHERE seq = 1"), /an audit record is never removed/);
    await assert.rejects(h.sql("TRUNCATE governance.audit_events"), /an audit record is never removed/);
    assert.equal(ok<ChainVerification>(await h.send("POST", "/api/governance/audit/verify")).ok, true);
  });

  test("a simulation asks a policy and decides nothing", async () => {
    const head = ok<AuditPage>(await h.get("/api/governance/audit?limit=1")).head?.seq;
    const ask = (action: string, resource: string, principalType = "agent", revisionId?: string) =>
      h.send("POST", "/api/governance/simulate", { request: { principalType, action, resource, environment: "local", workspaceId: "ws-1", researchWorkspaceId: null }, ...(revisionId !== undefined ? { revisionId } : {}) });
    const push = ok<SimulateResult>(await ask("repository.push", "github:acme/app"));
    assert.deepEqual([push.revisionId, push.revision, push.evaluation.verdict, push.evaluation.enforcement], [current.id, 5, "require_approval", "boundary"]);
    assert.equal(ok<SimulateResult>(await ask("governance.policy.modify", h.accountId as string)).evaluation.verdict, "deny");
    assert.equal(ok<SimulateResult>(await ask("credential.read_raw", "github", "human")).evaluation.verdict, "deny");
    assert.deepEqual(ok<SimulateResult>(await ask("teleport.anything", "x")).evaluation.reasonCodes, ["UNKNOWN_ACTION"]);
    assert.deepEqual(ok<SimulateResult>(await ask("repository.write", "ws-1")), ok<SimulateResult>(await ask("repository.write", "ws-1")), "the same request, the same answer");
    assert.equal(ok<SimulateResult>(await ask("tool.web", "ws-1", "agent", third.id)).evaluation.verdict, "deny", "an earlier revision can be asked too");
    assert.equal(ok<SimulateResult>(await ask("network.egress", "github.com:443", "agent", third.id)).evaluation.verdict, "allow");
    assert.equal(ok<SimulateResult>(await ask("network.egress", "github.com:443")).evaluation.verdict, "deny", "the rollback took it away again");
    assert.equal((await h.send("POST", "/api/governance/simulate", { request: { principalType: "agent", action: "repository.write", resource: "x", environment: "local", accountId: randomUUID() } })).status, 400, "a simulation never names an account");
    assert.equal(ok<AuditPage>(await h.get("/api/governance/audit?limit=1")).head?.seq, head, "nothing was recorded");
  });
});

describe("overrides, the account's chats as governance sees them, findings and the daily report", () => {
  let h: Harness;
  let chat: SessionSummary;
  let other: SessionSummary;

  const newChat = async (): Promise<SessionSummary> => {
    const made = ok<SessionSummary>(await h.send("POST", "/api/sessions", { repository: null, model: "haiku" }));
    await eventually(async () => ok<SessionDetail>(await h.get(`/api/sessions/${made.id}`)).status, (s) => s === "ready");
    return made;
  };
  const simulate = async (workspaceId: string, action: string) =>
    ok<SimulateResult>(await h.send("POST", "/api/governance/simulate", { request: { principalType: "agent", action, resource: workspaceId, environment: "local", workspaceId, researchWorkspaceId: null } })).evaluation;

  before(async () => {
    h = await startHarness();
    chat = await newChat();
    other = await newChat();
  });
  after(() => h.close());

  test("each chat is the account's own resource, listed with what governs it", async () => {
    const list = ok<ResourceGovernanceList>(await h.get("/api/governance/workspaces"));
    assert.deepEqual(new Set(list.resources.map((r) => r.id)), new Set([chat.id, other.id]));
    assert.ok(list.resources.every((r) => r.kind === "workspace" && r.deletedAt === null && !r.overridden && r.runningRuns === 0 && r.pendingApprovals === 0));
    const view = ok<ResourceGovernanceView>(await h.get(`/api/governance/workspaces/${chat.id}`));
    const effective = ok<PolicyOverview>(await h.get("/api/governance/policy")).effective as RevisionView;
    assert.deepEqual(view.policy, { revisionId: effective.id, revision: 1, digest: effective.digest });
    assert.equal(view.override, null);
    assert.equal((await h.get("/api/governance/workspaces/sess-nobody-has-this")).status, 404);
    assert.equal(ok<GovernanceOverview>(await h.get("/api/governance/overview")).counts.workspaces, 2);
  });

  test("an override narrows the account's policy for its own chat only, and an allow in it changes nothing", async () => {
    const set = await h.send("PUT", `/api/governance/workspaces/${chat.id}/override`, { name: "read-only", rules: [{ id: "no-write", action: "repository.write", effect: "deny" }, { id: "push-free", action: "repository.push", effect: "allow" }] });
    const view = ok<ResourceGovernanceView>(set);
    // Said beside it: denying repository.write is held by the agent runtime's own configuration (defence in depth), and
    // an allow in an override changes nothing.
    assert.deepEqual(view.override?.warnings.map((w) => w.code), ["RUNTIME_ONLY", "OVERLAY_CANNOT_WIDEN"]);
    assert.deepEqual([view.overridden, view.override?.override.metadata.accountId, view.override?.override.metadata.level, view.override?.override.metadata.target, view.override?.setBy], [true, h.accountId, "workspace", chat.id, `owner:${h.accountId}`]);
    const narrowed = await simulate(chat.id, "repository.write");
    assert.deepEqual([narrowed.verdict, narrowed.reasonCodes], ["deny", ["RULE_MATCHED", "OVERLAY_NARROWED"]]);
    assert.equal((await simulate(other.id, "repository.write")).verdict, "allow", "another chat is not narrowed");
    assert.equal((await simulate(chat.id, "repository.push")).verdict, "require_approval", "the override's allow widened nothing");
    assert.equal(code(await h.send("PUT", `/api/governance/workspaces/${chat.id}/override`, { rules: [{ id: "x", action: "teleport", effect: "deny" }] })), "invalid_override");
    assert.equal((await h.send("PUT", `/api/governance/workspaces/${chat.id}/override`, { rules: [], metadata: { accountId: randomUUID(), level: "workspace", target: chat.id } })).status, 400, "the document is the API's to make: no body names its account or its target");
    assert.equal((await h.send("PUT", "/api/governance/workspaces/sess-nobody-has-this/override", { rules: [] })).status, 404);
    assert.equal(ok<ResourceGovernanceList>(await h.get("/api/governance/workspaces")).resources.find((r) => r.id === chat.id)?.overridden, true);
    assert.equal((await h.send("DELETE", `/api/governance/workspaces/${other.id}/override`)).status, 404, "nothing to remove");
    assert.equal((await h.send("DELETE", `/api/governance/workspaces/${chat.id}/override`)).status, 204);
    assert.equal((await simulate(chat.id, "repository.write")).verdict, "allow");
    const recorded = (await auditOf(h, "type=override.set,override.removed")).map((e) => [e.eventType, e.workspaceId, e.data.kind, e.principalType]);
    assert.deepEqual(recorded, [
      ["override.removed", chat.id, "workspace", "human"],
      ["override.set", chat.id, "workspace", "human"],
    ]);
  });

  test("deleting a chat deletes the chat -- and nothing of governance's record", async () => {
    ok<ResourceGovernanceView>(await h.send("PUT", `/api/governance/workspaces/${chat.id}/override`, { rules: [{ id: "no-push", action: "repository.push", effect: "deny" }] }));
    const kept = (await auditOf(h)).map((e) => e.eventId);
    assert.equal((await h.send("DELETE", `/api/sessions/${chat.id}`)).status, 204);
    assert.equal((await h.get(`/api/sessions/${chat.id}`)).status, 404);
    const now = await auditOf(h);
    for (const id of kept) assert.ok(now.some((e) => e.eventId === id), `${id} kept`);
    const deleted = now.find((e) => e.eventType === "resource.deleted");
    assert.deepEqual([deleted?.workspaceId, deleted?.data.kind, deleted?.principalType], [chat.id, "workspace", "human"]);
    const gone = ok<ResourceGovernanceList>(await h.get("/api/governance/workspaces")).resources.find((r) => r.id === chat.id);
    assert.ok(gone !== undefined && gone.deletedAt !== null, "listed, as deleted");
    const view = ok<ResourceGovernanceView>(await h.get(`/api/governance/workspaces/${chat.id}`));
    assert.ok(view.override !== null, "its override stays on record");
    assert.ok(view.activity.some((e) => e.eventType === "override.set"));
    assert.equal(code(await h.send("PUT", `/api/governance/workspaces/${chat.id}/override`, { rules: [] })), "resource_deleted");
    assert.equal(ok<GovernanceOverview>(await h.get("/api/governance/overview")).counts.workspaces, 1);
    assert.equal(ok<ChainVerification>(await h.send("POST", "/api/governance/audit/verify")).ok, true);
  });

  test("findings stand on audit records, and the daily report cites them", async () => {
    // What a misled run's agent would leave on the record: a reach outside its gateway, a credential asked for, and a
    // write of the account's policy -- each refused, and recorded as the agent's.
    const at = new Date().toISOString();
    const effective = ok<PolicyOverview>(await h.get("/api/governance/policy")).effective as RevisionView;
    const binding: RunBinding = { runId: `run-${randomUUID()}`, accountId: h.accountId as string, kind: "chat", resourceKind: "workspace", resourceId: other.id, researchSessionId: null, agentId: "claude-code", policyRevision: effective.id, startedBy: `owner:${h.accountId}`, workBranch: null, createdAt: at, expiresAt: at, endedAt: at };
    const agent = contextOf({ kind: "agent", binding });
    await h.app.get(AuditService).record(agent, { type: "boundary.violation", outcome: "refused", data: { kind: "agent_outside_gateway", route: "PATCH /api/settings", target: "/api/settings" } });
    assert.equal((await h.app.get(PolicyService).decide(agent, { action: "credential.read_raw", resource: "github", scope: "ACCOUNT_WORKSPACE" })).verdict, "deny");
    await assert.rejects(h.app.get(RevisionsService).create(agent, {}), { code: "owner_required" });

    const list = ok<FindingList>(await h.get("/api/governance/findings"));
    const kinds = list.findings.map((f) => `${f.kind}/${f.status}`);
    for (const k of ["AGENT_PRIVILEGE_ESCALATION/CONFIRMED", "CREDENTIAL_ACCESS_ATTEMPT/CONFIRMED", "UNAUTHORIZED_POLICY_CHANGE/CONFIRMED"]) assert.ok(kinds.includes(k), `${k} in ${kinds.join(",")}`);
    assert.equal(list.chain.ok, true);
    const ids = new Set((await auditOf(h)).map((e) => e.eventId));
    for (const f of list.findings) assert.ok(f.evidenceIds.length > 0 && f.evidenceIds.every((id) => ids.has(id)), f.id);

    const day = at.slice(0, 10);
    const report = ok<ReportView>(await h.send("POST", "/api/governance/reports", { day }));
    assert.deepEqual([report.day, report.report.accountId, report.report.integrity.ok], [day, h.accountId, true]);
    assert.ok(report.report.findings.length >= 3);
    assert.match(report.markdown, new RegExp(`# Governance audit report — ${day}`));
    assert.match(report.markdown, new RegExp(`Account \`${h.accountId}\``));
    for (const f of report.report.findings) for (const id of f.evidenceIds) assert.ok(ids.has(id), id);

    const escalation = list.findings.find((f) => f.kind === "AGENT_PRIVILEGE_ESCALATION") as FindingList["findings"][number];
    const resolved = await h.send("POST", `/api/governance/findings/${encodeURIComponent(escalation.id)}/resolve`, { resolution: "accepted", note: "a test of the auditor" });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    const next = ok<ReportView>(await h.send("POST", "/api/governance/reports", { day }));
    assert.equal(next.report.unresolved.includes(escalation.id), false);
    const md = await h.get(`/api/governance/reports/${next.id}/markdown`);
    assert.match(String(md.headers.get("content-type")), /text\/markdown/);
    assert.ok(ok<GovernanceOverview>(await h.get("/api/governance/overview")).counts.openFindings >= 2);
    const recorded = (await auditOf(h, "type=finding.status.changed,report.generated")).map((e) => [e.eventType, e.principalType]);
    assert.deepEqual(recorded, [
      ["report.generated", "human"],
      ["finding.status.changed", "human"],
      ["report.generated", "human"],
    ]);
  });
});
