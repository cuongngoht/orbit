// GOVERNANCE: operators and their sessions, the global gate every route passes, the policy decision point, the
// privileged settings, and the audit record. The rules are governance-core's; this module binds them to the stores,
// the HTTP routes and the clock.
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditController } from "./audit.controller.js";
import { AuditService } from "./audit.service.js";
import { BOOTSTRAP_ANNOUNCER, BootstrapCode, stdoutAnnouncer } from "./bootstrap-code.js";
import { GovernanceGuard } from "./governance.guard.js";
import { OperatorController, OperatorsController } from "./operator.controller.js";
import { OperatorService } from "./operator.service.js";
import { PolicyService } from "./policy.service.js";
import { PrincipalResolver } from "./principals.js";
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
    // After the Claude sign-in gate (its module is imported first): a signed-out Orbit Web answers every route with the
    // Claude sign-in, governance's or not.
    { provide: APP_GUARD, useClass: GovernanceGuard },
  ],
  controllers: [OperatorController, OperatorsController, AuditController],
  exports: [AuditService, OperatorService, PrincipalResolver, PolicyService, PrivilegedSettingsGate],
})
export class GovernanceModule {}
