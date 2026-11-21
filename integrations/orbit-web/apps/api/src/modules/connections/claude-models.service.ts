// WHICH MODELS AND EFFORTS an account may use: what its DEFAULT Claude Code connection's own CLI said, the last time that
// connection was checked (probe.ts: the control protocol's `initialize`, run against that connection's home -- never
// another account's) -- so an account a program gives a model to (a research preview, say) sees it, and an account
// without it does not. Every choice of a chat, a research session and the defaults is held to it. When the connection's
// CLI could not be asked (or there is no connected connection), the fallback list is shown, labelled, and a choice is
// held to its shape alone: the CLI then refuses what the account cannot use, with its own error.
import { Inject, Injectable } from "@nestjs/common";
import { catalogRefusals, effortFor, FALLBACK_CATALOG, modelOf, type EffortChoice, type ModeChoice, type ModelCatalog, type ModelChoice } from "@orbit-web/contracts";
import { accountAudience, EventBus } from "../../core/events/event-bus.js";
import { badRequest } from "../../common/errors.js";
import { RunConnections } from "./run-connections.js";

const fallback = (detail: string): ModelCatalog => ({ ...FALLBACK_CATALOG, detail });

// A run's model, effort and (for a chat) mode; null mode: a run with no mode (a research session).
export interface RunChoice {
  model: ModelChoice;
  effort: EffortChoice;
  mode: ModeChoice | null;
}

@Injectable()
export class ClaudeModelsService {
  constructor(
    @Inject(RunConnections) private readonly runs: RunConnections,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  // The account's catalog: its default Claude Code connection's, as last read from its CLI.
  async catalog(accountId: string): Promise<ModelCatalog> {
    const c = await this.runs.claudeOf(accountId);
    if (c === null) return fallback("No Claude Code connection yet (Settings → AI Connections): the default list is shown.");
    if (c.authState !== "connected") return fallback(`The Claude Code connection "${c.label}" is not connected: the default list is shown.`);
    if (c.catalog.source !== "account" || c.catalog.models.length === 0) return fallback("Claude Code could not be asked which models this connection may use: the default list is shown, and the CLI decides.");
    return { source: "account", models: c.catalog.models, recommended: c.catalog.recommended ?? (c.catalog.models[0] as { id: string }).id, detail: null };
  }

  // The default connection's catalog was read again: the account's pages are told.
  async changed(accountId: string): Promise<void> {
    this.bus.publishApp("claude.models", { catalog: await this.catalog(accountId) }, accountAudience(accountId));
  }

  // What a change leaves of a run's model, effort and mode, held to the account's catalog. An effort the change did not
  // name moves to one the (new) model takes; a model the account cannot use, an effort named that the model does not
  // take, or Autonomous with a model auto mode is not available with, is a 400 naming why.
  async settle(accountId: string, current: RunChoice, change: Partial<RunChoice>): Promise<RunChoice> {
    const catalog = await this.catalog(accountId);
    const model = change.model ?? current.model;
    const option = modelOf(catalog, model);
    const effort = change.effort ?? effortFor(option, current.effort) ?? current.effort;
    const mode = change.mode === undefined ? current.mode : change.mode;
    const refusals = catalogRefusals(catalog, { model, effort: option !== null && option.efforts.length === 0 ? null : effort, mode });
    if (refusals.length > 0) throw badRequest(refusals.join("; "), { errors: refusals });
    return { model, effort, mode };
  }
}
