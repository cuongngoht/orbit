// ORBIT'S OWN SIGN-IN (the Identity context): a username and a password, independent of every AI CLI. Signing in to Orbit
// never starts a CLI's sign-in, and no CLI's sign-in signs anybody in to Orbit.
//
//   setup      the first administrator -- or another account, or a user's new password -- from a ONE-TIME CODE an
//              operator printed in a terminal of the server (`cli/governance.js owner setup-code | reset-password`). The
//              code is kept as a hash and used by ONE conditional update: of two browsers with the same code, one gets it.
//   login      counted against the throttle FIRST (throttle.ts), then the password compared with its slow hash (an
//              unknown username is compared with a dummy one, so neither the answer nor its time says which part was
//              wrong). Success issues a new session (the old one of this browser is revoked).
//   password   the current one, then a new one held to the password rules; the user's other sessions end.
//   profile    the user's full name and email (a new email is unverified: only a verified email takes part in sharing);
//              the account's names, contact and time zone -- against the version the page read (If-Match).
//
// Every step is recorded (auth hooks -> governance's audit record).
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import {
  checkChangePassword,
  checkLogin,
  checkPasswordReset,
  checkSetup,
  checkUpdateAccountProfile,
  checkUpdateProfile,
  INVALID_CREDENTIALS,
  PRECONDITION_REQUIRED,
  SETUP_ALREADY_DONE,
  SETUP_CODE_INVALID,
  SETUP_REQUIRED,
  STALE_VERSION,
  type AuthAccount,
  type AuthStatus,
  type AuthUser,
} from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { accepted, ApiError } from "../../common/errors.js";
import { AccountStore, SetupCodeStore, UserStore, type UserRecord } from "../../infra/accounts/stores.js";
import { Db } from "../../infra/db/db.js";
import { AccountsService, accountView, userView, type Issued } from "./accounts.service.js";
import { AuthHooks, type IdentityEvent } from "./auth-hooks.js";
import { DummyHash, hashPassword, needsRehash, verifyPassword } from "./passwords.js";
import { contextOf, systemContext, type Owner } from "./principal.js";
import { setupCodeHash } from "./setup-codes.js";
import { addressKey, ADDRESS_RULE, lockFor, LoginThrottle, SETUP_RULE, setupKey, tooManyAttempts, USERNAME_RULE, usernameKey } from "./throttle.js";

// What a sign-in or a setup knows of the browser it came from.
export interface ClientOf {
  address: string | undefined;
  previousToken: string | null;
  userAgent: string | null;
}

// The trial installation's account (ORBIT_WEB_TRIAL=1; trial.service.ts).
export const TRIAL_USERNAME = "admin";
export const TRIAL_PASSWORD = "123456";

const invalidCode = (): ApiError => new ApiError(HttpStatus.BAD_REQUEST, SETUP_CODE_INVALID, "This setup code cannot be used: it was used already, it expired, or it is not one printed on this server. Print a new one in a terminal of the server.");

const invalidCredentials = (): ApiError => new ApiError(HttpStatus.UNAUTHORIZED, INVALID_CREDENTIALS, "The username or the password is not right.");

// The version a change names (If-Match: "<n>"), or null when it names none.
export function versionOf(ifMatch: string | undefined): number | null {
  if (ifMatch === undefined || ifMatch.trim() === "") return null;
  const m = /^\s*(?:W\/)?"?(\d{1,9})"?\s*$/.exec(ifMatch);
  if (m === null) throw new ApiError(HttpStatus.BAD_REQUEST, "invalid_request", 'If-Match must be the version the page read, e.g. "3".');
  return Number(m[1]);
}

export const stale = (what: string): ApiError => new ApiError(HttpStatus.PRECONDITION_FAILED, STALE_VERSION, `${what} changed since the page read it: read it again.`);

@Injectable()
export class IdentityService {
  private readonly dummy: DummyHash;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Db) private readonly db: Db,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(AccountStore) private readonly accountStore: AccountStore,
    @Inject(UserStore) private readonly users: UserStore,
    @Inject(SetupCodeStore) private readonly codes: SetupCodeStore,
    @Inject(LoginThrottle) private readonly throttle: LoginThrottle,
    @Inject(AuthHooks) private readonly hooks: AuthHooks,
  ) {
    this.dummy = new DummyHash(config.identity.kdf);
  }

  // GET /api/auth/status: what the page shows before anything else.
  async status(owner: Owner | null): Promise<AuthStatus> {
    const trial = await this.trialView();
    if (owner !== null) {
      const user = await this.users.get(owner.userId);
      const account = await this.accountStore.get(owner.accountId);
      if (user !== null && account !== null) {
        return { state: "signed_in", session: { orbitId: owner.accountId, userId: owner.userId, csrfToken: owner.csrfToken, expiresAt: owner.expiresAt }, user: userView(user), account: accountView(account), trial };
      }
    }
    const state = (await this.users.count()) === 0 ? "setup_required" : "signed_out";
    return { state, session: null, user: null, account: null, trial };
  }

  // A SIGN-IN. Counted first; then compared; then a new session.
  async login(body: unknown, client: ClientOf): Promise<Issued> {
    const req = accepted(checkLogin(body));
    if ((await this.users.count()) === 0) {
      await this.hooks.identity(systemContext("sign-in"), { kind: "login_refused", cause: "setup_required" });
      throw new ApiError(HttpStatus.CONFLICT, SETUP_REQUIRED, "Nobody can sign in yet: set up the first administrator with the one-time code printed by `cli/governance.js owner setup-code`.");
    }
    const now = new Date().toISOString();
    const address = addressKey(client.address);
    try {
      await this.throttle.attempt([{ key: usernameKey(req.username), rule: USERNAME_RULE }, { key: address, rule: ADDRESS_RULE }], now);
    } catch (err) {
      await this.refused(null, "too_many_attempts");
      throw err;
    }
    const user = await this.users.byUsername(req.username);
    if (user !== null && user.lockedUntil !== null && Date.parse(user.lockedUntil) > Date.parse(now)) {
      await this.refused(user, "too_many_attempts");
      throw tooManyAttempts(user.lockedUntil);
    }
    const matches = await verifyPassword(req.password, user?.passwordHash ?? (await this.dummy.get()));
    const account = user === null ? null : await this.accountStore.get(user.accountId);
    if (!matches || user === null || account === null || user.disabledAt !== null || account.status !== "active") {
      if (user !== null) await this.failed(user, now);
      await this.refused(user, "invalid_credentials");
      throw invalidCredentials();
    }
    await this.throttle.succeeded(req.username, address);
    if (needsRehash(user.passwordHash, this.config.identity.kdf)) await this.users.rehash(user.id, await hashPassword(req.password, this.config.identity.kdf));
    return this.accounts.issue(user, { previousToken: client.previousToken, userAgent: client.userAgent });
  }

  // THE SETUP: the first administrator, another account, or a reset password -- whichever the code was printed for.
  async setup(body: unknown, client: ClientOf): Promise<Issued> {
    const code = typeof body === "object" && body !== null && typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : "";
    const hash = setupCodeHash(code);
    const now = new Date().toISOString();
    const found = code.length > 0 ? await this.codes.usable(hash, now) : null;
    if (found?.purpose === "reset_password") return this.reset(body, hash, found.userId as string, client);
    const req = accepted(checkSetup(body));
    await this.throttle.attempt([{ key: setupKey(client.address), rule: SETUP_RULE }], now);
    if (found === null) throw invalidCode();
    const passwordHash = await hashPassword(req.password, this.config.identity.kdf);
    const issued = await this.db.tx(async () => {
      // One setup at a time: two first-administrator codes used at once make one account, never two.
      await this.db.query("SELECT pg_advisory_xact_lock(hashtextextended('orbit-web:setup', 0))");
      const userId = randomUUID();
      const used = await this.codes.consume(hash, new Date().toISOString(), userId);
      if (used === null) throw invalidCode();
      if (used.purpose === "first_admin" && (await this.accountStore.anyCustomer())) {
        throw new ApiError(HttpStatus.CONFLICT, SETUP_ALREADY_DONE, "The first administrator is set up already: sign in, or ask an operator for a code that makes another account.");
      }
      const made = await this.accounts.create(
        { displayName: req.companyName !== "" ? req.companyName : req.fullName, companyName: req.companyName, contactEmail: req.contactEmail, timezone: req.timezone },
        { id: userId, username: req.username, fullName: req.fullName, passwordHash, mustChangePassword: false, trialWaiver: false },
        "setup_code",
      );
      await this.hooks.identity(systemContext("setup", made.account.id), { kind: "setup_code_used", purpose: used.purpose as "first_admin" | "new_account" });
      return this.accounts.issue(made.user, { previousToken: client.previousToken, userAgent: client.userAgent });
    });
    await this.throttle.clear(setupKey(client.address));
    return issued;
  }

  // A reset: the code names ONE user, and the request must name the same username (any other is "this code cannot be
  // used", never which part was wrong). Every session of the user ends; this browser gets a new one.
  private async reset(body: unknown, hash: string, userId: string, client: ClientOf): Promise<Issued> {
    const req = accepted(checkPasswordReset(body));
    await this.throttle.attempt([{ key: setupKey(client.address), rule: SETUP_RULE }], new Date().toISOString());
    const target = await this.users.get(userId);
    if (target === null || target.username !== req.username) throw invalidCode();
    const passwordHash = await hashPassword(req.password, this.config.identity.kdf);
    const issued = await this.db.tx(async () => {
      const at = new Date().toISOString();
      if ((await this.codes.consume(hash, at, target.id)) === null) throw invalidCode();
      await this.users.setPassword(target.id, passwordHash, at, { mustChange: false });
      await this.hooks.identity(systemContext("setup", target.accountId), { kind: "password_changed", how: "reset" });
      return { user: (await this.users.get(target.id)) as UserRecord };
    });
    await this.accounts.endUserSessions(target.id, "password_reset");
    await this.throttle.clear(setupKey(client.address));
    await this.throttle.clear(usernameKey(target.username));
    return this.accounts.issue(issued.user, { previousToken: client.previousToken, userAgent: client.userAgent });
  }

  // A NEW PASSWORD, from the current one. The trial seed's waiver ends with it; every other session of the user ends.
  async changePassword(owner: Owner, body: unknown): Promise<AuthUser> {
    const req = accepted(checkChangePassword(body, owner.username));
    const now = new Date().toISOString();
    await this.throttle.attempt([{ key: usernameKey(owner.username), rule: USERNAME_RULE }], now);
    const user = await this.users.get(owner.userId);
    if (user === null || !(await verifyPassword(req.currentPassword, user.passwordHash))) {
      if (user !== null) await this.failed(user, now);
      throw new ApiError(HttpStatus.FORBIDDEN, INVALID_CREDENTIALS, "The current password is not right.");
    }
    await this.throttle.clear(usernameKey(owner.username));
    const hash = await hashPassword(req.newPassword, this.config.identity.kdf);
    await this.db.tx(async () => {
      await this.users.setPassword(user.id, hash, new Date().toISOString(), { mustChange: false });
      await this.hooks.identity(contextOf(owner), { kind: "password_changed", how: "changed" });
    });
    await this.accounts.endUserSessions(user.id, "password_changed", owner.sessionId);
    return userView((await this.users.get(user.id)) as UserRecord);
  }

  // The user's own name and email (If-Match optional: the version the page read).
  async updateProfile(owner: Owner, body: unknown, ifMatch: string | undefined): Promise<AuthUser> {
    const change = accepted(checkUpdateProfile(body));
    const expected = versionOf(ifMatch);
    const updated = await this.db.tx(async () => {
      const u = await this.users.updateProfile(owner.userId, expected, change, new Date().toISOString());
      if (u === "stale") throw stale("Your profile");
      if (u === null) throw new ApiError(HttpStatus.NOT_FOUND, "not_found", "The user was not found");
      await this.hooks.identity(contextOf(owner), { kind: "profile_changed", fields: Object.keys(change) });
      return u;
    });
    return userView(updated);
  }

  // The account's names, contact, time zone and locale -- only against the version the page read (If-Match required).
  async updateAccount(owner: Owner, body: unknown, ifMatch: string | undefined): Promise<AuthAccount> {
    const change = accepted(checkUpdateAccountProfile(body));
    const expected = versionOf(ifMatch);
    if (expected === null) throw new ApiError(HttpStatus.PRECONDITION_REQUIRED, PRECONDITION_REQUIRED, 'A change of the account names the version the page read: If-Match: "<version>".');
    const updated = await this.db.tx(async () => {
      const a = await this.accountStore.update(owner.accountId, expected, change, new Date().toISOString());
      if (a === "stale") throw stale("The account");
      if (a === null) throw new ApiError(HttpStatus.NOT_FOUND, "not_found", "The account was not found");
      await this.hooks.identity(contextOf(owner), { kind: "account_changed", fields: Object.keys(change) });
      return a;
    });
    return accountView(updated);
  }

  async account(owner: Owner): Promise<AuthAccount> {
    const a = await this.accountStore.get(owner.accountId);
    if (a === null) throw new ApiError(HttpStatus.NOT_FOUND, "not_found", "The account was not found");
    return accountView(a);
  }

  // A user's failure: one more in a row, and the lock that many earn.
  private async failed(user: UserRecord, now: string): Promise<void> {
    const n = await this.users.failed(user.id);
    const lock = lockFor(n);
    if (lock !== null) await this.users.lock(user.id, new Date(Date.parse(now) + lock).toISOString());
  }

  private async refused(user: UserRecord | null, cause: Extract<IdentityEvent, { kind: "login_refused" }>["cause"]): Promise<void> {
    await this.hooks.identity(systemContext("sign-in", user?.accountId ?? null), { kind: "login_refused", cause });
  }

  private async trialView(): Promise<AuthStatus["trial"]> {
    if (!this.config.identity.trial) return { enabled: false, username: null, password: null };
    const admin = await this.users.byUsername(TRIAL_USERNAME);
    return { enabled: true, username: TRIAL_USERNAME, password: admin !== null && admin.trialWaiver ? TRIAL_PASSWORD : null };
  }
}

