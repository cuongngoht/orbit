// WHAT GOVERNANCE DOES AT THE AUTH MODULE'S MOMENTS (modules/auth/auth-hooks.ts), registered at start:
//
//   an account is created      inside the transaction that creates it (a setup code, the trial seed): its audit chain
//                              is opened, and its default policy published (policy.provisioned) -- so the person can
//                              work and govern right after the setup, with no organization and no operator to set up
//   a browser signs in         recorded on the account's chain
//   sessions end               recorded on the account's chain (best effort: they already ended)
//   a request is refused at    recorded before the refusal is answered -- on the account's chain when the caller acts
//   the gate                   for one (a run's agent), on the deployment's otherwise
//   an identity step           (a refused sign-in, a setup code used, a password changed, a profile or the account
//                              edited, the trial started) recorded where it is said, on the account's chain -- the
//                              deployment's for what concerns no account (a refused sign-in of no user, the trial)
//
// IDENTITY_AUDIT is the one place an identity step is given an audit event type. governance-core's vocabulary (AUDIT_
// EVENTS) has no rows of their own for these yet, so each is written as the nearest one it has: a refused sign-in as
// `authz.denied`, the rest as `settings.privileged.changed` naming what changed -- never a password, a code or a token.
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { AuditEventType } from "@orbit-web/governance-core";
import { AuditStore } from "../../infra/governance/stores.js";
import { AuthHooks, type IdentityEvent } from "../auth/auth-hooks.js";
import { systemContext } from "../auth/principal.js";
import { AuditService } from "./audit.service.js";
import { RevisionsService } from "./revisions.service.js";

export function IDENTITY_AUDIT(e: IdentityEvent): { type: AuditEventType; outcome: string; data: Record<string, string | boolean> } {
  if (e.kind === "login_refused") return { type: "authz.denied", outcome: "refused", data: { route: e.route ?? "POST /api/auth/login", cause: e.cause, action: "auth.login" } };
  if (e.kind === "setup_code_used") return { type: "settings.privileged.changed", outcome: "used", data: { setting: `identity.setup_code.${e.purpose}`, value: e.standing === true ? "used: the standing code (ORBIT_WEB_SETUP_CODE)" : "used" } };
  if (e.kind === "password_changed") return { type: "settings.privileged.changed", outcome: e.how, data: { setting: "identity.password", value: e.how } };
  if (e.kind === "profile_changed") return { type: "settings.privileged.changed", outcome: "changed", data: { setting: "identity.profile", value: e.fields.join(",") } };
  if (e.kind === "account_changed") return { type: "settings.privileged.changed", outcome: "changed", data: { setting: "identity.account", value: e.fields.join(",") } };
  if (e.kind === "mobile_signed_in") return { type: "settings.privileged.changed", outcome: "signed_in", data: { setting: "identity.mobile.sign_in", value: e.deviceId } };
  if (e.kind === "mobile_refresh_reused") return { type: "authz.denied", outcome: "refused", data: { route: "POST /api/auth/mobile/refresh", cause: "refresh_token_reused", action: "auth.mobile.refresh" } };
  return { type: "settings.privileged.changed", outcome: e.seeded ? "seeded" : "started", data: { setting: "identity.trial_mode", value: e.seeded ? "on; the trial account was made" : "on" } };
}

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
      await this.audit.record(systemContext("provisioning", a.accountId), { type: "account.created", outcome: "created", data: { provider: a.how } });
      await this.revisions.provision(a.accountId);
    });
    this.hooks.onSignedIn(async (ctx, sessionId) => {
      await this.audit.record(ctx, { type: "auth.signed_in", outcome: "signed_in", data: { sessionId } });
    });
    this.hooks.onEnded(async (e) => {
      const ctx = systemContext("sign-in", e.accountId);
      if (e.scope === "session") await this.audit.record(ctx, { type: "auth.signed_out", outcome: "ended", data: { sessionId: e.sessionId, reason: e.reason } });
      else await this.audit.record(ctx, { type: "auth.sessions.revoked", outcome: "revoked", data: { sessions: e.sessionIds.length, reason: e.reason } });
    });
    this.hooks.onRefused(async (ctx, r) => {
      if (r.kind === "boundary") await this.audit.record(ctx, { type: "boundary.violation", outcome: "refused", data: { kind: r.cause, route: r.route, target: r.target ?? r.route } });
      else await this.audit.record(ctx, { type: "authz.denied", outcome: "refused", data: { route: r.route, cause: r.cause } });
    });
    this.hooks.onIdentity(async (ctx, e) => {
      await this.audit.record(ctx, IDENTITY_AUDIT(e));
    });
  }
}
