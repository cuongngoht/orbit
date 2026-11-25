// THE ACCOUNT'S MCP SERVERS: what a person of the account added (a name, a URL, how Orbit Web signs in), the tools Orbit
// Web last read from each and which of them employees may use. Kept in the account's settings (`mcp_servers`); a server's
// credential is kept in the credential store, never in a setting, never said back by a route, never logged, and read only
// by whoever asks that server, at that moment. A change is a signed-in person's of the account, the policy's to allow
// (`connection.manage`), and recorded. A server whose first read fails is kept, saying why, so its sign-in can be put
// right; a tool is allowed when it is first read only if the server marks it read-only, and a tool the server adds later
// only once a person checks it.
import { createHash, randomUUID } from "node:crypto";
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { CREDENTIAL_IN_CLEAR, MAX_MCP_SERVERS, checkAddMcpServer, checkUpdateMcpServer, type McpAuthInput, type McpAuthKind, type McpServerList, type McpServerView } from "@orbit-web/contracts";
import { accepted, ApiError, badRequest } from "../../common/errors.js";
import type { Actor } from "../../contexts/shared/application/commands.js";
import { AccountSettingsStore } from "../../infra/accounts/stores.js";
import { CredentialStore } from "../../infra/connections/credentials.js";
import { AuditService } from "../governance/audit.service.js";
import { PolicyService } from "../governance/policy.service.js";
import { callMcpTool, listMcpTools, MCP_ADDRESS_POLICY, McpError, type McpAddressPolicy, type McpCallResult, type McpTarget, type McpToolInfo } from "./mcp-client.js";

export const MCP_SERVERS_KEY = "mcp_servers";
const READ = { timeoutMs: 20_000, maxBytes: 2 * 1024 * 1024 };
const CALL = { timeoutMs: 60_000, maxBytes: 1024 * 1024 };
// What an employee's tool name may be: Claude Code and Codex put `mcp__orbit_tools__` before it, and a model's tool
// name is at most 64 characters.
const MAX_EMPLOYEE_NAME = 46;

export interface StoredServer {
  id: string;
  name: string;
  // The server's word in its tools' names (kb_<slug>_<tool>): unique in the account.
  slug: string;
  url: string;
  auth: { kind: McpAuthKind; header: string | null; ref: string | null };
  tools: McpToolInfo[];
  allowed: string[];
  readAt: string | null;
  readError: string | null;
  createdAt: string;
  createdBy: string;
}

// The name an employee calls a server's tool by: kb_<slug>_<tool>, in the letters a model's tool name takes, cut (with
// a digest of the whole, so two long names stay two) to fit.
export function employeeToolName(slug: string, tool: string): string {
  const name = `kb_${slug}_${tool.replace(/[^A-Za-z0-9_-]/g, "_")}`;
  if (name.length <= MAX_EMPLOYEE_NAME) return name;
  const digest = createHash("sha256").update(tool).digest("hex").slice(0, 6);
  return `${name.slice(0, MAX_EMPLOYEE_NAME - 7)}_${digest}`;
}

const slugOf = (name: string, taken: ReadonlySet<string>): string => {
  const base = name.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "kb";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
};

const viewOf = (s: StoredServer): McpServerView => ({
  id: s.id,
  name: s.name,
  url: s.url,
  auth: { kind: s.auth.kind, header: s.auth.kind === "header" ? s.auth.header : null, hasToken: s.auth.ref !== null },
  tools: s.tools.map((t) => ({ name: t.name, description: t.description, readOnly: t.readOnly, allowed: s.allowed.includes(t.name), employeeName: employeeToolName(s.slug, t.name) })),
  readAt: s.readAt,
  readError: s.readError,
  createdAt: s.createdAt,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

@Injectable()
export class McpRegistry {
  // One change at a time per account (read, change, write).
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(AccountSettingsStore) private readonly settings: AccountSettingsStore,
    @Inject(CredentialStore) private readonly credentials: CredentialStore,
    @Inject(MCP_ADDRESS_POLICY) private readonly addresses: McpAddressPolicy,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async servers(accountId: string): Promise<StoredServer[]> {
    const stored = await this.settings.get<{ servers?: StoredServer[] }>(accountId, MCP_SERVERS_KEY);
    return Array.isArray(stored?.servers) ? stored.servers : [];
  }

  async list(accountId: string): Promise<McpServerList> {
    return { servers: (await this.servers(accountId)).map(viewOf) };
  }

  async add(actor: Actor, body: unknown): Promise<McpServerView> {
    const asked = accepted(checkAddMcpServer(body));
    const accountId = actor.command.orbitId;
    return this.changing(accountId, async (servers) => {
      if (servers.length >= MAX_MCP_SERVERS) throw badRequest(`An account keeps at most ${MAX_MCP_SERVERS} MCP servers.`);
      const slug = slugOf(asked.name, new Set(servers.map((s) => s.slug)));
      await this.allowed(actor, slug, "add");
      const id = randomUUID();
      const server: StoredServer = { id, name: asked.name, slug, url: asked.url, auth: this.keep(accountId, id, asked.auth, null), tools: [], allowed: [], readAt: null, readError: null, createdAt: new Date().toISOString(), createdBy: actor.command.actor };
      await this.read(server, true);
      await this.audit.record(actor.governance, { type: "settings.privileged.changed", outcome: "authorized", data: { setting: `mcp_server.${slug}`, value: "added" } });
      return { servers: [...servers, server], result: viewOf(server) };
    });
  }

  async update(actor: Actor, id: string, body: unknown): Promise<McpServerView> {
    const asked = accepted(checkUpdateMcpServer(body));
    const accountId = actor.command.orbitId;
    return this.changing(accountId, async (servers) => {
      const server = this.found(servers, id);
      await this.allowed(actor, server.slug, "change");
      if (asked.name !== undefined) server.name = asked.name;
      if (asked.allowedTools !== undefined) {
        const unknown = asked.allowedTools.filter((t) => !server.tools.some((x) => x.name === t));
        if (unknown.length > 0) throw badRequest(`Not a tool of ${server.name}: ${unknown.join(", ")}.`);
        server.allowed = asked.allowedTools;
      }
      if (asked.auth !== undefined) {
        if (new URL(server.url).protocol === "http:" && asked.auth.kind !== "none") throw badRequest(`${CREDENTIAL_IN_CLEAR}.`);
        server.auth = this.keep(accountId, server.id, asked.auth, server.auth.ref);
        await this.read(server, server.readAt === null);
      }
      await this.audit.record(actor.governance, { type: "settings.privileged.changed", outcome: "authorized", data: { setting: `mcp_server.${server.slug}`, value: asked.auth !== undefined ? "sign-in changed" : asked.allowedTools !== undefined ? `tools: ${server.allowed.join(", ") || "none"}` : "renamed" } });
      return { servers, result: viewOf(server) };
    });
  }

  // Its tools, read again: what was allowed stays allowed while the server still has it.
  async refresh(actor: Actor, id: string): Promise<McpServerView> {
    const accountId = actor.command.orbitId;
    return this.changing(accountId, async (servers) => {
      const server = this.found(servers, id);
      await this.allowed(actor, server.slug, "read again");
      await this.read(server, server.readAt === null);
      return { servers, result: viewOf(server) };
    });
  }

  async remove(actor: Actor, id: string): Promise<McpServerList> {
    const accountId = actor.command.orbitId;
    return this.changing(accountId, async (servers) => {
      const server = this.found(servers, id);
      await this.allowed(actor, server.slug, "remove");
      this.credentials.remove(server.auth.ref);
      await this.audit.record(actor.governance, { type: "settings.privileged.changed", outcome: "narrowed", data: { setting: `mcp_server.${server.slug}`, value: "removed" } });
      const left = servers.filter((s) => s.id !== server.id);
      return { servers: left, result: { servers: left.map(viewOf) } };
    });
  }

  // How Orbit Web reaches a server: its URL, and its credential as it is sent, read now.
  targetOf(server: StoredServer): McpTarget {
    const token = this.credentials.read(server.auth.ref);
    if (server.auth.kind === "none" || token === null) return { url: server.url, credential: null };
    return { url: server.url, credential: server.auth.kind === "bearer" ? { header: "Authorization", value: `Bearer ${token}` } : { header: server.auth.header ?? "Authorization", value: token } };
  }

  async call(server: StoredServer, tool: string, args: Record<string, unknown>): Promise<McpCallResult> {
    return callMcpTool(this.targetOf(server), tool, args, { policy: this.addresses, ...CALL });
  }

  private found(servers: StoredServer[], id: string): StoredServer {
    const server = UUID.test(id) ? servers.find((s) => s.id === id) : undefined;
    if (server === undefined) throw new ApiError(HttpStatus.NOT_FOUND, "not_found", "No such MCP server.");
    return server;
  }

  private async allowed(actor: Actor, slug: string, what: string): Promise<void> {
    const decision = await this.policy.decide(actor.governance, { action: "connection.manage", resource: `mcp-server:${slug}`, scope: "ACCOUNT", params: { connection: "mcp" } });
    if (decision.verdict !== "allow") throw new ApiError(HttpStatus.FORBIDDEN, "policy_denied", `The account's policy in effect does not let a person ${what} an MCP server (${decision.reasonCodes.join(", ") || decision.verdict}).`);
  }

  // The credential a sign-in names, kept in the credential store (the one it replaces removed); null: none.
  private keep(accountId: string, id: string, auth: McpAuthInput, previous: string | null): StoredServer["auth"] {
    this.credentials.remove(previous);
    if (auth.kind === "none" || auth.token === undefined) return { kind: "none", header: null, ref: null };
    const ref = this.credentials.refOf(accountId, id);
    this.credentials.write(ref, auth.token);
    return { kind: auth.kind, header: auth.kind === "header" ? (auth.header ?? null) : null, ref };
  }

  // Its tools, as the server says them now. First read: the read-only ones allowed. Later: what was allowed, while it
  // still is a tool. A failure keeps what was read before, and says why.
  private async read(server: StoredServer, first: boolean): Promise<void> {
    try {
      const tools = await listMcpTools(this.targetOf(server), { policy: this.addresses, ...READ });
      server.allowed = first ? tools.filter((t) => t.readOnly === true).map((t) => t.name) : server.allowed.filter((a) => tools.some((t) => t.name === a));
      server.tools = tools;
      server.readAt = new Date().toISOString();
      server.readError = null;
    } catch (err) {
      if (!(err instanceof McpError)) throw err;
      server.readError = err.message;
    }
  }

  private async changing<T>(accountId: string, work: (servers: StoredServer[]) => Promise<{ servers: StoredServer[]; result: T }>): Promise<T> {
    const previous = this.chains.get(accountId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const { servers, result } = await work(await this.servers(accountId));
      await this.settings.set(accountId, MCP_SERVERS_KEY, { servers });
      return result;
    });
    this.chains.set(accountId, next);
    try {
      return await next;
    } finally {
      if (this.chains.get(accountId) === next) this.chains.delete(accountId);
    }
  }
}
