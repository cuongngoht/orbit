// GOVERNANCE IS THE ACCOUNT OWNER'S, AND NOBODY ELSE'S. The person whose browser finished the Claude sign-in owns that
// account's governance -- with no operator to enrol, no password, no first-owner code and no organization to make. A
// browser with no session reaches none of it, and a change needs the session's own CSRF token. Another account's
// policy, chats, approvals and audit are not found from this one, through any route, and the database ties every record
// to its account. The audit chain holds under concurrent writes, two publications cannot both replace one revision, and a
// privileged switch is the owner's, decided by the account's policy and recorded before it is written.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import {
  CLAUDE_SIGN_IN_REQUIRED,
  CSRF_HEADER,
  CSRF_INVALID,
  MUTATION_HEADER,
  type ApprovalList,
  type ApprovalView,
  type AuditPage,
  type ChainVerification,
  type GovernanceOverview,
  type PolicyOverview,
  type ResourceGovernanceList,
  type RevisionView,
  type SessionDetail,
  type SessionSummary,
  type Settings,
  type SimulateResult,
} from "@orbit-web/contracts";
import type { Constitution } from "@orbit-web/governance-core";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { systemContext } from "../../src/modules/auth/principal.js";
import { ApprovalService } from "../../src/modules/governance/approvals.service.js";
import { PolicyService } from "../../src/modules/governance/policy.service.js";
import { FakeProcessPort, program } from "../../src/testing/fake-process.js";
import { CLAUDE_SIGNED_IN, eventually, signedIn, startHarness, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";

const code = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

function ok<T>(r: Reply): T {
  assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body as T;
}

const auditOf = async (b: Browser, query: string): Promise<AuditPage["events"]> => ok<AuditPage>(await b.get(`/api/governance/audit?${query}`)).events;

// A revision drafted from the policy in effect, edited, validated and published with the owner's confirmation.
async function publish(b: Browser, edit: (c: Constitution) => Constitution): Promise<RevisionView> {
  const draft = ok<RevisionView>(await b.send("POST", "/api/governance/revisions", {}));
  ok<RevisionView>(await b.send("PUT", `/api/governance/revisions/${draft.id}`, { document: edit(draft.document as Constitution), expectedDigest: draft.digest }));
  const read = ok<RevisionView>(await b.send("POST", `/api/governance/revisions/${draft.id}/validate`));
  return ok<RevisionView>(await b.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: read.digest, base: read.base, acknowledgedRisk: read.impact?.risk ?? null }));
}

describe("the account's owner governs at once, and only the owner", () => {
  let h: Harness;
  before(async () => {
    h = await startHarness();
  });
  after(() => h.close());

  test("the person who signed in with Claude governs at once: a policy in effect and an audit chain, with nothing to enrol or set up", async () => {
    const overview = ok<GovernanceOverview>(await h.get("/api/governance/overview"));
    assert.deepEqual([overview.account.id, overview.account.email, overview.deployment, overview.effective?.revision, overview.effective?.source], [h.accountId, "octo@example.com", "single", 1, "default"]);
    assert.ok(overview.audit.count >= 3 && overview.audit.head !== null);
    // No operator to sign in, no first-owner code, no organization to make, no role to grant, no workspace to enrol.
    const gone = [
      ["GET", "/api/operator/state"],
      ["POST", "/api/operator/login"],
      ["POST", "/api/operator/bootstrap"],
      ["GET", "/api/governance/operators"],
      ["POST", "/api/governance/operators"],
      ["POST", "/api/governance/organization"],
      ["GET", "/api/governance/agents"],
      ["PUT", "/api/governance/workspaces/sess-any"],
      ["POST", "/api/governance/revisions/rev-any/approve"],
    ] as const;
    for (const [method, path] of gone) {
      const r = method === "GET" ? await h.get(path) : await h.send(method, path, {});
      assert.equal(r.status, 404, `${method} ${path}: ${r.status}`);
    }
    const kept = await h.sql("SELECT table_name FROM information_schema.tables WHERE table_schema = 'governance' AND table_name ~ '(operator|organization|bootstrap|role_|agents)'");
    assert.deepEqual(kept, [], "nothing of the kind is kept");
  });

  test("a browser with no session reaches none of it, and a change without the session's own CSRF token is refused and recorded", async () => {
    const reads = ["/api/governance/overview", "/api/governance/policy", "/api/governance/audit", "/api/governance/workspaces", "/api/governance/research", "/api/governance/approvals", "/api/governance/decisions", "/api/governance/findings", "/api/governance/reports"];
    for (const path of reads) assert.equal(code(await h.anonymous.get(path)), CLAUDE_SIGN_IN_REQUIRED, path);
    assert.equal(code(await h.anonymous.send("POST", "/api/governance/revisions", {})), CLAUDE_SIGN_IN_REQUIRED);
    assert.equal(code(await h.anonymous.send("POST", "/api/governance/audit/verify")), CLAUDE_SIGN_IN_REQUIRED);
    const change = (headers: Record<string, string>) => fetch(`${h.url}/api/governance/revisions`, { method: "POST", headers: { cookie: h.cookie, [MUTATION_HEADER]: "1", "content-type": "application/json", ...headers }, body: "{}" });
    const attempts: Record<string, string>[] = [{}, { [CSRF_HEADER]: "x".repeat(43) }];
    for (const headers of attempts) {
      const r = await change(headers);
      assert.equal(r.status, 403);
      assert.equal(((await r.json()) as { error: { code: string } }).error.code, CSRF_INVALID);
    }
    assert.equal(ok<PolicyOverview>(await h.get("/api/governance/policy")).revisions.length, 1, "nothing was drafted");
    const refused = (await auditOf(h, "type=authz.denied")).filter((e) => e.data.cause === "csrf");
    assert.equal(refused.length, 2);
    assert.ok(refused.every((e) => e.principalType === "human" && e.accountId === h.accountId && String(e.data.route).includes("/governance/revisions")));
  });

  test("the account is the session's: no body, query or header that names another one changes what is read or written", async () => {
    const stranger = randomUUID();
    assert.equal(ok<GovernanceOverview>(await h.get(`/api/governance/overview?accountId=${stranger}`)).account.id, h.accountId);
    const policy = ok<PolicyOverview>(await h.get("/api/governance/policy", { "x-orbit-account": stranger }));
    assert.equal((policy.effective?.document as Constitution).metadata.accountId, h.accountId);
    assert.equal((await h.send("POST", "/api/governance/revisions", { accountId: stranger })).status, 400);
    assert.equal((await h.send("PUT", "/api/governance/workspaces/sess-any/override", { rules: [], accountId: stranger })).status, 400);
    assert.equal((await h.send("POST", "/api/governance/simulate", { request: { principalType: "human", action: "repository.read", resource: "x", environment: "local", accountId: stranger } })).status, 400);
  });

  test("the owner turns a privileged switch on -- decided by the account's policy, recorded before it is written -- and turning one off needs nobody", async () => {
    const on = ok<Settings>(await h.send("PATCH", "/api/settings", { githubForClaude: true, projectPlugins: true }));
    assert.deepEqual([on.githubForClaude, on.projectPlugins], [true, true]);
    ok<Settings>(await h.send("PATCH", "/api/settings", { githubForClaude: false }));
    const changes = (await auditOf(h, "type=settings.privileged.changed")).map((e) => JSON.stringify([e.principalType, e.data.setting, e.data.value, e.outcome]));
    assert.equal(changes[0], JSON.stringify(["human", "githubForClaude", false, "narrowed"]));
    assert.deepEqual(new Set(changes.slice(1)), new Set([JSON.stringify(["human", "githubForClaude", true, "authorized"]), JSON.stringify(["human", "projectPlugins", true, "authorized"])]));
    const decided = (await auditOf(h, "type=policy.decision")).filter((e) => e.data.action === "settings.privileged.write");
    assert.deepEqual(new Set(decided.map((e) => `${e.principalType} ${String(e.data.resource)} ${e.outcome} ${String(e.data.scope)}`)), new Set(["human githubForClaude allow ACCOUNT", "human projectPlugins allow ACCOUNT"]));
  });

  test("an account whose policy does not let a person turn a switch on refuses it, says why and records it", async () => {
    const narrower = await publish(h, (c) => ({ ...c, rules: c.rules.map((r) => (r.id === "privileged-settings" ? { ...r, effect: "deny" as const } : r)) }));
    assert.deepEqual([narrower.revision, narrower.risk], [2, "low"]);
    const refused = await h.send("PATCH", "/api/settings", { azureForClaude: true });
    assert.deepEqual([refused.status, code(refused)], [403, "policy_denied"]);
    assert.equal(ok<Settings>(await h.get("/api/settings")).azureForClaude, false);
    const said = (await auditOf(h, "type=settings.privileged.refused"))[0];
    assert.deepEqual([said?.principalType, said?.data.setting, said?.data.cause], ["human", "azureForClaude", "policy_deny"]);
    assert.equal(ok<Settings>(await h.send("PATCH", "/api/settings", { projectPlugins: false })).projectPlugins, false, "narrowing is always allowed");
  });
});

const ALICE = { ...CLAUDE_SIGNED_IN, email: "alice@example.com", orgId: "org-a", orgName: "Alice Org" };
const BOB = { ...CLAUDE_SIGNED_IN, email: "bob@example.com", orgId: "org-b", orgName: "Bob Org" };

describe("another account's governance is not found from this one", () => {
  const state = { who: ALICE as Record<string, unknown> };
  let h: Harness;
  let alice: Browser;
  let bob: Browser;
  let aliceId: string;
  let chat: SessionSummary;
  let draft: RevisionView;
  let approval: ApprovalView;
  let aliceEvent: string;
  // A new browser signed in as `who` -- which makes `who` the runtime's identity, and ends the sessions of the one before.
  const as = (who: Record<string, unknown>): Promise<Browser> => {
    state.who = who;
    return h.browser();
  };

  before(async () => {
    const fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(program("claude", "auth", "status"), { run: () => ({ stdout: JSON.stringify(state.who) }) });
    h = await startHarness({ fake });
    alice = h;
    aliceId = h.accountId as string;
    chat = ok<SessionSummary>(await alice.send("POST", "/api/sessions", { repository: null, model: "haiku" }));
    await eventually(async () => ok<SessionDetail>(await alice.get(`/api/sessions/${chat.id}`)).status, (s) => s === "ready");
    ok(await alice.send("PUT", `/api/governance/workspaces/${chat.id}/override`, { rules: [{ id: "no-write", action: "repository.write", effect: "deny" }] }));
    draft = ok<RevisionView>(await alice.send("POST", "/api/governance/revisions", {}));
    const asked = await h.app.get(ApprovalService).request(systemContext("a-test", aliceId), {
      action: "repository.push",
      environment: "development",
      fingerprint: "f".repeat(64),
      params: { repository: "github:octo/sum-fixture" },
      summary: "A push of Alice's",
      decisionId: null,
      workspaceId: chat.id,
      agentId: null,
      runId: null,
      change: null,
    });
    approval = ok<ApprovalView>(await alice.get(`/api/governance/approvals/${asked.id}`));
    aliceEvent = (await auditOf(alice, "limit=1"))[0]?.eventId as string;
    bob = await as(BOB);
  });
  after(() => h.close());

  test("one Claude identity per runtime: once the CLI is Bob's, Alice's browser reads nothing", async () => {
    assert.notEqual(bob.accountId, aliceId);
    assert.equal(code(await alice.get("/api/governance/overview")), CLAUDE_SIGN_IN_REQUIRED);
    assert.equal(code(await alice.send("POST", "/api/governance/revisions", {})), CLAUDE_SIGN_IN_REQUIRED);
  });

  test("Bob's governance is his own -- his revision 1, his chain -- and none of Alice's records answers him, by any route", async () => {
    const overview = ok<GovernanceOverview>(await bob.get("/api/governance/overview"));
    assert.deepEqual(
      [overview.account.id, overview.account.email, overview.effective?.revision, overview.counts.workspaces, overview.counts.overrides, overview.counts.pendingApprovals, overview.counts.draftRevisions],
      [bob.accountId, "bob@example.com", 1, 0, 0, 0, 0],
    );
    for (const path of [`/api/governance/revisions/${draft.id}`, `/api/governance/workspaces/${chat.id}`, `/api/governance/approvals/${approval.id}`, `/api/governance/audit/${aliceEvent}`]) assert.equal((await bob.get(path)).status, 404, path);
    const sim = { principalType: "agent", action: "repository.write", resource: chat.id, environment: "local", workspaceId: chat.id, researchWorkspaceId: null };
    const changes: [string, string, unknown][] = [
      ["PUT", `/api/governance/revisions/${draft.id}`, { document: draft.document, expectedDigest: draft.digest }],
      ["POST", `/api/governance/revisions/${draft.id}/validate`, undefined],
      ["POST", `/api/governance/revisions/${draft.id}/discard`, { digest: draft.digest }],
      ["POST", `/api/governance/revisions/${draft.id}/publish`, { digest: draft.digest, base: null, acknowledgedRisk: "high" }],
      ["POST", "/api/governance/revisions", { from: draft.id }],
      ["PUT", `/api/governance/workspaces/${chat.id}/override`, { rules: [] }],
      ["DELETE", `/api/governance/workspaces/${chat.id}/override`, undefined],
      ["POST", `/api/governance/approvals/${approval.id}/grant`, { fingerprint: approval.fingerprint }],
      ["POST", `/api/governance/approvals/${approval.id}/reject`, { fingerprint: approval.fingerprint }],
      ["POST", `/api/governance/approvals/${approval.id}/execute`, undefined],
      ["POST", "/api/governance/simulate", { revisionId: draft.id, request: sim }],
    ];
    for (const [method, path, body] of changes) assert.equal((await bob.send(method, path, body)).status, 404, `${method} ${path}`);
    assert.equal(ok<PolicyOverview>(await bob.get("/api/governance/policy")).revisions.some((r) => r.id === draft.id), false);
    assert.deepEqual(ok<ResourceGovernanceList>(await bob.get("/api/governance/workspaces")).resources, []);
    assert.deepEqual(ok<ApprovalList>(await bob.get("/api/governance/approvals")).approvals, []);
    const events = await auditOf(bob, "limit=200");
    assert.ok(events.length > 0 && events.every((e) => e.accountId === bob.accountId), "his chain is his own");
    // Alice's override narrows nothing of Bob's, whatever chat id a request names.
    assert.equal(ok<SimulateResult>(await bob.send("POST", "/api/governance/simulate", { request: sim })).evaluation.verdict, "allow");
    // And nothing Bob was refused moved anything of Alice's.
    const [row] = await h.sql("SELECT state FROM governance.approvals WHERE id = $1", [approval.id]);
    assert.equal(row?.state, "pending");
  });

  test("the database ties each record to its account: none moves to another, and an override names its own account's chat only", async () => {
    await assert.rejects(h.sql("UPDATE governance.policy_revisions SET account_id = $1 WHERE id = $2", [bob.accountId, draft.id]), /a record never moves to another account/);
    await assert.rejects(h.sql("UPDATE governance.approvals SET account_id = $1 WHERE id = $2", [bob.accountId, approval.id]), /a record never moves to another account/);
    await assert.rejects(
      h.sql("INSERT INTO governance.policy_overrides (account_id, kind, resource_id, document, digest, set_at, set_by) VALUES ($1, 'workspace', $2, '{}', 'x', now(), 'x')", [bob.accountId, chat.id]),
      /violates foreign key constraint/,
    );
  });

  test("Alice, signing in again, finds her governance as she left it -- and Bob's browser reads nothing now", async () => {
    const again = await as(ALICE);
    assert.equal(again.accountId, aliceId);
    assert.equal(ok<RevisionView>(await again.get(`/api/governance/revisions/${draft.id}`)).state, "DRAFT");
    assert.equal(ok<ResourceGovernanceList>(await again.get("/api/governance/workspaces")).resources.find((r) => r.id === chat.id)?.overridden, true);
    assert.equal(ok<ApprovalView>(await again.get(`/api/governance/approvals/${approval.id}`)).state, "pending");
    assert.equal(code(await bob.get("/api/governance/overview")), CLAUDE_SIGN_IN_REQUIRED);
  });
});

describe("the audit chain and the policy, under concurrent writes", () => {
  let h: Harness;
  before(async () => {
    h = await startHarness();
  });
  after(() => h.close());

  test("records written at once are numbered and linked one after another, and the chain holds", async () => {
    const policy = h.app.get(PolicyService);
    const ctx = systemContext("concurrency", h.accountId);
    const [drafts, decisions] = await Promise.all([
      Promise.all(Array.from({ length: 12 }, () => h.send("POST", "/api/governance/revisions", {}))),
      Promise.all(Array.from({ length: 30 }, (_, i) => policy.decide(ctx, { action: "repository.read", resource: `ws-${i}`, scope: "ACCOUNT" }))),
    ]);
    assert.ok(drafts.every((r) => r.status === 201), drafts.map((r) => r.status).join(","));
    assert.equal(new Set(decisions.map((d) => d.eventId)).size, 30);
    const seqs = (await h.sql("SELECT seq FROM governance.audit_events WHERE chain_id = $1 ORDER BY seq", [`account:${h.accountId}`])).map((r) => Number(r.seq));
    assert.deepEqual(seqs, seqs.map((_, i) => i + 1), "no gap, no repeat");
    const [head] = await h.sql("SELECT head_seq FROM governance.audit_chains WHERE account_id = $1", [h.accountId]);
    assert.equal(Number(head?.head_seq), seqs.length);
    const v = ok<ChainVerification>(await h.send("POST", "/api/governance/audit/verify"));
    assert.deepEqual([v.ok, v.count], [true, seqs.length]);
  });

  test("two publications racing on one policy: one is published, the other refused -- never two in effect", async () => {
    const ready = async (): Promise<RevisionView> => {
      const d = ok<RevisionView>(await h.send("POST", "/api/governance/revisions", {}));
      return ok<RevisionView>(await h.send("POST", `/api/governance/revisions/${d.id}/validate`));
    };
    const a = await ready();
    const b = await ready();
    const raced = await Promise.all([a, b].map((r) => h.send("POST", `/api/governance/revisions/${r.id}/publish`, { digest: r.digest, base: r.base, acknowledgedRisk: null })));
    assert.deepEqual(raced.map((r) => r.status).sort((x, y) => x - y), [200, 409]);
    assert.equal(code(raced.find((r) => r.status === 409) as Reply), "stale_base");
    const [row] = await h.sql("SELECT count(*)::int AS n FROM governance.policy_revisions WHERE account_id = $1 AND state = 'PUBLISHED'", [h.accountId]);
    assert.equal(row?.n, 1);
    assert.equal(ok<PolicyOverview>(await h.get("/api/governance/policy")).effective?.revision, 2);
    assert.equal(ok<ChainVerification>(await h.send("POST", "/api/governance/audit/verify")).ok, true);
  });
});
