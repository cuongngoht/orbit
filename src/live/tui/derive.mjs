// What one frame is drawn from: the snapshot of each followed task (src/live/snapshot.mjs -- the same picture a
// status line and `watch` draw), taken once per task per second. A slot is a new object whenever a feed moved
// it, so a snapshot is kept beside the slot it was made from and made again only when the slot or the second
// changed: a quiet task costs nothing to draw again.
//
//   derivedOf(state) -> { root, child, focus, engineering }      each a snapshot, or null
import { snapshotOf } from "../snapshot.mjs";
import { childOf, engineeringId, focusId } from "./model.mjs";

const MEMO = new WeakMap();

const idleOf = (state) => (state.viewer.settings?.idleAfterSec ?? 120) * 1000;

const pictured = (state, slot) => snapshotOf({ association: state.association, collected: slot.view ? { view: slot.view, cursor: slot.cursor } : null, events: slot.events, read: slot.read, nowMs: state.viewer.nowMs, idleAfterMs: idleOf(state), activity: slot.activity ?? {}, plan: slot.plan ?? null });

function pictureOf(state, slot) {
  const key = Math.floor(state.viewer.nowMs / 1000);
  const hit = slot ? MEMO.get(slot) : null;
  if (!slot || (hit && hit.key === key && hit.association === state.association)) return hit?.pic ?? null;
  MEMO.set(slot, { key, association: state.association, pic: pictured(state, slot) });
  return MEMO.get(slot).pic;
}

const of = (state, id) => (id ? pictureOf(state, state.tasks[id]) : null);

const tasksOf = (state) => ({ root: of(state, state.root), child: of(state, childOf(state)), focus: of(state, focusId(state)), engineering: of(state, engineeringId(state)), engineeringId: engineeringId(state), childId: childOf(state) });

// A task a person did not pick that has STOPPED (blocked, paused, waiting on a person), has written nothing lately, and
// that this session's own tools have since moved past, is not what the session is doing: a /orbit-help that went the
// developer's way starts no task, and the stopped one would otherwise stay on show, still, for as long as it is kept.
// Then the viewer draws the session's own activity (src/live/session.mjs), as it does when there is no task at all.
const PICKED = new Set(["explicit", "pin"]);

const STOPPED = new Set(["BLOCKED", "PAUSED", "WAITING_APPROVAL"]);

const msOf = (at) => Date.parse(at) || 0;

const stateOf = (snap) => snap?.presentation?.state ?? null;

const stopped = (snap) => STOPPED.has(snap?.view?.lifecycle) && stateOf(snap) === "IDLE";

const movedPast = (snap, session) => session?.state === "ACTIVE" && msOf(session.lastAt) > msOf(snap.presentation.lastActivityAt);

const handedOver = (state, d) => ((snap) => Boolean(snap) && !PICKED.has(state.association.how) && stopped(snap) && stateOf(d.child) !== "LIVE" && movedPast(snap, state.session))(d.root ?? d.focus);

// The state a frame is drawn from: with no root, every section that reads the followed task straight off the state
// (RECENT, NOTICES, the header) finds none, as the snapshots do: the stopped task's slots are not drawn from.
export const yielded = (state) => (handedOver(state, tasksOf(state)) ? { ...state, root: null, focus: "root", tasks: {} } : state);

export const derivedOf = (state) => tasksOf(yielded(state));
