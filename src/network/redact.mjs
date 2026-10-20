// What of a request's headers may be KEPT -- an ALLOW-list, for the reason
// src/report/model.mjs STRUCTURAL is one: a list of what to hide falls behind
// the day a product adds `x-session-secret`, and nothing fails when it does.
//
//   names         every header NAME present, sorted. A name says a request was
//                 authenticated or carried a cookie without saying with what
//   values        the value of a header on SAFE, scrubbed on the way in
//   location      a redirect's target, CANONICAL (src/network/canonical.mjs), so
//                 a code or a token in its query never lands
//   correlation   declared correlation headers, as FINGERPRINTS: equality is
//                 all a correlation id is for
//   idempotency   declared idempotency-key headers, the same way
//
// Which headers carry correlation or idempotency is the PROJECT's fact, so it
// arrives in `declared` (settings `network.correlationHeaders` and
// `network.idempotencyHeaders`). Nothing here names a product's header.
import { scrub } from "../scrub.mjs";
import { canonicalUrl } from "./canonical.mjs";
import { fingerprint } from "./fingerprint.mjs";

export const SAFE = ["accept", "cache-control", "content-length", "content-type", "retry-after"];

export function safeHeaders(headers, declared = {}, salt = "") {
  const h = lowered(headers);
  return { names: Object.keys(h).sort(), values: pick(h, SAFE, (v) => scrub(v)), location: locationOf(h.location), correlation: pick(h, declared.correlationHeaders ?? [], (v) => fingerprint(v, salt)), idempotency: pick(h, declared.idempotencyHeaders ?? [], (v) => fingerprint(v, salt)) };
}

const lowered = (headers) => Object.fromEntries(Object.entries(headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));

const pick = (h, names, as) => Object.fromEntries(names.map((n) => n.toLowerCase()).filter((n) => h[n] !== undefined).map((n) => [n, as(h[n])]));

const locationOf = (value) => (value === undefined ? null : canonicalUrl(value)?.endpoint ?? canonicalUrl(`http://relative.invalid${value.startsWith("/") ? "" : "/"}${value}`)?.template ?? null);
