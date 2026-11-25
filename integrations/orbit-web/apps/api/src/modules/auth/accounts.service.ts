// ACCOUNTS, USERS AND BROWSER SESSIONS.
//
// AN ACCOUNT (its id is the OrbitId) is the tenant every record of Orbit Web carries. It is made with its first user --
// by a one-time setup code an operator printed in a terminal of the server, or by the localhost trial's seed -- and
// never by an AI CLI's sign-in. It is never made without what governance owes it (accountCreated: its audit chain and
// its default policy), in the same transaction.
//
// A BROWSER SESSION is issued to the browser a user signed in from, and to no other: its token is random, sent once as
// an HttpOnly cookie, and kept here as its SHA-256. It is valid by its user, its lifetime and its idle limit ALONE:
// nothing an AI CLI is signed in as has any part in it. It ends when it is revoked (sign-out, sign-out everywhere, a
// password reset, its owner ending it), at its lifetime, or after it sits idle. Its CSRF token is derived from the token,
// never stored. A sign-in always issues a NEW session: whatever this browser held before is revoked (rotation).
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { USERNAME_TAKEN, shareAddressOf, type AuthAccount, type AuthUser, type SessionView } from "@orbit-web/contracts";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { ApiError } from "../../common/errors.js";
import { AccountSettingsStore, AccountStore, BrowserSessionStore, sha256, UserStore, type AccountRecord, type BrowserSessionRecord, type UserRecord } from "../../infra/accounts/stores.js";
import { Db } from "../../infra/db/db.js";
import { AuthHooks, type CreatedAccount } from "./auth-hooks.js";
import { contextOf, type Owner } from "./principal.js";

export const CSRF_SALT = "orbit-web/session-csrf/";

export const csrfOf = (token: string): string => sha256(`${CSRF_SALT}${token}`);

// The address a user is shared with: their VERIFIED email, or their username's own address on this deployment.
export const shareAddressOfUser = (u: Pick<UserRecord, "username" | "email" | "emailVerifiedAt">): string => (u.email !== null && u.emailVerifiedAt !== null ? u.email : shareAddressOf(u.username));

export const userView = (u: UserRecord): AuthUser => ({
  id: u.id,
  username: u.username,
  fullName: u.fullName,
  email: u.email,
  emailVerified: u.email !== null && u.emailVerifiedAt !== null,
  role: u.role,
  mustChangePassword: u.mustChangePassword,
  trialPassword: u.trialWaiver,
  lastLoginAt: u.lastLoginAt,
  shareAddress: shareAddressOfUser(u),
  version: u.version,
});

export const accountView = (a: AccountRecord): AuthAccount => ({
  orbitId: a.id,
  displayName: a.displayName,
  companyName: a.companyName,
  contactEmail: a.contactEmail,
  timezone: a.timezone,
  locale: a.locale,
  createdAt: a.createdAt,
  version: a.version,
});

export interface NewAccount {
  displayName: string;
  companyName: string;
  contactEmail: string | null;
  timezone: string;
  locale?: string;
}

export interface NewOwner {
  id?: string;
  username: string;
  fullName: string;
  email?: string | null;
  passwordHash: string;
  mustChangePassword: boolean;
  trialWaiver: boolean;
}

export interface Issued {
  token: string;
  session: BrowserSessionRecord;
  owner: Owner;
  user: UserRecord;
  account: AccountRecord;
}

export interface Resolved {
  owner: Owner;
  user: UserRecord;
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
    @Inject(UserStore) readonly users: UserStore,
    @Inject(BrowserSessionStore) private readonly sessions: BrowserSessionStore,
    @Inject(AccountSettingsStore) readonly settings: AccountSettingsStore,
    @Inject(AuthHooks) private readonly hooks: AuthHooks,
  ) {}

  // An account and its owner user, with what governance owes the account -- all in one transaction (the caller's, when
  // there is one). A username somebody has already is a 409, and nothing is made.
  async create(account: NewAccount, owner: NewOwner, how: CreatedAccount["how"]): Promise<{ account: AccountRecord; user: UserRecord }> {
    return this.db.tx(async () => {
      const at = new Date().toISOString();
      const id = randomUUID();
      await this.accounts.insert({ id, displayName: account.displayName, companyName: account.companyName, contactEmail: account.contactEmail, timezone: account.timezone, locale: account.locale ?? "en", createdAt: at });
      const userId = owner.id ?? randomUUID();
      const inserted = await this.users.insert({
        id: userId,
        accountId: id,
        username: owner.username,
        fullName: owner.fullName,
        email: owner.email ?? null,
        role: "owner",
        passwordHash: owner.passwordHash,
        mustChangePassword: owner.mustChangePassword,
        trialWaiver: owner.trialWaiver,
        createdAt: at,
      });
      if (!inserted) throw new ApiError(HttpStatus.CONFLICT, USERNAME_TAKEN, `The username ${owner.username} is taken: choose another.`);
      await this.hooks.accountCreated({ accountId: id, how, at });
      this.logger.log(`account ${id} created (${how})`);
      return { account: (await this.accounts.get(id)) as AccountRecord, user: (await this.users.get(userId)) as UserRecord };
    });
  }

  // A session for the browser `user` just signed in from (in the caller's transaction when there is one). Whatever
  // session this browser presented before is revoked: the session rotates at every sign-in.
  async issue(user: UserRecord, o: { previousToken: string | null; userAgent: string | null }): Promise<Issued> {
    return this.db.tx(async () => {
      const at = new Date().toISOString();
      const account = await this.accounts.get(user.accountId);
      if (account === null) throw new Error(`user ${user.id} has no account`);
      if (o.previousToken !== null) {
        const previous = await this.sessions.byToken(sha256(o.previousToken));
        if (previous !== null) await this.sessions.revoke(previous.id, at, "rotated");
      }
      const token = randomBytes(32).toString("base64url");
      const session: BrowserSessionRecord = {
        id: randomUUID(),
        accountId: user.accountId,
        userId: user.id,
        createdAt: at,
        lastSeenAt: at,
        expiresAt: new Date(Date.parse(at) + this.config.session.lifetimeMs).toISOString(),
        revokedAt: null,
        revokedReason: null,
        userAgent: o.userAgent === null ? null : o.userAgent.slice(0, 200),
      };
      await this.sessions.insert({ ...session, tokenHash: sha256(token) });
      await this.users.signedIn(user.id, at);
      const signedIn = (await this.users.get(user.id)) as UserRecord;
      const owner = this.ownerOf(signedIn, session, token);
      await this.hooks.signedIn(contextOf(owner), session.id);
      return { token, session, owner, user: signedIn, account };
    });
  }

  ownerOf(user: UserRecord, session: Pick<BrowserSessionRecord, "id" | "expiresAt">, token: string): Owner {
    return {
      kind: "owner",
      accountId: user.accountId,
      userId: user.id,
      sessionId: session.id,
      username: user.username,
      fullName: user.fullName,
      email: shareAddressOfUser(user),
      csrfToken: csrfOf(token),
      expiresAt: session.expiresAt,
    };
  }

  // The owner a session token stands for, or null: unknown, revoked, past its lifetime or idle too long (it is revoked
  // as such), or of a user who is disabled, in an account that is suspended.
  async resolve(token: string): Promise<Resolved | null> {
    const session = await this.sessions.byToken(sha256(token));
    if (session === null || session.revokedAt !== null) return null;
    const now = Date.now();
    const lapsed = this.lapsed(session, now);
    if (lapsed !== null) {
      await this.end(session, lapsed);
      return null;
    }
    const user = await this.users.get(session.userId);
    const account = await this.accounts.get(session.accountId);
    if (user === null || account === null || user.disabledAt !== null || account.status !== "active" || user.accountId !== session.accountId) return null;
    await this.sessions.touch(session.id, new Date(now).toISOString());
    return { owner: this.ownerOf(user, session, token), user, account };
  }

  // The person who asked, as they are NOW -- for their own request Orbit carries out later (a hiring request the CEO
  // planned): null when they no longer exist, are disabled, belong to another account, or the account is suspended. The
  // session they asked from is named, never needed alive: nothing is decided from it.
  async ownerNow(accountId: string, userId: string, sessionId: string): Promise<Owner | null> {
    const user = await this.users.get(userId);
    const account = await this.accounts.get(accountId);
    if (user === null || account === null || user.accountId !== accountId || user.disabledAt !== null || account.status !== "active") return null;
    return { kind: "owner", accountId, userId: user.id, sessionId, username: user.username, fullName: user.fullName, email: shareAddressOfUser(user), csrfToken: "", expiresAt: new Date().toISOString() };
  }

  csrfMatches(owner: Owner, given: string | undefined): boolean {
    return typeof given === "string" && sameText(given, owner.csrfToken);
  }

  // This browser's session ends (signing out of this browser); the user's other sessions stay.
  async endSession(owner: Owner, reason = "signed_out"): Promise<void> {
    const session = await this.sessions.get(owner.sessionId);
    if (session !== null) await this.end(session, reason);
  }

  // Every session of a user ends (but `except`); their streams close. How many ended.
  async endUserSessions(userId: string, reason: string, except: string | null = null): Promise<number> {
    const ended = await this.sessions.revokeUser(userId, new Date().toISOString(), reason, except);
    if (ended.length > 0) await this.hooks.sessionsEnded({ scope: "sessions", accountId: (ended[0] as { accountId: string }).accountId, sessionIds: ended.map((e) => e.id), reason });
    return ended.length;
  }

  // Whether a session still stands (not revoked, not past its lifetime or idle time); one that lapsed is revoked as such.
  async sessionLive(sessionId: string): Promise<boolean> {
    const session = await this.sessions.get(sessionId);
    if (session === null || session.revokedAt !== null) return false;
    const lapsed = this.lapsed(session, Date.now());
    if (lapsed === null) return true;
    await this.end(session, lapsed);
    return false;
  }

  // One of the user's own sessions (another browser of theirs) ends. Another user's is not found.
  async revokeSession(owner: Owner, sessionId: string): Promise<boolean> {
    const session = await this.sessions.get(sessionId);
    if (session === null || session.userId !== owner.userId || session.revokedAt !== null) return false;
    await this.end(session, "revoked_by_owner");
    return true;
  }

  async openSessions(owner: Owner): Promise<SessionView[]> {
    const open = await this.sessions.openOfUser(owner.userId, new Date().toISOString());
    return open.filter((s) => this.lapsed(s, Date.now()) === null).map((s) => ({ id: s.id, current: s.id === owner.sessionId, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, expiresAt: s.expiresAt, userAgent: s.userAgent }));
  }

  async account(accountId: string): Promise<AccountRecord | null> {
    return this.accounts.get(accountId);
  }

  async user(userId: string): Promise<UserRecord | null> {
    return this.users.get(userId);
  }

  private lapsed(session: BrowserSessionRecord, now: number): string | null {
    if (Date.parse(session.expiresAt) <= now) return "expired";
    return now - Date.parse(session.lastSeenAt) > this.config.session.idleMs ? "idle" : null;
  }

  private async end(session: BrowserSessionRecord, reason: string): Promise<void> {
    if (await this.sessions.revoke(session.id, new Date().toISOString(), reason)) await this.hooks.sessionsEnded({ scope: "session", accountId: session.accountId, sessionId: session.id, reason });
  }
}
