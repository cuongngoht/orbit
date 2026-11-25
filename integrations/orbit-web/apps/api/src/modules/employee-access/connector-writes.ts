// AN EMPLOYEE'S WRITES THROUGH THE ACCOUNT'S CONNECTORS: a comment on an Azure DevOps work item or a GitHub issue or pull
// request, a work item's state, or a pull request (branch + commit + push + PR from a validated unified diff patch). The
// employee only PROPOSES one (it must have been let write on that connector, inside what it may read); the account's
// policy decides it (`connector.write`, bound to the target, the operation and a digest of what would be written):
// allowed, Orbit Web carries it out at once; by default it waits for the owner's approval of that exact write
// (Governance → Approvals), and Orbit Web executes it when the approved action is run -- once, as it was approved: an
// approval is spent before the write, against a fingerprint taken again from what it would write. Orbit Web writes and
// pushes with the installation's sign-in (`az rest`, `gh api`, control-plane git), on its own side; the employee is never
// given any credential.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable, Optional, type OnModuleInit } from "@nestjs/common";
import { fingerprintOf } from "@orbit-web/governance-core";
import { ACCESS_CONNECTOR_LABELS, isBranchName, type AccessConnector } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { sha256, type ApprovalRecord } from "../../infra/governance/stores.js";
import { azureEnv, controlEnv, ghEnv, gitEnv } from "../../infra/process/env.js";
import { PROCESS_PORT, succeeded, type ProcessPort } from "../../infra/process/process.port.js";
import { redactSecrets } from "../../infra/security/redact.js";
import type { GovernanceContext } from "../auth/principal.js";
import { pushRefusal } from "../broker/push-target.js";
import { GitGateway } from "../changes/git.gateway.js";
import { ApprovalService, type ExecutionResult, type Executor } from "../governance/approvals.service.js";
import { PolicyService } from "../governance/policy.service.js";
import { AZURE_DEVOPS_RESOURCE } from "../sources/azure-parse.js";
import { SourcesService } from "../sources/sources.module.js";

const ENVIRONMENT = "development" as const;
const MAX_TEXT = 8000;
const MAX_PR_TITLE = 200;
const MAX_PR_BODY = 16_000;
const MAX_COMMIT_MESSAGE = 1000;
const MAX_PATCH_BYTES = 512 * 1024;

export interface ConnectorItemWrite {
  connector: AccessConnector;
  operation: "comment" | "state";
  // Azure DevOps: the organization and the project; GitHub: the owner and the repository.
  owner: string;
  container: string;
  // The work item's id, or the issue's or pull request's number.
  item: number;
  // The comment's text, or the state's name.
  value: string;
}

export interface ConnectorPullRequestWrite {
  connector: AccessConnector;
  operation: "pull_request";
  // GitHub: owner + container (repo name); Azure DevOps: owner (org) + container (project) + repository (repo name).
  owner: string;
  container: string;
  repository: string;
  // Base branch to branch from & open the PR against (null: repository default branch, resolved before approval).
  baseBranch: string | null;
  headBranch: string;
  title: string;
  body: string;
  commitMessage: string;
  patch: string;
  draft: boolean;
}

// One write, as the employee proposed it and as it is approved, run and recorded.
export type ConnectorWrite = ConnectorItemWrite | ConnectorPullRequestWrite;

type Params = Record<string, string | number | boolean | null>;

const normalizePatch = (patch: string): string => (patch.endsWith("\n") ? patch : `${patch}\n`);

const digestOf = (w: ConnectorWrite): string => {
  if (w.operation === "pull_request") {
    return createHash("sha256")
      .update(JSON.stringify({ baseBranch: w.baseBranch, headBranch: w.headBranch, title: w.title, body: w.body, commitMessage: w.commitMessage, draft: w.draft, patch: normalizePatch(w.patch) }))
      .digest("hex");
  }
  return createHash("sha256").update(w.value).digest("hex");
};

const targetOf = (w: ConnectorWrite): string => {
  if (w.operation === "pull_request") {
    const repo = w.connector === "azure" ? `azure-devops:${w.owner}/${w.container}/${w.repository}` : `github:${w.owner}/${w.container}`;
    return `${repo}:${w.headBranch}->${w.baseBranch ?? ""}`;
  }
  return w.connector === "azure" ? `azure-devops:${w.owner}/${w.container}#${w.item}` : `github:${w.owner}/${w.container}#${w.item}`;
};

const resourceOf = (w: ConnectorWrite): string => (w.connector === "azure" ? `azure-devops:${w.owner}/${w.container}` : `github:${w.owner}/${w.container}`);

const paramsOf = (w: ConnectorWrite, repoId?: string): Params => {
  if (w.operation === "pull_request") {
    return {
      connector: w.connector,
      target: targetOf(w),
      operation: w.operation,
      digest: digestOf(w),
      owner: w.owner,
      container: w.container,
      repository: w.repository,
      repoId: repoId ?? `${w.owner}/${w.container}`,
      baseBranch: w.baseBranch ?? "",
      headBranch: w.headBranch,
      title: w.title,
      body: w.body,
      commitMessage: w.commitMessage,
      draft: w.draft,
      patch: normalizePatch(w.patch),
    };
  }
  return { connector: w.connector, target: targetOf(w), operation: w.operation, digest: digestOf(w), owner: w.owner, container: w.container, item: w.item, value: w.value };
};

const writeOf = (p: ApprovalRecord["params"]): ConnectorWrite => {
  const connector: AccessConnector = p.connector === "github" ? "github" : "azure";
  if (p.operation === "pull_request") {
    return {
      connector,
      operation: "pull_request",
      owner: String(p.owner),
      container: String(p.container),
      repository: String(p.repository ?? p.container),
      baseBranch: String(p.baseBranch ?? ""),
      headBranch: String(p.headBranch),
      title: String(p.title),
      body: String(p.body ?? ""),
      commitMessage: String(p.commitMessage ?? p.title),
      draft: p.draft === true,
      patch: String(p.patch),
    };
  }
  return { connector, operation: p.operation === "state" ? "state" : "comment", owner: String(p.owner), container: String(p.container), item: Number(p.item), value: String(p.value) };
};

const excerpt = (text: string, n = 240): string => (text.length > n ? `${text.slice(0, n)}…` : text);

function summaryOf(w: ConnectorWrite): string {
  if (w.operation === "pull_request") {
    const repo = w.connector === "azure" ? `Azure DevOps ${w.owner}/${w.container}/${w.repository}` : `GitHub ${w.owner}/${w.container}`;
    return `Open ${w.draft ? "draft " : ""}pull request on ${repo} (${w.headBranch} → ${w.baseBranch ?? "default"}): "${excerpt(w.title, 140)}"`;
  }
  const where = w.connector === "azure" ? `Azure DevOps work item ${w.item} of ${w.owner}/${w.container}` : `GitHub issue or pull request #${w.item} of ${w.owner}/${w.container}`;
  return w.operation === "state" ? `Set the state of ${where} to "${w.value}"` : `Comment on ${where}: "${excerpt(w.value)}"`;
}

interface PreparedPr {
  repoId: string;
  baseBranch: string;
  change: { files: number; insertions: number; deletions: number; commits: number; diffstat: string };
}

@Injectable()
export class ConnectorWrites implements Executor, OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Optional() @Inject(SourcesService) private readonly sources: SourcesService | null = null,
    @Optional() @Inject(GitGateway) private readonly git: GitGateway | null = null,
  ) {}

  onModuleInit(): void {
    this.approvals.registerExecutor("connector.write", this);
    if (this.config?.data?.control) rmSync(this.stagingRoot(), { recursive: true, force: true });
  }

  // A write the employee proposes: written now, asked of the owner, or refused -- said to the employee in one answer.
  async propose(ctx: GovernanceContext, w: ConnectorWrite): Promise<{ text: string; isError: boolean }> {
    if (w.operation === "pull_request") return this.proposePullRequest(ctx, w);
    if (w.value.trim() === "" || w.value.length > MAX_TEXT) return { text: `What to write must be 1 to ${MAX_TEXT} characters.`, isError: true };
    const params = paramsOf(w);
    // Decided on what the approval is bound to (the text itself is kept with the approval, for the owner to read).
    const decision = await this.policy.decide(ctx, { action: "connector.write", resource: resourceOf(w), environment: ENVIRONMENT, scope: "ACCOUNT_EMPLOYEE", params: { connector: params.connector, target: params.target, operation: params.operation, digest: params.digest } });
    if (decision.verdict === "deny") return { text: `The account's policy in effect does not let you write to ${resourceOf(w)} (${decision.reasonCodes.join(", ") || "deny"}; decision ${decision.decisionId}).`, isError: true };
    if (decision.verdict === "allow") {
      const done = await this.writeItem(w);
      return { text: done.ok ? `Done: ${summaryOf(w)}.` : `It was not written: ${done.outcome}`, isError: !done.ok };
    }
    const binding = ctx.principal.kind === "agent" ? ctx.principal.binding : null;
    const approval = await this.approvals.request(ctx, { action: "connector.write", environment: ENVIRONMENT, fingerprint: decision.fingerprint as string, params, summary: summaryOf(w), decisionId: decision.decisionId, workspaceId: null, agentId: binding?.agentId ?? null, runId: binding?.runId ?? null, change: null });
    return { text: `Asked the account's owner to approve it (approval ${approval.id}): ${summaryOf(w)}. Nothing was written yet -- Orbit Web writes it once it is approved and run. Say so in your hand-in.`, isError: false };
  }

  async fingerprintNow(approval: ApprovalRecord): Promise<string> {
    const w = writeOf(approval.params);
    const p = paramsOf(w, typeof approval.params.repoId === "string" ? approval.params.repoId : undefined);
    return fingerprintOf("connector.write", ENVIRONMENT, { connector: p.connector, target: p.target, operation: p.operation, digest: p.digest }, sha256);
  }

  async run(_ctx: GovernanceContext, approval: ApprovalRecord): Promise<ExecutionResult> {
    const w = writeOf(approval.params);
    if (w.operation === "pull_request") {
      const repoId = typeof approval.params.repoId === "string" && approval.params.repoId !== "" ? approval.params.repoId : `${w.owner}/${w.container}`;
      return this.executePullRequest(w, repoId);
    }
    return this.writeItem(w);
  }

  // ---- pull request proposal & execution (control plane only) -------------------------------------------------------

  private async proposePullRequest(ctx: GovernanceContext, w: ConnectorPullRequestWrite): Promise<{ text: string; isError: boolean }> {
    const err = this.validatePullRequest(w);
    if (err !== null) return { text: err, isError: true };
    const prepared = await this.preparePullRequest(w);
    if (typeof prepared === "string") return { text: prepared, isError: true };
    const resolved: ConnectorPullRequestWrite = { ...w, baseBranch: prepared.baseBranch, patch: normalizePatch(w.patch) };
    const params = paramsOf(resolved, prepared.repoId);
    const decision = await this.policy.decide(ctx, {
      action: "connector.write",
      resource: resourceOf(resolved),
      environment: ENVIRONMENT,
      scope: "ACCOUNT_EMPLOYEE",
      params: { connector: params.connector, target: params.target, operation: params.operation, digest: params.digest },
    });
    if (decision.verdict === "deny") return { text: `The account's policy in effect does not let you open a pull request on ${resourceOf(resolved)} (${decision.reasonCodes.join(", ") || "deny"}; decision ${decision.decisionId}).`, isError: true };
    if (decision.verdict === "allow") {
      const done = await this.executePullRequest(resolved, prepared.repoId);
      return { text: done.ok ? `Done: ${done.outcome}` : `The pull request was not created: ${done.outcome}`, isError: !done.ok };
    }
    const binding = ctx.principal.kind === "agent" ? ctx.principal.binding : null;
    const approval = await this.approvals.request(ctx, {
      action: "connector.write",
      environment: ENVIRONMENT,
      fingerprint: decision.fingerprint as string,
      params,
      summary: summaryOf(resolved),
      decisionId: decision.decisionId,
      workspaceId: null,
      agentId: binding?.agentId ?? null,
      runId: binding?.runId ?? null,
      change: prepared.change,
    });
    return {
      text: `Validated patch cleanly (${prepared.change.files} file(s), +${prepared.change.insertions} -${prepared.change.deletions}) and asked the account's owner to approve it (approval ${approval.id}): ${summaryOf(resolved)}. Nothing was pushed yet -- Orbit Web creates the branch and pull request once the owner approves and runs it in Governance → Approvals. Mention approval ${approval.id} in your hand-in.`,
      isError: false,
    };
  }

  private validatePullRequest(w: ConnectorPullRequestWrite): string | null {
    if (!isBranchName(w.headBranch) || w.headBranch.toUpperCase() === "HEAD") return "headBranch must be a valid git branch name (e.g. orbit/add-feature).";
    if (w.baseBranch !== null && w.baseBranch !== "" && !isBranchName(w.baseBranch)) return "baseBranch must be a valid git branch name.";
    if (w.title.trim() === "" || w.title.length > MAX_PR_TITLE) return `title must be 1 to ${MAX_PR_TITLE} characters.`;
    if (w.body.length > MAX_PR_BODY) return `body must be at most ${MAX_PR_BODY} characters.`;
    if (w.commitMessage.trim() === "" || w.commitMessage.length > MAX_COMMIT_MESSAGE) return `commitMessage must be 1 to ${MAX_COMMIT_MESSAGE} characters.`;
    if (w.patch.trim() === "" || Buffer.byteLength(w.patch, "utf8") > MAX_PATCH_BYTES) return `patch must be non-empty unified diff text of at most ${Math.round(MAX_PATCH_BYTES / 1024)} KiB.`;
    return null;
  }

  private stagingRoot(): string {
    return join(this.config.data.control, "pr-staging");
  }

  // Dry-run validation on the control plane: confirms repository, branches, protected branch policy, and `git apply --index`.
  private async preparePullRequest(w: ConnectorPullRequestWrite): Promise<PreparedPr | string> {
    if (this.sources === null || this.git === null) return "Pull request creation is not available on this installation.";
    const repo = await this.sources.find(w.connector, { owner: w.owner, project: w.connector === "azure" ? w.container : null, name: w.repository });
    if (repo === null) return `The connector does not list ${w.connector === "azure" ? `${w.owner}/${w.container}/${w.repository}` : `${w.owner}/${w.container}`}.`;
    let branchList;
    try {
      branchList = (await this.sources.branches(w.connector, repo.id)).branches;
    } catch (err) {
      return `Could not list branches of ${repo.fullName}: ${err instanceof Error ? err.message : String(err)}`;
    }
    const baseBranch = w.baseBranch && w.baseBranch !== "" ? w.baseBranch : (repo.defaultBranch ?? branchList[0]?.name ?? null);
    if (baseBranch === null || !branchList.some((b) => b.name === baseBranch)) return `Base branch "${baseBranch ?? ""}" does not exist on ${repo.fullName}.`;
    const defaults = repo.defaultBranch ? [repo.defaultBranch] : [];
    const refusal = pushRefusal(w.headBranch, defaults, branchList);
    if (refusal !== null) return refusal.message;
    if (w.headBranch.toLowerCase() === baseBranch.toLowerCase()) return `headBranch (${w.headBranch}) must differ from baseBranch (${baseBranch}).`;
    if (branchList.some((b) => b.name.toLowerCase() === w.headBranch.toLowerCase())) return `Branch "${w.headBranch}" already exists on ${repo.fullName}: choose a new branch name so existing remote work is never overwritten.`;

    const room = join(this.stagingRoot(), randomUUID());
    mkdirSync(room, { recursive: true, mode: 0o700 });
    try {
      const cloned = await this.sources.clone({ source: w.connector, id: repo.id, branch: baseBranch }, "repo", room, ["--depth=1", "--single-branch"]);
      if (!succeeded(cloned)) return `Could not clone ${repo.fullName} (${baseBranch}): ${redactSecrets((cloned.stderr || cloned.stdout).trim()).slice(0, 300)}`;
      const patchFile = join(room, "patch.diff");
      writeFileSync(patchFile, normalizePatch(w.patch), "utf8");
      const repoDir = join(room, "repo");
      const env = gitEnv(this.config, controlEnv(this.config));
      const applied = await this.git.controlGit(repoDir, ["apply", "--index", "--whitespace=nowarn", patchFile], env);
      if (!succeeded(applied)) return `The patch does not apply cleanly to ${repo.fullName}@${baseBranch}: ${redactSecrets((applied.stderr || applied.stdout).trim()).slice(0, 400)}`;
      const stat = await this.git.controlGit(repoDir, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--stat=120"], env);
      const short = await this.git.controlGit(repoDir, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--shortstat"], env);
      const n = (re: RegExp) => Number(re.exec(short.stdout)?.[1] ?? 0);
      const files = n(/(\d+)\s+file/);
      const insertions = n(/(\d+)\s+insertion/);
      const deletions = n(/(\d+)\s+deletion/);
      if (files === 0) return "The patch produced no file changes.";
      return { repoId: repo.id, baseBranch, change: { files, insertions, deletions, commits: 1, diffstat: stat.stdout.trim().slice(0, 4000) } };
    } finally {
      rmSync(room, { recursive: true, force: true });
    }
  }

  private async executePullRequest(w: ConnectorPullRequestWrite, repoId: string): Promise<ExecutionResult> {
    if (this.sources === null || this.git === null) return { ok: false, outcome: "Pull request creation is not available on this installation." };
    const baseBranch = w.baseBranch ?? "";
    if (baseBranch === "") return { ok: false, outcome: "Base branch is missing." };
    const room = join(this.stagingRoot(), randomUUID());
    mkdirSync(room, { recursive: true, mode: 0o700 });
    try {
      const repo = await this.sources.authorized(w.connector, repoId);
      const branchList = (await this.sources.branches(w.connector, repo.id)).branches;
      const refusal = pushRefusal(w.headBranch, repo.defaultBranch ? [repo.defaultBranch] : [], branchList);
      if (refusal !== null) return { ok: false, outcome: refusal.message };
      if (branchList.some((b) => b.name.toLowerCase() === w.headBranch.toLowerCase())) return { ok: false, outcome: `Branch "${w.headBranch}" already exists on ${repo.fullName}.` };

      const cloned = await this.sources.clone({ source: w.connector, id: repo.id, branch: baseBranch }, "repo", room, ["--depth=1", "--single-branch"]);
      if (!succeeded(cloned)) return { ok: false, outcome: `Could not clone ${repo.fullName} (${baseBranch}): ${redactSecrets((cloned.stderr || cloned.stdout).trim()).slice(0, 300)}` };
      const patchFile = join(room, "patch.diff");
      writeFileSync(patchFile, normalizePatch(w.patch), "utf8");
      const repoDir = join(room, "repo");
      const env = gitEnv(this.config, controlEnv(this.config));
      const runGit = async (args: string[], customEnv = env) => {
        const res = await this.git!.controlGit(repoDir, args, customEnv);
        if (!succeeded(res)) throw new Error(redactSecrets((res.stderr || res.stdout).trim()).slice(0, 300));
        return res;
      };
      await runGit(["checkout", "-b", w.headBranch]);
      await runGit(["apply", "--index", "--whitespace=nowarn", patchFile]);
      await runGit(["-c", "user.name=Orbit Web", "-c", "user.email=orbit-web@localhost", "-c", "commit.gpgsign=false", "commit", "--no-verify", "-m", w.commitMessage]);
      const remote = await this.sources.pushRemote(w.connector, repo.id);
      await runGit([...remote.helper, "push", "--no-verify", "--", remote.url, `HEAD:refs/heads/${w.headBranch}`], remote.env);
      return w.connector === "github" ? await this.createGitHubPr(w, baseBranch) : await this.createAzurePr(w, baseBranch);
    } catch (err) {
      return { ok: false, outcome: redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 300) };
    } finally {
      rmSync(room, { recursive: true, force: true });
    }
  }

  private async createGitHubPr(w: ConnectorPullRequestWrite, baseBranch: string): Promise<ExecutionResult> {
    const path = `repos/${encodeURIComponent(w.owner)}/${encodeURIComponent(w.container)}/pulls`;
    const r = await this.process.run(
      this.config.binaries.gh,
      ["api", "--hostname", "github.com", "--method", "POST", path, "-f", `title=${w.title}`, "-f", `body=${w.body}`, "-f", `head=${w.headBranch}`, "-f", `base=${baseBranch}`, "-F", `draft=${w.draft ? "true" : "false"}`],
      { cwd: this.config.controlHome, env: ghEnv(this.config), timeoutMs: 60_000, maxOutputBytes: 1024 * 1024 },
    );
    if (!succeeded(r)) return { ok: false, outcome: `GitHub pushed ${w.headBranch} but refused PR creation: ${redactSecrets((r.stderr || r.stdout).trim()).slice(0, 300)}` };
    try {
      const parsed = JSON.parse(r.stdout) as { number?: number; html_url?: string };
      return { ok: true, outcome: `Opened pull request #${parsed.number ?? "?"} (${w.headBranch} → ${baseBranch}): ${parsed.html_url ?? `${w.owner}/${w.container}`}` };
    } catch {
      return { ok: true, outcome: `Opened pull request on ${w.owner}/${w.container} (${w.headBranch} → ${baseBranch}).` };
    }
  }

  private async createAzurePr(w: ConnectorPullRequestWrite, baseBranch: string): Promise<ExecutionResult> {
    const url = `https://dev.azure.com/${encodeURIComponent(w.owner)}/${encodeURIComponent(w.container)}/_apis/git/repositories/${encodeURIComponent(w.repository)}/pullrequests?api-version=7.1`;
    const payload = JSON.stringify({ sourceRefName: `refs/heads/${w.headBranch}`, targetRefName: `refs/heads/${baseBranch}`, title: w.title, description: w.body, isDraft: w.draft });
    const r = await this.process.run(this.config.binaries.az, ["rest", "--method", "post", "--url", url, "--resource", AZURE_DEVOPS_RESOURCE, "--headers", "Content-Type=application/json", "--body", payload, "--output", "json"], {
      cwd: this.config.controlHome,
      env: azureEnv(this.config),
      timeoutMs: 60_000,
      maxOutputBytes: 1024 * 1024,
    });
    if (!succeeded(r)) return { ok: false, outcome: `Azure DevOps pushed ${w.headBranch} but refused PR creation: ${redactSecrets((r.stderr || r.stdout).trim()).slice(0, 300)}` };
    try {
      const parsed = JSON.parse(r.stdout) as { pullRequestId?: number };
      const webUrl = `https://dev.azure.com/${encodeURIComponent(w.owner)}/${encodeURIComponent(w.container)}/_git/${encodeURIComponent(w.repository)}/pullrequest/${parsed.pullRequestId ?? ""}`;
      return { ok: true, outcome: `Opened pull request #${parsed.pullRequestId ?? "?"} (${w.headBranch} → ${baseBranch}): ${webUrl}` };
    } catch {
      return { ok: true, outcome: `Opened pull request on ${w.owner}/${w.container}/${w.repository} (${w.headBranch} → ${baseBranch}).` };
    }
  }

  // ---- item comment & state writes ----------------------------------------------------------------------------------

  private async writeItem(w: ConnectorItemWrite): Promise<ExecutionResult> {
    const label = ACCESS_CONNECTOR_LABELS[w.connector];
    const r = w.connector === "github" ? await this.gh(w) : await this.az(w);
    if (!succeeded(r)) return { ok: false, outcome: `${label} refused it: ${redactSecrets((r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ")).slice(0, 300)}` };
    return { ok: true, outcome: `${summaryOf(w)}: written.` };
  }

  private gh(w: ConnectorItemWrite) {
    const path = `repos/${encodeURIComponent(w.owner)}/${encodeURIComponent(w.container)}/issues/${w.item}/comments`;
    return this.process.run(this.config.binaries.gh, ["api", "--hostname", "github.com", "--method", "POST", path, "-f", `body=${w.value}`], { cwd: this.config.controlHome, env: ghEnv(this.config), timeoutMs: 60_000, maxOutputBytes: 1024 * 1024 });
  }

  private az(w: ConnectorItemWrite) {
    const base = `https://dev.azure.com/${encodeURIComponent(w.owner)}/${encodeURIComponent(w.container)}/_apis/wit`;
    const request =
      w.operation === "state"
        ? { method: "patch", url: `${base}/workitems/${w.item}?api-version=7.1`, type: "application/json-patch+json", body: JSON.stringify([{ op: "add", path: "/fields/System.State", value: w.value }]) }
        : { method: "post", url: `${base}/workItems/${w.item}/comments?api-version=7.1-preview.4`, type: "application/json", body: JSON.stringify({ text: w.value }) };
    return this.process.run(this.config.binaries.az, ["rest", "--method", request.method, "--url", request.url, "--resource", AZURE_DEVOPS_RESOURCE, "--headers", `Content-Type=${request.type}`, "--body", request.body, "--output", "json"], {
      cwd: this.config.controlHome,
      env: azureEnv(this.config),
      timeoutMs: 60_000,
      maxOutputBytes: 1024 * 1024,
    });
  }
}
