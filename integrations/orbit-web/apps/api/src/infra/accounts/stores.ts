// ACCOUNTS, as stored: an internal account per verified Claude identity, the one identity this runtime's CLI serves now,
// the browser sessions a finished sign-in issued, and what each account set for itself. Each store owns its SQL.
//
// A session token and a CSRF token are never stored: a session is found by the SHA-256 of its token, and its CSRF token
// is derived from the token where it is needed.
import { createHash } from "node:crypto";
import { Db, jsonParam, type Row } from "../db/db.js";

export const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

// ---- accounts and identities ----------------------------------------------------------------------------------------

export interface AccountRecord {
  id: string;
  displayName: string;
  createdAt: string;
}

export interface IdentityRecord {
  id: string;
  accountId: string;
  provider: "claude.ai";
  // The CLI's account email, lower case, and the organization's id as the CLI names it ('' when it names none).
  emailNorm: string;
  orgKey: string;
  email: string;
  orgName: string | null;
  plan: string | null;
  createdAt: string;
  verifiedAt: string;
}

const accountOf = (r: Row): AccountRecord => ({ id: str(r.id), displayName: str(r.display_name), createdAt: str(r.created_at) });

const identityOf = (r: Row): IdentityRecord => ({
  id: str(r.id),
  accountId: str(r.account_id),
  provider: "claude.ai",
  emailNorm: str(r.email_norm),
  orgKey: str(r.org_key),
  email: str(r.email),
  orgName: strOrNull(r.org_name),
  plan: strOrNull(r.plan),
  createdAt: str(r.created_at),
  verifiedAt: str(r.verified_at),
});

export class AccountStore {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<AccountRecord | null> {
    const row = await this.db.one("SELECT * FROM accounts WHERE id = $1", [id]);
    return row === null ? null : accountOf(row);
  }

  async insert(a: AccountRecord): Promise<void> {
    await this.db.query("INSERT INTO accounts (id, display_name, created_at) VALUES ($1, $2, $3)", [a.id, a.displayName, a.createdAt]);
  }

  async rename(id: string, displayName: string): Promise<AccountRecord | null> {
    const row = await this.db.one("UPDATE accounts SET display_name = $2 WHERE id = $1 RETURNING *", [id, displayName]);
    return row === null ? null : accountOf(row);
  }

  async identity(provider: string, emailNorm: string, orgKey: string): Promise<IdentityRecord | null> {
    const row = await this.db.one("SELECT * FROM account_identities WHERE provider = $1 AND email_norm = $2 AND org_key = $3", [provider, emailNorm, orgKey]);
    return row === null ? null : identityOf(row);
  }

  async identityOfAccount(accountId: string): Promise<IdentityRecord | null> {
    const row = await this.db.one("SELECT * FROM account_identities WHERE account_id = $1", [accountId]);
    return row === null ? null : identityOf(row);
  }

  // Inserts the identity unless one with the same key exists; true when this call inserted it.
  async insertIdentity(i: IdentityRecord): Promise<boolean> {
    const n = await this.db.run(
      "INSERT INTO account_identities (id, account_id, provider, email_norm, org_key, email, org_name, plan, created_at, verified_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (provider, email_norm, org_key) DO NOTHING",
      [i.id, i.accountId, i.provider, i.emailNorm, i.orgKey, i.email, i.orgName, i.plan, i.createdAt, i.verifiedAt],
    );
    return n > 0;
  }

  // What the CLI said about the identity at a verified sign-in (its display fields only: the key never changes).
  async verified(identityId: string, fields: { email: string; orgName: string | null; plan: string | null }, at: string): Promise<void> {
    await this.db.query("UPDATE account_identities SET email = $2, org_name = $3, plan = $4, verified_at = $5 WHERE id = $1", [identityId, fields.email, fields.orgName, fields.plan, at]);
  }
}

// ---- the runtime's one identity ---------------------------------------------------------------------------------------

export interface RuntimeIdentity {
  accountId: string | null;
  epoch: number;
  changedAt: string;
}

export class RuntimeIdentityStore {
  constructor(private readonly db: Db) {}

  async get(): Promise<RuntimeIdentity> {
    const row = (await this.db.one("SELECT account_id, epoch, changed_at FROM runtime_identity WHERE singleton")) as Row;
    return { accountId: strOrNull(row.account_id), epoch: Number(row.epoch), changedAt: str(row.changed_at) };
  }

  // The row, locked until the transaction this is called in ends: sign-ins, sign-outs and switches take turns.
  async lock(): Promise<RuntimeIdentity> {
    const row = (await this.db.one("SELECT account_id, epoch, changed_at FROM runtime_identity WHERE singleton FOR UPDATE")) as Row;
    return { accountId: strOrNull(row.account_id), epoch: Number(row.epoch), changedAt: str(row.changed_at) };
  }

  // The runtime now serves `accountId` (or nobody); a change of account starts a new epoch.
  async set(accountId: string | null, at: string): Promise<RuntimeIdentity> {
    const row = (await this.db.one(
      "UPDATE runtime_identity SET epoch = CASE WHEN account_id IS DISTINCT FROM $1::uuid THEN epoch + 1 ELSE epoch END, account_id = $1::uuid, changed_at = $2 WHERE singleton RETURNING account_id, epoch, changed_at",
      [accountId, at],
    )) as Row;
    return { accountId: strOrNull(row.account_id), epoch: Number(row.epoch), changedAt: str(row.changed_at) };
  }
}

// ---- browser sessions ----------------------------------------------------------------------------------------------

export interface BrowserSessionRecord {
  id: string;
  accountId: string;
  epoch: number;
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
  epoch: Number(r.epoch),
  createdAt: str(r.created_at),
  lastSeenAt: str(r.last_seen_at),
  expiresAt: str(r.expires_at),
  revokedAt: strOrNull(r.revoked_at),
  revokedReason: strOrNull(r.revoked_reason),
  userAgent: strOrNull(r.user_agent),
});

export class BrowserSessionStore {
  constructor(private readonly db: Db) {}

  async insert(s: Omit<BrowserSessionRecord, "revokedAt" | "revokedReason"> & { tokenHash: string }): Promise<void> {
    await this.db.query("INSERT INTO account_sessions (id, token_hash, account_id, epoch, created_at, last_seen_at, expires_at, user_agent) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", [
      s.id,
      s.tokenHash,
      s.accountId,
      s.epoch,
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

  async open(accountId: string): Promise<BrowserSessionRecord[]> {
    return (await this.db.query("SELECT * FROM account_sessions WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > $2 ORDER BY created_at DESC", [accountId, new Date().toISOString()])).map(sessionOf);
  }

  // Seen now -- at most once a minute, so a page's requests do not each write.
  async touch(id: string, at: string): Promise<void> {
    await this.db.query("UPDATE account_sessions SET last_seen_at = $2 WHERE id = $1 AND revoked_at IS NULL AND last_seen_at < ($2::timestamptz - interval '1 minute')", [id, at]);
  }

  async revoke(id: string, at: string, reason: string): Promise<boolean> {
    return (await this.db.run("UPDATE account_sessions SET revoked_at = $2, revoked_reason = $3 WHERE id = $1 AND revoked_at IS NULL", [id, at, reason])) > 0;
  }

  // Ends every open session of an account (or of every account but `except`); their ids.
  async revokeAccount(accountId: string, at: string, reason: string): Promise<string[]> {
    return (await this.db.query("UPDATE account_sessions SET revoked_at = $2, revoked_reason = $3 WHERE account_id = $1 AND revoked_at IS NULL RETURNING id", [accountId, at, reason])).map((r) => str(r.id));
  }

  async revokeOthers(accountId: string, at: string, reason: string): Promise<{ id: string; accountId: string }[]> {
    return (await this.db.query("UPDATE account_sessions SET revoked_at = $2, revoked_reason = $3 WHERE account_id <> $1 AND revoked_at IS NULL RETURNING id, account_id", [accountId, at, reason])).map((r) => ({ id: str(r.id), accountId: str(r.account_id) }));
  }

  async revokeAll(at: string, reason: string): Promise<{ id: string; accountId: string }[]> {
    return (await this.db.query("UPDATE account_sessions SET revoked_at = $1, revoked_reason = $2 WHERE revoked_at IS NULL RETURNING id, account_id", [at, reason])).map((r) => ({ id: str(r.id), accountId: str(r.account_id) }));
  }
}

// ---- settings ------------------------------------------------------------------------------------------------------

// What an account set for itself (its preferences, its privileged switches, its connector choices).
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
