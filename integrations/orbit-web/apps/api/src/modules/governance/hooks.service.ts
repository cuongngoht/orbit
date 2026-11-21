// WHAT GOVERNANCE DOES AT THE AUTH MODULE'S MOMENTS (modules/auth/auth-hooks.ts), registered at start:
//
//   an account is created      inside the transaction that creates it: its audit chain is opened, and its default
//                              policy published (policy.provisioned) -- so the person can work and govern right after
//                              signing in, with no organization, no operator and no first-owner code to set up first
//   a browser signs in         recorded on the account's chain
//   a session or account ends  recorded on the account's chain (best effort: it already ended)
//   a request is refused at    recorded before the refusal is answered -- on the account's chain when the caller acts
//   the gate                   for one (a run's agent), on the deployment's otherwise
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { AuditStore } from "../../infra/governance/stores.js";
import { AuthHooks } from "../auth/auth-hooks.js";
import { systemContext } from "../auth/principal.js";
import { AuditService } from "./audit.service.js";
import { RevisionsService } from "./revisions.service.js";

@Injectable()
export class GovernanceHooks implements OnModuleInit {
  constructor(
    @Inject(AuthHooks) private readonly hooks: AuthHooks,
    @Inject(AuditStore) private readonly auditStore: AuditStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RevisionsService) private readonly revisions: RevisionsService,
  ) {}

  onModuleInit(): void {
    this.hooks.onAccountCreated(async (a) => {
      await this.auditStore.openChain(a.accountId);
      await this.audit.record(systemContext("provisioning", a.accountId), { type: "account.created", outcome: "created", data: { provider: "claude.ai" } });
      await this.revisions.provision(a.accountId);
    });
    this.hooks.onSignedIn(async (ctx, sessionId) => {
      await this.audit.record(ctx, { type: "auth.signed_in", outcome: "signed_in", data: { sessionId } });
    });
    this.hooks.onEnded(async (e) => {
      const ctx = systemContext("sign-in", e.accountId);
      if (e.scope === "session") await this.audit.record(ctx, { type: "auth.signed_out", outcome: "ended", data: { sessionId: e.sessionId, reason: e.reason } });
      else await this.audit.record(ctx, { type: "auth.account.ended", outcome: "ended", data: { reason: e.reason } });
    });
    this.hooks.onRefused(async (ctx, r) => {
      if (r.kind === "boundary") await this.audit.record(ctx, { type: "boundary.violation", outcome: "refused", data: { kind: r.cause, route: r.route, target: r.target ?? r.route } });
      else await this.audit.record(ctx, { type: "authz.denied", outcome: "refused", data: { route: r.route, cause: r.cause } });
    });
  }
}
