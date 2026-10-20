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

export const ANALYSIS_FIELDS = ["objective", "requirements", "acceptance", "unknowns", "conflicts"];

export const UNIT_ROW = {
  id: { type: "string", pattern: "^gu-[0-9a-f]{8}$" },
  title: { type: "string", minLength: 1, maxLength: TITLE_LIMIT },
  workflow: { type: "string" },
  dependsOn: { type: "array" },
  acceptanceRefs: { type: "array" },
  requirementRefs: { type: "array" },
};
