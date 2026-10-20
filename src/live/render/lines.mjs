// One EVENT as a line a person reads: its glyph and a short summary, from the fields the journal (or the QA
// allow-list) already holds -- never a field it does not. The same words every terminal mode prints, so
// `--plain`, the TTY timeline and the status line describe one line the same way. Returned as DATA (strings
// and a tone); cleaning and colouring are the drawer's.
import { GLYPHS } from "../words.mjs";

const str = (v) => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const joined = (...parts) => parts.filter((p) => p !== null && p !== undefined && p !== "").join(" · ");
const outcomeGlyph = (o) => (o === "succeeded" ? "ok" : o === "failed" ? "failed" : "state");
const ms = (v) => (num(v) === null ? null : `${num(v)}ms`);
const request = (r) => `${str(r?.method) ?? "?"} ${str(r?.endpoint) ?? "?"} ${num(r?.status) ?? str(r?.failed) ?? "failed"}`;
const requests = (e) => (Array.isArray(e.requests) ? e.requests.filter((r) => r && typeof r === "object").slice(0, 3).map(request).join(", ") : null);
const proved = (e) => (e.proved && typeof e.proved === "object" ? Object.entries(e.proved).filter(([, n]) => num(n)).map(([k, n]) => `${k} ${n}`).join(" ") : null);

// [glyph, summary] per kind; a kind not here is a state line that says only its kind.
const TASK = {
  created: (e) => ["state", joined("task created", str(e.objective))],
  stage: (e) => ["state", joined(str(e.stage), str(e.because))],
  "attempt-started": (e) => ["started", joined("attempt", str(e.cause))],
  "attempt-completed": (e) => [outcomeGlyph(e.outcome), joined("attempt", str(e.outcome))],
  decision: (e) => ["decision", joined(str(e.observed) && `observed: ${e.observed}`, str(e.nextAction) && `next: ${e.nextAction}`)],
  "action-started": (e) => ["started", joined(str(e.label) ?? str(e.type), str(e.tool))],
  "action-completed": (e) => [outcomeGlyph(e.outcome), joined(str(e.id), str(e.outcome), str(e.summary))],
  "action-failed": (e) => ["failed", joined(str(e.id), str(e.summary) ?? str(e.reason))],
  workspace: (e) => ["state", joined("workspace", str(e.workspace))],
  "file-changed": (e) => ["file", joined(str(e.path), str(e.change), num(e.added) !== null ? `+${e.added} −${num(e.removed) ?? 0}` : null)],
  receipt: (e) => ["evidence", joined(`${str(e.domain) ?? "?"}:${str(e.ref) ?? "?"}`, str(e.outcome), str(e.summary))],
  verification: (e) => [e.state === "satisfied" ? "ok" : e.state === "violated" ? "warning" : "state", joined(str(e.obligation), str(e.state))],
  "approval-requested": (e) => ["person", joined(str(e.id), str(e.action), str(e.environment) && `on ${e.environment}`, "a person decides in Orbit Control")],
  "approval-granted": (e) => ["person", joined(str(e.id), "approved")],
  "approval-rejected": (e) => ["person", joined(str(e.id), "rejected", str(e.reason))],
  "approval-consumed": (e) => ["state", joined(str(e.id), "used")],
  "approval-expired": (e) => ["warning", joined(str(e.id), "expired")],
  paused: (e) => ["paused", joined("paused", str(e.because))],
  resumed: (e) => ["started", joined("resumed", str(e.because))],
  cancelled: (e) => ["failed", joined("cancelled", str(e.because))],
  blocked: (e) => ["warning", joined(str(e.stop), str(e.needs) && `needs ${e.needs}`, str(e.because))],
  unblocked: (e) => ["started", joined("unblocked", str(e.because))],
  completed: (e) => ["ok", joined("completed", str(e.summary))],
  failed: (e) => ["failed", joined(str(e.stop), str(e.because))],
};

const QA = {
  "qa.started": (e) => ["started", joined("QA started", str(e.mode), str(e.objective))],
  "qa.plan": () => ["state", "QA plan"],
  "qa.decision": (e) => ["decision", joined("QA decision", str(e.action), str(e.target))],
  "qa.step": (e) => [e.state === "failed" || e.state === "refused" ? "failed" : "qa", joined(`${str(e.do) ?? "step"} ${str(e.on) ?? ""}`.trim(), str(e.url), ms(e.ms), e.screenshot === true ? "📸" : null)],
  "qa.console": (e) => ["warning", joined(`browser console: ${num(e.errors) ?? 0} error(s)`)],
  "qa.network": (e) => ["warning", requests(e) || "a request failed"],
  "qa.check": (e) => [e.state === "observed" ? "ok" : "warning", joined("data check", str(e.state), str(e.why))],
  "qa.security": (e) => [e.leaked === true || e.changed === true ? "failed" : "ok", joined("tenant check", str(e.operation), str(e.state))],
  "qa.finding": (e) => ["warning", joined("finding", str(e.outcome), str(e.confidence))],
  "qa.reproduction": (e) => ["evidence", joined("reproduction", str(e.finding), e.reproduced === true ? "reproduced" : "not reproduced")],
  "qa.run": (e) => [e.status === "PASS" ? "ok" : "failed", joined(`case ${str(e.case) ?? "?"}`, str(e.status), proved(e) && `proved ${proved(e)}`, e.evidence === true ? "📸" : null)],
  "qa.draft": (e) => ["evidence", joined("draft case", str(e.case))],
  "qa.settled": (e) => ["state", joined("QA step settled", str(e.state))],
  "qa.question": (e) => ["person", joined("QA asks a person", str(e.asks))],
  "qa.answer": () => ["person", "a person answered"],
  "qa.resumed": () => ["started", "QA resumed"],
  "qa.ended": (e) => ["state", joined("QA ended", str(e.lifecycle), str(e.reason) ?? str(e.why))],
};

const FAILED_GLYPHS = new Set(["failed", "warning"]);

// Whether a line's kind is one these tables say (1.8.6): a kind they do not is still shown, as a state line.
export const knownKind = (e) => Object.hasOwn(e?.source === "task" ? TASK : QA, String(e?.kind ?? ""));

export function lineOf(e) {
  const row = (e.source === "task" ? TASK : QA)[e.kind];
  const [glyph, summary] = row ? row(e) : ["state", ""];
  return { at: str(e.at), source: e.source === "task" ? "task" : "qa", kind: e.kind, glyph: GLYPHS[glyph].char, failed: FAILED_GLYPHS.has(glyph), summary };
}

// Durations as a person says them: 12s, 4m03s, 1h12m.
export function durationOf(msValue) {
  const s = Math.max(0, Math.floor(msValue / 1000));
  if (s < 60) return `${s}s`;
  return s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
}

// The clock time of a line, HH:MM:SS in UTC -- the same on every machine that reads one journal.
export const clockOf = (iso) => (typeof iso === "string" && iso.length >= 19 ? iso.slice(11, 19) : "--:--:--");
