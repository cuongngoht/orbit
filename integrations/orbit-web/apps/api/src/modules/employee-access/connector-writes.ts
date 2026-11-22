// AN EMPLOYEE'S WRITES THROUGH THE ACCOUNT'S CONNECTORS: a comment on an Azure DevOps work item or a GitHub issue or pull
// request, a work item's state. The employee only PROPOSES one (it must have been let write on that connector, inside what
// it may read); the account's policy decides it (`connector.write`, bound to the target, the operation and a digest of
// what would be written): allowed, Orbit Web writes it at once; by default it waits for the owner's approval of that
// exact write (Governance → Approvals), and Orbit Web writes it when the approved action is run -- once, as it was
// approved: an approval is spent before the write, against a fingerprint taken again from what it would write.
// Orbit Web writes with the installation's sign-in (`az rest`, `gh api`), on its own side; the employee is never given it.
import { createHash } from "node:crypto";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { fingerprintOf } from "@orbit-web/governance-core";
import { ACCESS_CONNECTOR_LABELS, type AccessConnector } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { sha256, type ApprovalRecord } from "../../infra/governance/stores.js";
import { azureEnv, ghEnv } from "../../infra/process/env.js";
import { PROCESS_PORT, succeeded, type ProcessPort } from "../../infra/process/process.port.js";
import { redactSecrets } from "../../infra/security/redact.js";
import type { GovernanceContext } from "../auth/principal.js";
import { ApprovalService, type ExecutionResult, type Executor } from "../governance/approvals.service.js";
import { PolicyService } from "../governance/policy.service.js";
import { AZURE_DEVOPS_RESOURCE } from "../sources/azure-parse.js";

const ENVIRONMENT = "development" as const;
const MAX_TEXT = 8000;

// One write, as the employee proposed it and as it is approved, run and recorded.
export interface ConnectorWrite {
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

type Params = Record<string, string | number | boolean | null>;

const digestOf = (value: string): string => createHash("sha256").update(value).digest("hex");
const targetOf = (w: ConnectorWrite): string => (w.connector === "azure" ? `azure-devops:${w.owner}/${w.container}#${w.item}` : `github:${w.owner}/${w.container}#${w.item}`);
const resourceOf = (w: ConnectorWrite): string => (w.connector === "azure" ? `azure-devops:${w.owner}/${w.container}` : `github:${w.owner}/${w.container}`);
const paramsOf = (w: ConnectorWrite): Params => ({ connector: w.connector, target: targetOf(w), operation: w.operation, digest: digestOf(w.value), owner: w.owner, container: w.container, item: w.item, value: w.value });
const writeOf = (p: ApprovalRecord["params"]): ConnectorWrite => ({ connector: p.connector === "github" ? "github" : "azure", operation: p.operation === "state" ? "state" : "comment", owner: String(p.owner), container: String(p.container), item: Number(p.item), value: String(p.value) });
const excerpt = (text: string, n = 240): string => (text.length > n ? `${text.slice(0, n)}…` : text);

function summaryOf(w: ConnectorWrite): string {
  const where = w.connector === "azure" ? `Azure DevOps work item ${w.item} of ${w.owner}/${w.container}` : `GitHub issue or pull request #${w.item} of ${w.owner}/${w.container}`;
  return w.operation === "state" ? `Set the state of ${where} to "${w.value}"` : `Comment on ${where}: "${excerpt(w.value)}"`;
}

@Injectable()
export class ConnectorWrites implements Executor, OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
  ) {}

  onModuleInit(): void {
    this.approvals.registerExecutor("connector.write", this);
  }

  // A write the employee proposes: written now, asked of the owner, or refused -- said to the employee in one answer.
  async propose(ctx: GovernanceContext, w: ConnectorWrite): Promise<{ text: string; isError: boolean }> {
    if (w.value.trim() === "" || w.value.length > MAX_TEXT) return { text: `What to write must be 1 to ${MAX_TEXT} characters.`, isError: true };
    const params = paramsOf(w);
    // Decided on what the approval is bound to (the text itself is kept with the approval, for the owner to read).
    const decision = await this.policy.decide(ctx, { action: "connector.write", resource: resourceOf(w), environment: ENVIRONMENT, scope: "ACCOUNT_EMPLOYEE", params: { connector: params.connector, target: params.target, operation: params.operation, digest: params.digest } });
    if (decision.verdict === "deny") return { text: `The account's policy in effect does not let you write to ${resourceOf(w)} (${decision.reasonCodes.join(", ") || "deny"}; decision ${decision.decisionId}).`, isError: true };
    if (decision.verdict === "allow") {
      const done = await this.write(w);
      return { text: done.ok ? `Done: ${summaryOf(w)}.` : `It was not written: ${done.outcome}`, isError: !done.ok };
    }
    const binding = ctx.principal.kind === "agent" ? ctx.principal.binding : null;
    const approval = await this.approvals.request(ctx, { action: "connector.write", environment: ENVIRONMENT, fingerprint: decision.fingerprint as string, params, summary: summaryOf(w), decisionId: decision.decisionId, workspaceId: null, agentId: binding?.agentId ?? null, runId: binding?.runId ?? null, change: null });
    return { text: `Asked the account's owner to approve it (approval ${approval.id}): ${summaryOf(w)}. Nothing was written yet -- Orbit Web writes it once it is approved and run. Say so in your hand-in.`, isError: false };
  }

  async fingerprintNow(approval: ApprovalRecord): Promise<string> {
    const w = writeOf(approval.params);
    const p = paramsOf(w);
    return fingerprintOf("connector.write", ENVIRONMENT, { connector: p.connector, target: p.target, operation: p.operation, digest: p.digest }, sha256);
  }

  async run(_ctx: GovernanceContext, approval: ApprovalRecord): Promise<ExecutionResult> {
    return this.write(writeOf(approval.params));
  }

  private async write(w: ConnectorWrite): Promise<ExecutionResult> {
    const label = ACCESS_CONNECTOR_LABELS[w.connector];
    const r = w.connector === "github" ? await this.gh(w) : await this.az(w);
    if (!succeeded(r)) return { ok: false, outcome: `${label} refused it: ${redactSecrets((r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ")).slice(0, 300)}` };
    return { ok: true, outcome: `${summaryOf(w)}: written.` };
  }

  private gh(w: ConnectorWrite) {
    const path = `repos/${encodeURIComponent(w.owner)}/${encodeURIComponent(w.container)}/issues/${w.item}/comments`;
    return this.process.run(this.config.binaries.gh, ["api", "--hostname", "github.com", "--method", "POST", path, "-f", `body=${w.value}`], { cwd: this.config.controlHome, env: ghEnv(this.config), timeoutMs: 60_000, maxOutputBytes: 1024 * 1024 });
  }

  private az(w: ConnectorWrite) {
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
