// Identity and reference: an id means one thing, and everything that points at
// an id points at something that exists.
//
// These are the findings a plan cannot survive: a scenario covering AC7 when the
// criteria stop at AC5 reads as coverage in every report built on it, and a
// dependency cycle is an order nobody can run. Both are DEMONSTRABLE, so both
// are errors rather than advice.
//
// Which collections hold ids is derived: every container whose member table
// declares an `id`. A new kind of member is covered by its table alone.
import { memberRef } from "../../constraints.mjs";
import { DEFINITIONS, PLAN_FIELDS } from "../fields.mjs";
import { error } from "../finding.mjs";

const nameFrom = (ref) => (typeof ref === "string" ? ref.split("/").pop() : null);

const ID_CONTAINERS = Object.entries(PLAN_FIELDS)
  .map(([k, spec]) => [k, nameFrom(memberRef(spec))])
  .filter(([, name]) => name && "id" in (DEFINITIONS[name]?.table ?? {}))
  .map(([k]) => k);

// Every reference in the plan, as data: where it lives, and what it may name.
// A new pointer is a row, not a function.
const POINTERS = [
  { from: "scenarios", field: "covers", to: ["criteria"], says: "covers" },
  { from: "scenarios", field: "dependsOn", to: ["scenarios"], says: "depends on" },
  { from: "scenarios", field: "checks", to: ["manual"], says: "hands over to" },
  { from: "manual", field: "covers", to: ["criteria", "scenarios"], says: "covers" },
  { from: "questions", field: "blocks", to: ["criteria", "scenarios"], says: "blocks" },
];

export const idFindings = (p) => [...duplicateFindings(p), ...danglingFindings(p), ...sourceFindings(p), ...cycleFindings(p)];

const membersOf = (p, k) => (Array.isArray(p[k]) ? p[k].filter((m) => m && typeof m === "object") : []);

const idsIn = (p, keys) => new Set(keys.flatMap((k) => membersOf(p, k).map((m) => m.id)).filter((v) => typeof v === "string"));

// Across the WHOLE plan, not per collection: `covers` and `blocks` point at more
// than one kind of member, so an id shared by a criterion and a scenario makes
// every reference to it ambiguous -- and a report built on it picks one.
function duplicateFindings(p) {
  const seen = new Map();
  for (const k of ID_CONTAINERS) for (const m of membersOf(p, k)) seen.set(m.id, [...(seen.get(m.id) ?? []), k]);
  const twice = [...seen].filter(([key, where]) => typeof key === "string" && where.length > 1);
  return twice.map(([key, where]) => error(p.id, `${key} is used ${where.length} times (${where.join(", ")}) — an id has to mean one thing`));
}

const danglingFindings = (p) => POINTERS.flatMap((r) => pointerFindings(p, r));

function pointerFindings(p, r) {
  const known = idsIn(p, r.to);
  const rows = membersOf(p, r.from).flatMap((m) => refsOf(m, r.field).map((v) => [m, v]));
  return rows.filter(([, v]) => !known.has(v)).map(([m, v]) => error(`${p.id} ${m.id}`, `${r.says} ${v}, which no ${r.to.join(" or ")} declares`));
}

const refsOf = (m, field) => (Array.isArray(m[field]) ? m[field].filter((v) => typeof v === "string") : []);

// A criterion citing a source that is not listed cannot be traced back to
// anything, so the plan's own claim about where it came from is unverifiable.
function sourceFindings(p) {
  const known = idsIn(p, ["sources"]);
  const cited = membersOf(p, "criteria").filter((c) => typeof c.source === "string" && !known.has(c.source));
  return cited.map((c) => error(`${p.id} ${c.id}`, `cites source ${c.source}, which the plan does not list`));
}

function cycleFindings(p) {
  const edges = new Map(membersOf(p, "scenarios").map((s) => [s.id, refsOf(s, "dependsOn")]));
  const found = [...edges.keys()].map((id) => cycleFrom(edges, id)).filter(Boolean);
  return dedupe(found).map((path) => error(p.id, `dependsOn forms a cycle: ${path.join(" -> ")} — nothing can run first`));
}

// Depth-first from one scenario, returning the loop it closes. Enough to name
// the cycle; the rest of the graph is somebody else's walk.
function cycleFrom(edges, start) {
  const path = [];
  const seen = new Set();
  return walk(edges, start, path, seen);
}

function walk(edges, id, path, seen) {
  if (path.includes(id)) return [...path.slice(path.indexOf(id)), id];
  if (seen.has(id)) return null;
  seen.add(id);
  path.push(id);
  return closed(edges, id, path, seen);
}

function closed(edges, id, path, seen) {
  const hit = (edges.get(id) ?? []).map((next) => walk(edges, next, path, seen)).find(Boolean);
  path.pop();
  return hit ?? null;
}

// One loop reported once, however many of its members you start from: the same
// cycle walked from S1 and from S2 is the same cycle, so the key is the SET of
// members and not the order they happened to be visited in.
const dedupe = (paths) => [...new Map(paths.map((p) => [[...new Set(p)].sort().join(","), p])).values()];
