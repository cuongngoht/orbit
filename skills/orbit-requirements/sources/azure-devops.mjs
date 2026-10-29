// Reading ONE Azure DevOps work item through a connection: the pack reader for the
// `azure-devops` descriptor. The work item comes with its relations in one request
// (`$expand=relations`); comments and revisions are their own. Which relation names
// mean parent, child and related, and which artifact links are pull requests and
// commits, are the descriptor's data -- this file only reads the answer shape.
//
// Descriptions and acceptance criteria arrive as HTML and leave as the plain text a
// person read. They are untrusted data from another system: nothing here follows
// them, and the engine never stores them.
//
// What authorizes a request is the connection's RequestAuth, asked for when a request is
// made and sent in one header to the one host the connection names; nothing this returns
// contains it. It asks through the one client every Azure DevOps reader shares, which only
// reads (../../orbit-report/sources/azure-devops-client.mjs). The comments API is a PREVIEW
// API at the version below, which is why it is named next to its path.
import { Refused } from "../../../src/errors.mjs";
import { answered } from "../../../src/sources/readers/answer.mjs";
import { baseOf, clientOf } from "../../orbit-report/sources/azure-devops-client.mjs";
import { matchRef } from "../descriptor.mjs";
import { authsOf, connectionFor, encoded, guarded, htmlText, httpFor, leakFree, pseudonym, readerKey } from "./common.mjs";

const API = "api-version=7.1";
const COMMENTS_API = "api-version=7.1-preview.4";

const F = { title: "System.Title", type: "System.WorkItemType", state: "System.State", body: "System.Description", acceptance: "Microsoft.VSTS.Common.AcceptanceCriteria", changed: "System.ChangedDate", project: "System.TeamProject" };

const text = (html) => (html ? htmlText(html) : undefined);

const tail = (url) => decodeURIComponent(String(url ?? "").split("/").filter(Boolean).at(-1) ?? "").split("/").at(-1);

const safe = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 40);

// One relation as the engine's words say it: a work item by its id, or an artifact
// (a pull request, a commit) as context by a reference of its own.
function relationOf(d, r) {
  const way = d.relations[r.rel];
  if (way) return { way, ref: tail(r.url) };
  const kind = r.rel === "ArtifactLink" ? d.kinds[r.attributes?.name] : undefined;
  return kind ? { way: "implements", kind, ref: `${kind}-${safe(tail(r.url))}` } : null;
}

const KEEP = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function related(d, relations) {
  const rows = (relations ?? []).map((r) => relationOf(d, r)).filter((r) => r && KEEP.test(r.ref));
  return { parent: rows.find((r) => r.way === "parent")?.ref, children: rows.filter((r) => r.way === "child").map((r) => r.ref), related: rows.filter((r) => ["related", "implements"].includes(r.way)).map((r) => ({ ref: r.ref, relation: r.way, ...(r.kind ? { kind: r.kind } : {}) })) };
}

const itemPath = (api, identity) => `${api.base}/_apis/wit/workitems/${encoded(identity.id)}?$expand=relations&${API}`;

// An item in another project than the identity says would attach a stranger's text to
// this one's name; ids are unique across an organization, so the project is the check.
function inProject(fields, identity) {
  if (identity.project && fields[F.project] && String(fields[F.project]).toLowerCase() !== identity.project.toLowerCase()) throw new Refused(`item ${identity.id} is in project ${fields[F.project]}, not ${identity.project}`);
}

async function workitem(api, identity) {
  const j = (await api.http.request(itemPath(api, identity))).json;
  inProject(j.fields ?? {}, identity);
  return { type: j.fields[F.type], title: j.fields[F.title], state: j.fields[F.state], revision: j.rev, updatedAt: j.fields[F.changed], url: j._links?.html?.href, body: text(j.fields[F.body]), acceptance: text(j.fields[F.acceptance]), ...related(api.descriptor, j.relations) };
}

async function relations(api, identity) {
  const j = (await api.http.request(itemPath(api, identity))).json;
  inProject(j.fields ?? {}, identity);
  return related(api.descriptor, j.relations);
}

async function comments(api, identity) {
  if (!identity.project) throw new Refused("Azure DevOps comments are read inside a project — the identity names none");
  const j = (await api.http.request(`${api.base}/${encoded(identity.project)}/_apis/wit/workItems/${encoded(identity.id)}/comments?${COMMENTS_API}`)).json;
  return { comments: (j.comments ?? []).map((c) => ({ id: String(c.id), at: c.createdDate, by: pseudonym(c.createdBy?.displayName), text: htmlText(c.text) })) };
}

async function history(api, identity) {
  const j = (await api.http.request(`${api.base}/_apis/wit/workItems/${encoded(identity.id)}/revisions?${API}`)).json;
  return { revisions: (j.value ?? []).map((r) => ({ revision: String(r.rev), ...(r.fields?.[F.changed] ? { at: r.fields[F.changed] } : {}) })) };
}

const READS = { "workitem.read": workitem, "workitem.relations.read": relations, "workitem.comments.read": comments, "workitem.history.read": history };

// The client for ONE read: the connection for this organization, the RequestAuth it resolves
// to (the same one for every read, so a token is asked for once) and the host it names.
function clientFor(deps, authOf, identity) {
  const connection = connectionFor(deps.descriptor, identity, deps.connections);
  const auth = authOf(connection);
  const base = baseOf(connection);
  return { http: httpFor(deps, base, auth, {}, clientOf), base, auth, descriptor: deps.descriptor };
}

async function read(deps, authOf, identity, capability) {
  const asked = READS[capability];
  if (!asked) throw new Refused(`the ${deps.descriptor.label} reader does not provide ${capability}`);
  const api = clientFor(deps, authOf, identity);
  const item = await guarded(api.auth, () => asked(api, identity));
  return answered(leakFree(item, api.auth.secrets()), capability, readerKey(deps.descriptor), identity);
}

// deps: { descriptor, connections, auth (createAuth), interactive?, notify?, fetch, nowMs, sleep?, limits? }
export function azureDevOpsReader(deps) {
  const authOf = authsOf(deps);
  return { key: readerKey(deps.descriptor), kind: "pack", provides: deps.descriptor.provides.filter((p) => p in READS), resolves: (ref) => matchRef(deps.descriptor, ref), read: (identity, capability) => read(deps, authOf, identity, capability) };
}
