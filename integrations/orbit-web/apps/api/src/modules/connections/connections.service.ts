// AI CONNECTIONS (the Connections context): what an account connected of Claude Code, OpenAI Codex and Google
// Antigravity -- each connection the ACCOUNT's, with a config home of its own on the server (where its CLI keeps its
// login, and nowhere else), never mounted into an employee's sandbox and never read for another account.
//
//   create       a connection of a method its provider permits (methods.ts; 400 method_not_supported otherwise -- but a
//                Claude Code cloud connection, saved and shown blocked); an API key goes to the credential store, never
//                into the database, a route's answer, a log or an event. A subscription is signed in by the CLI's own
//                sign-in: from its card (connection-sign-in.service.ts, ADR 0061), or by its owner in a terminal of the
//                server (`terminalCommand`).
//   check        the CLI asked now (probe.ts); `connected` only when its own status names the identity
//   disconnect   the CLI's own logout against that home, then the home's login removed (an API key forgotten); work in
//                progress is not this module's: it says so (connection-hooks.ts, the app stream) and the execution side
//                stops what it runs
//   remove       refused while an employee runs on it (409 connection_in_use); the home and the key go with it
//   plugins      the account owner's consent to load the Orbit plugin, per use case, for exactly the digest the page saw
//
// Every change is recorded in the account's audit record.
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import {
  checkCreateConnection,
  checkPluginGrant,
  checkUpdateConnection,
  CONNECTION_ERRORS,
  PLUGIN_USE_CASES,
  RUNTIME_LABELS,
  type AiConnectionsView,
  type AuthMethod,
  type ConnectionChange,
  type PluginGrantView,
  type PluginUseCase,
  type RuntimeConnection,
  type RuntimeKind,
} from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../config/config.js";
import { accountAudience, EventBus } from "../../core/events/event-bus.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { accepted, ApiError, notFound } from "../../common/errors.js";
import { CredentialStore } from "../../infra/connections/credentials.js";
import { emptyHome, ensureHome, homeOf, removeHome } from "../../infra/connections/homes.js";
import { ConnectionStore, PluginGrantStore, type ConnectionRecord } from "../../infra/connections/stores.js";
import { Db, pgCode, UNIQUE_VIOLATION } from "../../infra/db/db.js";
import type { ProcessPort } from "../../infra/process/process.port.js";
import { labelOf, type GovernanceContext, type Owner } from "../auth/principal.js";
import { stale, versionOf } from "../auth/identity.service.js";
import { AuditService } from "../governance/audit.service.js";
import { ClaudeConnectorsService } from "./claude-connectors.service.js";
import { ClaudeModelsService } from "./claude-models.service.js";
import { ConnectionHooks } from "./connection-hooks.js";
import { mayCreate, METHOD_SUPPORT, supportOf } from "./methods.js";
import { orbitPlugin } from "./plugin.js";
import { ConnectionProbe, noCatalog } from "./probe.js";
import { RUNTIME_SPECS } from "./runtimes.js";
import { signsInHere } from "./sign-in.js";
import { employeeReadiness } from "../../contexts/execution/infrastructure/employee-runtimes.js";

const METHOD_LABELS: Record<AuthMethod, string> = { subscription: "subscription", api_key: "API key", cloud: "cloud provider" };

// The one command a person runs in a terminal of the server to sign a subscription connection in: cli/connect.js in
// Orbit Web's own container, which runs the provider's own, unmodified sign-in in that person's terminal with that one
// connection's home, then asks the CLI whom it is signed in as. (In the governed deployment: `docker compose -f
// compose.governed.yaml exec …`, the same command.)
export const CONNECT_SCRIPT = "/opt/orbit-web/apps/api/dist/cli/connect.js";
export const terminalCommandOf = (connectionId: string): string => `docker compose exec orbit-web node ${CONNECT_SCRIPT} ${connectionId}`;

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger("Connections");

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(Db) private readonly db: Db,
    @Inject(ConnectionStore) private readonly connections: ConnectionStore,
    @Inject(PluginGrantStore) private readonly grants: PluginGrantStore,
    @Inject(CredentialStore) private readonly credentials: CredentialStore,
    @Inject(ConnectionProbe) private readonly probe: ConnectionProbe,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(ConnectionHooks) private readonly hooks: ConnectionHooks,
    @Inject(ClaudeModelsService) private readonly models: ClaudeModelsService,
    @Inject(ClaudeConnectorsService) private readonly connectors: ClaudeConnectorsService,
  ) {}

  // GET /api/connections: the account's connections, what is installed here, and which methods are offered.
  async view(owner: Owner): Promise<AiConnectionsView> {
    const installations = await this.probe.installations();
    const own = await this.connections.list(owner.accountId);
    const connections = await Promise.all(own.map((c) => this.viewOf(c)));
    return { installations, connections, methods: [...METHOD_SUPPORT], canHire: connections.some((c) => c.employeeReady.ready), asOf: new Date().toISOString() };
  }

  async one(owner: Owner, id: string): Promise<RuntimeConnection> {
    return this.viewOf(await this.own(owner, id));
  }

  async create(owner: Owner, ctx: GovernanceContext, body: unknown): Promise<RuntimeConnection> {
    const req = accepted(checkCreateConnection(body));
    if (!mayCreate(req.runtime, req.method)) {
      const support = supportOf(req.runtime, req.method);
      throw new ApiError(HttpStatus.BAD_REQUEST, CONNECTION_ERRORS.methodNotSupported, `${RUNTIME_LABELS[req.runtime]} with ${METHOD_LABELS[req.method]} is not offered (${support.state.replace("_", " ")}): ${support.note}`, { support });
    }
    const installation = await this.probe.installation(req.runtime);
    if (installation.state === "not_installed") throw new ApiError(HttpStatus.CONFLICT, CONNECTION_ERRORS.notInstalled, installation.detail ?? `${RUNTIME_LABELS[req.runtime]} is not installed on this server.`);
    const id = randomUUID();
    const home = homeOf(owner.accountId, id);
    const credentialRef = req.method === "api_key" ? this.credentials.refOf(owner.accountId, id) : null;
    if (credentialRef !== null) this.credentials.write(credentialRef, req.apiKey as string);
    const at = new Date().toISOString();
    const record: Omit<ConnectionRecord, "pluginRevision" | "updatedAt" | "version" | "checkedAt"> = {
      id,
      accountId: owner.accountId,
      runtime: req.runtime,
      label: req.label ?? `${RUNTIME_LABELS[req.runtime]} ${METHOD_LABELS[req.method]}${req.cloud ? ` (${req.cloud.provider})` : ""}`,
      isDefault: (await this.connections.defaultOf(owner.accountId, req.runtime)) === null,
      method: req.method,
      home,
      credentialRef,
      cloud: req.method === "cloud" ? (req.cloud ?? null) : null,
      authState: "disconnected",
      reason: null,
      reasonCode: null,
      identity: null,
      identityKey: null,
      catalog: noCatalog(null),
      capabilities: await this.probe.capabilities(installation),
      createdBy: labelOf(owner),
      createdAt: at,
    };
    try {
      await this.db.tx(async () => {
        await this.insert(record);
        await this.record(ctx, "created", record, `${record.runtime}:${record.method}:${id}`);
      });
    } catch (err) {
      this.credentials.remove(credentialRef);
      throw err;
    }
    ensureHome(this.config, home, req.runtime);
    const made = (await this.connections.get(owner.accountId, id)) as ConnectionRecord;
    if (req.runtime === "codex" && req.method === "api_key") await this.probe.codexKeyLogin(made, req.apiKey as string);
    const checked = await this.checked(made, "created");
    return this.viewOf(checked);
  }

  // PATCH: a label, becoming the default, or a new API key -- against the version the page read (If-Match).
  async update(owner: Owner, ctx: GovernanceContext, id: string, body: unknown, ifMatch: string | undefined): Promise<RuntimeConnection> {
    const req = accepted(checkUpdateConnection(body));
    const expected = versionOf(ifMatch);
    if (expected === null) throw new ApiError(HttpStatus.PRECONDITION_REQUIRED, "precondition_required", 'A change of a connection names the version the page read: If-Match: "<version>".');
    let c = await this.own(owner, id);
    if (c.version !== expected) throw stale("The connection");
    if (req.apiKey !== undefined && c.method !== "api_key") throw new ApiError(HttpStatus.BAD_REQUEST, "invalid_request", "Only an API-key connection takes an API key.");
    const at = new Date().toISOString();
    await this.db.tx(async () => {
      if (req.label !== undefined) {
        const relabelled = await this.connections.relabel(owner.accountId, id, expected, req.label, at);
        if (relabelled === "stale") throw stale("The connection");
      }
      if (req.isDefault === true) await this.connections.makeDefault(owner.accountId, id, at);
      if (req.apiKey !== undefined) await this.connections.setCredential(owner.accountId, id, this.credentials.refOf(owner.accountId, id), at);
      await this.record(ctx, "updated", c, Object.keys(req).join(","));
    });
    c = (await this.own(owner, id)) as ConnectionRecord;
    if (req.apiKey === undefined) {
      await this.announce(c, "updated");
      return this.viewOf(c);
    }
    // A new key: the login it makes is a new one (the identity linked before goes with the old key).
    this.credentials.write(c.credentialRef as string, req.apiKey);
    await this.connections.setStatus(owner.accountId, id, { authState: "disconnected", reason: null, reasonCode: null, identity: null, identityKey: null, catalog: noCatalog(at), capabilities: c.capabilities, checkedAt: at });
    c = (await this.own(owner, id)) as ConnectionRecord;
    if (c.runtime === "codex") await this.probe.codexKeyLogin(c, req.apiKey);
    return this.viewOf(await this.checked(c, "updated"));
  }

  // POST …/check: its CLI asked now.
  async check(owner: Owner, ctx: GovernanceContext, id: string): Promise<RuntimeConnection> {
    const c = await this.own(owner, id);
    const checked = await this.checked(c, "checked");
    if (checked.authState !== c.authState || checked.identity !== c.identity) await this.record(ctx, "checked", checked, `${checked.authState}${checked.reasonCode ? `:${checked.reasonCode}` : ""}`);
    return this.viewOf(checked);
  }

  // POST …/disconnect: the CLI's own logout against the connection's home, then the login left there removed -- and an
  // API key forgotten. Its employees' new work waits; what runs is the execution side's to stop (it hears it here).
  async disconnect(owner: Owner, ctx: GovernanceContext, id: string): Promise<RuntimeConnection> {
    const c = await this.own(owner, id);
    await this.logout(c);
    emptyHome(this.config, c.home, c.runtime);
    this.credentials.remove(c.credentialRef);
    const at = new Date().toISOString();
    const done = await this.db.tx(async () => {
      const after = await this.connections.setStatus(owner.accountId, id, { authState: "disconnected", reason: `Disconnected by ${owner.fullName} at ${at}.`, reasonCode: null, identity: null, identityKey: null, catalog: noCatalog(at), capabilities: c.capabilities, checkedAt: at });
      await this.record(ctx, "disconnected", c, id);
      return after ?? c;
    });
    this.connectors.forget(c.id);
    await this.announce(done, "disconnected");
    return this.viewOf(done);
  }

  // DELETE: refused while an employee runs on it. The home and the key go; the row stays, removed (what referred to it
  // keeps its target). The account's next connection of that runtime becomes its default.
  async remove(owner: Owner, ctx: GovernanceContext, id: string): Promise<void> {
    const c = await this.own(owner, id);
    const employees = await this.connections.employeesOn(owner.accountId, id);
    if (employees > 0) throw new ApiError(HttpStatus.CONFLICT, CONNECTION_ERRORS.connectionInUse, `${employees === 1 ? "An employee runs" : `${employees} employees run`} on this connection: move ${employees === 1 ? "it" : "them"} to another connection first.`);
    await this.logout(c);
    const at = new Date().toISOString();
    await this.db.tx(async () => {
      await this.connections.remove(owner.accountId, id, at);
      if (c.isDefault) {
        const next = (await this.connections.list(owner.accountId)).find((o) => o.runtime === c.runtime);
        if (next !== undefined) await this.connections.makeDefault(owner.accountId, next.id, at);
      }
      await this.record(ctx, "removed", c, id);
    });
    removeHome(this.config, c.home);
    this.credentials.remove(c.credentialRef);
    this.connectors.forget(c.id);
    await this.announce({ ...c, authState: "disconnected" }, "removed");
  }

  // PUT …/plugins/orbit: the owner's consent (or its withdrawal) to load the Orbit plugin for one use case, for exactly
  // the digest the page showed. Claude Code connections only.
  async setPlugin(owner: Owner, ctx: GovernanceContext, id: string, body: unknown): Promise<RuntimeConnection> {
    const req = accepted(checkPluginGrant(body));
    const c = await this.own(owner, id);
    if (c.runtime !== "claude") throw new ApiError(HttpStatus.CONFLICT, CONNECTION_ERRORS.pluginNotOffered, "The Orbit plugin is offered on Claude Code connections only.");
    const plugin = await orbitPlugin(this.config.pluginDir);
    if (!plugin.installed || plugin.digest !== req.digest) throw new ApiError(HttpStatus.CONFLICT, CONNECTION_ERRORS.pluginChanged, "The Orbit plugin here is not the one the page showed (it was upgraded, or it is not installed): read it again, then decide.");
    const at = new Date().toISOString();
    await this.db.tx(async () => {
      await this.grants.set(owner.accountId, id, { useCase: req.useCase, digest: req.digest, approved: req.approved, decidedBy: labelOf(owner), decidedAt: at });
      await this.connections.pluginsChanged(owner.accountId, id, at);
      await this.audit.record(ctx, { type: "settings.privileged.changed", outcome: req.approved ? "approved" : "withdrawn", data: { setting: `plugin.orbit.${req.useCase}`, value: req.approved ? `approved for ${req.digest.slice(0, 12)} on connection ${id}` : `not approved on connection ${id}` } });
    });
    const after = await this.own(owner, id);
    await this.announce(after, "plugins");
    return this.viewOf(after);
  }

  // A sign-in from the card started (connection-sign-in.service.ts): recorded, never its URL or code.
  async signInStarted(ctx: GovernanceContext, c: ConnectionRecord): Promise<void> {
    await this.record(ctx, "sign_in_started", c, c.id);
  }

  // A sign-in from the card ended with the CLI exiting 0: its CLI asked now (connected only when its own status names
  // the identity), what moved recorded and announced like any check.
  async signedIn(ctx: GovernanceContext, c: ConnectionRecord): Promise<ConnectionRecord> {
    const after = await this.checked(c, "checked");
    await this.record(ctx, "signed_in_from_page", after, `${c.id}:${after.authState}${after.reasonCode ? `:${after.reasonCode}` : ""}`);
    return after;
  }

  // A connection as the page shows it.
  async viewOf(c: ConnectionRecord): Promise<RuntimeConnection> {
    const spec = RUNTIME_SPECS[c.runtime];
    return {
      id: c.id,
      runtime: c.runtime,
      label: c.label,
      isDefault: c.isDefault,
      method: c.method,
      auth: c.authState,
      reason: c.reason,
      reasonCode: c.reasonCode,
      identity: c.identity,
      checkedAt: c.checkedAt,
      catalog: c.catalog,
      capabilities: c.capabilities,
      terminalCommand: c.method === "subscription" && spec.login !== null ? terminalCommandOf(c.id) : null,
      signInHere: this.config.signInOnPage && signsInHere(c),
      plugins: c.runtime === "claude" ? await this.pluginsOf(c) : null,
      employees: await this.connections.employeesOn(c.accountId, c.id),
      employeeReady: employeeReadiness({ runtime: c.runtime, label: c.label, auth: c.authState, reason: c.reason, catalog: c.catalog, capabilities: c.capabilities }),
      version: c.version,
      createdAt: c.createdAt,
    };
  }

  private async pluginsOf(c: ConnectionRecord): Promise<PluginGrantView> {
    const plugin = await orbitPlugin(this.config.pluginDir);
    const grants = await this.grants.of(c.accountId, c.id);
    const useCase = (u: PluginUseCase) => {
      const g = grants.find((x) => x.useCase === u);
      const approved = g !== undefined && g.approved && g.digest === plugin.digest;
      return { approved, needsConfirmation: g !== undefined && g.approved && g.digest !== plugin.digest, decidedAt: g?.decidedAt ?? null };
    };
    return { plugin: "orbit", installed: plugin.installed, version: plugin.version, digest: plugin.digest, useCases: Object.fromEntries(PLUGIN_USE_CASES.map((u) => [u, useCase(u)])) as PluginGrantView["useCases"], revision: c.pluginRevision };
  }

  // The account's own connection (another account's -- or a removed one -- is not found).
  private async own(owner: Owner, id: string): Promise<ConnectionRecord> {
    const c = /^[0-9a-f-]{36}$/.test(id) ? await this.connections.get(owner.accountId, id) : null;
    if (c === null) throw notFound("The connection");
    return c;
  }

  // Two connections created at once may both be the first of their runtime: the second is not the default.
  private async insert(record: Omit<ConnectionRecord, "pluginRevision" | "updatedAt" | "version" | "checkedAt">): Promise<void> {
    try {
      await this.db.tx(() => this.connections.insert(record));
    } catch (err) {
      if (pgCode(err) !== UNIQUE_VIOLATION || !record.isDefault) throw err;
      await this.connections.insert({ ...record, isDefault: false });
    }
  }

  // Checked, and what follows from it said: the account's models when its default Claude connection moved, its
  // connectors read once it is connected, the pages and the other contexts told.
  private async checked(c: ConnectionRecord, change: ConnectionChange): Promise<ConnectionRecord> {
    const after = await this.probe.check(c);
    if (after.runtime === "claude" && after.isDefault) await this.models.changed(after.accountId);
    if (after.runtime === "claude" && after.authState === "connected" && c.authState !== "connected") void this.connectors.read(after).catch((err) => this.logger.warn(`connectors of ${after.id}: ${err instanceof Error ? err.message : String(err)}`));
    await this.announce(after, change);
    return after;
  }

  private async announce(c: Pick<ConnectionRecord, "accountId" | "id" | "runtime" | "authState">, change: ConnectionChange): Promise<void> {
    this.bus.publishApp("connections.changed", { connectionId: c.id, runtime: c.runtime as RuntimeKind, change, auth: c.authState }, accountAudience(c.accountId));
    await this.hooks.changed({ accountId: c.accountId, connectionId: c.id, runtime: c.runtime as RuntimeKind, change, auth: c.authState });
  }

  // The CLI's own logout against the connection's home (best effort: the home is emptied after it either way).
  private async logout(c: ConnectionRecord): Promise<void> {
    const spec = RUNTIME_SPECS[c.runtime];
    if (spec.logout === null || c.method === "cloud") return;
    const r = await this.process.run(this.probe.binaryOf(c.runtime), spec.logout, { cwd: this.config.data.home, env: this.probe.envOf(c), timeoutMs: this.config.limits.commandTimeoutMs });
    if (r.code !== 0) this.logger.warn(`${spec.label}'s own logout of connection ${c.id} did not succeed (${r.spawnError ?? r.code}); its home is emptied anyway`);
  }

  // The account's audit record of a connection's change: what, which connection, never a key.
  private async record(ctx: GovernanceContext, what: ConnectionChange | "sign_in_started" | "signed_in_from_page", c: Pick<ConnectionRecord, "runtime" | "method">, detail: string): Promise<void> {
    await this.audit.record(ctx, { type: "settings.privileged.changed", outcome: what, data: { setting: `ai_connection.${c.runtime}.${c.method}.${what}`, value: detail } });
  }
}

