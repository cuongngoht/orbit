// Reading ONE GitHub issue -- and what is around it -- through a connection: the
// pack reader for the `github` descriptor. It asks three questions of the REST API
// (the issue, the comments, the links) and answers each as the part of a work item
// it is about; the engine composes them.
//
// It reads the credential when a request is made, sends it in one header to the one
// host the connection names, and returns nothing that contains it. A pull request is
// not a requirement: asked for one as an issue, it refuses -- a pull request is what
// was BUILT, and only ever context.
import { Refused } from "../../../src/errors.mjs";
import { answered } from "../../../src/sources/readers/answer.mjs";
import { matchRef } from "../descriptor.mjs";
import { connectionFor, credentialOf, encoded, guarded, httpFor, leakFree, optional, pseudonym, readerKey } from "./common.mjs";

const PAGE = "per_page=100";

const repoOf = (identity) => {
  if (!identity.project) throw new Refused("a GitHub issue lives in a repository — the identity names no project");
  return `/repos/${encoded(identity.organization)}/${encoded(identity.project)}`;
};

const at = (identity) => `${repoOf(identity)}/issues/${encoded(identity.id)}`;

async function issue(api, identity) {
  const i = (await api.http.request(`${api.base}${at(identity)}`)).json;
  if (i.pull_request) throw new Refused(`#${identity.id} is a pull request, and a pull request is implementation context, not a requirement source`);
  return { type: "issue", title: i.title, state: i.state, revision: i.updated_at, updatedAt: i.updated_at, url: i.html_url, body: i.body ?? undefined };
}

async function comments(api, identity) {
  const list = (await optional(api, `${at(identity)}/comments?${PAGE}`)) ?? [];
  return { comments: list.map((c) => ({ id: String(c.id), at: c.created_at, by: pseudonym(c.user?.login), text: c.body ?? "" })) };
}

// A link from another issue in THIS repository is related; from a pull request it is
// what was built for this (context). Anything from another repository is not followed.
function linked(d, identity, events) {
  const repo = `/repos/${identity.organization}/${identity.project}`.toLowerCase();
  const found = events.filter((e) => e.event === "cross-referenced" && e.source?.issue && String(e.source.issue.repository_url ?? "").toLowerCase().endsWith(repo));
  return found.map((e) => relation(d, e.source.issue)).filter(Boolean);
}

function relation(d, issueLike) {
  if (!issueLike.pull_request) return { ref: String(issueLike.number), relation: "related" };
  return d.kinds.pull_request ? { ref: `pr-${issueLike.number}`, relation: "implements", kind: d.kinds.pull_request } : null;
}

const unique = (rows) => rows.filter((r, i) => rows.findIndex((x) => x.ref === r.ref) === i);

async function relations(api, identity) {
  const parent = await optional(api, `${at(identity)}/parent`);
  const subs = (await optional(api, `${at(identity)}/sub_issues?${PAGE}`)) ?? [];
  const events = (await optional(api, `${at(identity)}/timeline?${PAGE}`)) ?? [];
  return { ...(parent?.number ? { parent: String(parent.number) } : {}), children: subs.map((s) => String(s.number)), related: unique(linked(api.descriptor, identity, events)) };
}

const READS = { "workitem.read": issue, "workitem.comments.read": comments, "workitem.relations.read": relations };

// The client for ONE read: the connection for this owner, its credential read now,
// the API host it names, and the header the credential goes in.
async function clientFor(deps, identity) {
  const connection = connectionFor(deps.descriptor, identity, deps.connections);
  const credential = await credentialOf(connection, deps.connections, deps.secrets);
  const base = connection.host.replace(/\/+$/, "");
  const http = httpFor(deps, base, { authorization: `Bearer ${credential}`, "x-github-api-version": "2022-11-28" });
  return { http, base, credential, descriptor: deps.descriptor };
}

async function read(deps, identity, capability) {
  const asked = READS[capability];
  if (!asked) throw new Refused(`the ${deps.descriptor.label} reader does not provide ${capability}`);
  const api = await clientFor(deps, identity);
  const item = await guarded(() => asked(api, identity));
  return answered(leakFree(item, api.credential), capability, readerKey(deps.descriptor), identity);
}

// deps: { descriptor, connections, secrets, fetch, nowMs, sleep?, limits? }
export const githubReader = (deps) => ({ key: readerKey(deps.descriptor), kind: "pack", provides: deps.descriptor.provides.filter((p) => p in READS), resolves: (ref) => matchRef(deps.descriptor, ref), read: (identity, capability) => read(deps, identity, capability) });
