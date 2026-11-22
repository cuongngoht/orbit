// WHICH CONNECTION A RUN OF AN ACCOUNT USES. A research question runs on the account's DEFAULT Claude Code connection; a
// chat on the connection it named when it was made (Claude Code or OpenAI Codex, the account's own) or, naming none, on
// that default -- its own config home (and, for a Claude Code API-key connection, its own key): never another
// account's, never a login of the server's. With no such connection, or one that is not connected, nothing starts: 409
// `connection_required` / `connection_unavailable`, pointing to Settings → AI Connections.
//
// The Orbit plugin is loaded into a chat only when the account's owner approved it for chats, on that connection, for
// the plugin's digest as it is now (an upgraded plugin waits for the owner's confirmation).
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { AUTH_STATE_TEXT, CONNECTION_ERRORS, RUNTIME_LABELS, type PluginUseCase, type RuntimeKind } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { ApiError, notFound } from "../../common/errors.js";
import { ConnectionStore, PluginGrantStore, type ConnectionRecord } from "../../infra/connections/stores.js";
import { orbitPlugin } from "./plugin.js";
import { ConnectionProbe } from "./probe.js";

export interface RunConnection {
  connection: ConnectionRecord;
  // Claude Code's CLAUDE_CONFIG_DIR for this connection.
  configDir: string;
  // What the connection's CLI is given beside its home: its own key, for an API-key connection (read from the credential
  // store at this moment; never kept anywhere else).
  secretEnv: Record<string, string>;
}

export const connectionRequired = (): ApiError =>
  new ApiError(HttpStatus.CONFLICT, CONNECTION_ERRORS.connectionRequired, "Connect Claude Code (or another CLI) in Settings → AI Connections first: chats and research run on your account's own connection.");

export const connectionUnavailable = (c: ConnectionRecord): ApiError =>
  new ApiError(HttpStatus.CONFLICT, CONNECTION_ERRORS.connectionUnavailable, `Your ${RUNTIME_LABELS[c.runtime]} connection "${c.label}" is not connected (${AUTH_STATE_TEXT[c.authState]}${c.reason ? `: ${c.reason}` : ""}). Check it in Settings → AI Connections.`);

// The runtimes a chat may run on.
export const CHAT_RUNTIMES: readonly RuntimeKind[] = ["claude", "codex"];

@Injectable()
export class RunConnections {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ConnectionStore) private readonly connections: ConnectionStore,
    @Inject(PluginGrantStore) private readonly grants: PluginGrantStore,
    @Inject(ConnectionProbe) private readonly probe: ConnectionProbe,
  ) {}

  // The account's default Claude Code connection, whatever its state (null: it has none).
  claudeOf(accountId: string): Promise<ConnectionRecord | null> {
    return this.connections.defaultOf(accountId, "claude");
  }

  // The connection a run of the account starts on now, or null when it has no connected one.
  async ready(accountId: string): Promise<RunConnection | null> {
    const c = await this.claudeOf(accountId);
    return c !== null && c.authState === "connected" ? this.forRun(c) : null;
  }

  // The same -- or the 409 that says what is missing.
  async require(accountId: string): Promise<RunConnection> {
    const c = await this.claudeOf(accountId);
    if (c === null) throw connectionRequired();
    if (c.authState !== "connected") throw connectionUnavailable(c);
    return this.forRun(c);
  }

  // The connection a chat names (null: the account's default Claude Code connection), whatever its state -- null when it
  // has none. A named one is this account's, not removed, and of a runtime a chat runs on, or not found.
  async chatConnectionOf(accountId: string, connectionId: string | null): Promise<ConnectionRecord | null> {
    if (connectionId === null) return this.claudeOf(accountId);
    const c = await this.connections.get(accountId, connectionId);
    if (c === null || !CHAT_RUNTIMES.includes(c.runtime)) throw notFound("AI connection");
    return c;
  }

  // The connection a chat runs on now -- or the 409 that says what is missing.
  async requireChat(accountId: string, connectionId: string | null): Promise<RunConnection> {
    const c = await this.chatConnectionOf(accountId, connectionId);
    if (c === null) throw connectionRequired();
    if (c.authState !== "connected") throw connectionUnavailable(c);
    return this.forRun(c);
  }

  // The same, or null when it is not connected (now): a message's run, decided when it starts.
  async readyChat(accountId: string, connectionId: string | null): Promise<RunConnection | null> {
    const c = await this.chatConnectionOf(accountId, connectionId).catch(() => null);
    return c !== null && c.authState === "connected" ? this.forRun(c) : null;
  }

  // Whether the account's owner approved the Orbit plugin for this use case on this connection, for its digest now.
  async pluginApproved(c: ConnectionRecord, useCase: PluginUseCase): Promise<boolean> {
    if (c.runtime !== "claude") return false;
    const plugin = await orbitPlugin(this.config.pluginDir);
    if (!plugin.installed || plugin.digest === null) return false;
    const grant = (await this.grants.of(c.accountId, c.id)).find((g) => g.useCase === useCase);
    return grant !== undefined && grant.approved && grant.digest === plugin.digest;
  }

  private forRun(c: ConnectionRecord): RunConnection {
    return { connection: c, configDir: this.probe.configDir(c), secretEnv: this.probe.secretEnvOf(c) };
  }
}
