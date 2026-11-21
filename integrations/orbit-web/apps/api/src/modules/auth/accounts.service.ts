// ACCOUNTS AND BROWSER SESSIONS.
//
// AN ACCOUNT is Orbit Web's own record of one verified Claude identity: an immutable id, a display name a person may
// set, and the identity it maps to -- the CLI's account email (lower case) in the organization the CLI names by id. It
// is found, or created, the first time that identity finishes a sign-in: no registration, no password, no bootstrap.
// Creating it is idempotent and safe when two sign-ins race (a lock on the identity's key, and a unique constraint
// behind it), and an account is never created without what governance owes it (accountCreated: its audit chain and its
// default policy, in the same transaction). Two identities are never merged because an email matches: another
// organization is another account.
//
// A BROWSER SESSION is issued to the browser that finished a sign-in, and to no other: its token is random, sent once as
// an HttpOnly cookie, and kept here as its SHA-256. It ends at its lifetime, after it sits idle, when it is revoked, and
// whenever its account stops being the one the runtime's Claude CLI holds -- a session of account A never reads account
// B's data. Its CSRF token is derived from the token, never stored.
//
// ONE IDENTITY PER RUNTIME: the CLI holds one Claude sign-in at a time. When a sign-in brings another account, every
// session of the account before is revoked in the same transaction, and its streams and caches go with it.
import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { AccountSettingsStore, AccountStore, BrowserSessionStore, RuntimeIdentityStore, sha256, type AccountRecord, type BrowserSessionRecord, type IdentityRecord } from "../../infra/accounts/stores.js";
import { Db } from "../../infra/db/db.js";
import { AuthHooks } from "./auth-hooks.js";
import { contextOf, type Owner } from "./principal.js";

// A Claude identity as the CLI's own status verified it.
export interface VerifiedIdentity {
  email: string;
  // The organization's id as the CLI names it; '' when it names none (never its display name).
  orgKey: string;
  orgName: string | null;
  plan: string | null;
  // `<email>|<orgKey>`: what tells two identities apart.
  key: string;
}

export const CSRF_SALT = "orbit-web/session-csrf/";

export const csrfOf = (token: string): string => sha256(`${CSRF_SALT}${token}`);

export interface Issued {
  token: string;
  session: BrowserSessionRecord;
  account: AccountRecord;
  identity: IdentityRecord;
  // The account the runtime served before this sign-in, when it was another one.
  replaced: string | null;
}

export interface Resolved {
  owner: Owner;
  account: AccountRecord;
}

const sameText = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

@Injectable()
export class AccountsService {
  private readonly logger = new Logger("Accounts");

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Db) private readonly db: Db,
    @Inject(AccountStore) private readonly accounts: AccountStore,
    @Inject(BrowserSessionStore) private readonly sessions: BrowserSessionStore,
    @Inject(RuntimeIdentityStore) private readonly runtime: RuntimeIdentityStore,
    @Inject(AccountSettingsStore) readonly settings: AccountSettingsStore,
    @Inject(AuthHooks) private readonly hooks: AuthHooks,
  ) {}

  // The account of a verified identity: the one it already maps to, or a new one (with its audit chain and default
  // policy). Inside the caller's transaction when there is one.
  async ensure(identity: VerifiedIdentity): Promise<{ account: AccountRecord; identity: IdentityRecord; created: boolean }> {
    return this.db.tx(async () => {
      await this.db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`identity:claude.ai:${identity.key}`]);
      const found = await this.accounts.identity("claude.ai", identity.email, identity.orgKey);
      const at = new Date().toISOString();
      if (found !== null) {
        await this.accounts.verified(found.id, { email: identity.email, orgName: identity.orgName, plan: identity.plan }, at);
        return { account: (await this.accounts.get(found.accountId)) as AccountRecord, identity: { ...found, orgName: identity.orgName, plan: identity.plan, verifiedAt: at }, created: false };
      }
      const account: AccountRecord = { id: randomUUID(), displayName: "", createdAt: at };
      const record: IdentityRecord = { id: randomUUID(), accountId: account.id, provider: "claude.ai", emailNorm: identity.email, orgKey: identity.orgKey, email: identity.email, orgName: identity.orgName, plan: identity.plan, createdAt: at, verifiedAt: at };
      await this.accounts.insert(account);
      if (!(await this.accounts.insertIdentity(record))) throw new Error("the identity was claimed by another account at the same moment");
      await this.hooks.accountCreated({ accountId: account.id, email: identity.email, at });
      this.logger.log(`account ${account.id} created for a verified Claude identity`);
      return { account, identity: record, created: true };
    });
  }

  // A session for the browser that finished a sign-in of `identity`. Any session it presented before is revoked (the
  // session rotates); when the runtime served another account until now, every session of that account ends.
  async issue(identity: VerifiedIdentity, o: { previousToken: string | null; userAgent: string | null }): Promise<Issued> {
    const issued = await this.db.tx(async () => {
      const before = await this.runtime.lock();
      const { account, identity: record } = await this.ensure(identity);
      const at = new Date().toISOString();
      const replaced = before.accountId !== null && before.accountId !== account.id ? before.accountId : null;
      if (replaced !== null) await this.sessions.revokeAccount(replaced, at, "account_switched");
      const now = await this.runtime.set(account.id, at);
      if (o.previousToken !== null) {
        const previous = await this.sessions.byToken(sha256(o.previousToken));
        if (previous !== null) await this.sessions.revoke(previous.id, at, "rotated");
      }
      const token = randomBytes(32).toString("base64url");
      const session: BrowserSessionRecord = {
        id: randomUUID(),
        accountId: account.id,
        epoch: now.epoch,
        createdAt: at,
        lastSeenAt: at,
        expiresAt: new Date(Date.parse(at) + this.config.session.lifetimeMs).toISOString(),
        revokedAt: null,
        revokedReason: null,
        userAgent: o.userAgent === null ? null : o.userAgent.slice(0, 200),
      };
      await this.sessions.insert({ ...session, tokenHash: sha256(token) });
      const owner: Owner = { kind: "owner", accountId: account.id, sessionId: session.id, email: record.email, csrfToken: csrfOf(token), expiresAt: session.expiresAt };
      await this.hooks.signedIn(contextOf(owner), session.id);
      return { token, session, account, identity: record, replaced };
    });
    if (issued.replaced !== null) await this.hooks.accountEnded({ scope: "account", accountId: issued.replaced, reason: "account_switched" });
    return issued;
  }

  // The owner a session token stands for, or null: unknown, revoked, past its lifetime, idle too long, or of an account
  // the runtime does not serve now. A session found idle or expired is revoked as such.
  async resolve(token: string): Promise<Resolved | null> {
    const session = await this.sessions.byToken(sha256(token));
    if (session === null || session.revokedAt !== null) return null;
    const now = Date.now();
    const runtime = await this.runtime.get();
    const why = Date.parse(session.expiresAt) <= now ? "expired" : now - Date.parse(session.lastSeenAt) > this.config.session.idleMs ? "idle" : runtime.accountId !== session.accountId || runtime.epoch !== session.epoch ? "account_not_active" : null;
    if (why !== null) {
      await this.end(session, why);
      return null;
    }
    const identity = await this.accounts.identityOfAccount(session.accountId);
    const account = await this.accounts.get(session.accountId);
    if (identity === null || account === null) return null;
    await this.sessions.touch(session.id, new Date(now).toISOString());
    return { owner: { kind: "owner", accountId: session.accountId, sessionId: session.id, email: identity.email, csrfToken: csrfOf(token), expiresAt: session.expiresAt }, account };
  }

  csrfMatches(owner: Owner, given: string | undefined): boolean {
    return typeof given === "string" && sameText(given, owner.csrfToken);
  }

  // This browser's session ends (signing out of this browser); the account and its other sessions stay.
  async endSession(owner: Owner, reason = "signed_out"): Promise<void> {
    const session = await this.sessions.get(owner.sessionId);
    if (session !== null) await this.end(session, reason);
  }

  // The account stops being the runtime's: every session of it ends, its streams and caches with them.
  async endAccount(accountId: string, reason: string): Promise<void> {
    await this.db.tx(async () => {
      const at = new Date().toISOString();
      const runtime = await this.runtime.lock();
      await this.sessions.revokeAccount(accountId, at, reason);
      if (runtime.accountId === accountId) await this.runtime.set(null, at);
    });
    await this.hooks.accountEnded({ scope: "account", accountId, reason });
  }

  // The account the runtime serves now (null: nobody signed in through a browser yet, or signed out).
  async active(): Promise<string | null> {
    return (await this.runtime.get()).accountId;
  }

  async account(accountId: string): Promise<AccountRecord | null> {
    return this.accounts.get(accountId);
  }

  async identityOf(accountId: string): Promise<IdentityRecord | null> {
    return this.accounts.identityOfAccount(accountId);
  }

  async rename(accountId: string, displayName: string): Promise<AccountRecord | null> {
    return this.accounts.rename(accountId, displayName);
  }

  async openSessions(accountId: string): Promise<BrowserSessionRecord[]> {
    return this.sessions.open(accountId);
  }

  // Whether a session still stands (not revoked, not past its lifetime or idle time); one that lapsed is revoked as such.
  async sessionLive(sessionId: string): Promise<boolean> {
    const session = await this.sessions.get(sessionId);
    if (session === null || session.revokedAt !== null) return false;
    const now = Date.now();
    const lapsed = Date.parse(session.expiresAt) <= now ? "expired" : now - Date.parse(session.lastSeenAt) > this.config.session.idleMs ? "idle" : null;
    if (lapsed === null) return true;
    await this.end(session, lapsed);
    return false;
  }

  // Ends one of the account's own sessions (another browser of the same owner).
  async revokeSession(owner: Owner, sessionId: string): Promise<boolean> {
    const session = await this.sessions.get(sessionId);
    if (session === null || session.accountId !== owner.accountId || session.revokedAt !== null) return false;
    await this.end(session, "revoked_by_owner");
    return true;
  }

  private async end(session: BrowserSessionRecord, reason: string): Promise<void> {
    if (await this.sessions.revoke(session.id, new Date().toISOString(), reason)) await this.hooks.accountEnded({ scope: "session", accountId: session.accountId, sessionId: session.id, reason });
  }
}
