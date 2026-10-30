// A declared playbook's RUN as rows (0.0.4): under the plan step that carried it, the run's head -- the skill, its
// pinned version, where the run stands -- and one row per step of its workflow, each in a word its evidence earns:
// VERIFIED only on an owner's record, a met contract REPORTED, a contract that did not hold NOT MET, a call that failed
// FAILED. Beside each, what the journal says of it: the provider it went through, how long it took, how often it was
// asked again, the approval it waits for. Read off src/live/plan.mjs skillRunsOf; nothing here reads a file, and a run
// whose workflow could not be read says so instead of drawing steps it does not know.
//
//   skillRunRows(snap, stepId, depth, nowMs) -> [row]
//   runsOf(snap) -> [run]                         every run the root task carried
//   activeOf(snap) -> { run, step } | null        the step a run is carrying now
import { skillRunsOf } from "../plan.mjs";
import { between, dim, joined, row, seg } from "./sections/parts.mjs";

// A step's word, by what its receipt says. Each glyph has an ASCII spelling (glyphs.mjs).
export const SKILL_STEP_STATE = {
  RUNNING: { word: "RUNNING", tone: "info", glyph: "●" },
  VERIFIED: { word: "VERIFIED", tone: "success", glyph: "✓" },
  CONTRACT_MET: { word: "REPORTED", tone: "warning", glyph: "~" },
  VERIFY_FAILED: { word: "NOT MET", tone: "danger", glyph: "✗" },
  FAILED: { word: "FAILED", tone: "danger", glyph: "✗" },
  REFUSED: { word: "REFUSED", tone: "danger", glyph: "✗" },
  BLOCKED: { word: "BLOCKED", tone: "warning", glyph: "■" },
  WAITING: { word: "WAITING", tone: "warning", glyph: "⏸" },
  SKIPPED: { word: "SKIPPED", tone: "subtle", glyph: "-" },
  INTERRUPTED: { word: "INTERRUPTED", tone: "warning", glyph: "⚠" },
  AMBIGUOUS: { word: "AMBIGUOUS", tone: "danger", glyph: "⚠" },
  PENDING: { word: "PENDING", tone: "subtle", glyph: "○" },
};

// A run's word: its own receipt's once it settled, else where its steps stand (src/live/plan.mjs RUN_STATE).
export const SKILL_RUN_STATE = {
  BINDING: { word: "BINDING", tone: "info", glyph: "◌" },
  RUNNING: { word: "RUNNING", tone: "info", glyph: "●" },
  VERIFYING: { word: "VERIFYING", tone: "info", glyph: "◐" },
  VERIFIED: { word: "VERIFIED", tone: "success", glyph: "✓" },
  REPORTED: { word: "REPORTED", tone: "warning", glyph: "~" },
  FAILED: { word: "FAILED", tone: "danger", glyph: "✗" },
  BLOCKED: { word: "BLOCKED", tone: "warning", glyph: "■" },
  INTERRUPTED: { word: "INTERRUPTED", tone: "warning", glyph: "⚠" },
};

const UNKNOWN = { word: "UNKNOWN", tone: "subtle", glyph: "◌" };

// A step blocked on a person's approval says it WAITS, and for which request.
export const stepStateOf = (s) => (s.word === "BLOCKED" && s.waiting ? SKILL_STEP_STATE.WAITING : SKILL_STEP_STATE[s.word] ?? UNKNOWN);

export const runStateOf = (r) => SKILL_RUN_STATE[r.state] ?? UNKNOWN;

export const runsOf = (snap) => (snap?.view ? skillRunsOf(snap.plan, snap.view, snap.events, snap.skills) : []);

const indent = (depth) => "  ".repeat(depth);

const versionOf = (snap, r) => snap.skills?.[r.pin]?.version ?? String(r.pin ?? "").split(":")[1] ?? "?";

const skillIdOf = (r) => String(r.pin ?? "a playbook").split(":")[0];

// The run's own identity beside its skill (0.2.2): its id, which attempt opened it last, and how it is known.
const runIdWords = (r) => ` · ${r.run}${r.attempts > 1 ? ` · attempt ${r.attempts}` : ""}${r.provenance ? ` · ${r.provenance.toLowerCase().replace("_", "-")}` : ""}`;

const headRow = (snap, r, depth) => ((st) => row([seg(indent(depth)), seg("▸ ", "subtle"), seg(`skill ${skillIdOf(r)}`, "label"), dim(` v${versionOf(snap, r)}${runIdWords(r)}${r.unread ? " · its workflow could not be read" : ""}`)], [seg(st.word, st.tone), dim(` ${r.calls} call(s)`)], { depth, status: st.word }))(runStateOf(r));

// What the journal says beside a step: its provider, how long it took (or has run), how often it was asked again,
// and what it waits for -- each only when something recorded it.
const besideOf = (s, nowMs) => joined([s.provider ? dim(s.provider) : null, between(s.startedAt, s.endedAt, nowMs) ? dim(between(s.startedAt, s.endedAt, nowMs)) : null, s.retries ? seg(`retried ${s.retries}×`, "warning") : null, s.waiting ? seg(`waits for ${s.waiting}`, "warning") : null]);

const stepRow = (s, depth, nowMs) => ((st) => row([seg(indent(depth)), seg(`${st.glyph} `, st.tone), seg(s.id, "label"), dim(s.capability ? `  ${s.capability}${s.tool ? ` · ${s.tool}` : ""}` : "")], [seg(st.word, st.tone), ...(besideOf(s, nowMs).length ? [dim("  "), ...besideOf(s, nowMs)] : [])], { depth, status: st.word }))(stepStateOf(s));

// The newest run a plan step carried (a later attempt resumes the same run), its head and its steps.
export function skillRunRows(snap, stepId, depth, nowMs) {
  const r = runsOf(snap).filter((x) => x.step === stepId).at(-1);
  if (!r) return [];
  return [headRow(snap, r, depth), ...r.steps.map((s) => stepRow(s, depth + 1, nowMs))];
}

export const activeOf = (snap) => ((r) => (r ? { run: r, step: r.steps.find((s) => s.word === "RUNNING") ?? r.steps.find((s) => s.waiting) ?? null } : null))(runsOf(snap).find((x) => ["RUNNING", "BINDING", "VERIFYING"].includes(x.state) || x.steps.some((s) => s.waiting)));
