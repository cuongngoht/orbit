// The standard AZURE DEVOPS collector (orbit.report.azure-devops): Boards work
// items as they were at the cut-off, Repos pull requests, Pipelines builds and
// environment deployments -- from Azure DevOps Services or a Server collection,
// REST 7.1, every page.
//
// Work items are asked AS OF the cut-off (WIQL ASOF, and workitemsbatch with
// `asOf`), so a report about July never reads a state from September. Which
// ones: every item of the backlog's types changed in the window, plus every item
// open at the cut-off. What a state MEANS is its category, read from the
// project's own work item types -- a custom "Waiting on Vendor" is in-progress
// because the process says so, and a state no category claims is listed, never
// guessed. The history between the window's start and the cut-off comes from
// the revisions; before it, from the state each item was in when the window
// began and the date it entered that state.
//
// Azure Repos does not report lines changed for a pull request, so its size is
// UNKNOWN in the snapshot -- never zero.
import { Blocked, Refused } from "../../../src/errors.mjs";
import { dayStart, addDays } from "../../../src/project-report/window.mjs";
import { HttpStop, createHttp, inTurn, limited } from "./http.mjs";

export const PROVIDER = "azure-devops";
const API = "api-version=7.1";
const BATCH = 200;

export const azureDevOpsSource = (deps = {}) => ({ id: PROVIDER, collect: (req) => guarded(() => collect(req, deps)), probe: (req) => probe(req, deps) });

// ---- the client ---------------------------------------------------------------

// https://dev.azure.com/<organization>, or a Server collection URL that already
// ends in the collection's name.
export function baseOf(connection) {
  const host = connection.host.replace(/\/+$/, "");
  return host.toLowerCase().endsWith(`/${String(connection.organization).toLowerCase()}`) ? host : `${host}/${connection.organization}`;
}

function apiOf(req, deps) {
  const base = baseOf(req.connection);
  const headers = { authorization: `Basic ${Buffer.from(`:${req.credential}`).toString("base64")}`, "user-agent": "orbit-report" };
  const http = createHttp({ fetch: req.fetch, origin: base, headers, sleep: deps.sleep ?? sleep, nowMs: req.nowMs, limits: deps.limits });
  return { http, base, headers, sleep: deps.sleep ?? sleep, limits: deps.limits, org: req.connection.organization, project: req.scope.project, raw: [] };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(api, path, opts = {}) {
  const r = await api.http.request(`${api.base}${path}`, opts);
  api.raw.push({ kind: "rest", path: path.replace(/\?.*$/, ""), answer: r.json });
  return r;
}

const at = (api, path) => `/${encodeURIComponent(api.project)}${path}`;

// Continuation tokens arrive in a header; a token that repeats stops the run.
async function continued(api, path, pick, token = null, seen = new Set(), got = []) {
  const r = await call(api, `${path}${token ? `&continuationToken=${encodeURIComponent(token)}` : ""}`);
  got.push(...pick(r.json));
  const next = r.headers.get("x-ms-continuationtoken") ?? r.json?.continuationToken ?? null;
  if (!next || r.json?.isLastBatch === true) return got;
  return continued(api, path, pick, next, advanced(next, seen), got);
}

function advanced(token, seen) {
  if (seen.has(token)) throw new HttpStop("invalid", "Azure DevOps' paging did not advance; stopped rather than read the same page again");
  return seen.add(token);
}

// $top/$skip paging until a short page.
async function skipped(api, path, top = 100, skip = 0, got = []) {
  const page = (await call(api, `${path}&$top=${top}&$skip=${skip}`)).json?.value ?? [];
  got.push(...page);
  return page.length < top ? got : skipped(api, path, top, skip + top, got);
}

// ---- collect --------------------------------------------------------------------

async function collect(req, deps) {
  if (!req.scope?.project) throw new Refused("an Azure DevOps report names its project: set scope.project");
  const api = apiOf(req, deps);
  const project = await projectOf(api);
  const parts = await inTurn([() => boardsOf(api, req, project), () => reposOf(api, req), () => buildsOf(api, req), () => deploymentsOf(api, req)]);
  return assembled(api, req, parts);
}

// The project itself must be readable: without it there is nothing to scope
// anything to, and that is a stop, not an empty report.
async function projectOf(api) {
  const got = await collectionTry(() => call(api, `/_apis/projects/${encodeURIComponent(api.project)}?${API}`));
  if (!got.ok) throw new Blocked(`project ${api.project} could not be read in ${api.org}: ${got.reason}${got.permission ? ` — it needs ${got.permission}` : ""}`);
  return got.value.json;
}

function assembled(api, req, [boards, repos, builds, deployments]) {
  const collections = { repositories: repos.repositories, pullRequests: repos.rows, workItems: boards.rows, workItemTypes: boards.types, iterations: boards.iterations, builds: builds.rows, deployments: deployments.rows };
  const completeness = { repositories: repos.repoState, pullRequests: repos.state, workItems: boards.state, workItemTypes: boards.typeState, iterations: boards.iterationState, builds: builds.state, deployments: deployments.state };
  return { source: { provider: PROVIDER, host: api.base, organization: api.org, scope: req.scope }, completeness, collections, raw: api.raw, earliest: [...collections.pullRequests, ...collections.workItems].map((r) => r.createdAt).filter(Boolean).sort()[0] ?? null };
}

// A collection the credential may not read is a status; once the credential
// itself was accepted, a 401 on one area means a scope the token lacks.
async function collectionTry(fn, permission = null) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return softStop(e, permission); }
}

function softStop(e, permission) {
  if (e instanceof HttpStop && ["forbidden", "not-found"].includes(e.kind)) return { ok: false, kind: e.kind, reason: e.message, permission: e.permission ?? permission };
  if (e instanceof HttpStop && e.kind === "auth" && permission) return { ok: false, kind: "forbidden", reason: `the credential may not read this (${e.message.replace(/^the credential was refused /, "")})`, permission };
  throw e;
}

const off = (reason) => ({ status: "not-configured", reason });
const failed = (read) => ({ status: read.kind === "not-found" ? "missing" : "forbidden", reason: read.reason, permission: read.permission });

// ---- Boards ----------------------------------------------------------------------

const CATEGORY = { Proposed: "proposed", InProgress: "in-progress", Resolved: "resolved", Completed: "completed", Removed: "removed" };
const KIND = { "Microsoft.RequirementCategory": "requirement", "Microsoft.BugCategory": "bug", "Microsoft.FeatureCategory": "feature", "Microsoft.EpicCategory": "epic" };
const BOARDS = "Work Items (Read)";

async function boardsOf(api, req, project) {
  if (req.scope.boards === false) return { rows: [], types: [], iterations: [], state: off("Boards are switched off in this project's scope"), typeState: off("Boards are switched off in this project's scope"), iterationState: off("Boards are switched off in this project's scope") };
  const read = await collectionTry(() => boardData(api, req, project), BOARDS);
  if (!read.ok) return { rows: [], types: [], iterations: [], state: failed(read), typeState: failed(read), iterationState: failed(read) };
  return read.value;
}

async function boardData(api, req, project) {
  const types = await typesOf(api);
  const ids = await idsOf(api, req, types);
  const rows = await itemsOf(api, req, ids.ids, types);
  const iterations = await iterationsOf(api, req, project);
  return { rows, types: types.list, iterations: iterations.rows, state: { status: ids.truncated ? "partial" : "complete", items: rows.length, reason: ids.truncated ?? null }, typeState: { status: "complete", items: types.list.length }, iterationState: iterations.state };
}

// Each type's states with the category the PROCESS gives them, and which types
// are the backlog's (requirements and bugs), read off the type categories.
async function typesOf(api) {
  const listed = (await call(api, at(api, `/_apis/wit/workitemtypes?${API}`))).json?.value ?? [];
  const categories = (await call(api, at(api, `/_apis/wit/workitemtypecategories?${API}`))).json?.value ?? [];
  const kinds = Object.fromEntries(categories.filter((c) => KIND[c.referenceName]).flatMap((c) => c.workItemTypes.map((t) => [t.name, KIND[c.referenceName]])));
  const list = listed.map((t) => ({ name: t.name, kind: kinds[t.name] ?? null, states: (t.states ?? []).map((s) => ({ name: s.name, category: CATEGORY[s.category] ?? "unknown" })) }));
  return { list, backlog: list.filter((t) => ["requirement", "bug"].includes(t.kind)), categoryOf: (type, state) => list.find((t) => t.name === type)?.states.find((s) => s.name === state)?.category ?? "unknown" };
}

const quoted = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Changed in the window, or open at the cut-off -- both AS OF the cut-off. A
// window with more than WIQL's 20,000 is read in halves until each fits.
async function idsOf(api, req, types) {
  if (!types.backlog.length) return { ids: [], truncated: "this process names no requirement or bug types" };
  const where = wiqlFor(req, types);
  const [changed, openNow] = [await changedIds(api, where, req.window.fromUtc ?? "2000-01-01T00:00:00Z", req.window.cutoffUtc), await wiql(api, where(`[System.State] IN (${openStates(types) || "''"})`))];
  return { ids: [...new Set([...changed, ...openNow.ids])], truncated: openNow.truncated };
}

// One query shape, AS OF the cut-off, with the clause that varies.
function wiqlFor(req, types) {
  const names = types.backlog.map((t) => quoted(t.name)).join(", ");
  const area = req.scope.areaPath ? ` AND [System.AreaPath] UNDER ${quoted(req.scope.areaPath)}` : "";
  return (clause) => `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] IN (${names})${area} AND (${clause}) ASOF ${quoted(req.window.cutoffUtc)}`;
}

const openStates = (types) => [...new Set(types.backlog.flatMap((t) => t.states.filter((s) => ["proposed", "in-progress", "resolved"].includes(s.category)).map((s) => quoted(s.name))))].join(", ");

async function changedIds(api, where, from, to) {
  const got = await wiql(api, where(`[System.ChangedDate] >= ${quoted(from)} AND [System.ChangedDate] < ${quoted(to)}`));
  if (!got.tooMany) return got.ids;
  const middle = new Date((Date.parse(from) + Date.parse(to)) / 2).toISOString();
  return [...(await changedIds(api, where, from, middle)), ...(await changedIds(api, where, middle, to))];
}

async function wiql(api, query) {
  const answer = await call(api, at(api, `/_apis/wit/wiql?timePrecision=true&${API}`), { method: "POST", body: { query } }).catch((e) => tooMany(e));
  if (answer.tooMany) return answer;
  return { ids: (answer.json?.workItems ?? []).map((w) => w.id), truncated: null };
}

// VS402337: more than 20,000 results. The caller splits the range.
function tooMany(e) {
  if (e instanceof HttpStop && /VS402337/.test(e.message + (e.detail ?? ""))) return { tooMany: true, ids: [] };
  throw e;
}

const FIELDS = ["System.Id", "System.Title", "System.WorkItemType", "System.State", "System.CreatedDate", "System.ChangedDate", "System.IterationPath", "System.AreaPath", "System.Parent", "Microsoft.VSTS.Common.StateChangeDate", "Microsoft.VSTS.Common.ActivatedDate", "Microsoft.VSTS.Common.ClosedDate"];

// Each item as of the cut-off, and as of the window's start; its revisions in
// between give every move.
async function itemsOf(api, req, ids, types) {
  const atCutoff = await batched(api, ids, req.window.cutoffUtc);
  const atStart = req.window.fromUtc ? await batched(api, ids, req.window.fromUtc) : [];
  const moves = await revisionsOf(api, req, ids, types);
  const before = new Map(atStart.map((w) => [w.id, w]));
  return atCutoff.map((w) => itemRecord(api, w, before.get(w.id), moves.get(w.id) ?? [], types, req.window));
}

async function batched(api, ids, asOf) {
  const chunks = Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) => ids.slice(i * BATCH, (i + 1) * BATCH));
  const pages = await limited(chunks, 2, (chunk) => call(api, `/_apis/wit/workitemsbatch?${API}`, { method: "POST", body: { ids: chunk, fields: FIELDS, asOf, errorPolicy: "Omit" } }));
  return pages.flatMap((p) => (p.json?.value ?? []).filter(Boolean));
}

// The project's revisions since the window began, kept only for these items
// and only up to the cut-off -- a report about the past holds nothing after it.
async function revisionsOf(api, req, ids, types) {
  const wanted = new Set(ids);
  const start = req.window.fromUtc ?? "2000-01-01T00:00:00Z";
  const revisions = await continued(api, at(api, `/_apis/wit/reporting/workitemrevisions?fields=System.Id,System.State,System.WorkItemType,System.ChangedDate,System.Rev&types=${encodeURIComponent(types.backlog.map((t) => t.name).join(","))}&startDateTime=${encodeURIComponent(start)}&${API}`), (j) => j?.values ?? []);
  return revisions.filter((r) => wanted.has(r.fields?.["System.Id"] ?? r.id) && (r.fields?.["System.ChangedDate"] ?? "") < req.window.cutoffUtc).reduce(grouped, new Map());
}

function grouped(map, r) {
  const id = r.fields?.["System.Id"] ?? r.id;
  return map.set(id, [...(map.get(id) ?? []), r]);
}

function itemRecord(api, w, before, revisions, types, window) {
  const f = w.fields;
  const history = historyOf(f, before?.fields, revisions, types, window);
  return { id: `ado:${api.org}/wi/${w.id}`, key: String(w.id), title: f["System.Title"], url: `${api.base}/${encodeURIComponent(api.project)}/_workitems/edit/${w.id}`, type: f["System.WorkItemType"], kind: types.list.find((t) => t.name === f["System.WorkItemType"])?.kind ?? "other", createdAt: f["System.CreatedDate"], state: f["System.State"], category: types.categoryOf(f["System.WorkItemType"], f["System.State"]), history, pointInTime: true, iteration: f["System.IterationPath"] ?? null, parent: f["System.Parent"] ? `ado:${api.org}/wi/${f["System.Parent"]}` : null, linkedPullRequests: [], fields: { "System.AreaPath": f["System.AreaPath"] ?? null } };
}

// Created (proposed); activated before the window, when the process records
// it; the state it was in when the window began, since the date it entered it;
// then each change of state the revisions show -- oldest first, and a revision
// that did not change the state is not a move.
function historyOf(now, start, revisions, types, window) {
  const created = [{ at: now["System.CreatedDate"], state: null, category: "proposed" }];
  const activated = start?.["Microsoft.VSTS.Common.ActivatedDate"] ? [{ at: start["Microsoft.VSTS.Common.ActivatedDate"], state: null, category: "in-progress" }] : [];
  const opening = start ? [{ at: start["Microsoft.VSTS.Common.StateChangeDate"] ?? window.fromUtc, state: start["System.State"], category: types.categoryOf(start["System.WorkItemType"], start["System.State"]) }] : [];
  const moves = [...revisions].sort((a, b) => (a.fields["System.Rev"] ?? 0) - (b.fields["System.Rev"] ?? 0)).map((r) => ({ at: r.fields["System.ChangedDate"], state: r.fields["System.State"], category: types.categoryOf(r.fields["System.WorkItemType"], r.fields["System.State"]) }));
  return changesOnly([...created, ...activated, ...opening, ...moves].filter((h) => h.at).sort((a, b) => a.at.localeCompare(b.at)));
}

const changesOnly = (rows) => rows.filter((h, i) => i === 0 || h.state === null || h.state !== rows[i - 1].state || h.category !== rows[i - 1].category);

// ---- iterations (the team's) ------------------------------------------------------

async function iterationsOf(api, req, project) {
  const team = req.scope.team || project.defaultTeam?.name;
  if (!team) return { rows: [], state: { status: "missing", reason: "the project names no default team, and the scope names none" } };
  const read = await collectionTry(() => call(api, `/${encodeURIComponent(api.project)}/${encodeURIComponent(team)}/_apis/work/teamsettings/iterations?${API}`), "Work Items (Read)");
  return read.ok ? teamIterations(api, req, team, read.value.json?.value ?? []) : { rows: [], state: failed(read) };
}

function teamIterations(api, req, team, listed) {
  const rows = listed.filter((i) => i.attributes?.startDate && i.attributes?.finishDate).map((i) => iterationRecord(api, i, req.window.tz));
  return { rows, state: { status: "complete", items: rows.length, reason: `iterations of team ${team}` } };
}

// A sprint's dates are calendar days; its instants are the project's local
// midnights, so a sprint is the same days in the report as on the board.
function iterationRecord(api, i, tz) {
  const start = i.attributes.startDate.slice(0, 10);
  const finish = i.attributes.finishDate.slice(0, 10);
  return { id: `ado:${api.org}/iteration/${i.id}`, name: i.name, path: i.path, startDate: start, finishDate: finish, startUtc: new Date(dayStart(start, tz)).toISOString(), endUtc: new Date(dayStart(addDays(finish, 1), tz)).toISOString() };
}

// ---- Repos ---------------------------------------------------------------------------

const CODE = "Code (Read)";

async function reposOf(api, req) {
  if (req.scope.repos === false) return { repositories: [], rows: [], repoState: off("Repos are switched off in this project's scope"), state: off("Repos are switched off in this project's scope") };
  const read = await collectionTry(() => call(api, at(api, `/_apis/git/repositories?${API}`)), CODE);
  if (!read.ok) return { repositories: [], rows: [], repoState: failed(read), state: failed(read) };
  return pullRequestsOf(api, req, chosen(read.value.json?.value ?? [], req.scope.repositories));
}

function chosen(repos, wanted) {
  const names = (wanted ?? []).map((n) => String(n).toLowerCase());
  const picked = names.length ? repos.filter((r) => names.includes(r.name.toLowerCase())) : repos;
  return { picked, missing: names.filter((n) => !repos.some((r) => r.name.toLowerCase() === n)) };
}

async function pullRequestsOf(api, req, { picked, missing }) {
  const read = await limited(picked, 2, (repo) => collectionTry(() => prsOfRepo(api, req, repo), CODE));
  const rows = read.filter((r) => r.ok).flatMap((r) => r.value);
  const bad = read.filter((r) => !r.ok);
  const repoState = missing.length ? { status: "partial", items: picked.length, reason: `not in project ${api.project}: ${missing.join(", ")}` } : { status: "complete", items: picked.length };
  return { repositories: picked.map((r) => ({ id: `ado:${api.org}/${api.project}/repo/${r.name}`, name: `${api.project}/${r.name}`, url: r.webUrl, defaultBranch: String(r.defaultBranch ?? "").replace(/^refs\/heads\//, "") || null })), rows, repoState, state: bad.length ? { status: bad.length === read.length ? "forbidden" : "partial", items: rows.length, reason: bad[0].reason, permission: bad[0].permission } : { status: "complete", items: rows.length } };
}

// Closed since the window began (completed or abandoned, whenever opened), and
// every one still active -- which covers everything open at the cut-off.
async function prsOfRepo(api, req, repo) {
  const path = (criteria) => at(api, `/_apis/git/repositories/${repo.id}/pullrequests?${criteria}&${API}`);
  const closed = await skipped(api, path(`searchCriteria.status=all&searchCriteria.queryTimeRangeType=closed&searchCriteria.minTime=${encodeURIComponent(req.window.fromUtc ?? "2000-01-01T00:00:00Z")}`));
  const active = await skipped(api, path("searchCriteria.status=active"));
  const all = [...new Map([...closed, ...active].map((p) => [p.pullRequestId, p])).values()];
  return limited(all, 4, (pr) => detailed(api, repo, pr));
}

async function detailed(api, repo, pr) {
  const base = at(api, `/_apis/git/repositories/${repo.id}/pullRequests/${pr.pullRequestId}`);
  const threads = (await call(api, `${base}/threads?${API}`)).json?.value ?? [];
  const commits = await continued(api, `${base}/commits?$top=100&${API}`, (j) => j?.value ?? []);
  const items = (await call(api, `${base}/workitems?${API}`)).json?.value ?? [];
  return pullRequestRecord(api, repo, pr, { threads, commits, items });
}

const STATE = { completed: "merged", abandoned: "closed", active: "open" };
const VOTE = { 10: "APPROVED", 5: "APPROVED", "-5": "CHANGES_REQUESTED", "-10": "CHANGES_REQUESTED" };
const RESOLVED = new Set(["fixed", "closed", "byDesign", "wontFix"]);

const person = (identity) => ({ login: identity?.uniqueName ?? identity?.id ?? null, name: identity?.displayName ?? null, bot: /build service|\[bot\]|project collection/i.test(identity?.displayName ?? "") });

function pullRequestRecord(api, repo, pr, { threads, commits, items }) {
  const text = threads.filter((t) => !t.isDeleted && (t.comments ?? []).some((c) => c.commentType === "text"));
  const votes = threads.filter((t) => t.properties?.CodeReviewThreadType?.$value === "VoteUpdate");
  return { id: `ado:${api.org}/${api.project}/pr/${pr.pullRequestId}`, repo: `${api.project}/${repo.name}`, number: pr.pullRequestId, url: `${repo.webUrl}/pullrequest/${pr.pullRequestId}`, title: pr.title, author: person(pr.createdBy), mergedBy: pr.status === "completed" && pr.closedBy ? { login: person(pr.closedBy).login } : null, state: STATE[pr.status] ?? "open", draft: Boolean(pr.isDraft), createdAt: pr.creationDate, updatedAt: pr.closedDate ?? pr.creationDate, mergedAt: pr.status === "completed" ? pr.closedDate : null, closedAt: pr.closedDate ?? null, baseRef: String(pr.targetRefName ?? "").replace(/^refs\/heads\//, ""), headRef: String(pr.sourceRefName ?? "").replace(/^refs\/heads\//, ""), additions: null, deletions: null, changedFiles: null, labels: (pr.labels ?? []).map((l) => l.name), linkedWorkItems: items.map((i) => `ado:${api.org}/wi/${i.id}`), ...conversation(text, votes), commits: commits.map(commitRecord), files: [], events: [], truncated: [] };
}

// Reviews are votes, dated by the thread that recorded them; threads are the
// text ones; the latest status of a thread is all Azure DevOps keeps of it.
function conversation(text, votes) {
  return { reviews: votes.map((t) => ({ author: person(t.identities?.[t.properties?.CodeReviewVotedByIdentity?.$value] ?? t.comments?.[0]?.author), state: VOTE[t.properties?.CodeReviewVoteResult?.$value] ?? "COMMENTED", submittedAt: t.publishedDate })), threads: text.map((t) => ({ resolved: RESOLVED.has(t.status), outdated: false, startedAt: t.publishedDate, author: person(t.comments?.[0]?.author), comments: t.comments.filter((c) => c.commentType === "text").length })), comments: [], reviewComments: text.flatMap((t) => t.comments.filter((c) => c.commentType === "text").map((c) => ({ author: person(c.author), createdAt: c.publishedDate }))) };
}

const commitRecord = (c) => ({ oid: c.commitId, authoredAt: c.author?.date ?? null, committedAt: c.committer?.date ?? c.author?.date ?? null, author: { login: null, name: c.author?.name ?? null, email: c.author?.email ?? null }, committer: { login: null, name: c.committer?.name ?? null, email: c.committer?.email ?? null }, message: c.comment ?? "" });

// ---- Pipelines ------------------------------------------------------------------------

const BUILD = "Build (Read)";
const RESULT = { succeeded: "success", partiallySucceeded: "success", failed: "failure", canceled: "canceled" };

async function buildsOf(api, req) {
  if (req.scope.pipelines === false) return { rows: [], state: off("Pipelines are switched off in this project's scope") };
  const path = at(api, `/_apis/build/builds?minTime=${encodeURIComponent(req.window.fromUtc ?? "2000-01-01T00:00:00Z")}&maxTime=${encodeURIComponent(req.window.cutoffUtc)}&queryOrder=finishTimeDescending&$top=1000&${API}`);
  const read = await collectionTry(() => continued(api, path, (j) => j?.value ?? []), BUILD);
  return read.ok ? { rows: read.value.map((b) => buildRecord(api, b)), state: { status: "complete", items: read.value.length } } : { rows: [], state: failed(read) };
}

const buildRecord = (api, b) => ({ id: `ado:${api.org}/${api.project}/build/${b.id}`, pipeline: b.definition?.name ?? "pipeline", result: RESULT[b.result] ?? (b.status === "completed" ? "unknown" : "running"), status: b.status, queuedAt: b.queueTime ?? null, startedAt: b.startTime ?? null, finishedAt: b.finishTime ?? null, branch: String(b.sourceBranch ?? "").replace(/^refs\/heads\//, ""), url: b._links?.web?.href ?? null });

// Deployments come from classic RELEASES, which Release (Read) -- a read-only
// scope -- may list. A YAML pipeline's environment deployments are NOT read:
// Azure DevOps offers them only with Environment (read and manage), a scope
// that can also change environments, and a report never asks for that.
const RELEASE = "Release (Read)";
const YAML_NOTE = "YAML environment deployments are not read: Azure DevOps offers them only with the Environment (read and manage) scope, and a report asks for read access only";
const DEPLOYED = { succeeded: "success", partiallySucceeded: "success", failed: "failure", notDeployed: "canceled", inProgress: "running" };

// The release service answers on its own host for Services (vsrm.dev.azure.com);
// a Server collection serves it under the collection itself.
export const releaseBaseOf = (connection) => (/^https:\/\/dev\.azure\.com$/i.test(connection.host.replace(/\/+$/, "")) ? `https://vsrm.dev.azure.com/${connection.organization}` : baseOf(connection));

async function deploymentsOf(api, req) {
  if (req.scope.pipelines === false) return { rows: [], state: off("Pipelines are switched off in this project's scope") };
  const path = at(api, `/_apis/release/deployments?minStartedTime=${encodeURIComponent(req.window.fromUtc ?? "2000-01-01T00:00:00Z")}&maxStartedTime=${encodeURIComponent(req.window.cutoffUtc)}&$top=100&${API}`);
  const read = await collectionTry(() => continued(releaseApi(api, req), path, (j) => j?.value ?? []), RELEASE);
  if (!read.ok) return { rows: [], state: { ...failed(read), reason: `${read.reason}; ${YAML_NOTE}` } };
  return { rows: read.value.map((d) => deploymentRecord(api, d)), state: { status: "complete", items: read.value.length, reason: YAML_NOTE } };
}

// The same credential, the same rules, for the release service's own host --
// derived from the connection, never taken from an answer.
const releaseApi = (api, req) => ({ ...api, base: releaseBaseOf(req.connection), http: createHttp({ fetch: req.fetch, origin: releaseBaseOf(req.connection), headers: api.headers, sleep: api.sleep, nowMs: req.nowMs, limits: api.limits }) });

const deploymentRecord = (api, d) => ({ id: `ado:${api.org}/${api.project}/deploy/${d.id}`, environment: d.releaseEnvironment?.name ?? "environment", status: DEPLOYED[d.deploymentStatus] ?? "unknown", createdAt: d.startedOn ?? d.queuedOn ?? null, finishedAt: d.completedOn ?? null, ref: d.release?.name ?? null });

// ---- stops ------------------------------------------------------------------------------

const RUN_STOPS = { auth: (e) => new Blocked(`Azure DevOps refused the connection's credential: ${e.message}`), rate: (e) => new Blocked(e.message), server: (e) => new Blocked(`Azure DevOps is not answering: ${e.message}`), network: (e) => new Blocked(e.message), redirect: (e) => new Blocked(e.message), invalid: (e) => new Blocked(`Azure DevOps' answer could not be used: ${e.message}`) };

async function guarded(fn) {
  try { return await fn(); }
  catch (e) { throw e instanceof HttpStop ? (RUN_STOPS[e.kind] ?? RUN_STOPS.invalid)(e) : e; }
}

// ---- probe ----------------------------------------------------------------------------------

async function probe(req, deps) {
  const api = apiOf({ ...req, scope: req.scope ?? {} }, deps);
  const me = await checked(() => call(api, `/_apis/connectionData?api-version=7.1-preview`));
  if (!me.ok) return { ok: false, identity: null, checks: [{ id: "authentication", status: me.status, message: me.message }] };
  const checks = [{ id: "authentication", status: "ok", message: whoOf(me) ? `signed in as ${whoOf(me)}` : "the credential was accepted" }, ...(await scopeChecks(api, req.scope ?? {}))];
  return { ok: checks.every((c) => ["ok", "not-configured"].includes(c.status)), identity: whoOf(me), checks };
}

const whoOf = (me) => me.value.json?.authenticatedUser?.providerDisplayName ?? null;

async function checked(fn, permission = null) {
  try { return { ok: true, value: await fn() }; }
  catch (e) { return probeFailure(e, statusOf(e, permission), permission); }
}

// A permission is named only when the source refused the CREDENTIAL. A request
// it refused for its own shape (a 400) or could not find says nothing about
// what the token may read, and naming one sends a person to fix the wrong thing.
const probeFailure = (e, status, permission) => ({ ok: false, status, message: e.message, permission: REFUSED.has(status) ? e.permission ?? permission : null });

const REFUSED = new Set(["forbidden", "unauthorized"]);

// A 401 after authentication succeeded is a scope the token does not carry.
const statusOf = (e, permission) => (e instanceof HttpStop ? ({ auth: permission ? "forbidden" : "unauthorized", forbidden: "forbidden", "not-found": "not-found" })[e.kind] ?? "error" : "error");

const PROBES = [
  { id: "project", setting: null, permission: "Project and Team (Read)", ask: (api) => call(api, `/_apis/projects/${encodeURIComponent(api.project)}?${API}`) },
  { id: "boards", setting: "boards", permission: BOARDS, ask: (api) => call(api, at(api, `/_apis/wit/wiql?$top=1&${API}`), { method: "POST", body: { query: "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project" } }) },
  { id: "repos", setting: "repos", permission: CODE, ask: (api) => call(api, at(api, `/_apis/git/repositories?${API}`)) },
  { id: "pipelines", setting: "pipelines", permission: BUILD, ask: (api) => call(api, at(api, `/_apis/build/builds?$top=1&${API}`)) },
];

async function scopeChecks(api, scope) {
  if (!scope.project) return [{ id: "scope", status: "not-configured", message: "no project is set for this report yet; set the scope, then test again" }];
  return limited(PROBES, 2, (p) => oneProbe(api, scope, p));
}

async function oneProbe(api, scope, p) {
  if (p.setting && scope[p.setting] === false) return { id: p.id, status: "not-configured", message: "switched off in this project's scope" };
  const got = await checked(() => p.ask(api), p.permission);
  return got.ok ? { id: p.id, status: "ok" } : { id: p.id, status: got.status, permission: got.permission, message: got.message };
}
