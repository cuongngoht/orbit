// The standard GitHub collector against a GitHub in memory: every page read,
// the window's rules for WHICH pull requests, what a missing permission
// becomes, and what ends a run -- with nothing sent anywhere but the
// connection's own host.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createAuth } from "../src/connections/auth.mjs";
import { AuthBlocked } from "../src/connections/auth-errors.mjs";
import { Blocked } from "../src/errors.mjs";
import { providers } from "../skills/orbit-report/pack.mjs";
import { githubSource } from "../skills/orbit-report/sources/github.mjs";
import { fakeGitHub } from "./project-report/fake-github.mjs";
import { WINDOW } from "./project-report/snapshots.mjs";

const PAT = "github_pat_11TESTCANARY0000000000000000000000000000000000000000000000000000";
const connection = { id: "github-acme", provider: "github", host: "https://api.github.com", organization: "acme", credential: "GITHUB_PAT" };
const noWait = { sleep: async () => {} };

// What authorizes the requests: the real contract over a fine-grained token the way a person's connection holds one.
const auth = () => createAuth({ secrets: { read: async () => PAT }, adapters: {}, providers: providers(), nowMs: () => 0 }).resolve(connection);

const pr = (number, over = {}) => ({ number, state: "MERGED", createdAt: "2026-07-05T02:00:00Z", updatedAt: "2026-07-06T02:00:00Z", mergedAt: "2026-07-06T02:00:00Z", ...over });

function collect(fake, scope = { repositories: ["acme/web"] }, deps = noWait) {
  return githubSource(deps).collect({ connection, scope, window: WINDOW, auth: auth(), fetch: fake.fetch, nowMs: () => Date.parse("2026-09-25T03:00:00Z"), log: () => {} });
}

test("every page is read: 60 pull requests over three pages, 101 commits through node(id), an old OPEN one, and nothing older than the window", async () => {
  const prs = [...Array.from({ length: 60 }, (_, i) => pr(1 + i, { updatedAt: `2026-08-${String(1 + (i % 28)).padStart(2, "0")}T02:00:00Z` })), pr(500, { commits: 101 }), pr(600, { state: "OPEN", createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-04-02T00:00:00Z", mergedAt: null }), pr(700, { createdAt: "2026-03-01T00:00:00Z", updatedAt: "2026-03-02T00:00:00Z", mergedAt: "2026-03-02T00:00:00Z" })];
  const fake = fakeGitHub({ repos: { "acme/web": { prs } } });
  const got = await collect(fake);
  const numbers = got.collections.pullRequests.map((p) => p.number).sort((a, b) => a - b);
  assert.ok(numbers.includes(60) && numbers.includes(1), "all three pages");
  assert.ok(numbers.includes(600), "an open pull request untouched since April is backlog at the cut-off, so it is read");
  assert.ok(!numbers.includes(700), "one merged and last updated before the window is not");
  assert.equal(got.collections.pullRequests.find((p) => p.number === 500).commits.length, 101, "the 101st commit came from a second page");
  assert.ok(fake.calls.some((c) => c.op === "More"), "read through node(id)");
  assert.equal(got.completeness.pullRequests.status, "complete");
  assert.ok(got.raw.length > 0, "the answers are kept as the snapshot's raw pages");
});

test("a pull request merged in the window counts whenever it was opened; the same number in two repositories is two records", async () => {
  const fake = fakeGitHub({ repos: { "acme/web": { prs: [pr(12, { createdAt: "2026-06-20T02:00:00Z" })] }, "acme/api": { prs: [pr(12)] } } });
  const got = await collect(fake, { repositories: ["acme/web", "acme/api"] });
  const ids = got.collections.pullRequests.map((p) => p.id).sort();
  assert.deepEqual(ids, ["github:api.github.com/acme/api#12", "github:api.github.com/acme/web#12"]);
  assert.equal(got.collections.pullRequests.find((p) => p.repo === "acme/web").createdAt, "2026-06-20T02:00:00Z");
});

test("an item repeated across pages is kept once; a cursor that does not advance stops the run", async () => {
  const prs = Array.from({ length: 30 }, (_, i) => pr(1 + i, { updatedAt: `2026-08-${String(1 + (i % 28)).padStart(2, "0")}T02:00:00Z` }));
  const repeated = await collect(fakeGitHub({ repos: { "acme/web": { prs } }, repeatPage: 25 }));
  assert.equal(repeated.collections.pullRequests.length, 30);
  await assert.rejects(collect(fakeGitHub({ repos: { "acme/web": { prs: Array.from({ length: 80 }, (_, i) => pr(1 + i)) } }, stuckCursor: true })), (e) => e instanceof Blocked && /paging did not advance/.test(e.message));
});

test("a permission the credential lacks is that collection's status, named -- never an empty list", async () => {
  const fake = fakeGitHub({ repos: { "acme/web": { prs: [pr(1)], issues: [] } }, fail: { Issues: { status: 403, headers: { "x-accepted-github-permissions": "issues=read" } } } });
  const got = await collect(fake);
  assert.equal(got.completeness.pullRequests.status, "complete");
  assert.equal(got.completeness.workItems.status, "forbidden");
  assert.equal(got.completeness.workItems.permission, "issues: read");
  assert.equal(got.completeness.iterations.status, "not-configured");
});

test("a repository the credential cannot see is named, and the rest is read", async () => {
  const got = await collect(fakeGitHub({ repos: { "acme/web": { prs: [pr(1)] } } }), { repositories: ["acme/web", "acme/secret", "other/repo"] });
  assert.equal(got.completeness.repositories.status, "partial");
  assert.match(got.completeness.repositories.reason, /acme\/secret: not found, or not visible/);
  assert.match(got.completeness.repositories.reason, /other\/repo: not a repository of acme/);
  assert.equal(got.completeness.pullRequests.status, "partial");
});

test("what ends a run: a refused credential, a page instead of data, a source that keeps failing -- each BLOCKED, in words", async () => {
  await assert.rejects(collect(fakeGitHub({ repos: { "acme/web": { prs: [] } }, fail: { Repo: { status: 401 } } })), (e) => e instanceof AuthBlocked && e instanceof Blocked && e.code === "AUTH_REJECTED" && /the credential was refused: the source did not accept it \(HTTP 401\)/.test(e.message) && /when it expires/.test(e.next));
  await assert.rejects(collect(fakeGitHub({ repos: { "acme/web": { prs: [] } }, fail: { Repo: { html: true } } })), (e) => e instanceof AuthBlocked && e.code === "AUTH_REJECTED" && /\(HTTP 200\)/.test(e.message), "a page where data should be is the source not accepting who asks");
  await assert.rejects(collect(fakeGitHub({ repos: { "acme/web": { prs: [] } }, fail: { Repo: { status: 502 } } })), (e) => e instanceof Blocked && /kept failing \(HTTP 502\)/.test(e.message));
  const once = await collect(fakeGitHub({ repos: { "acme/web": { prs: [pr(1)] } }, fail: { PullRequests: { status: 503, times: 1 } } }));
  assert.equal(once.collections.pullRequests.length, 1, "one failure is retried");
});

test("a rate limit is waited out within the run's budget, and past it the run stops with the reset time", async () => {
  const slept = [];
  const got = await collect(fakeGitHub({ repos: { "acme/web": { prs: [pr(1)] } }, fail: { PullRequests: { status: 429, headers: { "retry-after": "30" }, times: 1 } } }), undefined, { sleep: async (ms) => slept.push(ms) });
  assert.equal(got.collections.pullRequests.length, 1);
  assert.ok(slept.includes(30000));
  await assert.rejects(collect(fakeGitHub({ repos: { "acme/web": { prs: [pr(1)] } }, fail: { PullRequests: { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(Math.floor(Date.parse("2026-09-25T05:00:00Z") / 1000)) } } } })), (e) => e instanceof Blocked && /resets at 2026-09-25T05:00:01/.test(e.message));
});

test("the credential goes to the connection's host and nowhere else: a redirect off it is not followed", async () => {
  const fake = fakeGitHub({ repos: { "acme/web": { prs: [] } }, fail: { Repo: { status: 302, headers: { location: "https://evil.example/steal" } } } });
  await assert.rejects(collect(fake), (e) => e instanceof Blocked && /evil\.example/.test(e.message));
  assert.ok(fake.calls.every((c) => new URL(c.url).host === "api.github.com"), "nothing was sent to the other host at all");
  assert.ok(!JSON.stringify(fake.calls).includes(PAT));
});

test("SSO enforcement is named as what to do", async () => {
  const got = await collect(fakeGitHub({ repos: { "acme/web": { prs: [] } }, fail: { PullRequests: { status: 403, headers: { "x-github-sso": "required; url=https://github.com/orgs/acme/sso" } } } }));
  assert.equal(got.completeness.pullRequests.status, "forbidden");
  assert.match(got.completeness.pullRequests.reason, /single sign-on/);
});

test("the probe checks authentication, then each thing this scope reads, naming a missing permission", async () => {
  const fake = fakeGitHub({ repos: { "acme/web": {} }, fail: { "/actions/runs": { status: 403, headers: { "x-accepted-github-permissions": "actions=read" } } } });
  const result = await githubSource(noWait).probe({ connection, scope: { repositories: ["acme/web"], deployments: false }, auth: auth(), fetch: fake.fetch, nowMs: Date.now });
  assert.equal(result.identity, "lan");
  const by = Object.fromEntries(result.checks.map((c) => [c.id, c]));
  assert.equal(by.authentication.status, "ok");
  assert.equal(by["acme/web · pullRequests"].status, "ok");
  assert.equal(by["acme/web · actions"].status, "forbidden");
  assert.equal(by["acme/web · actions"].permission, "actions: read");
  assert.equal(by["acme/web · deployments"].status, "not-configured");
  assert.equal(result.ok, false);
  const refused = await githubSource(noWait).probe({ connection, scope: {}, auth: auth(), fetch: fakeGitHub({ fail: { "/user": { status: 401 } } }).fetch, nowMs: Date.now }).catch((e) => e);
  assert.ok(refused instanceof AuthBlocked && refused.code === "AUTH_REJECTED", "a refusal of who is asking ends the test as the contract's answer, and the connection's test words it");
});
