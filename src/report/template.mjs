// A template is text with {{tags}}, rendered against plain data. It exists so the
// report's markup lives in a FILE somebody can open, edit and restyle, instead of
// inside string literals in a .mjs nobody opens to change a colour.
//
// Escaping is the DEFAULT and not an option: {{x}} is escaped, {{{x}}} is not.
// Every value in a report came from a product's own screen or its own database,
// so a renderer that escapes only when asked will one day meet a row containing
// <script>. Here that decision is made once, for every value, instead of at the
// fifty-seven places the markup used to interpolate one.
//
// The subset is deliberate: values, sections and inverted sections. No partials,
// no helpers, no expressions -- a template language that can compute is a second
// program in a file nothing tests.
import { esc } from "../case-block.mjs";

const TAG = /\{\{\{\s*([\w.]+)\s*\}\}\}|\{\{([#^/]?)\s*([\w.]+)\s*\}\}/g;
const KIND = { "#": "open", "^": "inv", "/": "close", "": "var" };

export const render = (text, data) => emit(parse(text), [data]);

function* lex(text) {
  let at = 0;
  for (const m of text.matchAll(TAG)) {
    yield* pair(text, at, m);
    at = m.index + m[0].length;
  }
  yield { k: "text", v: text.slice(at) };
}

function* pair(text, at, m) {
  yield { k: "text", v: text.slice(at, m.index) };
  yield m[1] ? { k: "raw", name: m[1] } : { k: KIND[m[2]], name: m[3] };
}

function parse(text) {
  const root = { kids: [] };
  const stack = [root];
  for (const t of lex(text)) place(stack, t);
  return root.kids;
}

function place(stack, t) {
  const top = stack[stack.length - 1];
  if (t.k === "close") return stack.pop();
  if (t.k === "open" || t.k === "inv") return opened(stack, top, t);
  top.kids.push(t);
}

function opened(stack, top, t) {
  const node = { ...t, kids: [] };
  top.kids.push(node);
  stack.push(node);
}

const emit = (nodes, scope) => nodes.map((n) => one(n, scope)).join("");

function one(n, scope) {
  if (n.k === "text") return n.v;
  if (n.k === "var") return esc(look(scope, n.name));
  if (n.k === "raw") return String(look(scope, n.name) ?? "");
  return section(n, scope);
}

// An array repeats the block once per item; anything else truthy renders it once
// with that value pushed on the scope, which is what makes {{#failed}} read as
// "if there was a failure" and {{#asks}} as "for each ask".
function section(n, scope) {
  const v = look(scope, n.name);
  if (n.k === "inv") return filled(v) ? "" : emit(n.kids, scope);
  if (Array.isArray(v)) return v.map((item) => emit(n.kids, [...scope, item])).join("");
  return filled(v) ? emit(n.kids, [...scope, v]) : "";
}

const filled = (v) => (Array.isArray(v) ? v.length > 0 : Boolean(v));

// The INNERMOST scope that actually has the name wins, so a block can read a
// field of its own item and a field of the page in the same line. A pushed
// string or boolean holds no names and is simply looked past.
function look(scope, name) {
  if (name === ".") return scope[scope.length - 1];
  const hit = scope.findLast((s) => s && typeof s === "object" && name in s);
  return hit ? hit[name] : undefined;
}

// Declared in src/case-block.mjs, because the case block a report carries has
// to be UNescaped by exactly this table's inverse to be runnable again.
export { esc } from "../case-block.mjs";
