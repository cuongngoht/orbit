// THE EVENTS VIEW of a pane (0.0.2, ADR 0028): the milestones, newest on top -- and, for a coordinated workflow, under
// the step whose turn it was when each was written. No journal line says which step an event belongs to, so the
// grouping is a READ of times the journal already holds: a step's turn begins when the action its receipt names began
// (else when the receipt was written), and a milestone belongs to the newest step whose turn had begun by its time. It
// is a way to read the list, never a claim about cause, and nothing is written. Every other task, and the every-line
// list (`a`), keep the flat list. The view's HINT is its head's words with the keys a pane does not have taken out.
//
//   eventsView(ctx) -> { rows, hint }
import { STATUS_WORDS, WORKFLOW_STEP_WORDS } from "../words.mjs";
import { isCoordinator } from "./model.mjs";
import { recentSection } from "./sections/recent.mjs";
import { steps as workflowSteps } from "./sections/work.mjs";
import { dim, row, seg } from "./sections/parts.mjs";

const OUTCOME_STATUS = Object.freeze({ SUCCEEDED: "PASSED", FAILED: "FAILED", BLOCKED: "BLOCKED", RUNNING: "RUNNING", PENDING: "NOT_RUN", SKIPPED: "NOT_RUN", REPORTED: "UNKNOWN" });

// A hint part's leading key ("a every line", "↑↓ scroll") is a key the pane has not got: its words are kept.
const unkeyed = (part) => part.replace(/^\S{1,2} (?=\S)/, "");

const hintOf = (head) => (head ? [...head.left.map((s) => s.text).join("").split(" · "), ...head.right.map((s) => s.text).join("").split(" · ").map(unkeyed)].filter(Boolean).join(" · ") : null);

const startOf = (view, receipt) => (view.actions ?? []).find((a) => a.id === receipt?.action)?.startedAt ?? receipt?.at ?? null;

// Each step that has had its turn, with when it began, oldest first.
const turnsOf = (snap) => ((s) => s.names.map((name) => ({ name, outcome: s.receipts.get(name)?.outcome ?? "PENDING", at: startOf(snap.view, s.receipts.get(name)) })).filter((t) => t.at).sort((a, b) => (a.at < b.at ? -1 : 1)))(workflowSteps(snap.view, snap.plan));

const turnAt = (turns, at) => turns.filter((t) => t.at <= at).at(-1) ?? null;

const turnHead = (t) => ((w) => row([seg(`${w.glyph} `, "title"), seg(WORKFLOW_STEP_WORDS[t.name] ?? t.name, "title")], [], { depth: 0, status: OUTCOME_STATUS[t.outcome] ?? "UNKNOWN" }))(STATUS_WORDS[OUTCOME_STATUS[t.outcome] ?? "UNKNOWN"]);

// The rows, newest first already, cut into runs of one step: a head each time the step changes.
const groupedRows = (rows, turns) => rows.flatMap((r, i) => ((t, before) => (t && t !== before ? [turnHead(t), r] : [r]))(r.at ? turnAt(turns, r.at) : null, i && rows[i - 1].at ? turnAt(turns, rows[i - 1].at) : null));

const groups = (ctx) => isCoordinator(ctx.d.root?.view) && !ctx.state.viewer.all && ctx.d.focus === ctx.d.root;

export function eventsView(ctx) {
  const s = recentSection(ctx);
  if (!s) return { rows: [row([dim("nothing yet")])], hint: null };
  return { rows: groups(ctx) ? groupedRows(s.rows, turnsOf(ctx.d.root)) : s.rows, hint: hintOf(s.head) };
}
