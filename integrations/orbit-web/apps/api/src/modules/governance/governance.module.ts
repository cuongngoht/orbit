// GOVERNANCE, per ACCOUNT: the account's policy and the overrides that narrow it for one chat or research workspace,
// the policy decision point, the runs it binds, approvals, the privileged settings, the audit record (one hash chain
// per account), findings and reports -- and, from an account's creation, its chain and its default policy (hooks). The
// rules are governance-core's; this module binds them to the stores, the HTTP routes and the clock. Who may ask is the
// auth module's (one global gate): every route here is the account owner's.
import { Module } from "@nestjs/common";
import { HealthModule } from "../health/health.module.js";
import { ApprovalService } from "./approvals.service.js";
import { AuditController } from "./audit.controller.js";
import { AuditorController } from "./auditor.controller.js";
import { AuditService } from "./audit.service.js";
import { EgressService } from "./egress.service.js";
import { FindingsService } from "./findings.service.js";
import { GovernanceController } from "./governance.controller.js";
import { GovernanceHooks } from "./hooks.service.js";
import { IsolationService } from "./isolation.service.js";
import { OverridesService } from "./overrides.service.js";
import { PolicyService } from "./policy.service.js";
import { ResourcesController } from "./resources.controller.js";
import { GovernedResources } from "./resources.service.js";
import { RevisionsService } from "./revisions.service.js";
import { RunGovernanceService } from "./run-governance.service.js";
import { PrivilegedSettingsGate } from "./settings-gate.js";

@Module({
  imports: [HealthModule],
  providers: [AuditService, PolicyService, PrivilegedSettingsGate, RevisionsService, OverridesService, GovernedResources, ApprovalService, FindingsService, IsolationService, EgressService, RunGovernanceService, GovernanceHooks],
  controllers: [GovernanceController, ResourcesController, AuditController, AuditorController],
  exports: [AuditService, PolicyService, PrivilegedSettingsGate, RevisionsService, OverridesService, GovernedResources, ApprovalService, FindingsService, IsolationService, RunGovernanceService],
})
export class GovernanceModule {}
