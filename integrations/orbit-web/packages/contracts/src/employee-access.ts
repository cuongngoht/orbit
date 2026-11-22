// WHAT AN EMPLOYEE MAY USE OF THE ACCOUNT'S CONNECTORS: the GitHub and Azure DevOps sign-ins of Settings → Connectors,
// used ON ITS BEHALF by Orbit Web -- the sign-in never enters its sandbox -- off until a person turns it on, and then for
// every repository that sign-in reaches, or only the ones chosen (an Azure DevOps project's work items and wiki with its
// chosen repositories' projects). The same for the account's MCP servers (Settings → MCP servers): each off until a
// person turns it on for the employee, and then its allowed tools.
import { MAX_MCP_SERVERS } from "./mcp-servers.js";
import type { Checked } from "./validate.js";

export const ACCESS_CONNECTORS = ["github", "azure"] as const;
export type AccessConnector = (typeof ACCESS_CONNECTORS)[number];
export const ACCESS_CONNECTOR_LABELS: Record<AccessConnector, string> = { github: "GitHub", azure: "Azure DevOps" };

// A repository as the connector listed it when it was granted (GET /api/repositories names it by `id`).
export interface GrantedRepository {
  id: string;
  fullName: string;
  // GitHub's owner, or the Azure DevOps organization.
  owner: string;
  // The Azure DevOps project; null on GitHub.
  project: string | null;
  name: string;
}

export interface ConnectorAccess {
  connector: AccessConnector;
  enabled: boolean;
  // null: every repository the connector's sign-in reaches; else only these.
  repositories: GrantedRepository[] | null;
  grantedAt: string | null;
}

// One of the account's MCP servers, for one employee.
export interface KnowledgeAccess {
  serverId: string;
  name: string;
  enabled: boolean;
  grantedAt: string | null;
  // How many of its tools the account allows.
  tools: number;
}

export interface EmployeeAccess {
  employeeId: string;
  connectors: ConnectorAccess[];
  knowledge: KnowledgeAccess[];
}

export interface UpdateConnectorAccess {
  connector: AccessConnector;
  enabled: boolean;
  // null: every repository; else the ids of the repositories chosen (as GET /api/repositories names them).
  repositories: string[] | null;
}

export interface UpdateKnowledgeAccess {
  serverId: string;
  enabled: boolean;
}

// What a change names: connectors, MCP servers, or both.
export interface UpdateEmployeeAccessRequest {
  connectors?: UpdateConnectorAccess[];
  knowledge?: UpdateKnowledgeAccess[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
// eslint-disable-next-line no-control-regex -- control characters are what is refused
const CONTROL = /[\u0000-\u001f\u007f]/;
export const MAX_GRANTED_REPOSITORIES = 200;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function knowledgeOf(list: unknown, errors: string[]): UpdateKnowledgeAccess[] {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MCP_SERVERS) {
    errors.push(`knowledge must name 1 to ${MAX_MCP_SERVERS} MCP servers`);
    return [];
  }
  const seen = new Set<string>();
  return list.map((k: unknown, i): UpdateKnowledgeAccess => {
    const at = `knowledge[${i}]`;
    if (!isRecord(k)) {
      errors.push(`${at} must be an object`);
      return { serverId: "", enabled: false };
    }
    for (const f of Object.keys(k)) if (!["serverId", "enabled"].includes(f)) errors.push(`${at}.${f} is not a field of an MCP server's access`);
    const serverId = typeof k.serverId === "string" && UUID.test(k.serverId) ? k.serverId : "";
    if (serverId === "") errors.push(`${at}.serverId must be an MCP server's id`);
    else if (seen.has(serverId)) errors.push(`${at}.serverId ${serverId} is named twice`);
    else seen.add(serverId);
    if (typeof k.enabled !== "boolean") errors.push(`${at}.enabled must be true or false`);
    return { serverId, enabled: k.enabled === true };
  });
}

export function checkUpdateEmployeeAccess(body: unknown): Checked<Required<UpdateEmployeeAccessRequest>> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = Object.keys(body).filter((k) => k !== "connectors" && k !== "knowledge").map((k) => `${k} is not a field of this request`);
  const knowledge = knowledgeOf(body.knowledge, errors);
  if (body.connectors === undefined && body.knowledge !== undefined) return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { connectors: [], knowledge } };
  const list = body.connectors;
  if (!Array.isArray(list) || list.length === 0 || list.length > ACCESS_CONNECTORS.length) return { ok: false, errors: [...errors, `connectors must name 1 to ${ACCESS_CONNECTORS.length} connectors`] };
  const seen = new Set<string>();
  const connectors = list.map((c: unknown, i): UpdateConnectorAccess => {
    const at = `connectors[${i}]`;
    if (!isRecord(c)) {
      errors.push(`${at} must be an object`);
      return { connector: "github", enabled: false, repositories: null };
    }
    for (const k of Object.keys(c)) if (!["connector", "enabled", "repositories"].includes(k)) errors.push(`${at}.${k} is not a field of a connector's access`);
    const connector = (ACCESS_CONNECTORS as readonly unknown[]).includes(c.connector) ? (c.connector as AccessConnector) : null;
    if (connector === null) errors.push(`${at}.connector must be one of ${ACCESS_CONNECTORS.join(", ")}`);
    else if (seen.has(connector)) errors.push(`${at}.connector ${connector} is named twice`);
    else seen.add(connector);
    if (typeof c.enabled !== "boolean") errors.push(`${at}.enabled must be true or false`);
    const repos = c.repositories;
    const okRepos = repos === null || (Array.isArray(repos) && repos.length <= MAX_GRANTED_REPOSITORIES && repos.every((r) => typeof r === "string" && r.length > 0 && r.length <= 300 && !CONTROL.test(r)));
    if (!okRepos) errors.push(`${at}.repositories must be null (every repository) or a list of at most ${MAX_GRANTED_REPOSITORIES} repository ids`);
    return { connector: connector ?? "github", enabled: c.enabled === true, repositories: okRepos ? (repos as string[] | null) : null };
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { connectors, knowledge } };
}
