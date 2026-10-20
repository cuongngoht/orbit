// RECENT: what the task shown has done lately, newest on top -- its MILESTONES (src/live/render/milestones.mjs,
// the same sentences `watch` prints) or, with `a`, every line it journaled and, unless switched off, its QA
// activity (src/live/render/lines.mjs). NOTICES: the few lines worth a person's attention, from every task this
// viewer follows and from the viewer itself (a read that failed, a console refused), oldest first like a log.
// Lines from two journals are put side by side by the time each says, never as one caused the other.
import { lineOf } from "../../render/lines.mjs";
import { milestonesOf } from "../../render/milestones.mjs";
import { LIMITS, focusId } from "../model.mjs";
import { clock, dim, joined, num, row, seg, str } from "./parts.mjs";

const visible = (state, slot) => (state.viewer.hold.recent === null ? slot.events : slot.events.slice(0, Math.max(0, state.viewer.hold.recent - slot.dropped)));

const FILTER_OF = {
  all: () => true,
  task: (e) => e.source === "task",
  qa: (e) => e.source !== "task",
  failed: (e) => lineOf(e).failed,
};

const FILTER_WORDS = { all: "every line", task: "the task's lines", qa: "QA lines", failed: "what went wrong" };

const ATTENTION = new Set(["danger", "warning"]);

const milestoneRow = (m) => row([seg(m.glyph, m.tone), dim(`  ${clock(m.at)}  `), seg(m.say, ATTENTION.has(m.tone) ? m.tone : undefined)], [], { at: m.at });

function lineRow(e) {
  const l = lineOf(e);
  return row([seg(l.glyph, l.failed ? "danger" : "info"), dim(`  ${clock(l.at)}  `), dim(l.source.padEnd(5)), seg(String(e.kind).padEnd(20), l.failed ? "danger" : undefined), seg(l.summary, l.failed ? "danger" : undefined)], [str(e.id) ? dim(`[${e.id}]`) : null]);
}

const showsQa = (state) => state.viewer.settings?.terminal?.showQa !== false;

function lines(state, events) {
  const kept = events.filter((e) => showsQa(state) || e.source === "task").filter(FILTER_OF[state.viewer.filter]);
  return state.viewer.all ? kept.map(lineRow).reverse() : milestonesOf(events).map(milestoneRow).reverse();
}

function headRow(state, slot) {
  const v = state.viewer;
  const what = v.all ? FILTER_WORDS[v.filter] : "milestones";
  return row(joined([dim("newest on top"), seg(what), slot.dropped ? dim(`${slot.dropped} older line(s) not kept`) : null, v.hold.recent !== null ? seg("HELD", "warning") : null]), [dim(v.all ? "a milestones · f which lines · ↑↓ scroll" : "a every line · ↑↓ scroll")]);
}

export function recentSection(ctx) {
  const slot = ctx.state.tasks[focusId(ctx.state)];
  if (!slot) return null;
  const rows = lines(ctx.state, visible(ctx.state, slot));
  return { name: "recent", head: headRow(ctx.state, slot), rows: rows.length ? rows : [row([dim(slot.view ? (ctx.state.viewer.all ? "nothing to show yet" : "no milestone yet · a shows every line") : "reading the task's journal…")])], scroll: "recent" };
}

// ---- NOTICES ----------------------------------------------------------------------------------------------

const and = (text) => (text ? ` · ${text}` : "");

const NOTICES = [
  { when: (e) => e.kind === "action-failed", say: (e) => ["danger", "✗", `${e.id} failed${and(str(e.summary) ?? str(e.reason))}`] },
  { when: (e) => e.kind === "action-completed" && e.outcome === "failed", say: (e, types) => ["danger", "✗", `${(types.get(e.id) ?? "action").toUpperCase()} failed${and(str(e.summary))} (${e.id})`] },
  { when: (e) => e.kind === "blocked", say: (e) => ["warning", "■", `blocked: ${e.stop ?? "?"}${e.needs ? ` (needs ${e.needs})` : ""}${and(str(e.because))}`] },
  { when: (e) => e.kind === "approval-requested", say: (e) => ["warning", "👤", `waiting for a person: ${e.id} · ${e.action ?? "?"}${e.environment ? ` on ${e.environment}` : ""} · decide in Orbit Control`] },
  { when: (e) => e.kind === "approval-expired", say: (e) => ["warning", "⚠", `approval ${e.id} expired`] },
  { when: (e) => e.kind === "verification" && e.state === "violated", say: (e) => ["danger", "✗", `violated: ${e.obligation ?? e.subject ?? "a verification"}`] },
  { when: (e) => e.kind === "failed", say: (e) => ["danger", "✗", `the task failed: ${e.stop ?? "?"}${and(str(e.because))}`] },
  { when: (e) => e.kind === "qa.finding" && /DEFECT$/.test(String(e.outcome)), say: (e) => [e.outcome === "CONFIRMED_DEFECT" ? "danger" : "warning", "⚠", `QA finding ${e.outcome} ${e.confidence ?? ""}`.trimEnd()] },
  { when: (e) => e.kind === "qa.network", say: (e) => ["warning", "⚠", lineOf(e).summary] },
  { when: (e) => e.kind === "qa.console" && num(e.errors) > 0, say: (e) => ["warning", "⚠", `browser console: ${e.errors} error(s)`] },
];

const typesOf = (events) => new Map(events.filter((e) => e.source === "task" && e.kind === "action-started").map((e) => [e.id, str(e.type)]));

function journalNotices(slot, tag) {
  const types = typesOf(slot.events);
  return slot.events.map((e) => ({ e, r: NOTICES.find((n) => n.when(e)) })).filter((x) => x.r).map(({ e, r }) => ((w) => ({ at: e.at ?? "", tone: w[0], glyph: w[1], text: w[2], tag }))(r.say(e, types)));
}

const STATUS_NOTICES = { reconnecting: ["warning", "⚠", "a read failed; reading again from the last line received"], unavailable: ["danger", "!", "the task's journal cannot be read here"] };

const statusNotices = (state, nowIso) => Object.values(state.tasks).filter((s) => STATUS_NOTICES[s.status]).map((s) => ((w) => ({ at: nowIso, tone: w[0], glyph: w[1], text: `${s.id}: ${w[2]}${and(s.error)}`, tag: null }))(STATUS_NOTICES[s.status]));

const resetNotices = (state) => Object.values(state.tasks).filter((s) => s.resets).map((s) => ({ at: s.resetAt ?? "", tone: "warning", glyph: "⚠", text: `${s.id}: the task's journal was begun again${s.resets > 1 ? ` (${s.resets} times)` : ""}; read from its first line`, tag: null }));

function viewerNotices(state, nowIso) {
  const c = state.console;
  const consoleStopped = c.open && c.state === "stopped" && c.message ? [{ at: nowIso, tone: "warning", glyph: "⚠", text: `sandbox console: ${c.message}`, tag: null }] : [];
  return [...statusNotices(state, nowIso), ...resetNotices(state), ...consoleStopped];
}

const tagOf = (state, slot) => (Object.keys(state.tasks).length > 1 ? (slot.role === "child" ? "engineering" : "workflow") : null);

const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

function noticesOf(state) {
  const nowIso = new Date(state.viewer.nowMs).toISOString();
  const all = [...Object.values(state.tasks).flatMap((s) => journalNotices(s, tagOf(state, s))), ...viewerNotices(state, nowIso)];
  return all.sort(byTime).slice(-LIMITS.NOTICES_SHOWN);
}

const noticeRow = (n) => row([dim(`[${clock(n.at)}] `), seg(`${n.glyph} `, n.tone), seg(n.text, n.tone)], [n.tag ? dim(n.tag) : null]);

export function noticesSection(ctx) {
  const notices = noticesOf(ctx.state);
  return notices.length ? { name: "notices", rows: notices.map(noticeRow) } : null;
}
