// THE LIFECYCLE of the work a viewer shows (1.8.9): Context · Memory · Engineering · Learning, one row each, every one
// read off a journal the engine keeps -- the context the work gathered (an engineering task's `gather-context` action,
// or its coordinator's context step) in the context command's own word (src/context/status.mjs), the engineering
// task's own lifecycle and stage, and the `learning` receipt a finished task links (src/engineering/observe/task.mjs)
// -- never off a setting, a clock or a guess. A row nothing has spoken to yet says so, and no row is a percentage.
// Pure: the rows the terminal and a docked pane draw, as segments of text and a tone.
//
//   lifecycleOf(ctx) -> [{ label, mark, text }]      the data, one entry per row; [] when no task is shown
//   lifecycleRows(ctx, narrow) -> [row]              the rows, drawn after the tracked work's own; none when narrow
import { LIFECYCLE_GLYPHS } from "../words.mjs";
import { LABEL_CELLS, dim, row, seg } from "./sections/parts.mjs";

const WORD = /^(NOT_INITIALIZED|BLOCKED|BOOTSTRAPPED|STALE|PARTIAL|READY):\s*(.*)$/;
const TALLY = /(\d+) of (\d+) known(?:; unknown: ([^),]*(?:, [^),]*)*))?/;

// The context the work gathered, the newest word first: the engineering task's own action, else its coordinator's step.
const STEP_STATE = { RUNNING: "running", SUCCEEDED: "succeeded", REPORTED: "succeeded", FAILED: "failed", BLOCKED: "failed" };

const lastAction = (view, type) => ((a) => (a ? { state: a.state, summary: a.summary ?? "" } : null))((view?.actions ?? []).filter((x) => x.type === type).at(-1));

const stepOf = (view, id) => ((r) => (r && STEP_STATE[r.outcome] ? { state: STEP_STATE[r.outcome], summary: r.summary ?? "" } : null))((view?.receipts ?? []).find((x) => x.domain === "step" && x.ref === id));

const contextOf = (ctx) => lastAction(ctx.d.engineering?.view, "gather-context") ?? stepOf(ctx.d.root?.view, "context");

// What each context word means for the mark: READY is done; what is only partly known is partial, never done.
const CONTEXT_MARK = { READY: "done", BOOTSTRAPPED: "partial", PARTIAL: "partial", STALE: "partial", BLOCKED: "failed", NOT_INITIALIZED: "waiting" };

const said = (c) => c.summary.replace(WORD, "$1 — $2");

// Ordered; the first row that matches decides, and the last always does.
const CONTEXT = [
  { when: (c) => !c, mark: () => "waiting", text: () => "not gathered yet" },
  { when: (c) => c.state === "running", mark: () => "running", text: () => "gathering, memory first" },
  { when: (c) => ["failed", "error"].includes(c.state), mark: () => "failed", text: (c) => c.summary || "it could not be gathered" },
  { when: (c) => WORD.test(c.summary), mark: (c) => CONTEXT_MARK[c.summary.match(WORD)[1]], text: said },
  { when: () => true, mark: () => "partial", text: (c) => c.summary || "gathered, with no word for how much is known" },
];

const tallyOf = (c) => c?.summary?.match(TALLY) ?? null;

const MEMORY = [
  { when: (c) => !tallyOf(c), mark: () => "waiting", text: () => "nothing recalled yet" },
  { when: (c) => tallyOf(c)[1] === tallyOf(c)[2], mark: () => "done", text: (c) => `${tallyOf(c)[1]} of ${tallyOf(c)[2]} parts of the project's memory answered` },
  { when: () => true, mark: () => "partial", text: (c) => `${tallyOf(c)[1]} of ${tallyOf(c)[2]} parts answered${tallyOf(c)[3] ? `; nothing yet for ${tallyOf(c)[3]}` : ""}` },
];

const ENGINEERING = [
  { when: (v) => !v, mark: () => "waiting", text: () => "no engineering task yet" },
  { when: (v) => v.lifecycle === "COMPLETED", mark: () => "done", text: () => "completed on its own proof" },
  { when: (v) => ["FAILED", "CANCELLED"].includes(v.lifecycle), mark: () => "failed", text: (v) => `${v.lifecycle.toLowerCase()}${v.stopReason ? ` · ${v.stopReason}` : ""}` },
  { when: () => true, mark: () => "running", text: (v) => `${String(v.stage ?? v.lifecycle ?? "").toLowerCase()}${v.attempt?.number ? ` · attempt ${v.attempt.number}` : ""}` },
];

const LEARNING = [
  { when: (r) => r?.outcome === "OBSERVED", mark: () => "done", text: (r) => r.summary ?? "observed" },
  { when: (r) => r?.outcome === "NOTHING", mark: () => "waiting", text: (r) => `nothing learned: ${r.summary ?? ""}` },
  { when: () => true, mark: () => "waiting", text: () => "awaiting evidence — a task teaches at its finish" },
];

const learningOf = (view) => (view?.receipts ?? []).find((r) => r.domain === "learning") ?? null;

const entry = (label, table, facts) => ((r) => ({ label, mark: r.mark(facts), text: r.text(facts) }))(table.find((x) => x.when(facts)));

export function lifecycleOf(ctx) {
  if (!ctx.d.root?.view && !ctx.d.engineering?.view) return [];
  const context = contextOf(ctx);
  const eng = ctx.d.engineering?.view ?? null;
  return [entry("Context", CONTEXT, context), entry("Memory", MEMORY, context), entry("Engineering", ENGINEERING, eng), entry("Learning", LEARNING, learningOf(eng))];
}

// A narrow pane keeps only what runs and how far, so the lifecycle gives way there, as the work's wider rows do.
export const lifecycleRows = (ctx, narrow = false) => (narrow ? [] : lifecycleOf(ctx).map((e) => row([dim(e.label.padEnd(LABEL_CELLS)), seg(`${LIFECYCLE_GLYPHS[e.mark].glyph} `, LIFECYCLE_GLYPHS[e.mark].tone), seg(e.text)], [], { label: e.label })));
