// What a run is asked to use: the model, the effort and the mode. Each is a closed list whose values are passed to the
// Claude Code CLI as typed -- the model as the CLI's own alias (`--model`), the effort as its own level (`--effort`),
// the mode as its own permission mode (`--permission-mode`) -- so no dated model id is written here, and a choice the
// account cannot use is refused by the CLI with its own error, which the chat shows as it was said.

// The CLI's aliases for the latest model of each family, in the order the model picker shows them.
export const MODEL_CHOICES = ["opus", "fable", "sonnet", "haiku"] as const;

export type ModelChoice = (typeof MODEL_CHOICES)[number];

export const DEFAULT_MODEL: ModelChoice = "sonnet";

// What each alias means today (the CLI's own table); the label is all the web app shows.
export const MODEL_LABELS: Record<ModelChoice, string> = {
  opus: "Opus 5.5",
  fable: "Fable 5.2",
  sonnet: "Sonnet 5.5",
  haiku: "Haiku 5.5",
};

export const isModelChoice = (value: unknown): value is ModelChoice =>
  typeof value === "string" && (MODEL_CHOICES as readonly string[]).includes(value);

// `--effort`: how thoroughly the model works. Every model above supports every level; `medium` is their default.
export const EFFORT_CHOICES = ["low", "medium", "high", "xhigh", "max"] as const;

export type EffortChoice = (typeof EFFORT_CHOICES)[number];

export const DEFAULT_EFFORT: EffortChoice = "medium";

export const EFFORT_LABELS: Record<EffortChoice, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra",
  max: "Max",
};

export const isEffortChoice = (value: unknown): value is EffortChoice =>
  typeof value === "string" && (EFFORT_CHOICES as readonly string[]).includes(value);

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

// The repository sources a chat can start from; a chat may also start from none.
export const REPOSITORY_SOURCES = ["github", "azure"] as const;

export type RepositorySource = (typeof REPOSITORY_SOURCES)[number];

export const SOURCE_LABELS: Record<RepositorySource, string> = {
  github: "GitHub",
  azure: "Azure DevOps",
};

export const isRepositorySource = (value: unknown): value is RepositorySource =>
  typeof value === "string" && (REPOSITORY_SOURCES as readonly string[]).includes(value);
