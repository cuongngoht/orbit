// WHAT AN EMPLOYEE MAY USE OF THE ACCOUNT'S CONNECTORS AND MCP SERVERS, as a person sees and changes it. A change is a
// signed-in person's of that account, the policy's to allow (`connection.manage`), and recorded; a repository is granted
// only as the connector lists it now (one it does not list is refused, as opening a chat on it is), and an MCP server only
// while the account has it.
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { ACCESS_CONNECTOR_LABELS, ACCESS_CONNECTORS, checkUpdateEmployeeAccess, type AccessConnector, type EmployeeAccess, type GrantedRepository } from "@orbit-web/contracts";
import { accepted, ApiError } from "../../common/errors.js";
import type { Actor } from "../../contexts/shared/application/commands.js";
import { Db } from "../../infra/db/db.js";
import { AuditService } from "../governance/audit.service.js";
import { PolicyService } from "../governance/policy.service.js";
import { McpRegistry } from "../mcp-servers/mcp-registry.js";
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
    @Inject(McpRegistry) private readonly registry: McpRegistry,
  ) {}

  async view(accountId: string, employeeId: string): Promise<EmployeeAccess> {
    await this.nameOf(accountId, employeeId);
    const [live, knowledge, servers] = await Promise.all([this.grants.live(accountId, employeeId), this.grants.liveKnowledge(accountId, employeeId), this.registry.servers(accountId)]);
    return {
      employeeId,
      connectors: ACCESS_CONNECTORS.map((connector) => {
        const g = live.get(connector);
        return { connector, enabled: g !== undefined, repositories: g?.repositories ?? null, write: g?.write ?? false, grantedAt: g?.grantedAt ?? null };
      }),
      knowledge: servers.map((s) => ({ serverId: s.id, name: s.name, enabled: knowledge.has(s.id), grantedAt: knowledge.get(s.id) ?? null, tools: s.allowed.length })),
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
      await this.grants.replace(accountId, employeeId, c.connector, repositories, actor.command.actor, c.enabled && c.write === true);
      await this.audit.record(actor.governance, { type: "settings.privileged.changed", outcome: c.enabled ? "authorized" : "narrowed", data: { setting: `employee_access.${c.connector}`, value: `${repositories === undefined ? "off" : repositories === null ? "every repository" : `${repositories.length} repositories`}${repositories !== undefined && c.write === true ? ", may write" : ""}`, employeeId } });
    }
    if (asked.knowledge.length > 0) {
      const servers = await this.registry.servers(accountId);
      for (const k of asked.knowledge) {
        const server = servers.find((s) => s.id === k.serverId);
        if (server === undefined) throw new ApiError(HttpStatus.NOT_FOUND, "not_found", "No such MCP server in this account.");
        const decision = await this.policy.decide(actor.governance, { action: "connection.manage", resource: `employee:${employeeId}:mcp:${server.slug}`, scope: "ACCOUNT", params: { connection: "mcp" } });
        if (decision.verdict !== "allow") throw new ApiError(HttpStatus.FORBIDDEN, "policy_denied", `The account's policy in effect does not let a person change what ${name} may use of "${server.name}" (${decision.reasonCodes.join(", ") || decision.verdict}).`);
        await this.grants.replaceKnowledge(accountId, employeeId, server.id, k.enabled, actor.command.actor);
        await this.audit.record(actor.governance, { type: "settings.privileged.changed", outcome: k.enabled ? "authorized" : "narrowed", data: { setting: `employee_access.mcp.${server.slug}`, value: k.enabled ? "on" : "off", employeeId } });
      }
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
