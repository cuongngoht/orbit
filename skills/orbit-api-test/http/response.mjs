// What an HTTP answer becomes before anybody judges it (doc §5.2): a PROJECTION, so the run log,
// the evidence and the report keep what an assertion needs and nothing a product typed by
// accident.
//
// Headers are an allow-list, plus the names the accepted contract declares. The body is parsed
// when it says it is JSON, kept as text otherwise. A credential the system under test echoed back
// is replaced before the answer leaves this helper, and the answer SAYS it happened
// (`echoedCredential`) -- which is itself a finding somebody may want, never a value to keep.
// Digests let a receipt prove which request and which answer it was without keeping either.
// Every response is an observation, a 500 included: `expect` judges it, this never does.
import { canonicalJson, sha } from "../../../src/hash.mjs";

export const RESPONSE_HEADERS = ["content-type", "content-length", "content-language", "etag", "last-modified", "location", "retry-after", "cache-control", "www-authenticate", "allow", "x-request-id", "x-correlation-id"];

export const MASK = "[bound-credential]";

// The credential is masked wherever the product could have echoed it -- the body, every kept
// header, every redirect hop -- and twice for the body: in every spelling the raw text could hold
// it (plain, JSON-escaped, URL-encoded), and again in every string AFTER parsing, because
// JSON.parse decodes an escape the raw text hid. A projection is what leaves this helper, so a
// spelling missed here is a token in the run log.
export function projection(r, opts) {
  const text = masked(r.text ?? "", opts.secret);
  const body = deepMasked(parsedBody(text.value, r.headers["content-type"]), opts.secret);
  const headers = deepMasked(allowedHeaders(r.headers, opts.responseHeaders ?? []), opts.secret);
  const hops = deepMasked(r.hops ?? [], opts.secret);
  return {
    status: r.status,
    headers: headers.value,
    body: body.value,
    bodyBytes: r.bytes,
    bodyDigest: sha(r.text ?? ""),
    elapsedMs: r.elapsedMs,
    hops: hops.value,
    endpoint: opts.endpoint ?? null,
    identity: opts.identity ?? null,
    echoedCredential: text.echoed || body.echoed || headers.echoed || hops.echoed,
    ...(opts.schema ? { schema: opts.schema(body.value) } : {}),
    receipt: { requestDigest: opts.requestDigest, responseDigest: sha(canonicalJson({ status: r.status, body: body.value })) },
  };
}

// Every way a raw text could spell the secret without the secret's own characters.
const spellings = (secret) => [...new Set([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret), escape(secret)])].filter(Boolean);

function masked(text, secret) {
  if (!secret) return { value: text, echoed: false };
  const found = spellings(secret).filter((s) => text.includes(s));
  return { value: found.reduce((t, s) => t.split(s).join(MASK), text), echoed: found.length > 0 };
}

// Every string inside a parsed value, masked; `echoed` if any of them held it.
function deepMasked(value, secret) {
  if (!secret) return { value, echoed: false };
  const seen = { echoed: false };
  return { value: walked(value, secret, seen), echoed: seen.echoed };
}

function walked(v, secret, seen) {
  if (typeof v === "string") return stringMasked(v, secret, seen);
  if (Array.isArray(v)) return v.map((m) => walked(m, secret, seen));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, m]) => [stringMasked(k, secret, seen), walked(m, secret, seen)]));
  return v;
}

function stringMasked(s, secret, seen) {
  const m = masked(s, secret);
  seen.echoed ||= m.echoed;
  return m.value;
}

function parsedBody(text, type) {
  if (!text) return null;
  if (!/\bjson\b/i.test(String(type ?? ""))) return text;
  try { return JSON.parse(text); }
  catch { return text; }
}

function allowedHeaders(headers, declared) {
  const allowed = new Set([...RESPONSE_HEADERS, ...declared.map((h) => String(h).toLowerCase())]);
  return Object.fromEntries(Object.entries(headers).filter(([k]) => allowed.has(k)).sort(([a], [b]) => (a < b ? -1 : 1)));
}

// What was asked, as a digest: method, the path and query as sent, the headers a case set and
// the body. Never the credential -- the receipt must be safe to keep.
export const requestDigest = (method, url, headers, body) => sha(canonicalJson({ method, url: `${url.pathname}${url.search}`, headers, body: body ?? null }));
