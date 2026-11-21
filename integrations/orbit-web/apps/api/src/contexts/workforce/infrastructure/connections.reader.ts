// What the Workforce context needs to know about the account's AI connections -- read, never written (the Connections
// context owns them): whether one is connected with a model catalog its CLI gave, what that catalog and the capabilities
// say, and whether the owner granted the Orbit plugin for employees. A port: the hire and dispatch checks ask it, so a
// connection disconnected later makes its employees not ready and their work wait.
import { Inject, Injectable } from "@nestjs/common";
import type { AuthMethod, AuthState, ConnectionCatalog, RuntimeCapabilities, RuntimeKind } from "@orbit-web/contracts";
import { Db, type Row } from "../../../infra/db/db.js";

export interface ConnectionFacts {
  id: string;
  runtime: RuntimeKind;
  label: string;
  method: AuthMethod;
  auth: AuthState;
  reason: string | null;
  isDefault: boolean;
  catalog: ConnectionCatalog;
  capabilities: RuntimeCapabilities;
  home: string;
  credentialRef: string | null;
}

const factsOf = (r: Row): ConnectionFacts => ({
  id: String(r.id),
  runtime: String(r.runtime) as RuntimeKind,
  label: String(r.label),
  method: String(r.method) as AuthMethod,
  auth: String(r.auth_state) as AuthState,
  reason: r.reason === null ? null : String(r.reason),
  isDefault: r.is_default === true,
  catalog: r.catalog as ConnectionCatalog,
  capabilities: r.capabilities as RuntimeCapabilities,
  home: String(r.home),
  credentialRef: r.credential_ref === null ? null : String(r.credential_ref),
});

// A connection an employee can be hired on and run with: connected, with a catalog its own CLI gave for it.
export const usable = (c: ConnectionFacts | null): boolean => c !== null && c.auth === "connected" && c.catalog.source === "account" && c.catalog.models.length > 0;

@Injectable()
export class ConnectionsReader {
  constructor(@Inject(Db) private readonly db: Db) {}

  async get(orbitId: string, id: string): Promise<ConnectionFacts | null> {
    const row = await this.db.one("SELECT * FROM app.ai_connections WHERE account_id = $1 AND id = $2 AND removed_at IS NULL", [orbitId, id]);
    return row === null ? null : factsOf(row);
  }

  async defaultFor(orbitId: string, runtime: RuntimeKind): Promise<ConnectionFacts | null> {
    const row = await this.db.one("SELECT * FROM app.ai_connections WHERE account_id = $1 AND runtime = $2 AND removed_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1", [orbitId, runtime]);
    return row === null ? null : factsOf(row);
  }

  async all(orbitId: string): Promise<ConnectionFacts[]> {
    return (await this.db.query("SELECT * FROM app.ai_connections WHERE account_id = $1 AND removed_at IS NULL ORDER BY runtime, is_default DESC, created_at", [orbitId])).map(factsOf);
  }

  async canHire(orbitId: string): Promise<boolean> {
    return (await this.all(orbitId)).some(usable);
  }

  async pluginApproved(orbitId: string, connectionId: string): Promise<boolean> {
    const row = await this.db.one("SELECT approved FROM app.plugin_grants WHERE account_id = $1 AND connection_id = $2 AND use_case = 'employee'", [orbitId, connectionId]);
    return row?.approved === true;
  }
}
