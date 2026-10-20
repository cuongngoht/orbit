import type { SkillSummary } from "./api/skills.types";
import { needsAttention } from "./attention";

// The order cards appear in. A table can be scanned down a column; a grid is
// read like a page, left to right, top to bottom -- so the first row of cards
// is what a person sees before deciding whether to look further.
//
// Returns a NEW array: `skills` is TanStack Query's cached data, and sorting it
// in place would reorder the cache every other page reads.
export function orderSkills(skills: SkillSummary[]): SkillSummary[] {
  // TODO(you): decide what the first row should be.
  void needsAttention;
  return [...skills];
}
