// The standard GITHUB collector (orbit.report.github): pull requests, issues,
// an optional Projects iteration field, Actions runs and deployments -- from
// github.com or a GitHub Enterprise Server -- read ONCE per run, every page.
//
// Which pull requests: every one UPDATED since the window began (a pull request
// merged in the window was updated then, whenever it was opened), plus every
// one OPEN now (a pull request open at the cut-off and untouched since is
// backlog). The search API is not used: it stops at 1,000 results. Connections
// nested in a pull request -- commits, files, reviews, threads, comments,
// events -- are followed past their first page through node(id), so a pull
// request with 101 commits has 101.
//
// What the credential may not read is a COLLECTION's status (forbidden, with
// the permission GitHub named), never an empty list; a credential refused
// outright, a source that keeps failing or a rate limit past the run's budget
// stops the run (Blocked) and nothing is frozen.
//
// Normalized records: see skills/orbit-report/references/metrics.md.
import { Blocked, Refused } from "../../../src/errors.mjs";
import { addDays, dayStart } from "../../../src/project-report/window.mjs";
import { HttpStop, createHttp, inTurn, limited } from "./http.mjs";

export const PROVIDER = "github";
const PR_PAGE = 25;
const NESTED = 100;

export const githubSource = (deps = {}) => ({ id: PROVIDER, collect: (req) => guarded(() => collect(req, deps)), probe: (req) => probe(req, deps) });

// ---- the client --------------------------------------------------------------

// REST at the connection's host; GraphQL beside it (api.github.com/graphql, or
// <server>/api/graphql for an Enterprise Server whose REST root is /api/v3).
function apiOf(req, deps) {
  const rest = req.connection.host.replace(/\/+$/, "");
  const http = createHttp({ fetch: req.fetch, origin: rest, headers: { authorization: `Bearer ${req.credential}`, "x-github-api-version": "2022-11-28", "user-agent": "orbit-report" }, sleep: deps.sleep ?? sleep, nowMs: req.nowMs, limits: deps.limits });
  return { http, rest, graph: /\/api\/v3$/.test(rest) ? rest.replace(/\/api\/v3$/, "/api/graphql") : `${rest}/graphql`, raw: [] };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every answer is kept as it came, for the snapshot's raw pages.
async function graphql(api, query, variables) {
  const r = await api.http.request(api.graph, { method: "POST", body: { query, variables } });
  api.raw.push({ kind: "graphql", op: /query (\w+)/.exec(query)?.[1] ?? "query", variables, answer: r.json });
  if (r.json?.errors?.length) throw graphStop(r.json.errors);
  return r.json.data;
}

const GRAPH_STOPS = [
  { when: (t) => t === "NOT_FOUND", stop: (e) => new HttpStop("not-found", `not found, or not visible to this credential (${e.path?.join(".") ?? "query"})`) },
  { when: (t) => ["FORBIDDEN", "INSUFFICIENT_SCOPES"].includes(t), stop: () => new HttpStop("forbidden", "the credential may not read this") },
  { when: (t) => t === "RATE_LIMITED", stop: () => new HttpStop("rate", "GitHub's GraphQL rate limit was reached; run the report again after it resets") },
  { when: () => true, stop: (e) => new HttpStop("invalid", `GitHub refused the query: ${String(e.message ?? "unknown error").slice(0, 200)}`) },
];

const graphStop = (errors) => GRAPH_STOPS.find((s) => s.when(errors[0]?.type)).stop(errors[0]);

async function rest(api, path) {
  const r = await api.http.request(`${api.rest}${path}`);
  api.raw.push({ kind: "rest", path: path.replace(/\?.*$/, ""), answer: r.json });
  return r;
}

// ---- paging ---------------------------------------------------------------------

// Every page until the source says there is none -- or `enough` says the rest
// is older than the window. A cursor that does not advance stops the run
// rather than looping on it.
async function paged(page, enough = () => false, cursor = null, seen = new Set(), got = []) {
  const { nodes, pageInfo } = await page(cursor);
  got.push(...(nodes ?? []));
  if (!pageInfo?.hasNextPage || enough(nodes ?? [])) return got;
  if (!pageInfo.endCursor || seen.has(pageInfo.endCursor)) throw new HttpStop("invalid", "GitHub's paging did not advance; stopped rather than read the same page again");
  return paged(page, enough, pageInfo.endCursor, seen.add(pageInfo.endCursor), got);
}

const unique = (rows) => [...new Map(rows.map((r) => [r.id, r])).values()];

// ---- collect -------------------------------------------------------------------

// One collection after another, and a few requests at a time within one:
// GitHub treats many concurrent requests from one token as abuse.
async function collect(req, deps) {
  const api = apiOf(req, deps);
  const repos = await repositoriesOf(api, req);
  const readable = repos.filter((r) => r.ok).map((r) => r.repo);
  const parts = await inTurn([() => pullRequestsOf(api, req, readable), () => issuesOf(api, req, readable), () => iterationsOf(api, req), () => buildsOf(api, req, readable), () => deploymentsOf(api, req, readable)]);
  return assembled(api, req, repos, parts);
}

function assembled(api, req, repos, [prs, issues, iterations, builds, deployments]) {
  const repoState = stateOfRepos(repos);
  const collections = { repositories: repos.filter((r) => r.ok).map((r) => r.record), pullRequests: prs.rows, workItems: issues.rows, workItemTypes: [], iterations: iterations.rows, builds: builds.rows, deployments: deployments.rows };
  const completeness = { repositories: repoState, pullRequests: joined(repoState, prs.state), workItems: issues.state, workItemTypes: { status: "not-configured", reason: "GitHub issues carry no workflow states beyond open and closed" }, iterations: iterations.state, builds: builds.state, deployments: deployments.state };
  return { source: { provider: PROVIDER, host: api.rest, organization: req.connection.organization, scope: req.scope }, completeness, collections, raw: api.raw, earliest: earliestOf(collections) };
}

// A repository nobody could read makes every collection read from it partial.
const joined = (repoState, state) => (repoState.status === "complete" || state.status !== "complete" ? state : { ...state, status: "partial", reason: repoState.reason });

function stateOfRepos(repos) {
  const bad = repos.filter((r) => !r.ok);
  if (!bad.length) return { status: "complete", items: repos.length };
  return { status: bad.length === repos.length ? "forbidden" : "partial", items: repos.length - bad.length, reason: bad.map((r) => `${r.name}: ${r.reason}`).join("; "), ...(bad[0].permission ? { permission: bad[0].permission } : {}) };
}

const earliestOf = (c) => [...c.pullRequests.map((p) => p.createdAt), ...c.workItems.map((w) => w.createdAt)].filter(Boolean).sort()[0] ?? null;

// ---- repositories -------------------------------------------------------------------

const REPO = "query Repo($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id nameWithOwner url isPrivate defaultBranchRef { name } } }";

function repositoriesOf(api, req) {
  const names = [...new Set((req.scope.repositories ?? []).map(String))];
  if (!names.length) throw new Refused("a GitHub report reads at least one repository: set scope.repositories (owner/name)");
  return limited(names, 4, (name) => oneRepo(api, req, name));
}

async function oneRepo(api, req, name) {
  const [owner, repo] = name.split("/");
  if (!owner || !repo || owner.toLowerCase() !== String(req.connection.organization).toLowerCase()) return { name, ok: false, reason: `not a repository of ${req.connection.organization} (owner/name)` };
  const found = await collectionTry(() => graphql(api, REPO, { owner, name: repo }));
  if (!found.ok || !found.value?.repository) return { name, ok: false, reason: found.reason ?? "not found, or not visible to this credential", permission: found.permission };
  return { name, ok: true, repo: { owner, name: repo, full: name }, record: repositoryRecord(api, found.value.repository) };
}

const repositoryRecord = (api, r) => ({ id: `github:${hostOf(api)}/${r.nameWithOwner}`, name: r.nameWithOwner, url: r.url, defaultBranch: r.defaultBranchRef?.name ?? null, private: r.isPrivate });

const hostOf = (api) => new URL(api.rest).host;

// A collection-level stop (forbidden, not found) is a status; anything else
// goes on to end the run.
async function collectionTry(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return softStop(e); }
}

function softStop(e) {
  if (e instanceof HttpStop && ["forbidden", "not-found"].includes(e.kind)) return { ok: false, kind: e.kind, reason: e.message, permission: e.permission ?? null };
  throw e;
}

// ---- pull requests ---------------------------------------------------------------

const CONN = "totalCount pageInfo { hasNextPage endCursor }";
const COMMIT = "commit { oid authoredDate committedDate message author { name email user { login } } committer { name email user { login } } }";
const ACTOR = "author { login __typename }";
const EVENTS = "__typename ... on ReadyForReviewEvent { createdAt } ... on ConvertToDraftEvent { createdAt } ... on ClosedEvent { createdAt } ... on ReopenedEvent { createdAt } ... on MergedEvent { createdAt }";
const EVENT_TYPES = "itemTypes: [READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, CLOSED_EVENT, REOPENED_EVENT, MERGED_EVENT]";

// Each nested connection a pull request has: its GraphQL field, what one node
// asks for, and extra arguments.
const NESTS = {
  commits: { nodes: COMMIT, args: "" },
  files: { nodes: "path additions deletions", args: "" },
  reviews: { nodes: `${ACTOR} state submittedAt`, args: "" },
  reviewThreads: { nodes: `id isResolved isOutdated comments(first: 20) { totalCount pageInfo { hasNextPage endCursor } nodes { createdAt ${ACTOR} } }`, args: "" },
  comments: { nodes: `createdAt ${ACTOR}`, args: "" },
  timelineItems: { nodes: EVENTS, args: `, ${EVENT_TYPES}` },
};

const nestFields = (first) => Object.entries(NESTS).map(([f, n]) => `${f}(first: ${first}${n.args}) { ${CONN} nodes { ${n.nodes} } }`).join(" ");

const PR_FIELDS = `id number title url state isDraft createdAt updatedAt mergedAt closedAt author { login __typename ... on User { name } } mergedBy { login } baseRefName headRefName additions deletions changedFiles labels(first: 20) { nodes { name } } closingIssuesReferences(first: 25) { nodes { number repository { nameWithOwner } } } ${nestFields(NESTED)}`;

const PRS = `query PullRequests($owner: String!, $name: String!, $cursor: String, $states: [PullRequestState!]) { rateLimit { remaining resetAt } repository(owner: $owner, name: $name) { pullRequests(first: ${PR_PAGE}, after: $cursor, states: $states, orderBy: { field: UPDATED_AT, direction: DESC }) { pageInfo { hasNextPage endCursor } nodes { ${PR_FIELDS} } } } }`;

async function pullRequestsOf(api, req, repos) {
  const read = await limited(repos, 2, (repo) => collectionTry(() => prsOfRepo(api, req, repo)));
  return rowsAndState(read, "pull requests");
}

async function prsOfRepo(api, req, repo) {
  const page = (states) => (cursor) => graphql(api, PRS, { owner: repo.owner, name: repo.name, cursor, states }).then((d) => d.repository.pullRequests);
  const recent = (await paged(page(["OPEN", "CLOSED", "MERGED"]), olderThan(req.window.fromUtc))).filter(since(req.window.fromUtc));
  const open = await paged(page(["OPEN"]));
  return limited(unique([...recent, ...open]), 4, (pr) => completed(api, pr).then((full) => pullRequestRecord(api, repo, full)));
}

// The UPDATED_AT DESC listing can stop once a whole page is older than the
// window; an all-history report reads everything. What the last page brings
// from before the window is dropped: nothing about it can have happened in
// the window, and the ones still open come from the OPEN listing.
const olderThan = (fromUtc) => (nodes) => Boolean(fromUtc) && nodes.length > 0 && nodes.every((n) => n.updatedAt < fromUtc);
const since = (fromUtc) => (n) => !fromUtc || n.updatedAt >= fromUtc;

// A nested connection with more than one page is read to its end through the
// pull request's own node, and so is a review thread's list of comments.
async function completed(api, pr) {
  const nests = await Promise.all(Object.keys(NESTS).map(async (field) => [field, await remainderOf(api, pr.id, field, pr[field])]));
  const full = { ...pr, ...Object.fromEntries(nests) };
  return { ...full, reviewThreads: { ...full.reviewThreads, nodes: await Promise.all(full.reviewThreads.nodes.map((t) => threadComments(api, t))) } };
}

const NODE = (field) => `query More($id: ID!, $cursor: String) { node(id: $id) { ... on PullRequest { ${field}(first: ${NESTED}, after: $cursor${NESTS[field].args}) { ${CONN} nodes { ${NESTS[field].nodes} } } } } }`;

async function remainderOf(api, id, field, first) {
  if (!first?.pageInfo?.hasNextPage) return first;
  const more = await paged((cursor) => graphql(api, NODE(field), { id, cursor }).then((d) => d.node[field]), undefined, first.pageInfo.endCursor, new Set([first.pageInfo.endCursor]));
  return { ...first, nodes: [...first.nodes, ...more], pageInfo: { hasNextPage: false } };
}

const THREAD = `query ThreadComments($id: ID!, $cursor: String) { node(id: $id) { ... on PullRequestReviewThread { comments(first: ${NESTED}, after: $cursor) { ${CONN} nodes { createdAt ${ACTOR} } } } } }`;

async function threadComments(api, thread) {
  if (!thread.comments?.pageInfo?.hasNextPage) return thread;
  const more = await paged((cursor) => graphql(api, THREAD, { id: thread.id, cursor }).then((d) => d.node.comments), undefined, thread.comments.pageInfo.endCursor, new Set([thread.comments.pageInfo.endCursor]));
  return { ...thread, comments: { ...thread.comments, nodes: [...thread.comments.nodes, ...more] } };
}

const actor = (a) => (a ? { login: a.login, name: a.name ?? null, bot: a.__typename === "Bot" || /\[bot\]$/.test(a.login ?? "") } : { login: null, bot: false });
const person = (p) => ({ login: p?.user?.login ?? null, name: p?.name ?? null, email: p?.email ?? null });

const EVENT_OF = { ReadyForReviewEvent: "ready", ConvertToDraftEvent: "draft", ClosedEvent: "closed", ReopenedEvent: "reopened", MergedEvent: "merged" };

function pullRequestRecord(api, repo, pr) {
  const state = pr.mergedAt ? "merged" : pr.state === "CLOSED" ? "closed" : "open";
  return { id: `github:${hostOf(api)}/${repo.full}#${pr.number}`, repo: repo.full, number: pr.number, url: pr.url, title: pr.title, author: actor(pr.author), mergedBy: pr.mergedBy ? { login: pr.mergedBy.login } : null, state, draft: pr.isDraft, createdAt: pr.createdAt, updatedAt: pr.updatedAt, mergedAt: pr.mergedAt, closedAt: pr.closedAt, baseRef: pr.baseRefName, headRef: pr.headRefName, additions: pr.additions, deletions: pr.deletions, changedFiles: pr.changedFiles, labels: pr.labels.nodes.map((l) => l.name), linkedWorkItems: pr.closingIssuesReferences.nodes.map((i) => `github:${hostOf(api)}/${i.repository.nameWithOwner}!${i.number}`), ...nestedRecords(pr), truncated: [] };
}

function nestedRecords(pr) {
  const threads = pr.reviewThreads.nodes;
  return { commits: pr.commits.nodes.map(({ commit: c }) => ({ oid: c.oid, authoredAt: c.authoredDate, committedAt: c.committedDate, author: person(c.author), committer: person(c.committer), message: c.message })), files: pr.files.nodes.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions })), reviews: pr.reviews.nodes.map((r) => ({ author: actor(r.author), state: r.state, submittedAt: r.submittedAt })), threads: threads.map((t) => ({ resolved: t.isResolved, outdated: t.isOutdated, startedAt: t.comments.nodes[0]?.createdAt ?? null, author: actor(t.comments.nodes[0]?.author), comments: t.comments.totalCount })), comments: pr.comments.nodes.map((c) => ({ author: actor(c.author), createdAt: c.createdAt })), reviewComments: threads.flatMap((t) => t.comments.nodes.map((c) => ({ author: actor(c.author), createdAt: c.createdAt }))), events: pr.timelineItems.nodes.filter((e) => EVENT_OF[e.__typename]).map((e) => ({ type: EVENT_OF[e.__typename], at: e.createdAt })) };
}

// Rows from every repository read, and ONE status for the collection: forbidden
// when none could be read, partial when some could not.
function rowsAndState(read, what) {
  const rows = read.filter((r) => r.ok).flatMap((r) => r.value);
  const bad = read.filter((r) => !r.ok);
  if (!bad.length) return { rows, state: { status: "complete", items: rows.length } };
  return { rows, state: { status: bad.length === read.length ? "forbidden" : "partial", items: rows.length, reason: `${what}: ${bad[0].reason}`, permission: bad[0].permission ?? null } };
}

// ---- issues -------------------------------------------------------------------------

const ISSUES = `query Issues($owner: String!, $name: String!, $cursor: String, $states: [IssueState!]) { repository(owner: $owner, name: $name) { issues(first: 50, after: $cursor, states: $states, orderBy: { field: UPDATED_AT, direction: DESC }) { pageInfo { hasNextPage endCursor } nodes { id number title url state stateReason createdAt updatedAt closedAt labels(first: 20) { nodes { name } } timelineItems(first: ${NESTED}, itemTypes: [CLOSED_EVENT, REOPENED_EVENT]) { ${CONN} nodes { __typename ... on ClosedEvent { createdAt stateReason } ... on ReopenedEvent { createdAt } } } } } } }`;

async function issuesOf(api, req, repos) {
  if (req.scope.issues === false) return { rows: [], state: { status: "not-configured", reason: "issues are switched off in this project's scope" } };
  const read = await limited(repos, 2, (repo) => collectionTry(() => issuesOfRepo(api, req, repo)));
  return rowsAndState(read, "issues");
}

async function issuesOfRepo(api, req, repo) {
  const page = (states) => (cursor) => graphql(api, ISSUES, { owner: repo.owner, name: repo.name, cursor, states }).then((d) => d.repository.issues);
  const rows = unique([...(await paged(page(["OPEN", "CLOSED"]), olderThan(req.window.fromUtc))).filter(since(req.window.fromUtc)), ...(await paged(page(["OPEN"])))]);
  return limited(rows, 4, (i) => issueEvents(api, i).then((full) => issueRecord(api, repo, full)));
}

const ISSUE_MORE = `query IssueEvents($id: ID!, $cursor: String) { node(id: $id) { ... on Issue { timelineItems(first: ${NESTED}, after: $cursor, itemTypes: [CLOSED_EVENT, REOPENED_EVENT]) { ${CONN} nodes { __typename ... on ClosedEvent { createdAt stateReason } ... on ReopenedEvent { createdAt } } } } } }`;

async function issueEvents(api, issue) {
  if (!issue.timelineItems.pageInfo.hasNextPage) return issue;
  const more = await paged((cursor) => graphql(api, ISSUE_MORE, { id: issue.id, cursor }).then((d) => d.node.timelineItems), undefined, issue.timelineItems.pageInfo.endCursor, new Set([issue.timelineItems.pageInfo.endCursor]));
  return { ...issue, timelineItems: { ...issue.timelineItems, nodes: [...issue.timelineItems.nodes, ...more] } };
}

// An issue's state at any moment, rebuilt from its events: opened, closed as
// completed or as not planned (canceled), reopened.
function issueRecord(api, repo, i) {
  const history = [{ at: i.createdAt, state: "open", category: "proposed" }, ...i.timelineItems.nodes.map(historyStep)].sort((a, b) => a.at.localeCompare(b.at));
  const bug = i.labels.nodes.some((l) => /^(bug|defect)$/i.test(l.name));
  return { id: `github:${hostOf(api)}/${repo.full}!${i.number}`, key: `#${i.number}`, title: i.title, url: i.url, type: bug ? "Bug" : "Issue", kind: bug ? "bug" : "issue", createdAt: i.createdAt, state: history.at(-1).state, category: history.at(-1).category, history, pointInTime: true, linkedPullRequests: [], labels: i.labels.nodes.map((l) => l.name), fields: {} };
}

const historyStep = (e) => (e.__typename === "ReopenedEvent" ? { at: e.createdAt, state: "open", category: "proposed" } : { at: e.createdAt, state: "closed", category: e.stateReason === "NOT_PLANNED" ? "removed" : "completed" });

// ---- iterations (a Projects iteration field) ------------------------------------------

const PROJECT = "query Project($org: String!, $number: Int!) { organization(login: $org) { projectV2(number: $number) { title fields(first: 50) { nodes { __typename ... on ProjectV2IterationField { name configuration { iterations { id title startDate duration } completedIterations { id title startDate duration } } } } } } } }";

async function iterationsOf(api, req) {
  const number = (req.scope.projects ?? [])[0];
  if (!number) return { rows: [], state: { status: "not-configured", reason: "no Projects board is set for this project's periods" } };
  const read = await collectionTry(() => graphql(api, PROJECT, { org: req.connection.organization, number: Number(number) }));
  if (!read.ok) return { rows: [], state: { status: "forbidden", reason: read.reason, permission: read.permission ?? "Projects (read), an organization permission" } };
  return iterationRows(read.value?.organization?.projectV2, req.window.tz);
}

function iterationRows(project, tz) {
  const field = (project?.fields?.nodes ?? []).find((f) => f.__typename === "ProjectV2IterationField");
  if (!field) return { rows: [], state: { status: "missing", reason: "the Projects board has no iteration field" } };
  const rows = [...field.configuration.completedIterations, ...field.configuration.iterations].map((it) => iterationRecord(it, tz));
  return { rows, state: { status: "complete", items: rows.length, reason: `iterations of ${project.title} · ${field.name}` } };
}

// An iteration's dates are calendar days; its instants are the project's local
// midnights, so an iteration is the same days in the report as on the board.
const iterationRecord = (it, tz) => ({ id: `github:iteration/${it.id}`, name: it.title, startDate: it.startDate, finishDate: addDays(it.startDate, it.duration - 1), durationDays: it.duration, startUtc: new Date(dayStart(it.startDate, tz)).toISOString(), endUtc: new Date(dayStart(addDays(it.startDate, it.duration), tz)).toISOString() });

// ---- Actions runs (builds) --------------------------------------------------------------

async function buildsOf(api, req, repos) {
  if (req.scope.actions === false) return { rows: [], state: { status: "not-configured", reason: "Actions runs are switched off in this project's scope" } };
  const read = await limited(repos, 2, (repo) => collectionTry(() => runsOfRepo(api, req, repo)));
  return rowsAndState(read, "Actions runs");
}

// The runs listing answers at most 1,000 rows for a date filter, so the window
// is read in slices, and a slice that fills up is halved until none does.
async function runsOfRepo(api, req, repo) {
  const from = (req.window.fromUtc ?? "2008-01-01T00:00:00Z").slice(0, 10);
  const rows = await runsBetween(api, repo, from, req.window.cutoffUtc.slice(0, 10));
  return unique(rows).map((run) => buildRecord(api, repo, run));
}

async function runsBetween(api, repo, from, to) {
  const first = await rest(api, `/repos/${repo.full}/actions/runs?per_page=100&created=${from}..${to}&page=1`);
  if ((first.json?.total_count ?? 0) >= 1000 && from < to) return halves(api, repo, from, to);
  return [...(first.json?.workflow_runs ?? []), ...(await runPages(api, repo, from, to, first.json?.total_count ?? 0))];
}

async function halves(api, repo, from, to) {
  const middle = new Date((Date.parse(from) + Date.parse(to)) / 2).toISOString().slice(0, 10);
  const later = middle === from ? to : addDays(middle, 1);
  return [...(await runsBetween(api, repo, from, middle === to ? from : middle)), ...(await runsBetween(api, repo, later, to))];
}

async function runPages(api, repo, from, to, total) {
  const pages = Array.from({ length: Math.max(0, Math.ceil(Math.min(total, 1000) / 100) - 1) }, (_, i) => i + 2);
  const read = [];
  for (const n of pages) read.push(...((await rest(api, `/repos/${repo.full}/actions/runs?per_page=100&created=${from}..${to}&page=${n}`)).json?.workflow_runs ?? []));
  return read;
}

const RESULT = { success: "success", failure: "failure", cancelled: "canceled", timed_out: "failure", skipped: "skipped", neutral: "success", action_required: "failure", startup_failure: "failure" };

const buildRecord = (api, repo, r) => ({ id: `github:${hostOf(api)}/${repo.full}/run/${r.id}`, pipeline: r.name ?? r.path ?? "workflow", result: RESULT[r.conclusion] ?? (r.status === "completed" ? "unknown" : "running"), status: r.status, queuedAt: r.created_at, startedAt: r.run_started_at ?? r.created_at, finishedAt: r.status === "completed" ? r.updated_at : null, branch: r.head_branch, event: r.event, url: r.html_url });

// ---- deployments ------------------------------------------------------------------------------

const DEPLOY_LIMIT = 500;

async function deploymentsOf(api, req, repos) {
  if (req.scope.deployments === false) return { rows: [], state: { status: "not-configured", reason: "deployments are switched off in this project's scope" } };
  const read = await limited(repos, 2, (repo) => collectionTry(() => deploysOfRepo(api, req, repo)));
  return rowsAndState(read, "deployments");
}

// Newest first, until one was created before the window; each one's statuses
// say how it ended.
async function deploysOfRepo(api, req, repo, page = 1, got = []) {
  const listed = (await rest(api, `/repos/${repo.full}/deployments?per_page=100&page=${page}`)).json ?? [];
  const inWindow = listed.filter((d) => !req.window.fromUtc || d.created_at >= req.window.fromUtc);
  got.push(...inWindow);
  if (listed.length < 100 || inWindow.length < listed.length || got.length >= DEPLOY_LIMIT) return limited(got.slice(0, DEPLOY_LIMIT), 4, (d) => deployRecord(api, repo, d));
  return deploysOfRepo(api, req, repo, page + 1, got);
}

async function deployRecord(api, repo, d) {
  const statuses = (await rest(api, `/repos/${repo.full}/deployments/${d.id}/statuses?per_page=100`)).json ?? [];
  const final = statuses.find((s) => ["success", "failure", "error", "inactive"].includes(s.state));
  return { id: `github:${hostOf(api)}/${repo.full}/deploy/${d.id}`, environment: d.environment, status: final ? (final.state === "success" || final.state === "inactive" ? "success" : "failure") : "unknown", createdAt: d.created_at, finishedAt: final?.created_at ?? null, ref: d.ref };
}

// ---- stops -----------------------------------------------------------------------------------

// What ends a run, in the words a person can act on.
const RUN_STOPS = { auth: (e) => new Blocked(`GitHub refused the connection's credential: ${e.message}`), rate: (e) => new Blocked(e.message), server: (e) => new Blocked(`GitHub is not answering: ${e.message}`), network: (e) => new Blocked(e.message), redirect: (e) => new Blocked(e.message), invalid: (e) => new Blocked(`GitHub's answer could not be used: ${e.message}`) };

async function guarded(fn) {
  try { return await fn(); }
  catch (e) { throw e instanceof HttpStop ? (RUN_STOPS[e.kind] ?? RUN_STOPS.invalid)(e) : e; }
}

// ---- probe: can this connection read what this project's report needs? ------------------------

// Authentication first; then, for every repository in scope, each thing the
// report reads -- each answered on its own, so a missing optional permission
// is named and does not fail the rest.
async function probe(req, deps) {
  const api = apiOf(req, deps);
  const me = await checked(() => rest(api, "/user"));
  if (!me.ok) return { ok: false, identity: null, checks: [{ id: "authentication", status: me.status, message: me.message }] };
  const checks = [{ id: "authentication", status: "ok", message: `signed in as ${me.value.json?.login ?? "an account"}` }, ...privilegeOf(me.value), ...(await scopeChecks(api, req))];
  return { ok: checks.every((c) => ["ok", "warning", "not-configured"].includes(c.status)), identity: me.value.json?.login ?? null, checks };
}

async function checked(fn) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return { ok: false, status: e instanceof HttpStop ? statusWord(e) : "error", message: e.message, permission: e.permission ?? null }; }
}

const statusWord = (e) => ({ auth: "unauthorized", forbidden: "forbidden", "not-found": "not-found" })[e.kind] ?? "error";

// A classic token says its scopes; one that could write is named, because a
// report never needs to.
function privilegeOf(answer) {
  const scopes = answer.headers?.get?.("x-oauth-scopes");
  if (!scopes) return [];
  return [{ id: "least-privilege", status: "warning", message: `this is a classic token with scopes "${scopes}"; a report needs only read access — a fine-grained, read-only token is safer` }];
}

const PROBES = [
  { id: "metadata", setting: null, path: (r) => `/repos/${r}`, permission: "Metadata (read)" },
  { id: "pullRequests", setting: null, path: (r) => `/repos/${r}/pulls?per_page=1&state=all`, permission: "Pull requests (read)" },
  { id: "issues", setting: "issues", path: (r) => `/repos/${r}/issues?per_page=1&state=all`, permission: "Issues (read)" },
  { id: "actions", setting: "actions", path: (r) => `/repos/${r}/actions/runs?per_page=1`, permission: "Actions (read)" },
  { id: "deployments", setting: "deployments", path: (r) => `/repos/${r}/deployments?per_page=1`, permission: "Deployments (read)" },
];

async function scopeChecks(api, req) {
  const repos = [...new Set((req.scope?.repositories ?? []).map(String))];
  if (!repos.length) return [{ id: "scope", status: "not-configured", message: "no repositories are set for this project yet; set the scope, then test again" }];
  const rows = repos.flatMap((repo) => PROBES.map((p) => ({ p, repo })));
  return limited(rows, 4, ({ p, repo }) => oneProbe(api, req, p, repo));
}

async function oneProbe(api, req, p, repo) {
  if (p.setting && req.scope?.[p.setting] === false) return { id: `${repo} · ${p.id}`, status: "not-configured", message: "switched off in this project's scope" };
  const got = await checked(() => rest(api, p.path(repo)));
  return got.ok ? { id: `${repo} · ${p.id}`, status: "ok" } : { id: `${repo} · ${p.id}`, status: got.status, permission: got.permission ?? p.permission, message: got.message };
}
