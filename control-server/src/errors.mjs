// What a Control operation can say when it will not do what was asked.
//
// An operation throws one of these and never touches the response: the KIND is
// what it means, and response.mjs turns a kind into an HTTP status exactly once.
// The message is written for the person at the browser, so it never carries an
// absolute path -- a path is the server's business, not the page's.
import { ADOPT_UNVERIFIED, Blocked, CHECKOUT_PRESENT, Refused, STALE_PROPOSAL, STALE_REVISION, TARGET_UNKNOWN, TASK_CONFLICTS, TASK_MISSING } from "./core.mjs";

export class ControlError extends Error {
  constructor(kind, code, message, details) {
    super(message);
    Object.assign(this, { kind, code, details });
  }
}

export const invalid = (code, message, details) => new ControlError("invalid", code, message, details);
export const forbidden = (code, message) => new ControlError("forbidden", code, message);
export const missing = (code, message) => new ControlError("missing", code, message);
export const notAllowed = (message) => new ControlError("method", "METHOD_NOT_ALLOWED", message);
export const conflict = (code, message) => new ControlError("conflict", code, message);
export const tooLarge = (message) => new ControlError("tooLarge", "PAYLOAD_TOO_LARGE", message);
export const unsupported = (message) => new ControlError("unsupported", "UNSUPPORTED_MEDIA_TYPE", message);
export const failed = (code, message) => new ControlError("failed", code, message);
export const unavailable = (code, message) => new ControlError("unavailable", code, message);

// Core speaks in two typed stops, and each has one meaning here: Refused is a
// request that cannot be honoured as asked (400), Blocked is a machine that
// could not do it right now -- offline, a checksum that did not match, a
// runtime that would not start (503). A host adapter's own Error carries a
// sentence written for a person, and is a 500 that says it.
export async function guarded(code, fn) {
  try { return await fn(); }
  catch (e) { throw translated(e, code); }
}

// A refusal that carries one of THESE codes is not a bad request but a thing that moved since the
// page read it -- a stale revision, a stale proposal, files left as written, a directory that is
// there again, a task that ended or an approval already decided -- so it is a 409, and the page
// can tell it from a mistake.
//
// A sandbox's own: a released one, a task's receipt naming another task's, one a person is releasing
// while an operation is in flight. They are the runtime's words (src/runtime/sandbox/vocab.mjs); until
// that module exports them they are spelled here, once, and nothing else in this server spells them.
const SANDBOX_CONFLICTS = ["SANDBOX_RELEASED", "SANDBOX_OWNER_MISMATCH", "SANDBOX_BUSY"];
const SANDBOX_MISSING = ["SANDBOX_UNKNOWN", "SESSION_UNKNOWN"];

const CONFLICTS = new Set([STALE_REVISION, STALE_PROPOSAL, ADOPT_UNVERIFIED, CHECKOUT_PRESENT, ...TASK_CONFLICTS, ...SANDBOX_CONFLICTS]);

// And one that names a thing nobody has -- a reach target this machine never set, a task or an
// approval this checkout does not have -- is a 404.
const MISSING = new Set([TARGET_UNKNOWN, ...TASK_MISSING, ...SANDBOX_MISSING]);

function translated(e, code) {
  if (e instanceof ControlError) return e;
  if (e instanceof Refused) return refusal(e, code);
  if (e instanceof Blocked) return unavailable(code, e.message);
  return failed(code, String(e?.message ?? "the operation could not be completed").slice(0, 300));
}

function refusal(e, code) {
  if (CONFLICTS.has(e.code)) return conflict(e.code, e.message);
  return MISSING.has(e.code) ? missing(e.code, e.message) : invalid(code, e.message);
}
