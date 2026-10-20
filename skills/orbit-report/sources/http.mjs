// The one HTTP client both source adapters read through. Its rules are the
// connection's promises, kept in one place:
//
//   only the connection's origin   a request for any other host is refused, and
//                                  a redirect to one is not followed -- the
//                                  credential never travels anywhere it was not
//                                  given for
//   https                          except to this machine's loopback, for tests
//   bounded                        a deadline per request, a request budget per
//                                  run, a wait budget for rate limits; a limit
//                                  that would be crossed stops the run with the
//                                  time it resets, never a quiet partial answer
//   typed stops                    HttpStop { kind: auth · forbidden · not-found ·
//                                  rate · server · invalid · redirect · network }
//                                  -- the adapter decides which of them is a
//                                  collection's status and which ends the run
//
// Nothing here logs a header, a body or a URL with its query string, and no
// message it builds contains the credential: every sentence is made of a status
// code and the names of permissions a source reported missing.
export class HttpStop extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    Object.assign(this, { kind, ...extra });
  }
}

export const LIMITS = { timeoutMs: 60000, requests: 20000, waitMs: 10 * 60 * 1000, retries: 3, redirects: 3 };

const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

// { fetch, origin, headers, limits, sleep, nowMs, log }
export function createHttp(deps) {
  const origin = originOf(deps.origin);
  const state = { requests: 0, waited: 0 };
  return { origin, request: (url, opts = {}) => request(deps, origin, state, url, opts), used: () => ({ ...state }) };
}

function originOf(host) {
  const url = new URL(host);
  if (url.protocol !== "https:" && !LOOPBACK.test(url.origin)) throw new HttpStop("invalid", "a source is reached over https");
  return url.origin;
}

async function request(deps, origin, state, url, opts, hop = 0) {
  const target = sameOrigin(origin, url);
  const response = await attempted(deps, state, target, opts);
  if (response.status >= 300 && response.status < 400) return redirected(deps, origin, state, response, opts, hop);
  return answered(deps, state, response, target, opts);
}

function sameOrigin(origin, url) {
  const target = new URL(url, origin);
  if (target.origin !== origin) throw new HttpStop("redirect", `the source pointed at ${target.host}, which is not this connection's host; Orbit does not follow it with the credential`);
  return target;
}

// A redirect inside the origin is followed a few times; one out of it ends here.
function redirected(deps, origin, state, response, opts, hop) {
  if (hop >= (deps.limits?.redirects ?? LIMITS.redirects)) throw new HttpStop("redirect", "the source redirected too many times");
  return request(deps, origin, state, response.headers.get("location") ?? "", opts, hop + 1);
}

// Network failures and 5xx are retried with a growing pause; anything else is
// the answer.
async function attempted(deps, state, target, opts, tries = 0) {
  counted(deps, state);
  const response = await once(deps, target, opts).catch((e) => ({ failed: e }));
  if (!retryable(response) || tries >= (deps.limits?.retries ?? LIMITS.retries)) return settled(response);
  await deps.sleep(500 * 2 ** tries);
  return attempted(deps, state, target, opts, tries + 1);
}

function counted(deps, state) {
  state.requests += 1;
  if (state.requests > (deps.limits?.requests ?? LIMITS.requests)) throw new HttpStop("rate", `this run has made ${state.requests - 1} requests, its budget; nothing more was asked of the source`);
}

const once = (deps, target, opts) => deps.fetch(target.href, { method: opts.method ?? "GET", headers: { ...deps.headers, ...(opts.body ? { "content-type": "application/json" } : {}), accept: opts.accept ?? "application/json", ...(opts.headers ?? {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined, redirect: "manual", signal: AbortSignal.timeout(deps.limits?.timeoutMs ?? LIMITS.timeoutMs) });

const retryable = (r) => Boolean(r.failed) || r.status >= 500;

function settled(response) {
  if (response.failed) throw new HttpStop("network", `the source could not be reached (${response.failed.name === "TimeoutError" ? "it did not answer in time" : "network error"})`);
  if (response.status >= 500) throw new HttpStop("server", `the source kept failing (HTTP ${response.status})`);
  return response;
}

// A rate limit the source names is WAITED for, within the run's wait budget,
// and asked again; past the budget the run stops and says when it resets.
async function answered(deps, state, response, target, opts) {
  const wait = rateWait(response, deps.nowMs());
  if (wait !== null) return waited(deps, state, wait, target, opts);
  if (response.status >= 400) throw stopOf(response, await textOf(response));
  return { status: response.status, headers: response.headers, json: await jsonOf(response), url: target.href };
}

function rateWait(response, now) {
  if (![403, 429].includes(response.status)) return null;
  const after = Number(response.headers.get("retry-after"));
  if (Number.isFinite(after) && after >= 0 && response.headers.get("retry-after") !== null) return after * 1000;
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  return response.headers.get("x-ratelimit-remaining") === "0" && Number.isFinite(reset) ? Math.max(0, reset * 1000 - now) + 1000 : null;
}

async function waited(deps, state, wait, target, opts) {
  if (state.waited + wait > (deps.limits?.waitMs ?? LIMITS.waitMs)) throw new HttpStop("rate", `the source's rate limit resets at ${new Date(deps.nowMs() + wait).toISOString()}, later than this run may wait; run the report again after that`);
  state.waited += wait;
  await deps.sleep(wait);
  return request(deps, new URL(target.href).origin, state, target.href, opts);
}

// The status says what kind of stop it is; the source's own headers may name
// the permission it wanted, and that name is kept -- nothing else of the body.
const STOPS = [
  { when: (r) => r.status === 401, stop: () => new HttpStop("auth", "the credential was refused (HTTP 401): it is expired, revoked or wrong for this host") },
  { when: (r) => r.status === 403 && r.headers.get("x-github-sso"), stop: () => new HttpStop("forbidden", "the organization requires single sign-on for this credential; authorize it for SSO, then run again", { permission: "SSO authorization" }) },
  { when: (r) => r.status === 403, stop: (r, t) => new HttpStop("forbidden", `the credential may not read this (HTTP 403)${permissionOf(r, t) ? `; it needs ${permissionOf(r, t)}` : ""}`, { permission: permissionOf(r, t) }) },
  { when: (r) => r.status === 404, stop: () => new HttpStop("not-found", "not found, or not visible to this credential (HTTP 404)") },
  { when: () => true, stop: (r, t) => new HttpStop("invalid", `the source refused the request (HTTP ${r.status})${errorCode(t)}`, { detail: String(t ?? "").slice(0, 500) }) },
];

// A source's own error code (TF…, VS…) is a name, and naming it is what lets a
// person look it up; the rest of the body stays out of the sentence.
const errorCode = (text) => ((c) => (c ? ` — ${c[1]}` : ""))(/\b((?:TF|VS)\d{5,6})\b/.exec(text ?? ""));

const stopOf = (response, text) => STOPS.find((s) => s.when(response)).stop(response, text);

// GitHub names the fine-grained permission it wanted in a header; Azure DevOps
// says it in a TF error code. Either is a permission's name, never data.
function permissionOf(response, text) {
  const named = response.headers.get("x-accepted-github-permissions");
  if (named) return named.split(";")[0].split(",").map((p) => p.trim().replace("=", ": ")).filter(Boolean).join(", ");
  const tf = /\b(TF\d{6})\b/.exec(text ?? "");
  return tf ? `the permission named by ${tf[1]}` : null;
}

async function textOf(response) {
  try { return (await response.text()).slice(0, 2000); }
  catch { return ""; }
}

// An answer that is not JSON is not an answer -- a sign-in page returned as
// 203, an HTML error page from a proxy.
async function jsonOf(response) {
  if (response.status === 204) return null;
  const type = response.headers.get("content-type") ?? "";
  if (response.status === 203 || !/json/.test(type)) throw new HttpStop("auth", `the source answered with a page instead of data (HTTP ${response.status}); the credential is most likely not valid for this organization`);
  try { return await response.json(); }
  catch { throw new HttpStop("invalid", "the source answered with data that is not readable JSON"); }
}

// ---- pacing ------------------------------------------------------------------

// Steps one after another, each answer kept in order.
export async function inTurn(steps, done = []) {
  if (!steps.length) return done;
  done.push(await steps[0]());
  return inTurn(steps.slice(1), done);
}

// fn over items, at most `n` at once, results in the items' order.
export async function limited(items, n, fn) {
  const out = new Array(items.length);
  const next = { i: 0 };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, () => worker(items, fn, out, next)));
  return out;
}

async function worker(items, fn, out, next) {
  for (let i = next.i++; i < items.length; i = next.i++) out[i] = await fn(items[i]);
}
