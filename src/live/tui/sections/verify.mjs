// VERIFY: what the engineering task's change is HELD TO, read only off its journal -- the latest impact
// receipt (what the plan or the change was found to reach) and the verification rows the engine published
// (src/orchestration/obligations.mjs): what is owed, what passed, what failed exactly as it did before the
// change, what regressed, what is NOT AFFECTED and was not run, and what nothing declared verifies. A
// baseline failure is a check that failed before the code first changed; a blocker is anything that still
// stands between the task and completion that the journal can show. Nothing here is computed from a
// graph or a check list: a task with no impact receipt (one recorded before 1.8.4) shows no section.
import { bar, counted } from "../bars.mjs";
import { dim, joined, row, seg, str } from "./parts.mjs";

const BAR = 16;

const AS_BEFORE = /fails no worse than before the change$/;

const NOT_RUN = /— not affected, not run$/;

// What a verification row says, first row that holds.
const KINDS = [
  { kind: "missing", when: (v) => v.state === "blocked" && String(v.subject ?? "").startsWith("missing-"), glyph: "⚠", tone: "warning", word: "MISSING" },
  { kind: "excluded", when: (v) => v.state === "not-applicable" && NOT_RUN.test(v.obligation ?? ""), glyph: "·", tone: "subtle", word: "NOT AFFECTED — NOT RUN" },
  { kind: "gone", when: (v) => v.state === "not-applicable", glyph: "·", tone: "subtle", word: "no longer reached" },
  { kind: "asBefore", when: (v) => v.state === "satisfied" && AS_BEFORE.test(v.obligation ?? ""), glyph: "≈", tone: "warning", word: "failed as before" },
  { kind: "passed", when: (v) => v.state === "satisfied", glyph: "✓", tone: "success", word: "passed" },
  { kind: "regressed", when: (v) => v.state === "violated", glyph: "✗", tone: "danger", word: "REGRESSED" },
  { kind: "blocked", when: (v) => v.state === "blocked", glyph: "✗", tone: "danger", word: "could not run" },
  { kind: "owed", when: () => true, glyph: "○", tone: "info", word: "owed" },
];

export const kindOf = (v) => KINDS.find((k) => k.when(v));

export const impactOf = (view) => view.receipts.filter((r) => r.domain === "impact").at(-1) ?? null;

const IMPACT_TONE = { SCOPED: "success", MISSING: "warning", WIDENED: "warning" };

export const grouped = (view) => Object.fromEntries(KINDS.map((k) => [k.kind, view.verification.filter((v) => kindOf(v).kind === k.kind)]));

// The checks the task held to: every row that is not NOT AFFECTED and not MISSING.
const HELD = ["passed", "asBefore", "regressed", "blocked", "owed"];

const heldOf = (g) => HELD.flatMap((k) => g[k]);

function headRow(impact, g) {
  const held = heldOf(g).length;
  const settled = g.passed.length + g.asBefore.length;
  return row(joined([seg(impact.outcome, IMPACT_TONE[impact.outcome] ?? "info"), bar(settled, held, BAR) && seg(bar(settled, held, BAR), "success"), seg(counted(settled, held, "settled")), dim(`${g.excluded.length} not affected`), g.missing.length ? seg(`${g.missing.length} missing`, "warning") : null], "  "));
}

const checkRow = (v) => ((k) => row([seg(`${k.glyph} `, k.tone), seg(str(v.obligation) ?? v.subject), seg(`  ${k.word}`, k.tone)]))(kindOf(v));

const excludedRow = (rows) => (rows.length ? [row([dim(`· ${rows.length} not affected — not run: ${rows.slice(0, 3).map((v) => String(v.obligation).replace(NOT_RUN, "").trim()).join(", ")}${rows.length > 3 ? ", …" : ""}`)], [], { detail: true })] : []);

// A check that failed before the code first changed: a baseline failure, kept visible.
function baselineFailures(snap) {
  const first = snap.events.find((e) => e.source === "task" && e.kind === "file-changed")?.at ?? null;
  return first ? snap.view.actions.filter((a) => ["build", "verify", "test"].includes(a.type) && a.state === "failed" && a.startedAt < first).map((a) => str(a.tool) ?? a.id) : [];
}

const baselineRow = (snap) => ((ids) => (ids.length ? [row([seg("BASELINE ", "label"), dim(`failed before the change: ${ids.slice(0, 4).join(", ")}${ids.length > 4 ? ", …" : ""}`)])] : []))(baselineFailures(snap));

function blockerWords(view, g) {
  const parts = [g.owed.length && `${g.owed.length} owed`, g.regressed.length && `${g.regressed.length} regressed`, g.blocked.length && `${g.blocked.length} could not run`, g.missing.length && `${g.missing.length} with nothing to verify it`, view.blocked && `blocked: ${view.blocked.stop}`];
  return parts.filter(Boolean);
}

const blockersRow = (view, g) => ((words) => row([seg("BLOCKERS ", "label"), words.length ? seg(words.join(" · "), "warning") : seg(view.terminal ? "none: the task ended" : "none the journal shows", "success")]))(blockerWords(view, g));

function verifyRows(snap) {
  const view = snap.view;
  const impact = impactOf(view);
  const g = grouped(view);
  return [headRow(impact, g), blockersRow(view, g), row([dim(str(impact.summary) ?? "")]), ...[...g.regressed, ...g.missing, ...g.blocked, ...g.owed, ...g.asBefore, ...g.passed].map(checkRow), ...excludedRow(g.excluded), ...baselineRow(snap)];
}

export function verifySection(ctx) {
  const snap = ctx.d.engineering;
  return snap?.view && impactOf(snap.view) ? { name: "verify", rows: verifyRows(snap) } : null;
}
