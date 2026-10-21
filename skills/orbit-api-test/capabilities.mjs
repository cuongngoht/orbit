// The orbit-api-test PACK's capabilities (ADR 0034, doc §5.2): orbit.http.read and
// orbit.http.write, behind the one `call` verb -- no `http` verb, no second DSL.
//
// Both are pageless and both reach the system under test only through their helper
// (http/helper.mjs), started by the engine with what the binding gate resolved: the endpoint a
// task's sandbox started, the approved identity, the pinned schema. A case names those by
// logical ref and never as a URL, a host or a credential. What comes back is an observation --
// status, allow-listed headers, a projected body, a schema verdict, digests -- and the case's
// `expect` rules on it; a provider never answers PASS.
//
// `write` declares that it mutates: it runs only where a test grant covers it (ADR 0037), and
// a write whose answer was lost is ambiguous -- read back, never resent.
const PATH = "^/(?!/)[^\\s#\\\\]*$";

const shared = {
  endpointRef: { type: "string", bind: "endpoint", doc: "The endpoint, by its alias in the task's sandbox: a component this task started. Never a URL." },
  identityRef: { type: "string", bind: "identity", doc: "The approved identity to ask as, by alias. Anonymous when it is absent." },
  path: { type: "string", pattern: PATH, doc: "The path, relative to the bound endpoint: starts with /, never //, never climbs." },
  query: { type: "object", doc: "Query parameters, sent in a stable order." },
  headers: { type: "object", doc: "Headers from a short allow-list (accept, content-type, if-match, idempotency-key, prefer, a correlation id) plus what the contract declares. Never authorization, cookie, host or a forwarding header." },
  redirects: { type: "integer", minimum: 0, maximum: 5, doc: "How many redirects to follow, each inside the bound origin. 0 by default: a redirect is then what was observed." },
  schemaRef: { type: "string", bind: "schema", doc: "A pinned schema the answer body is held to (JSON Schema 2020-12, the declared subset). Anything outside it is a capability gap, never skipped." },
};

const OUTPUTS = { status: "response.status", headers: "response.headers", body: "response.body", schema: "schema.valid", elapsedMs: "elapsed.ms" };

const helper = { argv: ["http/helper.mjs"], runIn: "worker" };

const requestOf = (input) => ({ method: input.method, path: input.path, query: input.query ?? {}, headers: input.headers ?? {}, body: input.body, redirects: input.redirects ?? 0 });

export default [
  {
    id: "orbit.http.read",
    apiVersion: "orbit.capability/v1",
    doc: "ask a synchronous HTTP interface of a component the task started, and observe its answer",
    page: false,
    inputSchema: { ...shared, method: { enum: ["GET", "HEAD", "OPTIONS"], doc: "GET, HEAD or OPTIONS." } },
    required: ["endpointRef", "method", "path"],
    effects: ["read"],
    outputs: OUTPUTS,
    timeoutSec: 10,
    helper,
    invoke: (ext, input) => ext.helper.run("read", requestOf(input)),
  },
  {
    id: "orbit.http.write",
    apiVersion: "orbit.capability/v1",
    doc: "send a write to a synchronous HTTP interface of a component the task started, inside the task's fixture, and observe its answer",
    page: false,
    mutates: true,
    inputSchema: { ...shared, method: { enum: ["POST", "PUT", "PATCH", "DELETE"], doc: "POST, PUT, PATCH or DELETE." }, body: { doc: "The body: an object is sent as JSON, a string as it is." } },
    required: ["endpointRef", "method", "path"],
    effects: ["write"],
    outputs: OUTPUTS,
    timeoutSec: 10,
    helper,
    invoke: (ext, input) => ext.helper.run("write", requestOf(input)),
  },
];
