// What one HTTP request may be (doc §5.2; ADR 0036): built from a case's input and the run's
// bindings, never from a URL anybody typed.
//
// The endpoint is the binding's -- an origin Runtime resolved from a component this task
// started -- and a case contributes only a relative path, a query and a short allow-list of
// headers. So a case cannot name another host (`//`, an `@`, a path that climbs), cannot route
// itself (`Host`, `Forwarded`, a proxy header), and cannot carry an identity (`Authorization`,
// `Cookie`): identity comes from the binding, as a credential this helper finds in its own
// environment and nowhere else. Every refusal is a sentence the case author can act on.

const FORBIDDEN = /^(authorization|proxy-authorization|cookie|host|forwarded|x-forwarded-[a-z-]+|x-real-ip|proxy-[a-z-]+|connection|keep-alive|content-length|transfer-encoding|te|trailer|upgrade|expect)$/;

export const REQUEST_HEADERS = ["accept", "accept-language", "content-type", "if-match", "if-none-match", "if-modified-since", "if-unmodified-since", "idempotency-key", "prefer", "x-correlation-id", "x-request-id"];

const PATH_RULES = [
  { when: (p) => typeof p !== "string" || !p.startsWith("/"), say: "a path starts with / and is relative to the bound endpoint" },
  { when: (p) => p.startsWith("//"), say: "a path starting // would name another host" },
  { when: (p) => /[\s\\#]|[\u0000-\u001f\u007f]/.test(p), say: "a path holds no whitespace, backslash, fragment or control character" },
  { when: (p) => p.split("?")[0].split("/").some((seg) => seg === ".." || seg === "." || /%2e/i.test(seg)), say: "a path never climbs with . or .." },
  { when: (p) => p.split("?")[0].includes("@"), say: "a path holds no @, which some parsers read as credentials" },
];

export const pathProblem = (path) => PATH_RULES.find((r) => r.when(path))?.say ?? null;

// The URL, resolved against the bound origin and held to it: a path that resolves anywhere else
// is refused rather than sent.
export function urlOf(origin, path, query) {
  const base = new URL(origin);
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(query ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))) url.searchParams.append(k, String(v));
  return url.origin === base.origin ? { url } : { problem: `the path left the bound origin ${base.origin}` };
}

export function headersOf(asked, declared = []) {
  const allowed = new Set([...REQUEST_HEADERS, ...declared.map((h) => String(h).toLowerCase()).filter((h) => !FORBIDDEN.test(h))]);
  const entries = Object.entries(asked ?? {}).map(([k, v]) => [String(k).toLowerCase(), String(v)]);
  const refused = entries.filter(([k, v]) => FORBIDDEN.test(k) || !allowed.has(k) || /[\r\n]/.test(v)).map(([k]) => k);
  return refused.length ? { problem: `header(s) ${refused.join(", ")} are never sent from a case — identity comes from the binding, routing from the endpoint, and nothing else is on the allow-list` } : { headers: Object.fromEntries(entries) };
}

// The bound identity's credential, read from this helper's own environment: the binding names
// WHERE it is, never what it is. An identity bound as anonymous sends nothing.
export function credentialOf(identity, env) {
  if (!identity || identity.anonymous) return { headers: {}, secret: null };
  const secret = env?.[identity.env] ?? null;
  if (!secret) return { problem: `identity ${identity.alias ?? "?"} has no credential in this helper's environment — the binding sets it, a case never does` };
  return { headers: { [String(identity.header ?? "authorization").toLowerCase()]: identity.scheme ? `${identity.scheme} ${secret}` : secret }, secret };
}

export function bodyOf(body, headers) {
  if (body === undefined || body === null) return { body: undefined, headers };
  if (typeof body === "string") return { body, headers };
  return { body: JSON.stringify(body), headers: { "content-type": "application/json", ...headers } };
}
