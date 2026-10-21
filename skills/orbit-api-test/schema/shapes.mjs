// What each keyword's VALUE must look like before the validator will apply it. A malformed value is a gap with its own
// reason, so the evaluation only ever meets values it can read and cannot throw on one it cannot.
import { META, TYPE_NAMES } from "./vocab.mjs";
import { isObject, isSchemaValue } from "./json.mjs";

const compiles = (source) => {
  try { return Boolean(new RegExp(source, "u")); } catch { return false; }
};

const isNames = (v) => Array.isArray(v) && v.every((s) => typeof s === "string") && new Set(v).size === v.length;
const isTypeName = (v) => TYPE_NAMES.includes(v);
const isSchemaMap = (v) => isObject(v) && Object.values(v).every(isSchemaValue);

export const SHAPES = {
  any: { test: () => true },
  schema: { test: isSchemaValue, why: "a subschema is an object or a boolean" },
  schemaList: { test: (v) => Array.isArray(v) && v.length > 0 && v.every(isSchemaValue), why: "a non-empty array of subschemas is expected" },
  schemaMap: { test: isSchemaMap, why: "an object whose every value is a subschema is expected" },
  patternMap: { test: (v) => isSchemaMap(v) && Object.keys(v).every(compiles), why: "a patternProperties key does not compile as a u-flag regular expression" },
  count: { test: (v) => Number.isInteger(v) && v >= 0, why: "a non-negative integer is expected" },
  number: { test: (v) => typeof v === "number" && Number.isFinite(v), why: "a finite number is expected" },
  divisor: { test: (v) => typeof v === "number" && Number.isFinite(v) && v > 0, why: "a number above zero is expected" },
  flag: { test: (v) => typeof v === "boolean", why: "a boolean is expected" },
  list: { test: (v) => Array.isArray(v), why: "an array is expected" },
  names: { test: isNames, why: "an array of distinct strings is expected" },
  namesMap: { test: (v) => isObject(v) && Object.values(v).every(isNames), why: "an object of arrays of distinct strings is expected" },
  type: { test: (v) => isTypeName(v) || (Array.isArray(v) && v.length > 0 && v.every(isTypeName) && new Set(v).size === v.length), why: `a type name (${TYPE_NAMES.join(", ")}) or a non-empty array of distinct ones is expected` },
  regex: { test: (v) => typeof v === "string" && compiles(v), why: "the pattern does not compile as a u-flag ECMA-262 regular expression" },
  uri: { test: (v) => typeof v === "string", why: "a URI reference string is expected" },
  dialect: { test: (v) => v === META || v === `${META}#`, why: "a $schema other than the 2020-12 metaschema names another dialect, which this validator does not read" },
};
