// The ONE way into Azure DevOps, for everything that reads it -- the report's collector and probe, and the requirement
// reader: where an organization is, what may be asked of it, and what authorization each request carries.
//
// READ-ONLY BY CONSTRUCTION. Every request the integration may make is a row of OPERATIONS, classified by what it MEANS:
//
//   read    a GET of one resource, or of one page of a list
//   query   a POST that only ASKS: the work item query language (WIQL) and a batch of work items by id are sent in a body
//           because they do not fit in a URL -- they select, and change nothing
//
// `readOnly` refuses anything else before a header is built or a byte leaves: a PUT, a PATCH, a DELETE, and any POST that
// is not one of the two queries (creating a work item, a comment, a pull request is a POST too). The report and the
// requirement reader hold no permission to write, and this is the place that makes sure they never ask.
//
// Authorization is a RequestAuth's (src/connections/auth.mjs): asked for at every hop, refreshed once when the source says
// the token is no longer good -- never stored, never built here. Nothing in this file knows how a person signed in.
import { Refused } from "../../../src/errors.mjs";
import { authorizedHttp } from "./http.mjs";

// https://dev.azure.com/<organization>, or a Server collection URL that already ends in the collection's name.
export function baseOf(connection) {
  const host = connection.host.replace(/\/+$/, "");
  return host.toLowerCase().endsWith(`/${String(connection.organization).toLowerCase()}`) ? host : `${host}/${connection.organization}`;
}

// Matched on the method and the PATH (never the query string): the first row that fits says what the request is.
export const OPERATIONS = [
  { id: "wiql", kind: "query", method: "POST", path: /\/_apis\/wit\/wiql$/, doc: "a WIQL query: selects work items by a condition, and changes nothing" },
  { id: "workitemsbatch", kind: "query", method: "POST", path: /\/_apis\/wit\/workitemsbatch$/, doc: "a batch of work items by id, as of a moment: a POST because the ids do not fit in a URL" },
  { id: "read", kind: "read", method: "GET", path: /\/_apis\//, doc: "a GET of a resource of the REST API, or one page of a list" },
];

// What a request is, or nothing: the table is the only thing that can say a request is allowed.
export const operationOf = (method, path) => OPERATIONS.find((o) => o.method === String(method).toUpperCase() && o.path.test(path)) ?? null;

// The same client, refusing a request the table does not know -- before it is asked of anybody.
export function readOnly(http) {
  return { ...http, request: async (url, opts = {}) => (permitted(http.origin, url, opts), http.request(url, opts)) };
}

function permitted(origin, url, opts) {
  const method = String(opts.method ?? "GET").toUpperCase();
  const path = new URL(url, origin).pathname;
  if (operationOf(method, path)) return;
  throw new Refused(`Orbit reads Azure DevOps and never changes it: a ${method} request to ${path} is not one of the reads or queries it makes`);
}

// The client every Azure DevOps reader goes through.
// d: { fetch, origin, auth (a RequestAuth), headers? (the source's own, besides authorization), sleep, nowMs, limits }
export const clientOf = (d) => readOnly(authorizedHttp(d));
