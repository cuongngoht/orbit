// A PROTECTED ACTION, as a viewer says it (0.2.0): which boundary an approval guards and what a person reads before
// deciding -- read off the task journal's own lines (src/task/vocab.mjs `approval-requested`: boundary, destructive,
// shows), with the boundary's title from src/protected/. Never a second table, and never a second pipeline: every line
// is already a task-event every viewer follows. An approval from before 0.2.0 names no boundary and reads as it did.
//
// `protectedEventsOf` names the transitions the way the Protected Boundaries design speaks of them -- each a line the
// journal already holds:
//
//   protected.detected + approval.requested   approval-requested (with a boundary)
//   approval.granted · approval.rejected      a person's decision, in Orbit Control (or a terminal's reject)
//   approval.expired                          a request whose time ran out, recorded
//   approval.consumed                         spent, in the same append that started the action it allowed
//   protected.executing                       that action started
//   protected.completed · protected.failed    how that action ended
import { boundaryOf } from "../protected/boundaries.mjs";

const text = (v) => (typeof v === "string" && v.length > 0 ? v : null);

export const titleOf = (e) => boundaryOf(e?.boundary)?.title ?? null;

// A flag reads as its own name when it is set, and as nothing when it is not: "force", never "false".
const FLAGS = new Map([["true", (key) => key], ["false", () => null]]);

const said = ([key, v]) => (FLAGS.has(v) ? FLAGS.get(v)(key) : text(v));

export const shownOf = (e) => Object.entries(e?.shows && typeof e.shows === "object" ? e.shows : {}).map(said).filter(Boolean).join(" · ");

// One phrase for a protected approval: DESTRUCTIVE first when it is, the boundary's title, what a person reads.
export const protectedSay = (e) => [e?.destructive === true ? "DESTRUCTIVE" : null, titleOf(e), shownOf(e) || null].filter(Boolean).join(" · ");

export const isProtected = (e) => titleOf(e) !== null;

const DECIDED = { "approval-granted": "approval.granted", "approval-rejected": "approval.rejected", "approval-expired": "approval.expired", "approval-consumed": "approval.consumed" };

// How the action an approval allowed ended: completed only when it succeeded.
const endedAs = (e) => (e.kind === "action-completed" && e.outcome === "succeeded" ? "protected.completed" : "protected.failed");

const ENDS = ["action-completed", "action-failed"];

const brief = (asked) => ({ approval: asked.id, boundary: asked.boundary, title: titleOf(asked), destructive: asked.destructive === true, shows: asked.shows ?? null });

// The protected approvals a journal asked for, by id; and which action spent each.
export function protectedFold(events) {
  const asked = new Map(events.filter((e) => e.kind === "approval-requested" && isProtected(e)).map((e) => [e.id, e]));
  const spentBy = new Map(events.filter((e) => e.kind === "approval-consumed" && asked.has(e.id)).map((e) => [e.action, e.id]));
  return { asked, spentBy };
}

const NAMED = [
  { when: (e, f) => e.kind === "approval-requested" && f.asked.has(e.id), names: (e, f) => [["protected.detected", f.asked.get(e.id)], ["approval.requested", f.asked.get(e.id)]] },
  { when: (e, f) => Boolean(DECIDED[e.kind]) && f.asked.has(e.id), names: (e, f) => [[DECIDED[e.kind], f.asked.get(e.id)]] },
  { when: (e, f) => e.kind === "action-started" && f.asked.has(e.approval), names: (e, f) => [["protected.executing", f.asked.get(e.approval)]] },
  { when: (e, f) => ENDS.includes(e.kind) && f.spentBy.has(e.id), names: (e, f) => [[endedAs(e), f.asked.get(f.spentBy.get(e.id))]] },
];

const namedOf = (e, f) => NAMED.find((r) => r.when(e, f))?.names(e, f) ?? [];

// -> [{ n, at, event, approval, boundary, title, destructive, shows, action? }], oldest first.
export function protectedEventsOf(events) {
  const f = protectedFold(events ?? []);
  return (events ?? []).flatMap((e) => namedOf(e, f).map(([event, asked]) => ({ n: e.n ?? null, at: e.at ?? null, event, ...brief(asked), ...(e.kind.startsWith("action-") ? { action: e.id } : {}) })));
}
