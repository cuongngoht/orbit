// One exchange with a bound endpoint (doc §5.2; ADR 0036).
//
// The request is built from the case's input and the run's bindings and refused, whole, the
// moment any part of it is something a case may not say. Redirects are followed only as far
// as the case asked (none by default) and only inside the bound origin; a hop elsewhere is
// recorded and not taken. The body is read up to a bound, and an answer past it is INCOMPLETE
// -- nothing is concluded from part of an answer. And every way the exchange can fail is said
// as a helper class: nothing reached is transport, a write whose answer was lost is AMBIGUOUS
// with its operation key (read back, never resent), a read past its deadline is a timeout. A
// response is never a failure: a 500 is an observation `expect` judges.
import { schemaDigest, validateSchema } from "../schema.mjs";
import { bodyOf, credentialOf, headersOf, pathProblem, urlOf } from "./request.mjs";
import { projection, requestDigest } from "./response.mjs";

export const DEFAULT_BODY_BYTES = 1024 * 1024;
export const MAX_REDIRECTS = 5;

const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const BODILESS = new Set(["GET", "HEAD", "OPTIONS"]);
// Codes that mean nothing left this machine: even a write is then plainly unsent.
const UNSENT = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT", "ERR_INVALID_URL"]);

export async function exchange(asked, deps) {
  const built = STEPS.reduce((acc, step) => (acc.problem ? acc : { ...acc, ...step(asked, deps.env, acc) }), {});
  if (built.problem) return { failure: { class: "refused", message: built.problem } };
  const sent = await followed(built, asked, deps);
  if (sent.failure) return sent;
  return judged(projection(sent.response, optsOf(built, asked)));
}

// The request, one checked part at a time; the first part that is wrong stops it.
const STEPS = [
  (a) => ({ problem: pathProblem(a.request?.path) ?? (a.bound?.endpointRef?.origin ? null : "no endpoint is bound for endpointRef — a task's sandbox binds one") }),
  (a) => urlOf(a.bound.endpointRef.origin, a.request.path, a.request.query),
  (a) => headersOf(a.request.headers, a.bound.endpointRef.headers ?? []),
  (a, env, acc) => credentialOrProblem(credentialOf(a.bound.identityRef, env), acc),
  (a, env, acc) => bodyStep(a, acc),
  (a) => schemaStep(a.bound.schemaRef),
];

const credentialOrProblem = (c, acc) => (c.problem ? { problem: c.problem } : { secret: c.secret, headers: { ...acc.headers, ...c.headers }, caseHeaders: acc.headers });

function bodyStep(a, acc) {
  const method = String(a.request.method ?? "").toUpperCase();
  if (BODILESS.has(method) && a.request.body !== undefined) return { problem: `${method} carries no body` };
  const b = bodyOf(a.request.body, acc.headers);
  return { method, body: b.body, headers: b.headers, digest: requestDigest(method, acc.url, { ...acc.caseHeaders, ...(b.headers["content-type"] ? { "content-type": b.headers["content-type"] } : {}) }, b.body) };
}

// A bound schema is pinned: one whose digest moved since the design was written is refused as
// stale rather than silently applied.
function schemaStep(ref) {
  if (!ref) return {};
  if (ref.digest && schemaDigest(ref.document) !== ref.digest) return { problem: `the schema bound as ${ref.alias ?? "schemaRef"} has moved since it was pinned — refused as stale` };
  return { schemaDoc: ref.document };
}

async function followed(b, asked, deps) {
  const limit = Math.min(Number(asked.request.redirects ?? 0) || 0, MAX_REDIRECTS);
  const deadline = deps.now() + Number(asked.deadlineMs ?? 30000);
  return hop({ url: b.url, method: b.method, body: b.body, hops: [] }, { b, asked, deps, limit, deadline });
}

async function hop(at, run) {
  const got = await one(at, run);
  if (got.failure || !followable(got.response, at, run)) return got;
  return hop(nextOf(at, got.response), run);
}

async function one(at, run) {
  const started = run.deps.now();
  try { return { response: await read(await run.deps.fetch(at.url, initOf(at, run)), at, started, run) }; }
  catch (e) { return { failure: failureOf(e, run) }; }
}

const initOf = (at, run) => ({ method: at.method, headers: run.b.headers, body: at.body, redirect: "manual", signal: AbortSignal.timeout(Math.max(Math.floor(run.deadline - run.deps.now()), 1)) });

async function read(res, at, started, run) {
  const body = await capped(res.body, run.asked.limits?.bodyBytes ?? DEFAULT_BODY_BYTES);
  const headers = Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  return { status: res.status, headers, text: body.text, bytes: body.bytes, elapsedMs: Math.round(run.deps.now() - started), hops: at.hops };
}

async function capped(stream, cap) {
  const got = { chunks: [], bytes: 0 };
  for await (const chunk of stream ?? []) gathered(got, chunk, cap);
  return { text: Buffer.concat(got.chunks).toString("utf8"), bytes: got.bytes };
}

function gathered(got, chunk, cap) {
  got.bytes += chunk.length;
  if (got.bytes > cap) throw Object.assign(new Error(`the body went past ${cap} bytes`), { incomplete: true });
  got.chunks.push(Buffer.from(chunk));
}

// A redirect is taken only while the case allowed more hops and only to the same origin; one
// to anywhere else is recorded as refused and the 3xx is what was observed.
function followable(r, at, run) {
  if (!REDIRECTS.has(r.status) || at.hops.length >= run.limit || !r.headers.location) return false;
  const to = new URL(r.headers.location, at.url);
  if (to.origin === run.b.url.origin) return true;
  return void at.hops.push({ status: r.status, refused: "another origin" }), false;
}

function nextOf(at, r) {
  const to = new URL(r.headers.location, at.url);
  const asGet = r.status === 303 || ((r.status === 301 || r.status === 302) && at.method === "POST");
  return { url: to, method: asGet ? "GET" : at.method, body: asGet ? undefined : at.body, hops: [...at.hops, { status: r.status, to: `${to.pathname}${to.search}` }] };
}

const codeOf = (e) => e?.cause?.code ?? e?.code ?? null;
const timedOut = (e) => e?.name === "TimeoutError" || e?.name === "AbortError" || e?.cause?.name === "TimeoutError";

const FAILURES = [
  { when: (e) => e?.incomplete, as: (e) => ({ class: "incomplete", message: `${e.message} — nothing is concluded from part of an answer` }) },
  { when: (e) => UNSENT.has(codeOf(e)), as: (e) => ({ class: "transport", message: `the endpoint could not be reached (${codeOf(e)}) — nothing was sent` }) },
  { when: (e, run) => run.asked.op === "write", as: (e, run) => ({ class: "ambiguous", message: `the write was sent and its answer was lost (${codeOf(e) ?? e?.name ?? "error"})`, operationKey: run.b.headers["idempotency-key"] ?? run.b.digest }) },
  { when: (e) => timedOut(e), as: () => ({ class: "timeout", message: "no answer before the deadline" }) },
  { when: () => true, as: (e) => ({ class: "transport", message: `the exchange failed (${codeOf(e) ?? e?.name ?? "error"})` }) },
];

const failureOf = (e, run) => FAILURES.find((f) => f.when(e, run)).as(e, run);

const optsOf = (b, asked) => ({
  secret: b.secret,
  responseHeaders: asked.bound.endpointRef.responseHeaders ?? [],
  endpoint: asked.bound.endpointRef.alias ?? null,
  identity: asked.bound.identityRef?.alias ?? null,
  requestDigest: b.digest,
  schema: b.schemaDoc ? (body) => verdictOf(validateSchema(b.schemaDoc, body)) : null,
});

const verdictOf = (r) => ({ valid: r.valid, errors: r.errors, gaps: r.gaps, dialect: r.dialect, digest: r.digest });

// A schema this validator cannot read whole is a capability gap, never a verdict: the answer
// stops here rather than reaching an `expect` that would read `valid: null` as a failure.
function judged(value) {
  if (!value.schema?.gaps?.length) return { value };
  return { failure: { class: "incomplete", message: `the bound schema uses ${value.schema.gaps.map((g) => g.keyword).join(", ")}, which this validator does not support`, gap: { need: "capability", capability: "json-schema", context: { dialect: value.schema.dialect, keywords: value.schema.gaps.map((g) => g.keyword) } } } };
}
