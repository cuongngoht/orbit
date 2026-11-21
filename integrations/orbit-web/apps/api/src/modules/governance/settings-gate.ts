// THE PRIVILEGED SETTINGS: the switches that hand the coding agent authority -- GitHub's sign-in (push, pull requests),
// the Azure CLI's sign-in, and running the code of a repository's plugins. They are the ACCOUNT's settings. Turning one
// ON is the account owner's: a person whose browser finished the Claude sign-in (the gate already held the change to its
// session's CSRF token), and a decision of the account's policy that allows a person `settings.privileged.write` on
// that setting. Turning one OFF never needs anybody: narrowing is always allowed. Whatever happens is recorded, and the
// record of an authorization is written before the setting changes: if it cannot be written, the setting does not change.
//
// This is what keeps an agent -- which reaches the same API from its shell -- from handing itself a sign-in: it has no
// browser session and cannot get one. In the governed deployment GitHub's and Azure's switches are refused to everybody:
// no sign-in exists in the agent's container at all, and Orbit Web pushes for it after the owner approves (the broker).
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import type { PrivilegedSetting } from "@orbit-web/governance-core";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { ApiError } from "../../common/errors.js";
import { Db } from "../../infra/db/db.js";
import type { GovernanceContext } from "../auth/principal.js";
import { AuditService } from "./audit.service.js";
import { PolicyService } from "./policy.service.js";

const NAMES: Record<PrivilegedSetting, string> = {
  githubForClaude: "letting Claude Code use GitHub's sign-in",
  azureForClaude: "letting Claude Code use the Azure CLI's sign-in",
  projectPlugins: "running project plugins",
};

const CREDENTIAL_SWITCHES: readonly PrivilegedSetting[] = ["githubForClaude", "azureForClaude"];

export const OWNER_REQUIRED = "owner_required";

@Injectable()
export class PrivilegedSettingsGate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Db) private readonly db: Db,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PolicyService) private readonly policy: PolicyService,
  ) {}

  // Throws, after recording why, unless the caller may turn every one of `settings` on; then records each as authorized.
  async authorize(ctx: GovernanceContext, settings: readonly PrivilegedSetting[]): Promise<void> {
    for (const setting of settings) await this.authorizeOne(ctx, setting);
    await this.db.tx(async () => {
      for (const setting of settings) await this.audit.record(ctx, { type: "settings.privileged.changed", outcome: "authorized", data: { setting, value: true } });
    });
  }

  async narrowed(ctx: GovernanceContext, settings: readonly PrivilegedSetting[]): Promise<void> {
    for (const setting of settings) await this.audit.record(ctx, { type: "settings.privileged.changed", outcome: "narrowed", data: { setting, value: false } });
  }

  private async authorizeOne(ctx: GovernanceContext, setting: PrivilegedSetting): Promise<void> {
    const what = NAMES[setting];
    if (this.config.governance.deployment === "governed" && CREDENTIAL_SWITCHES.includes(setting)) {
      await this.refuse(ctx, setting, "governed_deployment", HttpStatus.CONFLICT, "unsupported_in_governed_deployment", `In the governed deployment Claude Code never holds a sign-in: ${what} is not available. A push is asked for through the agent gateway and made by Orbit Web after the account's owner approves it.`);
    }
    if (ctx.principal.kind !== "owner") await this.refuse(ctx, setting, "owner_required", HttpStatus.FORBIDDEN, OWNER_REQUIRED, `Turning on ${what} hands Claude Code authority: only the account's owner, signed in with Claude in this browser, does it.`);
    const decision = await this.policy.decide(ctx, { action: "settings.privileged.write", resource: setting, scope: "ACCOUNT", params: { setting } });
    if (decision.verdict !== "allow") await this.refuse(ctx, setting, `policy_${decision.verdict}`, HttpStatus.FORBIDDEN, "policy_denied", `The account's policy in effect does not let a person turn on ${what} here (${decision.reasonCodes.join(", ")}).`);
  }

  private async refuse(ctx: GovernanceContext, setting: PrivilegedSetting, cause: string, status: number, code: string, message: string): Promise<never> {
    await this.audit.record(ctx, { type: "settings.privileged.refused", outcome: "refused", data: { setting, cause } });
    throw new ApiError(status, code, message);
  }
}
