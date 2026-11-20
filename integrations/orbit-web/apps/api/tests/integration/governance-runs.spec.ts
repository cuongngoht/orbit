// A GOVERNED WORKSPACE, ITS AGENT, AND ITS PUSH -- through the real API, with Claude Code stood in for by a script that
// behaves as a misled agent would: it calls Orbit Web's own API from its shell. The run is decided before it starts
// (refused where isolation is required and not proven), bound to its agent, and handed no sign-in; the agent cannot
// turn a credential switch on, reach governance, or read a credential; its push waits for a person, who approves the
// exact commit; Orbit Web pushes it to the repository (a local bare repository here) and refuses it a second time. Once
// the Constitution simply allows git, the agent's push is made at once, with nobody asked.
// Azure DevOps pushes the same way, with the Azure CLI's one-shot helper.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import type { AgentPushResult, AgentWhoAmI, ApprovalList, ApprovalView, AuditPage, FindingList, RevisionView, SessionDetail, SessionSummary } from "@orbit-web/contracts";
import type { Constitution } from "@orbit-web/governance-core";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { FakeProcessPort, program, type Call, type FakeChild } from "../../src/testing/fake-process.js";
import { AZURE, AZURE_REPOSITORY, azureSignedIn, claudeRun, eventually, REPOSITORY, signedIn, startHarness, type Harness, type OperatorClient, type Reply } from "../../src/testing/harness.js";

const code = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
const after1 = (args: string[], flag: string): string | null => (args.includes(flag) ? (args[args.indexOf(flag) + 1] ?? null) : null);
const git = (cwd: string, ...args: string[]) => spawnSync("git", ["-c", "user.name=Agent", "-c", "user.email=agent@example.com", ...args], { cwd, encoding: "utf8" });

interface Probe {
  status: number;
  body: unknown;
}

// What the agent's shell would do: call Orbit Web, as the run's own environment lets it.
async function call(_env: Record<string, string>, method: string, url: string, body?: unknown, extra: Record<string, string> = {}): Promise<Probe> {
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

async function publish(author: OperatorClient, approver: OperatorClient, edit?: (c: Constitution) => Constitution): Promise<RevisionView> {
  const draft = (await author.send("POST", "/api/governance/revisions", {})).body as RevisionView;
  const saved = edit === undefined ? draft : ((await author.send("PUT", `/api/governance/revisions/${draft.id}`, { document: edit(draft.document as Constitution), expectedDigest: draft.digest })).body as RevisionView);
  assert.equal((await author.send("POST", `/api/governance/revisions/${saved.id}/validate`)).status, 200);
  const pending = (await author.send("POST", `/api/governance/revisions/${saved.id}/request-approval`)).body as RevisionView;
  assert.equal((await approver.send("POST", `/api/governance/revisions/${saved.id}/approve`, { digest: pending.digest })).status, 200);
  const published = (await author.send("POST", `/api/governance/revisions/${saved.id}/publish`, { digest: pending.digest })).body as RevisionView;
  assert.equal(published.state, "PUBLISHED");
  return published;
}

const waitStatus = (h: Harness, id: string, statuses: string[]) => eventually(async () => ((await h.get(`/api/sessions/${id}`)).body as SessionDetail).status, (s) => statuses.includes(s));

describe("a governed workspace, its agent, and its push (GitHub)", () => {
  let h: Harness;
  let fake: FakeProcessPort;
  let owner: OperatorClient;
  let approver: OperatorClient;
  let session: SessionSummary;
  let other: SessionSummary;
  let remotes: string;
  let remote: string;
  let agentId: string;
  const queue: Behaviour[] = [];
  const seen: Record<string, Probe> = {};
  let runEnv: Record<string, string> = {};
  let pushed: AgentPushResult;

  before(async () => {
    remotes = mkdtempSync(join(tmpdir(), "orbit-web-remotes-"));
    remote = join(remotes, "octo", "sum-fixture.git");
    mkdirSync(join(remotes, "octo"), { recursive: true });
    spawnSync("git", ["init", "--bare", "-q", "-b", "main", remote]);
    fake = signedIn(new FakeProcessPort(new NodeProcessPort())).on(claudeRun, { spawn: scripted(queue) });
    h = await startHarness({ fake, env: { ORBIT_WEB_GITHUB_URL: `file://${remotes}` } });
    owner = await h.owner();
    await owner.send("POST", "/api/governance/operators", { username: "april", password: "april has a long password", roles: ["policy_approver"] });
    approver = await h.signIn("april", "april has a long password");
    await publish(owner, owner);
    session = (await h.send("POST", "/api/sessions", { repository: { source: "github", id: REPOSITORY }, branch: "main", model: "haiku" })).body as SessionSummary;
    other = (await h.send("POST", "/api/sessions", { repository: null, model: "haiku" })).body as SessionSummary;
    await waitStatus(h, session.id, ["ready"]);
    await waitStatus(h, other.id, ["ready"]);
    // Read again once prepared: its working branch is set then.
    session = (await h.get(`/api/sessions/${session.id}`)).body as SessionSummary;
    agentId = ((await owner.send("POST", "/api/governance/agents", { name: "Claude Code" })).body as { id: string }).id;
    for (const s of [session, other]) assert.equal((await owner.send("PUT", `/api/governance/workspaces/${s.id}`, { agentId, profile: "strict" })).status, 200);
  });
  after(async () => {
    await h.close();
    rmSync(remotes, { recursive: true, force: true });
  });

  test("where the Constitution requires isolation and it is not proven (one container), the run is refused, said and recorded", async () => {
    const before = fake.children.length;
    assert.equal((await h.send("POST", `/api/sessions/${session.id}/messages`, { text: "Fix it." })).status, 202);
    const failed = await waitStatus(h, session.id, ["failed"]);
    assert.equal(failed, "failed");
    assert.equal(fake.children.slice(before).filter((c) => claudeRun(c.call.file, c.call.args)).length, 0, "Claude Code never started");
    const detail = (await h.get(`/api/sessions/${session.id}`)).body as SessionDetail;
    assert.match(detail.statusReason ?? "", /isolation is not proven/);
    const refused = ((await owner.get("/api/governance/audit?type=run.refused")).body as AuditPage).events;
    assert.deepEqual(refused.map((e) => [e.workspaceId, e.reasonCodes]), [[session.id, ["ISOLATION_NOT_PROVEN"]]]);
  });

  test("once the Constitution makes isolation optional -- a high-risk change another person approved -- the run starts bound to its agent and holding no sign-in", async () => {
    const revision = await publish(owner, approver, (c) => ({ ...c, obligations: { ...c.obligations, isolation: "optional" } }));
    assert.equal(revision.risk, "high");
    queue.push(async (c) => {
      runEnv = c.env;
      const gw = c.env.ORBIT_AGENT_GATEWAY as string;
      const token = { "x-orbit-run-token": c.env.ORBIT_AGENT_TOKEN as string };
      const api = gw.replace(/\/api\/agent$/, "/api");
      seen.whoami = await call(c.env, "GET", `${gw}/whoami`, undefined, token);
      // The misled agent reaches for authority: with its token, and without.
      seen.switchWithToken = await call(c.env, "PATCH", `${api}/settings`, { githubForClaude: true }, { ...token, "x-orbit-web": "1" });
      seen.switchWithout = await call(c.env, "PATCH", `${api}/settings`, { githubForClaude: true, azureForClaude: true }, { "x-orbit-web": "1" });
      seen.operators = await call(c.env, "GET", `${api}/governance/operators`, undefined, token);
      seen.publish = await call(c.env, "POST", `${api}/governance/revisions`, {}, { ...token, "x-orbit-web": "1" });
      seen.selfOwner = await call(c.env, "POST", `${api}/governance/operators`, { username: "agent", password: "agent's own password", roles: ["organization_owner"] }, { "x-orbit-web": "1" });
      seen.credential = await call(c.env, "POST", `${gw}/decisions`, { action: "credential.read_raw", resource: "github" }, token);
      // The work, committed, and its push asked for.
      writeFileSync(join(c.cwd, "sum.mjs"), "export const sum = (a, b) => a + b;\n");
      git(c.cwd, "commit", "-qam", "Fix the addition");
      seen.push = await call(c.env, "POST", `${gw}/push`, {}, token);
    });
    assert.equal((await h.send("POST", `/api/sessions/${session.id}/messages`, { text: "Fix it, commit it, and ask for it to be pushed." })).status, 202);
    await waitStatus(h, session.id, ["completed"]);
    const run = fake.children.filter((c) => claudeRun(c.call.file, c.call.args)).at(-1)?.call as Call;
    assert.match(runEnv.ORBIT_AGENT_TOKEN ?? "", /^[A-Za-z0-9_-]{43}$/);
    for (const name of ["GH_CONFIG_DIR", "AZURE_CONFIG_DIR", "GIT_CONFIG_COUNT", "GH_TOKEN"]) assert.equal(name in runEnv, false, `${name} never reaches a governed run`);
    assert.ok(run.args.includes("WebFetch"), "the default Constitution denies the web tools: they are refused to the runtime");
    assert.ok(run.args.includes("Bash(git push:*)"));
    assert.match(after1(run.args, "--append-system-prompt") ?? "", /GOVERNED by your organization's Constitution \(revision 2\)/);
    const who = seen.whoami?.body as AgentWhoAmI;
    assert.deepEqual([who.agentId, who.workspaceId, who.scope, who.policyRevision], [agentId, session.id, "GOVERNED_WORKSPACE", revision.id]);
    assert.deepEqual([seen.switchWithToken?.status, code({ status: 0, body: seen.switchWithToken?.body, headers: new Headers() })], [403, "agent_outside_gateway"]);
    assert.deepEqual([seen.switchWithout?.status, code({ status: 0, body: seen.switchWithout?.body, headers: new Headers() })], [403, "operator_required"]);
    assert.equal(seen.operators?.status, 403);
    assert.equal(seen.publish?.status, 403);
    assert.equal(seen.selfOwner?.status, 401);
    assert.equal((seen.credential?.body as { verdict: string }).verdict, "deny");
    pushed = seen.push?.body as AgentPushResult;
    assert.equal(seen.push?.status, 200, JSON.stringify(seen.push?.body));
    assert.deepEqual([pushed.state, pushed.decision.verdict], ["pending", "require_approval"]);
    assert.match(pushed.fingerprint ?? "", /^[0-9a-f]{64}$/);
    // Nothing the agent tried changed anything.
    const settings = (await h.get("/api/settings")).body as { githubForClaude: boolean; azureForClaude: boolean };
    assert.deepEqual([settings.githubForClaude, settings.azureForClaude], [false, false]);
    assert.equal(spawnSync("git", ["--git-dir", remote, "for-each-ref"], { encoding: "utf8" }).stdout, "", "nothing was pushed by asking");
    // The run's token ended with the run.
    const late = await call(runEnv, "GET", `${runEnv.ORBIT_AGENT_GATEWAY}/whoami`, undefined, { "x-orbit-run-token": runEnv.ORBIT_AGENT_TOKEN as string });
    assert.equal(late.status, 401);
    const types = ((await owner.get("/api/governance/audit?limit=200")).body as AuditPage).events.map((e) => e.eventType);
    for (const t of ["run.started", "run.finished", "boundary.violation", "settings.privileged.refused", "approval.requested"]) assert.ok(types.includes(t as never), t);
  });

  test("a person approves the exact push; Orbit Web pushes it -- and refuses it a second time", async () => {
    const approvals = ((await owner.get("/api/governance/approvals")).body as ApprovalList).approvals;
    const a = approvals.find((x) => x.id === pushed.approvalId) as ApprovalView;
    const head = git(join(h.dataDir, "workspaces", session.id, "repository"), "rev-parse", "HEAD").stdout.trim();
    assert.deepEqual([a.state, a.action, a.params.commit, a.params.ref, a.params.force, a.params.expectedRemoteOid], ["pending", "repository.push", head, `refs/heads/${session.workBranch}`, false, null]);
    assert.ok((a.change?.commits ?? 0) >= 1);
    const wrong = await owner.send("POST", `/api/governance/approvals/${a.id}/grant`, { fingerprint: "0".repeat(64) });
    assert.deepEqual([wrong.status, code(wrong)], [409, "fingerprint_mismatch"]);
    const granted = await owner.send("POST", `/api/governance/approvals/${a.id}/grant`, { fingerprint: a.fingerprint });
    assert.equal(granted.status, 200, JSON.stringify(granted.body));
    const done = granted.body as ApprovalView;
    assert.deepEqual([done.state, done.outcome?.startsWith("pushed")], ["consumed", true]);
    const remoteHead = spawnSync("git", ["--git-dir", remote, "rev-parse", `refs/heads/${session.workBranch}`], { encoding: "utf8" }).stdout.trim();
    assert.equal(remoteHead, head, "the approved commit is at the remote's branch");
    const replay = await owner.send("POST", `/api/governance/approvals/${a.id}/execute`);
    assert.deepEqual([replay.status, code(replay)], [409, "approval_consumed"]);
    const kinds = ((await owner.get("/api/governance/findings")).body as FindingList).findings.map((f) => `${f.kind}/${f.status}`);
    for (const k of ["APPROVAL_REPLAY/CONFIRMED", "AGENT_PRIVILEGE_ESCALATION/CONFIRMED", "CREDENTIAL_ACCESS_ATTEMPT/CONFIRMED"]) assert.ok(kinds.includes(k), `${k} in ${kinds.join(",")}`);
  });

  test("an agent replaying an approval, or reaching for another workspace's, is refused and recorded", async () => {
    queue.push(async (c) => {
      seen.replay = await call(c.env, "POST", `${c.env.ORBIT_AGENT_GATEWAY}/approvals/${pushed.approvalId}/execute`, undefined, { "x-orbit-run-token": c.env.ORBIT_AGENT_TOKEN as string });
    });
    await h.send("POST", `/api/sessions/${session.id}/messages`, { text: "Push it again." });
    await waitStatus(h, session.id, ["completed"]);
    assert.deepEqual([seen.replay?.status, (seen.replay?.body as { error: { code: string } }).error.code], [409, "approval_consumed"]);
    queue.push(async (c) => {
      seen.across = await call(c.env, "GET", `${c.env.ORBIT_AGENT_GATEWAY}/approvals/${pushed.approvalId}`, undefined, { "x-orbit-run-token": c.env.ORBIT_AGENT_TOKEN as string });
      seen.acrossExecute = await call(c.env, "POST", `${c.env.ORBIT_AGENT_GATEWAY}/approvals/${pushed.approvalId}/execute`, undefined, { "x-orbit-run-token": c.env.ORBIT_AGENT_TOKEN as string });
      seen.noRepo = await call(c.env, "POST", `${c.env.ORBIT_AGENT_GATEWAY}/push`, {}, { "x-orbit-run-token": c.env.ORBIT_AGENT_TOKEN as string });
    });
    await h.send("POST", `/api/sessions/${other.id}/messages`, { text: "Look around." });
    await waitStatus(h, other.id, ["completed"]);
    assert.deepEqual([seen.across?.status, seen.acrossExecute?.status], [403, 403]);
    assert.equal((seen.noRepo?.body as { error: { code: string } }).error.code, "no_repository");
    const kinds = ((await owner.get("/api/governance/findings")).body as FindingList).findings.map((f) => f.kind);
    assert.ok(kinds.includes("CROSS_WORKSPACE_ACCESS"));
  });

  test("a remote that moved after the approval is never pushed over: the approval no longer matches", async () => {
    queue.push(async (c) => {
      writeFileSync(join(c.cwd, "NOTES.md"), "more\n");
      git(c.cwd, "add", "NOTES.md");
      git(c.cwd, "commit", "-qm", "More");
      seen.second = await call(c.env, "POST", `${c.env.ORBIT_AGENT_GATEWAY}/push`, {}, { "x-orbit-run-token": c.env.ORBIT_AGENT_TOKEN as string });
    });
    await h.send("POST", `/api/sessions/${session.id}/messages`, { text: "One more change." });
    await waitStatus(h, session.id, ["completed"]);
    const second = seen.second?.body as AgentPushResult;
    assert.equal(second.state, "pending");
    // Somebody else pushes to that branch meanwhile.
    const elsewhere = mkdtempSync(join(tmpdir(), "elsewhere-"));
    git(elsewhere, "clone", "-q", remote, "w");
    git(join(elsewhere, "w"), "checkout", "-q", session.workBranch as string);
    git(join(elsewhere, "w"), "commit", "-q", "--allow-empty", "-m", "Someone else");
    git(join(elsewhere, "w"), "push", "-q", "origin", session.workBranch as string);
    const theirs = spawnSync("git", ["--git-dir", remote, "rev-parse", `refs/heads/${session.workBranch}`], { encoding: "utf8" }).stdout.trim();
    const r = await owner.send("POST", `/api/governance/approvals/${second.approvalId}/grant`, { fingerprint: second.fingerprint });
    assert.deepEqual([r.status, code(r)], [409, "fingerprint_mismatch"]);
    assert.equal(spawnSync("git", ["--git-dir", remote, "rev-parse", `refs/heads/${session.workBranch}`], { encoding: "utf8" }).stdout.trim(), theirs, "their work stays");
    rmSync(elsewhere, { recursive: true, force: true });
  });

  test("a person's push from the chat needs an operator; an agent cannot ask for it there", async () => {
    assert.equal(code(await h.send("POST", `/api/sessions/${session.id}/push`, {})), "operator_required");
    const asked = await owner.send("POST", `/api/sessions/${session.id}/push`, {});
    assert.equal(asked.status, 200, JSON.stringify(asked.body));
    const view = (asked.body as { approval: ApprovalView }).approval;
    assert.equal(view.state, "pending");
    assert.equal(view.requestedBy, owner.state.session?.operator.id);
    const pushes = ((await owner.get(`/api/sessions/${session.id}/pushes`)).body as ApprovalList).approvals;
    assert.ok(pushes.some((p) => p.id === view.id));
    // Not a fast-forward of what somebody else pushed: git refuses it, and nothing is overwritten.
    const granted = (await owner.send("POST", `/api/governance/approvals/${view.id}/grant`, { fingerprint: view.fingerprint })).body as ApprovalView;
    assert.equal(granted.state, "consumed");
    assert.match(granted.outcome ?? "", /git push/);
    const failed = ((await owner.get("/api/governance/audit?type=protected.failed")).body as AuditPage).events;
    assert.ok(failed.some((e) => e.data.approvalId === view.id));
  });

  test("once the Constitution simply allows git -- Allowed ticked alone, a high-risk change another person approved -- the agent's push is made at once, and nobody is asked", async () => {
    const revision = await publish(owner, approver, (c) => ({ ...c, rules: c.rules.map((r) => (r.action === "repository.push" ? { ...r, effect: "allow" as const } : r)) }));
    assert.equal(revision.risk, "high");
    let fresh = (await h.send("POST", "/api/sessions", { repository: { source: "github", id: REPOSITORY }, branch: "main", model: "haiku" })).body as SessionSummary;
    await waitStatus(h, fresh.id, ["ready"]);
    fresh = (await h.get(`/api/sessions/${fresh.id}`)).body as SessionSummary;
    assert.equal((await owner.send("PUT", `/api/governance/workspaces/${fresh.id}`, { agentId, profile: "strict" })).status, 200);
    const asked = ((await owner.get("/api/governance/approvals")).body as ApprovalList).approvals.length;
    queue.push(async (c) => {
      writeFileSync(join(c.cwd, "sum.mjs"), "export const sum = (a, b) => a + b;\n");
      git(c.cwd, "commit", "-qam", "Fix the addition");
      seen.free = await call(c.env, "POST", `${c.env.ORBIT_AGENT_GATEWAY}/push`, {}, { "x-orbit-run-token": c.env.ORBIT_AGENT_TOKEN as string });
    });
    assert.equal((await h.send("POST", `/api/sessions/${fresh.id}/messages`, { text: "Fix it, commit it and push it." })).status, 202);
    await waitStatus(h, fresh.id, ["completed"]);
    assert.equal(seen.free?.status, 200, JSON.stringify(seen.free?.body));
    const free = seen.free?.body as AgentPushResult;
    assert.deepEqual([free.state, free.approvalId, free.decision.verdict], ["pushed", null, "allow"]);
    const head = git(join(h.dataDir, "workspaces", fresh.id, "repository"), "rev-parse", "HEAD").stdout.trim();
    assert.equal(spawnSync("git", ["--git-dir", remote, "rev-parse", `refs/heads/${fresh.workBranch}`], { encoding: "utf8" }).stdout.trim(), head, "the commit is at the remote's branch");
    assert.equal(((await owner.get("/api/governance/approvals")).body as ApprovalList).approvals.length, asked, "no approval was asked for");
    const done = ((await owner.get("/api/governance/audit?type=protected.completed")).body as AuditPage).events;
    assert.ok(done.some((e) => e.decisionId === free.decision.decisionId && e.workspaceId === fresh.id && e.principalType === "agent"), "recorded under the decision that allowed it");
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

  test("is decided, approved, and made with the Azure CLI's one-shot helper to the repository's own URL", async () => {
    const owner = await h.owner();
    await publish(owner, owner);
    const created = (await h.send("POST", "/api/sessions", { repository: { source: "azure", id: AZURE_REPOSITORY }, branch: "main", model: "haiku" })).body as SessionSummary;
    await waitStatus(h, created.id, ["ready"]);
    const session = (await h.get(`/api/sessions/${created.id}`)).body as SessionSummary;
    const workspace = join(h.dataDir, "workspaces", session.id, "repository");
    git(workspace, "commit", "-q", "--allow-empty", "-m", "Work");
    const asked = await owner.send("POST", `/api/sessions/${session.id}/push`, {});
    assert.equal(asked.status, 200, JSON.stringify(asked.body));
    const view = (asked.body as { approval: ApprovalView }).approval;
    assert.match(String(view.params.repository), new RegExp(`^azure:${AZURE.organization}/`));
    assert.match(view.summary, /Azure DevOps/);
    const done = (await owner.send("POST", `/api/governance/approvals/${view.id}/grant`, { fingerprint: view.fingerprint })).body as ApprovalView;
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

void program;
