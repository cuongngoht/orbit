// A tester's SESSION, not a run: every case they drove, on one page, and -- the
// half a green table cannot give anybody -- what is LEFT for a person to check
// by hand.
//
// The rows come from the LEDGER rather than from the evidence directories,
// because the ledger already holds one line per finished run on every machine.
// So a review can be written after the fact by somebody who was not there, and
// a session split across two laptops is still one page.
import { publish } from "./publish-page.mjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LAYERS, SCREEN_LAYER } from "../dsl/verbs.mjs";
import { reportFile } from "./index.mjs";
import { render } from "./template.mjs";

const TONE = { PASS: "pass", SKIP: "flat", PARTIAL: "warn", FAIL: "fail", REFUSED: "warn", BLOCKED: "warn", INCONCLUSIVE: "warn" };

// Why a status that is not PASS still leaves a person something to do, in words
// that say WHICH. A tester reading a table of green and grey cannot be expected
// to know that BLOCKED is not a defect and that SKIP verified nothing.
export const UNJUDGED = {
  SKIP: "the skip-if guard found the data already there — nothing was verified this time",
  PARTIAL: "only a slice of the case ran — the case as a whole is still unproven",
  BLOCKED: "it never reached a verdict (environment, database, deadline) — fix that, do not file a defect",
  REFUSED: "it was refused before ruling on anything — fix the precondition and run it again",
  INCONCLUSIVE: "it ran and ruled on nothing — the case has no verdict step",
};

// The layers that witness a write from BELOW the screen, derived from the verb
// table the same way the case rule derives them, so a new layer is covered here
// the day its verb exists.
export const WITNESSES = LAYERS.filter((l) => l !== SCREEN_LAYER);

// Every reason a human still has to look, as a TABLE. The next reason is a row,
// never a branch, and nothing here can invent a reason a run did not report.
const CHECKS = [
  { kind: "proved on the screen only", when: (r) => r.status === "PASS" && !r.witnessed,
    say: () => `it passed on the screen alone — a screen can show a write that never happened, so check the ${WITNESSES.join("/")} side yourself` },
  { kind: "no verdict on the product", when: (r) => Boolean(UNJUDGED[r.status]),
    say: (r) => `${r.status}: ${UNJUDGED[r.status]}` },
  { kind: "failed", when: (r) => r.status === "FAIL",
    say: (r) => `${r.why || "it failed"} — reproduce it by hand before calling it a product bug` },
];

export function reviewModel(runs, opts = {}) {
  const rows = runs.map((r) => rowOf(r, opts));
  const manual = manualOf(rows, opts);
  return { project: opts.project ?? "", window: opts.window ?? "", generated: opts.generated ?? "", n: rows.length, hosts: hostsOf(rows), rows, totals: totals(rows), manual, ...calloutOf(rows, manual) };
}

function rowOf(r, opts) {
  const proved = r.proved ?? {};
  const witnessed = WITNESSES.some((l) => proved[l] > 0);
  return { case: r.case, status: r.status ?? "?", tone: TONE[r.status] ?? "warn", broke: r.status === "FAIL" ? "broke" : "", when: short(r.at), host: r.host ?? "?", steps: `${r.done ?? 0}/${r.of ?? 0}`, secs: secs(r.ms), as: asOf(r), proved: provedOf(proved), witnessed, why: whyOf(r), report: reportOf(r, opts) };
}

const provedOf = (proved) => LAYERS.map((id) => ({ id, n: proved[id] ?? 0 })).filter((p) => p.n);
const asOf = (r) => (r.identity ?? []).map((i) => i.as).filter(Boolean).join(", ");
const secs = (ms) => (ms ? `${Math.round(ms / 1000)}s` : "");
const short = (at) => String(at ?? "").replace("T", " ").slice(0, 16);
const whyOf = (r) => (r.failedStep ? `failed at step ${r.failedStep.i} ${r.failedStep.do} ${r.failedStep.on ?? ""}`.trim() : "");
const hostsOf = (rows) => [...new Set(rows.map((r) => r.host))].join(", ");

// A link to a report that was never written is worse than no link: a reader
// clicks it once, gets nothing, and stops trusting the other links too. So the
// caller says what exists on disk and this only links what does.
function reportOf(r, opts) {
  if (!r.evidence || !opts.reports) return "";
  const file = reportFile(opts.reports, r);
  return opts.has?.(file) ? file : "";
}

function totals(rows) {
  const per = new Map();
  for (const r of rows) per.set(r.status, (per.get(r.status) ?? 0) + 1);
  return [...per].map(([status, n]) => ({ status, n, tone: TONE[status] ?? "warn" }));
}

// The section this page exists for. A run nobody made is the easiest thing in a
// test session to lose, so a case with no run in the window is listed too.
function manualOf(rows, opts) {
  const found = rows.flatMap((r) => CHECKS.filter((c) => c.when(r)).map((c) => ({ case: r.case, kind: c.kind, say: c.say(r) })));
  return [...found, ...missing(rows, opts.cases)];
}

function missing(rows, cases) {
  const ran = new Set(rows.map((r) => r.case));
  return (cases ?? []).filter((id) => !ran.has(id)).map((id) => ({ case: id, kind: "not run in this window", say: "no run of it here — run it, or write down why it was left out" }));
}

// The conclusion in one line, because a reader who opens the file and reads one
// sentence must come away with the right answer. "5/6 passed" is not it while
// three of the five proved nothing below the screen.
function calloutOf(rows, manual) {
  const passed = rows.filter((r) => r.status === "PASS").length;
  const tone = rows.some((r) => r.status === "FAIL") ? "danger" : manual.length ? "" : "ok";
  return { callout: `${passed}/${rows.length} PASS · ${manual.length} item(s) still need a person`, calloutClass: tone };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, name), "utf8");

export const reviewHtml = (runs, opts = {}) => render(read("review.html"), { ...reviewModel(runs, opts), style: read("report.css") });

export function writeReview(file, runs, opts = {}) {
  publish(file, reviewHtml(runs, opts));
  return file;
}
