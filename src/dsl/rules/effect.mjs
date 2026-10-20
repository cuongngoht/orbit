// The map already knows what a control does below the UI: graph/effects.json
// records the call it makes and the table it writes. The case then TYPES IT
// AGAIN -- `match: "api/things", method: "POST"` is the effect's `api` re-keyed,
// and `FROM Things` is its `layers.sql[].table`.
//
// Two copies of one fact drift, and this drift is SILENT: a case asserting the
// wrong endpoint still passes, because the wrong endpoint is usually also a real
// request the page made. Nothing fails; the case simply stops being about what
// it says it is about. So the map is held against the case.
//
// What the map does not know stays the case's own. The map says which TABLE, the
// case says which ROW -- a predicate cannot be derived, and a verdict that was
// guessed is not a verdict.
import { CORE } from "../registry.mjs";

export function effectFindings(c, graph, dsl = CORE) {
  const steps = c.steps ?? [];
  return steps.flatMap((st, i) => oneStep(c, steps, st, i, graph, dsl));
}

function oneStep(c, steps, st, i, graph, dsl) {
  const fx = drivenEffect(steps, i, graph, dsl);
  if (!fx) return [];
  const at = `${c.id} step ${i + 1} (${st.do})`;
  return [...(st.match ? callAgrees(at, st, fx) : []), ...(st.query ? tableAgrees(at, st, fx) : [])];
}

// The control the verdict is about: the most recent step that ACTED on a named
// edge. `api` asserts a request made since the last action, so that action is
// the one whose effect record applies.
function drivenEffect(steps, i, graph, dsl) {
  const changes = dsl.verbsWhere("changes");
  const acted = steps.slice(0, i).reverse().find((s) => s.on && changes.has(s.do));
  return acted ? graph.effectOn.get(acted.on) : null;
}

function callAgrees(at, st, fx) {
  if (!fx.api) return [`${at}: the map says ${fx.on} makes no backend call, so there is no request to match (graph/effects.json)`];
  const [method, path] = split(fx.api);
  return [...methodAgrees(at, st, method, fx), ...pathAgrees(at, st, path, fx)];
}

const split = (api) => { const [head, ...rest] = String(api).trim().split(/\s+/); return [head, rest.join(" ")]; };

const methodAgrees = (at, st, method, fx) =>
  (st.method && method && st.method !== method ? [`${at}: asserts ${st.method} but the map says ${fx.on} calls ${method} (graph/effects.json)`] : []);

// `match` is a REGEX, so the question is whether it matches what the map says
// the call IS -- not whether the two strings are equal. A broad pattern always
// passes; only a genuinely different one is caught. An unparseable pattern is
// semantic.mjs's finding, not this one's.
//
// A `${PARAM}` in the pattern is a value the run fills in, and the map writes the same segment as a template
// (`api/items/{id}`): so a placeholder stands for one segment of the path, whatever the map called it.
const PLACEHOLDER = /\$\{[A-Za-z_][A-Za-z0-9_]*\}/g;

const templated = (match) => String(match).replace(PLACEHOLDER, "[^/]+");

function pathAgrees(at, st, path, fx) {
  if (!path || !parses(templated(st.match))) return [];
  return new RegExp(templated(st.match)).test(path) ? [] : [`${at}: match /${st.match}/ does not match ${path}, the call the map says ${fx.on} makes (graph/effects.json)`];
}

const parses = (p) => { try { new RegExp(p); return true; } catch { return false; } };

function tableAgrees(at, st, fx) {
  const tables = (fx.layers?.sql ?? []).map((t) => t.table).filter(Boolean);
  if (!tables.length) return [];
  return tables.some((t) => mentions(st.query, t)) ? [] : [`${at}: names none of ${tables.join(", ")} — the table(s) the map says ${fx.on} writes (graph/effects.json)`];
}

const mentions = (query, table) => String(query).toLowerCase().includes(String(table).toLowerCase());
