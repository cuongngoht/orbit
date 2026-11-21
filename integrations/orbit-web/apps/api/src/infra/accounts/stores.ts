// IDENTITY, as stored: accounts (the OrbitId of every record), the users who sign in to them, the one-time setup codes
// an operator prints, the sign-in throttle, browser sessions, and what each account set for itself. Each store owns its
// SQL.
//
// Nothing secret is stored in the clear: a password is a slow hash (modules/auth/passwords.ts), a setup code and a
// session token are found by their SHA-256, and a session's CSRF token is derived from its token where it is needed.
import { createHash } from "node:crypto";
import { Db, jsonParam, type Row } from "../db/db.js";

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

// The reserved SYSTEM account (made by the initial migration): what is the deployment's own -- its settings, the
// installed CLIs, its isolation checks, its audit chain, the sign-in throttle. It never signs in.
export const SYSTEM_ACCOUNT_ID = "00000000-0000-4000-8000-000000000001";

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

// What a versioned update answers: the record as it is now, `stale` when it moved past the version asked for, null when
// there is no such record.
export type Versioned<T> = T | "stale" | null;

// ---- accounts ---------------------------------------------------------------------------------------------------------

export interface AccountRecord {
  id: string;
  kind: "customer" | "system";
  displayName: string;
  companyName: string;
  contactEmail: string | null;
  timezone: string;
  locale: string;
  status: "active" | "suspended";
  createdAt: string;
  updatedAt: string;
  version: number;
}

export type AccountFields = Partial<Pick<AccountRecord, "displayName" | "companyName" | "contactEmail" | "timezone" | "locale">>;

const accountOf = (r: Row): AccountRecord => ({
  id: str(r.id),
  kind: str(r.kind) as AccountRecord["kind"],
  displayName: str(r.display_name),
  companyName: str(r.company_name),
  contactEmail: strOrNull(r.contact_email),
  timezone: str(r.timezone),
  locale: str(r.locale),
  status: str(r.status) as AccountRecord["status"],
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
  version: Number(r.version),
});

const ACCOUNT_COLUMNS: Record<keyof AccountFields, string> = { displayName: "display_name", companyName: "company_name", contactEmail: "contact_email", timezone: "timezone", locale: "locale" };

export class AccountStore {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<AccountRecord | null> {
    const row = await this.db.one("SELECT * FROM accounts WHERE id = $1", [id]);
    return row === null ? null : accountOf(row);
  }

  async insert(a: Pick<AccountRecord, "id" | "displayName" | "companyName" | "contactEmail" | "timezone" | "locale" | "createdAt">): Promise<void> {
    await this.db.query("INSERT INTO accounts (id, kind, display_name, company_name, contact_email, timezone, locale, status, created_at, updated_at, version) VALUES ($1, 'customer', $2, $3, $4, $5, $6, 'active', $7, $7, 1)", [
      a.id,
      a.displayName,
      a.companyName,
      a.contactEmail,
      a.timezone,
      a.locale,
      a.createdAt,
    ]);
  }

  // Changes the fields named, when the account is still at `expectedVersion` (its version moves by one).
  async update(id: string, expectedVersion: number, fields: AccountFields, at: string): Promise<Versioned<AccountRecord>> {
    const names = (Object.keys(fields) as (keyof AccountFields)[]).filter((k) => fields[k] !== undefined);
    const sets = names.map((k, i) => `${ACCOUNT_COLUMNS[k]} = $${i + 4}`);
    const row = await this.db.one(`UPDATE accounts SET ${[...sets, "updated_at = $3", "version = version + 1"].join(", ")} WHERE id = $1 AND version = $2 AND kind = 'customer' RETURNING *`, [
      id,
      expectedVersion,
      at,
      ...names.map((k) => fields[k] as string | null),
    ]);
    if (row !== null) return accountOf(row);
    return (await this.get(id)) === null ? null : "stale";
  }

  async customers(): Promise<AccountRecord[]> {
    return (await this.db.query("SELECT * FROM accounts WHERE kind = 'customer' ORDER BY created_at, id")).map(accountOf);
  }

  async anyCustomer(): Promise<boolean> {
    return (await this.db.one("SELECT 1 AS x FROM accounts WHERE kind = 'customer' LIMIT 1")) !== null;
  }
}

// ---- users --------------------------------------------------------------------------------------------------------------

export interface UserRecord {
  id: string;
  accountId: string;
  username: string;
  fullName: string;
  email: string | null;
  emailVerifiedAt: string | null;
  role: "owner";
  passwordHash: string;
  passwordChangedAt: string;
  mustChangePassword: boolean;
  trialWaiver: boolean;
  lastLoginAt: string | null;
  failedAttempts: number;
  lockedUntil: string | null;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const userOf = (r: Row): UserRecord => ({
  id: str(r.id),
  accountId: str(r.account_id),
  username: str(r.username),
  fullName: str(r.full_name),
  email: strOrNull(r.email),
  emailVerifiedAt: strOrNull(r.email_verified_at),
  role: str(r.role) as UserRecord["role"],
  passwordHash: str(r.password_hash),
  passwordChangedAt: str(r.password_changed_at),
  mustChangePassword: r.must_change_password === true,
  trialWaiver: r.trial_waiver === true,
  lastLoginAt: strOrNull(r.last_login_at),
  failedAttempts: Number(r.failed_attempts),
  lockedUntil: strOrNull(r.locked_until),
  disabledAt: strOrNull(r.disabled_at),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
  version: Number(r.version),
});

export class UserStore {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<UserRecord | null> {
    const row = await this.db.one("SELECT * FROM users WHERE id = $1", [id]);
    return row === null ? null : userOf(row);
  }

  async byUsername(username: string): Promise<UserRecord | null> {
    const row = await this.db.one("SELECT * FROM users WHERE username = $1", [username]);
    return row === null ? null : userOf(row);
  }

  // The user whose VERIFIED email this is (an unverified email names nobody).
  async byVerifiedEmail(email: string): Promise<UserRecord | null> {
    const row = await this.db.one("SELECT * FROM users WHERE email = $1 AND email_verified_at IS NOT NULL", [email]);
    return row === null ? null : userOf(row);
  }

  async ofAccount(accountId: string): Promise<UserRecord[]> {
    return (await this.db.query("SELECT * FROM users WHERE account_id = $1 ORDER BY created_at, id", [accountId])).map(userOf);
  }

  async count(): Promise<number> {
    return Number((await this.db.one("SELECT count(*) AS n FROM users"))?.n ?? 0);
  }

  // Inserts the user unless the username is taken; true when this call inserted it.
  async insert(u: Pick<UserRecord, "id" | "accountId" | "username" | "fullName" | "email" | "role" | "passwordHash" | "mustChangePassword" | "trialWaiver" | "createdAt">): Promise<boolean> {
    const n = await this.db.run(
      "INSERT INTO users (id, account_id, username, full_name, email, role, password_hash, password_changed_at, must_change_password, trial_waiver, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $8, $8) ON CONFLICT (username) DO NOTHING",
      [u.id, u.accountId, u.username, u.fullName, u.email, u.role, u.passwordHash, u.createdAt, u.mustChangePassword, u.trialWaiver],
    );
    return n > 0;
  }

  // A new password: the waiver of the trial seed and any lockout end with it.
  async setPassword(id: string, hash: string, at: string, o: { mustChange: boolean }): Promise<void> {
    await this.db.query(
      "UPDATE users SET password_hash = $2, password_changed_at = $3, must_change_password = $4, trial_waiver = false, failed_attempts = 0, locked_until = NULL, updated_at = $3, version = version + 1 WHERE id = $1",
      [id, hash, at, o.mustChange],
    );
  }

  // The same password, stored again at today's cost (a hash made at another cost).
  async rehash(id: string, hash: string): Promise<void> {
    await this.db.query("UPDATE users SET password_hash = $2 WHERE id = $1", [id, hash]);
  }

  async signedIn(id: string, at: string): Promise<void> {
    await this.db.query("UPDATE users SET last_login_at = $2, failed_attempts = 0, locked_until = NULL WHERE id = $1", [id, at]);
  }

  // One more failed sign-in in a row; how many there are now.
  async failed(id: string): Promise<number> {
    return Number((await this.db.one("UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = $1 RETURNING failed_attempts", [id]))?.failed_attempts ?? 0);
  }

  async lock(id: string, until: string): Promise<void> {
    await this.db.query("UPDATE users SET locked_until = $2 WHERE id = $1", [id, until]);
  }

  // The user's own fields, when the user is still at `expectedVersion` (null: whatever it is). A new email is unverified.
  async updateProfile(id: string, expectedVersion: number | null, fields: { fullName?: string; email?: string | null }, at: string): Promise<Versioned<UserRecord>> {
    const row = await this.db.one(
      `UPDATE users SET
         full_name = COALESCE($3, full_name),
         email = CASE WHEN $4 THEN $5 ELSE email END,
         email_verified_at = CASE WHEN $4 AND $5 IS DISTINCT FROM email THEN NULL ELSE email_verified_at END,
         updated_at = $6, version = version + 1
       WHERE id = $1 AND ($2::integer IS NULL OR version = $2) RETURNING *`,
      [id, expectedVersion, fields.fullName ?? null, fields.email !== undefined, fields.email ?? null, at],
    );
    if (row !== null) return userOf(row);
    return (await this.get(id)) === null ? null : "stale";
  }

  // An email marked verified. Nothing in this release sends a verification message (no delivery channel yet), so only
  // the installation itself (a test, a terminal) marks one.
  async markEmailVerified(id: string, at: string): Promise<void> {
    await this.db.query("UPDATE users SET email_verified_at = $2, updated_at = $2, version = version + 1 WHERE id = $1 AND email IS NOT NULL", [id, at]);
  }
}

// ---- one-time setup codes ---------------------------------------------------------------------------------------------

export type SetupCodePurposeRecord = "first_admin" | "new_account" | "reset_password";

export interface SetupCodeRecord {
  id: string;
  accountId: string;
  purpose: SetupCodePurposeRecord;
  userId: string | null;
  createdAt: string;
  expiresAt: string;
  consumedAt: string | null;
  consumedBy: string | null;
}

const setupCodeOf = (r: Row): SetupCodeRecord => ({
  id: str(r.id),
  accountId: str(r.account_id),
  purpose: str(r.purpose) as SetupCodePurposeRecord,
  userId: strOrNull(r.user_id),
  createdAt: str(r.created_at),
  expiresAt: str(r.expires_at),
  consumedAt: strOrNull(r.consumed_at),
  consumedBy: strOrNull(r.consumed_by),
});

export class SetupCodeStore {
  constructor(private readonly db: Db) {}

  async insert(c: Omit<SetupCodeRecord, "consumedAt" | "consumedBy"> & { codeHash: string }): Promise<void> {
    await this.db.query("INSERT INTO setup_codes (id, account_id, purpose, user_id, code_hash, created_at, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [
      c.id,
      c.accountId,
      c.purpose,
      c.userId,
      c.codeHash,
      c.createdAt,
      c.expiresAt,
    ]);
  }

  // A code that can still be used, without using it.
  async usable(codeHash: string, now: string): Promise<SetupCodeRecord | null> {
    const row = await this.db.one("SELECT * FROM setup_codes WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > $2", [codeHash, now]);
    return row === null ? null : setupCodeOf(row);
  }

  // USES the code: one conditional update, so of two requests with the same code exactly one gets it back.
  async consume(codeHash: string, now: string, consumedBy: string): Promise<SetupCodeRecord | null> {
    const row = await this.db.one("UPDATE setup_codes SET consumed_at = $2, consumed_by = $3 WHERE code_hash = $1 AND consumed_at IS NULL AND expires_at > $2 RETURNING *", [codeHash, now, consumedBy]);
    return row === null ? null : setupCodeOf(row);
  }
}

// ---- the sign-in throttle ---------------------------------------------------------------------------------------------

// One key's rule: `free` attempts in a window, then every further attempt waits a delay that doubles from `firstDelayMs`
// up to `maxDelayMs`. A key is a typed username (`user:<name>`, whether or not it exists) or a hashed client address.
export interface ThrottleRule {
  windowMs: number;
  free: number;
  firstDelayMs: number;
  maxDelayMs: number;
}

export type ThrottleAnswer = { allowed: true; failures: number } | { allowed: false; until: string };

// The throttle's rows are the deployment's (the system account's): a username or an address belongs to no account.
export class LoginThrottleStore {
  constructor(private readonly db: Db) {}

  // COUNTS one attempt and says whether it may go ahead -- in ONE statement, so a burst of attempts at once is held to
  // the rule as if they came one after another. An attempt past the free ones goes ahead and sets the wait for the next.
  async attempt(key: string, now: string, rule: ThrottleRule): Promise<ThrottleAnswer> {
    const windowStart = new Date(Date.parse(now) - rule.windowMs).toISOString();
    const counted = "CASE WHEN t.window_start < $4::timestamptz THEN 1 ELSE t.failures + 1 END";
    const wait = (n: string) => `CASE WHEN ${n} > $5::integer THEN $3::timestamptz + make_interval(secs => LEAST($7::float8, $6::float8 * power(2, ${n} - $5::integer - 1))) ELSE NULL END`;
    const row = await this.db.one(
      `INSERT INTO login_throttle AS t (account_id, key, failures, window_start, blocked_until) VALUES ($1, $2, 1, $3::timestamptz, ${wait("1")})
       ON CONFLICT (account_id, key) DO UPDATE SET
         failures = ${counted},
         window_start = CASE WHEN t.window_start < $4::timestamptz THEN $3::timestamptz ELSE t.window_start END,
         blocked_until = ${wait(counted)}
       WHERE t.blocked_until IS NULL OR t.blocked_until <= $3::timestamptz
       RETURNING failures`,
      [SYSTEM_ACCOUNT_ID, key, now, windowStart, rule.free, rule.firstDelayMs / 1000, rule.maxDelayMs / 1000],
    );
    if (row !== null) return { allowed: true, failures: Number(row.failures) };
    const blocked = await this.db.one("SELECT blocked_until FROM login_throttle WHERE account_id = $1 AND key = $2", [SYSTEM_ACCOUNT_ID, key]);
    return { allowed: false, until: strOrNull(blocked?.blocked_until) ?? now };
  }

  // A sign-in that succeeded: the username's count starts again.
  async clear(key: string): Promise<void> {
    await this.db.query("DELETE FROM login_throttle WHERE account_id = $1 AND key = $2", [SYSTEM_ACCOUNT_ID, key]);
  }

  // A sign-in that succeeded from an address: its attempt is not held against the others there.
  async relieve(key: string): Promise<void> {
    await this.db.query("UPDATE login_throttle SET failures = GREATEST(failures - 1, 0) WHERE account_id = $1 AND key = $2", [SYSTEM_ACCOUNT_ID, key]);
  }
}

// ---- browser sessions ----------------------------------------------------------------------------------------------

export interface BrowserSessionRecord {
  id: string;
  accountId: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  userAgent: string | null;
}

const sessionOf = (r: Row): BrowserSessionRecord => ({
  id: str(r.id),
  accountId: str(r.account_id),
  userId: str(r.user_id),
  createdAt: str(r.created_at),
  lastSeenAt: str(r.last_seen_at),
  expiresAt: str(r.expires_at),
  revokedAt: strOrNull(r.revoked_at),
  revokedReason: strOrNull(r.revoked_reason),
  userAgent: strOrNull(r.user_agent),
});

export interface EndedSession {
  id: string;
  accountId: string;
  userId: string;
}

const endedOf = (r: Row): EndedSession => ({ id: str(r.id), accountId: str(r.account_id), userId: str(r.user_id) });

export class BrowserSessionStore {
  constructor(private readonly db: Db) {}

  async insert(s: Omit<BrowserSessionRecord, "revokedAt" | "revokedReason"> & { tokenHash: string }): Promise<void> {
    await this.db.query("INSERT INTO account_sessions (id, token_hash, account_id, user_id, created_at, last_seen_at, expires_at, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
      s.id,
      s.tokenHash,
      s.accountId,
      s.userId,
      s.createdAt,
      s.lastSeenAt,
      s.expiresAt,
      s.userAgent,
    ]);
  }

  async byToken(tokenHash: string): Promise<BrowserSessionRecord | null> {
    const row = await this.db.one("SELECT * FROM account_sessions WHERE token_hash = $1", [tokenHash]);
    return row === null ? null : sessionOf(row);
  }

  async get(id: string): Promise<BrowserSessionRecord | null> {
    const row = await this.db.one("SELECT * FROM account_sessions WHERE id = $1", [id]);
    return row === null ? null : sessionOf(row);
  }

  // A user's sessions that still stand (not revoked, not past their lifetime), newest first.
  async openOfUser(userId: string, now: string): Promise<BrowserSessionRecord[]> {
    return (await this.db.query("SELECT * FROM account_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY created_at DESC, id", [userId, now])).map(sessionOf);
  }

  async openOfAccount(accountId: string, now: string): Promise<BrowserSessionRecord[]> {
    return (await this.db.query("SELECT * FROM account_sessions WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY created_at DESC, id", [accountId, now])).map(sessionOf);
  }

  // Seen now -- at most once a minute, so a page's requests do not each write.
  async touch(id: string, at: string): Promise<void> {
    await this.db.query("UPDATE account_sessions SET last_seen_at = $2 WHERE id = $1 AND revoked_at IS NULL AND last_seen_at < ($2::timestamptz - interval '1 minute')", [id, at]);
  }

  async revoke(id: string, at: string, reason: string): Promise<boolean> {
    return (await this.db.run("UPDATE account_sessions SET revoked_at = $2, revoked_reason = $3 WHERE id = $1 AND revoked_at IS NULL", [id, at, reason])) > 0;
  }

  // Ends every open session of a user (but `except`, when named): the ones it ended.
  async revokeUser(userId: string, at: string, reason: string, except: string | null = null): Promise<EndedSession[]> {
    return (await this.db.query("UPDATE account_sessions SET revoked_at = $2, revoked_reason = $3 WHERE user_id = $1 AND revoked_at IS NULL AND ($4::uuid IS NULL OR id <> $4::uuid) RETURNING id, account_id, user_id", [userId, at, reason, except])).map(endedOf);
  }

  async revokeAccount(accountId: string, at: string, reason: string): Promise<EndedSession[]> {
    return (await this.db.query("UPDATE account_sessions SET revoked_at = $2, revoked_reason = $3 WHERE account_id = $1 AND revoked_at IS NULL RETURNING id, account_id, user_id", [accountId, at, reason])).map(endedOf);
  }

  async revokeAll(at: string, reason: string): Promise<EndedSession[]> {
    return (await this.db.query("UPDATE account_sessions SET revoked_at = $1, revoked_reason = $2 WHERE revoked_at IS NULL RETURNING id, account_id, user_id", [at, reason])).map(endedOf);
  }
}

// ---- settings ------------------------------------------------------------------------------------------------------

// What an account set for itself (its preferences, its privileged switches, its connector choices). The deployment's
// own settings are the SYSTEM account's rows (infra/storage/stores.ts SettingsStore).
export class AccountSettingsStore {
  constructor(private readonly db: Db) {}

  async get<T>(accountId: string, key: string): Promise<T | undefined> {
    const row = await this.db.one("SELECT value FROM account_settings WHERE account_id = $1 AND key = $2", [accountId, key]);
    return row === null ? undefined : (row.value as T);
  }

  async set(accountId: string, key: string, value: unknown): Promise<void> {
    await this.db.query("INSERT INTO account_settings (account_id, key, value, updated_at) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (account_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", [
      accountId,
      key,
      jsonParam(value),
      new Date().toISOString(),
    ]);
  }

  async delete(accountId: string, key: string): Promise<void> {
    await this.db.query("DELETE FROM account_settings WHERE account_id = $1 AND key = $2", [accountId, key]);
  }
}
