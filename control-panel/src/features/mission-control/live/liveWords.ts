import { numberOf, stringOf, stringsOf, isRecord } from "../../../shared/json";
import { eventFailed, eventLine, stageLabel, type Tone } from "../missionWords";
import { isQaKind, isTaskEvent, liveKey, type ConnectionState, type Glyph, type LiveEvent, type LiveFilter, type LiveGroup, type LiveRow } from "./live.types";

// Orbit Live's words. Every line carries a GLYPH and a WORD for it (a screen reader hears the word, and
// colour is never the only signal), and every line of a task is the same sentence the timeline always
// said (missionWords.eventLine): Live adds how a line is drawn, never a second story about it.
//
// One exception to "running is a word, never an animation" (missionWords.ACTION): the LIVE badge pulses.
// It does not say the TASK is running -- it says this page holds a healthy stream, and it stops the
// moment the stream does. Only `live` pulses, and never under prefers-reduced-motion.

export const CONNECTION: Record<ConnectionState, { word: string; glyph: string; tone: Tone; pulses: boolean; say: string }> = {
  connecting: { word: "CONNECTING", glyph: "◌", tone: "informative", pulses: false, say: "Opening the live feed" },
  live: { word: "LIVE", glyph: "●", tone: "success", pulses: true, say: "Live: each line arrives as it is written" },
  reconnecting: { word: "RECONNECTING", glyph: "⚠", tone: "warning", pulses: false, say: "The live feed dropped; reconnecting from the last line received" },
  degraded: { word: "DEGRADED LIVE", glyph: "⚠", tone: "warning", pulses: false, say: "The feed could not be kept open: reading every 5 seconds instead" },
  offline: { word: "OFFLINE", glyph: "○", tone: "danger", pulses: false, say: "Orbit Control cannot be reached; trying again" },
  finished: { word: "FINISHED", glyph: "✓", tone: "subtle", pulses: false, say: "The task ended; the feed is closed" },
};

/** A finished task the page OPENED on is a replay of its journal, not a stream that finished. */
export const REPLAY: { word: string; glyph: string; tone: Tone; say: string } = { word: "REPLAY", glyph: "↺", tone: "subtle", say: "A replay of the task's journal: it had ended before this page opened" };

// A step of a coordinated workflow is run by a skill, an agent or the engine; the running action's type says
// which. The engine holds the same table (src/live/words.mjs DISPATCH_WORDS).
export const DISPATCH_WORDS: Readonly<Record<string, string>> = { "skill.invoke": "skill", "agent.dispatch": "agent", "engine.run": "engine" };

export const GLYPHS: Record<Glyph, { char: string; label: string }> = {
  state: { char: "●", label: "state" },
  started: { char: "▶", label: "started" },
  ok: { char: "✓", label: "succeeded" },
  failed: { char: "✗", label: "failed" },
  decision: { char: "◇", label: "decision" },
  file: { char: "+", label: "file changed" },
  evidence: { char: "📸", label: "evidence" },
  warning: { char: "⚠", label: "warning" },
  paused: { char: "⏸", label: "paused" },
  person: { char: "👤", label: "a person" },
  qa: { char: "→", label: "browser step" },
};

// ---- reading a line --------------------------------------------------------------------------------

const s = (e: LiveEvent, key: string) => stringOf(e[key]);
const n = (e: LiveEvent, key: string) => numberOf(e[key]);
const okOf = (outcome: string | null): Glyph => (outcome === "succeeded" ? "ok" : outcome === "failed" ? "failed" : "state");

interface Look {
  glyph: Glyph;
  group: LiveGroup;
  tone?: Tone;
  detail?: string | null;
  failed?: boolean;
  line?: string;
}

const join = (...parts: (string | null | undefined)[]) => parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" · ") || null;

// How each kind of task line is drawn. The words are eventLine's; a kind not here is drawn as a state.
const TASK_LOOK: Record<string, (e: LiveEvent) => Look> = {
  created: () => ({ glyph: "state", group: "state" }),
  stage: (e) => ({ glyph: "state", group: "state", tone: "brand", line: (s(e, "stage") ?? "STAGE").toUpperCase(), detail: s(e, "because") }),
  "attempt-started": () => ({ glyph: "started", group: "action" }),
  "attempt-completed": (e) => ({ glyph: okOf(s(e, "outcome")), group: "action", detail: s(e, "failureSignature") && `signature ${s(e, "failureSignature")}` }),
  decision: (e) => ({ glyph: "decision", group: "decision", tone: "brand", detail: join(s(e, "hypothesis") && `Hypothesis: ${s(e, "hypothesis")}`, stringsOf(e.evidence).length ? `Evidence: ${stringsOf(e.evidence).join(", ")}` : null) }),
  "action-started": () => ({ glyph: "started", group: "action" }),
  "action-completed": (e) => ({ glyph: okOf(s(e, "outcome")), group: "action" }),
  "action-failed": () => ({ glyph: "failed", group: "action" }),
  workspace: () => ({ glyph: "state", group: "state" }),
  "file-changed": (e) => ({ glyph: "file", group: "file", detail: n(e, "added") !== null ? `+${n(e, "added")} −${n(e, "removed") ?? 0}` : null }),
  receipt: (e) => ({ glyph: "evidence", group: "action", detail: s(e, "summary"), failed: /FAIL|VIOLAT|ERROR/i.test(s(e, "outcome") ?? "") }),
  verification: (e) => ({ glyph: s(e, "state") === "satisfied" ? "ok" : s(e, "state") === "violated" ? "warning" : "state", group: "action", failed: s(e, "state") === "violated" }),
  "approval-requested": (e) => ({ glyph: "person", group: "approval", tone: "warning", detail: join(s(e, "reason"), s(e, "risk") && `Risk: ${s(e, "risk")}`) }),
  "approval-granted": () => ({ glyph: "ok", group: "approval" }),
  "approval-rejected": (e) => ({ glyph: "failed", group: "approval", detail: s(e, "reason") }),
  "approval-consumed": () => ({ glyph: "person", group: "approval" }),
  "approval-expired": () => ({ glyph: "warning", group: "approval" }),
  paused: (e) => ({ glyph: "paused", group: "state", tone: "warning", detail: s(e, "because") }),
  resumed: () => ({ glyph: "started", group: "state" }),
  cancelled: (e) => ({ glyph: "paused", group: "state", detail: s(e, "because") }),
  blocked: (e) => ({ glyph: "failed", group: "state", detail: s(e, "because") }),
  unblocked: () => ({ glyph: "state", group: "state" }),
  completed: (e) => ({ glyph: "ok", group: "state", tone: "success", detail: s(e, "summary") }),
  failed: (e) => ({ glyph: "failed", group: "state", detail: s(e, "because") }),
};

const requestOf = (e: LiveEvent) => (Array.isArray(e.requests) ? e.requests.filter(isRecord) : []);
const requestWords = (r: Record<string, unknown>) => `${stringOf(r.method) ?? "?"} ${stringOf(r.endpoint) ?? "?"} → ${numberOf(r.status) ?? (r.failed === true ? "failed" : "?")}`;
const provedWords = (e: LiveEvent) => (isRecord(e.proved) ? Object.entries(e.proved).map(([layer, count]) => `${layer} ${numberOf(count) ?? 0}`).join(" · ") : null);
const stepFailed = (e: LiveEvent) => ["failed", "blocked", "refused"].includes(s(e, "state") ?? "");

// How each kind of QA line is drawn, and what it says: the browser's steps, what failed underneath them, and
// what the investigation concluded. Only what the line holds -- a field it does not have is not shown.
const QA_LOOK: Record<string, (e: LiveEvent) => Look> = {
  "qa.started": (e) => ({ glyph: "started", group: "qa", tone: "brand", line: `QA investigation started${s(e, "mode") ? ` (${s(e, "mode")})` : ""}`, detail: join(s(e, "objective"), s(e, "origin")) }),
  "qa.plan": (e) => ({ glyph: "state", group: "qa", line: `QA plan: ${n(e, "goals") ?? 0} goal(s) over ${n(e, "surfaces") ?? 0} surface(s)`, detail: n(e, "blockers") ? `${n(e, "blockers")} blocker(s)` : null }),
  "qa.decision": (e) => ({ glyph: "decision", group: "decision", line: `QA decision: ${s(e, "action") ?? "next step"}${s(e, "target") ? ` on ${s(e, "target")}` : ""}`, detail: join(s(e, "hypothesis") && `Hypothesis: ${s(e, "hypothesis")}`, s(e, "reason")) }),
  "qa.step": (e) => ({ glyph: stepFailed(e) ? "failed" : "qa", group: "qa", failed: stepFailed(e), line: `${s(e, "do") ?? "step"} ${s(e, "on") ?? ""}`.trim(), detail: join(s(e, "url"), n(e, "ms") !== null ? `${n(e, "ms")}ms` : null, e.screenshot === true ? "📸 screenshot" : null, stepFailed(e) ? s(e, "why") : null) }),
  "qa.console": (e) => ({ glyph: "warning", group: "qa", failed: true, line: `Browser console: ${n(e, "errors") ?? 0} error(s)`, detail: stringsOf(e.messages)[0] ?? null }),
  "qa.network": (e) => ({ glyph: "warning", group: "qa", failed: true, line: requestOf(e).map(requestWords).join(" · ") || "a request failed", detail: s(e, "action") && `during ${s(e, "action")}` }),
  "qa.check": (e) => ({ glyph: s(e, "state") === "observed" ? "ok" : "warning", group: "qa", line: `Data check: ${s(e, "state") ?? "?"}`, detail: s(e, "why") }),
  "qa.security": (e) => ({ glyph: e.leaked === true || e.changed === true ? "failed" : "ok", group: "qa", failed: e.leaked === true || e.changed === true, line: `Tenant check: ${s(e, "operation") ?? "?"} — ${s(e, "state") ?? "?"}`, detail: s(e, "why") }),
  "qa.finding": (e) => ({ glyph: "warning", group: "qa", tone: "warning", failed: true, line: `Finding: ${s(e, "outcome") ?? "?"}${s(e, "confidence") ? ` (${s(e, "confidence")})` : ""}`, detail: s(e, "say") }),
  "qa.reproduction": (e) => ({ glyph: "evidence", group: "qa", line: `Reproduction of ${s(e, "finding") ?? "a finding"}: ${e.reproduced === true ? "reproduced" : "not reproduced"}`, detail: s(e, "why") }),
  "qa.run": (e) => ({ glyph: s(e, "status") === "PASS" ? "ok" : "failed", group: "qa", failed: s(e, "status") !== "PASS", line: `Case ${s(e, "case") ?? "?"}: ${s(e, "status") ?? "?"}`, detail: join(provedWords(e) && `proved ${provedWords(e)}`, s(e, "cause"), e.evidence === true ? "📸 evidence kept" : null) }),
  "qa.draft": (e) => ({ glyph: "evidence", group: "qa", line: `Draft case ${s(e, "case") ?? ""} written`.trim() }),
  "qa.settled": (e) => ({ glyph: "state", group: "qa", line: `QA step settled: ${s(e, "state") ?? "?"}`, detail: s(e, "why") }),
  "qa.question": (e) => ({ glyph: "person", group: "qa", tone: "warning", line: "QA asks a person", detail: s(e, "asks") }),
  "qa.answer": (e) => ({ glyph: "person", group: "qa", line: "A person answered", detail: s(e, "says") }),
  "qa.resumed": () => ({ glyph: "started", group: "qa", line: "QA investigation resumed" }),
  "qa.ended": (e) => ({ glyph: "state", group: "qa", line: `QA investigation ended${s(e, "lifecycle") ? `: ${s(e, "lifecycle")}` : ""}`, detail: join(s(e, "reason"), s(e, "why")) }),
};

const TONE_OF: Record<Glyph, Tone> = { state: "subtle", started: "informative", ok: "success", failed: "danger", decision: "brand", file: "informative", evidence: "informative", warning: "warning", paused: "warning", person: "warning", qa: "informative" };

function lookOf(e: LiveEvent): Look {
  if (isTaskEvent(e)) return TASK_LOOK[e.kind]?.(e) ?? { glyph: "state", group: "state" };
  if (isQaKind(e.kind)) return QA_LOOK[e.kind]?.(e) ?? { glyph: "qa", group: "qa" };
  return { glyph: "state", group: "state", line: e.kind };
}

/** One line of the feed, drawn: its glyph, its words, and whether something went wrong. */
export function rowOf(e: LiveEvent, labels: ReadonlyMap<string, string>): LiveRow {
  const look = lookOf(e);
  const failed = look.failed ?? (isTaskEvent(e) && eventFailed(e));
  return { key: liveKey(e), source: e.source, n: e.n, at: e.at, kind: e.kind, glyph: look.glyph, tone: look.tone ?? (failed ? "danger" : TONE_OF[look.glyph]), group: look.group, line: look.line ?? (isTaskEvent(e) ? eventLine(e, labels) : e.kind), detail: look.detail ?? null, failed, stage: isTaskEvent(e) && e.kind === "stage" };
}

/** A stage's word for the loop strip, the way the rest of the page says it. */
export const stageWord = (stage: string | null) => stageLabel(stage);

// ---- filters ---------------------------------------------------------------------------------------

export const FILTERS: readonly { id: LiveFilter; label: string; keeps: (row: LiveRow) => boolean }[] = [
  { id: "all", label: "All", keeps: () => true },
  { id: "decisions", label: "Decisions", keeps: (r) => r.group === "decision" },
  { id: "actions", label: "Actions", keeps: (r) => r.group === "action" },
  { id: "qa", label: "QA", keeps: (r) => r.group === "qa" || r.source !== "task" },
  { id: "files", label: "Files", keeps: (r) => r.group === "file" },
  { id: "errors", label: "Errors", keeps: (r) => r.failed || r.glyph === "warning" },
  { id: "approvals", label: "Approvals", keeps: (r) => r.group === "approval" },
];

export const isFilter = (value: string): value is LiveFilter => FILTERS.some((f) => f.id === value);
