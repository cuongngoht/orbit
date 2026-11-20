// WHICH MODELS AND EFFORTS the signed-in Claude account may use: asked of its own Claude CLI (claude-models.ts), kept per
// account, and read again after every sign-in -- so an account a program gives a model to (a research preview, say)
// sees it, and an account without it does not. Every choice of a chat, a research session and the defaults is held to
// it. When the CLI cannot be asked, the fallback list is shown and a choice is held to its shape alone: the CLI then
// refuses what the account cannot use, with its own error.
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { catalogRefusals, effortFor, FALLBACK_CATALOG, modelOf, type EffortChoice, type ModeChoice, type ModelCatalog, type ModelChoice } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { badRequest } from "../../common/errors.js";
import { claudeEnv } from "../../infra/process/env.js";
import { endedHow, type ProcessPort } from "../../infra/process/process.port.js";
import { ClaudeAuthService } from "./claude-auth.service.js";
import { parseModelCatalog, PROBE_ARGS, PROBE_REQUEST } from "./claude-models.js";

// How long an account's catalog is kept, and how soon the CLI is asked again after it could not answer.
export const ACCOUNT_CATALOG_MS = 15 * 60_000;
export const FALLBACK_CATALOG_MS = 60_000;
const PROBE_TIMEOUT_MS = 20_000;
const PROBE_OUTPUT_BYTES = 2 * 1024 * 1024;

const fallback = (detail: string): ModelCatalog => ({ ...FALLBACK_CATALOG, detail });

// A run's model, effort and (for a chat) mode; null mode: a run with no mode (a research session).
export interface RunChoice {
  model: ModelChoice;
  effort: EffortChoice;
  mode: ModeChoice | null;
}

@Injectable()
export class ClaudeModelsService implements OnModuleInit {
  private cache: { key: string; until: number; value: Promise<ModelCatalog> } | null = null;
  private known: { key: string; catalog: ModelCatalog } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(ClaudeAuthService) private readonly claude: ClaudeAuthService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  // Each sign-in reads the account's catalog again.
  onModuleInit(): void {
    this.claude.subscribe((flow) => {
      if (flow.state !== "connected") return;
      this.cache = null;
      void this.catalog();
    });
  }

  async catalog(): Promise<ModelCatalog> {
    const identity = await this.claude.identity();
    if (identity === null) return fallback("No Claude account is signed in.");
    if (this.cache !== null && this.cache.key === identity.key && Date.now() < this.cache.until) return this.cache.value;
    const value = this.probe().then((catalog) => this.learned(identity.key, catalog));
    this.cache = { key: identity.key, until: Date.now() + FALLBACK_CATALOG_MS, value };
    return value;
  }

  // The catalog as last read for the account signed in now, without asking (null: not read yet).
  cached(): ModelCatalog | null {
    const identity = this.claude.currentIdentity();
    return identity !== null && this.known?.key === identity.key ? this.known.catalog : null;
  }

  // What a change leaves of a run's model, effort and mode, held to the account's catalog. An effort the change did not
  // name moves to one the (new) model takes; a model the account cannot use, an effort named that the model does not
  // take, or Autonomous with a model auto mode is not available with, is a 400 naming why.
  async settle(current: RunChoice, change: Partial<RunChoice>): Promise<RunChoice> {
    const catalog = await this.catalog();
    const model = change.model ?? current.model;
    const option = modelOf(catalog, model);
    const effort = change.effort ?? effortFor(option, current.effort) ?? current.effort;
    const mode = change.mode === undefined ? current.mode : change.mode;
    const refusals = catalogRefusals(catalog, { model, effort: option !== null && option.efforts.length === 0 ? null : effort, mode });
    if (refusals.length > 0) throw badRequest(refusals.join("; "), { errors: refusals });
    return { model, effort, mode };
  }

  private learned(key: string, catalog: ModelCatalog): ModelCatalog {
    if (this.cache?.key === key) this.cache.until = Date.now() + (catalog.source === "account" ? ACCOUNT_CATALOG_MS : FALLBACK_CATALOG_MS);
    const changed = this.known?.key !== key || JSON.stringify(this.known.catalog) !== JSON.stringify(catalog);
    this.known = { key, catalog };
    if (changed) this.bus.publishApp("claude.models", { catalog });
    return catalog;
  }

  private async probe(): Promise<ModelCatalog> {
    const r = await this.process.run(this.config.binaries.claude, PROBE_ARGS, { cwd: this.config.data.home, env: claudeEnv(this.config), input: PROBE_REQUEST, timeoutMs: PROBE_TIMEOUT_MS, maxOutputBytes: PROBE_OUTPUT_BYTES });
    if (r.spawnError !== null || r.timedOut) return fallback(`The Claude CLI could not be asked which models this account may use (it ${endedHow(r)}): the default list is shown, and the CLI decides.`);
    return parseModelCatalog(r.stdout) ?? fallback("The Claude CLI did not list this account's models: the default list is shown, and the CLI decides.");
  }
}
