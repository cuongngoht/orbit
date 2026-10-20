// ONE SCREEN, every case that touched it, on ONE page.
//
// The engine had four artefacts and none of them answered the question a tester
// actually asks out loud:
//
//   report.html    one run
//   review.html    one SESSION -- a machine on a day, whatever it happened to drive
//   explore.html   one exploration
//   coverage.html  one PLAN -- which needs a plan to exist first
//
// "How far has THIS SCREEN been checked?" needs no plan and no session. The
// screen is in the map already, and the ledger now records which screens each
// run touched (`screens`, src/run/result.mjs), so selecting the runs is one
// filter over the ledger -- not a re-parse of every case, and not a walk over
// every evidence directory, either of which makes the answer depend on files
// that may have moved since.
//
// It RE-JUDGES NOTHING. Every verdict here is the one its run earned, read back
// through the same `model()` the per-run report uses. That is also what makes
// the masking, the allow-list and the base64 embedding identical on this page:
// a second way to render a run would be a second story about it.
//
// Evidence is pruned (src/memory/store.mjs `keep`), so a case whose directory
// is gone still appears -- with its verdict from the ledger and a sentence
// saying where the pictures went. Dropping it would make a screen look less
// tested the longer you keep testing it.
import { publish } from "./publish-page.mjs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync } from "node:fs";
import { LAYERS } from "../dsl/verbs.mjs";
import { gallery } from "./gallery.mjs";
import { model, sqlCommandLine } from "./model.mjs";
import { UNJUDGED, WITNESSES } from "./review.mjs";
import { render } from "./template.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, name), "utf8");

export function screenModel(screen, runs, load, opts = {}) {
  const picked = latestPerCase(runs.filter((r) => (r.screens ?? []).includes(screen)));
  const cases = picked.map((r) => oneCase(r, load, runs));
  return { screen, cases, ...headerOf(screen, picked, opts), ...tally(cases), ...sections(cases) };
}

// The three aggregate tables, each with the flag that decides whether its
// heading appears at all. A section with a heading and no rows is a page
// telling somebody it has nothing to say, twice.
function sections(cases) {
  const identities = identityRows(cases);
  const queries = queryRows(cases);
  const checks = checkRows(cases);
  return { identities, queries, checks, anyIdentities: identities.length > 0, anyQueries: queries.length > 0, anyChecks: checks.length > 0 };
}

// The LATEST run per case, because "how far has this screen been checked" is
// about where it stands now. Every earlier run is still in each case's own
// history band; keeping them all here would rank a case by how often somebody
// re-ran it.
function latestPerCase(runs) {
  const byCase = new Map();
  for (const r of runs) byCase.set(r.case, newer(byCase.get(r.case), r));
  return [...byCase.values()].sort((a, b) => String(a.case).localeCompare(String(b.case)));
}

const newer = (had, r) => (!had || String(r.at ?? "") >= String(had.at ?? "") ? r : had);

// A run's own page, minus the page. `load` returns the log records or null --
// null is the pruned case, and it is not an error.
function oneCase(r, load, runs) {
  const records = load(r.evidence);
  if (!records) return pruned(r);
  return rendered(r, model(records, runs));
}

const pruned = (r) => ({ case: r.case, name: r.case, status: r.status, tone: TONE[r.status] ?? "warn", proved: provedRow(r.proved), gone: "its evidence has been pruned — the verdict is from the ledger, and every picture is inside that run's own report", shots: [], source: null, why: whyOf(r), identities: r.identity ?? [], resolvedRows: [], sqlRows: [], steps: `${r.done ?? 0}/${r.of ?? 0}`, secs: seconds(r.ms), when: stamp(r.at), host: r.host ?? "?", slowest: slowestSay(r) });

function rendered(r, m) {
  const shots = gallery(m.steps);
  const status = m.result.status ?? r.status;
  return { ...pruned(r), ...found(m, shots, status), gone: null };
}

const found = (m, shots, status) => ({ name: m.run.source?.name || m.run.case, status, tone: TONE[status] ?? "warn", proved: provedRow(m.proved), shots, source: sourceOf(m), identities: m.identities ?? [], resolvedRows: resolvedIn(m), sqlRows: sqlIn(m), steps: `${m.result.done ?? 0}/${m.result.of ?? 0}` });

// A resolve row asks the database BEFORE the browser, to find which row the
// case is about; a sql step asks it as a VERDICT. Both are questions somebody
// re-runs by hand, so both belong in the ground-truth table, labelled.
const resolvedIn = (m) => m.resolved.filter((r) => r.sql).map((r) => ({ query: r.sql, rerun: sqlCommandLine(m.run, r.sql), asked: `resolve ${r.as}`, case: m.run.case }));

const sqlIn = (m) => m.steps.filter((s) => s.query).map((s) => ({ query: s.query, rerun: sqlCommandLine(m.run, s.query), asked: `step ${s.i}`, case: m.run.case }));

const sourceOf = (m) => (m.run.source ? JSON.stringify(m.run.source, null, 2) : null);

const whyOf = (r) => (r.failedStep ? `failed at step ${r.failedStep.i} ${r.failedStep.do} ${r.failedStep.on ?? ""}`.trim() : "");

// Recorded so a case can be warned about BEFORE it flips: a run near its
// deadline is one slow commit away from a timeout that reads as a defect.
const slowestSay = (r) => (r.slowest ? `slowest step ${r.slowest.i} ${r.slowest.do} — ${seconds(r.slowest.ms)}${nearWall(r)}` : "");

const NEAR = 70;
const nearWall = (r) => (r.budget?.usedPct >= NEAR ? `  ·  ${r.budget.usedPct}% of the run budget spent — this case is close to timing out` : "");

const TONE = { PASS: "ok", FAIL: "danger", SKIP: "flat", PARTIAL: "flat", BLOCKED: "warn", REFUSED: "warn", INCONCLUSIVE: "warn" };

const provedRow = (proved) => LAYERS.map((id) => ({ id, n: proved?.[id] ?? 0 })).filter((p) => p.n > 0);

// What the whole screen adds up to. Only PASS verifies -- the same single row
// in RUN_STATES the plan side reads, and the reason a table of grey cannot be
// summed as "checked".
function tally(cases) {
  const verified = cases.filter((c) => c.status === "PASS").length;
  const per = LAYERS.map((id) => ({ id, n: sum(cases, id) })).filter((p) => p.n > 0);
  return { total: cases.length, verified, per, verdict: verdictOf(cases, verified), verdictClass: verified === cases.length && cases.length ? "ok" : "warn" };
}

const sum = (cases, id) => cases.reduce((n, c) => n + (c.proved.find((p) => p.id === id)?.n ?? 0), 0);

const verdictOf = (cases, verified) => (!cases.length ? "no run has touched this screen yet" : `${verified}/${cases.length} case(s) verified${cases.length === verified ? "" : " — the rest is listed below, with why"}`);

// WHO drove this screen, and with which rights. A scoping question is answered
// by this table or it is not answered: "the admin could" says nothing about
// what somebody without the role could.
function identityRows(cases) {
  const seen = new Map();
  for (const c of cases) for (const i of c.identities ?? []) seen.set(`${i.as}|${(i.roles ?? []).join(",")}`, { as: i.as, roles: (i.roles ?? []).join(", ") || "—", cases: [] });
  for (const c of cases) for (const i of c.identities ?? []) seen.get(`${i.as}|${(i.roles ?? []).join(",")}`).cases.push(c.case);
  return [...seen.values()].map((r) => ({ ...r, cases: [...new Set(r.cases)].join(", ") }));
}

// Every question asked of the data underneath, with the line that repeats it.
// The SQL is verbatim on purpose (src/report/model.mjs VERBATIM) -- a masked
// query is one nobody can re-run, and re-running it by hand is the point.
function queryRows(cases) {
  const rows = cases.flatMap((c) => queriesIn(c));
  const seen = new Map();
  for (const q of rows) seen.set(q.query, seen.get(q.query) ?? q);
  return [...seen.values()];
}

const queriesIn = (c) => [...(c.resolvedRows ?? []), ...(c.sqlRows ?? [])];

// Every reason a person still has to look, as rows over what the runs reported.
// Nothing here may invent a reason a run did not give.
function checkRows(cases) {
  return cases.flatMap((c) => reasons(c).map((say) => ({ case: c.case, say })));
}

function reasons(c) {
  const out = [];
  if (UNJUDGED[c.status]) out.push(`${c.status}: ${UNJUDGED[c.status]}`);
  if (c.status === "PASS" && !witnessed(c)) out.push(`it passed on the screen alone — a screen can show a write that never happened, so check the ${WITNESSES.join("/")} side yourself`);
  if (c.status === "FAIL") out.push(`${c.why || "it failed"} — reproduce it by hand before calling it a product bug`);
  return out;
}

const witnessed = (c) => WITNESSES.some((l) => c.proved.some((p) => p.id === l));

function headerOf(screen, picked, opts) {
  const last = picked.at(-1) ?? {};
  return { target: opts.origin ?? last.origin ?? "", env: opts.env ?? last.env ?? "", commit: last.fe_commit ?? "", generated: opts.generated ?? "", project: opts.project ?? "", title: `${screen} — every case that has touched it` };
}

const seconds = (ms) => (ms ? `${Math.round(ms / 1000)}s` : "");
const stamp = (at) => String(at ?? "").replace("T", " ").slice(0, 16);

export const screenHtml = (screen, runs, load, opts = {}) => render(read("screen.html"), { ...screenModel(screen, runs, load, opts), style: read("report.css") });

export function writeScreen(file, screen, runs, load, opts = {}) {
  mkdirSync(dirname(file), { recursive: true });
  publish(file, screenHtml(screen, runs, load, opts));
  return file;
}
