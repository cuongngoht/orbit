// What an investigation's journal says as LIVE QA ACTIVITY: the browser steps, the failed requests,
// the console errors, the runs and the findings a person watching a task wants to see as they happen
// -- read off lines the investigation already wrote (src/investigation/act.mjs, runs.mjs, findings.mjs),
// so this is a VIEW of QA truth and never a second copy of it. Pure: a record in, events out.
//
// ACTIVITY is an ALLOW-LIST per kind, the rule the journal's own KINDS keeps: a field no row names never
// reaches a page, so a field the journal gains next year is invisible here until someone decides it is
// safe to show. Every kind of the journal either has rows or is named in SILENT -- a test holds that, so
// a new kind has to choose. On the way out:
//
//   - a string is cut to TEXT_LIMIT, and so is each string inside an array;
//   - a nested object in a kept field is DROPPED, never walked: a field whose meaning grows into a
//     structure is not shown by accident (a request's headers, a check's input);
//   - a request is its method, its canonical endpoint, its status, whether it failed and how long it
//     took -- never a header, a body, a query or a fingerprint;
//   - a check never shows its query: a SQL text can carry a value, and a page does not need it.
//
// A decision's `hypothesis` and `reason` are the journal's own one-sentence fields, bounded by its write
// door; there is no chain of thought here to show, because none is ever written.
import { KIND_NAMES, TEXT_LIMIT } from "./vocab.mjs";

export const ACTIVITY_VERSION = 1;

const clip = (v) => (typeof v === "string" && v.length > TEXT_LIMIT ? `${v.slice(0, TEXT_LIMIT - 1)}…` : v);
const scalar = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);
const bounded = (v) => (Array.isArray(v) ? v.filter(scalar).map(clip) : scalar(v) ? clip(v) : undefined);
const count = (v) => (Array.isArray(v) ? v.length : 0);
const numbers = (o) => (o && typeof o === "object" ? Object.fromEntries(Object.entries(o).filter(([, n]) => typeof n === "number")) : null);

// The failed ones of a network observation, each with what a person needs to recognise it.
const failedOf = (r) => (r.data?.requests ?? []).filter((q) => q?.failed === true || (q?.status ?? 0) >= 400).map((q) => ({ n: q.n ?? null, method: bounded(q.method) ?? null, endpoint: bounded(q.endpoint) ?? null, status: q.status ?? null, failed: q.failed === true, durationMs: q.durationMs ?? null }));

const consoleErrors = (r) => r.layer === "console" && (r.data?.errors ?? 0) > 0;
const networkFailures = (r) => r.layer === "network" && failedOf(r).length > 0;

export const ACTIVITY = {
  created: [{ event: "qa.started", fields: ["id", "objective", "mode", "inputMode"], derive: { environment: (r) => bounded(r.environment?.id) ?? null, origin: (r) => bounded(r.environment?.origin) ?? null, task: (r) => bounded(r.runtime?.task) ?? null } }],
  plan: [{ event: "qa.plan", fields: [], derive: { goals: (r) => count(r.goals), surfaces: (r) => count(r.surfaces), blockers: (r) => count(r.blockers) } }],
  decision: [{ event: "qa.decision", fields: ["id", "target", "action", "hypothesis", "reason", "mutates"] }],
  action: [{ event: "qa.step", fields: ["id", "do", "on", "surface", "target", "state", "why", "ms"], derive: { url: (r) => bounded(r.url?.after) ?? null, screenshot: (r) => Boolean(r.screenshot) } }],
  observation: [
    { event: "qa.console", when: consoleErrors, fields: ["id", "action", "state"], derive: { errors: (r) => r.data.errors, messages: (r) => bounded(r.data.messages ?? []) } },
    { event: "qa.network", when: networkFailures, fields: ["id", "action", "state"], derive: { requests: failedOf, truncated: (r) => r.data?.truncated ?? 0 } },
  ],
  check: [{ event: "qa.check", fields: ["id", "action", "layer", "state", "why", "tables", "rows", "within", "ms"] }],
  security: [{ event: "qa.security", fields: ["id", "row", "operation", "expect", "state", "why", "status", "leaked", "changed"] }],
  finding: [{ event: "qa.finding", fields: ["id", "family", "outcome", "confidence", "action", "say", "expected", "actual", "oracle", "reproduced", "supersedes"] }],
  reproduction: [{ event: "qa.reproduction", fields: ["id", "finding", "action", "reproduced", "why"] }],
  run: [{ event: "qa.run", fields: ["id", "case", "status", "cause", "confidence", "authority"], derive: { proved: (r) => numbers(r.proved), evidence: (r) => Boolean(r.evidence) } }],
  draft: [{ event: "qa.draft", fields: ["id", "finding", "case", "oracle"] }],
  settled: [{ event: "qa.settled", fields: ["id", "decision", "state", "why"] }],
  question: [{ event: "qa.question", fields: ["id", "obligation", "asks"] }],
  answer: [{ event: "qa.answer", fields: ["id", "question", "says", "by"] }],
  resumed: [{ event: "qa.resumed", fields: ["id", "by", "why"] }],
  cancelled: [{ event: "qa.ended", fields: ["by", "why"], derive: { lifecycle: () => "cancelled" } }],
  completed: [{ event: "qa.ended", fields: ["id", "reason", "lifecycle", "by", "why"] }],
};

// Kinds a live page deliberately says nothing about: what an input source was (a reference, not an
// event), the analysis keys, a receipt for knowledge and a checkpoint of the loop.
export const SILENT = ["input", "analysis", "receipt", "checkpoint"];

// Every kind chooses: a row, or silence. The test asks this.
export const unchosen = () => KIND_NAMES.filter((k) => !ACTIVITY[k] && !SILENT.includes(k));

// -> [{ kind: "qa.*", at, ...allow-listed }] for one journal record; [] for a silent or unknown kind.
export const activityOf = (record) => (ACTIVITY[record?.kind] ?? []).filter((row) => !row.when || row.when(record)).map((row) => eventOf(row, record));

function eventOf(row, record) {
  const kept = Object.fromEntries(row.fields.map((f) => [f, bounded(record[f])]).filter(([, v]) => v !== undefined));
  const derived = Object.fromEntries(Object.entries(row.derive ?? {}).map(([name, of]) => [name, of(record)]));
  return { kind: row.event, at: record.at ?? null, ...kept, ...derived };
}
