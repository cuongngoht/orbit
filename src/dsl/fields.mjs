// The CORE registry's snapshot of the step vocabulary, plus the case-head tables
// verbatim.
//
// core/fields.mjs is the data. What is here is the view over CORE, for the same
// reason dsl/verbs.mjs is: the engine's own grammar is a different question to
// one project's effective grammar, and a run asks `ctx.dsl` for the second.
//
// The head tables -- ROOT, IDENTITY, RESOLVE, PARAM -- are re-exported unchanged
// because nothing may extend them (core/fields.mjs says why).
import { CORE } from "./registry.mjs";

export { PARAM_NAME, ROOT_FIELDS, ROOT_REQUIRED, IDENTITY_FIELDS, RESOLVE_FIELDS, PARAM_FIELDS } from "./core/fields.mjs";

export const STEP_FIELDS = CORE.fields();
export const COMMON_FIELDS = CORE.commonFields();
export const LITERAL_FIELDS = CORE.literalFields();
