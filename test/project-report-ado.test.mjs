// The standard Azure DevOps collector against an Azure DevOps in memory:
// Boards read AS OF the cut-off with categories from the process, every page
// of every listing, pull requests with unknown sizes, and a read-only token's
// limits said out loud.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "../src/connections/auth.mjs";
import { AuthBlocked } from "../src/connections/auth-errors.mjs";
import { Blocked } from "../src/errors.mjs";
import { providers } from "../skills/orbit-report/pack.mjs";
import { azureDevOpsSource, releaseBaseOf } from "../skills/orbit-report/sources/azure-devops.mjs";
import { baseOf } from "../skills/orbit-report/sources/azure-devops-client.mjs";
import { fakeAdo } from "./project-report/fake-ado.mjs";
import { WINDOW } from "./project-report/snapshots.mjs";

const PAT = "abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrst";
const connection = { id: "ado-acme", provider: "azure-devops", host: "https://dev.azure.com", organization: "acme", auth: { strategy: "credential" }, credential: "ADO_PAT" };
const scope = { project: "portal" };
const noWait = { sleep: async () => {} };

// What authorizes the requests: the real contract over a personal access token the way a person's connection holds one.
const auth = () => createAuth({ secrets: { read: async () => PAT }, adapters: {}, providers: providers(), nowMs: () => 0 }).resolve(connection);

const item = (id, revisions, over = {}) => ({ id, type: "User Story", createdAt: revisions[0].at, revisions, ...over });

function collect(fake, s = scope) {
  return azureDevOpsSource(noWait).collect({ connection, scope: s, window: WINDOW, auth: auth(), fetch: fake.fetch, nowMs: () => Date.parse("2026-09-25T03:00:00Z"), log: () => {} });
}

test("where the API lives: an organization under dev.azure.com, a Server collection as given, releases on their own host", () => {
  assert.equal(baseOf(connection), "https://dev.azure.com/acme");
  assert.equal(baseOf({ host: "https://tfs.example.test/tfs/DefaultCollection", organization: "DefaultCollection" }), "https://tfs.example.test/tfs/DefaultCollection");
  assert.equal(releaseBaseOf(connection), "https://vsrm.dev.azure.com/acme");
});

test("work items are read AS OF the cut-off, their moves rebuilt, and each state read by the category the process gives it", async () => {
  const items = [
    item(1, [{ at: "2026-06-01T02:00:00Z", state: "New" }, { at: "2026-06-20T02:00:00Z", state: "Active" }, { at: "2026-07-10T02:00:00Z", state: "Closed" }]),
    item(2, [{ at: "2026-07-01T02:00:00Z", state: "New" }, { at: "2026-07-05T02:00:00Z", state: "Waiting on Vendor" }]),
    item(3, [{ at: "2026-07-01T02:00:00Z", state: "New" }, { at: "2026-07-03T02:00:00Z", state: "Active" }, { at: "2026-09-05T02:00:00Z", state: "Closed" }], { title: "FUTURE-CANARY closed after the cut-off" }),
    item(4, [{ at: "2026-07-01T02:00:00Z", state: "New" }, { at: "2026-07-20T02:00:00Z", state: "Removed" }]),
    item(5, [{ at: "2026-05-01T02:00:00Z", state: "New" }, { at: "2026-05-10T02:00:00Z", state: "Closed" }]),
    item(6, [{ at: "2026-07-02T02:00:00Z", state: "To Do" }], { type: "Task" }),
  ];
  const fake = fakeAdo({ items, revisionPage: 3 });
  const got = await collect(fake);
  const by = Object.fromEntries(got.collections.workItems.map((w) => [w.key, w]));
  assert.deepEqual(Object.keys(by).sort(), ["1", "2", "3", "4"], "changed in the window or open at the cut-off; a task and an item closed in May are not the backlog");
  assert.equal(by["2"].category, "in-progress", "a custom state is what its category says");
  assert.equal(by["3"].state, "Active", "as of the cut-off, not now");
  assert.ok(by["3"].history.every((h) => h.at < WINDOW.cutoffUtc), "no move after the cut-off is kept");
  assert.equal(by["4"].category, "removed");
  assert.equal(by["1"].history.find((h) => h.state === "Active")?.category ?? by["1"].history.find((h) => h.category === "in-progress")?.category, "in-progress", "the move before the window is known from the state it was in when the window began");
  assert.deepEqual(got.collections.workItemTypes.find((t) => t.name === "User Story").states.find((x) => x.name === "Waiting on Vendor"), { name: "Waiting on Vendor", category: "in-progress" });
  assert.ok(fake.calls.filter((c) => c.url.includes("workitemrevisions")).length >= 2, "revisions were read past their first page");
  assert.equal(got.completeness.workItems.status, "complete");
});

test("more than 200 items are asked in batches of 200; more than WIQL's 20,000 is read in halves", async () => {
  const many = Array.from({ length: 450 }, (_, i) => item(100 + i, [{ at: `2026-07-${String(1 + (i % 28)).padStart(2, "0")}T02:00:00Z`, state: "New" }, { at: `2026-08-${String(1 + (i % 28)).padStart(2, "0")}T02:00:00Z`, state: "Closed" }]));
  const fake = fakeAdo({ items: many, tooMany: 300 });
  const got = await collect(fake);
  assert.equal(got.collections.workItems.length, 450);
  assert.ok(fake.batches.every((n) => n <= 200), `batches ${fake.batches}`);
  assert.ok(fake.calls.filter((c) => c.url.includes("/wiql")).length > 2, "the range was split when Azure DevOps answered VS402337");
});

test("pull requests: closed since the window began and every active one, every page, votes as reviews, sizes unknown -- never zero", async () => {
  const pr = (id, over = {}) => ({ pullRequestId: id, title: `PR ${id}`, status: "completed", creationDate: "2026-07-02T02:00:00Z", closedDate: "2026-07-03T02:00:00Z", createdBy: { displayName: "Lan", uniqueName: "lan@acme.test" }, closedBy: { displayName: "Minh", uniqueName: "minh@acme.test" }, sourceRefName: "refs/heads/topic", targetRefName: "refs/heads/main", ...over });
  const prs = [...Array.from({ length: 130 }, (_, i) => pr(1 + i)), pr(900, { status: "active", closedDate: null, creationDate: "2026-03-01T00:00:00Z" }), pr(901, { closedDate: "2026-05-01T00:00:00Z" })];
  prs[0].threads = [{ id: 1, publishedDate: "2026-07-02T05:00:00Z", status: "fixed", comments: [{ commentType: "text", author: { displayName: "Minh", uniqueName: "minh@acme.test" }, publishedDate: "2026-07-02T05:00:00Z" }] }, { id: 2, publishedDate: "2026-07-02T06:00:00Z", properties: { CodeReviewThreadType: { $value: "VoteUpdate" }, CodeReviewVoteResult: { $value: "10" }, CodeReviewVotedByIdentity: { $value: "1" } }, identities: { 1: { displayName: "Minh", uniqueName: "minh@acme.test" } }, comments: [{ commentType: "system", author: { displayName: "Minh" } }] }];
  prs[0].commits = Array.from({ length: 150 }, (_, i) => ({ commitId: `c${i}`, author: { name: "Lan", email: "lan@acme.test", date: "2026-07-02T01:00:00Z" }, comment: "work" }));
  prs[0].workItems = [1];
  const got = await collect(fakeAdo({ repos: [{ id: "r1", name: "web", prs }] }));
  const numbers = got.collections.pullRequests.map((p) => p.number);
  assert.equal(got.collections.pullRequests.length, 131, "130 closed over two pages, plus the one still active; one closed in May is not read");
  assert.ok(numbers.includes(900) && !numbers.includes(901));
  const first = got.collections.pullRequests.find((p) => p.number === 1);
  assert.equal(first.commits.length, 150, "commits past their first page");
  assert.equal(first.reviews[0].state, "APPROVED");
  assert.equal(first.reviews[0].author.login, "minh@acme.test");
  assert.equal(first.threads[0].resolved, true);
  assert.equal(first.additions, null, "Azure Repos reports no line counts: unknown, not zero");
  assert.deepEqual(first.linkedWorkItems, ["ado:acme/wi/1"]);
  assert.equal(first.state, "merged");
});

test("builds page by continuation token; deployments come from releases, and the YAML limit is said out loud", async () => {
  const builds = Array.from({ length: 230 }, (_, i) => ({ id: i, definition: { name: "ci" }, result: i % 10 ? "succeeded" : "failed", status: "completed", finishTime: "2026-07-10T02:00:00Z" }));
  const deployments = [{ id: 7, releaseEnvironment: { name: "production" }, deploymentStatus: "succeeded", startedOn: "2026-07-10T02:00:00Z", completedOn: "2026-07-10T02:30:00Z", release: { name: "Release-7" } }];
  const fake = fakeAdo({ builds, deployments });
  const got = await collect(fake);
  assert.equal(got.collections.builds.length, 230);
  assert.equal(got.collections.deployments[0].status, "success");
  assert.match(got.completeness.deployments.reason, /Environment \(read and manage\)/);
  assert.ok(fake.calls.some((c) => c.host === "vsrm.dev.azure.com" && c.auth), "the release service was asked on its own host, derived from the connection");
});

test("a scope the token lacks is that collection's status; a token refused outright, or a sign-in page, stops the run", async () => {
  const noCode = await collect(fakeAdo({ fail: { "/_apis/git/repositories": { status: 401 } } }));
  assert.equal(noCode.completeness.pullRequests.status, "forbidden");
  assert.equal(noCode.completeness.pullRequests.permission, "Code (Read)");
  assert.equal(noCode.completeness.workItems.status, "complete", "the rest was read");
  await assert.rejects(collect(fakeAdo({ fail: { "/_apis/projects/": { html: true, status: 203 } } })), (e) => e instanceof AuthBlocked && e.code === "AUTH_REJECTED" && /the credential was refused: the source did not accept it \(HTTP 203\)/.test(e.message), "a sign-in page where data should be is the source not accepting who asks, told as the 203 it was");
  await assert.rejects(collect(fakeAdo({ fail: { "/_apis/projects/": { status: 404, body: { message: "TF200016: The project does not exist" } } } })), (e) => e instanceof Blocked && /project portal could not be read/.test(e.message));
});

test("the probe: authentication, then each area this scope reads, with the scope a token needs", async () => {
  const result = await azureDevOpsSource(noWait).probe({ connection, scope: { project: "portal", repos: false }, auth: auth(), fetch: fakeAdo({ fail: { "/_apis/build/builds": { status: 401 } } }).fetch, nowMs: Date.now });
  const by = Object.fromEntries(result.checks.map((c) => [c.id, c]));
  assert.equal(by.authentication.status, "ok");
  assert.equal(result.identity, "Lan Nguyen");
  assert.equal(by.project.status, "ok");
  assert.equal(by.boards.status, "ok");
  assert.equal(by.repos.status, "not-configured");
  assert.equal(by.pipelines.status, "forbidden");
  assert.equal(by.pipelines.permission, "Build (Read)");
  assert.equal(result.ok, false);
});

// A 400 is the source refusing the REQUEST -- a malformed path is rejected
// before the credential is even read -- so it names no permission to go and grant.
test("the probe names a permission only when the credential was refused", async () => {
  const fail = { "/_apis/wit/wiql": { status: 400, body: { message: "A potentially dangerous Request.Path value was detected" } }, "/_apis/build/builds": { status: 403, body: { message: "denied" } } };
  const result = await azureDevOpsSource(noWait).probe({ connection, scope: { project: "portal" }, auth: auth(), fetch: fakeAdo({ fail }).fetch, nowMs: Date.now });
  const by = Object.fromEntries(result.checks.map((c) => [c.id, c]));
  assert.deepEqual([by.boards.status, by.boards.permission], ["error", null]);
  assert.match(by.boards.message, /HTTP 400/);
  assert.deepEqual([by.pipelines.status, by.pipelines.permission], ["forbidden", "Build (Read)"]);
});
