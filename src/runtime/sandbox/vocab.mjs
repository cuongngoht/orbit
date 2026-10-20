// The words a sandbox's refusals and views are made of, as data: the codes Orbit Control tells a page apart by
// (a thing that is gone, a thing that moved, a thing that is wrong) and the places a "who must act" can land.

// What an answer that stops a sandbox says about WHO can move it on. The orchestrator's task reads the same
// three words (src/orchestration/vocab.mjs NEEDS), so a block here is a block there.
export const NEEDS = ["environment", "capability", "person"];

// Codes: `missing` (404) a sandbox or session nobody keeps; `conflicts` (409) something it is in no state to do.
export const SANDBOX_UNKNOWN = "SANDBOX_UNKNOWN";
export const SESSION_UNKNOWN = "SESSION_UNKNOWN";
export const SANDBOX_RELEASED = "SANDBOX_RELEASED";
export const SANDBOX_OWNER_MISMATCH = "SANDBOX_OWNER_MISMATCH";
export const SANDBOX_BUSY = "SANDBOX_BUSY";

// How much of one log a person may read, and in how many lines: bounded because a log is an application's,
// and may be as long as it ran.
export const LOG_LINES = 200;
export const LOG_BYTES = 64 * 1024;
