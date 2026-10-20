// Representative project-report SNAPSHOTS, built deterministically and entirely
// synthetic -- the input every compute, render and visual check reads, so none
// of them needs a source, and the snapshot a project's own part is VERIFIED
// against when it brings no fixture of its own (src/.. qc-tool verify).
//
//   githubSnapshot()          two repositories of one owner, pull requests with
//                             reviews, threads, commits and events, issues with
//                             history, Actions runs and deployments
//   adoSnapshot()             Boards work items with custom states and
//                             categories, Repos pull requests, Pipelines builds
//   pipelinesOnlySnapshot()   builds and deployments; everything else is not
//                             configured
//
// The edge cases a report must get right are planted on purpose and named:
// a PR opened in June and merged in July, one merged at 23:30 on 30 June in the
// project's zone (16:30 UTC, outside the window), one merged after the cut-off,
// a review after a merge, a reopen, a bot reviewer, AI commits, a title that is
// markup, a name that is not ASCII, a canceled issue, a custom state with no category.
import { calendarBetween, periodOf } from "../../src/project-report/window.mjs";
import { SNAPSHOT_CONTRACT } from "../../src/project-report/snapshot.mjs";

export const TZ = "Asia/Ho_Chi_Minh";
export const NOW = Date.parse("2026-09-25T03:00:00Z");
export const WINDOW = periodOf({}, { now: NOW, tz: TZ });

const H = 3600000;
const at = (text) => new Date(Date.parse(text)).toISOString();
const plus = (text, hours) => new Date(Date.parse(text) + hours * H).toISOString();

// A tiny, seeded generator: the same numbers on every machine.
function random(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0) / 4294967296);
}

const PEOPLE = [{ login: "lan-nguyen", name: "Lan Nguyen" }, { login: "minh-tran", name: "Minh Tran" }, { login: "an-le", name: "Chloé Le" }, { login: "hoa-pham", name: "Hoa Pham" }];
const BOT = { login: "github-actions", bot: true };
const TITLES = ["feat(portal): tenant switcher", "fix: session expires too early", "refactor(api): split the user service", "chore: bump dependencies", "docs: onboarding guide", "feat: export to CSV", "fix(ui): dates shown in the wrong format", "Improve cache warm-up", "ci: cache the build", "feat(auth): SSO sign-in"];

function commitsOf(rnd, author, createdAt, n, ai) {
  return Array.from({ length: n }, (_, i) => ({ oid: `c${Math.floor(rnd() * 1e9).toString(16)}${i}`, authoredAt: plus(createdAt, -6 + i), committedAt: plus(createdAt, -6 + i),
    author: { login: author.login, name: author.name, email: `${author.login}@example.test` }, committer: { login: author.login, name: author.name, email: `${author.login}@example.test` },
    message: ai && i % 2 === 0 ? "work\n\nCo-Authored-By: Claude <noreply@anthropic.com>" : "work" }));
}

function pullRequest(rnd, repo, number, spec) {
  const who = { author: PEOPLE[number % PEOPLE.length], reviewer: PEOPLE[(number + 1) % PEOPLE.length] };
  const t = { created: spec.createdAt, merged: spec.mergedAt ?? null, lines: spec.lines ?? Math.floor(20 + rnd() * 900) };
  t.reviewAt = plus(t.created, 2 + Math.floor(rnd() * 20));
  return { ...prHead(repo, number, spec, who, t), ...prBody(rnd, repo, number, spec, who, t) };
}

const prHead = (repo, number, spec, { author, reviewer }, { created, merged }) => ({
  id: `github:api.github.com/orbit-demo/${repo}#${number}`, repo: `orbit-demo/${repo}`, number, url: `https://github.com/orbit-demo/${repo}/pull/${number}`,
  title: spec.title ?? TITLES[number % TITLES.length], author: { login: author.login, name: author.name, bot: false }, mergedBy: merged ? { login: spec.selfMerge ? author.login : reviewer.login } : null,
  state: spec.state ?? (merged ? "merged" : spec.closedAt ? "closed" : "open"), draft: false, createdAt: created, updatedAt: merged ?? spec.closedAt ?? created,
  mergedAt: merged, closedAt: merged ?? spec.closedAt ?? null, baseRef: "main", headRef: spec.branch ?? `topic/${number}`,
});

// Property order is evaluation order, and the generator is called in it.
const prBody = (rnd, repo, number, spec, { author, reviewer }, { created, merged, lines, reviewAt }) => ({
  additions: Math.floor(lines * 0.7), deletions: lines - Math.floor(lines * 0.7), changedFiles: 1 + Math.floor(rnd() * 12), labels: [], linkedWorkItems: spec.items ?? [],
  commits: commitsOf(rnd, author, created, 1 + Math.floor(rnd() * 4), number % 3 === 0),
  files: [{ path: `src/${repo === "portal-web" ? "web" : "api"}/module${number % 4}.ts`, additions: Math.floor(lines * 0.7), deletions: lines - Math.floor(lines * 0.7) }],
  reviews: spec.noReview ? [] : [{ author: { login: reviewer.login, bot: false }, state: "APPROVED", submittedAt: reviewAt }, { author: BOT, state: "COMMENTED", submittedAt: plus(created, 1) }, ...(spec.lateReview && merged ? [{ author: { login: PEOPLE[2].login, bot: false }, state: "COMMENTED", submittedAt: plus(merged, 30) }] : [])],
  threads: [{ resolved: number % 4 !== 0, outdated: false, startedAt: plus(created, 1), author: BOT, comments: 1 }],
  comments: [], reviewComments: [{ author: BOT, createdAt: plus(created, 1) }, { author: { login: reviewer.login }, createdAt: reviewAt }],
  events: spec.events ?? [], truncated: [],
});

function githubPullRequests() {
  const rnd = random(7);
  const regular = Array.from({ length: 36 }, (_, i) => {
    const repo = i % 2 === 0 ? "portal-web" : "portal-api";
    const createdAt = at(`2026-07-${String(1 + (i % 28)).padStart(2, "0")}T0${1 + (i % 8)}:00:00Z`);
    const shift = i < 18 ? 0 : 31 * 24;
    const created = plus(createdAt, shift);
    return pullRequest(rnd, repo, 100 + i, { createdAt: created, mergedAt: i % 7 === 6 ? null : plus(created, 5 + Math.floor(rnd() * 70)), selfMerge: i % 9 === 0, lateReview: i % 5 === 0 });
  });
  const planted = [
    pullRequest(rnd, "portal-web", 90, { title: "feat: invoice template (opened in June)", createdAt: at("2026-06-20T02:00:00Z"), mergedAt: at("2026-07-03T04:00:00Z") }),
    pullRequest(rnd, "portal-api", 91, { title: "fix: rounding (merged 23:30 on 30 June local)", createdAt: at("2026-06-29T02:00:00Z"), mergedAt: at("2026-06-30T16:30:00Z") }),
    pullRequest(rnd, "portal-web", 92, { title: "feat: audit log (merged after the cut-off) FUTURE-CANARY", createdAt: at("2026-08-20T02:00:00Z"), mergedAt: at("2026-09-05T02:00:00Z") }),
    pullRequest(rnd, "portal-api", 93, { title: "Reopened after a false start", createdAt: at("2026-07-10T02:00:00Z"), mergedAt: null, closedAt: null, state: "open", events: [{ type: "closed", at: at("2026-07-11T02:00:00Z") }, { type: "reopened", at: at("2026-07-12T02:00:00Z") }] }),
    pullRequest(rnd, "portal-web", 94, { title: "<script>alert('pwned')</script> & <b>bold</b>", createdAt: at("2026-08-02T02:00:00Z"), mergedAt: at("2026-08-03T02:00:00Z") }),
    pullRequest(rnd, "portal-api", 95, { title: "Long-running spike (open since May)", createdAt: at("2026-05-15T02:00:00Z"), mergedAt: null, noReview: true }),
    pullRequest(rnd, "portal-web", 96, { title: "Abandoned experiment", createdAt: at("2026-07-20T02:00:00Z"), closedAt: at("2026-07-25T02:00:00Z"), state: "closed" }),
  ];
  return [...planted, ...regular];
}

function issue(number, spec) {
  return { id: `github:api.github.com/orbit-demo/portal-web!${number}`, key: `#${number}`, title: spec.title, url: `https://github.com/orbit-demo/portal-web/issues/${number}`, type: spec.type ?? "Issue", kind: spec.kind ?? "issue",
    createdAt: spec.history[0].at, state: spec.history.at(-1).state, category: spec.history.at(-1).category, history: spec.history, pointInTime: true, linkedPullRequests: [], fields: {} };
}

function githubIssues() {
  const rows = Array.from({ length: 24 }, (_, i) => {
    const opened = at(`2026-06-${String(1 + i).padStart(2, "0")}T03:00:00Z`);
    const done = plus(opened, 24 * (10 + (i % 5) * 7));
    const history = [{ at: opened, state: "open", category: "proposed" }, { at: plus(opened, 48), state: "open", category: "in-progress" }, ...(i % 4 === 3 ? [] : [{ at: done, state: "closed", category: "completed" }])];
    return issue(200 + i, { title: `Backlog item ${200 + i}`, kind: i % 5 === 0 ? "bug" : "issue", history });
  });
  const planted = [
    issue(300, { title: "Canceled: not planned", history: [{ at: at("2026-07-02T03:00:00Z"), state: "open", category: "proposed" }, { at: at("2026-07-20T03:00:00Z"), state: "closed", category: "removed" }] }),
    issue(301, { title: "Reopened after review", history: [{ at: at("2026-07-01T03:00:00Z"), state: "open", category: "proposed" }, { at: at("2026-07-10T03:00:00Z"), state: "closed", category: "completed" }, { at: at("2026-07-15T03:00:00Z"), state: "open", category: "in-progress" }] }),
  ];
  return [...rows, ...planted];
}

function builds(prefix) {
  return Array.from({ length: 30 }, (_, i) => {
    const finished = at(`2026-${i < 15 ? "07" : "08"}-${String(1 + (i % 15) * 2).padStart(2, "0")}T05:00:00Z`);
    return { id: `${prefix}:build/${1000 + i}`, pipeline: i % 3 === 0 ? "release" : "ci", result: i % 6 === 5 ? "failure" : "success", status: "completed", queuedAt: plus(finished, -1), startedAt: plus(finished, -0.5), finishedAt: finished, branch: "main", url: `https://example.test/${prefix}/build/${1000 + i}` };
  });
}

function deployments(prefix) {
  return Array.from({ length: 12 }, (_, i) => ({ id: `${prefix}:deploy/${i}`, environment: i % 3 === 0 ? "staging" : "production", status: i === 4 ? "failure" : "success", createdAt: at(`2026-0${7 + (i % 2)}-${String(3 + i * 2).padStart(2, "0")}T06:00:00Z`), finishedAt: at(`2026-0${7 + (i % 2)}-${String(3 + i * 2).padStart(2, "0")}T06:20:00Z`), ref: "main" }));
}

const complete = (items) => ({ status: "complete", items, pages: Math.max(1, Math.ceil(items / 100)) });

export function snapshotOf({ provider, organization, scope, collections, completeness }) {
  return {
    contract: SNAPSHOT_CONTRACT, run: { id: "20260925T030000Z-0001", createdAt: new Date(NOW).toISOString() }, project: { key: "repo-demo", name: "portal" },
    source: { provider, host: provider === "github" ? "https://api.github.com" : "https://dev.azure.com/orbit-demo", organization, scope, connection: `${provider}-demo`, identity: `${provider}:${organization}:${JSON.stringify(scope)}` },
    window: WINDOW, calendar: calendarBetween(WINDOW.from, WINDOW.to, TZ), collectedAt: { started: new Date(NOW).toISOString(), finished: new Date(NOW + 60000).toISOString() },
    completeness, parts: [{ id: `orbit.report.${provider}`, version: "1.0.0", sha256: "0".repeat(64), source: "builtin" }], collections,
  };
}

export function githubSnapshot() {
  const collections = { repositories: [{ id: "github:api.github.com/orbit-demo/portal-web", name: "orbit-demo/portal-web", url: "https://github.com/orbit-demo/portal-web", defaultBranch: "main" }, { id: "github:api.github.com/orbit-demo/portal-api", name: "orbit-demo/portal-api", url: "https://github.com/orbit-demo/portal-api", defaultBranch: "main" }],
    pullRequests: githubPullRequests(), workItems: githubIssues(), workItemTypes: [], iterations: [], builds: builds("gh"), deployments: deployments("gh") };
  const completeness = Object.fromEntries(Object.entries(collections).map(([k, v]) => [k, complete(v.length)]));
  return snapshotOf({ provider: "github", organization: "orbit-demo", scope: { repositories: ["orbit-demo/portal-web", "orbit-demo/portal-api"] }, collections, completeness: { ...completeness, workItemTypes: { status: "not-configured", reason: "GitHub issues have no work item types here" }, iterations: { status: "not-configured", reason: "no Projects iteration field is configured" } } });
}

const ADO_TYPES = [
  { name: "User Story", states: [{ name: "New", category: "proposed" }, { name: "Active", category: "in-progress" }, { name: "Waiting on Vendor", category: "in-progress" }, { name: "Resolved", category: "resolved" }, { name: "Closed", category: "completed" }, { name: "Removed", category: "removed" }] },
  { name: "Bug", states: [{ name: "New", category: "proposed" }, { name: "Active", category: "in-progress" }, { name: "Closed", category: "completed" }] },
];

function adoItems() {
  return Array.from({ length: 40 }, (_, i) => adoItem(i));
}

function adoItem(i) {
  const type = i % 4 === 0 ? "Bug" : "User Story";
  const opened = at(`2026-06-${String(1 + (i % 28)).padStart(2, "0")}T02:00:00Z`);
  const history = adoHistory(i, opened);
  return { id: `ado:orbit-demo/wi/${5000 + i}`, key: `${5000 + i}`, title: `${type} ${5000 + i}`, url: `https://dev.azure.com/orbit-demo/portal/_workitems/edit/${5000 + i}`, type, kind: type === "Bug" ? "bug" : "requirement",
    createdAt: opened, state: history.at(-1).state, category: history.at(-1).category, history, pointInTime: true, iteration: `portal\\Sprint ${1 + Math.floor(i / 8)}`, linkedPullRequests: [], fields: { "System.AreaPath": "portal\\Web" } };
}

function adoHistory(i, opened) {
  const history = [{ at: opened, state: "New", category: "proposed" }, { at: plus(opened, 72), state: i % 7 === 0 ? "Waiting on Vendor" : "Active", category: "in-progress" }];
  if (i % 5 !== 4) history.push({ at: plus(opened, 24 * (12 + (i % 6) * 6)), state: "Closed", category: "completed" });
  planted(i, opened, history);
  return history;
}

// The edge cases, on purpose: a reopen, a removal, a state no category claims.
function planted(i, opened, history) {
  if (i === 3) history.push({ at: at("2026-08-10T02:00:00Z"), state: "Active", category: "in-progress" });
  if (i === 9) history.splice(1, history.length - 1, { at: at("2026-07-15T02:00:00Z"), state: "Removed", category: "removed" });
  if (i === 11) history.push({ at: plus(opened, 24 * 50), state: "Legacy Hold", category: "unknown" });
}

function adoIterations() {
  return [["Sprint 12", "2026-06-29", "2026-07-12"], ["Sprint 13", "2026-07-13", "2026-07-26"], ["Sprint 14", "2026-07-27", "2026-08-09"], ["Sprint 15", "2026-08-10", "2026-08-23"], ["Sprint 16", "2026-08-24", "2026-09-06"]]
    .map(([name, start, finish]) => ({ id: `ado:orbit-demo/iteration/${name}`, name, startDate: start, finishDate: finish, startUtc: new Date(Date.parse(`${start}T00:00:00+07:00`)).toISOString(), endUtc: new Date(Date.parse(`${finish}T00:00:00+07:00`) + 24 * H).toISOString() }));
}

function adoPullRequests() {
  const rnd = random(11);
  return Array.from({ length: 20 }, (_, i) => {
    const created = at(`2026-${i < 10 ? "07" : "08"}-${String(2 + i * 2 - (i < 10 ? 0 : 20)).padStart(2, "0")}T03:00:00Z`);
    const pr = pullRequest(rnd, "portal", 700 + i, { createdAt: created, mergedAt: i % 6 === 5 ? null : plus(created, 10 + i * 3), items: [`ado:orbit-demo/wi/${5000 + (i % 3)}`] });
    return { ...pr, id: `ado:orbit-demo/portal/pr/${700 + i}`, repo: "portal/portal", url: `https://dev.azure.com/orbit-demo/portal/_git/portal/pullrequest/${700 + i}` };
  });
}

export function adoSnapshot() {
  const collections = { repositories: [{ id: "ado:orbit-demo/portal/repo/portal", name: "portal/portal", url: "https://dev.azure.com/orbit-demo/portal/_git/portal", defaultBranch: "main" }], pullRequests: adoPullRequests(),
    workItems: adoItems(), workItemTypes: ADO_TYPES, iterations: adoIterations(), builds: builds("ado"), deployments: deployments("ado") };
  const completeness = Object.fromEntries(Object.entries(collections).map(([k, v]) => [k, complete(v.length)]));
  return snapshotOf({ provider: "azure-devops", organization: "orbit-demo", scope: { project: "portal", repositories: ["portal"] }, collections, completeness });
}

export function pipelinesOnlySnapshot() {
  const collections = { repositories: [], pullRequests: [], workItems: [], workItemTypes: [], iterations: [], builds: builds("ado"), deployments: deployments("ado") };
  const off = (reason) => ({ status: "not-configured", reason });
  return snapshotOf({ provider: "azure-devops", organization: "orbit-demo", scope: { project: "portal", pipelines: true }, collections,
    completeness: { repositories: off("Repos are not in this project's scope"), pullRequests: off("Repos are not in this project's scope"), workItems: off("Boards are not in this project's scope"), workItemTypes: off("Boards are not in this project's scope"), iterations: off("Boards are not in this project's scope"), builds: complete(30), deployments: complete(12) } });
}
