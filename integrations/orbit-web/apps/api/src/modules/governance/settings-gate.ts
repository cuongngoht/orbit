// THE PRIVILEGED SETTINGS: the switches that hand the coding agent authority -- GitHub's sign-in (push, pull requests),
// the Azure CLI's sign-in, and running the code of a repository's plugins. Turning one ON is administration: it needs an
// operator whose roles hold settings.privileged.write, with the session's CSRF token, and -- once a Constitution is in
// effect -- a decision of it that allows a person `settings.privileged.write` on that setting. Turning one OFF never
// needs anybody: narrowing is always allowed. Whatever happens is recorded, and the record of an authorization is
// written before the setting changes: if it cannot be written, the setting does not change.
//
// This is what keeps an agent -- which reaches the same API from its shell -- from handing itself a sign-in: it has no
// operator session and cannot get one. In the governed deployment GitHub's and Azure's switches are refused to everybody:
// no sign-in exists in the agent's container at all, and Orbit Web pushes for it after a person approves (the broker).
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { OPERATOR_REQUIRED, PERMISSION_REQUIRED, CSRF_INVALID } from "@orbit-web/contracts";
import type { PrivilegedSetting } from "@orbit-web/governance-core";
import type { Request } from "express";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { ApiError } from "../../common/errors.js";
import { GovernanceDatabase } from "../../infra/governance/governance-db.js";
import { AuditService } from "./audit.service.js";
import { csrfMatches } from "./governance.guard.js";
import { PolicyService } from "./policy.service.js";
import type { GovernanceContext } from "./principal.js";

const NAMES: Record<PrivilegedSetting, string> = {
  githubForClaude: "letting Claude Code use GitHub's sign-in",
  azureForClaude: "letting Claude Code use the Azure CLI's sign-in",
  projectPlugins: "running project plugins",
};

const CREDENTIAL_SWITCHES: readonly PrivilegedSetting[] = ["githubForClaude", "azureForClaude"];

@Injectable()
export class PrivilegedSettingsGate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(GovernanceDatabase) private readonly database: GovernanceDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PolicyService) private readonly policy: PolicyService,
  ) {}

  // Throws, after recording why, unless the caller may turn every one of `settings` on.
  authorize(ctx: GovernanceContext, req: Request, settings: readonly PrivilegedSetting[]): void {
    for (const setting of settings) this.authorizeOne(ctx, req, setting);
    this.database.transaction(() => {
      for (const setting of settings) this.audit.record(ctx, { type: "settings.privileged.changed", outcome: "authorized", data: { setting, value: true } });
    });
  }

  narrowed(ctx: GovernanceContext, settings: readonly PrivilegedSetting[]): void {
    for (const setting of settings) this.audit.record(ctx, { type: "settings.privileged.changed", outcome: "narrowed", data: { setting, value: false } });
  }

  private authorizeOne(ctx: GovernanceContext, req: Request, setting: PrivilegedSetting): void {
    const p = ctx.principal;
    const what = NAMES[setting];
    if (this.config.governance.deployment === "governed" && CREDENTIAL_SWITCHES.includes(setting)) {
      this.refuse(ctx, setting, "governed_deployment", HttpStatus.CONFLICT, "unsupported_in_governed_deployment", `In the governed deployment Claude Code never holds a sign-in: ${what} is not available. A push is asked for through the agent gateway and made by Orbit Web after a person approves it.`);
    }
    if (p.kind !== "operator") this.refuse(ctx, setting, "operator_required", HttpStatus.FORBIDDEN, OPERATOR_REQUIRED, `Turning on ${what} hands Claude Code authority: it needs an Orbit operator. Sign in under Governance first.`);
    if (!p.permissions.includes("settings.privileged.write")) this.refuse(ctx, setting, "permission", HttpStatus.FORBIDDEN, PERMISSION_REQUIRED, `Turning on ${what} needs the settings.privileged.write permission, which none of your roles holds.`);
    if (!csrfMatches(req, p)) this.refuse(ctx, setting, "csrf", HttpStatus.FORBIDDEN, CSRF_INVALID, "This change does not carry this session's own token: reload the page and try again.");
    if (this.policy.effective() === null) return;
    const decision = this.policy.decide(ctx, { action: "settings.privileged.write", resource: setting, scope: "LEGACY_ORBIT", params: { setting } });
    if (decision.verdict !== "allow") this.refuse(ctx, setting, `policy_${decision.verdict}`, HttpStatus.FORBIDDEN, "policy_denied", `The Constitution in effect does not let a person turn on ${what} here (${decision.reasonCodes.join(", ")}).`);
  }

  private refuse(ctx: GovernanceContext, setting: PrivilegedSetting, cause: string, status: number, code: string, message: string): never {
    this.audit.record(ctx, { type: "settings.privileged.refused", outcome: "refused", data: { setting, cause } });
    throw new ApiError(status, code, message);
  }
}
