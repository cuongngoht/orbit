// What the Analytics page says about the SKILL CATALOG, derived -- pure -- from
// the skills as the server read them off the disk: what each skill costs a
// session, what it may do without asking, and what needs a look. Which skill
// ran, and how often, is not here and is never mixed into these numbers: it is
// the session trail's, read by usage/UsageSection.tsx off the server's usage
// projection.
import type { SkillSummary } from "../skills/api/skills.types";
import { attentionOf } from "../skills/attention";

export { DESCRIPTION_LIMIT } from "../skills/attention";
export type { Attention } from "../skills/attention";

// What a skill may do without a permission prompt, read off its `allowed-tools`.
// A column per row, so the matrix, its counts and its tests share one table.
export const CAPABILITIES = [
  { key: "reads", label: "Read files", tools: "Read, Glob, Grep", matches: /^(Read|Glob|Grep)\b/ },
  { key: "edits", label: "Edit files", tools: "Edit, Write, NotebookEdit", matches: /^(Edit|Write|NotebookEdit)\b/ },
  { key: "runs", label: "Run commands", tools: "Bash(…)", matches: /^Bash\b/ },
  { key: "asks", label: "Ask you", tools: "AskUserQuestion", matches: /^AskUserQuestion\b/ },
] as const;

export type Capability = (typeof CAPABILITIES)[number]["key"];

export const capabilitiesOf = (s: SkillSummary): Capability[] => CAPABILITIES.filter((c) => s.allowedTools.some((t) => c.matches.test(t))).map((c) => c.key);

export interface Bar {
  id: string;
  value: number;
}

const sum = (skills: SkillSummary[], of: (s: SkillSummary) => number) => skills.reduce((n, s) => n + of(s), 0);

const barsOf = (skills: SkillSummary[], of: (s: SkillSummary) => number): Bar[] => skills.map((s) => ({ id: s.id, value: of(s) })).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));

export function analyse(skills: SkillSummary[]) {
  const sizes = barsOf(skills, (s) => s.skillBytes / 1024);
  return {
    total: skills.length,
    userInvocable: skills.filter((s) => s.userInvocable).length,
    attention: skills.flatMap(attentionOf),
    descriptionChars: sum(skills, (s) => s.description.length),
    files: sum(skills, (s) => s.files),
    bytes: sum(skills, (s) => s.bytes),
    /** In KB, like `sizes`: the one the SKILL.md chart puts first. */
    largest: sizes[0] ?? null,
    descriptions: barsOf(skills, (s) => s.description.length),
    sizes,
    permissions: permissionsOf(skills),
    recent: [...skills].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)).slice(0, 5),
  };
}

export type Analysis = ReturnType<typeof analyse>;

// Most able first: a skill that may edit files and run commands is the one a
// reviewer reads before the others.
function permissionsOf(skills: SkillSummary[]) {
  const rows = skills.map((s) => ({ id: s.id, capabilities: capabilitiesOf(s), tools: s.allowedTools }));
  return rows.sort((a, b) => b.capabilities.length - a.capabilities.length || a.id.localeCompare(b.id));
}

// Axis ticks at clean numbers: the smallest "nice" step for which four steps
// cover the largest value plus a little air for the value label at the tip.
const NICE = [1, 2, 2.5, 3, 4, 5, 6, 8, 10];

export function scaleFor(values: number[], headroom = 1.12): { max: number; ticks: number[] } {
  const top = Math.max(1, ...values) * headroom;
  const raw = top / 4;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = NICE.map((n) => n * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  return { max: step * 4, ticks: [0, 1, 2, 3, 4].map((i) => step * i) };
}
