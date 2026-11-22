// WHICH MODELS AND EFFORTS an account may use: what its DEFAULT Claude Code connection's own CLI said, the last time that
// connection was checked (probe.ts: the control protocol's `initialize`, run against that connection's home -- never
// another account's) -- so an account a program gives a model to (a research preview, say) sees it, and an account
// without it does not. Every choice of a chat, a research session and the defaults is held to it. When the connection's
// CLI could not be asked (or there is no connected connection), the fallback list is shown, labelled, and a choice is
// held to its shape alone: the CLI then refuses what the account cannot use, with its own error.
import { Inject, Injectable } from "@nestjs/common";
import { catalogRefusals, CONNECTION_ERRORS, effortFor, FALLBACK_CATALOG, modelOf, RUNTIME_LABELS, type ChatRuntime, type EffortChoice, type ModeChoice, type ModelCatalog, type ModelChoice } from "@orbit-web/contracts";
import { HttpStatus } from "@nestjs/common";
import type { ConnectionRecord } from "../../infra/connections/stores.js";
import { accountAudience, EventBus } from "../../core/events/event-bus.js";
import { ApiError, badRequest } from "../../common/errors.js";
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

  // The catalog a chat on `connection` is held to: the account's default Claude Code catalog when it names none; else
  // what that connection's own CLI last said -- a fallback list when it could not be asked (labelled; the CLI decides),
  // and for a connection whose CLI never listed its models, nothing to choose from (409, Re-check it).
  async catalogFor(accountId: string, connection: ConnectionRecord | null): Promise<ModelCatalog> {
    if (connection === null) return this.catalog(accountId);
    const c = connection.catalog;
    if (c.models.length > 0 && (c.source === "account" || c.source === "fallback")) return { source: c.source, models: c.models, recommended: c.recommended ?? (c.models[0] as { id: string }).id, detail: c.source === "fallback" ? `${RUNTIME_LABELS[connection.runtime]} could not be asked which models this connection may use: its fallback list is shown, and the CLI decides.` : null };
    if (connection.runtime === "claude") return fallback(`The Claude Code connection "${connection.label}" gave no model list: the default list is shown.`);
    throw new ApiError(HttpStatus.CONFLICT, "connection_models_unknown", `${RUNTIME_LABELS[connection.runtime]} "${connection.label}" has not said which models it may use: Re-check it in Settings → AI Connections.`);
  }

  // The catalog a new chat's defaults are held to: the AI it starts on -- Claude Code's (the account's catalog, the
  // fallback list included), or that of the runtime's connection a new chat starts on, which must be signed in (409
  // says where).
  async catalogOfRuntime(accountId: string, runtime: ChatRuntime): Promise<ModelCatalog> {
    if (runtime === "claude") return this.catalog(accountId);
    const c = await this.runs.signedInOf(accountId, runtime);
    if (c === null) throw new ApiError(HttpStatus.CONFLICT, CONNECTION_ERRORS.connectionRequired, `${RUNTIME_LABELS[runtime]} is not signed in: sign in to its subscription in Settings → AI Connections first.`);
    return this.catalogFor(accountId, c);
  }

  // What a change leaves of a run's model, effort and mode, held to the account's catalog. An effort the change did not
  // name moves to one the (new) model takes; a model the account cannot use, an effort named that the model does not
  // take, or Autonomous with a model auto mode is not available with, is a 400 naming why.
  async settle(accountId: string, current: RunChoice, change: Partial<RunChoice>): Promise<RunChoice> {
    return this.settleWith(await this.catalog(accountId), current, change);
  }

  // The same, held to a catalog given (a chat's own connection's: catalogFor).
  settleWith(catalog: ModelCatalog, current: RunChoice, change: Partial<RunChoice>): RunChoice {
    const model = change.model ?? current.model;
    const option = modelOf(catalog, model);
    const effort = change.effort ?? effortFor(option, current.effort) ?? current.effort;
    const mode = change.mode === undefined ? current.mode : change.mode;
    const refusals = catalogRefusals(catalog, { model, effort: option !== null && option.efforts.length === 0 ? null : effort, mode });
    if (refusals.length > 0) throw badRequest(refusals.join("; "), { errors: refusals });
    return { model, effort, mode };
  }
}
