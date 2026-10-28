// The MILESTONE CONSOLE: what a person watching wants to know, in sentences -- the requirement read, the
// workspace prepared, the build passing, a test failing, a fix being tried -- one line per milestone, from the
// journal's own lines and nothing else. Every sentence is a row of MILESTONES, matched on a line's kind and
// fields; a line no row matches is not a milestone and is left to the full timeline (the `a` key). A step of a
// coordinated workflow shows as a WORKFLOW strip; the engineering task it started, as a CHILD line.
import { durationOf, clockOf } from "./lines.mjs";
import { headOf } from "./compact.mjs";
import { drawn } from "./width.mjs";
import { STEP_DONE, WORKFLOW_GLYPHS } from "../words.mjs";
import { protectedFold, protectedSay, titleOf } from "../protected.mjs";

const str = (v) => (typeof v === "string" && v.length > 0 ? v : null);
const joined = (...parts) => parts.filter(Boolean).join(" · ");

// What kind of action an id was: an action's line carries its type only when it starts.
const typeOf = (ctx, id) => ctx.types.get(id) ?? null;

const isTask = (e) => e.source === "task";

const stepName = (ref) => STEP_DONE[ref] ?? ref;

// Ordered, first match wins: { when(e, ctx), glyph, say(e, ctx) }. Glyphs: ok, failed, started, warning, person, state.
export const MILESTONES = [
  { when: (e) => e.kind === "receipt" && e.domain === "step" && e.outcome === "SUCCEEDED", glyph: "ok", say: (e) => joined(STEP_DONE[e.ref] ?? `${e.ref} done`, str(e.summary)) },
  { when: (e) => e.kind === "receipt" && e.domain === "step" && e.outcome === "REPORTED", glyph: "state", say: (e) => joined(`${stepName(e.ref)} (reported, not proven)`, str(e.summary)) },
  { when: (e) => e.kind === "receipt" && e.domain === "step" && e.outcome === "FAILED", glyph: "failed", say: (e) => joined(`Step ${e.ref} failed`, str(e.summary)) },
  { when: (e) => e.kind === "receipt" && e.domain === "step" && e.outcome === "BLOCKED", glyph: "warning", say: (e) => joined(`Step ${e.ref} blocked`, str(e.summary)) },
  { when: (e) => e.kind === "receipt" && e.domain === "step" && e.outcome === "RUNNING", glyph: "started", say: (e) => joined(`Step ${e.ref} started`, str(e.summary)) },
  { when: (e) => e.kind === "receipt" && e.domain === "plan" && e.outcome === "ACTIVE", glyph: "state", say: (e) => joined("Workflow planned", str(e.summary)) },
  { when: (e) => e.kind === "receipt" && e.domain === "task" && ["STARTED", "RESUMED"].includes(e.outcome), glyph: "started", say: (e) => `Engineering task ${e.outcome === "STARTED" ? "started" : "picked up"} · ${e.ref}` },
  { when: (e) => e.kind === "receipt" && e.domain === "skill" && e.outcome === "ACTIVE", glyph: "ok", say: (e) => `Generated playbook verified and offered · ${e.ref}` },
  { when: (e) => e.kind === "receipt" && e.domain === "requirement" && e.outcome === "READY", glyph: "ok", say: () => "Requirement snapshot loaded" },
  { when: (e) => e.kind === "workspace", glyph: "ok", say: () => "Task workspace prepared" },
  { when: (e, ctx) => e.kind === "action-completed" && typeOf(ctx, e.id) === "record-changes" && e.outcome === "succeeded", glyph: "ok", say: () => "Implementation completed" },
  { when: (e, ctx) => e.kind === "action-completed" && typeOf(ctx, e.id) === "build", glyph: "auto", say: (e) => joined(e.outcome === "succeeded" ? "Build succeeded" : "Build failed", e.outcome === "succeeded" ? null : str(e.summary)) },
  { when: (e, ctx) => e.kind === "action-completed" && typeOf(ctx, e.id) === "verify", glyph: "auto", say: (e) => joined(e.outcome === "succeeded" ? "Checks passed" : "Checks failed", e.outcome === "succeeded" ? null : str(e.summary)) },
  { when: (e) => e.kind === "receipt" && e.domain === "impact", glyph: "impact", say: (e) => joined(`Impact ${String(e.outcome ?? "").toLowerCase()}`, str(e.summary)) },
  { when: (e, ctx) => e.kind === "action-completed" && typeOf(ctx, e.id) === "test", glyph: "auto", say: (e) => joined(e.outcome === "succeeded" ? "Tests passed" : "Tests failed", e.outcome === "succeeded" ? null : str(e.summary)) },
  { when: (e) => e.kind === "decision" && /^diagnose/.test(String(e.nextAction ?? "")), glyph: "ok", say: () => "Agent diagnosing failure" },
  { when: (e) => e.kind === "attempt-started" && e.cause === "fix", glyph: "started", say: () => "Fix recorded · running tests again" },
  { when: (e) => e.kind === "attempt-started" && e.cause === "retest", glyph: "started", say: () => "Running tests again" },
  { when: (e, ctx) => e.kind === "approval-requested" && ctx.asked?.has(e.id), glyph: "person", say: (e) => joined(`Waiting for approval · ${protectedSay(e)}`, e.id, "decide in Orbit Control") },
  { when: (e, ctx) => e.kind === "approval-granted" && ctx.asked?.has(e.id), glyph: "ok", say: (e, ctx) => joined("Approval granted", titleOf(ctx.asked.get(e.id)), e.id) },
  { when: (e, ctx) => e.kind === "approval-rejected" && ctx.asked?.has(e.id), glyph: "failed", say: (e, ctx) => joined("Approval rejected", titleOf(ctx.asked.get(e.id)), e.id) },
  { when: (e, ctx) => e.kind === "approval-expired" && ctx.asked?.has(e.id), glyph: "warning", say: (e, ctx) => joined("Approval expired", titleOf(ctx.asked.get(e.id)), e.id) },
  { when: (e, ctx) => e.kind === "action-started" && ctx.asked?.has(e.approval), glyph: "started", say: (e, ctx) => `${titleOf(ctx.asked.get(e.approval))} executing` },
  { when: (e, ctx) => e.kind === "action-completed" && ctx.spentBy?.has(e.id), glyph: "auto", say: (e, ctx) => joined(`${titleOf(ctx.asked.get(ctx.spentBy.get(e.id)))} ${e.outcome === "succeeded" ? "completed" : "failed"}`, str(e.summary)) },
  { when: (e, ctx) => e.kind === "action-failed" && ctx.spentBy?.has(e.id), glyph: "failed", say: (e, ctx) => joined(`${titleOf(ctx.asked.get(ctx.spentBy.get(e.id)))} failed`, str(e.summary) ?? str(e.reason)) },
  { when: (e) => e.kind === "approval-requested", glyph: "person", say: (e) => joined(`Waiting for a person's approval · ${e.id}`, "decide in Orbit Control") },
  { when: (e) => e.kind === "blocked", glyph: "warning", say: (e) => joined(`Blocked: ${e.stop}`, str(e.needs) && `needs ${e.needs}`) },
  { when: (e) => e.kind === "completed", glyph: "ok", say: () => "Completed" },
  { when: (e) => e.kind === "failed", glyph: "failed", say: (e) => joined(`Failed: ${e.stop}`, str(e.because)) },
  { when: (e) => e.kind === "cancelled", glyph: "failed", say: () => "Cancelled by a person" },
];

const GLYPH = { ok: ["✓", "success"], failed: ["✗", "danger"], started: ["▶", "info"], warning: ["▲", "warning"], person: ["👤", "warning"], state: ["●", "subtle"] };

const IMPACT_GLYPH = { SCOPED: GLYPH.state, MISSING: GLYPH.warning, WIDENED: GLYPH.warning };

const GLYPH_OF = { auto: (e) => (e.outcome === "succeeded" ? GLYPH.ok : GLYPH.failed), impact: (e) => IMPACT_GLYPH[e.outcome] ?? GLYPH.state };

const glyphOf = (row, e) => (GLYPH_OF[row.glyph] ?? (() => GLYPH[row.glyph]))(e);

const contextOf = (events) => ({ types: new Map(events.filter((e) => isTask(e) && e.kind === "action-started").map((e) => [e.id, str(e.type)])), ...protectedFold(events.filter(isTask)) });

// The milestones of a journal, oldest first: { at, glyph, tone, say }.
export function milestonesOf(events) {
  const ctx = contextOf(events);
  return events.filter(isTask).map((e) => ({ e, row: MILESTONES.find((r) => r.when(e, ctx)) })).filter((x) => x.row).map(({ e, row }) => ((g) => ({ at: e.at, glyph: g[0], tone: g[1], say: row.say(e, ctx) }))(glyphOf(row, e)));
}

// The pulse on the last milestone while what it started is still going: a fix being tried, a step running.
const STILL = ["Fix recorded · running tests again", "Running tests again"];

const pulsing = (m, snap, last) => last && snap.view && !snap.view.terminal && (STILL.includes(m.say) || m.say.startsWith("Step ") && m.say.includes(" started"));

// ---- the footer: the checks, or the workflow -------------------------------------------------------

const CHECK_MARK = { succeeded: ["✓", "success"], failed: ["✗", "danger"], error: ["✗", "danger"], running: ["●", "info"] };

const lastOfType = (view, type) => view.actions.filter((a) => a.type === type).at(-1) ?? null;

const retesting = (view) => ["fix", "retest"].includes(view.attempts?.at(-1)?.cause) && !view.attempts.at(-1).outcome;

const checkCell = (view, type) => ((a) => (a ? ((m) => ({ text: `${type.toUpperCase()}${type === "test" && retesting(view) && a.state === "running" ? " RETEST" : ""} ${m[0]}`, tone: m[1] }))(CHECK_MARK[a.state] ?? ["·", "subtle"]) : null))(lastOfType(view, type));

const checksOf = (view) => ["build", "verify", "test"].map((t) => checkCell(view, t)).filter(Boolean);

const stepCells = (view) => view.receipts.filter((r) => r.domain === "step").map((r) => ({ text: `${r.ref} ${WORKFLOW_GLYPHS[r.outcome] ?? "·"}`, tone: r.outcome === "FAILED" ? "danger" : r.outcome === "SUCCEEDED" ? "success" : r.outcome === "RUNNING" ? "info" : "subtle" }));

const separated = (cells) => cells.flatMap((c, i) => (i ? [{ text: " · ", tone: "subtle" }, c] : [c]));

const childLine = (child) => (child ? [{ text: " CHILD ", tone: "subtle" }, { text: joined(child.task.id, child.lifecycle, child.stage, child.attempt?.number ? `attempt ${child.attempt.number}/${child.attempt.limit ?? "?"}` : null) }, ...((c) => (c.length ? [{ text: "  " }, ...separated(c)] : []))(checksOf(child))] : null);

const footer = (snap) => (snap.view?.task?.provider === "automation" ? [[{ text: " WORKFLOW ", tone: "subtle" }, ...separated(stepCells(snap.view))], childLine(snap.child)].filter(Boolean) : [[{ text: " " }, ...separated(checksOf(snap.view))]]);

// ---- the screen ---------------------------------------------------------------------------------

const RULE = "─";

const rule = (columns, label = "") => [{ text: `${RULE.repeat(Math.max(4, columns - label.length - 2))}${label ? ` ${label}` : ""}`, tone: "subtle" }];

function title(snap) {
  const head = headOf(snap);
  const v = snap.view;
  return [[{ text: " ORBIT LIVE — Full Console", tone: "brand" }, { text: `   ${head.glyph} ${head.word}`, tone: head.tone }], [{ text: ` TASK ${joined(v?.task?.id ?? snap.association.task, v?.task?.root, v?.attempt?.number ? `Attempt ${v.attempt.number}/${v.attempt.limit ?? "?"}` : null, v?.task?.provider === "automation" ? "AUTOMATION" : null)}`, tone: "subtle" }]];
}

const milestoneRow = (snap) => (m, i, all) => [{ text: ` ${clockOf(m.at)}  `, tone: "subtle" }, { text: pulsing(m, snap, i === all.length - 1) ? "◐" : m.glyph, tone: m.tone }, { text: `  ${m.say}`, tone: pulsing(m, snap, i === all.length - 1) ? "warning" : undefined }];

const keys = (snap) => `q quit · a all lines${snap.view?.task?.provider === "automation" && snap.child ? " · c engineering task" : ""}`;

export function milestoneLines(snap, opts) {
  const o = { columns: 100, rows: 30, colour: false, ...opts };
  const bottom = [rule(o.columns), ...footer(snap), [{ text: ` ${keys(snap)}`, tone: "subtle" }]];
  const top = [...title(snap), rule(o.columns)];
  const rows = milestonesOf(snap.events).map(milestoneRow(snap));
  return [...top, ...rows.slice(-Math.max(1, o.rows - top.length - bottom.length)), ...bottom].map((segments) => drawn(segments, o.columns, o.colour));
}

export { durationOf };
