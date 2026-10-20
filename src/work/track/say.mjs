// A work's view in words, for a terminal and for `live status` (1.8.8): labelled lines, one thing each, no percentage
// and no word that claims more than the evidence level says. A pure function of the view (view.mjs); the terminal's
// own control characters are `printable()`'s business at the one door that prints.

const clip = (text, n = 90) => (String(text).length > n ? `${String(text).slice(0, n - 1)}…` : String(text));

const line = (label, text) => (text ? `${label.padEnd(10)} ${text}` : null);

const fileWords = (f) => `${f.path}${f.attribution === "shared" ? " (shared)" : ""}`;

const listed = (items, n) => `${items.slice(0, n).join(", ")}${items.length > n ? ` +${items.length - n} more` : ""}`;

const filesLine = (v) => (v.activity.files.length ? `${v.activity.files.length} observed${v.summary.changes.shared ? ` (${v.summary.changes.shared} shared)` : ""}: ${listed(v.activity.files.map(fileWords), 3)}` : null);

const checkWords = (c) => `${c.what} · ${c.result}${c.current ? "" : " · superseded by a later edit"}`;

const checksLine = (v) => (v.activity.checks.length ? listed(v.activity.checks.map(checkWords), 2) : null);

const taskWords = (t) => `${t.task} (${t.what}) ${t.readable ? `${t.lifecycle}${t.stage ? ` · ${t.stage}` : ""}` : "not readable"}`;

const handoffWords = (h) => `${h.from ?? "?"} → ${h.to}${h.task ? ` (${h.task})` : ""}`;

const modeWords = (v) => `${v.mode}${v.route?.to ? ` · routed to ${v.route.to}` : ""}${v.route?.because ? ` because ${clip(v.route.because, 60)}` : ""}`;

const lifeWords = (v) => `${v.lifecycle.word} · ${v.lifecycle.say}${v.lifecycle.wait ? ` (${v.lifecycle.wait})` : ""} · session ${v.liveness}`;

const blockerOf = (v) => (["BLOCKED", "WAITING", "PAUSED"].includes(v.lifecycle.state) ? v.lifecycle.why : null);

// The lines of one work. `all: false` is the short form `live status` prints.
export function viewLines(v, { all = true } = {}) {
  const core = [line("WORK", `${v.work} — ${clip(v.title ?? "")}`), line("REF", v.ref), line("MODE", modeWords(v)), line("LIFECYCLE", lifeWords(v)), line("EVIDENCE", `${v.evidence.level} — ${clip(v.evidence.why, 100)}`), line("FILES", filesLine(v)), line("CHECKS", checksLine(v)), line("BLOCKER", blockerOf(v) && clip(blockerOf(v)))];
  const more = [line("TASKS", listed(v.tasks.map(taskWords), 3)), line("HANDOFFS", listed(v.handoffs.map(handoffWords), 3)), line("SUMMARY", v.report?.summary && clip(v.report.summary, 120)), line("PROVED", v.summary.proved.length ? listed(v.summary.proved, 3) : null), line("UNVERIFIED", v.summary.unverified.length ? listed(v.summary.unverified, 3) : null), ...v.warnings.map((w) => line("NOTE", clip(w, 120)))];
  return [...core, ...(all ? more : [])].filter(Boolean);
}

export const viewText = (v) => viewLines(v).join("\n");

const rowWords = (r) => `  ${r.work}  ${r.standing.padEnd(13)} ${r.mode.padEnd(10)} ${r.ref ? `${r.ref}  ` : ""}${clip(r.title ?? "", 70)}`;

export const listText = (r) => [`WORKS      ${r.works.length} tracked in this checkout`, ...r.works.map(rowWords)].join("\n");

export const coverageText = (r) => [`HOST       ${r.coverage.host ?? "unknown"} · ${r.coverage.observation} observation`, `EDITS      ${r.coverage.edits}`, `COMMANDS   ${r.coverage.commands}`, `OUTCOME    ${r.coverage.outcome}`, `SESSIONEND ${r.coverage.sessionEnd ? "reported by the host" : "not reported: INTERRUPTED is never derived"}`, ...r.coverage.limits.map((l) => `LIMIT      ${l}`)].join("\n");
