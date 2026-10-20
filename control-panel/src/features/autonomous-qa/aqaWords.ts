import type { AqaOverview, EnvironmentKind, ModeId, Outcome, Unavailable } from "./aqa.types";

export const AQA_PATH = "/autonomous-qa";

export const ENVIRONMENT_KINDS: readonly EnvironmentKind[] = ["test", "staging", "development", "production"];

// Observe needs only the environment itself; every other mode is a person's
// approval, per environment -- the gate table in src/investigation/gates.mjs.
export const APPROVABLE: readonly ModeId[] = ["explore-write", "security-test", "regression"];

export const OUTCOME_LABEL: Record<Outcome, string> = {
  CONFIRMED_DEFECT: "confirmed",
  SUSPECTED_DEFECT: "suspected",
  REQUIRES_REQUIREMENT: "needs a requirement",
  INCONCLUSIVE: "inconclusive",
  BLOCKED: "blocked",
  OBSERVED_EXPECTED_BEHAVIOR: "as expected",
};

export const OUTCOME_ORDER: readonly Outcome[] = ["CONFIRMED_DEFECT", "SUSPECTED_DEFECT", "REQUIRES_REQUIREMENT", "INCONCLUSIVE", "BLOCKED", "OBSERVED_EXPECTED_BEHAVIOR"];

export const isAvailable = (view: AqaOverview | Unavailable | undefined): view is AqaOverview => view !== undefined && view.available === true;

export const listOf = (text: string): string[] => text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
