// An OpenAPI 3.x contract, READ into a criterion's structured expectations (doc §4.3): what an accepted HTTP contract
// says ONE operation answers -- its status, and, when the response declares a JSON schema, that the body conforms to
// it -- as candidate `expects` a person puts in a plan's criterion, with where each came from. It reads and decides
// nothing: no threshold, no field, no status the document does not state, and the criterion's authority is still the
// plan's (a draft prepares tests and never rules on one). A document it does not read is SAID, never half-read: another
// OpenAPI version, an operation it does not declare, a status it does not declare, a schema behind a remote $ref.
//
//   openapiExpects(doc, { operation, status? })
//     -> { ok: true, source, request, expects } | { ok: false, findings }
import { canonicalJson, sha } from "../../../src/hash.mjs";

const VERSIONS = /^3\.[01]\.\d+$/;
const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const JSON_TYPES = /^application\/(?:[\w.+-]+\+)?json$/;

// Ordered: the first that holds is why nothing is read.
const READ = [
  { id: "SWAGGER", when: (x) => typeof x.doc?.swagger === "string", say: (x) => `Swagger ${String(x.doc.swagger).slice(0, 10)} (OpenAPI 2) is not read here — 3.0 and 3.1 are` },
  { id: "NOT_OPENAPI", when: (x) => typeof x.doc?.openapi !== "string", say: () => "this is not an OpenAPI document (it names no `openapi` version)" },
  { id: "VERSION", when: (x) => !VERSIONS.test(x.doc.openapi), say: (x) => `OpenAPI ${String(x.doc.openapi).slice(0, 20)} is not read here — 3.0 and 3.1 are` },
  { id: "NO_OPERATION", when: (x) => !x.op, say: (x) => `no operation ${String(x.ask.operation ?? "(none named)").slice(0, 80)} — it declares ${operationsOf(x.doc).map((o) => o.id).join(", ") || "none"}` },
  { id: "NO_STATUS", when: (x) => !x.status, say: (x) => `${x.op.id} declares no ${x.ask.status ? `status ${x.ask.status}` : "success status"} — it declares ${Object.keys(x.op.responses).join(", ")}` },
  { id: "REMOTE_REF", when: (x) => remoteRef(x.response), say: (x) => `${x.op.id} ${x.status}: its schema is behind a remote $ref, and nothing here fetches one` },
];

export function openapiExpects(doc, ask = {}) {
  const x = facts(doc, ask);
  const stop = READ.find((r) => r.when(x));
  if (stop) return { ok: false, findings: [{ rule: stop.id, say: stop.say(x) }] };
  return { ok: true, source: sourceOf(doc), request: { method: x.op.method.toUpperCase(), path: x.op.path, servers: (doc.servers ?? []).map((s) => s.url), parameters: (x.op.parameters ?? []).map((p) => ({ name: p.name, in: p.in, required: p.required === true })) }, expects: expectsOf(doc, x) };
}

function facts(doc, ask) {
  const op = typeof doc?.openapi === "string" ? operationsOf(doc).find((o) => o.id === ask.operation) ?? null : null;
  const status = op ? statusOf(op, ask.status) : null;
  return { doc, ask, op, status, response: status ? resolved(doc, op.responses[status]) : null };
}

const operationsOf = (doc) => Object.entries(doc.paths ?? {}).flatMap(([path, item]) => METHODS.filter((m) => item?.[m]?.operationId).map((m) => ({ id: item[m].operationId, method: m, path, parameters: item[m].parameters ?? [], responses: item[m].responses ?? {}, summary: item[m].summary ?? "" })));

// The status asked for, when the operation declares it; with none asked, the lowest success status it declares.
const statusOf = (op, asked) => (asked !== undefined && asked !== null ? (op.responses[String(asked)] ? String(asked) : null) : Object.keys(op.responses).filter((k) => /^2\d\d$/.test(k)).sort()[0] ?? null);

// A response object, followed through a LOCAL reference (#/components/responses/…); a remote one stays as it is.
const resolved = (doc, r) => (typeof r?.$ref === "string" && r.$ref.startsWith("#/") ? pointer(doc, r.$ref) ?? r : r);

const pointer = (doc, ref) => ref.slice(2).split("/").map((k) => k.replaceAll("~1", "/").replaceAll("~0", "~")).reduce((at, k) => (at && typeof at === "object" ? at[k] : undefined), doc);

const jsonSchemaOf = (response) => Object.entries(response?.content ?? {}).find(([type]) => JSON_TYPES.test(type))?.[1]?.schema ?? null;

const remoteRef = (response) => typeof response?.$ref === "string" && !response.$ref.startsWith("#/") || (typeof jsonSchemaOf(response)?.$ref === "string" && !jsonSchemaOf(response).$ref.startsWith("#/"));

function expectsOf(doc, x) {
  const where = `${doc.info?.title ?? "OpenAPI"} ${doc.info?.version ?? ""}`.trim();
  const said = `${where}: ${x.op.id} (${x.op.method.toUpperCase()} ${x.op.path}) answers ${x.status}${x.response?.description ? ` — ${x.response.description}` : ""}`;
  const schema = jsonSchemaOf(x.response);
  return [{ id: "E1", property: "response.status", op: "eq", value: Number(x.status), because: said.slice(0, 300) }, ...(schema ? [{ id: "E2", property: "response.body", op: "conforms", value: schema.$ref ?? `#/paths/${x.op.path.replaceAll("~", "~0").replaceAll("/", "~1")}/${x.op.method}/responses/${x.status}`, because: `${where}: its body conforms to the schema the ${x.status} response declares`.slice(0, 300) }] : [])];
}

// Where the expectations came from, pinned: the document's own title and version, and the digest of what was read.
const sourceOf = (doc) => ({ kind: "api-contract", ref: doc.info?.title ?? null, revision: doc.info?.version ?? null, digest: sha(canonicalJson(doc)) });
