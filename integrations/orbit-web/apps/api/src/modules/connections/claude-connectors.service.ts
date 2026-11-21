// WHICH CONNECTORS a run may use, the account's own and each as its owner chose. The list is asked of the CLI of the
// account's DEFAULT Claude Code connection (claude-connectors.ts), run against that connection's own home -- so an
// account's list is never another account's -- kept per connection and read again on request (and once a connection
// is checked connected); the choices are the account's own settings (`connectors`), each connector with where it may be
// used -- a chat, research -- and a connector nobody chose for is what CONNECTOR_DEFAULTS says. A run reads what applies
// to it with `forRun(account)`, without asking the CLI: a chat is denied the connectors unchecked for chats; research may
// use the ones checked for research. The account's policy then decides each one (tool.connector).
import { Inject, Injectable, Logger } from "@nestjs/common";
import { CONNECTOR_DEFAULTS, connectorKindOf, connectorLabelOf, connectorToolPrefix, type Connector, type ConnectorList, type ConnectorUse, type UpdateConnectorsRequest } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { AccountSettingsStore } from "../../infra/accounts/stores.js";
import type { ConnectionRecord } from "../../infra/connections/stores.js";
import { LineSplitter } from "../../infra/process/lines.js";
import type { ProcessPort } from "../../infra/process/process.port.js";
import { connectorsOf, controlRequest, CONNECTORS_PROBE_ARGS, settledOver, type ProbedConnector } from "./claude-connectors.js";
import { ConnectionProbe } from "./probe.js";
import { RunConnections } from "./run-connections.js";

type Choices = Record<string, Partial<ConnectorUse>>;

// A connector a run may be given: its name, its tools' prefix, and what a person calls it.
export interface RunConnector {
  name: string;
  prefix: string;
  label: string;
}

// What the owner chose, for a run to ask the account's policy about (run-governance: tool.connector, one decision each).
export interface RunConnectors {
  // Every connector known for the account (listed by its connection's CLI, or chosen for before).
  known: RunConnector[];
  // Those checked for chats, and those checked for research.
  chat: RunConnector[];
  research: RunConnector[];
}

const NONE: RunConnectors = { known: [], chat: [], research: [] };

export const runConnectorOf = (name: string): RunConnector => ({ name, prefix: connectorToolPrefix(name), label: connectorLabelOf(name) });

const CHOICES = "connectors";

@Injectable()
export class ClaudeConnectorsService {
  private readonly logger = new Logger("ClaudeConnectors");
  // What each connection's CLI listed last (key: the connection's id).
  private readonly known = new Map<string, { connectors: ProbedConnector[]; at: string }>();
  private readonly asking = new Map<string, Promise<void>>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(AccountSettingsStore) private readonly settings: AccountSettingsStore,
    @Inject(RunConnections) private readonly runs: RunConnections,
    @Inject(ConnectionProbe) private readonly probe: ConnectionProbe,
  ) {}

  // The account's connectors, with its choices: read from its default connection's CLI when `fresh`, or when that
  // connection has not been read yet.
  async list(accountId: string, fresh = false): Promise<ConnectorList> {
    const c = await this.runs.claudeOf(accountId);
    const usable = c !== null && c.authState === "connected" ? c : null;
    if (usable !== null && (fresh || !this.known.has(usable.id))) await this.read(usable);
    const choices = await this.choices(accountId);
    const known = usable === null ? undefined : this.known.get(usable.id);
    if (known === undefined) {
      const kept = Object.keys(choices).map((name) => this.connectorOf({ name, status: "unknown", tools: null }, choices));
      const detail = usable === null ? "No connected Claude Code connection (Settings → AI Connections): the choices kept so far are shown." : "Claude Code could not be asked which connectors this account has; the choices kept so far are shown.";
      return { source: "unavailable", connectors: kept, detail, readAt: null };
    }
    return { source: "account", connectors: known.connectors.map((k) => this.connectorOf(k, choices)), detail: null, readAt: known.at };
  }

  // The owner's choices for the account, merged into what it had.
  async update(accountId: string, change: UpdateConnectorsRequest): Promise<ConnectorList> {
    const choices = await this.choices(accountId);
    for (const [name, use] of Object.entries(change.connectors)) choices[name] = { ...choices[name], ...use };
    await this.settings.set(accountId, CHOICES, choices);
    return this.list(accountId);
  }

  // What a run of the account may use -- from what is known of its connection, asking nothing.
  async forRun(accountId: string | null, connectionId: string | null = null): Promise<RunConnectors> {
    if (accountId === null) return NONE;
    const choices = await this.choices(accountId);
    const listed = connectionId === null ? [] : (this.known.get(connectionId)?.connectors ?? []);
    const names = new Set([...Object.keys(choices), ...listed.map((k) => k.name)]);
    const use = (name: string, where: keyof ConnectorUse): boolean => choices[name]?.[where] ?? CONNECTOR_DEFAULTS[where];
    const all = [...names].sort();
    return { known: all.map(runConnectorOf), chat: all.filter((n) => use(n, "chat")).map(runConnectorOf), research: all.filter((n) => use(n, "research")).map(runConnectorOf) };
  }

  // A connection that is gone (or signed out) is forgotten.
  forget(connectionId: string): void {
    this.known.delete(connectionId);
  }

  private async choices(accountId: string): Promise<Choices> {
    return (await this.settings.get<Choices>(accountId, CHOICES)) ?? {};
  }

  private connectorOf(c: ProbedConnector, choices: Choices): Connector {
    const own = choices[c.name] ?? {};
    return { name: c.name, label: connectorLabelOf(c.name), kind: connectorKindOf(c.name), status: c.status, tools: c.tools, chat: own.chat ?? CONNECTOR_DEFAULTS.chat, research: own.research ?? CONNECTOR_DEFAULTS.research };
  }

  // One read at a time per connection; what it learns replaces what was known (a failed read keeps it).
  async read(c: ConnectionRecord): Promise<void> {
    const pending = this.asking.get(c.id);
    if (pending !== undefined) return pending;
    const done = this.ask(c).then((connectors) => {
      if (connectors !== null) this.known.set(c.id, { connectors, at: new Date().toISOString() });
    });
    this.asking.set(c.id, done);
    try {
      await done;
    } finally {
      if (this.asking.get(c.id) === done) this.asking.delete(c.id);
    }
  }

  // `initialize`, then `mcp_status` again and again until the list settles or the deadline: what it last said (null if
  // it never answered). The process is ended either way.
  private ask(c: ConnectionRecord): Promise<ProbedConnector[] | null> {
    const { connectorPollMs, connectorDeadlineMs } = this.config.limits;
    return new Promise((resolve) => {
      let last: ProbedConnector[] | null = null;
      let asked = 0;
      let poll: NodeJS.Timeout | null = null;
      let finished = false;
      const handle = this.process.spawn(this.config.binaries.claude, CONNECTORS_PROBE_ARGS, { cwd: this.config.data.home, env: this.probe.envOf(c) });
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        if (poll !== null) clearTimeout(poll);
        handle.closeInput();
        handle.kill("SIGTERM");
        resolve(last);
      };
      const askAgain = () => {
        asked += 1;
        handle.write(controlRequest(`orbit-web-connectors-${asked}`, "mcp_status"));
      };
      const deadline = setTimeout(() => {
        if (last === null) this.logger.warn(`the Claude CLI of connection ${c.id} did not list its connectors in time`);
        finish();
      }, connectorDeadlineMs);
      const splitter = new LineSplitter((line) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return;
        }
        const now = connectorsOf(parsed);
        if (now === null || finished) return;
        // An account with no connector at all: still none after a few asks.
        const settled = settledOver(last, now) || (asked >= 3 && now.length === 0 && last?.length === 0);
        last = now;
        if (settled) return finish();
        poll = setTimeout(askAgain, connectorPollMs);
      });
      handle.onStdout((chunk) => splitter.push(chunk));
      handle.onExit(() => finish());
      handle.write(controlRequest("orbit-web-connectors-init", "initialize"));
      poll = setTimeout(askAgain, connectorPollMs);
    });
  }
}
