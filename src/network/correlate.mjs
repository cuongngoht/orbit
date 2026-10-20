// Which request in an action's window is the call the MAP says the control
// makes -- the one a persistence verdict is about, and the only one.
//
// A window holds whatever the page sent: telemetry, a token refresh, a list
// reload, the write. Any 2xx write in it used to count as "the write", so a
// telemetry POST 200 over a missing row read as a confirmed defect. The map
// already says which call a control makes (graph/effects.json `api`, e.g.
// "POST api/things"), and the question is only whether a request IS that call.
//
// A request is canonical (src/network/canonical.mjs): variable segments read
// {n} {uuid} {hex} {token}. An effect's own placeholders read {anything}.
// Segments are compared from the END, so a base path the effect leaves out (a
// /v2 prefix, a gateway mount) still matches; a literal matches case-blind.
// Pure, and a leaf: it names no endpoint and knows no product.

// The call an effect records, or null when the map records none.
export function callOf(effect) {
  const [method, ...rest] = String(effect?.api ?? "").trim().split(/\s+/);
  const path = rest.join(" ").split("?")[0];
  return method && path ? { method: method.toUpperCase(), api: String(effect.api).trim(), segments: segmentsOf(path) } : null;
}

const segmentsOf = (path) => String(path ?? "").split("/").filter(Boolean);

const placeholder = (s) => /^\{[^}]*\}$/.test(s);

const same = (want, got) => placeholder(want) || want.toLowerCase() === String(got ?? "").toLowerCase();

// Is this observed request (src/network/observe.mjs) the recorded call?
export function madeBy(call, request) {
  const got = segmentsOf(request?.template);
  if (!call || request?.method !== call.method || got.length < call.segments.length) return false;
  return call.segments.every((s, i) => same(s, got[got.length - call.segments.length + i]));
}

// Of the requests that ARE the call, the one that succeeded, else the first.
export function correlated(call, requests) {
  const made = (requests ?? []).filter((r) => madeBy(call, r));
  return made.find((r) => r.status >= 200 && r.status < 300) ?? made[0] ?? null;
}
