// One request as an investigation may KEEP it: canonical, redacted,
// fingerprinted -- and honest about what it does not know.
//
// Three sources, each optional past the first:
//   listed   { n, method, url, status, failed? } off `requests` -- always there
//   detail   the parsed `request <n>` (src/browser/detail.mjs) -- null when the
//            adapter could not answer
//   body     the request body -- null when there was none or it was not read
//
// `missing` names what THIS request could not show, and NEVER_OBSERVED what the
// browser adapter cannot show for any request (measured, see detail.mjs). A
// reader has to be able to tell "there was no retry header" from "nobody could
// have seen one", so neither list is ever silently empty.
import { canonicalUrl } from "./canonical.mjs";
import { fingerprint, payloadFingerprint } from "./fingerprint.mjs";
import { safeHeaders } from "./redact.mjs";

export const NEVER_OBSERVED = ["startedAt", "completedAt", "initiator", "retryMarker", "preflight"];

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const writes = (method) => UNSAFE.has(String(method).toUpperCase());

// opts: { salt, fingerprints, correlationHeaders, idempotencyHeaders, ignoreFields }
export function observedRequest(listed, detail, body, opts) {
  const url = canonicalUrl(listed.url);
  const status = detail?.status ?? listed.status ?? null;
  const base = { n: listed.n, method: String(listed.method).toUpperCase(), endpoint: url?.endpoint ?? null, template: url?.template ?? null, queryKeys: url?.queryKeys ?? [], queryFp: url ? fingerprint(url.queryPairs, opts.salt) : null, status, failed: detail?.failed ?? listed.failed ?? null };
  return { ...base, ...detailed(detail, opts), payload: payloadOf(base, detail, body, opts), missing: missingOf(base, detail, body, opts) };
}

function detailed(detail, opts) {
  if (!detail) return { type: null, durationMs: null, headers: null, response: null };
  return { type: detail.type, durationMs: detail.durationMs, headers: safeHeaders(detail.requestHeaders, opts, opts.salt), response: safeHeaders(detail.responseHeaders, opts, opts.salt) };
}

// A body is compared only for a write, only when permitted, only when read. A
// read has no payload to compare -- its query fingerprint is its identity -- so
// for a read the answer is "empty", and nothing is reported missing.
function payloadOf(base, detail, body, opts) {
  if (!writes(base.method)) return { fp: fingerprint("", opts.salt), form: "empty" };
  if (!opts.fingerprints || !detail || body === undefined) return null;
  return payloadFingerprint(body, { salt: opts.salt, ignore: opts.ignoreFields ?? [] });
}

function missingOf(base, detail, body, opts) {
  const missing = detail ? [] : ["detail", "headers", "duration", "type"];
  if (!payloadOf(base, detail, body, opts)) missing.push(opts.fingerprints ? "payload" : "payload (fingerprints are off in settings)");
  return missing;
}
