// THE COMPANY CONSTITUTION through its lifecycle: drafted, validated, approved -- by somebody independent when it is
// high-risk -- and published exactly as approved; a published revision never changes; a rollback is a new
// publication. Overlays only narrow; a simulation decides nothing; a governed workspace keeps its record when its chat
// is deleted; findings and the daily report stand on audit records.
import assert from "node:assert/strict";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, describe, test } from "node:test";
import type {
  AgentView,
  AuditPage,
  ChainVerification,
  ConstitutionOverview,
  FindingList,
  GovernanceOverview,
  OperatorView,
  ReportView,
  RevisionView,
  SessionDetail,
  SessionSummary,
  SimulateResult,
  WorkspaceList,
} from "@orbit-web/contracts";
import type { Constitution } from "@orbit-web/governance-core";
import { eventually, startHarness, type Harness, type OperatorClient, type Reply } from "../../src/testing/harness.js";

const code = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
const rev = (r: Reply): RevisionView => {
  assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body as RevisionView;
};

async function throughLifecycle(author: OperatorClient, approver: OperatorClient, publisher: OperatorClient, body: object): Promise<RevisionView> {
  const draft = rev(await author.send("POST", "/api/governance/revisions", body));
  rev(await author.send("POST", `/api/governance/revisions/${draft.id}/validate`));
  const pending = rev(await author.send("POST", `/api/governance/revisions/${draft.id}/request-approval`));
  rev(await approver.send("POST", `/api/governance/revisions/${draft.id}/approve`, { digest: pending.digest }));
  return rev(await publisher.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: pending.digest }));
}

describe("the Constitution's lifecycle", () => {
  let h: Harness;
  let owner: OperatorClient;
  let editor: OperatorClient;
  let approver: OperatorClient;
  let auditor: OperatorClient;
  let first: RevisionView;
  let second: RevisionView;

  before(async () => {
    h = await startHarness();
    owner = await h.owner();
    const make = async (username: string, role: string): Promise<OperatorClient> => {
      assert.equal((await owner.send("POST", "/api/governance/operators", { username, password: `${username} has a long password`, roles: [role] })).status, 201);
      return h.signIn(username, `${username} has a long password`);
    };
    editor = await make("eddie", "policy_editor");
    approver = await make("april", "policy_approver");
    auditor = await make("audrey", "auditor");
  });
  after(() => h.close());

  test("an owner drafts from the default Constitution, and publishes it alone: it changes nothing, so it is low risk", async () => {
    const draft = rev(await owner.send("POST", "/api/governance/revisions", {}));
    assert.deepEqual([draft.state, draft.source, draft.errors, draft.impact?.risk], ["DRAFT", "default", [], "low"]);
    const doc = draft.document as Constitution;
    assert.equal(doc.metadata.organizationId, owner.state.organization?.id);
    assert.equal(doc.defaults.decision, "deny");
    rev(await owner.send("POST", `/api/governance/revisions/${draft.id}/validate`));
    const pending = rev(await owner.send("POST", `/api/governance/revisions/${draft.id}/request-approval`));
    assert.equal(pending.risk, "low");
    rev(await owner.send("POST", `/api/governance/revisions/${draft.id}/approve`, { digest: pending.digest }));
    first = rev(await owner.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: pending.digest }));
    assert.deepEqual([first.state, first.revision, first.digest], ["PUBLISHED", 1, pending.digest]);
    const overview = (await auditor.get("/api/governance/constitution")).body as ConstitutionOverview;
    assert.equal(overview.effective?.id, first.id);
    assert.deepEqual(first.history.map((s) => s.what), ["created", "validated", "approval requested", "approved", "published"]);
  });

  test("an editor edits a draft on the content it read; nobody else edits, and an editor neither approves nor publishes", async () => {
    const draft = rev(await editor.send("POST", "/api/governance/revisions", {}));
    assert.deepEqual([draft.source, draft.basedOn], ["copy", first.id]);
    const doc = draft.document as Constitution;
    const edited = { ...doc, metadata: { ...doc.metadata, name: "tighter" }, rules: doc.rules.map((r) => (r.id === "web-tools" ? { ...r, effect: "deny" as const } : r)) };
    const stale = await editor.send("PUT", `/api/governance/revisions/${draft.id}`, { document: edited, expectedDigest: "0".repeat(64) });
    assert.deepEqual([stale.status, code(stale)], [409, "stale_revision"]);
    const saved = rev(await editor.send("PUT", `/api/governance/revisions/${draft.id}`, { document: edited, expectedDigest: draft.digest }));
    assert.equal(saved.name, "tighter");
    assert.equal(code(await auditor.send("PUT", `/api/governance/revisions/${draft.id}`, { document: edited, expectedDigest: saved.digest })), "permission_required");
    assert.equal(code(await auditor.send("POST", "/api/governance/revisions", {})), "permission_required");
    rev(await editor.send("POST", `/api/governance/revisions/${draft.id}/validate`));
    const pending = rev(await editor.send("POST", `/api/governance/revisions/${draft.id}/request-approval`));
    assert.equal(code(await editor.send("POST", `/api/governance/revisions/${draft.id}/approve`, { digest: pending.digest })), "permission_required");
    rev(await approver.send("POST", `/api/governance/revisions/${draft.id}/approve`, { digest: pending.digest }));
    assert.equal(code(await editor.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: pending.digest })), "permission_required");
    assert.equal(code(await approver.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: pending.digest })), "permission_required");
    second = rev(await owner.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: pending.digest }));
    assert.equal(second.revision, 2);
    assert.equal(rev(await owner.get(`/api/governance/revisions/${first.id}`)).state, "SUPERSEDED");
  });

  test("a high-risk change is approved by somebody who wrote none of it -- worked out from what it does, not its words", async () => {
    const draft = rev(await owner.send("POST", "/api/governance/revisions", {}));
    const doc = draft.document as Constitution;
    const wider = { ...doc, rules: [...doc.rules, { id: "egress-github", action: "network.egress", resource: "github.com:443", effect: "allow" }] };
    const saved = rev(await owner.send("PUT", `/api/governance/revisions/${draft.id}`, { document: wider, expectedDigest: draft.digest }));
    assert.equal(saved.impact?.risk, "high");
    assert.deepEqual(saved.impact?.reasons, ["It loosens network.egress, a sensitive action."]);
    rev(await owner.send("POST", `/api/governance/revisions/${draft.id}/validate`));
    const pending = rev(await owner.send("POST", `/api/governance/revisions/${draft.id}/request-approval`));
    assert.equal(pending.risk, "high");
    const self = await owner.send("POST", `/api/governance/revisions/${draft.id}/approve`, { digest: pending.digest });
    assert.deepEqual([self.status, code(self)], [403, "self_approval"]);
    const approved = rev(await approver.send("POST", `/api/governance/revisions/${draft.id}/approve`, { digest: pending.digest }));
    assert.equal(approved.state, "APPROVED");
    // Withdrawn and changed, it is no longer what was approved.
    assert.equal(code(await owner.send("PUT", `/api/governance/revisions/${draft.id}`, { document: doc, expectedDigest: pending.digest })), "wrong_state");
    rev(await owner.send("POST", `/api/governance/revisions/${draft.id}/withdraw`));
    const changed = rev(await owner.send("PUT", `/api/governance/revisions/${draft.id}`, { document: { ...wider, metadata: { ...wider.metadata, name: "changed after approval" } }, expectedDigest: pending.digest }));
    assert.equal(changed.state, "DRAFT");
    assert.equal(code(await owner.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: pending.digest })), "wrong_state");
    rev(await owner.send("POST", `/api/governance/revisions/${draft.id}/validate`));
    const again = rev(await owner.send("POST", `/api/governance/revisions/${draft.id}/request-approval`));
    const old = await approver.send("POST", `/api/governance/revisions/${draft.id}/approve`, { digest: pending.digest });
    assert.deepEqual([old.status, code(old)], [409, "stale_revision"], "an approval of the old content does not carry over");
    rev(await approver.send("POST", `/api/governance/revisions/${draft.id}/reject`, { digest: again.digest }));
    assert.equal(rev(await owner.get(`/api/governance/revisions/${draft.id}`)).state, "REJECTED");
  });

  test("a draft for another organization, or an invalid one, is never validated", async () => {
    const draft = rev(await owner.send("POST", "/api/governance/revisions", {}));
    const doc = draft.document as Constitution;
    const foreign = rev(await owner.send("PUT", `/api/governance/revisions/${draft.id}`, { document: { ...doc, metadata: { ...doc.metadata, organizationId: "org-elsewhere" } }, expectedDigest: draft.digest }));
    assert.match(foreign.errors.join(" "), /this organization's id/);
    const refused = await owner.send("POST", `/api/governance/revisions/${draft.id}/validate`);
    assert.deepEqual([refused.status, code(refused)], [422, "invalid_constitution"]);
    const loose = rev(await owner.send("PUT", `/api/governance/revisions/${draft.id}`, { document: { ...doc, defaults: { decision: "allow" } }, expectedDigest: foreign.digest }));
    assert.ok(loose.errors.some((e) => e.includes("defaults.decision")));
  });

  test("a published revision never changes -- through the API, and not even in the database behind it", async () => {
    assert.equal(code(await owner.send("PUT", `/api/governance/revisions/${second.id}`, { document: {}, expectedDigest: second.digest })), "wrong_state");
    assert.equal(code(await owner.send("POST", `/api/governance/revisions/${second.id}/validate`)), "wrong_state");
    const db = new DatabaseSync(join(h.dataDir, "governance", "governance.db"));
    try {
      assert.throws(() => db.prepare("UPDATE revisions SET document = '{}' WHERE id = ?").run(second.id), /a published revision never changes/);
      assert.throws(() => db.prepare("UPDATE revisions SET state = 'DRAFT' WHERE id = ?").run(second.id), /a published revision never changes/);
      assert.throws(() => db.prepare("DELETE FROM revisions WHERE id = ?").run(first.id), /never removed/);
      assert.throws(() => db.prepare("UPDATE audit_events SET outcome = 'x' WHERE seq = 1").run(), /never changed/);
      assert.throws(() => db.prepare("DELETE FROM audit_events WHERE seq = 1").run(), /never removed/);
    } finally {
      db.close();
    }
  });

  test("a rollback is a copy of an earlier revision, taken through the lifecycle and published anew", async () => {
    const third = await throughLifecycle(owner, owner, owner, { from: first.id });
    assert.deepEqual([third.revision, third.source, third.basedOn, third.digest], [3, "copy", first.id, first.digest]);
    assert.equal(rev(await owner.get(`/api/governance/revisions/${second.id}`)).state, "SUPERSEDED");
    const events = ((await auditor.get("/api/governance/audit?type=constitution.published&limit=10")).body as AuditPage).events;
    assert.deepEqual(events.map((e) => [e.data.revision, e.data.replaces]), [[3, second.id], [2, first.id], [1, null]]);
  });

  test("a simulation asks a policy and decides nothing", async () => {
    const before = ((await auditor.get("/api/governance/audit?limit=1")).body as AuditPage).head?.seq;
    const ask = (action: string, resource: string, principalType = "agent") => owner.send("POST", "/api/governance/simulate", { request: { principalType, action, resource, environment: "local", workspaceId: "ws-1", agentId: "agt-1" } });
    const push = (await ask("repository.push", "github.com/acme/app")).body as SimulateResult;
    assert.deepEqual([push.revision, push.evaluation.verdict, push.evaluation.enforcement], [3, "require_approval", "boundary"]);
    assert.deepEqual(((await ask("governance.policy.modify", "org")).body as SimulateResult).evaluation.verdict, "deny");
    assert.deepEqual(((await ask("credential.read_raw", "github", "human")).body as SimulateResult).evaluation.verdict, "deny");
    assert.deepEqual(((await ask("teleport.anything", "x")).body as SimulateResult).evaluation.reasonCodes, ["UNKNOWN_ACTION"]);
    assert.deepEqual(((await ask("repository.write", "ws-1")).body as SimulateResult), (await ask("repository.write", "ws-1")).body as SimulateResult);
    assert.equal(((await auditor.get("/api/governance/audit?limit=1")).body as AuditPage).head?.seq, before);
    assert.equal(code(await auditor.send("POST", "/api/governance/simulate", { request: { principalType: "agent", action: "repository.write", resource: "x", environment: "local" } })), undefined);
  });

  test("an overlay narrows the Constitution for its own target only, and an allow in it changes nothing", async () => {
    const org = owner.state.organization?.id as string;
    const overlay = { apiVersion: "orbit.governance/v1", kind: "PolicyOverlay", metadata: { organizationId: org, level: "workspace", target: "ws-1", name: "read-only" }, rules: [{ id: "no-write", action: "repository.write", effect: "deny" }, { id: "push-free", action: "repository.push", effect: "allow" }] };
    const set = await owner.send("PUT", "/api/governance/overlays", { overlay });
    assert.equal(set.status, 200);
    // Said beside the overlay: denying repository.write is held by the agent runtime's own configuration (defence in
    // depth), and an allow in an overlay changes nothing.
    assert.deepEqual((set.body as { warnings: { code: string }[] }).warnings.map((w) => w.code), ["RUNTIME_ONLY", "OVERLAY_CANNOT_WIDEN"]);
    const sim = (ws: string, action: string) => owner.send("POST", "/api/governance/simulate", { request: { principalType: "agent", action, resource: ws, environment: "local", workspaceId: ws, agentId: "agt-1" } });
    const narrowed = ((await sim("ws-1", "repository.write")).body as SimulateResult).evaluation;
    assert.deepEqual([narrowed.verdict, narrowed.reasonCodes], ["deny", ["RULE_MATCHED", "OVERLAY_NARROWED"]]);
    assert.equal(((await sim("ws-2", "repository.write")).body as SimulateResult).evaluation.verdict, "allow");
    assert.equal(((await sim("ws-1", "repository.push")).body as SimulateResult).evaluation.verdict, "require_approval");
    assert.equal(code(await owner.send("PUT", "/api/governance/overlays", { overlay: { ...overlay, metadata: { ...overlay.metadata, organizationId: "org-x" } } })), "invalid_overlay");
    assert.equal(code(await editor.send("PUT", "/api/governance/overlays", { overlay })), "permission_required");
    assert.equal((await owner.send("DELETE", "/api/governance/overlays/workspace/ws-1")).status, 204);
    assert.equal(((await sim("ws-1", "repository.write")).body as SimulateResult).evaluation.verdict, "allow");
  });
});

describe("governed workspaces, findings and the daily report", () => {
  let h: Harness;
  let owner: OperatorClient;
  let session: SessionSummary;
  let agent: AgentView;

  before(async () => {
    h = await startHarness();
    owner = await h.owner();
    session = (await h.send("POST", "/api/sessions", { repository: null, model: "haiku" })).body as SessionSummary;
    await eventually(async () => ((await h.get(`/api/sessions/${session.id}`)).body as SessionDetail).status, (s) => s === "ready");
  });
  after(() => h.close());

  test("an agent is registered and a chat governed by it; releasing it is an administrator's", async () => {
    agent = (await owner.send("POST", "/api/governance/agents", { name: "Claude Code (builds)" })).body as AgentView;
    assert.deepEqual([agent.runtime, agent.status], ["claude-code", "active"]);
    const governed = await owner.send("PUT", `/api/governance/workspaces/${session.id}`, { agentId: agent.id, profile: "strict" });
    assert.equal(governed.status, 200);
    const list = (await owner.get("/api/governance/workspaces")).body as WorkspaceList;
    assert.deepEqual(list.workspaces.map((w) => [w.sessionId, w.scope, w.agentId]), [[session.id, "GOVERNED_WORKSPACE", agent.id]]);
    const op = (await owner.send("POST", "/api/governance/operators", { username: "otto", password: "otto has a long password", roles: ["agent_operator"] })).body as OperatorView;
    const otto = await h.signIn(op.username, "otto has a long password");
    assert.equal(code(await otto.send("DELETE", `/api/governance/workspaces/${session.id}`)), "permission_required");
    assert.equal(code(await otto.send("POST", "/api/governance/agents", { name: "mine" })), "permission_required");
    assert.equal(code(await owner.send("PUT", `/api/governance/workspaces/${session.id}`, { agentId: "agt-nobody", profile: "strict" })), "not_found");
  });

  test("deleting a governed chat deletes the chat -- and nothing of governance's record", async () => {
    const beforeDelete = ((await owner.get("/api/governance/audit?limit=200")).body as AuditPage).events.map((e) => e.eventId);
    assert.equal((await h.send("DELETE", `/api/sessions/${session.id}`)).status, 204);
    assert.equal((await h.get(`/api/sessions/${session.id}`)).status, 404);
    const afterDelete = ((await owner.get("/api/governance/audit?limit=200")).body as AuditPage).events;
    for (const id of beforeDelete) assert.ok(afterDelete.some((e) => e.eventId === id), `${id} kept`);
    const deleted = afterDelete.find((e) => e.eventType === "session.deleted");
    assert.deepEqual([deleted?.workspaceId, deleted?.data.scope], [session.id, "GOVERNED_WORKSPACE"]);
    assert.ok(afterDelete.some((e) => e.eventType === "workspace.governed" && e.workspaceId === session.id));
    const list = (await owner.get("/api/governance/workspaces")).body as WorkspaceList;
    assert.deepEqual(list.workspaces.map((w) => [w.title, w.status]), [["(chat deleted)", "deleted"]]);
    assert.equal(((await owner.send("POST", "/api/governance/audit/verify")).body as ChainVerification).ok, true);
  });

  test("findings stand on audit records, and the daily report cites them", async () => {
    await h.send("PATCH", "/api/settings", { azureForClaude: true });
    const editor = await (async () => {
      await owner.send("POST", "/api/governance/operators", { username: "auda", password: "auda has a long password", roles: ["auditor"] });
      return h.signIn("auda", "auda has a long password");
    })();
    await editor.send("POST", "/api/governance/revisions", {});
    const list = (await owner.get("/api/governance/findings")).body as FindingList;
    const kinds = list.findings.map((f) => `${f.kind}/${f.status}`);
    assert.ok(kinds.includes("AGENT_PRIVILEGE_ESCALATION/SUSPECTED"), kinds.join(","));
    assert.ok(kinds.includes("UNAUTHORIZED_POLICY_CHANGE/CONFIRMED"), kinds.join(","));
    const ids = new Set(((await owner.get("/api/governance/audit?limit=200")).body as AuditPage).events.map((e) => e.eventId));
    for (const f of list.findings) assert.ok(f.evidenceIds.length > 0 && f.evidenceIds.every((id) => ids.has(id)), f.id);
    const day = new Date().toISOString().slice(0, 10);
    const report = (await owner.send("POST", "/api/governance/reports", { day })).body as ReportView;
    assert.equal(report.day, day);
    assert.equal(report.report.integrity.ok, true);
    assert.ok(report.report.findings.length >= 2);
    assert.match(report.markdown, new RegExp(`# Governance audit report — ${day}`));
    for (const f of report.report.findings) for (const id of f.evidenceIds) assert.ok(ids.has(id) || f.kind === "AUDIT_INTEGRITY_FAILURE", id);
    const escalation = list.findings.find((f) => f.kind === "AGENT_PRIVILEGE_ESCALATION") as FindingList["findings"][number];
    assert.equal((await owner.send("POST", `/api/governance/findings/${encodeURIComponent(escalation.id)}/resolve`, { resolution: "accepted", note: "a person who had not signed in" })).status, 200);
    const next = (await owner.send("POST", "/api/governance/reports", { day })).body as ReportView;
    assert.equal(next.report.unresolved.includes(escalation.id), false);
    const md = await owner.get(`/api/governance/reports/${next.id}/markdown`);
    assert.match(String(md.headers.get("content-type")), /text\/markdown/);
    assert.equal(code(await editor.send("POST", `/api/governance/findings/${encodeURIComponent(escalation.id)}/resolve`, { resolution: "open" })), "permission_required");
    const overview = (await owner.get("/api/governance/overview")).body as GovernanceOverview;
    assert.deepEqual([overview.isolation.deployment, overview.isolation.state], ["single", "not_proven"]);
    assert.ok(overview.counts.openFindings >= 1);
  });
});
