// The requirements pack: provider knowledge as DATA plus two readers over a
// connection. What is under test is the promise each reader makes -- the credential
// goes in one header to one host and comes back in nothing -- and that the engine
// stays ignorant: every provider word lives in providers.json and skills/, never src/.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuth } from "../src/connections/auth.mjs";
import { AuthBlocked } from "../src/connections/auth-errors.mjs";
import { createConnections } from "../src/connections/manage.mjs";
import { connectionStore } from "../src/connections/store.mjs";
import { Blocked, Refused } from "../src/errors.mjs";
import { secretSource } from "../src/secrets.mjs";
import { readerProblems } from "../src/sources/contract-v1.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { providers } from "../skills/orbit-report/pack.mjs";
import { READERS, connectionEnvFor, descriptorFindings, descriptorsOf, packReaders, providersFile, readerResources } from "../skills/orbit-requirements/bind.mjs";
import { bareIdOf, descriptorProblems, matchRef } from "../skills/orbit-requirements/descriptor.mjs";
import { fakeIo } from "./fakes/io.mjs";

const TOKEN = "SENTINEL-TOKEN-0123456789";
const AT = "2026-09-30T10:00:00.000Z";
const DESCRIPTORS = Object.fromEntries(descriptorsOf().map((d) => [d.id, d]));

// A response as the reporter's http client reads one.
const reply = (status, body, headers = {}) => ({ status, headers: { get: (k) => ({ "content-type": "application/json", ...headers })[k.toLowerCase()] ?? null }, json: async () => body, text: async () => JSON.stringify(body) });

function server(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const hit = routes.find(([re]) => re.test(url));
    return hit ? hit[1](url) : reply(404, {});
  };
  return { fetch, calls };
}

// The real connection store, secret port and auth contract, over an in-memory disk. `adapters` are the sign-in adapters
// by strategy id: none, unless a test signs in.
async function world(made = [], adapters = {}) {
  const env = { REQ_TEST_TOKEN: TOKEN, ...Object.fromEntries(made.filter((m) => m.token).map((m) => [m.envName, m.token])) };
  const secrets = secretSource({ env });
  const io = fakeIo();
  const connections = createConnections({ store: connectionStore(stateRooms("/base"), io), secrets, providers: providers(), now: () => AT });
  for (const m of made) {
    connections.create({ id: m.id, provider: m.provider, host: m.host, organization: m.organization, ...(m.auth ? { auth: m.auth } : {}) });
    if (m.envName) await connections.setCredential(m.id, { env: m.envName });
  }
  return { connections, secrets, env, io, auth: createAuth({ secrets, adapters, providers: providers(), nowMs: () => 0 }) };
}

const GH = { id: "gh-acme", provider: "github", host: "https://api.github.com", organization: "acme", envName: "REQ_TEST_TOKEN" };
// A NEW Azure DevOps connection signs in; one that reads a token says so.
const ADO = { id: "ado-acme", provider: "azure-devops", host: "https://dev.azure.com", organization: "acme", envName: "REQ_TEST_TOKEN", auth: { strategy: "credential" } };
const GH_ID = { provider: "github", organization: "acme", project: "shop", id: "88" };
const ADO_ID = { provider: "azure-devops", organization: "acme", project: "Web Shop", id: "4312" };

const readerOf = (w, s, id) => packReaders({ connections: w.connections, auth: w.auth, fetch: s.fetch, nowMs: () => 0, sleep: async () => {}, limits: { retries: 0 } }).find((r) => r.key.endsWith(`/${id}`));

// ---- the descriptors ----------------------------------------------------------------------

test("the shipped descriptors hold to their shape and every one has a reader", () => {
  assert.deepEqual(descriptorFindings(), []);
  assert.deepEqual(descriptorsOf().map((d) => d.id).sort(), Object.keys(READERS).sort());
  assert.equal(providersFile().schema, 1);
});

test("a descriptor that does not hold is named, and builds no reader", () => {
  const good = DESCRIPTORS.github;
  const has = (over, re) => assert.ok(descriptorProblems({ ...good, ...over }).some((p) => re.test(p)), JSON.stringify(over));
  has({ credentialEnv: "token" }, /credentialEnv must be an environment variable NAME/);
  has({ connection: "Not A Slug" }, /connection must be a connection provider id/);
  has({ match: { urls: ["^https://x/(?<id>\\d+)$"] } }, /must capture \(\?<organization>/);
  has({ match: { urls: ["("] } }, /is not a regular expression/);
  has({ relations: { "Some.Link": "sibling" } }, /must mean one of parent, child, related, implements/);
  has({ kinds: { "Pull Request": "wiki" } }, /must mean one of/);
  has({ provides: ["repository.read"] }, /provides must list acquisition capabilities/);
  has({ mcp: { catalog: "x", tools: {} } }, /read is required/);
  has({ tools: [{ bin: "gh" }] }, /needs a catalog id and a bin/);
  has({ tools: [{ catalog: "x", bin: "gh", defaults: { argv: [1], parse: "x" } }] }, /defaults needs argv/);
  assert.deepEqual(descriptorsOf([{ ...good, credentialEnv: "token" }]), [], "a row that does not hold is left out, not half used");
  assert.deepEqual(descriptorsOf([{ ...good, id: "unheard-of" }]), [], "and so is one nothing can read");
});

test("a link is recognised by its provider and read as an identity; a bare id and a stranger's link are nobody's", () => {
  const { github, "azure-devops": ado } = DESCRIPTORS;
  assert.deepEqual(matchRef(github, "https://github.com/acme/shop/issues/88#issuecomment-1"), GH_ID);
  assert.deepEqual(matchRef(ado, "https://dev.azure.com/acme/Web%20Shop/_workitems/edit/4312"), ADO_ID);
  assert.deepEqual(matchRef(ado, "https://acme.visualstudio.com/Web%20Shop/_workitems/edit/4312?x=1"), ADO_ID);
  for (const ref of ["4312", "#88", "PBI 4312", "https://github.com.evil.test/acme/shop/issues/88", "https://github.com/acme/shop/pull/88", "ftp://github.com/acme/shop/issues/1", ""]) {
    assert.equal(matchRef(github, ref), null, ref);
    assert.equal(matchRef(ado, ref), null, ref);
  }
  assert.equal(bareIdOf(github, "#88"), "88");
  assert.equal(bareIdOf(ado, "4312"), "4312");
  assert.equal(bareIdOf(ado, "PBI 4312"), null);
});

// ---- the readers --------------------------------------------------------------------------

test("both readers are readers by the port's own check, and neither touches the network to recognise a link", async () => {
  const w = await world([GH, ADO]);
  const s = server([]);
  for (const id of ["github", "azure-devops"]) {
    const reader = readerOf(w, s, id);
    assert.deepEqual(readerProblems(reader), [], id);
    reader.resolves(id === "github" ? "https://github.com/a/b/issues/1" : "https://dev.azure.com/a/b/_workitems/edit/1");
  }
  assert.equal(s.calls.length, 0);
});

const GH_ISSUE = { number: 88, title: "Refund limit", body: "SENTINEL-BODY refunds above the limit need approval", state: "open", updated_at: "2026-09-29T10:00:00Z", html_url: "https://github.com/acme/shop/issues/88" };

test("a GitHub issue: the credential goes in one header to one host, and the answer is the part of an item it is about", async () => {
  const w = await world([GH]);
  const s = server([[/\/repos\/acme\/shop\/issues\/88$/, () => reply(200, GH_ISSUE)]]);
  const item = await readerOf(w, s, "github").read(GH_ID, "workitem.read");
  assert.deepEqual([item.ref, item.provider, item.title, item.revision, item.type], ["88", "github", "Refund limit", "2026-09-29T10:00:00Z", "issue"]);
  assert.match(item.body, /SENTINEL-BODY/, "the text is returned to whoever asked");
  assert.equal(s.calls.length, 1);
  assert.equal(s.calls[0].url, "https://api.github.com/repos/acme/shop/issues/88");
  assert.equal(s.calls[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.doesNotMatch(JSON.stringify(item), new RegExp(TOKEN), "and nothing it returns holds the credential");
});

test("a pull request is not a requirement: asked for as an issue, it is refused", async () => {
  const w = await world([GH]);
  const s = server([[/issues\/88$/, () => reply(200, { ...GH_ISSUE, pull_request: { url: "x" } })]]);
  await assert.rejects(readerOf(w, s, "github").read(GH_ID, "workitem.read"), (e) => e instanceof Refused && /implementation context, not a requirement source/.test(e.message));
});

test("GitHub relations: a missing parent is none, sub-issues are children, a linking pull request is context, another repository is not followed", async () => {
  const w = await world([GH]);
  const events = [
    { event: "cross-referenced", source: { issue: { number: 90, repository_url: "https://api.github.com/repos/acme/shop" } } },
    { event: "cross-referenced", source: { issue: { number: 91, pull_request: {}, repository_url: "https://api.github.com/repos/ACME/Shop" } } },
    { event: "cross-referenced", source: { issue: { number: 7, repository_url: "https://api.github.com/repos/other/thing" } } },
    { event: "labeled" },
    { event: "cross-referenced", source: { issue: { number: 90, repository_url: "https://api.github.com/repos/acme/shop" } } },
  ];
  const s = server([[/issues\/88\/parent$/, () => reply(404, {})], [/issues\/88\/sub_issues/, () => reply(200, [{ number: 89 }, { number: 92 }])], [/issues\/88\/timeline/, () => reply(200, events)]]);
  const got = await readerOf(w, s, "github").read(GH_ID, "workitem.relations.read");
  assert.equal(got.parent, undefined);
  assert.deepEqual(got.children, ["89", "92"]);
  assert.deepEqual(got.related, [{ ref: "90", relation: "related" }, { ref: "pr-91", relation: "implements", kind: "pr" }]);
});

test("GitHub comments keep what was said and never who said it", async () => {
  const w = await world([GH]);
  const s = server([[/issues\/88\/comments/, () => reply(200, [{ id: 1, created_at: "t1", user: { login: "some-real-login" }, body: "please cap it" }, { id: 2, created_at: "t2", user: { login: "some-real-login" }, body: "agreed" }])]]);
  const got = await readerOf(w, s, "github").read(GH_ID, "workitem.comments.read");
  assert.deepEqual(got.comments.map((c) => c.text), ["please cap it", "agreed"]);
  assert.doesNotMatch(JSON.stringify(got), /some-real-login/);
  assert.equal(got.comments[0].by, got.comments[1].by, "the same person is the same name within the answer");
  assert.match(got.comments[0].by, /^person-[0-9a-f]{6}$/);
});

const ADO_ITEM = {
  id: 4312,
  rev: 7,
  fields: { "System.Title": "Refund limit", "System.WorkItemType": "Product Backlog Item", "System.State": "Active", "System.Description": "<p>Refund <b>more</b> than the limit&nbsp;needs approval</p>", "Microsoft.VSTS.Common.AcceptanceCriteria": "<ul><li>above 500 needs a manager</li><li>&quot;quoted&quot; &amp; kept</li></ul>", "System.ChangedDate": "2026-09-29T10:00:00Z", "System.TeamProject": "Web Shop" },
  relations: [
    { rel: "System.LinkTypes.Hierarchy-Reverse", url: "https://dev.azure.com/acme/_apis/wit/workItems/100" },
    { rel: "System.LinkTypes.Hierarchy-Forward", url: "https://dev.azure.com/acme/_apis/wit/workItems/4313" },
    { rel: "System.LinkTypes.Related", url: "https://dev.azure.com/acme/_apis/wit/workItems/55" },
    { rel: "ArtifactLink", url: "vstfs:///Git/PullRequestId/abc%2Frepo%2F77", attributes: { name: "Pull Request" } },
    { rel: "ArtifactLink", url: "vstfs:///Build/Build/9", attributes: { name: "Build" } },
    { rel: "AttachedFile", url: "https://dev.azure.com/acme/_apis/wit/attachments/x" },
  ],
  _links: { html: { href: "https://dev.azure.com/acme/Web%20Shop/_workitems/edit/4312" } },
};

test("an Azure DevOps work item: Basic auth to its one host, a numeric revision as text, HTML read as the text a person read, relations by the descriptor's own words", async () => {
  const w = await world([ADO]);
  const s = server([[/_apis\/wit\/workitems\/4312\?/, () => reply(200, ADO_ITEM)]]);
  const item = await readerOf(w, s, "azure-devops").read(ADO_ID, "workitem.read");
  assert.equal(s.calls[0].url, "https://dev.azure.com/acme/_apis/wit/workitems/4312?$expand=relations&api-version=7.1");
  assert.equal(s.calls[0].headers.authorization, `Basic ${Buffer.from(`:${TOKEN}`).toString("base64")}`);
  assert.deepEqual([item.revision, item.type, item.title, item.state], ["7", "Product Backlog Item", "Refund limit", "Active"]);
  assert.equal(item.body, "Refund more than the limit needs approval");
  assert.equal(item.acceptance, "- above 500 needs a manager\n- \"quoted\" & kept");
  assert.equal(item.parent, "100");
  assert.deepEqual(item.children, ["4313"]);
  assert.deepEqual(item.related, [{ ref: "55", relation: "related" }, { ref: "pr-77", relation: "implements", kind: "pr" }], "a build and an attachment are neither");
  assert.doesNotMatch(JSON.stringify(item), new RegExp(TOKEN));
});

test("an item that is in another project than the identity says is refused, not attached to the wrong name", async () => {
  const w = await world([ADO]);
  const s = server([[/workitems\/4312/, () => reply(200, { ...ADO_ITEM, fields: { ...ADO_ITEM.fields, "System.TeamProject": "Elsewhere" } })]]);
  await assert.rejects(readerOf(w, s, "azure-devops").read(ADO_ID, "workitem.read"), (e) => e instanceof Refused && /is in project Elsewhere, not Web Shop/.test(e.message));
});

test("Azure DevOps comments (a preview API) and revisions, and the names of who wrote them stay out", async () => {
  const w = await world([ADO]);
  const s = server([
    [/workItems\/4312\/comments/, () => reply(200, { comments: [{ id: 5, createdDate: "t", createdBy: { displayName: "Some Real Name" }, text: "<p>cap at <i>500</i></p>" }] })],
    [/workItems\/4312\/revisions/, () => reply(200, { value: [{ rev: 1, fields: { "System.ChangedDate": "d1" } }, { rev: 2 }] })],
  ]);
  const reader = readerOf(w, s, "azure-devops");
  const comments = await reader.read(ADO_ID, "workitem.comments.read");
  assert.equal(comments.comments[0].text, "cap at 500");
  assert.doesNotMatch(JSON.stringify(comments), /Some Real Name/);
  assert.equal(s.calls[0].url, "https://dev.azure.com/acme/Web%20Shop/_apis/wit/workItems/4312/comments?api-version=7.1-preview.4");
  assert.deepEqual((await reader.read(ADO_ID, "workitem.history.read")).revisions, [{ revision: "1", at: "d1" }, { revision: "2" }]);
  await assert.rejects(reader.read({ ...ADO_ID, project: undefined }, "workitem.comments.read"), /inside a project/);
});

test("a reader answers only what it provides", async () => {
  const w = await world([GH]);
  const reader = readerOf(w, server([]), "github");
  assert.deepEqual(reader.provides, ["workitem.read", "workitem.relations.read", "workitem.comments.read"]);
  await assert.rejects(reader.read(GH_ID, "workitem.history.read"), /does not provide workitem.history.read/);
  await assert.rejects(reader.read({ ...GH_ID, project: undefined }, "workitem.read"), /names no project/);
});

// ---- the connection and the credential ----------------------------------------------------

test("no connection, another owner's connection or an unset credential is BLOCKED, and the credential is never named", async () => {
  const none = await world([]);
  await assert.rejects(readerOf(none, server([]), "github").read(GH_ID, "workitem.read"), (e) => e instanceof Blocked && /no GitHub connection is set up here/.test(e.message));
  const other = await world([{ ...GH, organization: "someone-else" }]);
  await assert.rejects(readerOf(other, server([]), "github").read(GH_ID, "workitem.read"), (e) => e instanceof Blocked && /the ones here are for someone-else/.test(e.message));
  const unset = await world([{ ...GH, envName: "REQ_NOT_SET_ANYWHERE" }]);
  await assert.rejects(readerOf(unset, server([]), "github").read(GH_ID, "workitem.read"), (e) => e instanceof AuthBlocked && e instanceof Blocked && e.code === "AUTH_CREDENTIAL_MISSING" && /has no credential set on this machine/.test(e.message) && !e.message.includes(TOKEN));
});

test("a source that echoes the credential back is not answered", async () => {
  const w = await world([GH]);
  const s = server([[/issues\/88$/, () => reply(200, { ...GH_ISSUE, title: `oops ${TOKEN}` })]]);
  await assert.rejects(readerOf(w, s, "github").read(GH_ID, "workitem.read"), (e) => e instanceof Blocked && /contained the credential/.test(e.message) && !e.message.includes(TOKEN));
});

test("what a source did is told as what it means: not found is the request's, everything else is the machine's, and none says the credential", async () => {
  const w = await world([GH]);
  const stop = async (status, headers) => {
    const s = server([[/issues\/88$/, () => reply(status, { message: "nope" }, headers)]]);
    return readerOf(w, s, "github").read(GH_ID, "workitem.read").catch((e) => e);
  };
  const missing = await stop(404);
  assert.ok(missing instanceof Refused && /not found, or not visible to this credential/.test(missing.message));
  for (const [status, re, code] of [[401, /credential was refused/, "AUTH_REJECTED"], [403, /may not read this/, "AUTH_FORBIDDEN"]]) {
    const e = await stop(status);
    assert.ok(e instanceof Blocked && re.test(e.message) && e.code === code, `${status}: ${e.message}`);
    assert.ok(!e.message.includes(TOKEN));
  }
});

test("a redirect to another host is not followed, and the credential is not sent there", async () => {
  const w = await world([GH]);
  const s = server([[/api\.github\.com/, () => reply(302, {}, { location: "https://elsewhere.example.test/steal" })]]);
  await assert.rejects(readerOf(w, s, "github").read(GH_ID, "workitem.read"), (e) => e instanceof Blocked && /not this connection's host/.test(e.message));
  assert.deepEqual(s.calls.map((c) => new URL(c.url).host), ["api.github.com"]);
});

// ---- the registry and the credential for an adapter --------------------------------------

test("a reader is a registry resource, ready only when a connection with a credential exists, and reading that took no credential", async () => {
  const none = readerResources((await world([])).connections);
  assert.deepEqual(none.map((r) => [r.key, r.state, r.available, r.eligible]), [["pack:orbit-requirements/github", "needs-attention", false, false], ["pack:orbit-requirements/azure-devops", "needs-attention", false, false]]);
  assert.match(none[0].why, /add one in Orbit Control/);
  const w = await world([ADO]);
  const reads = [];
  const spied = { ...w.connections, record: (id) => (reads.push(id), w.connections.record(id)) };
  const rows = readerResources(spied);
  assert.deepEqual(rows.map((r) => [r.id, r.state, r.eligible, r.ownership, r.kind]), [["github.workitem", "needs-attention", false, "plugin", "capability"], ["azure-devops.workitem", "ready", true, "plugin", "capability"]]);
  assert.deepEqual(rows[1].routing.provides, ["workitem.read", "workitem.relations.read", "workitem.comments.read", "workitem.history.read"]);
  assert.deepEqual(reads, [], "readiness looks at the public view only; no credential was read");
});

test("the credential for an adapter is read for ONE provider, just before it runs, and lands in the environment of its command under the provider's own variable", async () => {
  const w = await world([GH, ADO]);
  const reads = [];
  const secrets = { ...w.secrets, read: async (ref) => (reads.push(ref), w.secrets.read(ref)) };
  const bound = await connectionEnvFor({ providerId: "azure-devops", organization: "acme", connections: w.connections, secrets, env: { PATH: "/usr/bin", HOME: "/home/x", SECRET_ELSEWHERE: "no" } });
  assert.deepEqual(reads, ["REQ_TEST_TOKEN"], "one credential, not both providers'");
  assert.equal(bound.connections.has("azure-devops"), true);
  assert.equal(bound.connections.has("github"), false);
  assert.deepEqual(bound.connectionEnv("azure-devops"), { PATH: "/usr/bin", HOME: "/home/x", AZURE_DEVOPS_EXT_PAT: TOKEN });
  assert.equal(bound.connectionEnv("github"), undefined);
});

test("with no connection, or none for that owner, or no credential, nothing is bound and nothing is invented", async () => {
  const w = await world([GH]);
  const bind = (over) => connectionEnvFor({ providerId: "github", connections: w.connections, secrets: w.secrets, env: {}, ...over });
  assert.equal((await bind({ providerId: "azure-devops" })).connections.has("azure-devops"), false);
  assert.equal((await bind({ organization: "someone-else" })).connections.has("github"), false);
  const unset = await world([{ ...GH, envName: "REQ_NOT_SET_ANYWHERE" }]);
  assert.equal((await bind({ connections: unset.connections, secrets: unset.secrets })).connections.has("github"), false);
  assert.equal((await bind({ providerId: "nothing-like-it" })).connectionEnv("nothing-like-it"), undefined);
});
