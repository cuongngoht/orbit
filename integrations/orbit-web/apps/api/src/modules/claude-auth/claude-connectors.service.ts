// WHICH CONNECTORS a run may use, the signed-in account's own and each as its person chose. The list is asked of the
// account's Claude CLI (claude-connectors.ts), kept per account and read again after every sign-in and on request; the
// choices are kept per account (`connectors:<account>` in settings), each connector with where it may be used -- a
// chat, research -- and a connector nobody chose for is what CONNECTOR_DEFAULTS says. A run reads what applies to it
// with `forRun`, without asking the CLI: a chat is denied the connectors unchecked for chats; research may use the ones
// checked for research. A run governance holds uses none, whatever is checked (its Constitution has no such action).
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { CONNECTOR_DEFAULTS, connectorKindOf, connectorLabelOf, connectorToolPrefix, type Connector, type ConnectorList, type ConnectorUse, type UpdateConnectorsRequest } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { claudeEnv } from "../../infra/process/env.js";
import { LineSplitter } from "../../infra/process/lines.js";
import type { ProcessPort } from "../../infra/process/process.port.js";
import { SettingsStore } from "../../infra/storage/stores.js";
import { ClaudeAuthService } from "./claude-auth.service.js";
import { connectorsOf, controlRequest, CONNECTORS_PROBE_ARGS, settledOver, type ProbedConnector } from "./claude-connectors.js";

type Choices = Record<string, Partial<ConnectorUse>>;

// A connector research may use: its tools' prefix, and what a person calls it.
export interface RunConnector {
  prefix: string;
  label: string;
}

export interface RunConnectors {
  // The tool prefixes a chat is denied (connectors unchecked for chats).
  chatDenied: string[];
  // Those research may use (checked for research), and those it is denied (the rest it knows of).
  researchAllowed: RunConnector[];
  researchDenied: string[];
}

const NONE: RunConnectors = { chatDenied: [], researchAllowed: [], researchDenied: [] };

const choicesKey = (accountKey: string): string => `connectors:${accountKey}`;

@Injectable()
export class ClaudeConnectorsService implements OnModuleInit {
  private readonly logger = new Logger("ClaudeConnectors");
  private known: { key: string; connectors: ProbedConnector[]; at: string } | null = null;
  private asking: { key: string; done: Promise<void> } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(ClaudeAuthService) private readonly claude: ClaudeAuthService,
    @Inject(SettingsStore) private readonly settings: SettingsStore,
  ) {}

  // Each sign-in reads the account's connectors again.
  onModuleInit(): void {
    this.claude.subscribe((flow) => {
      if (flow.state === "connected") void this.list(true);
    });
  }

  // The connectors of the account signed in now, with its choices: read from its CLI when `fresh`, or when this account
  // has not been read yet.
  async list(fresh = false): Promise<ConnectorList> {
    const identity = await this.claude.identity();
    if (identity === null) return { source: "unavailable", connectors: [], detail: "No Claude account is signed in.", readAt: null };
    if (fresh || this.known?.key !== identity.key) await this.read(identity.key);
    const choices = this.choices(identity.key);
    const known = this.known?.key === identity.key ? this.known : null;
    if (known === null) {
      const kept = Object.keys(choices).map((name) => this.connectorOf({ name, status: "unknown", tools: null }, choices));
      return { source: "unavailable", connectors: kept, detail: "The Claude CLI could not be asked which connectors this account has; the choices kept so far are shown.", readAt: null };
    }
    return { source: "account", connectors: known.connectors.map((c) => this.connectorOf(c, choices)), detail: null, readAt: known.at };
  }

  // A person's choices for the account signed in now, merged into what it had.
  async update(change: UpdateConnectorsRequest): Promise<ConnectorList> {
    const identity = await this.claude.identity();
    if (identity === null) return this.list();
    const choices = this.choices(identity.key);
    for (const [name, use] of Object.entries(change.connectors)) choices[name] = { ...choices[name], ...use };
    this.settings.set(choicesKey(identity.key), choices);
    return this.list();
  }

  // What a run of the account signed in now may use -- from what is known, asking nothing.
  forRun(): RunConnectors {
    const identity = this.claude.currentIdentity();
    if (identity === null) return NONE;
    const choices = this.choices(identity.key);
    const names = new Set([...Object.keys(choices), ...(this.known?.key === identity.key ? this.known.connectors.map((c) => c.name) : [])]);
    const use = (name: string, where: keyof ConnectorUse): boolean => choices[name]?.[where] ?? CONNECTOR_DEFAULTS[where];
    const all = [...names].sort();
    return {
      chatDenied: all.filter((n) => !use(n, "chat")).map(connectorToolPrefix),
      researchAllowed: all.filter((n) => use(n, "research")).map((n) => ({ prefix: connectorToolPrefix(n), label: connectorLabelOf(n) })),
      researchDenied: all.filter((n) => !use(n, "research")).map(connectorToolPrefix),
    };
  }

  private choices(accountKey: string): Choices {
    return this.settings.get<Choices>(choicesKey(accountKey)) ?? {};
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
