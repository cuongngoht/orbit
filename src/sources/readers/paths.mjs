// Reading a tool's answer by DATA: dotted paths and placeholders, never code.
//
// A provider's mapping (which tool, with which arguments, and where in its answer
// the title is) is a row of data in a descriptor. This is the whole language that
// data is written in, and it is deliberately small: a path walks own properties and
// returns undefined for anything missing, and a placeholder names one of four
// values the engine knows. Nothing here evaluates anything, so a descriptor -- or
// an answer -- can be wrong but cannot run.
import { Refused } from "../../errors.mjs";

// A path never walks into the machinery every object has.
const HIDDEN = new Set(["__proto__", "constructor", "prototype"]);

const step = (node, key) => (node !== null && typeof node === "object" && !HIDDEN.has(key) && Object.hasOwn(node, key) ? node[key] : undefined);

// `a.b.0.c` -- own properties, array indexes by number, undefined when absent.
export const pick = (value, path) => String(path).split(".").reduce(step, value);

const NAMES = "organization|project|id|ref";
const WHOLE = new RegExp(`^\\{(${NAMES})(:int)?\\}$`);
const EMBEDDED = new RegExp(`\\{(${NAMES})\\}`, "g");

function integer(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Refused(`{${name}:int} needs a whole number, and this item's ${name} is not one`);
  return n;
}

// `{id}` is text. `{id:int}` is a whole number, when the whole value is that
// placeholder -- some tools want 88 and not "88". A name nobody declared stays
// literal, and a declared one the identity has no value for is empty.
export function fill(template, values) {
  const whole = WHOLE.exec(template);
  if (whole) return whole[2] ? integer(values[whole[1]], whole[1]) : String(values[whole[1]] ?? "");
  return template.replace(EMBEDDED, (_m, name) => String(values[name] ?? ""));
}

export const fillArgs = (args, values) => Object.fromEntries(Object.entries(args ?? {}).map(([k, v]) => [k, typeof v === "string" ? fill(v, values) : v]));

const shaped = (element, spec) => {
  if (spec === ".") return element;
  return typeof spec === "string" ? pick(element, spec) : Object.fromEntries(Object.entries(spec).map(([k, p]) => [k, pick(element, p)]));
};

// A map value is a path, or `{ each: <path to a list>, pick: <path | {field: path}> }`
// to project a list: `pick: "."` keeps a list of plain values as it is.
function projected(payload, spec) {
  if (typeof spec === "string") return pick(payload, spec);
  const list = pick(payload, spec.each);
  return Array.isArray(list) ? list.map((element) => shaped(element, spec.pick)) : undefined;
}

// The answer, read into the fields the contract names. What a path did not find is
// absent, not null: a field nobody could fill is a field the reader had nothing for.
export const mapped = (payload, map) => Object.fromEntries(Object.entries(map).map(([k, spec]) => [k, projected(payload, spec)]).filter(([, v]) => v !== undefined));

const PATH = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

export const safePath = (p) => typeof p === "string" && PATH.test(p) && !p.split(".").some((k) => HIDDEN.has(k));

// Does a map value use only the two forms, and only safe paths.
export function specProblems(spec, where) {
  if (typeof spec === "string") return safePath(spec) ? [] : [`${where}: "${String(spec).slice(0, 40)}" is not a plain dotted path`];
  if (typeof spec !== "object" || spec === null || !safePath(spec.each)) return [`${where}: a projection needs "each" naming a dotted path`];
  return pickProblems(spec.pick, where);
}

function pickProblems(pickSpec, where) {
  if (pickSpec === ".") return [];
  if (typeof pickSpec === "string") return safePath(pickSpec) ? [] : [`${where}: pick "${pickSpec.slice(0, 40)}" is not a plain dotted path`];
  if (typeof pickSpec !== "object" || pickSpec === null) return [`${where}: a projection needs "pick"`];
  return Object.entries(pickSpec).filter(([, p]) => !safePath(p)).map(([k]) => `${where}: pick.${k} is not a plain dotted path`);
}
