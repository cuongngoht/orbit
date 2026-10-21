// JSON Schema for the HTTP provider's schema assertions: a zero-dependency validator for a DECLARED subset of draft
// 2020-12 (skills/orbit-api-test/schema/vocab.mjs holds the vocabulary as data).
//
// The promise it keeps is the one an assertion needs: a verdict is given only for a schema it can read whole. A keyword
// it does not implement, another dialect, a remote `$ref`, a pattern that does not compile, a request to assert
// `format`, or a hostile schema past its limits is a GAP, and then `valid` is null -- never true. The caller turns a
// non-empty `gaps` into CAPABILITY_MISSING, so an unsupported keyword is never skipped on the way to a pass.
//
//   validateSchema(schema, instance, opts) -> { dialect, valid: true|false|null, errors[<=20], gaps[], digest }
//   opts: { assertFormat?: boolean, limits?: { depth?, work? } }
//
// `digest` is the sha256 of the schema's canonical JSON, so a design can pin the schema it was written against and a
// moved schema is refused as stale rather than silently applied.
import { canonicalJson, sha } from "../../src/hash.mjs";
import { indexOf } from "./schema/resources.mjs";
import { scan } from "./schema/scan.mjs";
import { evaluate } from "./schema/evaluate.mjs";
import { DIALECT } from "./schema/vocab.mjs";

export { ANNOTATION, ASSERTING, DIALECT, META, UNSUPPORTED } from "./schema/vocab.mjs";
export { MAX_ERRORS } from "./schema/evaluate.mjs";

// Defaults a caller (the HTTP helper, from policy) may narrow; a 1 MiB response under a realistic schema stays well inside them.
export const DEFAULT_LIMITS = Object.freeze({ depth: 128, work: 1000000 });

export const schemaDigest = (schema) => sha(canonicalJson(schema));

export function validateSchema(schema, instance, opts = {}) {
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) };
  const judged = guarded(() => judgedOf(schema, instance, opts, limits));
  return { dialect: DIALECT, ...judged, digest: guarded(() => schemaDigest(schema), () => null) };
}

function judgedOf(schema, instance, opts, limits) {
  const scanned = scan(indexOf(schema, limits), schema, opts);
  if (scanned.gaps.length) return { valid: null, errors: [], gaps: scanned.gaps };
  const ctx = contextOf(scanned, limits);
  const valid = evaluate(ctx, schema, instance, "", 0);
  return ctx.gaps.length ? { valid: null, errors: [], gaps: ctx.gaps } : { valid, errors: ctx.errors, gaps: [] };
}

const contextOf = (scanned, limits) => ({ refs: scanned.refs, regexes: new Map(), ids: new Map(), active: new Set(), errors: [], gaps: [], work: 0, stopped: false, limits });

// A value nested past what the engine's own stack can walk is a limit too, never a thrown error inside a run.
const overflowed = () => ({ valid: null, errors: [], gaps: [{ keyword: "limits", path: "", why: "the schema or the instance nests too deeply to walk" }] });

function guarded(run, otherwise = overflowed) {
  try { return run(); } catch (error) {
    if (error instanceof RangeError) return otherwise();
    throw error;
  }
}
