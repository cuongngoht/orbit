// The three ways a run stops early, each with its own exit code, because a
// reader must be able to tell "the product is wrong" from "we never got to ask".
//
// A LEAF, with no imports of its own, because the ports need it: a child process
// that had to be killed is Blocked, not a product failure, and src/browser and
// src/database must not import from src/run. src/run/errors.mjs re-exports these
// alongside the exit codes and the defaults, so no call site had to move.
export class StepError extends Error {}   // FAIL    exit 1: a step said the product misbehaved
export class Refused extends Error {}     // REFUSED exit 2: stopped before touching the browser
export class Blocked extends Error {}     // BLOCKED exit 3: a precondition could not be established
