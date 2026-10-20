// The AUTHORISATION CONTRACT a tenant-isolation check is held to -- declared by
// a person, never inferred. Pure: what the contract may say, and the matrix it
// yields. Running it is src/investigation/security.mjs.
//
//   claim       the token claim that names a tenant (default "tid")
//   tenants     { <logical tenant>: <that claim's value> }
//   identities  { <as>: [<tenant>, …] }   the tenants that identity may LEGITIMATELY
//               act in -- more than one is allowed, which is why a mismatch
//               between a session's tenant and a resource's is never, on its
//               own, evidence of anything
//   resources   { <id>: { tenant, marker, route?, api?, search?, data?, write? } }
//               an approved SYNTHETIC record: `marker` is a unique text only it
//               carries, so "tenant B saw it" is a boolean, never a copy of data
//   matrix      [{ identity, resource, operation, expect, status? }]
//   writeProbes whether an `update` row may attempt a write at all
//
// Nothing here names an identity provider, a claim format beyond "a claim has a
// value", a route or a product. Which claim and which values are the project's.
import { readOnlyProblem } from "../dsl/sql-text.mjs";

// What each operation asks of a resource, and which channels it is witnessed
// through. `writes` rows need writeProbes and an approved security-test mode.
export const OPERATIONS = [
  { id: "read", writes: false, needs: (r) => Boolean(r.route || r.api), expects: ["allowed", "denied"] },
  { id: "search", writes: false, needs: (r) => Boolean(r.search), expects: ["included", "excluded"] },
  { id: "update", writes: true, needs: (r) => Boolean(r.write?.api && r.data?.query), expects: ["allowed", "denied"] },
  { id: "unchanged", writes: false, needs: (r) => Boolean(r.data?.query), expects: ["unchanged"] },
];

const operationOf = (id) => OPERATIONS.find((o) => o.id === id) ?? null;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/;
const WRITE_METHODS = ["PUT", "PATCH", "POST", "DELETE"];
const isObject = (v) => Boolean(v) && typeof v === "object" && !Array.isArray(v);

export function tenancyProblems(t) {
  if (t === null || t === undefined) return [];
  if (!isObject(t)) return ["tenancy is an object, or null"];
  return CONTRACT.filter((r) => r.fails(t)).map((r) => r.says(t));
}

const resources = (t) => Object.entries(t.resources ?? {});
const rows = (t) => (Array.isArray(t.matrix) ? t.matrix : []);
const badRows = (t, test) => rows(t).map((r, i) => [r, i + 1]).filter(([r]) => test(r, t));

// Ordered; each sentence says what to write instead.
const CONTRACT = [
  { fails: (t) => t.claim !== undefined && (typeof t.claim !== "string" || !t.claim), says: () => "tenancy.claim is the name of the token claim that carries the tenant, e.g. tid" },
  { fails: (t) => !isObject(t.tenants) || !Object.keys(t.tenants).length || Object.entries(t.tenants).some(([k, v]) => !NAME.test(k) || typeof v !== "string" || !v), says: () => "tenancy.tenants maps a logical tenant name to that claim's value, e.g. { \"A\": \"<tid>\" }" },
  { fails: (t) => !isObject(t.identities) || Object.entries(t.identities).some(([k, v]) => !NAME.test(k) || !Array.isArray(v) || !v.length || v.some((x) => !t.tenants?.[x])), says: () => "tenancy.identities maps an identity (`as`) to the tenants it may act in, each one of tenancy.tenants" },
  { fails: (t) => !isObject(t.resources) || resources(t).some(([k, r]) => !NAME.test(k) || !isObject(r) || !t.tenants?.[r.tenant]), says: () => "tenancy.resources maps an id to { tenant, marker, route | api | search, data?, write? }, tenant one of tenancy.tenants" },
  { fails: (t) => resources(t).some(([, r]) => typeof r.marker !== "string" || r.marker.length < 6), says: () => "every tenancy resource names a `marker` of 6+ characters: a unique text only that SYNTHETIC record carries" },
  { fails: (t) => resources(t).some(([, r]) => ["route", "api", "search"].some((k) => r[k] !== undefined && !String(r[k]).startsWith("/"))), says: () => "a resource's route, api and search are paths on the environment's origin, starting with /" },
  { fails: (t) => resources(t).some(([, r]) => r.data && (!r.data.table || readOnlyProblem(r.data.query ?? ""))), says: () => "a resource's data is { query, table } and the query is ONE read-only SELECT" },
  { fails: (t) => resources(t).some(([, r]) => r.write && (!WRITE_METHODS.includes(String(r.write.method).toUpperCase()) || !String(r.write.api ?? "").startsWith("/"))), says: () => `a resource's write is { method: ${WRITE_METHODS.join("|")}, api: "/…", body? }` },
  { fails: (t) => !rows(t).length, says: () => "tenancy.matrix lists at least one { identity, resource, operation, expect } row" },
  { fails: (t) => badRows(t, (r) => !t.identities?.[r.identity] || !t.resources?.[r.resource]).length > 0, says: (t) => `matrix row ${badRows(t, (r) => !t.identities?.[r.identity] || !t.resources?.[r.resource]).map(([, i]) => i).join(", ")} names an identity or a resource the contract does not declare` },
  { fails: (t) => badRows(t, (r) => !operationOf(r.operation)?.expects.includes(r.expect)).length > 0, says: () => `each matrix row's operation is one of ${OPERATIONS.map((o) => `${o.id} (${o.expects.join("|")})`).join(", ")}` },
  { fails: (t) => badRows(t, (r, c) => operationOf(r.operation) && c.resources?.[r.resource] && !operationOf(r.operation).needs(c.resources[r.resource])).length > 0, says: () => "a matrix row's resource lacks what its operation needs: read needs route or api, search needs search, update needs write + data, unchanged needs data" },
  { fails: (t) => badRows(t, (r) => r.status !== undefined && (!Array.isArray(r.status) || r.status.some((s) => !Number.isInteger(s) || s < 100 || s > 599))).length > 0, says: () => "a matrix row's status is the list of HTTP statuses the contract accepts, e.g. [403, 404]" },
  { fails: (t) => t.writeProbes !== true && rows(t).some((r) => operationOf(r.operation)?.writes), says: () => "an update row attempts a write: set tenancy.writeProbes to true, deliberately, or remove the row" },
];

// The matrix, in the order a person wrote it, with what the contract says
// about the identity: which tenants it may act in, and the claim values those
// are. An `update` row always runs before the `unchanged` row that follows it,
// because that is the order the person declared.
export function matrixOf(t) {
  return rows(t).map((r, i) => ({ row: i + 1, ...r, op: operationOf(r.operation), resourceOf: t.resources[r.resource], tenantsOf: t.identities[r.identity], claimValues: t.identities[r.identity].map((x) => t.tenants[x]) }));
}

// Does the contract allow this identity in this resource's tenant AT ALL? A
// row expecting "denied" for an identity that legitimately belongs to the
// resource's tenant is a contradiction in the contract, and it is reported as
// one rather than run.
export const belongs = (row) => row.tenantsOf.includes(row.resourceOf.tenant);
