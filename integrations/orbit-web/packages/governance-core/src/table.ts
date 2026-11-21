// THE CONSTITUTION AS A TABLE: what a person ticks in the console instead of writing JSON. One row per action of the
// vocabulary, with two boxes -- "allowed" and "a person approves it first" -- whose three combinations are the three
// effects (neither ticked: denied). The hosts the agent may reach are a list, the obligations and the default decision
// are boxes. A rule the table cannot show -- one that names a principal type or an environment, or a resource other
// than a host the agent may reach -- is kept exactly as written.
//
// Reading a Constitution into the table and writing it back changes nothing the table did not change: a rule keeps its
// place and its id, and a row nobody ticked keeps following the default decision. What the table writes is checked by
// the same checkConstitution as any document, on the server.
import type { Constitution, DefaultDecision, Obligations, Rule } from "./constitution.js";
import { ACTION_KINDS, strictest, type ActionKind, type Effect } from "./vocabulary.js";

export interface ActionRow {
  action: ActionKind;
  effect: Effect;
  // Whether a rule says it; otherwise the row follows the default decision.
  stated: boolean;
}

export interface ConstitutionTable {
  defaultDecision: DefaultDecision;
  // One per action of the vocabulary, in its order.
  rows: ActionRow[];
  // The hosts (`host:port`) an allow rule of network.egress names, in the order they are written.
  egressHosts: string[];
  obligations: Obligations;
  // The rules the table does not show, kept as written.
  kept: Rule[];
}

// The two boxes of a row, and the effect they say.
export const effectOf = (allowed: boolean, approval: boolean): Effect => (!allowed ? "deny" : approval ? "require_approval" : "allow");
export const boxesOf = (effect: Effect): { allowed: boolean; approval: boolean } => ({ allowed: effect !== "deny", approval: effect === "require_approval" });

const plain = (r: Rule): boolean => r.resource === undefined && r.principalType === undefined && r.environment === undefined;
const isHost = (r: Rule): boolean => r.action === "network.egress" && r.effect === "allow" && r.resource !== undefined && !r.resource.endsWith("*") && r.principalType === undefined && r.environment === undefined;
const shownAs = (r: Rule): "row" | "host" | "kept" => (plain(r) ? "row" : isHost(r) ? "host" : "kept");

function rowOf(c: Constitution, action: ActionKind): ActionRow {
  const said = c.rules.filter((r) => r.action === action && plain(r)).map((r) => r.effect);
  return said.length === 0 ? { action, effect: c.defaults.decision, stated: false } : { action, effect: said.reduce(strictest), stated: true };
}

export function tableOf(c: Constitution): ConstitutionTable {
  return {
    defaultDecision: c.defaults.decision,
    rows: ACTION_KINDS.map((action) => rowOf(c, action)),
    egressHosts: c.rules.filter((r) => shownAs(r) === "host").map((r) => r.resource as string),
    obligations: { ...c.obligations },
    kept: c.rules.filter((r) => shownAs(r) === "kept"),
  };
}

// A host the agent may reach, as a person types it: `name:port`, lower case. null when it is not one.
export function egressHostOf(text: string): string | null {
  const host = text.trim().toLowerCase();
  const m = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*):(\d{1,5})$/.exec(host);
  const port = m === null ? 0 : Number(m[5]);
  return port >= 1 && port <= 65535 ? host : null;
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56);

function freshId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

// The Constitution the table says, written over the one it was read from.
export function withTable(c: Constitution, t: ConstitutionTable): Constitution {
  const rows = new Map(t.rows.map((r) => [r.action, r]));
  const wanted = new Set(t.egressHosts);
  const written = new Set<ActionKind>();
  const rules: Rule[] = [];
  for (const r of c.rules) {
    const shown = shownAs(r);
    const row = rows.get(r.action);
    if (shown === "kept") rules.push(r);
    else if (shown === "host" && wanted.delete(r.resource as string)) rules.push(r);
    else if (shown === "row" && row?.stated === true && !written.has(r.action)) {
      written.add(r.action);
      rules.push({ ...r, effect: row.effect });
    }
  }
  const taken = new Set(rules.map((r) => r.id));
  for (const row of t.rows) if (row.stated && !written.has(row.action)) rules.push({ id: freshId(slug(row.action), taken), action: row.action, effect: row.effect });
  for (const host of wanted) rules.push({ id: freshId(`egress-${slug(host)}`, taken), action: "network.egress", resource: host, effect: "allow" });
  return { ...c, defaults: { decision: t.defaultDecision }, obligations: { ...t.obligations }, rules };
}
