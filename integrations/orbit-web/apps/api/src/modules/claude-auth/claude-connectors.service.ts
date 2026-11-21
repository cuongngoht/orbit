// WHICH CONNECTORS a run may use, the account's own and each as its owner chose. The list is asked of the runtime's
// Claude CLI (claude-connectors.ts) -- which holds the account signed in now -- kept per account and read again after
// every sign-in and on request; the choices are the account's own settings (`connectors`), each connector with where it
// may be used -- a chat, research -- and a connector nobody chose for is what CONNECTOR_DEFAULTS says. A run reads what
// applies to it with `forRun(account)`, without asking the CLI: a chat is denied the connectors unchecked for chats;
// research may use the ones checked for research. The account's policy then decides each one (tool.connector).
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { CONNECTOR_DEFAULTS, connectorKindOf, connectorLabelOf, connectorToolPrefix, type Connector, type ConnectorList, type ConnectorUse, type UpdateConnectorsRequest } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { claudeEnv } from "../../infra/process/env.js";
import { LineSplitter } from "../../infra/process/lines.js";
import type { ProcessPort } from "../../infra/process/process.port.js";
import { AccountSettingsStore } from "../../infra/accounts/stores.js";
import { AuthHooks } from "../auth/auth-hooks.js";
import { connectorsOf, controlRequest, CONNECTORS_PROBE_ARGS, settledOver, type ProbedConnector } from "./claude-connectors.js";

type Choices = Record<string, Partial<ConnectorUse>>;

// A connector a run may be given: its name, its tools' prefix, and what a person calls it.
export interface RunConnector {
  name: string;
  prefix: string;
  label: string;
}

// What the owner chose, for a run to ask the account's policy about (run-governance: tool.connector, one decision each).
export interface RunConnectors {
  // Every connector known for the account (listed by its CLI, or chosen for before).
  known: RunConnector[];
  // Those checked for chats, and those checked for research.
  chat: RunConnector[];
  research: RunConnector[];
}

const NONE: RunConnectors = { known: [], chat: [], research: [] };

export const runConnectorOf = (name: string): RunConnector => ({ name, prefix: connectorToolPrefix(name), label: connectorLabelOf(name) });

const CHOICES = "connectors";

@Injectable()
export class ClaudeConnectorsService implements OnModuleInit {
  private readonly logger = new Logger("ClaudeConnectors");
  private known: { key: string; connectors: ProbedConnector[]; at: string } | null = null;
  private asking: { key: string; done: Promise<void> } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(AccountSettingsStore) private readonly settings: AccountSettingsStore,
    @Inject(AuthHooks) private readonly hooks: AuthHooks,
  ) {}

  // Each sign-in reads the account's connectors again; an account that ends forgets them.
  onModuleInit(): void {
    this.hooks.onSignedIn((ctx) => {
      if (ctx.accountId !== null) void this.list(ctx.accountId, true).catch(() => undefined);
    });
    this.hooks.onEnded((e) => {
      if (e.scope === "account" && this.known?.key === e.accountId) this.known = null;
    });
  }

  // The account's connectors, with its choices: read from the runtime's CLI when `fresh`, or when this account has not
  // been read yet. Only the account the CLI holds now may be read (the gate made sure an owner's is).
  async list(accountId: string, fresh = false): Promise<ConnectorList> {
    if (fresh || this.known?.key !== accountId) await this.read(accountId);
    const choices = await this.choices(accountId);
    const known = this.known?.key === accountId ? this.known : null;
    if (known === null) {
      const kept = Object.keys(choices).map((name) => this.connectorOf({ name, status: "unknown", tools: null }, choices));
      return { source: "unavailable", connectors: kept, detail: "The Claude CLI could not be asked which connectors this account has; the choices kept so far are shown.", readAt: null };
    }
    return { source: "account", connectors: known.connectors.map((c) => this.connectorOf(c, choices)), detail: null, readAt: known.at };
  }

  // The owner's choices for the account, merged into what it had.
  async update(accountId: string, change: UpdateConnectorsRequest): Promise<ConnectorList> {
    const choices = await this.choices(accountId);
    for (const [name, use] of Object.entries(change.connectors)) choices[name] = { ...choices[name], ...use };
    await this.settings.set(accountId, CHOICES, choices);
    return this.list(accountId);
  }

  // What a run of the account may use -- from what is known, asking nothing.
  async forRun(accountId: string | null): Promise<RunConnectors> {
    if (accountId === null) return NONE;
    const choices = await this.choices(accountId);
    const names = new Set([...Object.keys(choices), ...(this.known?.key === accountId ? this.known.connectors.map((c) => c.name) : [])]);
    const use = (name: string, where: keyof ConnectorUse): boolean => choices[name]?.[where] ?? CONNECTOR_DEFAULTS[where];
    const all = [...names].sort();
    return { known: all.map(runConnectorOf), chat: all.filter((n) => use(n, "chat")).map(runConnectorOf), research: all.filter((n) => use(n, "research")).map(runConnectorOf) };
  }

  private async choices(accountId: string): Promise<Choices> {
    return (await this.settings.get<Choices>(accountId, CHOICES)) ?? {};
  }

  private connectorOf(c: ProbedConnector, choices: Choices): Connector {
    const own = choices[c.name] ?? {};
    return { name: c.name, label: connectorLabelOf(c.name), kind: connectorKindOf(c.name), status: c.status, tools: c.tools, chat: own.chat ?? CONNECTOR_DEFAULTS.chat, research: own.research ?? CONNECTOR_DEFAULTS.research };
  }

  // One read at a time per account; what it learns replaces what was known (a failed read keeps it).
  private async read(key: string): Promise<void> {
    if (this.asking?.key === key) return this.asking.done;
    const done = this.probe().then((connectors) => {
      if (connectors !== null) this.known = { key, connectors, at: new Date().toISOString() };
    });
    this.asking = { key, done };
    try {
      await done;
    } finally {
      if (this.asking?.done === done) this.asking = null;
    }
  }

  // `initialize`, then `mcp_status` again and again until the list settles or the deadline: what it last said (null if
  // it never answered). The process is ended either way.
  private probe(): Promise<ProbedConnector[] | null> {
    const { connectorPollMs, connectorDeadlineMs } = this.config.limits;
    return new Promise((resolve) => {
      let last: ProbedConnector[] | null = null;
      let asked = 0;
      let poll: NodeJS.Timeout | null = null;
      let finished = false;
      const handle = this.process.spawn(this.config.binaries.claude, CONNECTORS_PROBE_ARGS, { cwd: this.config.data.home, env: claudeEnv(this.config) });
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        if (poll !== null) clearTimeout(poll);
        handle.closeInput();
        handle.kill("SIGTERM");
        resolve(last);
      };
      const ask = () => {
        asked += 1;
        handle.write(controlRequest(`orbit-web-connectors-${asked}`, "mcp_status"));
      };
      const deadline = setTimeout(() => {
        if (last === null) this.logger.warn("the Claude CLI did not list this account's connectors in time");
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
        poll = setTimeout(ask, connectorPollMs);
      });
      handle.onStdout((chunk) => splitter.push(chunk));
      handle.onExit(() => finish());
      handle.write(controlRequest("orbit-web-connectors-init", "initialize"));
      poll = setTimeout(ask, connectorPollMs);
    });
  }
}
