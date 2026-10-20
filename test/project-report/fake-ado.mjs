// A small Azure DevOps, in memory: a project whose work items have revisions
// (so any moment's state can be asked AS OF it), repositories with pull
// requests, builds and classic release deployments -- paged the ways Azure
// DevOps pages: $top/$skip, a continuation token in a header or in the body.
//
// items: [{ id, type, title, createdAt, revisions: [{ at, state }] }]   (rev 1 = created)
const json = (status, body, headers = {}) => ({ status, headers: new Headers({ "content-type": "application/json; charset=utf-8", ...headers }), json: async () => body, text: async () => JSON.stringify(body) });
const html = (status) => ({ status, headers: new Headers({ "content-type": "text/html" }), json: async () => { throw new Error("html"); }, text: async () => "<html>Sign in</html>" });

export const TYPES = [
  { name: "User Story", states: [{ name: "New", category: "Proposed" }, { name: "Active", category: "InProgress" }, { name: "Waiting on Vendor", category: "InProgress" }, { name: "Resolved", category: "Resolved" }, { name: "Closed", category: "Completed" }, { name: "Removed", category: "Removed" }] },
  { name: "Bug", states: [{ name: "New", category: "Proposed" }, { name: "Active", category: "InProgress" }, { name: "Closed", category: "Completed" }] },
  { name: "Task", states: [{ name: "To Do", category: "Proposed" }, { name: "Done", category: "Completed" }] },
];
const CATEGORIES = [{ referenceName: "Microsoft.RequirementCategory", workItemTypes: [{ name: "User Story" }] }, { referenceName: "Microsoft.BugCategory", workItemTypes: [{ name: "Bug" }] }, { referenceName: "Microsoft.TaskCategory", workItemTypes: [{ name: "Task" }] }];

export function fakeAdo({ org = "acme", project = "portal", items = [], repos = [], builds = [], deployments = [], iterations = [], fail = {}, tooMany = Infinity, revisionPage = 100 } = {}) {
  const s = { org, project, items, repos, builds, deployments, iterations, fail: Object.fromEntries(Object.entries(fail).map(([k, v]) => [k, { ...v, left: v.times ?? Infinity }])), tooMany, revisionPage, calls: [], batches: [] };
  return { fetch: async (url, init = {}) => answer(s, new URL(url), init), calls: s.calls, batches: s.batches };
}

async function answer(s, url, init) {
  const body = init.body ? JSON.parse(init.body) : null;
  s.calls.push({ url: url.href, host: url.host, method: init.method ?? "GET", auth: init.headers?.authorization ?? null });
  const failure = failing(s, url);
  if (failure) return failure;
  const route = ROUTES.find((r) => r.host(url) && r.match.test(url.pathname));
  return route ? route.answer(s, url, body, route.match.exec(url.pathname)) : json(404, { message: `no route ${url.pathname}` });
}

function failing(s, url) {
  const key = Object.keys(s.fail).find((k) => url.pathname.includes(k));
  if (!key || s.fail[key].left-- <= 0) return null;
  return s.fail[key].html ? html(s.fail[key].status ?? 203) : json(s.fail[key].status, s.fail[key].body ?? { message: "denied" });
}

const DEV = (url) => url.host === "dev.azure.com";
const VSRM = (url) => url.host === "vsrm.dev.azure.com";

// ---- work items as of any moment ------------------------------------------------------

const upTo = (item, moment) => item.revisions.filter((r) => r.at <= moment);
const stateAt = (item, moment) => upTo(item, moment).at(-1)?.state ?? null;
const changedAt = (item, moment) => upTo(item, moment).at(-1)?.at ?? null;
const categoryOf = (type, state) => TYPES.find((t) => t.name === type)?.states.find((x) => x.name === state)?.category;

function stateChangeAt(item, moment) {
  const revs = upTo(item, moment);
  const last = revs.findLastIndex((r, i) => i === 0 || r.state !== revs[i - 1].state);
  return revs[last]?.at ?? null;
}

const activatedAt = (item, moment) => upTo(item, moment).find((r) => categoryOf(item.type, r.state) === "InProgress")?.at ?? null;

function wiql(s, query) {
  const asOf = /ASOF '([^']+)'/.exec(query)?.[1] ?? "9999-12-31T00:00:00Z";
  const typed = /\[System\.WorkItemType\] IN \(([^)]*)\)/.exec(query);
  const types = typed ? [...typed[1].matchAll(/'([^']*)'/g)].map((m) => m[1]) : TYPES.map((t) => t.name);
  const range = /\[System\.ChangedDate\] >= '([^']+)' AND \[System\.ChangedDate\] < '([^']+)'/.exec(query);
  const states = /\[System\.State\] IN \(([^)]*)\)/.exec(query);
  const live = s.items.filter((i) => types.includes(i.type) && i.createdAt <= asOf);
  const hit = range ? live.filter((i) => changedAt(i, asOf) >= range[1] && changedAt(i, asOf) < range[2]) : states ? live.filter((i) => [...states[1].matchAll(/'([^']*)'/g)].map((m) => m[1]).includes(stateAt(i, asOf))) : live;
  if (range && hit.length > s.tooMany) return json(400, { message: "VS402337: The number of work items returned exceeds the size limit of 20000. Change the query to return fewer work items." });
  return json(200, { workItems: hit.map((i) => ({ id: i.id })) });
}

function batch(s, body) {
  s.batches.push(body.ids.length);
  const rows = body.ids.map((id) => s.items.find((i) => i.id === id)).filter((i) => i && i.createdAt <= body.asOf);
  return json(200, { value: rows.map((i) => ({ id: i.id, fields: { "System.Id": i.id, "System.Title": i.title ?? `Item ${i.id}`, "System.WorkItemType": i.type, "System.State": stateAt(i, body.asOf), "System.CreatedDate": i.createdAt, "System.ChangedDate": changedAt(i, body.asOf), "System.IterationPath": "portal\\Sprint 1", "Microsoft.VSTS.Common.StateChangeDate": stateChangeAt(i, body.asOf), ...(activatedAt(i, body.asOf) ? { "Microsoft.VSTS.Common.ActivatedDate": activatedAt(i, body.asOf) } : {}) } })) });
}

function revisions(s, url) {
  const start = url.searchParams.get("startDateTime");
  const all = s.items.flatMap((i) => i.revisions.map((r, n) => ({ id: i.id, rev: n + 1, fields: { "System.Id": i.id, "System.Rev": n + 1, "System.State": r.state, "System.WorkItemType": i.type, "System.ChangedDate": r.at } }))).filter((r) => r.fields["System.ChangedDate"] >= start);
  const from = Number(url.searchParams.get("continuationToken") ?? 0);
  const page = all.slice(from, from + s.revisionPage);
  const last = from + s.revisionPage >= all.length;
  return json(200, { values: page, isLastBatch: last, continuationToken: last ? null : String(from + s.revisionPage) });
}

// ---- repos, pipelines, releases ------------------------------------------------------------

const skipTop = (rows, url) => rows.slice(Number(url.searchParams.get("$skip") ?? 0), Number(url.searchParams.get("$skip") ?? 0) + Number(url.searchParams.get("$top") ?? 100));

function pullRequests(s, url, m) {
  const repo = s.repos.find((r) => r.id === m[1]);
  const status = url.searchParams.get("searchCriteria.status");
  const min = url.searchParams.get("searchCriteria.minTime");
  const rows = status === "active" ? repo.prs.filter((p) => p.status === "active") : repo.prs.filter((p) => p.closedDate && p.closedDate >= min);
  return json(200, { value: skipTop(rows, url).map((p) => ({ ...p, repository: { id: repo.id } })) });
}

function tokened(rows, url, size = 100) {
  const from = Number(url.searchParams.get("continuationToken") ?? 0);
  const next = from + size < rows.length ? { "x-ms-continuationtoken": String(from + size) } : {};
  return json(200, { value: rows.slice(from, from + size) }, next);
}

const prOf = (s, m) => s.repos.find((r) => r.id === m[1]).prs.find((p) => String(p.pullRequestId) === m[2]);

const ROUTES = [
  { host: DEV, match: /^\/acme\/_apis\/connectionData$/, answer: () => json(200, { authenticatedUser: { providerDisplayName: "Lan Nguyen" } }) },
  { host: DEV, match: /^\/acme\/_apis\/projects\/([^/]+)$/, answer: (s, url, b, m) => (decodeURIComponent(m[1]) === s.project ? json(200, { id: "p1", name: s.project, defaultTeam: { name: `${s.project} Team` } }) : json(404, { message: "TF200016: The project does not exist" })) },
  { host: DEV, match: /^\/acme\/portal\/_apis\/wit\/workitemtypes$/, answer: () => json(200, { value: TYPES }) },
  { host: DEV, match: /^\/acme\/portal\/_apis\/wit\/workitemtypecategories$/, answer: () => json(200, { value: CATEGORIES }) },
  { host: DEV, match: /^\/acme\/portal\/_apis\/wit\/wiql$/, answer: (s, url, b) => wiql(s, b.query) },
  { host: DEV, match: /^\/acme\/_apis\/wit\/workitemsbatch$/, answer: (s, url, b) => batch(s, b) },
  { host: DEV, match: /^\/acme\/portal\/_apis\/wit\/reporting\/workitemrevisions$/, answer: (s, url) => revisions(s, url) },
  { host: DEV, match: /^\/acme\/portal\/portal%20Team\/_apis\/work\/teamsettings\/iterations$/, answer: (s) => json(200, { value: s.iterations }) },
  { host: DEV, match: /^\/acme\/portal\/_apis\/git\/repositories$/, answer: (s) => json(200, { value: s.repos.map((r) => ({ id: r.id, name: r.name, webUrl: `https://dev.azure.com/acme/portal/_git/${r.name}`, defaultBranch: "refs/heads/main" })) }) },
  { host: DEV, match: /^\/acme\/portal\/_apis\/git\/repositories\/([^/]+)\/pullrequests$/, answer: (s, url, b, m) => pullRequests(s, url, m) },
  { host: DEV, match: /^\/acme\/portal\/_apis\/git\/repositories\/([^/]+)\/pullRequests\/(\d+)\/threads$/, answer: (s, url, b, m) => json(200, { value: prOf(s, m).threads ?? [] }) },
  { host: DEV, match: /^\/acme\/portal\/_apis\/git\/repositories\/([^/]+)\/pullRequests\/(\d+)\/commits$/, answer: (s, url, b, m) => tokened(prOf(s, m).commits ?? [], url) },
  { host: DEV, match: /^\/acme\/portal\/_apis\/git\/repositories\/([^/]+)\/pullRequests\/(\d+)\/workitems$/, answer: (s, url, b, m) => json(200, { value: (prOf(s, m).workItems ?? []).map((id) => ({ id })) }) },
  { host: DEV, match: /^\/acme\/portal\/_apis\/build\/builds$/, answer: (s, url) => tokened(s.builds, url, Number(url.searchParams.get("$top")) === 1 ? 1 : 100) },
  { host: VSRM, match: /^\/acme\/portal\/_apis\/release\/deployments$/, answer: (s, url) => tokened(s.deployments, url) },
];
