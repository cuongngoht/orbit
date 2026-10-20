// A small GitHub, in memory: the GraphQL operations and REST routes the
// collector asks, paged the way GitHub pages -- cursors that are offsets, a
// nested connection that stops at its `first`, node(id) to read the rest. Every
// request is recorded (URL, method, whether it carried the credential), so a test
// can prove what was asked, and of whom.
//
// repos: { "owner/name": { prs: [spec], issues: [spec], runs: [run], deployments: [d] } }
// fail:  { [route]: { status, headers, body, times } } -- route is a GraphQL op
//        ("PullRequests") or a REST path suffix ("/issues", "/user")
const json = (status, body, headers = {}) => ({ status, headers: new Headers({ "content-type": "application/json", ...headers }), json: async () => body, text: async () => JSON.stringify(body) });

export function fakeGitHub({ repos = {}, fail = {}, origin = "https://api.github.com", repeatPage = null, stuckCursor = false } = {}) {
  const calls = [];
  const fails = Object.fromEntries(Object.entries(fail).map(([k, v]) => [k, { ...v, left: v.times ?? Infinity }]));
  const fetch = async (url, init = {}) => answer({ repos, fails, calls, origin, repeatPage, stuckCursor }, new URL(url), init);
  return { fetch, calls };
}

async function answer(s, url, init) {
  s.calls.push({ url: url.href, method: init.method ?? "GET", auth: Boolean(init.headers?.authorization), op: init.body ? /query (\w+)/.exec(JSON.parse(init.body).query)?.[1] : null });
  if (url.origin !== s.origin) return json(200, { elsewhere: true });
  const failure = failing(s, url, init);
  if (failure) return failure;
  return url.pathname.endsWith("/graphql") ? graph(s, JSON.parse(init.body)) : rest(s, url);
}

function failing(s, url, init) {
  const op = init.body ? /query (\w+)/.exec(JSON.parse(init.body).query)?.[1] : null;
  const key = Object.keys(s.fails).find((k) => k === op || (!op && url.pathname.endsWith(k)));
  if (!key || s.fails[key].left-- <= 0) return null;
  const f = s.fails[key];
  if (f.html) return { status: f.status ?? 200, headers: new Headers({ "content-type": "text/html" }), json: async () => { throw new Error("not json"); }, text: async () => "<html>sign in</html>" };
  return json(f.status, f.body ?? { message: "no" }, f.headers ?? {});
}

// ---- GraphQL ------------------------------------------------------------------------

const PAGE = 25;
const NESTED = 100;

function graph(s, { query, variables: v }) {
  const op = /query (\w+)/.exec(query)[1];
  return json(200, OPS[op] ? OPS[op](s, v, query) : { errors: [{ message: `no op ${op}` }] });
}

const repoOf = (s, v) => s.repos[`${v.owner}/${v.name}`];

const OPS = {
  Repo: (s, v) => (repoOf(s, v) ? { data: { repository: { id: `R_${v.owner}/${v.name}`, nameWithOwner: `${v.owner}/${v.name}`, url: `https://github.com/${v.owner}/${v.name}`, isPrivate: true, defaultBranchRef: { name: "main" } } } } : { data: { repository: null }, errors: [{ type: "NOT_FOUND", path: ["repository"], message: "Could not resolve to a Repository" }] }),
  PullRequests: (s, v) => ({ data: { rateLimit: { remaining: 4999 }, repository: { pullRequests: paged(s, listed(repoOf(s, v).prs, v.states), v.cursor, PAGE, (pr) => prNode(`${v.owner}/${v.name}`, pr)) } } }),
  More: (s, v, q) => ({ data: { node: moreOf(s, v, /\.\.\. on PullRequest \{ (\w+)\(first/.exec(q)?.[1]) } }),
  Issues: (s, v) => ({ data: { repository: { issues: paged(s, listed(repoOf(s, v).issues ?? [], v.states), v.cursor, 50, issueNode) } } }),
  ThreadComments: () => ({ data: { node: { comments: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } } }),
  IssueEvents: () => ({ data: { node: { timelineItems: { totalCount: 0, pageInfo: { hasNextPage: false }, nodes: [] } } } }),
  Project: () => ({ data: { organization: null }, errors: [{ type: "FORBIDDEN", message: "Resource not accessible by personal access token" }] }),
};

const STATE = { OPEN: (p) => p.state === "OPEN", CLOSED: (p) => p.state === "CLOSED", MERGED: (p) => p.state === "MERGED" };
const listed = (rows, states) => rows.filter((p) => (states ?? ["OPEN", "CLOSED", "MERGED"]).some((st) => STATE[st](p))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

function paged(s, rows, cursor, size, node) {
  const start = cursor ? Number(cursor) : 0;
  const slice = rows.slice(start, start + size);
  const repeated = s.repeatPage !== null && start > 0 && start === s.repeatPage ? [rows[start - 1], ...slice] : slice;
  const next = start + size < rows.length;
  return { pageInfo: { hasNextPage: next, endCursor: next ? String(s.stuckCursor && start > 0 ? start : start + size) : null }, nodes: repeated.map(node) };
}

const conn = (all, first = NESTED) => ({ totalCount: all.length, pageInfo: { hasNextPage: all.length > first, endCursor: all.length > first ? String(first) : null }, nodes: all.slice(0, first) });

const commitsOf = (pr) => Array.from({ length: pr.commits ?? 1 }, (_, i) => ({ commit: { oid: `${pr.number}-${i}`, authoredDate: pr.createdAt, committedDate: pr.createdAt, message: "work", author: { name: "Lan", email: "lan@example.test", user: { login: "lan" } }, committer: { name: "Lan", email: "lan@example.test", user: { login: "lan" } } } }));

function prNode(repo, pr) {
  return { id: `PR_${repo}#${pr.number}`, number: pr.number, title: pr.title ?? `PR ${pr.number}`, url: `https://github.com/${repo}/pull/${pr.number}`, state: pr.state, isDraft: false, createdAt: pr.createdAt, updatedAt: pr.updatedAt, mergedAt: pr.mergedAt ?? null, closedAt: pr.closedAt ?? pr.mergedAt ?? null, author: { login: "lan", __typename: "User", name: "Lan" }, mergedBy: pr.mergedAt ? { login: "minh" } : null, baseRefName: "main", headRefName: `topic/${pr.number}`, additions: 10, deletions: 2, changedFiles: 1,
    labels: { nodes: [] }, closingIssuesReferences: { nodes: [] }, commits: conn(commitsOf(pr)), files: conn([{ path: "src/a.ts", additions: 10, deletions: 2 }]), reviews: conn([{ author: { login: "minh", __typename: "User" }, state: "APPROVED", submittedAt: pr.createdAt }]), reviewThreads: conn([]), comments: conn([]), timelineItems: conn([]) };
}

// node(id) for the rest of a pull request's nested connection, from its cursor.
function moreOf(s, v, field) {
  const [repo, number] = String(v.id).replace(/^PR_/, "").split("#");
  const pr = s.repos[repo].prs.find((p) => String(p.number) === number);
  const all = commitsOf(pr);
  const start = Number(v.cursor);
  return { [field ?? "commits"]: { totalCount: all.length, pageInfo: { hasNextPage: start + NESTED < all.length, endCursor: start + NESTED < all.length ? String(start + NESTED) : null }, nodes: all.slice(start, start + NESTED) } };
}

const issueNode = (i) => ({ id: `I_${i.number}`, number: i.number, title: `Issue ${i.number}`, url: `https://github.com/acme/web/issues/${i.number}`, state: i.state, stateReason: i.stateReason ?? null, createdAt: i.createdAt, updatedAt: i.updatedAt, closedAt: i.closedAt ?? null, labels: { nodes: (i.labels ?? []).map((name) => ({ name })) }, timelineItems: conn(i.events ?? []) });

// ---- REST -------------------------------------------------------------------------------

function rest(s, url) {
  const route = ROUTES.find((r) => r.match.test(url.pathname));
  return route ? route.answer(s, url, route.match.exec(url.pathname)) : json(404, { message: "Not Found" });
}

const ROUTES = [
  { match: /^\/user$/, answer: () => json(200, { login: "lan" }) },
  { match: /^\/repos\/([^/]+\/[^/]+)$/, answer: (s, url, m) => (s.repos[m[1]] ? json(200, { full_name: m[1] }) : json(404, { message: "Not Found" })) },
  { match: /^\/repos\/([^/]+\/[^/]+)\/(pulls|issues)$/, answer: () => json(200, []) },
  { match: /^\/repos\/([^/]+\/[^/]+)\/actions\/runs$/, answer: (s, url, m) => runs(s.repos[m[1]]?.runs ?? [], url) },
  { match: /^\/repos\/([^/]+\/[^/]+)\/deployments$/, answer: (s, url, m) => pageOf(s.repos[m[1]]?.deployments ?? [], url) },
  { match: /^\/repos\/([^/]+\/[^/]+)\/deployments\/(\d+)\/statuses$/, answer: () => json(200, [{ state: "success", created_at: "2026-07-10T01:00:00Z" }]) },
];

function runs(all, url) {
  const [from, to] = (url.searchParams.get("created") ?? "..").split("..");
  const inRange = all.filter((r) => r.created_at.slice(0, 10) >= from && r.created_at.slice(0, 10) <= to);
  const page = Number(url.searchParams.get("page") ?? 1);
  return json(200, { total_count: inRange.length, workflow_runs: inRange.slice(Math.min(1000, (page - 1) * 100), Math.min(1000, page * 100)) });
}

function pageOf(all, url) {
  const page = Number(url.searchParams.get("page") ?? 1);
  return json(200, all.slice((page - 1) * 100, page * 100));
}
