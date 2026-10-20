import type { SkillSummary } from "./api/skills.types";

// What "needs attention" MEANS, once. The sidebar badge, the Skills tab and
// the Analytics tile and list all read this table, so the number on a tile is
// always the number of rows its link opens.

// The Agent Skills format caps `description` at 1,024 characters. Nothing in
// the engine enforces it, so it is advice here, never a validation error.
export const DESCRIPTION_LIMIT = 1024;

export interface Attention {
  id: string;
  kind: "invalid" | "long-description";
  /** Short, for a badge in a list row. */
  badge: string;
  title: string;
  details: string[];
}

// Why a skill needs a look, first to last.
const REASONS: { kind: Attention["kind"]; badge: string; when: (s: SkillSummary) => boolean; title: (s: SkillSummary) => string; details: (s: SkillSummary) => string[] }[] = [
  { kind: "invalid", badge: "invalid", when: (s) => !s.valid, title: () => "Does not hold to the skill contract", details: (s) => s.problems },
  {
    kind: "long-description",
    badge: "long description",
    when: (s) => s.description.length > DESCRIPTION_LIMIT,
    title: (s) => `Description is ${s.description.length.toLocaleString()} characters, over the ${DESCRIPTION_LIMIT.toLocaleString()} limit`,
    details: () => [],
  },
];

export const attentionOf = (s: SkillSummary): Attention[] => REASONS.filter((r) => r.when(s)).map((r) => ({ id: s.id, kind: r.kind, badge: r.badge, title: r.title(s), details: r.details(s) }));

export const needsAttention = (s: SkillSummary) => REASONS.some((r) => r.when(s));
