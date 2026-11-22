// WHAT AN EMPLOYEE MAY USE OF THE ACCOUNT'S CONNECTORS, as a person sees and changes it. A change is a signed-in
// person's of that account, the policy's to allow (`connection.manage`), and recorded; a repository is granted only as
// the connector lists it now (one it does not list is refused, as opening a chat on it is).
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ACCESS_CONNECTOR_LABELS, ACCESS_CONNECTORS, checkUpdateEmployeeAccess, type AccessConnector, type EmployeeAccess, type GrantedRepository } from "@orbit-web/contracts";
import { accepted, ApiError } from "../../common/errors.js";
import type { Actor } from "../../contexts/shared/application/commands.js";
import { Db } from "../../infra/db/db.js";
import { AuditService } from "../governance/audit.service.js";
import { PolicyService } from "../governance/policy.service.js";
import { SourcesService } from "../sources/sources.module.js";
import { ConnectionGrantStore } from "./grants.store.js";

@Injectable()
export class EmployeeAccessService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ConnectionGrantStore) private readonly grants: ConnectionGrantStore,
    @Inject(SourcesService) private readonly sources: SourcesService,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async view(accountId: string, employeeId: string): Promise<EmployeeAccess> {
    await this.nameOf(accountId, employeeId);
    const live = await this.grants.live(accountId, employeeId);
    return {
      employeeId,
      connectors: ACCESS_CONNECTORS.map((connector) => {
        const g = live.get(connector);
        return { connector, enabled: g !== undefined, repositories: g?.repositories ?? null, grantedAt: g?.grantedAt ?? null };
      }),
    };
  }

  async update(actor: Actor, employeeId: string, body: unknown): Promise<EmployeeAccess> {
    const asked = accepted(checkUpdateEmployeeAccess(body));
    const accountId = actor.command.orbitId;
    const name = await this.nameOf(accountId, employeeId);
    for (const c of asked.connectors) {
      const label = ACCESS_CONNECTOR_LABELS[c.connector];
      const decision = await this.policy.decide(actor.governance, { action: "connection.manage", resource: `employee:${employeeId}:${c.connector}`, scope: "ACCOUNT", params: { connection: c.connector } });
      if (decision.verdict !== "allow") throw new ApiError(HttpStatus.FORBIDDEN, "policy_denied", `The account's policy in effect does not let a person change what ${name} may use of ${label} (${decision.reasonCodes.join(", ") || decision.verdict}).`);
      const repositories = c.enabled ? (c.repositories === null ? null : await this.listed(c.connector, c.repositories)) : undefined;
      await this.grants.replace(accountId, employeeId, c.connector, repositories, actor.command.actor);
      await this.audit.record(actor.governance, { type: "settings.privileged.changed", outcome: c.enabled ? "authorized" : "narrowed", data: { setting: `employee_access.${c.connector}`, value: repositories === undefined ? "off" : repositories === null ? "every repository" : `${repositories.length} repositories`, employeeId } });
    }
    return this.view(accountId, employeeId);
  }

  // Each repository chosen, as the connector lists it now.
  private async listed(connector: AccessConnector, ids: string[]): Promise<GrantedRepository[]> {
    const out: GrantedRepository[] = [];
    for (const id of [...new Set(ids)]) {
      const r = await this.sources.authorized(connector, id);
      out.push({ id: r.id, fullName: r.fullName, owner: r.owner, project: r.project, name: r.name });
    }
    return out;
  }

  private async nameOf(accountId: string, employeeId: string): Promise<string> {
    const row = /^[0-9a-f-]{36}$/i.test(employeeId) ? await this.db.one("SELECT name FROM workforce.employees WHERE account_id = $1 AND id = $2", [accountId, employeeId]) : null;
    if (row === null) throw new ApiError(HttpStatus.NOT_FOUND, "not_found", "No such employee.");
    return String(row.name);
  }
}
