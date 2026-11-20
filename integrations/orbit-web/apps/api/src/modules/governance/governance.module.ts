// GOVERNANCE: operators and their sessions, the global gate every route passes, the policy decision point, the
// privileged settings, and the audit record. The rules are governance-core's; this module binds them to the stores,
// the HTTP routes and the clock.
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { ApprovalService } from "./approvals.service.js";
import { AuditController } from "./audit.controller.js";
import { AuditorController } from "./auditor.controller.js";
import { AuditService } from "./audit.service.js";
import { BOOTSTRAP_ANNOUNCER, BootstrapCode, stdoutAnnouncer } from "./bootstrap-code.js";
import { ConstitutionService } from "./constitution.service.js";
import { EgressService } from "./egress.service.js";
import { FindingsService } from "./findings.service.js";
import { GovernanceController } from "./governance.controller.js";
import { GovernanceGuard } from "./governance.guard.js";
import { IsolationService } from "./isolation.service.js";
import { OperatorController, OperatorsController } from "./operator.controller.js";
import { OperatorService } from "./operator.service.js";
import { PolicyService } from "./policy.service.js";
import { PrincipalResolver } from "./principals.js";
import { RegistryService } from "./registry.service.js";
import { PrivilegedSettingsGate } from "./settings-gate.js";

@Module({
  providers: [
    { provide: BOOTSTRAP_ANNOUNCER, useValue: stdoutAnnouncer },
    BootstrapCode,
    AuditService,
    OperatorService,
    PrincipalResolver,
    PolicyService,
    PrivilegedSettingsGate,
    ConstitutionService,
    RegistryService,
    ApprovalService,
    FindingsService,
    IsolationService,
    EgressService,
    // After the Claude sign-in gate (its module is imported first): a signed-out Orbit Web answers every route with the
    // Claude sign-in, governance's or not.
    { provide: APP_GUARD, useClass: GovernanceGuard },
  ],
  controllers: [OperatorController, OperatorsController, AuditController, GovernanceController, AuditorController],
  exports: [AuditService, OperatorService, PrincipalResolver, PolicyService, PrivilegedSettingsGate, ConstitutionService, RegistryService, ApprovalService, FindingsService, IsolationService],
})
export class GovernanceModule {}
