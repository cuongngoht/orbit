// The schema DOCUMENT as resources: the base URI every schema object is read under, every embedded resource by the URI
// its `$id` gives it, and what a `$ref` points at. Only what the document itself holds can be referenced: a remote
// `$ref` is never fetched, a plain-name fragment needs `$anchor`, and each is a gap that says so.
import { META, SUBSCHEMAS } from "./vocab.mjs";
import { atPointer, childPath, isObject, isSchemaValue, pointerTokens } from "./json.mjs";

export const DEFAULT_BASE = "https://schema.orbit.invalid/root.json";

const SPREAD = {
  one: (v, path) => [{ schema: v, path }],
  list: (v, path) => (Array.isArray(v) ? v.map((s, i) => ({ schema: s, path: childPath(path, i) })) : []),
  map: (v, path) => (isObject(v) ? Object.entries(v).map(([k, s]) => ({ schema: s, path: childPath(path, k) })) : []),
};

// The subschemas a schema object holds, each with the schema path it sits at; `skip` leaves positions out.
export const children = (schema, path, skip = []) => Object.entries(SUBSCHEMAS).filter(([key]) => Object.hasOwn(schema, key) && !skip.includes(key)).flatMap(([key, kind]) => SPREAD[kind](schema[key], childPath(path, key)));

const parsed = (ref, base) => {
  try { return new URL(ref, base); } catch { return null; }
};

const decoded = (fragment) => {
  try { return decodeURIComponent(fragment); } catch { return null; }
};

// A URI reference resolved against a base, split into the document it names and the fragment inside it.
export function resolveUri(ref, base) {
  const url = parsed(ref, base);
  if (!url) return null;
  const at = url.href.indexOf("#");
  return at < 0 ? { document: url.href, fragment: "" } : { document: url.href.slice(0, at), fragment: url.href.slice(at + 1) };
}

export function indexOf(root, limits) {
  const index = { bases: new Map(), resources: new Map([[DEFAULT_BASE, root]]), gaps: [], limits };
  walk(index, root, DEFAULT_BASE, "#", 0);
  return index;
}

function walk(index, schema, base, path, depth) {
  if (!isObject(schema) || index.bases.has(schema)) return;
  if (depth > index.limits.depth) return index.gaps.push({ keyword: "limits", path, why: `the schema nests deeper than ${index.limits.depth} levels` });
  const own = baseOf(index, schema, base, path);
  index.bases.set(schema, own);
  children(schema, path).forEach((c) => walk(index, c.schema, own, c.path, depth + 1));
}

function baseOf(index, schema, base, path) {
  if (typeof schema.$id !== "string") return base;
  const id = resolveUri(schema.$id, base);
  if (!id || id.fragment) return idGap(index, path, base, id ? "an $id with a fragment is an anchor, which is not supported" : "the $id is not a URI reference");
  index.resources.set(id.document, schema);
  return id.document;
}

const idGap = (index, path, base, why) => {
  index.gaps.push({ keyword: "$id", path: childPath(path, "$id"), why });
  return base;
};

// What a `$ref` written in `schema` points at: `{schema}`, or `{why}` when it cannot be followed here.
export function targetOf(index, schema) {
  const uri = resolveUri(schema.$ref, index.bases.get(schema) ?? DEFAULT_BASE);
  if (!uri) return { why: "the $ref is not a URI reference" };
  const doc = index.resources.get(uri.document);
  if (doc === undefined) return { why: uri.document === META ? "the 2020-12 metaschema is not bundled, so a $ref to it is not followed" : `a remote $ref (${uri.document}) is never fetched` };
  return inside(doc, decoded(uri.fragment));
}

function inside(doc, fragment) {
  if (fragment === null) return { why: "the $ref's fragment is not valid percent-encoding" };
  if (fragment !== "" && !fragment.startsWith("/")) return { why: "a plain-name fragment needs $anchor, which is not supported" };
  const found = fragment === "" ? doc : atPointer(doc, pointerTokens(fragment));
  return isSchemaValue(found) ? { schema: found } : { why: "the $ref's JSON pointer does not land on a schema" };
}
