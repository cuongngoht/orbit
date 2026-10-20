// The standard Python kit, run for real through its shim and guard over the
// representative snapshots: what it counts, what it refuses to count, and what
// it will not do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envelopeFor } from "../src/project-report/envelope.mjs";
import { calendarBetween, periodOf } from "../src/project-report/window.mjs";
import { KIT } from "./project-report/python.mjs";
import { pythonOr } from "./project-report/python.mjs";
import { adoSnapshot, githubSnapshot, NOW, pipelinesOnlySnapshot, TZ } from "./project-report/snapshots.mjs";
import { ran, standard, workspace, written } from "./project-report/kit.mjs";

const byNumber = (model, n) => model.prTable.find((r) => r.number === n);

test("GitHub: a PR opened in June and merged in July counts; one merged at 23:30 local on 30 June does not", async (t) => {
  const python = pythonOr(t);
  if (!python) return;
  const { model, metrics } = await standard(t, python, githubSnapshot());
  assert.equal(metrics.ok, true, metrics.error);
  assert.equal(byNumber(model, 90).merged, "2026-07-03");
  assert.equal(byNumber(model, 91), undefined, "merged before the window, so not in it at all");
  const july = model.months.find((m) => m.label === "2026-07");
  assert.ok(july.prsMerged >= 1);
});

test("GitHub: at the cut-off a PR merged later is OPEN, a reopened one is open, an abandoned one is closed", async (t) => {
  const python = pythonOr(t);
  if (!python) return;
  const { model } = await standard(t, python, githubSnapshot());
  const open = new Set(model.backlog.openPrs.map((p) => p.number));
  assert.ok(open.has(92), "merged on 5 September, after the 31 August cut-off");
  assert.ok(open.has(93), "closed then reopened before the cut-off");
  assert.ok(open.has(95), "open since May: backlog even though it was opened before the window");
  assert.equal(byNumber(model, 96).state, "closed");
});

test("GitHub: review after the merge is counted apart, never as review before merge; bots never count as human review", async (t) => {
  const python = pythonOr(t);
  if (!python) return;
  const { model } = await standard(t, python, githubSnapshot());
  assert.ok(model.review.postMergeReviews > 0);
  const regular = model.prTable.filter((r) => r.number >= 100 && r.state === "merged");
  assert.ok(regular.every((r) => r.humanReviews <= 1), "the post-merge review did not add to review before merge");
  assert.ok(regular.every((r) => r.botReviews === 1));
});

test("GitHub: an unclassifiable PR is `unclassified`, never a feature, and the KPIs are declared metrics", async (t) => {
  const python = pythonOr(t);
  if (!python) return;
  const { model, metrics } = await standard(t, python, githubSnapshot());
  assert.equal(byNumber(model, 93).workType, "unclassified");
  assert.ok(model.flow.unclassifiedPct > 0);
  const merged = metrics.outputs.metrics.find((m) => m.id === "orbit.report.kpi.prs-merged");
  assert.deepEqual([merged.unit, merged.version, typeof merged.definition], ["count", "1", "string"]);
});

// Everything after the cut-off removed by hand: the report must not change.
function withoutTheFuture(snapshot, cutoff) {
  const before = (x) => x && Date.parse(x) < Date.parse(cutoff);
  const pr = (p) => ({ ...p, mergedAt: before(p.mergedAt) ? p.mergedAt : null, closedAt: before(p.closedAt) ? p.closedAt : null, state: before(p.mergedAt) ? "merged" : before(p.closedAt) ? p.state : "open",
    reviews: p.reviews.filter((r) => before(r.submittedAt)), commits: p.commits.filter((c) => before(c.committedAt)), events: p.events.filter((e) => before(e.at)), reviewComments: p.reviewComments.filter((c) => before(c.createdAt)), threads: p.threads.filter((x) => before(x.startedAt)) });
  const wi = (w) => ({ ...w, history: w.history.filter((h) => before(h.at)) });
  const c = snapshot.collections;
  return { ...snapshot, collections: { ...c, pullRequests: c.pullRequests.filter((p) => before(p.createdAt)).map(pr), workItems: c.workItems.filter((w) => before(w.createdAt)).map(wi), builds: c.builds.filter((b) => before(b.finishedAt)), deployments: c.deployments.filter((d) => before(d.finishedAt)) } };
}

function pastSnapshot() {
  const s = githubSnapshot();
  const window = periodOf({ asOf: "2026-08-15" }, { now: NOW, tz: TZ });
  return { ...s, window, calendar: calendarBetween(window.from, window.to, TZ) };
}

test("a PAST report knows nothing the future added: the same numbers with every later event removed by hand", async (t) => {
  const python = pythonOr(t);
  if (!python) return;
  const past = pastSnapshot();
  const [a, b] = [await standard(t, python, past), await standard(t, python, withoutTheFuture(past, past.window.cutoffUtc))];
  const numbers = (m) => JSON.stringify({ kpis: m.kpis, periods: m.periods, backlog: m.backlog.openPrs.map((p) => [p.number, p.ageDays]), flow: m.flow, review: m.review });
  assert.equal(numbers(a.model), numbers(b.model));
  assert.equal(a.model.kpis.openPrsAtCutoff, b.model.kpis.openPrsAtCutoff);
});

test("Azure DevOps: source iterations are the periods; categories, not state names, decide done -- a custom state is in progress, an uncategorised one is listed", async (t) => {
  const python = pythonOr(t);
  if (!python) return;
  const { model } = await standard(t, python, adoSnapshot());
  assert.equal(model.grain, "iteration");
  assert.deepEqual(model.periods.map((p) => p.label), ["Sprint 12", "Sprint 13", "Sprint 14", "Sprint 15", "Sprint 16"]);
  assert.deepEqual([model.periods[0].partial, model.periods[1].partial], [true, false]);
  const w = model.backlog.workItems;
  assert.ok(w.unmapped.some((u) => u.state === "Legacy Hold"), "a state with no category is listed, never guessed");
  assert.ok(w.canceled >= 1, "Removed is canceled");
  assert.ok(w.reopened >= 1, "Closed -> Active is a reopen");
  assert.ok(model.itemTable.some((i) => i.state === "Waiting on Vendor" && i.category === "in-progress"));
});

test("Azure DevOps: one work item linked to several PRs is ONE completed item", async (t) => {
  const python = pythonOr(t);
  if (!python) return;
  const { model } = await standard(t, python, adoSnapshot());
  const keys = model.itemTable.filter((i) => i.done).map((i) => i.key);
  assert.equal(keys.length, new Set(keys).size);
  assert.equal(model.kpis.itemsCompleted, model.periods.reduce((n, p) => n + p.itemsCompleted, 0) - model.periods.filter((p) => false).length);
});

test("pipelines only: the pull-request sections say not configured, and no PR number is a zero", async (t) => {
  const python = pythonOr(t);
  if (!python) return;
  const { model } = await standard(t, python, pipelinesOnlySnapshot());
  assert.equal(model.sections.pullRequests.status, "not-configured");
  assert.equal(model.kpis.medianCycleTimeH, null);
  assert.equal(model.kpis.itemsCompleted, null, "no work items read is not 'none completed'");
  assert.equal(model.pipelines.builds, 30);
});

test("the forecast refuses to invent: no source, too few periods, only zeros -- and says which", async (t) => {
  const python = pythonOr(t);
  if (!python) return;
  const none = await standard(t, python, pipelinesOnlySnapshot());
  assert.deepEqual([none.forecast.outputs.forecast.status, /no backlog source/.test(none.forecast.outputs.forecast.reason)], ["none", true]);
  const s = githubSnapshot();
  const idle = { ...s, collections: { ...s.collections, workItems: s.collections.workItems.map((w) => ({ ...w, history: w.history.filter((h) => h.category !== "completed") })) } };
  const zeros = await standard(t, python, idle);
  assert.equal(zeros.forecast.outputs.forecast.status, "none");
  assert.match(zeros.forecast.outputs.forecast.reason, /nothing was completed/);
  const short = await standard(t, python, s, { assumptions: { forecast: { minSamples: 20 } } });
  assert.match(short.forecast.outputs.forecast.reason, /a forecast needs at least 20/);
});

test("the forecast dates from the cut-off, records its seed and model, and marks runs beyond the horizon", async (t) => {
  const python = pythonOr(t);
  if (!python) return;
  const ok = (await standard(t, python, githubSnapshot())).forecast.outputs.forecast;
  assert.deepEqual([ok.status, ok.model, ok.seed], ["ok", "orbit.forecast.mc/1", 42]);
  assert.ok(ok.p50.endsOn > "2026-08-31");
  const far = (await standard(t, python, githubSnapshot(), { assumptions: { forecast: { horizon: 1 } } })).forecast.outputs.forecast;
  assert.equal(far.p95.beyondHorizon, true);
  assert.equal(far.p95.endsOn, null, "beyond the horizon is not a date");
});

async function extensionRan(t, python, body) {
  const base = workspace(t);
  const snapshot = githubSnapshot();
  const file = written(base, snapshot);
  mkdirSync(join(base, "ext"), { recursive: true });
  writeFileSync(join(base, "ext", "part.py"), body);
  const part = { id: "demo.probe", version: "0.1.0", kind: "metric", contract: "orbit.report.part/v1", runtime: "python", entry: "./part.py", doc: "a test part", metrics: [{ id: "demo.one", version: "1", label: "One", unit: "count", definition: "one" }] };
  return ran({ python, base, snapshot, part, entry: join(base, "ext", "part.py"), inputs: { snapshot: file } });
}

test("the guard stops a compute part that opens a socket, starts a process or writes outside its directory", async (t) => {
  const python = pythonOr(t);
  if (!python) return;
  const cases = [["import socket\ndef run(e, sdk):\n    socket.create_connection(('127.0.0.1', 9))\n", /socket/], ["import subprocess\ndef run(e, sdk):\n    subprocess.run(['echo', 'x'])\n", /subprocess/], ["def run(e, sdk):\n    open('/tmp/orbit-escaped.txt', 'w').write('x')\n", /write only inside its output directory/]];
  for (const [body, why] of cases) {
    const r = await extensionRan(t, python, body);
    assert.equal(r.kind, "extension", body);
    assert.match(`${r.error} ${r.log}`, why);
  }
});

test("a part's print() is a log line, never its result; a data gap is exit 2; garbage is the part's failure", async (t) => {
  const python = pythonOr(t);
  if (!python) return;
  const chatty = await extensionRan(t, python, "def run(e, sdk):\n    print('hello from the part')\n    sdk.metric('demo.one', value=1)\n");
  assert.deepEqual([chatty.ok, chatty.outputs.metrics[0].value], [true, 1]);
  assert.match(chatty.log, /hello from the part/);
  const gap = await extensionRan(t, python, "from orbit_report.sdk import DataMissing\ndef run(e, sdk):\n    raise DataMissing(['blockedTime'], 'this source records no blocked time')\n");
  assert.deepEqual([gap.kind, gap.missing], ["data", ["blockedTime"]]);
  const undeclared = await extensionRan(t, python, "def run(e, sdk):\n    sdk.metric('demo.other', value=1)\n");
  assert.equal(undeclared.kind, "extension", "a metric it did not declare is the part's error");
});

test("no envelope can carry a credential", () => {
  assert.throws(() => envelopeFor({ part: { id: "x.y", kind: "metric", version: "1.0.0" }, entry: "/x.py", runId: "r", window: {}, calendar: {}, seed: 1, outputDir: "/o", settings: { mapping: {}, githubToken: "abc" } }), /may not carry settings.githubToken/);
});

test("the kit is standard library only, and nothing that computes imports a network or a process module", (t) => {
  const python = pythonOr(t);
  if (!python) return;
  const script = ["import ast, os, sys", "kit = sys.argv[1]", "bad = []", "for root, _, files in os.walk(kit):", "  for f in files:", "    if not f.endswith('.py'): continue", "    p = os.path.join(root, f); tree = ast.parse(open(p, encoding='utf-8').read())",
    "    names = {n.split('.')[0] for node in ast.walk(tree) if isinstance(node, ast.Import) or (isinstance(node, ast.ImportFrom) and node.level == 0) for n in ([a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ''])}",
    "    bad += [f'{f}: {n}' for n in names if n and n not in sys.stdlib_module_names and n != 'orbit_report']", "    bad += [f'{f}: {n}' for n in names & {'socket','subprocess','urllib','http','ssl','ctypes','ftplib','smtplib'}]",
    "    bad += [f'{f}: reads the clock' for node in ast.walk(tree) if isinstance(node, ast.Attribute) and node.attr in ('now','today','utcnow') ]", "print('\\n'.join(bad))"].join("\n");
  const r = spawnSync(python, ["-I", "-S", "-c", script, KIT], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "", r.stdout);
});
