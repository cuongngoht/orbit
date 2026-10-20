// Helpers every rule file shares. A rule returns findings (strings); an empty
// array is "nothing wrong". Findings never throw: the caller decides.
export const unknownFields = (obj, known, where) =>
  Object.keys(obj).filter((k) => !known.has(k)).map((k) => `${where}: unknown field "${k}"`);

// The read-only check is not a prefix regex any more -- see dsl/sql-text.mjs
// for what the engine, the adapter and the database login each guarantee.
export { readOnlyProblem, unquotedPlaceholders } from "../sql-text.mjs";

export const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
