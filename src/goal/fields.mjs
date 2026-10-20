import { TITLE_LIMIT } from "./vocab.mjs";

export const STAMPED = ["id", "digest", "state", "revision", "schema", "at"];

export const SOURCE_REF = /^spec@[0-9a-f]{8,64}(#L[0-9]+(-[0-9]+)?)?$/;

export const REQUIREMENT_ROW = {
  id: { type: "string", pattern: "^gr-[0-9a-f]{8}$" },
  kind: { type: "string", enum: ["explicit", "derived", "assumption", "unknown", "conflict", "decision"] },
  statement: { type: "string", minLength: 1, maxLength: TITLE_LIMIT },
  sourceRef: { type: "string", pattern: SOURCE_REF.source },
};

export const AC_ROW = {
  id: { type: "string", pattern: "^ac-[0-9a-f]{8}$" },
  statement: { type: "string", minLength: 1, maxLength: TITLE_LIMIT },
  sourceRef: { type: "string", pattern: SOURCE_REF.source },
  requirementRef: { type: "string" },
  verification: { type: "string", maxLength: TITLE_LIMIT },
};

export const ANALYSIS_FIELDS = ["objective", "intent", "requirements", "acceptance", "unknowns", "conflicts"];

// A capability word, as the router's table and every catalog row spell one.
export const CAPABILITY = /^[a-z][a-z0-9]*(\.[a-z0-9][a-z0-9-]*)+$/;

// The structured reading of what a goal is about (0.0.4): every field typed, every list bounded, and nothing in it a
// sentence the engine has to understand -- `category`, `workKinds` and `capabilities` decide the plan; the sentences
// (`verification`, `dependencies`, `missing[].statement`) are kept for a person, held to the text rules.
export const INTENT_FIELDS = ["category", "workKinds", "capabilities", "verification", "dependencies", "missing"];

export const INTENT_REQUIRED = ["category", "workKinds"];

export const MISSING_FIELDS = ["statement", "blocks"];

export const UNIT_ROW = {
  id: { type: "string", pattern: "^gu-[0-9a-f]{8}$" },
  title: { type: "string", minLength: 1, maxLength: TITLE_LIMIT },
  workflow: { type: "string" },
  kind: { type: "string" },
  intent: { type: "string" },
  capabilities: { type: "array" },
  dependsOn: { type: "array" },
  acceptanceRefs: { type: "array" },
  requirementRefs: { type: "array" },
};
