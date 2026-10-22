// The vocabulary this JSON Schema validator DECLARES, as data: what it asserts, what it only annotates, and what it
// refuses to judge. A keyword in none of the first two tables is a gap, never a silent pass: a caller turns a gap into
// CAPABILITY_MISSING, so a schema this validator cannot read is reported as unread rather than as satisfied.
export const DIALECT = "json-schema/2020-12";
export const META = "https://json-schema.org/draft/2020-12/schema";
export const TYPE_NAMES = ["null", "boolean", "object", "array", "number", "string", "integer"];

const asserts = (keyword, shape, doc) => ({ keyword, shape, doc });
const notes = (keyword) => ({ keyword, shape: "any", doc: "an annotation: read, never asserted" });
const refuses = (keyword, why) => ({ keyword, why });

export const ASSERTING = [
  asserts("type", "type", "the instance's JSON type, or one of several"),
  asserts("enum", "list", "equal to one of the listed values"),
  asserts("const", "any", "equal to the value"),
  asserts("multipleOf", "divisor", "a number that is an integer multiple of the value"),
  asserts("maximum", "number", "a number at most the value"),
  asserts("exclusiveMaximum", "number", "a number below the value"),
  asserts("minimum", "number", "a number at least the value"),
  asserts("exclusiveMinimum", "number", "a number above the value"),
  asserts("maxLength", "count", "a string of at most this many code points"),
  asserts("minLength", "count", "a string of at least this many code points"),
  asserts("pattern", "regex", "a string the u-flag regular expression matches somewhere"),
  asserts("maxItems", "count", "an array of at most this many items"),
  asserts("minItems", "count", "an array of at least this many items"),
  asserts("uniqueItems", "flag", "an array whose items are pairwise unequal"),
  asserts("maxProperties", "count", "an object with at most this many properties"),
  asserts("minProperties", "count", "an object with at least this many properties"),
  asserts("required", "names", "an object having every listed property"),
  asserts("dependentRequired", "namesMap", "an object that, having a property, has the properties it requires"),
  asserts("allOf", "schemaList", "valid against every subschema"),
  asserts("anyOf", "schemaList", "valid against at least one subschema"),
  asserts("oneOf", "schemaList", "valid against exactly one subschema"),
  asserts("not", "schema", "invalid against the subschema"),
  asserts("if", "schema", "chooses then or else by whether the instance is valid against it"),
  asserts("then", "schema", "applied when if is valid"),
  asserts("else", "schema", "applied when if is invalid"),
  asserts("properties", "schemaMap", "each named property valid against its subschema"),
  asserts("patternProperties", "patternMap", "each property a pattern matches valid against its subschema"),
  asserts("additionalProperties", "schema", "every other property valid against the subschema"),
  asserts("prefixItems", "schemaList", "each leading item valid against the subschema in its position"),
  asserts("items", "schema", "every item after the prefix valid against the subschema"),
  asserts("contains", "schema", "between minContains and maxContains items valid against the subschema"),
  asserts("minContains", "count", "the fewest items contains must match (default 1)"),
  asserts("maxContains", "count", "the most items contains may match"),
  asserts("propertyNames", "schema", "every property name valid against the subschema"),
  asserts("dependentSchemas", "schemaMap", "the instance, having a property, valid against that property's subschema"),
  asserts("$ref", "uri", "valid against the schema a local JSON pointer or an embedded $id names"),
  asserts("$defs", "schemaMap", "schemas kept for $ref, applied only through it"),
  asserts("$id", "uri", "the base URI of an embedded schema resource"),
  asserts("$schema", "dialect", "the 2020-12 metaschema, and no other"),
];

export const ANNOTATION = ["title", "description", "$comment", "default", "examples", "deprecated", "readOnly", "writeOnly", "contentEncoding", "contentMediaType", "contentSchema", "format"].map(notes);

// A keyword whose name starts with this is the schema author's own annotation (OpenAPI's convention), never asserted.
export const EXTENSION_PREFIX = "x-";

export const UNSUPPORTED = [
  refuses("$dynamicRef", "dynamic-scope resolution ($dynamicRef) is not implemented"),
  refuses("$dynamicAnchor", "dynamic anchors ($dynamicAnchor) are not implemented"),
  refuses("$anchor", "plain-name anchors ($anchor) are not implemented"),
  refuses("$vocabulary", "custom vocabularies ($vocabulary) are not implemented"),
  refuses("unevaluatedProperties", "unevaluatedProperties needs annotation collection, which is not implemented"),
  refuses("unevaluatedItems", "unevaluatedItems needs annotation collection, which is not implemented"),
  refuses("$recursiveRef", "$recursiveRef belongs to draft 2019-09, not this dialect"),
  refuses("$recursiveAnchor", "$recursiveAnchor belongs to draft 2019-09, not this dialect"),
];

// Where a schema holds subschemas: one, a list, or a map of them. The walk, the scan and the evaluation all read this
// one table, so a position cannot be indexed by one of them and missed by another.
export const SUBSCHEMAS = {
  allOf: "list",
  anyOf: "list",
  oneOf: "list",
  prefixItems: "list",
  not: "one",
  if: "one",
  then: "one",
  else: "one",
  additionalProperties: "one",
  items: "one",
  contains: "one",
  propertyNames: "one",
  properties: "map",
  patternProperties: "map",
  dependentSchemas: "map",
  $defs: "map",
};
