// JSON values as JSON Schema reads them: their type, their equality, a pointer into them, and how many decimal places
// a number needs. Equality is the canonical spelling's, so {a, b} equals {b, a}, 1 equals 1.0, and false is never 0.
import { canonicalJson } from "../../../src/hash.mjs";

export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const isSchemaValue = (v) => typeof v === "boolean" || isObject(v);
export const keyOf = (v) => canonicalJson(v);
export const sameJson = (a, b) => keyOf(a) === keyOf(b);

const TYPE_OF = [
  { test: (v) => v === null, name: "null" },
  { test: (v) => Array.isArray(v), name: "array" },
  { test: (v) => typeof v === "object", name: "object" },
  { test: (v) => Number.isInteger(v), name: "integer" },
  { test: (v) => typeof v === "number", name: "number" },
  { test: (v) => typeof v === "string", name: "string" },
  { test: (v) => typeof v === "boolean", name: "boolean" },
];

export const jsonType = (v) => TYPE_OF.find((t) => t.test(v))?.name ?? "unknown";

// RFC 6901: `~1` is unescaped before `~0`, so the token `~01` reads as `~1`.
const unescapeToken = (t) => t.replace(/~1/g, "/").replace(/~0/g, "~");
const escapeToken = (t) => String(t).replace(/~/g, "~0").replace(/\//g, "~1");

export const pointerTokens = (fragment) => fragment.split("/").slice(1).map(unescapeToken);
export const childPath = (path, key) => `${path}/${escapeToken(key)}`;

const stepInto = (cur, token) => (cur !== null && typeof cur === "object" && Object.hasOwn(cur, token) ? cur[token] : undefined);

export function atPointer(doc, tokens) {
  let cur = doc;
  for (const token of tokens) cur = stepInto(cur, token);
  return cur;
}

// How many decimal places a number needs, from its own shortest spelling: `1e-8` needs 8, `0.0075` needs 4, `1e+21` 0.
export function decimals(n) {
  const [mantissa, exponent = "0"] = String(n).split("e");
  const places = (mantissa.split(".")[1] ?? "").length - Number(exponent);
  return Math.max(0, places);
}

// Whether x is an integer multiple of m. Both are scaled to integers by the places they need, which is exact while the
// scaled values stay safe integers; beyond that the plain quotient decides, and a quotient that overflows is no multiple.
export function isMultiple(x, m) {
  const places = Math.max(decimals(x), decimals(m));
  const sx = Math.round(x * 10 ** places);
  const sm = Math.round(m * 10 ** places);
  return Number.isSafeInteger(sx) && Number.isSafeInteger(sm) ? sx % sm === 0 : Number.isInteger(x / m);
}
