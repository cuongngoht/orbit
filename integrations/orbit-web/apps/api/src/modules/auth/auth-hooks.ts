// WHAT OTHER MODULES DO AT THE AUTH MODULE'S MOMENTS, registered by them (so the auth module imports none of them):
//
//   accountCreated   inside the transaction that creates an account: governance opens its audit chain and publishes
//                    its default policy -- an account never exists without them.
//   signedIn         after a browser's session is issued (governance records it).
//   accountEnded     when an account stops being the runtime's (signed out, switched, its CLI identity changed
//                    elsewhere), or a browser session ends: its streams close, its caches are dropped.
//   refused          a request refused at the gate, recorded before the refusal is answered.
//   resourceCheck    a route about one record (a chat) asks its owner module whether this owner may reach it.
import { Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import type { GovernanceContext, Owner } from "./principal.js";

export interface CreatedAccount {
  accountId: string;
  email: string;
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

export type Ended = { scope: "account"; accountId: string; reason: string } | { scope: "session"; accountId: string; sessionId: string; reason: string };

type Hook<A extends unknown[]> = (...args: A) => Promise<void> | void;

@Injectable()
export class AuthHooks {
  private readonly logger = new Logger("Auth");
  private readonly created: Hook<[CreatedAccount]>[] = [];
  private readonly signed: Hook<[GovernanceContext, string]>[] = [];
  private readonly ended: Hook<[Ended]>[] = [];
  private readonly refusals: Hook<[GovernanceContext, Refusal]>[] = [];
  private readonly resources: ((req: Request, owner: Owner) => Promise<void>)[] = [];

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
  async accountEnded(e: Ended): Promise<void> {
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
