// The model choices Orbit Web offers. They are the CLI's own aliases, passed to `claude --model` as typed: the CLI
// resolves an alias to whatever model it currently means, so no dated model id is written here, and a model the
// account cannot use is refused by the CLI with its own error, which the chat shows as it was said.
export const MODEL_CHOICES = ["sonnet", "opus", "haiku"] as const;

export type ModelChoice = (typeof MODEL_CHOICES)[number];

export const DEFAULT_MODEL: ModelChoice = "sonnet";

export const MODEL_LABELS: Record<ModelChoice, string> = {
  sonnet: "Sonnet",
  opus: "Opus",
  haiku: "Haiku",
};

export const isModelChoice = (value: unknown): value is ModelChoice =>
  typeof value === "string" && (MODEL_CHOICES as readonly string[]).includes(value);
