// What the template needs, as plain data: no HTML in this file, and no decision
// in the template. That is the whole split -- markup changes in report.html,
// meaning changes here, and neither edit can break the other.
import { LAYERS } from "../dsl/verbs.mjs";
import { label } from "../run/printer.mjs";
import { scrubbed } from "../scrub.mjs";
import { sqlCommandLine } from "./model.mjs";
import { gallery, shotLink } from "./gallery.mjs";
import { journey } from "./journey.mjs";
import { complete, EXPORT_VERSION } from "./export.mjs";

const LOGNAME = "run-log.jsonl";

const LAYER = {
  ui: { title: "UI", sub: "what the screen showed" },
  api: { title: "API", sub: "the call the screen made" },
  sql: { title: "SQL", sub: "the data underneath" },
};

const BADGE = { PASS: "pass", FAIL: "fail", SKIP: "flat", PARTIAL: "flat" };
const TONE = { PASS: "ok", FAIL: "danger" };

export function view(m, style) {
  const shots = gallery(m.steps);
  return {
    style, log: LOGNAME,
    ...heroOf(m), ...factsOf(m), ...calloutOf(m),
    resolve: resolveOf(m), tc: caseOf(m, shots), failed: failedOf(m, shots), stepRows: m.steps.map(stepRow),
    shots, anyShots: shots.length > 0, source: sourceOf(m), journey: journey(m, shots),
    title: scrubbed(m.run.source?.name) || m.run.case, exportVersion: EXPORT_VERSION, exportComplete: String(Boolean(complete(m, shots))),
    observations: m.steps.map((s) => ({ i: s.i, json: detailOf(s) })), captured: m.captured.map((c) => ({ json: JSON.stringify(c, null, 2) })),
    history: m.history.map(bandRow), anyHistory: m.history.length > 1,
  };
}

// One run cannot say whether a case is steady; five can say it at a glance, in
// the same vocabulary the rest of the page already uses.
const bandRow = (r) => ({ when: bandStamp(r.at), status: r.status, tone: BADGE[r.status] ?? "flat", host: r.host ?? "?", secs: seconds(r.ms) });

const bandStamp = (at) => String(at ?? "").replace("T", " ").slice(0, 16);

// `steps` here is the COUNT in the header, and the step table's rows are
// `stepRows`. They were both called `steps`: the spread in view() put the hero
// first, so the array silently won and the first line of every report read
// "[object Object],[object Object] steps". Two names, because one name that
// means two things is resolved by declaration order, which nobody reads.
function heroOf(m) {
  const r = m.result;
  return {
    case: m.run.case, status: r.status ?? "?",
    steps: `${r.done ?? 0}/${r.of ?? 0}`, secs: seconds(r.ms), stamp: stamp(m),
    proved: Object.entries(m.proved).map(([id, n]) => ({ id, n })),
  };
}

// The conclusion first, in a sentence -- a reader who opens the file and reads
// one line has to come away with the right answer, and "PASS" alone is not it.
function calloutOf(m) {
  const status = m.result.status ?? "?";
  const words = Object.entries(m.proved).map(([id, n]) => `${id} ${n}`).join(" · ");
  return { calloutClass: TONE[status] ?? "warn", calloutText: `${status} — ${said(m, status, words)}` };
}

const said = (m, status, words) => (m.failed ? `step ${m.failed.i} did not hold: ${m.failed.error ?? m.failed.blocked ?? m.failed.refused}` : `proved ${words || "nothing"}`);

function factsOf(m) {
  return {
    params: Object.entries(m.run.params ?? {}).map(([k, v]) => ({ k, v })),
    identities: m.identities.map((i) => ({ as: i.as, upn: i.upn ?? "", roles: (i.roles ?? []).join(", "), atStep: i.atStep ?? "start" })),
    origin: m.run.origin, env: m.run.env, commit: m.run.fe_commit, slice: sliceWords(m.result.slice),
  };
}

const sliceWords = (s) => (s?.whole === false ? `steps ${s.from}..${s.to} only` : "the whole case");

// One case, and inside it one block per layer. Per CASE rather than per layer,
// because that is the order a reader asks in: this case -- what did the screen,
// the call and the row each say?
function caseOf(m, shots) {
  const status = m.result.status ?? "?";
  return {
    id: m.run.case, badgeClass: BADGE[status] ?? "warn", badgeText: status,
    verdictClass: TONE[status] === "danger" ? "fail" : TONE[status] === "ok" ? "pass" : "warn",
    verdictText: calloutOf(m).calloutText, layers: LAYERS.map((id) => layerOf(m, id, shots)),
  };
}

function layerOf(m, id, shots) {
  const layer = m.layers.find((l) => l.id === id) ?? { id, steps: [] };
  const shape = LAYER[id] ?? { title: id, sub: "" };
  return { id, ...shape, ...countOf(m.proved[id], layer.steps.length), asks: layer.steps.map((s) => ({ ...askOf(s, m, id), shot: shotLink(s, shots) })) };
}

// "1 of 2 held" rather than a tick: a layer that asked twice and held once is
// not a layer that passed. Only said when the tally is BELOW what was asked --
// a log cut short would otherwise produce "1 of 0 held", an alarm about the
// report rather than about the run.
function countOf(proved, asked) {
  const n = proved ?? 0;
  if (n >= asked) return { countClass: n ? "pass" : "flat", countText: `${n} proved` };
  return { countClass: "fail", countText: `${n} of ${asked} held` };
}

const askOf = (s, m, id) => ({ ...common(s), ...(BODY[id] ?? genericBody)(s, m) });

const common = (s) => ({
  i: s.i, do: s.do, what: s.why || label(s),
  verdictClass: s.ok === true ? "held" : "broke",
  verdictText: s.ok === true ? "held" : "did not hold",
  broke: s.error ?? s.blocked ?? s.refused ?? null,
  expect: s.expect ?? null,
});

const uiBody = (s) => ({ ui: true, js: s.js ?? null, answer: s.result === undefined ? null : textOf(s.result) });
const apiBody = (s) => ({ api: true, want: `${s.method ?? "any method"} matching /${s.match}/ → ${s.status ?? "2xx"}`, got: gotOf(s.result) });
const sqlBody = (s, m) => ({ sql: true, query: s.query ?? null, table: tableOf(s.rows), rerun: sqlCommandLine(m.run, s.query) });
const genericBody = (s) => ({ json: JSON.stringify(s) });
const BODY = { ui: uiBody, api: apiBody, sql: sqlBody };

const gotOf = (r) => (r ? `${r.method} ${r.url} → ${r.status}` : null);

function tableOf(rows) {
  if (!rows?.length) return null;
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const body = rows.map((r) => ({ cells: cols.map((c) => textOf(r[c] ?? "")) }));
  return { cols, body, count: rows.length };
}

const resolveOf = (m) => (m.resolved.length ? { items: m.resolved.map((r) => ({ as: r.as, ref: paramRef(r.as), value: r.value, sql: r.sql, rerun: sqlCommandLine(m.run, r.sql) })) } : null);

// The markup cannot write this itself. `${` immediately before `{{as}}` is four
// braces the parser reads as a triple-stache, so the opening one was being eaten
// and every resolve row printed `$NAME}`. The name a case would write is a
// VALUE, and values are decided here.
const paramRef = (as) => `\${${as}}`;

function failedOf(m, shots) {
  const f = m.failed;
  if (!f) return null;
  const where = [["url", f.url], ["on screen", f.observed], ["console", f.console], ["network", (f.networkFailures ?? []).join("\n")]];
  return { i: f.i, do: f.do, what: f.why || label(f), why: f.error ?? f.blocked ?? f.refused ?? null, shot: shotLink(f, shots), evidence: where.filter(([, v]) => v).map(([k, v]) => ({ k, v: textOf(v) })) };
}

// What the case SAID, beside what the run saw. The verdict and the evidence
// answer "what happened"; only this answers "what was asked", and a reader who
// has to open the file to find out is a reader the report failed.
const sourceOf = (m) => (m.run.source ? JSON.stringify(m.run.source, null, 2) : null);

// Image bytes are in the gallery; raw local file paths are not evidence text.
const detailOf = ({ screenshot, network, ...step }) => JSON.stringify(step, null, 2);

const stepRow = (s) => ({ i: s.i, do: s.do, screen: s.screen ?? "", what: label(s), polls: s.polls ?? 0, secs: seconds(s.ms), rowClass: s.ok === false ? "broke" : "" });

const seconds = (ms) => `${((ms ?? 0) / 1000).toFixed(1)}s`;
const textOf = (v) => typeof v === "string" ? v : JSON.stringify(v);
const stamp = (m) => String(m.result.at ?? m.run.at ?? "").replace("T", " ").slice(0, 19);
