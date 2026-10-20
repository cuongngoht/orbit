// Every answer this server writes, in one shape.
//
//   success   the resource itself, as JSON
//   failure   { "error": { "code", "message", "details"? } }
//
// A ControlError's KIND becomes a status here and nowhere else. Anything that
// is not a ControlError is a bug in this server, and the page gets a generic
// sentence -- a stack or a path in a response is information a page never needs.
import { ControlError } from "./errors.mjs";

const STATUS = { invalid: 400, forbidden: 403, missing: 404, method: 405, conflict: 409, tooLarge: 413, unsupported: 415, failed: 500, unavailable: 503 };

// Sent with every API answer: nothing here should be cached, sniffed or framed.
export const API_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer" };

export function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { ...API_HEADERS, "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

const errorBody = (code, message, details) => ({ error: { code, message, ...(details ? { details } : {}) } });

export const badRequest = (res, code, message, details) => json(res, 400, errorBody(code, message, details));
export const forbidden = (res, code, message) => json(res, 403, errorBody(code, message));
export const notFound = (res, code = "NOT_FOUND", message = "nothing here") => json(res, 404, errorBody(code, message));
export const serverError = (res) => json(res, 500, errorBody("INTERNAL_ERROR", "the server could not complete that request"));

// The one place an exception becomes a response.
export function failure(res, error, log = () => {}) {
  if (!(error instanceof ControlError)) return unexpected(res, error, log);
  json(res, STATUS[error.kind] ?? 500, errorBody(error.code, error.message, error.details));
}

function unexpected(res, error, log) {
  log(`unexpected error: ${error?.stack ?? error}`);
  if (res.headersSent) return res.destroy();
  serverError(res);
}
