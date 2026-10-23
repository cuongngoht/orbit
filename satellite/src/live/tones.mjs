// How Satellite Live tones the engine's own words -- one table each, shared by the watch screen and the full screen, so
// a state is the same colour wherever it is drawn. A tone is Orbit Live's (src/live/render/ansi.mjs TONES); a word no
// row names is drawn plain.
export const TONE_OF_STATE = Object.freeze({ done: "success", running: "info", ready: "brand", blocked: "warning", failed: "danger", cancelled: "subtle", skipped: "subtle", unresolved: "warning", planned: "subtle" });

export const TONE_OF_LEVEL = Object.freeze({ VERIFIED: "success", BEHAVIOR_OBSERVED: "info", CONTRACT_MET: "info", TOOL_COMPLETED: "subtle", BLOCKED: "warning", UNKNOWN: "subtle" });

export const TONE_OF_HYPOTHESIS = Object.freeze({ confirmed: "success", refuted: "danger", contested: "warning", supported: "info", open: "subtle" });

export const TONE_OF_STATUS = Object.freeze({ AMBIGUOUS: "danger", REFUSED: "warning", EVIDENCE_VERIFIED: "success", RESULT_RECORDED: "info" });

export const VERDICT_SAY = Object.freeze({ VERIFIED: "verified by independent evidence", NOT_VERIFIED: "not verified", PENDING: "not yet verified" });
