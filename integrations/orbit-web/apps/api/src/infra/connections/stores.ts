// AI CONNECTIONS, as stored: what an account connected of Claude Code, Codex and Antigravity (one row per connection,
// each with a config home of its own), what is installed on this server (the system account's), and the account owner's
// consent to load the Orbit plugin per connection and use case. Nothing here is a credential: an API key is kept by the
// credential store (credentials.ts) and named here by reference.
import type { AuthMethod, AuthState, ConnectionCatalog, ConnectionReason, InstallationState, PluginUseCase, RuntimeCapabilities, RuntimeInstallation, RuntimeKind } from "@orbit-web/contracts";
import { SYSTEM_ACCOUNT_ID, type Versioned } from "../accounts/stores.js";
import { Db, jsonParam, type Row } from "../db/db.js";

const str = (v: unknown): string => String(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export interface CloudSettings {
  provider: "bedrock" | "vertex" | "foundry";
  region?: string;
  project?: string;
}

export interface ConnectionRecord {
  id: string;
  accountId: string;
  runtime: RuntimeKind;
  label: string;
  isDefault: boolean;
  method: AuthMethod;
  // The config home, relative to the connections room: `<accountId>/<connectionId>`.
  home: string;
  credentialRef: string | null;
  cloud: CloudSettings | null;
  authState: AuthState;
  reason: string | null;
  reasonCode: ConnectionReason | null;
  identity: string | null;
  // What tells two provider identities apart (never shown): one identity, one account.
  identityKey: string | null;
  catalog: ConnectionCatalog;
  capabilities: RuntimeCapabilities;
  checkedAt: string | null;
  pluginRevision: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// What a status check says, written as one.
export interface ConnectionStatus {
  authState: AuthState;
  reason: string | null;
  reasonCode: ConnectionReason | null;
  identity: string | null;
  identityKey: string | null;
  catalog: ConnectionCatalog;
  capabilities: RuntimeCapabilities;
  checkedAt: string;
}

const connectionOf = (r: Row): ConnectionRecord => ({
  id: str(r.id),
  accountId: str(r.account_id),
  runtime: str(r.runtime) as RuntimeKind,
  label: str(r.label),
  isDefault: r.is_default === true,
  method: str(r.method) as AuthMethod,
  home: str(r.home),
  credentialRef: strOrNull(r.credential_ref),
  cloud: (r.cloud ?? null) as CloudSettings | null,
  authState: str(r.auth_state) as AuthState,
  reason: strOrNull(r.reason),
  reasonCode: strOrNull(r.reason_code) as ConnectionReason | null,
  identity: strOrNull(r.identity),
  identityKey: strOrNull(r.identity_key),
  catalog: r.catalog as ConnectionCatalog,
  capabilities: r.capabilities as RuntimeCapabilities,
  checkedAt: strOrNull(r.checked_at),
  pluginRevision: Number(r.plugin_revision),
  createdBy: str(r.created_by),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
  version: Number(r.version),
});

const LIVE = "removed_at IS NULL";

export class ConnectionStore {
  constructor(private readonly db: Db) {}

  async list(accountId: string): Promise<ConnectionRecord[]> {
    return (await this.db.query(`SELECT * FROM ai_connections WHERE account_id = $1 AND ${LIVE} ORDER BY runtime, created_at, id`, [accountId])).map(connectionOf);
  }

  // One of the account's connections (another account's is not found).
  async get(accountId: string, id: string): Promise<ConnectionRecord | null> {
    const row = await this.db.one(`SELECT * FROM ai_connections WHERE account_id = $1 AND id = $2 AND ${LIVE}`, [accountId, id]);
    return row === null ? null : connectionOf(row);
  }

  // A connection by its id alone: for the installation's own terminal (cli/connect.ts), which serves whoever runs it.
  async byId(id: string): Promise<ConnectionRecord | null> {
    const row = await this.db.one(`SELECT * FROM ai_connections WHERE id = $1 AND ${LIVE}`, [id]);
    return row === null ? null : connectionOf(row);
  }

  async defaultOf(accountId: string, runtime: RuntimeKind): Promise<ConnectionRecord | null> {
    const row = await this.db.one(`SELECT * FROM ai_connections WHERE account_id = $1 AND runtime = $2 AND is_default AND ${LIVE}`, [accountId, runtime]);
    return row === null ? null : connectionOf(row);
  }

  async insert(c: Omit<ConnectionRecord, "pluginRevision" | "updatedAt" | "version" | "checkedAt">): Promise<void> {
    await this.db.query(
      "INSERT INTO ai_connections (id, account_id, runtime, label, is_default, method, home, credential_ref, cloud, auth_state, reason, reason_code, identity, identity_key, catalog, capabilities, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17, $18, $18)",
      [c.id, c.accountId, c.runtime, c.label, c.isDefault, c.method, c.home, c.credentialRef, c.cloud === null ? null : jsonParam(c.cloud), c.authState, c.reason, c.reasonCode, c.identity, c.identityKey, jsonParam(c.catalog), jsonParam(c.capabilities), c.createdBy, c.createdAt],
    );
  }

  // The label, when the connection is still at `expectedVersion`.
  async relabel(accountId: string, id: string, expectedVersion: number, label: string, at: string): Promise<Versioned<ConnectionRecord>> {
    const row = await this.db.one(`UPDATE ai_connections SET label = $4, updated_at = $5, version = version + 1 WHERE account_id = $1 AND id = $2 AND version = $3 AND ${LIVE} RETURNING *`, [accountId, id, expectedVersion, label, at]);
    if (row !== null) return connectionOf(row);
    return (await this.get(accountId, id)) === null ? null : "stale";
  }

  // This connection becomes the account's default of its runtime (the one before stops being it), in one transaction.
  async makeDefault(accountId: string, id: string, at: string): Promise<void> {
    await this.db.tx(async () => {
      const c = await this.db.one(`SELECT runtime FROM ai_connections WHERE account_id = $1 AND id = $2 AND ${LIVE} FOR UPDATE`, [accountId, id]);
      if (c === null) return;
      await this.db.query(`UPDATE ai_connections SET is_default = false, updated_at = $3, version = version + 1 WHERE account_id = $1 AND runtime = $2 AND is_default AND ${LIVE}`, [accountId, str(c.runtime), at]);
      await this.db.query("UPDATE ai_connections SET is_default = true, updated_at = $3, version = version + 1 WHERE account_id = $1 AND id = $2", [accountId, id, at]);
    });
  }

  async setCredential(accountId: string, id: string, ref: string | null, at: string): Promise<void> {
    await this.db.query("UPDATE ai_connections SET credential_ref = $3, updated_at = $4, version = version + 1 WHERE account_id = $1 AND id = $2", [accountId, id, ref, at]);
  }

  // What a status check says. The identity it names may be held by ONE live connection at a time (the partial unique
  // index `one_account_per_identity`): a second holder makes this throw a unique violation, nothing written.
  async setStatus(accountId: string, id: string, s: ConnectionStatus): Promise<ConnectionRecord | null> {
    const row = await this.db.one(
      `UPDATE ai_connections SET auth_state = $3, reason = $4, reason_code = $10, identity = $5, identity_key = $6, catalog = $7::jsonb, capabilities = $8::jsonb, checked_at = $9, updated_at = $9, version = version + 1 WHERE account_id = $1 AND id = $2 AND ${LIVE} RETURNING *`,
      [accountId, id, s.authState, s.reason, s.identity, s.identityKey, jsonParam(s.catalog), jsonParam(s.capabilities), s.checkedAt, s.reasonCode],
    );
    return row === null ? null : connectionOf(row);
  }

  // The live connection that holds an identity now, if any.
  async holderOf(runtime: RuntimeKind, identityKey: string): Promise<{ accountId: string; id: string } | null> {
    const row = await this.db.one(`SELECT account_id, id FROM ai_connections WHERE runtime = $1 AND identity_key = $2 AND ${LIVE}`, [runtime, identityKey]);
    return row === null ? null : { accountId: str(row.account_id), id: str(row.id) };
  }

  // Removed: kept as a row (what referred to it keeps its target), holding no identity and no default any more.
  async remove(accountId: string, id: string, at: string): Promise<void> {
    await this.db.query(`UPDATE ai_connections SET removed_at = $3, is_default = false, identity_key = NULL, credential_ref = NULL, auth_state = 'disconnected', reason_code = NULL, updated_at = $3, version = version + 1 WHERE account_id = $1 AND id = $2 AND ${LIVE}`, [accountId, id, at]);
  }

  async pluginsChanged(accountId: string, id: string, at: string): Promise<void> {
    await this.db.query("UPDATE ai_connections SET plugin_revision = plugin_revision + 1, updated_at = $3, version = version + 1 WHERE account_id = $1 AND id = $2", [accountId, id, at]);
  }

  // How many of the account's employees (not archived) run on a connection.
  async employeesOn(accountId: string, id: string): Promise<number> {
    return Number((await this.db.one("SELECT count(*) AS n FROM workforce.employees WHERE account_id = $1 AND connection_id = $2 AND employment NOT IN ('archived', 'deleted')", [accountId, id]))?.n ?? 0);
  }
}

// ---- what is installed (the deployment's) ------------------------------------------------------------------------------

export class InstallationStore {
  constructor(private readonly db: Db) {}

  async all(): Promise<RuntimeInstallation[]> {
    return (await this.db.query("SELECT * FROM runtime_installations WHERE account_id = $1 ORDER BY runtime", [SYSTEM_ACCOUNT_ID])).map((r) => ({
      runtime: str(r.runtime) as RuntimeKind,
      state: str(r.state) as InstallationState,
      version: strOrNull(r.version),
      detail: strOrNull(r.detail),
      checkedAt: strOrNull(r.checked_at),
    }));
  }

  async set(i: RuntimeInstallation & { checkedAt: string }): Promise<void> {
    await this.db.query(
      "INSERT INTO runtime_installations (account_id, runtime, state, version, detail, checked_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (account_id, runtime) DO UPDATE SET state = excluded.state, version = excluded.version, detail = excluded.detail, checked_at = excluded.checked_at",
      [SYSTEM_ACCOUNT_ID, i.runtime, i.state, i.version, i.detail, i.checkedAt],
    );
  }
}

// ---- the Orbit plugin's grants --------------------------------------------------------------------------------------------

export interface PluginGrantRecord {
  useCase: PluginUseCase;
  digest: string;
  approved: boolean;
  decidedBy: string;
  decidedAt: string;
}

export class PluginGrantStore {
  constructor(private readonly db: Db) {}

  async of(accountId: string, connectionId: string): Promise<PluginGrantRecord[]> {
    return (await this.db.query("SELECT * FROM plugin_grants WHERE account_id = $1 AND connection_id = $2 ORDER BY use_case", [accountId, connectionId])).map((r) => ({
      useCase: str(r.use_case) as PluginUseCase,
      digest: str(r.digest),
      approved: r.approved === true,
      decidedBy: str(r.decided_by),
      decidedAt: str(r.decided_at),
    }));
  }

  async set(accountId: string, connectionId: string, g: PluginGrantRecord): Promise<void> {
    await this.db.query(
      "INSERT INTO plugin_grants (account_id, connection_id, use_case, digest, approved, decided_by, decided_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (account_id, connection_id, use_case) DO UPDATE SET digest = excluded.digest, approved = excluded.approved, decided_by = excluded.decided_by, decided_at = excluded.decided_at",
      [accountId, connectionId, g.useCase, g.digest, g.approved, g.decidedBy, g.decidedAt],
    );
  }
}
