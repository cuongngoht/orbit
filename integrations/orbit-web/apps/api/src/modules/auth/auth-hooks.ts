// WHAT OTHER MODULES DO AT THE AUTH MODULE'S MOMENTS, registered by them (so the auth module imports none of them):
//
//   accountCreated   inside the transaction that creates an account (a setup code, the trial seed): governance opens its
//                    audit chain and publishes its default policy -- an account never exists without them.
//   signedIn         after a browser's session is issued (governance records it).
//   ended            when browser sessions end (a sign-out, sign-out everywhere, a password reset, idle or expired, ended
//                    by the owner): their streams close.
//   refused          a request refused at the gate, recorded before the refusal is answered.
//   identity         a step of Orbit's own sign-in (a refused sign-in, a setup code used, a password changed, a profile
//                    edited, the trial started): governance records it -- inside the change's transaction where there is
//                    one, so a step whose record cannot be written does not happen.
//   resourceCheck    a route about one record (a chat) asks its owner module whether this owner may reach it.
import { Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import type { GovernanceContext, Owner } from "./principal.js";

// What the identity steps are, for the audit record. Never a password, a code or a token: what happened, and its cause.
export type IdentityEvent =
  | { kind: "login_refused"; cause: "invalid_credentials" | "too_many_attempts" | "setup_required" }
  | { kind: "setup_code_used"; purpose: "first_admin" | "new_account" | "reset_password" }
  | { kind: "password_changed"; how: "changed" | "reset" }
  | { kind: "profile_changed"; fields: string[] }
  | { kind: "account_changed"; fields: string[] }
  | { kind: "trial_started"; seeded: boolean };

export interface CreatedAccount {
  accountId: string;
  // How it was made: a one-time setup code an operator printed, or the localhost trial's seed.
  how: "setup_code" | "trial";
  at: string;
}

export interface Refusal {
  kind: "boundary" | "authz";
  route: string;
  // boundary: what the caller reached for; authz: why it was refused.
  cause: string;
  target?: string;
  change: boolean;
}

export type Ended = { scope: "session"; accountId: string; sessionId: string; reason: string } | { scope: "sessions"; accountId: string; sessionIds: string[]; reason: string };

type Hook<A extends unknown[]> = (...args: A) => Promise<void> | void;

@Injectable()
export class AuthHooks {
  private readonly logger = new Logger("Auth");
  private readonly created: Hook<[CreatedAccount]>[] = [];
  private readonly signed: Hook<[GovernanceContext, string]>[] = [];
  private readonly ended: Hook<[Ended]>[] = [];
  private readonly refusals: Hook<[GovernanceContext, Refusal]>[] = [];
  private readonly identities: Hook<[GovernanceContext, IdentityEvent]>[] = [];
  private readonly resources: ((req: Request, owner: Owner) => Promise<void>)[] = [];

  onIdentity(hook: Hook<[GovernanceContext, IdentityEvent]>): void {
    this.identities.push(hook);
  }

  // Recorded where it is said (inside the caller's transaction when there is one): a hook that fails fails the step.
  async identity(ctx: GovernanceContext, e: IdentityEvent): Promise<void> {
    for (const hook of this.identities) await hook(ctx, e);
  }

  onAccountCreated(hook: Hook<[CreatedAccount]>): void {
    this.created.push(hook);
  }

  onSignedIn(hook: Hook<[GovernanceContext, string]>): void {
    this.signed.push(hook);
  }

  onEnded(hook: Hook<[Ended]>): void {
    this.ended.push(hook);
  }

  onRefused(hook: Hook<[GovernanceContext, Refusal]>): void {
    this.refusals.push(hook);
  }

  // A check of the record a route names: throws (404, 403) when this owner may not reach it.
  resourceCheck(check: (req: Request, owner: Owner) => Promise<void>): void {
    this.resources.push(check);
  }

  // Inside the creating transaction: a hook that fails makes the account not exist.
  async accountCreated(a: CreatedAccount): Promise<void> {
    for (const hook of this.created) await hook(a);
  }

  async signedIn(ctx: GovernanceContext, sessionId: string): Promise<void> {
    for (const hook of this.signed) await hook(ctx, sessionId);
  }

  // After the fact: one hook failing never stops the others.
  async sessionsEnded(e: Ended): Promise<void> {
    for (const hook of this.ended) {
      try {
        await hook(e);
      } catch (err) {
        this.logger.error(`after a session ended: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  async refused(ctx: GovernanceContext, r: Refusal): Promise<void> {
    for (const hook of this.refusals) await hook(ctx, r);
  }

  async checkResource(req: Request, owner: Owner): Promise<void> {
    for (const check of this.resources) await check(req, owner);
  }
}
