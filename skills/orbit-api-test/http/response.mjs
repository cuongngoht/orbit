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

export function projection(r, opts) {
  const text = masked(r.text ?? "", opts.secret);
  const body = parsedBody(text.value, r.headers["content-type"]);
  return {
    status: r.status,
    headers: allowedHeaders(r.headers, opts.responseHeaders ?? []),
    body,
    bodyBytes: r.bytes,
    bodyDigest: sha(r.text ?? ""),
    elapsedMs: r.elapsedMs,
    hops: r.hops,
    endpoint: opts.endpoint ?? null,
    identity: opts.identity ?? null,
    echoedCredential: text.echoed,
    ...(opts.schema ? { schema: opts.schema(body) } : {}),
    receipt: { requestDigest: opts.requestDigest, responseDigest: sha(canonicalJson({ status: r.status, body: text.value })) },
  };
}

function masked(text, secret) {
  if (!secret || !text.includes(secret)) return { value: text, echoed: false };
  return { value: text.split(secret).join(MASK), echoed: true };
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
