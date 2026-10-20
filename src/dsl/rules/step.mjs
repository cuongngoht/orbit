// Rules on one step: the verb is known, every field is one the verb owns, what
// the verb needs is present, names resolve, params are declared.
import { constraintFindings } from "../../constraints.mjs";
import { placeholders } from "../interpolate.mjs";
import { CORE } from "../registry.mjs";
import { selectorOf } from "../selector.mjs";

export function stepFindings(c, st, i, graph, binds, dsl = CORE) {
  const at = `${c.id} step ${i + 1} (${st.do})`;
  const verb = dsl.verb(st.do);
  if (!verb) return [`${at}: unknown verb`];
  const shape = [...fieldFindings(at, st, verb, dsl), ...constraintFindings(dsl.fields(), st, at)];
  return [...shape, ...needFindings(at, st, verb, graph), ...nameFindings(at, st, graph), ...paramFindings(at, st, binds, i)];
}

// A field the verb does not own is either a typo or a field that belongs on
// another verb -- say which, from the table, instead of one rule per field.
function fieldFindings(at, st, verb, dsl) {
  const allowed = new Set([...dsl.commonFields(), ...verb.fields]);
  return Object.keys(st).filter((k) => !allowed.has(k)).map((k) => misplaced(at, k, dsl));
}

function misplaced(at, k, dsl) {
  const owners = dsl.ownersOf(k);
  return owners.length ? `${at}: "${k}" belongs on a ${owners.join(" or ")} step` : `${at}: unknown field "${k}"`;
}

function needFindings(at, st, verb, graph) {
  return verb.needs.flatMap((n) => (Array.isArray(n) ? oneOf(at, st, n, graph) : (st[n] === undefined ? [`${at}: ${verb.name} without ${n}`] : [])));
}

// "one of on/selector" is only satisfied by a selector that can actually be
// driven; "one of screen/url" only by a screen the map knows.
function oneOf(at, st, alternatives, graph) {
  if (alternatives.includes("selector")) return selectorOf(st, graph) ? [] : [`${at}: no usable selector (${st.on ?? "literal"})`];
  if (alternatives.includes("url")) return st.url || graph.screens.has(st.screen) ? [] : [`${at}: goto needs a known screen or a url`];
  return alternatives.some((k) => st[k] !== undefined) ? [] : [`${at}: needs one of ${alternatives.join("/")}`];
}

const nameFindings = (at, st, graph) => (st.on && !graph.edgeOn.has(st.on) ? [`${at}: names unknown control ${st.on}`] : []);

// Two different mistakes, two different sentences: a name nothing ever binds,
// and a name bound by a step FURTHER DOWN -- which at run time is a hole, not a
// value, and reads as a typo until someone is told what it really is.
function paramFindings(at, st, binds, i) {
  const visible = binds.at[i] ?? binds.all;
  const used = [...new Set(placeholders(JSON.stringify(st)))];
  return used.filter((p) => !visible.has(p)).map((p) => unbound(at, p, binds.all));
}

const unbound = (at, p, all) =>
  (all.has(p)
    ? `${at}: uses \${${p}}, which a LATER step binds — a step can only use a value an earlier step produced`
    : `${at}: uses undeclared param \${${p}}`);
