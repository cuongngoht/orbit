import type { SkillSummary } from "./api/skills.types";
import { needsAttention } from "./attention";

// Which slice of the catalog the Skills page shows. A row per filter, so the
// tabs, their counts and the URL (`?show=…`) all come from one table -- and so
// Analytics can link straight to "the skills that need attention".
export const SKILL_FILTERS = [
  { value: "all", label: "All", keeps: () => true },
  { value: "user", label: "User-invocable", keeps: (s: SkillSummary) => s.userInvocable },
  { value: "model", label: "Model-only", keeps: (s: SkillSummary) => !s.userInvocable },
  { value: "attention", label: "Needs attention", keeps: needsAttention },
] as const;

export type SkillFilter = (typeof SKILL_FILTERS)[number]["value"];

export const filterOf = (value: string | null): SkillFilter => SKILL_FILTERS.find((f) => f.value === value)?.value ?? "all";

export function visibleSkills(skills: SkillSummary[], filter: SkillFilter, query: string): SkillSummary[] {
  const keeps = SKILL_FILTERS.find((f) => f.value === filter)?.keeps ?? (() => true);
  const needle = query.trim().toLowerCase();
  return skills.filter((s) => keeps(s) && (!needle || `${s.name} ${s.description}`.toLowerCase().includes(needle)));
}
