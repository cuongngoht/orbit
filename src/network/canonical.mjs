// A URL as a duplicate is judged by: the origin, the path with its variable
// segments replaced by what KIND of value sat there, and the query as its keys.
// Query VALUES are never part of the canonical form and never kept -- they are
// handed to the fingerprint (src/network/fingerprint.mjs) so that page=1 and
// page=2 are two requests while nobody can read either value back.
//
// Which segments are variable is decided by SHAPE, as an ordered table, never by
// a product's route names: `/api/workspaces/42` and `/api/workspaces/43` are the
// same endpoint, and nothing here knows what a workspace is.
const SEGMENTS = [
  { kind: "{uuid}", test: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i },
  { kind: "{n}", test: /^\d+$/ },
  { kind: "{hex}", test: /^[0-9a-f]{16,}$/i },
  { kind: "{token}", test: /^(?=[^/]*\d)[A-Za-z0-9_~.-]{24,}$/ },
];

const segmentOf = (s) => SEGMENTS.find((r) => r.test.test(s))?.kind ?? s;

// -> { origin, template, endpoint, queryKeys, queryPairs } or null for a URL
// that does not parse. `queryPairs` exists ONLY to be fingerprinted.
export function canonicalUrl(url) {
  const u = parsed(url);
  if (!u) return null;
  const template = u.pathname.split("/").map((s) => (s ? segmentOf(decodeSafe(s)) : s)).join("/");
  const pairs = [...u.searchParams].sort(([a, x], [b, y]) => (a === b ? String(x).localeCompare(String(y)) : a.localeCompare(b)));
  return { origin: u.origin, template, endpoint: `${u.origin}${template}`, queryKeys: [...new Set(pairs.map(([k]) => k))], queryPairs: pairs };
}

function parsed(url) {
  try { return new URL(String(url)); }
  catch { return null; }
}

function decodeSafe(s) {
  try { return decodeURIComponent(s); }
  catch { return s; }
}

// The part of an endpoint a declared pattern is matched against: the template
// without its origin, so a policy written once holds on every environment.
export const pathOf = (endpoint) => String(endpoint ?? "").replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "");
