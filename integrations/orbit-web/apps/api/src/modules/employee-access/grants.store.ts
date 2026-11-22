// AN EMPLOYEE'S GRANTS OF THE ACCOUNT'S CONNECTORS, in workforce.connection_grants: one live row per employee and
// operation ("github.read", "azure.read"), its scope the repositories granted (or every one). A change revokes the live
// row and writes the next one -- the history stays -- and turning a connector off revokes it.
import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ACCESS_CONNECTORS, type AccessConnector, type GrantedRepository } from "@orbit-web/contracts";
import { Db, jsonParam } from "../../infra/db/db.js";

export interface LiveGrant {
  // null: every repository the connector's sign-in reaches.
  repositories: GrantedRepository[] | null;
  grantedAt: string;
}

const operationOf = (c: AccessConnector): string => `${c}.read`;
const connectorOf = (operation: unknown): AccessConnector | null => ACCESS_CONNECTORS.find((c) => operationOf(c) === operation) ?? null;
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

@Injectable()
export class ConnectionGrantStore {
  constructor(@Inject(Db) private readonly db: Db) {}

  async live(accountId: string, employeeId: string): Promise<Map<AccessConnector, LiveGrant>> {
    const rows = await this.db.query(
      `SELECT operation, scope, created_at FROM workforce.connection_grants
        WHERE account_id = $1 AND grantee_kind = 'employee' AND grantee_id = $2 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`,
      [accountId, employeeId],
    );
    const out = new Map<AccessConnector, LiveGrant>();
    for (const r of rows) {
      const connector = connectorOf(r.operation);
      if (connector === null) continue;
      const scope = (typeof r.scope === "string" ? JSON.parse(r.scope) : r.scope) as { repositories?: GrantedRepository[] | null };
      out.set(connector, { repositories: Array.isArray(scope.repositories) ? scope.repositories : null, grantedAt: iso(r.created_at) });
    }
    return out;
  }

  // `repositories` undefined: the connector is turned off for the employee.
  async replace(accountId: string, employeeId: string, connector: AccessConnector, repositories: GrantedRepository[] | null | undefined, by: string): Promise<void> {
    await this.db.tx(async () => {
      await this.db.query(
        `UPDATE workforce.connection_grants SET revoked_at = now(), version = version + 1
          WHERE account_id = $1 AND grantee_kind = 'employee' AND grantee_id = $2 AND operation = $3 AND revoked_at IS NULL`,
        [accountId, employeeId, operationOf(connector)],
      );
      if (repositories === undefined) return;
      await this.db.query(
        `INSERT INTO workforce.connection_grants (id, account_id, grantee_kind, grantee_id, operation, scope, created_by, created_at)
         VALUES ($1, $2, 'employee', $3, $4, $5::jsonb, $6, now())`,
        [randomUUID(), accountId, employeeId, operationOf(connector), jsonParam({ repositories }), by],
      );
    });
  }
}
