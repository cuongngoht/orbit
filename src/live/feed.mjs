// ONE TASK, LIVE: its journal's lines, the task as of now, and the QA activity of every investigation begun
// against it -- in order, resumable from a cursor, and the same answer whether a viewer follows it or asks
// for it once. Orbit Control streams it as Server-Sent Events, a terminal paints it, the status line asks
// once and exits; all three are this feed (ADR 0016).
//
//   openFeed(deps, opened, cursor)    -> { start(sink), tick(), close(), cursor() }
//   collectFeed(deps, opened, cursor) -> { version, task, cursor, terminal, view, events }
//
//   deps   { io, followers, task: <task source>, qa: <qa source>, activity?: <activity source>, plan?: <plan source>,
//            skill?: <skill source> }
//   opened { taskCtx: { tasks, checkoutSummary, now }, task, createdAt, qa: <investigation store>, activity?: { fileOf },
//            plans?: { read(task, ref) }, skills?: { read(pin) } }
//   sink   { send({ event, id, data }) -> bool, end(), closed }
//
// What a sink receives, in order:
//   task-event     one journal line, as the journal kept it
//   qa-event       one investigation line, as allow-listed activity
//   task-view      the whole task, when what a person watches moved (the task source's fingerprint)
//   activity-view  one check action's OBSERVATION, whole and bounded, when what it says moved (1.8.5, ADR 0020):
//                  { source: "activity", task, action, revision, view } -- a projection a viewer REPLACES, so a
//                  reconnect is never a duplicate and the cursor needs no part of its own
//   plan-view      a coordinated workflow's ACTIVE plan (1.8.6, ADR 0022): { source: "plan", task, ref, revision, view }
//                  -- sent when the plan receipt names another artifact, the projection its source made; a viewer
//                  REPLACES it, so it needs no part of the cursor either
//   skill-view     a declared playbook's WORKFLOW (0.0.4): { source: "skill", task, pin, view } -- sent once for each pin
//                  a run of the task holds, the projection the skill source made; where each of its steps stands is
//                  the task's own receipts, so it needs no part of the cursor
//   end            the task ended (and every line was sent), or its journal could not be followed
// and every event's id is the cursor AFTER it, so a viewer that drops comes back exactly there.
//
// Investigations are found by reading (the qa source's investigationsOf): when the feed starts, on every
// tick while the task runs, and at once when the task moves a stage, starts an action or links one. The
// observations followed are those of the task's check actions its view names (the activity source's
// observedOf), found the same way; a task with none -- one older than 1.8.5 -- sends none. Before the end of a
// task is sent, every observation is read once more, so a check's last cases arrive before delivery stops.
// Nothing here writes: a feed is one more reader of the journals.
import { formatCursor } from "./cursor.mjs";
import { activitySubject, investigationSubject, taskSubject } from "./subjects.mjs";

const linked = (e) => e.kind === "receipt" && e.domain === "investigation";
const DISCOVER_ON = (e) => e.kind === "stage" || e.kind === "action-started" || linked(e);

export function openFeed(deps, opened, cursor) {
  const s = stateOf(deps, opened, cursor);
  return { start: (sink) => started(s, sink), tick: () => ticked(s), close: () => closed(s), cursor: () => formatCursor(s.cursor) };
}

function stateOf(deps, opened, cursor) {
  const lease = deps.followers.acquire(`task:${opened.taskCtx.tasks.journalFile(opened.task)}`, () => taskSubject(deps.task, deps.io, opened.taskCtx, opened.task));
  return { ...opened, deps, cursor, lease, inv: new Map(), known: new Map(), acts: new Map(), actPrints: new Map(), activity: opened.activity ?? null, plans: opened.plans ?? null, planRef: null, skills: opened.skills ?? null, skillPins: new Set(), since: sinceOf(deps.qa, opened.createdAt), print: null, terminal: false, sink: null, closed: false };
}

// A minute of slack: the task's clock is its store's, an investigation's id is its own process's.
const sinceOf = (qa, iso) => (iso ? qa.stampOf(new Date(Date.parse(iso) - 60_000).toISOString()) : null);

// ---- starting ----------------------------------------------------------------------------------

function started(s, sink) {
  s.sink = sink;
  s.lease.refresh();
  const fresh = discovered(s, s.lease.subject.follower.items.map((it) => it.record));
  inOrder([taskReplay(s), ...fresh.map((id) => invReplay(s, id))]).forEach((e) => sentEvent(s, e));
  listening(s, fresh);
}

function listening(s, fresh) {
  viewedNow(s);
  s.lease.listen((batch) => taskBatch(s, batch));
  fresh.forEach((id) => invListened(s, id));
  endIfTerminal(s);
}

const taskReplay = (s) => s.lease.subject.follower.items.filter((it) => it.n >= s.cursor.task).map((it) => s.deps.task.liveEvent(it.n, it.record));

const invReplay = (s, id) => s.inv.get(id).subject.replay(s.cursor.inv.get(id) ?? 0);

// The sources merged by time, each kept in its OWN order: a line's key is the latest time its source
// had reached, so a clock that stepped back never reorders one journal, and a stable sort does the rest.
function inOrder(lists) {
  return lists.flatMap(monotone).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((k) => k.e);
}

function monotone(list) {
  const seen = { key: "" };
  return list.map((e) => ({ e, key: (seen.key = String(e.at ?? "") > seen.key ? String(e.at ?? "") : seen.key) }));
}

// ---- following ---------------------------------------------------------------------------------

function taskBatch(s, batch) {
  if (batch.reset || batch.error) return ended(s, batch.reset ? "reset" : "error");
  batch.events.filter((e) => e.n >= s.cursor.task).forEach((e) => sentEvent(s, e));
  if (batch.events.some(DISCOVER_ON)) joined(s, discovered(s, batch.events));
  viewedNow(s);
  endIfTerminal(s);
}

// An investigation that can no longer be read says nothing more; the task goes on.
function invBatch(s, id, batch) {
  if (batch.reset || batch.error) return;
  batch.events.filter((e) => e.n >= (s.cursor.inv.get(id) ?? 0)).forEach((e) => sentEvent(s, e));
}

// The tick: an approval may have expired with no line written, and an investigation may have begun.
function ticked(s) {
  if (s.closed || s.sink === null) return;
  viewedNow(s);
  joined(s, discovered(s, []));
  endIfTerminal(s);
}

// ---- investigations ----------------------------------------------------------------------------

// The ids newly found, each acquired (and polled) but not yet listened to.
function discovered(s, records) {
  const claimed = records.filter(linked).map((r) => r.ref);
  const ids = s.deps.qa.investigationsOf(s.qa, { task: s.task, since: s.since, known: s.known, claimed });
  return ids.filter((id) => !s.inv.has(id)).filter((id) => acquiredInv(s, id));
}

function acquiredInv(s, id) {
  if (s.inv.size >= s.deps.qa.MAX_FOLLOWED) return false;
  const lease = s.deps.followers.acquire(`inv:${s.qa.journalFile(id)}`, () => investigationSubject(s.deps.qa, s.deps.io, s.qa, id));
  s.inv.set(id, lease);
  lease.refresh();
  return true;
}

function joined(s, ids) {
  for (const id of ids) invReplay(s, id).forEach((e) => sentEvent(s, e));
  ids.forEach((id) => invListened(s, id));
}

const invListened = (s, id) => s.inv.get(id).listen((batch) => invBatch(s, id, batch));

// ---- sending -----------------------------------------------------------------------------------

function sentEvent(s, e) {
  advanced(s.cursor, e);
  s.sink.send({ event: e.source === "task" ? "task-event" : "qa-event", id: formatCursor(s.cursor), data: e });
}

function advanced(cursor, e) {
  if (e.source === "task") return Object.assign(cursor, { task: Math.max(cursor.task, e.n + 1) });
  cursor.inv.set(e.source, Math.max(cursor.inv.get(e.source) ?? 0, e.n + 1));
}

function viewSent(s) {
  const view = s.lease.subject.live.viewOf(s.taskCtx.now());
  s.terminal = view.terminal;
  if (s.deps.task.fingerprintOf(view) !== s.print) viewOut(s, view);
}

function viewOut(s, view) {
  s.print = s.deps.task.fingerprintOf(view);
  s.sink.send({ event: "task-view", id: formatCursor(s.cursor), data: { source: "task", revision: view.revision, view } });
}

// The task as of now, the observations its view names that are not followed yet, and its active plan.
function viewedNow(s) {
  viewSent(s);
  observedJoined(s);
  planSent(s);
  skillsSent(s);
}

// Before the end goes out, every observation is read once more: a check's last cases come before it.
function endIfTerminal(s) {
  if (!s.terminal) return;
  [...s.acts.keys()].forEach((id) => actRead(s, id));
  ended(s, "terminal");
}

function ended(s, reason) {
  s.sink.send({ event: "end", id: formatCursor(s.cursor), data: { source: "task", reason } });
  s.sink.end();
}

function closed(s) {
  s.closed = true;
  s.lease.release();
  [...s.inv.values(), ...s.acts.values()].forEach((lease) => lease.release());
}

// ---- observations (1.8.5, ADR 0020) ---------------------------------------------------------------------

function observedJoined(s) {
  if (!s.deps.activity || !s.activity) return;
  const view = s.lease.subject.live.viewOf(s.taskCtx.now());
  s.deps.activity.observedOf(view).filter((id) => !s.acts.has(id)).forEach((id) => actJoined(s, id));
}

// One follower per observation file however many viewers watch it, as for a journal; this viewer is sent the
// projection as it stands, then whatever moves it.
function actJoined(s, id) {
  const file = s.activity.fileOf(s.task, id);
  const lease = s.deps.followers.acquire(`act:${file}`, () => activitySubject(s.deps.activity, s.deps.io, file));
  s.acts.set(id, lease);
  actRead(s, id);
  lease.listen(() => actSent(s, id));
}

function actRead(s, id) {
  s.acts.get(id).refresh();
  actSent(s, id);
}

const actPrint = (s, view) => `${s.deps.activity.fingerprintOf(view)}|${view.resets}`;

// Sent when what it says moved -- never before its file had a line, never twice the same.
function actSent(s, id) {
  const view = s.acts.get(id).subject.view();
  if (view.seq < 0 || actPrint(s, view) === s.actPrints.get(id)) return;
  s.actPrints.set(id, actPrint(s, view));
  s.sink.send({ event: "activity-view", id: formatCursor(s.cursor), data: { source: "activity", task: s.task, action: id, revision: view.seq, view } });
}

// ---- a coordinated workflow's plan (1.8.6, ADR 0022) ------------------------------------------------------------

// Sent once per artifact: when the ACTIVE plan receipt names a digest this viewer was not sent yet. An artifact its
// source cannot read is not sent at all -- a viewer then draws the steps its receipts name.
function planSent(s) {
  if (!s.deps.plan || !s.plans) return;
  const ref = s.deps.plan.activeRef(s.lease.subject.live.viewOf(s.taskCtx.now()));
  if (ref && ref !== s.planRef) planOut(s, ref);
}

function planOut(s, ref) {
  s.planRef = ref;
  const view = s.plans.read(s.task, ref);
  if (view) s.sink.send({ event: "plan-view", id: formatCursor(s.cursor), data: { source: "plan", task: s.task, ref, revision: view.n, view } });
}

// ---- a declared playbook's workflow (0.0.4) ----------------------------------------------------------------

// Sent once per pin a run of this task holds. A version its source cannot read is not sent: a viewer then draws the
// steps the run's own receipts name, and says the workflow could not be read.
function skillsSent(s) {
  if (!s.deps.skill || !s.skills) return;
  const pins = s.deps.skill.activeRefs(s.lease.subject.live.viewOf(s.taskCtx.now())).filter((p) => !s.skillPins.has(p));
  pins.forEach((pin) => skillOut(s, pin));
}

function skillOut(s, pin) {
  s.skillPins.add(pin);
  const view = s.skills.read(pin);
  if (view) s.sink.send({ event: "skill-view", id: formatCursor(s.cursor), data: { source: "skill", task: s.task, pin, view } });
}

// ---- the plain read ----------------------------------------------------------------------------

// The same replay a feed starts with, collected instead of sent: what a page paints first, what a finished
// task is replayed from, what a page polls when a stream cannot be kept open, and the status line's one read.
export function collectFeed(deps, opened, cursor) {
  const feed = openFeed(deps, opened, cursor);
  const sink = collector();
  feed.start(sink);
  feed.close();
  return answered(deps, opened.task, feed.cursor(), sink.frames);
}

// Each pinned workflow sent, by its pin (0.0.4).
export const skillViewsOf = (frames) => Object.fromEntries(frames.filter((f) => f.event === "skill-view").map((f) => [f.data.pin, f.data.view]));

const collector = () => ((frames) => ({ frames, send: (f) => frames.push(f) > 0, end: () => {}, closed: false }))([]);

function answered(deps, task, cursor, frames) {
  const view = frames.findLast((f) => f.event === "task-view")?.data.view ?? null;
  const events = frames.filter((f) => f.event === "task-event" || f.event === "qa-event").map((f) => f.data);
  const activity = Object.fromEntries(frames.filter((f) => f.event === "activity-view").map((f) => [f.data.action, f.data.view]));
  const plan = frames.findLast((f) => f.event === "plan-view")?.data.view ?? null;
  return { version: deps.task.version, task, cursor, terminal: view?.terminal ?? false, view, events, activity, plan, skills: skillViewsOf(frames) };
}
