// A TAP STREAM (the Test Anything Protocol, versions 13 and 14), read as it is printed (ADR 0020). A protocol, not a
// product: many runners print it, so this names none. It is recognised by its own first line, `TAP version N`, and
// read from there on; lines before it (a script's preamble) are not its.
//
// What it reports, and what it does not:
//   - a CASE is a LEAF test point: one with no test point nested under it. A suite, a describe block or a file
//     wrapper is a parent -- its own `ok` comes after its children's -- and is never counted. A parent that failed
//     for a reason of its own (a hook) is reported as a failure, never as a case.
//   - a case is reported when the stream reports it: TAP says what a test came to, in the order the runner REPORTS,
//     which is not the order anything ran in. Nothing here ever says a case is "running".
//   - a case's identity is its position in the tree (`# Subtest` ordinals, else test point numbers), so two cases
//     with one name in two suites are two cases.
//   - the YAML block after a test point gives its duration and, for one that failed, the message, where, why and the
//     first lines of its stack -- each cleaned and bounded (text.mjs), never the block itself.
//   - the totals a runner prints as comments at the end (`# tests 4`, `# pass 2` …) are the runner's own word, kept
//     beside what was observed so a disagreement shows.
import { cleaned } from "./text.mjs";
import { LIMITS } from "./vocab.mjs";

const VERSION = /^TAP version 1[34]\s*$/;

export const TAP = Object.freeze({
  id: "tap",
  framework: "a TAP stream (Test Anything Protocol 13 or 14)",
  runner: "TAP",
  capabilities: { lifecycle: true, cases: "reported", total: "at-end", order: "reported" },
  observes: ["passed", "failed", "skipped", "todo", "cancelled"],
  claims: () => false,
  sniff: (line) => VERSION.test(line),
  parser: () => tapParser(),
});

const fresh = () => ({ started: false, subtests: [], names: [], open: [], pending: null, yaml: null, totals: {} });

export function tapParser() {
  const p = fresh();
  return { line: (text) => lineOf(p, text), end: () => [...flushed(p), ...summaryOf(p)] };
}

// ---- one line, first row that holds --------------------------------------------------------------------------

const LINES = [
  { when: (p, t) => !p.started, then: (p, t) => started(p, t) },
  { when: (p) => p.yaml !== null, then: (p, t) => yamlLine(p, t) },
  { when: (p, t) => p.pending !== null && /^\s*---\s*$/.test(t), then: (p, t) => yamlOpened(p, t) },
  { when: (p, t) => SUBTEST.test(t), then: (p, t) => subtest(p, t.match(SUBTEST)) },
  { when: (p, t) => POINT.test(t), then: (p, t) => point(p, t.match(POINT)) },
  { when: (p, t) => TOTAL.test(t), then: (p, t) => totalLine(p, t.match(TOTAL)) },
  { when: () => true, then: () => [] },
];

const lineOf = (p, text) => LINES.find((r) => r.when(p, text)).then(p, text);

function started(p, text) {
  if (VERSION.test(text)) p.started = true;
  return [];
}

const depthOf = (indent) => Math.floor(indent.length / 4);

// ---- the tree ------------------------------------------------------------------------------------------------

const SUBTEST = /^(\s*)# Subtest: (.*)$/;

// A subtest begins: it is new at its depth, and has no child yet.
function subtest(p, m) {
  const d = depthOf(m[1]);
  Object.assign(p.subtests, { [d]: (p.subtests[d] ?? 0) + 1, length: d + 1 });
  Object.assign(p.names, { [d]: m[2], length: d + 1 });
  p.open[d] = false;
  return flushed(p);
}

const POINT = /^(\s*)(not )?ok\b(?:\s+(\d+))?\s*(?:-\s*)?(.*)$/;

const DIRECTIVE = /\s+#\s+(SKIP|TODO)\b.*$/i;

// A test point: whatever was pending is reported first; a point with children is a parent; its parent now has one.
function point(p, m) {
  const out = flushed(p);
  const d = depthOf(m[1]);
  const leaf = p.open[d] !== true;
  closedAt(p, d);
  return [...out, ...pendingFrom(p, m, d, leaf)];
}

// The point at depth d ends its subtest (and everything deeper); the subtest that holds it now has a child.
function closedAt(p, d) {
  p.open.length = d + 1;
  p.open[d] = false;
  if (d > 0) p.open[d - 1] = true;
}

const stateOf = (failed, directive) => (/todo/i.test(directive ?? "") ? "todo" : /skip/i.test(directive ?? "") ? "skipped" : failed ? "failed" : "passed");

function pendingFrom(p, m, d, leaf) {
  const directive = m[4].match(DIRECTIVE)?.[1] ?? null;
  const name = cleaned(m[4].replace(DIRECTIVE, ""), LIMITS.NAME_CHARS);
  p.pending = { leaf, depth: d, key: [...p.subtests.slice(0, d), p.subtests[d] ?? Number(m[3] ?? 0)].join("."), name, suite: cleaned(p.names.slice(0, d).filter(Boolean).join(" › "), LIMITS.NAME_CHARS) || null, state: stateOf(Boolean(m[2]), directive), fields: {}, blocks: {} };
  return [];
}

// ---- the YAML block after a point: a few fields, read as plain text, never evaluated -------------------------------

const YAML_FIELD = /^(\s*)([A-Za-z_]+):\s*(.*)$/;

function yamlOpened(p, text) {
  p.yaml = { indent: text.indexOf("-"), block: null, blockIndent: 0 };
  return [];
}

function yamlLine(p, text) {
  if (/^\s*\.\.\.\s*$/.test(text)) return yamlClosed(p);
  const indent = text.length - text.trimStart().length;
  if (p.yaml.block && indent > p.yaml.blockIndent) return blockLine(p, text);
  return yamlField(p, text.match(YAML_FIELD));
}

function blockLine(p, text) {
  const lines = (p.pending.blocks[p.yaml.block] ??= []);
  if (lines.length < LIMITS.STACK_LINES) lines.push(text.trim());
  return [];
}

function yamlField(p, m) {
  if (!m) return [];
  const block = /^[|>][-+]?$/.test(m[3]);
  Object.assign(p.yaml, { block: block ? m[2] : null, blockIndent: m[1].length });
  if (!block) p.pending.fields[m[2]] = unquoted(m[3]);
  return [];
}

const unquoted = (v) => (/^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : /^".*"$/.test(v) ? v.slice(1, -1) : v);

function yamlClosed(p) {
  p.yaml = null;
  return flushed(p);
}

// ---- what is reported ------------------------------------------------------------------------------------------

const CATEGORY = [
  { when: (f) => /timeout/i.test(f.failureType ?? ""), category: "timeout" },
  { when: (f) => /cancel/i.test(f.failureType ?? ""), category: "cancelled" },
  { when: (f) => /assert/i.test(`${f.code ?? ""} ${f.name ?? ""}`), category: "assertion" },
  { when: () => true, category: "unknown" },
];

const categoryOf = (fields) => CATEGORY.find((c) => c.when(fields)).category;

// A runner that cancelled a case reports it `not ok`, and says why in its block: that is a cancel, not a failure.
const finalState = (pending) => (pending.state === "failed" && categoryOf(pending.fields) === "cancelled" ? "cancelled" : pending.state);

const duration = (f) => (Number.isFinite(Number(f.duration_ms)) && f.duration_ms !== undefined ? Math.round(Number(f.duration_ms) * 1000) / 1000 : null);

const messageOf = (pd) => cleaned([pd.fields.error ?? (pd.blocks.error ?? []).join(" "), pd.fields.expected !== undefined ? `expected ${pd.fields.expected}` : "", pd.fields.actual !== undefined ? `actual ${pd.fields.actual}` : ""].filter(Boolean).join(" · "), LIMITS.MESSAGE_CHARS) || null;

// What the case said it expected and what it got, when its YAML block names them (1.8.6): bounded values of their own.
// The message keeps saying them too, so a reader of an earlier observation reads the same sentence.
const valueOf = (v) => (v === undefined ? null : cleaned(String(v), LIMITS.VALUE_CHARS) || null);

const failureOf = (pd) => ({ kind: "case.failure", key: pd.key, name: pd.name, suite: pd.suite, category: categoryOf(pd.fields), message: messageOf(pd), expected: valueOf(pd.fields.expected), actual: valueOf(pd.fields.actual), location: cleaned(pd.fields.location ?? "", LIMITS.NAME_CHARS) || null, stack: (pd.blocks.stack ?? []).map((l) => cleaned(l, LIMITS.STACK_CHARS)).filter(Boolean) });

// A leaf is a case; a parent that failed for a reason of its own (not "its subtests failed") is a failure only.
const PENDING = [
  { when: (pd) => pd.leaf && finalState(pd) === "failed", events: (pd) => [caseOf(pd), failureOf(pd)] },
  { when: (pd) => pd.leaf, events: (pd) => [caseOf(pd)] },
  { when: (pd) => pd.state === "failed" && !/subtests?failed/i.test(String(pd.fields.failureType ?? "").replace(/\s/g, "")), events: (pd) => [failureOf(pd)] },
  { when: () => true, events: () => [] },
];

const caseOf = (pd) => ({ kind: "case.reported", key: pd.key, name: pd.name, suite: pd.suite, state: finalState(pd), durationMs: duration(pd.fields) });

function flushed(p) {
  const pd = p.pending;
  p.pending = null;
  return pd ? PENDING.find((r) => r.when(pd)).events(pd) : [];
}

// ---- the runner's own totals ------------------------------------------------------------------------------------

const TOTAL = /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/;

const TOTAL_NAMES = { tests: "tests", pass: "passed", fail: "failed", cancelled: "cancelled", skipped: "skipped", todo: "todo" };

function totalLine(p, m) {
  p.totals[TOTAL_NAMES[m[1]]] = Number(m[2]);
  return flushed(p);
}

const summaryOf = (p) => (Object.keys(p.totals).length ? [{ kind: "runner.summary", totals: { ...p.totals }, scope: "TAP" }] : []);
