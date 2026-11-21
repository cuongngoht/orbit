// A CHAT'S RUN UNDER ITS ACCOUNT'S POLICY, ITS AGENT, AND ITS PUSH -- through the real API, with Claude Code stood in for
// by a script that behaves as a misled agent would: it calls Orbit Web's own API from its shell. The run is decided
// before it starts (refused where the policy requires isolation and one container cannot prove it), bound to its
// account and chat, and handed no sign-in and no database credential. The agent reaches nothing but its gateway -- not a
// setting, not governance, not a session, not an approval; a credential it asks for is denied. Its push waits for the
// account's owner, who approves the exact commit; Orbit Web pushes it (to a local bare repository here) and refuses it a
// second time. An agent never decides an approval: not through any route, not through the service, not in the database.
// Once the owner's policy simply allows git, the agent's push is made at once, with nobody asked. A research run is held
// to the same account's policy, as research. Azure DevOps pushes the same way, with the Azure CLI's one-shot helper.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import {
  SIGN_IN_REQUIRED,
  MUTATION_HEADER,
  RUN_TOKEN_HEADER,
  type AgentPushResult,
  type AgentWhoAmI,
  type ApprovalList,
  type ApprovalView,
  type AuditPage,
  type DecisionList,
  type FindingList,
  type PolicyOverview,
  type ResearchSessionDetail,
  type ResearchWorkspaceSummary,
  type ResourceGovernanceList,
  type ResourceGovernanceView,
  type RevisionView,
  type RunAccepted,
  type SessionDetail,
  type SessionSummary,
} from "@orbit-web/contracts";
import type { Constitution, RiskLevel } from "@orbit-web/governance-core";
import { RunBindingStore } from "../../src/infra/governance/stores.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { contextOf } from "../../src/modules/auth/principal.js";
import { ApprovalService } from "../../src/modules/governance/approvals.service.js";
import { FakeProcessPort, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { AZURE, AZURE_REPOSITORY, azureSignedIn, claudeRun, eventually, REPOSITORY, researchRun, signedIn, startHarness, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";
import { answered, newWorkspace } from "../../src/testing/research-client.js";
import { researchAnswer } from "../../src/testing/research-fixtures.js";

const code = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
const after1 = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);
const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-c", "user.name=Agent", "-c", "user.email=agent@example.com", ...args], { cwd, encoding: "utf8" });
const remoteRef = (remote: string, ref: string): string => spawnSync("git", ["--git-dir", remote, "rev-parse", "--verify", "--quiet", ref], { encoding: "utf8" }).stdout.trim();

function ok<T>(r: Reply): T {
  assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body as T;
}

interface Probe {
  status: number;
  body: unknown;
}

const errorOf = (p: Probe | undefined): string | undefined => (p?.body as { error?: { code?: string } } | null)?.error?.code;

// What the agent's shell would do: call Orbit Web, as the run's own environment lets it.
async function call(method: string, url: string, body?: unknown, extra: Record<string, string> = {}): Promise<Probe> {
  const res = await fetch(url, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extra }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // text
  }
  return { status: res.status, body: parsed };
}

const token = (c: Call): Record<string, string> => ({ [RUN_TOKEN_HEADER]: c.env.ORBIT_AGENT_TOKEN as string });
const apiOf = (c: Call): string => (c.env.ORBIT_AGENT_GATEWAY as string).replace(/\/api\/agent$/, "/api");

type Behaviour = (call: Call) => Promise<void>;

// A stand-in Claude Code run whose "tool calls" are `behaviour`; it reports a result and exits 0.
function scripted(queue: Behaviour[]) {
  return (child: FakeChild, c: Call) => {
    child.onInputClosed(() => {
      void (async () => {
        child.line({ type: "system", subtype: "init", cwd: c.cwd, session_id: after1(c.args, "--session-id") ?? after1(c.args, "--resume"), model: "claude-sonnet-5-5", claude_code_version: "2.1.328", plugins: [] });
        const next = queue.shift();
        if (next !== undefined) await next(c);
        child.line({ type: "result", subtype: "success", is_error: false, result: "Done.", total_cost_usd: 0.01, num_turns: 1, duration_ms: 10, permission_denials: [] });
        child.exit(0);
      })();
    });
  };
}

// A revision drafted from the policy in effect, edited, validated -- and published with the owner's confirmation at the
// risk the server worked out, which the test names, so that a change of what the edit does is noticed.
async function publish(b: Browser, risk: RiskLevel, edit: (c: Constitution) => Constitution): Promise<RevisionView> {
  const draft = ok<RevisionView>(await b.send("POST", "/api/governance/revisions", {}));
  ok<RevisionView>(await b.send("PUT", `/api/governance/revisions/${draft.id}`, { document: edit(draft.document as Constitution), expectedDigest: draft.digest }));
  const read = ok<RevisionView>(await b.send("POST", `/api/governance/revisions/${draft.id}/validate`));
  assert.equal(read.impact?.risk, risk, JSON.stringify(read.impact?.reasons));
  const published = ok<RevisionView>(await b.send("POST", `/api/governance/revisions/${draft.id}/publish`, { digest: read.digest, base: read.base, acknowledgedRisk: risk }));
  assert.equal(published.state, "PUBLISHED");
  return published;
}

const waitStatus = (h: Harness, id: string, statuses: string[]) => eventually(async () => ((await h.get(`/api/sessions/${id}`)).body as SessionDetail).status, (s) => statuses.includes(s));
const auditOf = async (h: Harness, query: string): Promise<AuditPage["events"]> => ok<AuditPage>(await h.get(`/api/governance/audit?${query}`)).events;

// A message, and its run seen to its end: the chat's own status event for THAT run (never the one before it). A message
// is taken once the run before it is wholly over -- until then it is refused as busy, and sent again.
async function turn(h: Harness, sessionId: string, text: string, end: readonly string[] = ["completed"]): Promise<{ runId: string; status: string }> {
  const sent = await eventually(() => h.send("POST", `/api/sessions/${sessionId}/messages`, { text }), (r) => code(r) !== "run_active");
  assert.equal(sent.status, 202, JSON.stringify(sent.body));
  const runId = (sent.body as RunAccepted).runId;
  const statusOf = (es: Record<string, unknown>[]): string[] => es.filter((e) => e.type === "session.status" && e.runId === runId).map((e) => String((e.data as { status?: unknown }).status));
  const { events } = await h.events(`/api/sessions/${sessionId}/events`, { until: (es) => statusOf(es).some((s) => end.includes(s)), timeoutMs: 20_000 });
  return { runId, status: statusOf(events).at(-1) ?? "none" };
}

// The run's end recorded (its token ends there too).
const finished = (h: Harness, runId: string) => eventually(async () => (await auditOf(h, "type=run.finished&limit=50")).find((e) => e.runId === runId), (e) => e !== undefined);

// Nothing that would reach the database is in a run's environment: no URL, no part of one, no libpq variable.
function noDatabaseIn(h: Harness, env: Record<string, string | undefined>): void {
  assert.deepEqual(Object.keys(env).filter((k) => /^(ORBIT_WEB_DATABASE|PG|DATABASE_URL)/.test(k)), []);
  for (const [k, v] of Object.entries(env)) assert.equal(String(v).includes(h.database.name), false, `${k} names the database`);
}

describe("a chat's run under its account's policy, its agent, and its push (GitHub)", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let session: SessionSummary;
  let other: SessionSummary;
  let remotes: string;
  let remote: string;
  let optional: RevisionView;
  const queue: Behaviour[] = [];
  const seen: Record<string, Probe> = {};
  let runEnv: Record<string, string> = {};
  let pushed: AgentPushResult;
  const runs = () => fake.children.filter((c) => claudeRun(c.call.file, c.call.args));

  before(async () => {
    remotes = mkdtempSync(join(tmpdir(), "orbit-web-remotes-"));
    remote = join(remotes, "octo", "sum-fixture.git");
    mkdirSync(join(remotes, "octo"), { recursive: true });
    spawnSync("git", ["init", "--bare", "-q", "-b", "main", remote]);
    fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(claudeRun, { spawn: scripted(queue) });
    h = await startHarness({ fake, env: { ORBIT_WEB_GITHUB_URL: `file://${remotes}` } });
    session = ok<SessionSummary>(await h.send("POST", "/api/sessions", { repository: { source: "github", id: REPOSITORY }, branch: "main", model: "haiku" }));
    other = ok<SessionSummary>(await h.send("POST", "/api/sessions", { repository: null, model: "haiku" }));
    await waitStatus(h, session.id, ["ready"]);
    await waitStatus(h, other.id, ["ready"]);
    // Read again once prepared: its working branch is set then.
    session = ok<SessionSummary>(await h.get(`/api/sessions/${session.id}`));
  });
  after(async () => {
    await h.close();
    rmSync(remotes, { recursive: true, force: true });
  });

  test("where the account's policy requires isolation and one container cannot prove it, the run is refused, said and recorded", async () => {
    const required = await publish(h, "low", (c) => ({ ...c, obligations: { ...c.obligations, isolation: "required" } }));
    assert.equal(required.revision, 2);
    const before = runs().length;
    assert.equal((await turn(h, session.id, "Fix it.", ["failed"])).status, "failed");
    assert.equal(runs().length, before, "Claude Code never started");
    assert.match(ok<SessionDetail>(await h.get(`/api/sessions/${session.id}`)).statusReason ?? "", /isolation is not proven/);
    const refused = await auditOf(h, "type=run.refused");
    assert.deepEqual(refused.map((e) => [e.workspaceId, e.reasonCodes, e.data.scope]), [[session.id, ["ISOLATION_NOT_PROVEN"], "ACCOUNT_WORKSPACE"]]);
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM governance.run_bindings"))[0]?.n, 0, "nothing was bound");
  });

  test("once the policy makes isolation optional again -- a high-risk change the owner acknowledged -- the run starts bound to its account and chat, holding no sign-in", async () => {
    optional = await publish(h, "high", (c) => ({ ...c, obligations: { ...c.obligations, isolation: "optional" } }));
    assert.equal(optional.revision, 3);
    queue.push(async (c) => {
      runEnv = c.env;
      const gw = c.env.ORBIT_AGENT_GATEWAY as string;
      const api = apiOf(c);
      const change = { ...token(c), [MUTATION_HEADER]: "1" };
      seen.whoami = await call("GET", `${gw}/whoami`, undefined, token(c));
      // The misled agent reaches for authority: with its run's token, and with nothing at all.
      seen.switchWithToken = await call("PATCH", `${api}/settings`, { githubForClaude: true }, change);
      seen.switchWithout = await call("PATCH", `${api}/settings`, { githubForClaude: true, azureForClaude: true }, { [MUTATION_HEADER]: "1" });
      seen.policy = await call("GET", `${api}/governance/policy`, undefined, token(c));
      seen.draft = await call("POST", `${api}/governance/revisions`, {}, change);
      seen.approve = await call("POST", `${api}/governance/approvals/apr-any/grant`, { fingerprint: "0".repeat(64) }, change);
      seen.session = await call("POST", `${api}/claude/session`, undefined, change);
      seen.credential = await call("POST", `${gw}/decisions`, { action: "credential.read_raw", resource: "github" }, token(c));
      // The work, committed, and its push asked for.
      writeFileSync(join(c.cwd, "sum.mjs"), "export const sum = (a, b) => a + b;\n");
      git(c.cwd, "commit", "-qam", "Fix the addition");
      seen.push = await call("POST", `${gw}/push`, {}, token(c));
    });
    assert.equal((await turn(h, session.id, "Fix it, commit it, and ask for it to be pushed.")).status, "completed");
    const run = runs().at(-1)?.call as Call;
    assert.match(runEnv.ORBIT_AGENT_TOKEN ?? "", /^[A-Za-z0-9_-]{43}$/);
    for (const name of ["GH_CONFIG_DIR", "AZURE_CONFIG_DIR", "GH_TOKEN"]) assert.equal(name in runEnv, false, `${name}: no sign-in was handed to the run`);
    noDatabaseIn(h, runEnv);
    assert.ok(run.args.includes("Bash(git push:*)"), "with no sign-in handed over, git push is refused to the runtime");
    assert.equal(run.args.includes("WebFetch"), false, "the default policy of one container allows the web tools");
    assert.equal(run.args.includes("--strict-mcp-config"), false);
    assert.match(after1(run.args, "--append-system-prompt") ?? "", /runs under its account's policy \(revision 3\)/);

    const who = seen.whoami?.body as AgentWhoAmI;
    assert.deepEqual(who, { runId: who.runId, accountId: h.accountId, kind: "chat", workspaceId: session.id, agentId: "claude-code", policyRevision: optional.id, scope: "ACCOUNT_WORKSPACE" });
    for (const probe of ["switchWithToken", "policy", "draft", "approve", "session"]) assert.deepEqual([seen[probe]?.status, errorOf(seen[probe])], [403, "agent_outside_gateway"], probe);
    assert.deepEqual([seen.switchWithout?.status, errorOf(seen.switchWithout)], [401, SIGN_IN_REQUIRED], "the CLI being signed in makes no request an owner's");
    assert.equal((seen.credential?.body as { verdict: string }).verdict, "deny");
    pushed = seen.push?.body as AgentPushResult;
    assert.equal(seen.push?.status, 200, JSON.stringify(seen.push?.body));
    assert.deepEqual([pushed.state, pushed.decision.verdict, pushed.decision.policyRevision], ["pending", "require_approval", optional.id]);
    assert.match(pushed.fingerprint ?? "", /^[0-9a-f]{64}$/);

    // Nothing the agent tried changed anything.
    const settings = ok<{ githubForClaude: boolean; azureForClaude: boolean }>(await h.get("/api/settings"));
    assert.deepEqual([settings.githubForClaude, settings.azureForClaude], [false, false]);
    assert.equal(spawnSync("git", ["--git-dir", remote, "for-each-ref"], { encoding: "utf8" }).stdout, "", "nothing was pushed by asking");
    assert.equal(ok<PolicyOverview>(await h.get("/api/governance/policy")).revisions.length, 3, "no draft was written");

    // The run's token ended with the run.
    await finished(h, who.runId);
    const late = await call("GET", `${runEnv.ORBIT_AGENT_GATEWAY}/whoami`, undefined, { [RUN_TOKEN_HEADER]: runEnv.ORBIT_AGENT_TOKEN as string });
    assert.equal(late.status, 401);

    const started = (await auditOf(h, "type=run.started"))[0];
    assert.deepEqual([started?.principalType, started?.agentId, started?.workspaceId, started?.runId, started?.policyRevision, started?.data.scope, started?.data.startedBy], ["agent", "claude-code", session.id, who.runId, optional.id, "ACCOUNT_WORKSPACE", `owner:${h.accountId}`]);
    const decisions = ok<DecisionList>(await h.get(`/api/governance/decisions?workspace=${session.id}&limit=50`)).decisions.filter((d) => d.runId === who.runId);
    assert.deepEqual(Object.fromEntries(decisions.map((d) => [d.action, d.verdict])), { "agent.run.start": "allow", "tool.web": "allow", "workspace.execute": "allow", "credential.read_raw": "deny", "repository.push": "require_approval" });
    assert.ok(decisions.every((d) => d.scope === "ACCOUNT_WORKSPACE" && d.policyRevision === optional.id && d.principalType === "agent"));
    const violations = (await auditOf(h, "type=boundary.violation")).filter((e) => e.runId === who.runId);
    assert.equal(violations.length, 5, "every reach outside the gateway is recorded, as this run's agent");
    assert.ok(violations.every((e) => e.principalType === "agent" && e.data.kind === "agent_outside_gateway"));
  });

  test("the account's owner approves the exact push; Orbit Web pushes it -- and refuses it a second time", async () => {
    const a = ok<ApprovalList>(await h.get("/api/governance/approvals")).approvals.find((x) => x.id === pushed.approvalId) as ApprovalView;
    const head = git(join(h.dataDir, "workspaces", session.id, "repository"), "rev-parse", "HEAD").stdout.trim();
    assert.deepEqual([a.state, a.action, a.params.commit, a.params.ref, a.params.force, a.params.expectedRemoteOid, a.requestedBy, a.requestedByType], ["pending", "repository.push", head, `refs/heads/${session.workBranch}`, false, null, "agent:claude-code", "agent"]);
    assert.ok((a.change?.commits ?? 0) >= 1);
    const wrong = await h.send("POST", `/api/governance/approvals/${a.id}/grant`, { fingerprint: "0".repeat(64) });
    assert.deepEqual([wrong.status, code(wrong)], [409, "fingerprint_mismatch"]);
    const done = ok<ApprovalView>(await h.send("POST", `/api/governance/approvals/${a.id}/grant`, { fingerprint: a.fingerprint }));
    assert.deepEqual([done.state, done.outcome?.startsWith("pushed"), done.decidedBy], ["consumed", true, `owner:${h.accountId}`]);
    assert.equal(remoteRef(remote, `refs/heads/${session.workBranch}`), head, "the approved commit is at the remote's branch");
    const replay = await h.send("POST", `/api/governance/approvals/${a.id}/execute`);
    assert.deepEqual([replay.status, code(replay)], [409, "approval_consumed"]);
    const granted = (await auditOf(h, "type=approval.granted"))[0];
    assert.deepEqual([granted?.principalType, granted?.principalId, granted?.data.approvalId], ["human", `owner:${h.accountId}`, a.id]);
    const kinds = ok<FindingList>(await h.get("/api/governance/findings")).findings.map((f) => `${f.kind}/${f.status}`);
    for (const k of ["APPROVAL_REPLAY/CONFIRMED", "AGENT_PRIVILEGE_ESCALATION/CONFIRMED", "CREDENTIAL_ACCESS_ATTEMPT/CONFIRMED"]) assert.ok(kinds.includes(k), `${k} in ${kinds.join(",")}`);
  });

  test("an agent replaying an approval, or reaching for another chat's, is refused and recorded", async () => {
    queue.push(async (c) => {
      seen.replay = await call("POST", `${c.env.ORBIT_AGENT_GATEWAY}/approvals/${pushed.approvalId}/execute`, undefined, token(c));
    });
    assert.equal((await turn(h, session.id, "Push it again.")).status, "completed");
    assert.deepEqual([seen.replay?.status, errorOf(seen.replay)], [409, "approval_consumed"]);
    queue.push(async (c) => {
      seen.across = await call("GET", `${c.env.ORBIT_AGENT_GATEWAY}/approvals/${pushed.approvalId}`, undefined, token(c));
      seen.acrossExecute = await call("POST", `${c.env.ORBIT_AGENT_GATEWAY}/approvals/${pushed.approvalId}/execute`, undefined, token(c));
      seen.noRepo = await call("POST", `${c.env.ORBIT_AGENT_GATEWAY}/push`, {}, token(c));
    });
    assert.equal((await turn(h, other.id, "Look around.")).status, "completed");
    assert.deepEqual([seen.across?.status, seen.acrossExecute?.status], [403, 403]);
    assert.equal(errorOf(seen.noRepo), "no_repository");
    const kinds = ok<FindingList>(await h.get("/api/governance/findings")).findings.map((f) => f.kind);
    assert.ok(kinds.includes("CROSS_WORKSPACE_ACCESS"));
  });

  test("a remote that moved after the approval is never pushed over: the approval no longer matches", async () => {
    queue.push(async (c) => {
      writeFileSync(join(c.cwd, "NOTES.md"), "more\n");
      git(c.cwd, "add", "NOTES.md");
      git(c.cwd, "commit", "-qm", "More");
      seen.second = await call("POST", `${c.env.ORBIT_AGENT_GATEWAY}/push`, {}, token(c));
    });
    assert.equal((await turn(h, session.id, "One more change.")).status, "completed");
    const second = seen.second?.body as AgentPushResult;
    assert.equal(second.state, "pending", JSON.stringify(second));
    // Somebody else pushes to that branch meanwhile.
    const elsewhere = mkdtempSync(join(tmpdir(), "elsewhere-"));
    try {
      git(elsewhere, "clone", "-q", remote, "w");
      git(join(elsewhere, "w"), "checkout", "-q", session.workBranch as string);
      git(join(elsewhere, "w"), "commit", "-q", "--allow-empty", "-m", "Someone else");
      git(join(elsewhere, "w"), "push", "-q", "origin", session.workBranch as string);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
    const theirs = remoteRef(remote, `refs/heads/${session.workBranch}`);
    const r = await h.send("POST", `/api/governance/approvals/${second.approvalId}/grant`, { fingerprint: second.fingerprint });
    assert.deepEqual([r.status, code(r)], [409, "fingerprint_mismatch"]);
    assert.equal(remoteRef(remote, `refs/heads/${session.workBranch}`), theirs, "their work stays");
  });

  test("the owner's push from the chat waits for the owner's own approval where the policy asks for one", async () => {
    assert.equal(code(await h.anonymous.send("POST", `/api/sessions/${session.id}/push`, {})), SIGN_IN_REQUIRED);
    const asked = await h.send("POST", `/api/sessions/${session.id}/push`, {});
    assert.equal(asked.status, 200, JSON.stringify(asked.body));
    const view = (asked.body as { approval: ApprovalView }).approval;
    assert.deepEqual([view.state, view.requestedBy, view.requestedByType, view.runId], ["pending", `owner:${h.accountId}`, "human", null]);
    const pushes = ok<ApprovalList>(await h.get(`/api/sessions/${session.id}/pushes`)).approvals;
    assert.ok(pushes.some((p) => p.id === view.id));
    // Not a fast-forward of what somebody else pushed: git refuses it, and nothing is overwritten.
    const granted = ok<ApprovalView>(await h.send("POST", `/api/governance/approvals/${view.id}/grant`, { fingerprint: view.fingerprint }));
    assert.equal(granted.state, "consumed");
    assert.match(granted.outcome ?? "", /git push/);
    const failed = await auditOf(h, "type=protected.failed");
    assert.ok(failed.some((e) => e.data.approvalId === view.id));
  });

  test("an agent never decides an approval: not through any route, not through the service, not in the database", async () => {
    queue.push(async (c) => {
      seen.third = await call("POST", `${c.env.ORBIT_AGENT_GATEWAY}/push`, {}, token(c));
      const asked = seen.third.body as AgentPushResult;
      seen.selfGrant = await call("POST", `${apiOf(c)}/governance/approvals/${asked.approvalId}/grant`, { fingerprint: asked.fingerprint }, { ...token(c), [MUTATION_HEADER]: "1" });
    });
    assert.equal((await turn(h, session.id, "Ask for the push again.")).status, "completed");
    const asked = seen.third?.body as AgentPushResult;
    assert.equal(asked.state, "pending", JSON.stringify(asked));
    assert.deepEqual([seen.selfGrant?.status, errorOf(seen.selfGrant)], [403, "agent_outside_gateway"]);
    const view = ok<ApprovalView>(await h.get(`/api/governance/approvals/${asked.approvalId}`));
    assert.deepEqual([view.requestedByType, view.state], ["agent", "pending"]);
    const binding = await h.app.get(RunBindingStore).get(h.accountId as string, view.runId as string);
    assert.ok(binding !== null, "the run that asked");
    await assert.rejects(h.app.get(ApprovalService).grant(contextOf({ kind: "agent", binding }), view.id, { fingerprint: view.fingerprint }), { code: "decider_not_a_person" });
    await assert.rejects(h.sql("UPDATE governance.approvals SET state = 'granted', decided_by = 'agent:claude-code', decided_by_type = 'agent', decided_at = now() WHERE id = $1", [view.id]), /violates check constraint/);
    assert.equal(ok<ApprovalView>(await h.get(`/api/governance/approvals/${view.id}`)).state, "pending");
    const refused = (await auditOf(h, "type=authz.denied")).filter((e) => e.data.action === "governance.approval.decide");
    assert.deepEqual(refused.map((e) => [e.principalType, e.data.cause, e.workspaceId]), [["agent", "not_a_person", session.id]]);
    // The owner rejects it: a settled approval stays settled, and what it is about never changes.
    assert.equal(ok<ApprovalView>(await h.send("POST", `/api/governance/approvals/${view.id}/reject`, { fingerprint: view.fingerprint })).state, "rejected");
    await assert.rejects(h.sql("UPDATE governance.approvals SET state = 'pending' WHERE id = $1", [view.id]), /a settled approval stays settled/);
    await assert.rejects(h.sql("UPDATE governance.approvals SET params = '{}'::jsonb WHERE id = $1", [view.id]), /an approval's action is fixed/);
  });

  test("once the account's policy simply allows git -- a high-risk change the owner acknowledged -- the agent's push is made at once, and nobody is asked", async () => {
    const allowing = await publish(h, "high", (c) => ({ ...c, rules: c.rules.map((r) => (r.action === "repository.push" ? { ...r, effect: "allow" as const } : r)) }));
    let fresh = ok<SessionSummary>(await h.send("POST", "/api/sessions", { repository: { source: "github", id: REPOSITORY }, branch: "main", model: "haiku" }));
    await waitStatus(h, fresh.id, ["ready"]);
    fresh = ok<SessionSummary>(await h.get(`/api/sessions/${fresh.id}`));
    const asked = ok<ApprovalList>(await h.get("/api/governance/approvals")).approvals.length;
    queue.push(async (c) => {
      writeFileSync(join(c.cwd, "sum.mjs"), "export const sum = (a, b) => a + b;\n");
      git(c.cwd, "commit", "-qam", "Fix the addition");
      seen.free = await call("POST", `${c.env.ORBIT_AGENT_GATEWAY}/push`, {}, token(c));
    });
    assert.equal((await turn(h, fresh.id, "Fix it, commit it and push it.")).status, "completed");
    assert.equal(seen.free?.status, 200, JSON.stringify(seen.free?.body));
    const free = seen.free?.body as AgentPushResult;
    assert.deepEqual([free.state, free.approvalId, free.decision.verdict, free.decision.policyRevision], ["pushed", null, "allow", allowing.id]);
    const head = git(join(h.dataDir, "workspaces", fresh.id, "repository"), "rev-parse", "HEAD").stdout.trim();
    assert.equal(remoteRef(remote, `refs/heads/${fresh.workBranch}`), head, "the commit is at the remote's branch");
    assert.equal(ok<ApprovalList>(await h.get("/api/governance/approvals")).approvals.length, asked, "no approval was asked for");
    const done = await auditOf(h, "type=protected.completed");
    assert.ok(done.some((e) => e.decisionId === free.decision.decisionId && e.workspaceId === fresh.id && e.principalType === "agent"), "recorded under the decision that allowed it");

    // What Allowed covers is the chat's own working branch: another branch of the workspace still waits for the owner.
    queue.push(async (c) => {
      git(c.cwd, "checkout", "-qb", "side");
      writeFileSync(join(c.cwd, "SIDE.md"), "side\n");
      git(c.cwd, "add", "SIDE.md");
      git(c.cwd, "commit", "-qm", "Side work");
      seen.side = await call("POST", `${c.env.ORBIT_AGENT_GATEWAY}/push`, { branch: "side" }, token(c));
      git(c.cwd, "checkout", "-q", fresh.workBranch as string);
    });
    assert.equal((await turn(h, fresh.id, "Push the side branch too.")).status, "completed");
    const side = seen.side?.body as AgentPushResult;
    assert.deepEqual([side.state, side.decision.verdict], ["pending", "allow"], JSON.stringify(side));
    assert.equal(remoteRef(remote, "refs/heads/side"), "", "the side branch was not pushed");

    // The owner's own push from the chat is made at once too: the policy allows it, and the chat is the owner's.
    const pushes = ok<AgentPushResult & { approval: ApprovalView | null }>(await h.send("POST", `/api/sessions/${fresh.id}/push`, {}));
    assert.deepEqual([pushes.state, pushes.approval], ["pushed", null], JSON.stringify(pushes));
  });

  test("what the policy denies is the runtime's configuration too: web tools it denies are refused to Claude Code", async () => {
    const narrower = await publish(h, "low", (c) => ({ ...c, rules: c.rules.map((r) => (r.id === "web-tools" ? { ...r, effect: "deny" as const } : r)) }));
    const { runId } = await turn(h, other.id, "Look it up.");
    const run = runs().at(-1)?.call as Call;
    for (const tool of ["WebFetch", "WebSearch"]) assert.ok(run.args.includes(tool), tool);
    assert.match(after1(run.args, "--append-system-prompt") ?? "", new RegExp(`\\(revision ${String(narrower.revision)}\\)`));
    const web = ok<DecisionList>(await h.get(`/api/governance/decisions?workspace=${other.id}&verdict=deny`)).decisions.find((d) => d.action === "tool.web" && d.runId === runId);
    assert.deepEqual([web?.policyRevision, web?.matchedRules], [narrower.id, ["account:web-tools"]]);
  });
});

describe("a research run is held to its account's policy too, as research", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let workspace: ResearchWorkspaceSummary;
  let session: ResearchSessionDetail;
  const researchRuns = () => fake.children.filter((c) => researchRun(c.call.file, c.call.args));

  before(async () => {
    fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(researchRun, { spawn: researchAnswer(() => "Nothing in the references answers that.") });
    h = await startHarness({ fake });
    workspace = await newWorkspace(h);
    session = ok<ResearchSessionDetail>(await h.send("POST", `/api/research/workspaces/${workspace.id}/sessions`, { model: "sonnet" }));
  });
  after(() => h.close());

  test("it is decided and bound under the account's revision in effect -- in the research scope, with no gateway", async () => {
    const policy = ok<PolicyOverview>(await h.get("/api/governance/policy")).effective as RevisionView;
    assert.equal((await h.send("POST", `/api/research/sessions/${session.id}/messages`, { text: "What do the sources say about isolation?" })).status, 202);
    assert.equal((await answered(h, session.id)).status, "completed");
    const started = (await auditOf(h, "type=run.started"))[0];
    assert.deepEqual([started?.principalType, started?.agentId, started?.workspaceId, started?.policyRevision, started?.data.scope, started?.data.startedBy, started?.data.mode], ["agent", "claude-research", workspace.id, policy.id, "ACCOUNT_RESEARCH", `owner:${h.accountId}`, "research"]);
    const decisions = ok<DecisionList>(await h.get(`/api/governance/decisions?workspace=${workspace.id}`)).decisions;
    assert.deepEqual(decisions.map((d) => [d.action, d.verdict, d.scope, d.policyRevision, d.principalType]), [["agent.run.start", "allow", "ACCOUNT_RESEARCH", policy.id, "agent"]]);
    const run = researchRuns().at(-1)?.call as Call;
    for (const name of ["ORBIT_AGENT_GATEWAY", "ORBIT_AGENT_TOKEN"]) assert.equal(name in run.env, false, `${name}: a research run has no gateway`);
    noDatabaseIn(h, run.env);
    const resources = ok<ResourceGovernanceList>(await h.get("/api/governance/research")).resources;
    assert.deepEqual(resources.map((r) => [r.kind, r.id, r.title]), [["research_workspace", workspace.id, workspace.name]]);
    const end = await finished(h, started?.runId as string);
    assert.equal(end?.data.status, "completed");
  });

  test("an override that narrows its research workspace refuses the next run before it starts", async () => {
    const set = ok<ResourceGovernanceView>(await h.send("PUT", `/api/governance/research/${workspace.id}/override`, { rules: [{ id: "no-research", action: "agent.run.start", effect: "deny" }] }));
    assert.deepEqual([set.kind, set.overridden, set.override?.override.metadata.level, set.override?.override.metadata.target], ["research_workspace", true, "research_workspace", workspace.id]);
    const before = researchRuns().length;
    assert.equal((await h.send("POST", `/api/research/sessions/${session.id}/messages`, { text: "And about egress?" })).status, 202);
    const failed = await eventually(async () => ok<ResearchSessionDetail>(await h.get(`/api/research/sessions/${session.id}`)), (s) => s.status === "failed");
    assert.match(failed.statusReason ?? "", /does not let this agent start a run here/);
    assert.equal(researchRuns().length, before, "Claude Code never started");
    const refused = (await auditOf(h, "type=run.refused"))[0];
    assert.deepEqual([refused?.workspaceId, refused?.reasonCodes, refused?.data.scope], [workspace.id, ["RULE_MATCHED", "OVERLAY_NARROWED"], "ACCOUNT_RESEARCH"]);
    assert.equal((await h.send("DELETE", `/api/governance/research/${workspace.id}/override`)).status, 204);
    assert.equal((await h.send("POST", `/api/research/sessions/${session.id}/messages`, { text: "And now?" })).status, 202);
    assert.equal((await answered(h, session.id)).status, "completed");
  });
});

describe("a push to Azure DevOps", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  const pushes = (file: string, args: string[]) => (file === "git" || file.endsWith("/git")) && args.includes("push") && args.some((a) => a.includes("dev.azure.com"));
  const lsRemote = (file: string, args: string[]) => (file === "git" || file.endsWith("/git")) && args.includes("ls-remote") && args.some((a) => a.includes("dev.azure.com"));
  const fetchRemote = (file: string, args: string[]) => (file === "git" || file.endsWith("/git")) && args.includes("fetch") && args.some((a) => a.includes("dev.azure.com"));

  before(async () => {
    fake = azureSignedIn(signedIn(new FakeProcessPort(new NodeProcessPort())))
      .on(lsRemote, { run: { stdout: "" } })
      .on(fetchRemote, { run: { code: 128, stderr: "unable to access (stand-in)" } })
      .on(pushes, { run: { code: 0, stderr: "To https://dev.azure.com/…\n * [new branch]\n" } });
    h = await startHarness({ fake });
  });
  after(() => h.close());

  test("is decided under the account's policy, approved by its owner, and made with the Azure CLI's one-shot helper to the repository's own URL", async () => {
    const created = ok<SessionSummary>(await h.send("POST", "/api/sessions", { repository: { source: "azure", id: AZURE_REPOSITORY }, branch: "main", model: "haiku" }));
    await waitStatus(h, created.id, ["ready"]);
    const session = ok<SessionSummary>(await h.get(`/api/sessions/${created.id}`));
    const workspace = join(h.dataDir, "workspaces", session.id, "repository");
    git(workspace, "commit", "-q", "--allow-empty", "-m", "Work");
    const asked = await h.send("POST", `/api/sessions/${session.id}/push`, {});
    assert.equal(asked.status, 200, JSON.stringify(asked.body));
    const view = (asked.body as { approval: ApprovalView }).approval;
    assert.match(String(view.params.repository), new RegExp(`^azure:${AZURE.organization}/`));
    assert.match(view.summary, /Azure DevOps/);
    assert.deepEqual([view.requestedBy, view.requestedByType], [`owner:${h.accountId}`, "human"]);
    const done = ok<ApprovalView>(await h.send("POST", `/api/governance/approvals/${view.id}/grant`, { fingerprint: view.fingerprint }));
    assert.equal(done.state, "consumed", JSON.stringify(done));
    const push = fake.callsOf(pushes).at(-1) as Call;
    assert.ok(push.args.includes(`credential.helper=${h.config.binaries.azureGitHelper}`), "the one-shot helper answers");
    assert.ok(push.args.includes("credential.helper="), "and no other helper does");
    assert.equal(push.args.includes("--force") || push.args.some((a) => a.startsWith("--force")), false, "never forced");
    assert.equal(push.args.at(-1), `${git(workspace, "rev-parse", "HEAD").stdout.trim()}:refs/heads/${session.workBranch}`);
    assert.equal(push.env.AZURE_CONFIG_DIR, h.config.data.azure);
    assert.equal(push.cwd, join(h.dataDir, "repos", `${session.id}.git`), "from Orbit Web's own copy, never the workspace");
  });
});
