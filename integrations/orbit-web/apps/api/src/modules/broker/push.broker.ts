// THE PUSH BROKER: how a chat's branch reaches its repository -- GitHub or Azure DevOps -- when the agent holds no
// credential. Asked by the agent (its gateway) or by a person (the chat's Push), it does the same thing:
//
//   1. the commit the branch is at, read by the agent's own git in the workspace;
//   2. that commit, as a bundle the agent's git writes, fetched into the control plane's own copy of the repository
//      (/data/repos/<session>.git) with every object checked -- the workspace's .git is never read here;
//   3. where the branch stands at the remote now (asked with the source's own sign-in);
//   4. a DECISION of the Constitution on `repository.push` with exactly these parameters -- repository, remote, ref,
//      commit, force (never), and the remote's commit the push expects to replace -- whose fingerprint an approval is
//      bound to. Git is the Constitution's to decide, for an agent as for a person: where it simply ALLOWS the push,
//      step 5 is skipped and the push is made at once, recorded under that decision;
//   5. otherwise a person approves that fingerprint (Governance → Approvals, or the chat's Push), and the approval is
//      SPENT before the push, against the fingerprint taken again from the copy and the remote just then: a branch that
//      moved, a remote that moved, or an approval presented twice is refused and recorded;
//   6. the control plane pushes the commit from its copy with the source's credential -- never forced: what is not a
//      fast-forward of the remote's branch is refused by git, so nobody's work there is overwritten.
//
// It is the approvals' executor for repository.push (approvals.service.ts).
import { HttpStatus, Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { fingerprintOf, type Environment, type EnforcementScope } from "@orbit-web/governance-core";
import { checkAgentPush, isBranchName, type AgentPushResult, type ApprovalView } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { accepted, ApiError, badRequest, conflict, notFound } from "../../common/errors.js";
import { sha256, type ApprovalRecord } from "../../infra/governance/stores.js";
import { endedHow, succeeded, type RunResult } from "../../infra/process/process.port.js";
import { redactSecrets, tail } from "../../infra/security/redact.js";
import { SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import { GitGateway } from "../changes/git.gateway.js";
import { ApprovalService, type ExecutionResult, type Executor } from "../governance/approvals.service.js";
import { AuditService } from "../governance/audit.service.js";
import type { GovernanceContext } from "../governance/principal.js";
import { PolicyService, type Decision } from "../governance/policy.service.js";
import { pushRefusal } from "./push-target.js";
import { MirrorService } from "../sources/mirror.service.js";
import { SourcesService } from "../sources/sources.module.js";

// The largest bundle a push may bring over (what is new since the copy's base).
const MAX_BUNDLE = 512 * 1024 * 1024;
// What a push is, to the Constitution: never production (that is a deployment's), never "local" either.
const PUSH_ENVIRONMENT: Environment = "development";

const fail = (status: number, code: string, what: string, r?: RunResult): ApiError => new ApiError(status, code, r === undefined ? what : `${what} ${endedHow(r)}: ${redactSecrets(tail(r.stderr || r.stdout, 3))}`);

export interface PushParams {
  repository: string;
  remote: string;
  ref: string;
  commit: string;
  force: false;
  expectedRemoteOid: string | null;
}

@Injectable()
export class PushBroker implements Executor, OnModuleInit {
  private readonly logger = new Logger("PushBroker");

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(GitGateway) private readonly git: GitGateway,
    @Inject(MirrorService) private readonly mirror: MirrorService,
    @Inject(SourcesService) private readonly sources: SourcesService,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.approvals.registerExecutor("repository.push", this);
  }

  // Steps 1-4 (and 5's request): what a push of this chat's branch would be, decided, and then pushed at once where the
  // Constitution allows it, or waiting for a person where it asks for one.
  async request(ctx: GovernanceContext, session: SessionRecord, body: unknown, scope: EnforcementScope): Promise<AgentPushResult & { approval: ApprovalView | null }> {
    const req = accepted(checkAgentPush(body));
    if (session.source === null || session.repositoryId === null || session.branch === null) throw conflict("no_repository", "This chat has no repository to push to.");
    const branch = req.branch ?? session.workBranch;
    if (branch === null || !isBranchName(branch)) throw badRequest("branch must name a branch of the workspace");
    await this.refuseProtectedBranch(session, branch);
    const commit = await this.commitOf(session, branch, req.commit ?? null);
    const intoRef = await this.carry(session, branch, commit);
    const remoteHead = await this.mirror.remoteHead(session, branch);
    if (!remoteHead.ok) throw new ApiError(HttpStatus.BAD_GATEWAY, "remote_unreachable", `The repository could not be asked where ${branch} stands: ${redactSecrets(remoteHead.detail)}`);
    const remote = await this.mirror.remoteOf(session);
    const params: PushParams = { repository: `${session.source}:${remote.name}`, remote: remote.url, ref: `refs/heads/${branch}`, commit, force: false, expectedRemoteOid: remoteHead.oid };
    const decision = this.policy.decide(ctx, { action: "repository.push", resource: params.repository, environment: PUSH_ENVIRONMENT, scope, workspaceId: session.id, params: { ...params } });
    const said = { decisionId: decision.decisionId, verdict: decision.verdict, reasonCodes: decision.reasonCodes, enforcement: decision.enforcement, policyRevision: decision.policyRevision };
    if (decision.verdict === "deny") throw new ApiError(HttpStatus.FORBIDDEN, "push_denied", `The Constitution in effect does not allow pushing to ${remote.name} (${decision.reasonCodes.join(", ")}). Decision ${decision.decisionId}.`, said);
    const change = await this.changeOf(session, commit);
    if (decision.verdict === "allow") return this.pushNow(ctx, session, { commit, branch, remote: remote.name }, decision, said);
    const binding = ctx.principal.kind === "agent" ? ctx.principal.binding : null;
    const approval = this.approvals.request(ctx, {
      action: "repository.push",
      environment: PUSH_ENVIRONMENT,
      fingerprint: decision.fingerprint as string,
      params: { ...params, branch, sourceRef: intoRef, sessionId: session.id },
      summary: `Push ${commit.slice(0, 12)} to ${branch} of ${remote.name} (${session.source === "github" ? "GitHub" : "Azure DevOps"})${change === null ? "" : `: ${change.commits} commit(s), ${change.files} file(s)`}`,
      decisionId: decision.decisionId,
      workspaceId: session.id,
      agentId: binding?.agentId ?? null,
      runId: binding?.runId ?? null,
      change,
    });
    const view = this.approvals.view(approval.id);
    const message = view.state === "pending" ? `A person approves this exact push (${view.fingerprint.slice(0, 16)}) in Orbit Web; Orbit Web then pushes it. Nothing was pushed yet.` : `This push was already asked for: it is ${view.state}.`;
    return { approvalId: view.id, state: view.state, fingerprint: view.fingerprint, decision: said, message, approval: view };
  }

  // Step 6 with no step 5: the Constitution in effect simply allows this push, so nobody is asked. What happened is
  // recorded as an approved push's is -- started, then finished or failed -- under the decision that allowed it.
  private async pushNow(ctx: GovernanceContext, session: SessionRecord, push: { commit: string; branch: string; remote: string }, decision: Decision, said: AgentPushResult["decision"]): Promise<AgentPushResult & { approval: null }> {
    const fingerprint = decision.fingerprint as string;
    const about = { decisionId: decision.decisionId, workspaceId: session.id };
    this.audit.record(ctx, { type: "protected.executing", outcome: "executing", ...about, data: { action: "repository.push", fingerprint } });
    const r = await this.mirror.push(session, push.commit, push.branch);
    if (!succeeded(r)) {
      const cause = `git push ${endedHow(r)}: ${redactSecrets(tail(r.stderr || r.stdout, 3))}`;
      this.audit.record(ctx, { type: "protected.failed", outcome: "failed", ...about, data: { action: "repository.push", fingerprint, cause } });
      throw new ApiError(HttpStatus.BAD_GATEWAY, "push_failed", `Nothing was pushed: ${cause}`, said);
    }
    this.audit.record(ctx, { type: "protected.completed", outcome: "completed", ...about, data: { action: "repository.push", fingerprint } });
    this.logger.log(`pushed ${push.commit.slice(0, 12)} to ${push.branch} of session ${session.id} (allowed by ${decision.decisionId})`);
    return { approvalId: null, state: "pushed", fingerprint, decision: said, message: `Pushed ${push.commit.slice(0, 12)} to ${push.branch} of ${push.remote}: the Constitution in effect allows it, so nobody was asked.`, approval: null };
  }

  // ---- the executor -------------------------------------------------------------------------------------------------

  // The push as it stands NOW -- the commit in the copy, the remote's branch -- hashed as the approval was.
  async fingerprintNow(approval: ApprovalRecord): Promise<string> {
    const session = this.sessionOf(approval);
    const remote = await this.mirror.remoteOf(session);
    const branch = String(approval.params.branch);
    const commit = await this.mirror.revParse(session.id, String(approval.params.sourceRef));
    const head = await this.mirror.remoteHead(session, branch);
    const params: PushParams = { repository: `${session.source}:${remote.name}`, remote: remote.url, ref: `refs/heads/${branch}`, commit: commit.stdout.trim(), force: false, expectedRemoteOid: head.ok ? head.oid : "unreachable" };
    return fingerprintOf("repository.push", approval.environment as Environment, { ...params }, sha256);
  }

  async run(_ctx: GovernanceContext, approval: ApprovalRecord): Promise<ExecutionResult> {
    const session = this.sessionOf(approval);
    const branch = String(approval.params.branch);
    const commit = String(approval.params.commit);
    const r = await this.mirror.push(session, commit, branch);
    if (!succeeded(r)) return { ok: false, outcome: `git push ${endedHow(r)}: ${redactSecrets(tail(r.stderr || r.stdout, 3))}` };
    this.logger.log(`pushed ${commit.slice(0, 12)} to ${branch} of session ${session.id}`);
    return { ok: true, outcome: `pushed ${commit.slice(0, 12)} to ${branch}` };
  }

  // ---- steps ------------------------------------------------------------------------------------------------------

  // Where the branch may go is push-target.ts's to decide (never the default, never a protected branch, nothing when
  // the default is unknown); this asks the source and the remote what it needs to.
  private async refuseProtectedBranch(session: SessionRecord, branch: string): Promise<void> {
    const listed = await this.sources.branches(session.source as "github" | "azure", session.repositoryId as string).catch((err: unknown) => {
      throw new ApiError(HttpStatus.BAD_GATEWAY, "branches_unavailable", `The repository's branches could not be read, so nothing is pushed: ${err instanceof Error ? err.message : String(err)}`);
    });
    const remote = await this.mirror.remoteDefault(session);
    const defaults = [listed.branches.find((b) => b.isDefault)?.name ?? null, remote.ok ? remote.branch : null].filter((b): b is string => b !== null);
    const refusal = pushRefusal(branch, defaults, listed.branches);
    if (refusal !== null) throw refusal;
  }

  private async commitOf(session: SessionRecord, branch: string, expected: string | null): Promise<string> {
    const r = await this.git.git(session.workspacePath, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`]);
    const commit = r.stdout.trim();
    if (!succeeded(r) || !/^[0-9a-f]{40}$/.test(commit)) throw notFound(`The branch ${branch} of this workspace`);
    if (expected !== null && expected !== commit) throw conflict("commit_moved", `${branch} is at ${commit.slice(0, 12)}, not ${expected.slice(0, 12)}: ask again for the commit it is at.`);
    return commit;
  }

  // The commit, carried into the control plane's own copy: the copy first catches up with the remote's base (best
  // effort, with the source's sign-in), then the agent's git bundles what is newer than what the copy has.
  private async carry(session: SessionRecord, branch: string, commit: string): Promise<string> {
    const made = await this.mirror.ensure(session.id);
    if (made !== null && !succeeded(made)) throw fail(HttpStatus.BAD_GATEWAY, "copy_failed", "Orbit Web's copy of the repository could not be made:", made);
    const fetched = await this.mirror.fetch(session, session.branch as string).catch(() => null);
    if (fetched !== null && !succeeded(fetched)) this.logger.warn(`the base of ${session.id} could not be fetched: ${endedHow(fetched)}`);
    const base = session.baseCommit !== null && succeeded(await this.mirror.revParse(session.id, session.baseCommit)) ? session.baseCommit : null;
    if (base === commit) throw conflict("nothing_to_push", "This branch has no commit beyond where the chat started: commit the work first.");
    const bundle = await this.git.bundle(session.workspacePath, branch, MAX_BUNDLE, base);
    const ended: RunResult = { ...bundle, stdout: "" };
    if (!succeeded(ended)) throw fail(HttpStatus.BAD_GATEWAY, "bundle_failed", "The workspace's git could not bundle the branch:", ended);
    if (bundle.truncated) throw new ApiError(HttpStatus.PAYLOAD_TOO_LARGE, "bundle_too_large", "What this push would carry is larger than Orbit Web carries at once.");
    const dir = join(this.config.data.control, "bundles");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const file = join(dir, `${id}.bundle`);
    writeFileSync(file, bundle.stdout, { flag: "wx", mode: 0o600 });
    const intoRef = `refs/orbit/push/${id}`;
    try {
      const r = await this.mirror.fetchBundle(session.id, file, branch, intoRef);
      if (!succeeded(r)) throw fail(HttpStatus.UNPROCESSABLE_ENTITY, "bundle_refused", "The commit could not be taken into Orbit Web's copy:", r);
    } finally {
      rmSync(file, { force: true });
    }
    const carried = (await this.mirror.revParse(session.id, intoRef)).stdout.trim();
    if (carried !== commit) throw conflict("bundle_mismatch", "What the workspace's git bundled is not the commit its branch is at.");
    return intoRef;
  }

  private async changeOf(session: SessionRecord, commit: string): Promise<ApprovalRecord["change"]> {
    const remoteBase = await this.mirror.revParse(session.id, `refs/heads/${session.branch}`);
    const base = succeeded(remoteBase) ? remoteBase.stdout.trim() : session.baseCommit;
    try {
      return await this.mirror.changeOf(session.id, base, commit);
    } catch {
      return null;
    }
  }

  private sessionOf(approval: ApprovalRecord): SessionRecord {
    const session = this.sessions.get(String(approval.params.sessionId));
    if (session === null) throw new Error("the chat of this push was deleted");
    return session;
  }
}
