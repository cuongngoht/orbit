// What a run is asked to use: the model, the effort and the mode. The model and the effort are the CLI's own words
// (`--model`, `--effort`), and WHICH of them a Claude account may use is the account's: the API asks the signed-in
// Claude CLI for its catalog (GET /api/claude/models) and holds every choice to it. The lists below are only the
// FALLBACK, shown when the CLI could not be asked -- then a choice is held to its shape alone, and the CLI refuses one
// the account cannot use with its own error, which the chat shows as it was said. The mode is Orbit Web's own closed
// list.

// The CLI's aliases for the latest model of each family, in the order the model picker shows them (the fallback).
export const MODEL_CHOICES = ["opus", "fable", "sonnet", "haiku"] as const;

// A model as the CLI names it: an alias (`opus`) or an id (`claude-opus-4-6`, `sonnet[1m]`). Never something an argument
// parser could read as an option, never whitespace.
export type ModelChoice = string;

export const DEFAULT_MODEL: ModelChoice = "sonnet";

// What each fallback alias means today (the CLI's own table); the label is all the web app shows.
export const MODEL_LABELS: Readonly<Record<string, string>> = {
  opus: "Opus 5.5",
  fable: "Fable 5.2",
  sonnet: "Sonnet 5.5",
  haiku: "Haiku 5.5",
};

const MODEL_SHAPE = /^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/;

export const isModelChoice = (value: unknown): value is ModelChoice => typeof value === "string" && MODEL_SHAPE.test(value);

// `--effort`: how thoroughly the model works. The levels the CLI knows today, in order (the fallback); a model of an
// account's catalog names the ones it supports.
export const EFFORT_CHOICES = ["low", "medium", "high", "xhigh", "max"] as const;

export type EffortChoice = string;

export const DEFAULT_EFFORT: EffortChoice = "medium";

export const EFFORT_LABELS: Readonly<Record<string, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra",
  max: "Max",
};

const EFFORT_SHAPE = /^[a-z][a-z0-9-]{0,23}$/;

export const isEffortChoice = (value: unknown): value is EffortChoice => typeof value === "string" && EFFORT_SHAPE.test(value);

const capitalized = (s: string): string => (s.length === 0 ? s : `${s[0]?.toUpperCase() ?? ""}${s.slice(1)}`);

export const effortLabel = (effort: string): string => EFFORT_LABELS[effort] ?? capitalized(effort);

// The two modes Orbit Web offers, and the CLI permission mode each one is. Autonomous is Claude Code's auto mode (a
// classifier reviews each action before it runs); Plan is its plan mode (read and plan, change nothing). The deny
// rules (no push, no `gh`, no sign-in directory) bind in both.
export const MODE_CHOICES = ["autonomous", "plan"] as const;

export type ModeChoice = (typeof MODE_CHOICES)[number];

export const DEFAULT_MODE: ModeChoice = "autonomous";

export const MODE_LABELS: Record<ModeChoice, string> = {
  autonomous: "Autonomous",
  plan: "Plan",
};

export const MODE_PERMISSION: Record<ModeChoice, "auto" | "plan"> = {
  autonomous: "auto",
  plan: "plan",
};

export const isModeChoice = (value: unknown): value is ModeChoice =>
  typeof value === "string" && (MODE_CHOICES as readonly string[]).includes(value);

// THE MODEL CATALOG of the Claude account Orbit Web is signed in with: what its Claude CLI says the account may use
// (a program's models -- a research preview, say -- appear for the accounts that have them), or the fallback.
export interface ModelOption {
  // What `--model` is given.
  id: ModelChoice;
  label: string;
  description: string | null;
  // The effort levels this model takes, in order; empty: it takes none (no `--effort` is passed).
  efforts: EffortChoice[];
  // Whether Claude Code's auto mode (Orbit Web's Autonomous) is available with it.
  autoMode: boolean;
}

export interface ModelCatalog {
  // `account`: the signed-in account's own catalog. `fallback`: the CLI could not be asked (`detail` says why); a choice
  // is then held to its shape only.
  source: "account" | "fallback";
  models: ModelOption[];
  // The model the CLI recommends to this account.
  recommended: ModelChoice;
  detail: string | null;
}

export const FALLBACK_CATALOG: ModelCatalog = {
  source: "fallback",
  models: MODEL_CHOICES.map((id) => ({ id, label: MODEL_LABELS[id] ?? id, description: null, efforts: [...EFFORT_CHOICES], autoMode: true })),
  recommended: DEFAULT_MODEL,
  detail: null,
};

export const modelOf = (catalog: ModelCatalog, model: ModelChoice): ModelOption | null => catalog.models.find((m) => m.id === model) ?? null;

// A model's label: the catalog's, else the fallback table's, else its own id.
export const modelLabel = (model: ModelChoice, catalog: ModelCatalog | null = null): string => (catalog ? modelOf(catalog, model)?.label : undefined) ?? MODEL_LABELS[model] ?? model;

// The effort a model runs with when the one asked for is not one it takes: medium when it has it, else its first;
// null when it takes none.
export function effortFor(option: ModelOption | null, wanted: EffortChoice): EffortChoice | null {
  if (option === null) return wanted;
  if (option.efforts.length === 0) return null;
  if (option.efforts.includes(wanted)) return wanted;
  return option.efforts.includes(DEFAULT_EFFORT) ? DEFAULT_EFFORT : (option.efforts[0] ?? null);
}

// What the catalog refuses about a run's model, effort and mode (empty: allowed). A fallback catalog refuses nothing:
// the shape was checked, and the CLI decides.
export function catalogRefusals(catalog: ModelCatalog, run: { model: ModelChoice; effort?: EffortChoice | null; mode?: ModeChoice | null }): string[] {
  if (catalog.source !== "account") return [];
  const option = modelOf(catalog, run.model);
  if (option === null) return [`${run.model} is not a model this Claude account can use (it can use ${catalog.models.map((m) => m.id).join(", ")})`];
  const errors: string[] = [];
  if (run.effort !== undefined && run.effort !== null && option.efforts.length > 0 && !option.efforts.includes(run.effort)) errors.push(`${option.label} takes the effort levels ${option.efforts.join(", ")}`);
  if (run.mode === "autonomous" && !option.autoMode) errors.push(`Autonomous (Claude Code's auto mode) is not available with ${option.label}: choose Plan, or another model`);
  return errors;
}

// The repository sources a chat can start from; a chat may also start from none.
export const REPOSITORY_SOURCES = ["github", "azure"] as const;

export type RepositorySource = (typeof REPOSITORY_SOURCES)[number];

export const SOURCE_LABELS: Record<RepositorySource, string> = {
  github: "GitHub",
  azure: "Azure DevOps",
};

export const isRepositorySource = (value: unknown): value is RepositorySource =>
  typeof value === "string" && (REPOSITORY_SOURCES as readonly string[]).includes(value);
