// AN OVERRIDE AS ROWS: one per action, each saying what the override does to it in this one chat or research
// workspace -- nothing (the account's policy decides), "you approve it first", or "denied". An override only narrows, so
// there is no "allowed" row: an allow in an override changes nothing (governance-core takes the strictest of every
// layer). A rule the rows cannot show -- one naming a resource, a kind of principal or an environment, or an allow
// somebody wrote -- is kept exactly as written. Reading rules into rows and writing them back changes nothing the rows
// did not change: a rule keeps its place and its id.
import { ACTION_KINDS, type ActionKind, type Rule } from "@orbit-web/governance-core";

export const NARROWINGS = ["inherit", "require_approval", "deny"] as const;
export type Narrowing = (typeof NARROWINGS)[number];

export interface OverrideRow {
  action: ActionKind;
  narrowing: Narrowing;
}

export interface OverrideRows {
  rows: OverrideRow[];
  // The rules the rows do not show, kept as written.
  kept: Rule[];
}

const narrows = (r: Rule): boolean => r.resource === undefined && r.principalType === undefined && r.environment === undefined && r.effect !== "allow";

function rowOf(rules: readonly Rule[], action: ActionKind): OverrideRow {
  const said = rules.filter((r) => r.action === action && narrows(r));
  if (said.length === 0) return { action, narrowing: "inherit" };
  return { action, narrowing: said.some((r) => r.effect === "deny") ? "deny" : "require_approval" };
}

export function overrideRowsOf(rules: readonly Rule[]): OverrideRows {
  return { rows: ACTION_KINDS.map((action) => rowOf(rules, action)), kept: rules.filter((r) => !narrows(r)) };
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56);

function freshId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

// The override's rules the rows say, written over the rules they were read from.
export function withOverrideRows(rules: readonly Rule[], rows: readonly OverrideRow[]): Rule[] {
  const wanted = new Map(rows.map((r) => [r.action, r.narrowing]));
  const written = new Set<ActionKind>();
  const out: Rule[] = [];
  for (const r of rules) {
    const narrowing = wanted.get(r.action);
    if (!narrows(r)) out.push(r);
    else if (narrowing !== undefined && narrowing !== "inherit" && !written.has(r.action)) {
      written.add(r.action);
      out.push({ ...r, effect: narrowing });
    }
  }
  const taken = new Set(out.map((r) => r.id));
  for (const row of rows) if (row.narrowing !== "inherit" && !written.has(row.action)) out.push({ id: freshId(slug(row.action), taken), action: row.action, effect: row.narrowing });
  return out;
}
