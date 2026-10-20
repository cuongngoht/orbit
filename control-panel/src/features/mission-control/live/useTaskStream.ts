import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { MISSION_REFRESH_MS, missionApi, missionKeys, missionPaths } from "../mission.api";
import type { TaskRef, TaskResponse, TaskView } from "../mission.types";
import { initialLive, liveReducer, type LiveAction } from "./live.reducer";
import type { ConnectionState, LiveEvent, LiveState } from "./live.types";
import { observationsOf, type Observation } from "./observation";
import { browserStream, CLOSED, FRAME_NAMES, frameOf, type Frame, type OpenStream, type StreamSource } from "./stream";

// A task, live. The page paints what the journal holds (`/activity`), then opens ONE stream from that
// cursor, and every line after arrives as it is written. What can go wrong is said, never hidden:
//
//   connecting   -> live            the stream opened, or its first event arrived
//   live         -> reconnecting    an error, or a silence longer than WATCHDOG_MS (a heartbeat comes every 15 s)
//   reconnecting -> live            the browser reconnected (it sends the last id it saw, so nothing is skipped)
//   reconnecting -> degraded        MAX_FAILURES in a row, or the browser gave up: read every POLL_MS instead,
//                                   from the cursor, and try the stream again every SSE_RETRY_MS
//   degraded     -> offline         Control cannot be reached at all; reading goes on
//   any          -> finished        the task ended: the server said `end`, and the stream is closed
//
// A task that had ended before the page opened is a REPLAY: read once, and no stream is opened.

export const HEARTBEAT_MS = 15_000;
export const WATCHDOG_MS = 2 * HEARTBEAT_MS;
export const BATCH_MS = 100;
export const MAX_FAILURES = 3;
export const POLL_MS = MISSION_REFRESH_MS;
export const SSE_RETRY_MS = 30_000;

interface Wiring {
  ref: TaskRef;
  open: OpenStream | null;
  dispatch: (action: LiveAction) => void;
  viewed: (view: TaskView) => void;
  labels: () => ReadonlyMap<string, string>;
}

interface Run {
  cursor: string | null;
  failures: number;
  source: StreamSource | null;
  lines: LiveEvent[];
  observations: Observation[];
  view: TaskView | null;
  batch: number | null;
  watchdog: number | null;
  poll: number | null;
  retry: number | null;
  stopped: boolean;
  connection: ConnectionState;
}

const labelsOf = (view: TaskView | null): ReadonlyMap<string, string> => new Map((view?.actions ?? []).map((a) => [a.id, a.label ?? a.type]));

export function useTaskStream(ref: TaskRef, opts: { openStream?: OpenStream | null } = {}) {
  const [state, dispatch] = useReducer(liveReducer, undefined, initialLive);
  const client = useQueryClient();
  const labels = useRef<ReadonlyMap<string, string>>(new Map());
  // Chosen once per page: a new opener on a render is not a reason to reconnect.
  const [open] = useState(() => (opts.openStream === undefined ? browserStream() : opts.openStream));
  const { key, checkout, task } = ref;
  useEffect(() => {
    const at: TaskRef = { key, checkout, task };
    const viewed = (view: TaskView) => {
      labels.current = labelsOf(view);
      client.setQueryData<TaskResponse>(missionKeys.task(at), (old) => (old === undefined || old.task.revision <= view.revision ? { task: view } : old));
    };
    return started({ ref: at, open, dispatch, viewed, labels: () => labels.current });
  }, [key, checkout, task, client, open]);
  const follow = useCallback(() => dispatch({ type: "followed" }), []);
  const unfollow = useCallback(() => dispatch({ type: "unfollowed" }), []);
  const loadEarlier = useCallback(async () => {
    const all = await missionApi.activity({ key, checkout, task }, null);
    dispatch({ type: "loadedEarlier", events: all.events, cursor: all.cursor, labels: labels.current });
  }, [key, checkout, task]);
  const live: { state: LiveState; follow: () => void; unfollow: () => void; loadEarlier: () => Promise<void> } = { state, follow, unfollow, loadEarlier };
  return live;
}

/** Whether a live stream covers the task, so nothing else need read it on a timer. */
export const covers = (connection: ConnectionState) => connection === "live" || connection === "finished";

// ---- the run: one page's connection, from mount to unmount --------------------------------------------

function started(w: Wiring): () => void {
  const run: Run = { cursor: null, failures: 0, source: null, lines: [], observations: [], view: null, batch: null, watchdog: null, poll: null, retry: null, stopped: false, connection: "connecting" };
  void first(w, run);
  return () => stopped(run);
}

function connection(w: Wiring, run: Run, next: ConnectionState) {
  run.connection = next;
  w.dispatch({ type: "connection", connection: next });
}

async function first(w: Wiring, run: Run) {
  try {
    const answer = await missionApi.activity(w.ref, null);
    if (run.stopped) return;
    applied(w, run, answer.events, answer.cursor, answer.view);
    w.dispatch({ type: "observed", observations: observationsOf(answer.activity) });
    if (answer.terminal) return replayed(w, run);
    opened(w, run);
  } catch {
    if (!run.stopped) degraded(w, run);
  }
}

function applied(w: Wiring, run: Run, events: readonly LiveEvent[], cursor: string | null, view: TaskView | null) {
  if (cursor !== null) run.cursor = cursor;
  if (view) w.viewed(view);
  w.dispatch({ type: "received", events, cursor, labels: w.labels() });
  if (view) w.dispatch({ type: "viewed", view });
}

function replayed(w: Wiring, run: Run) {
  w.dispatch({ type: "replay" });
  stopped(run);
}

function opened(w: Wiring, run: Run) {
  if (w.open === null) return degraded(w, run);
  const source = w.open(missionPaths.stream(w.ref, run.cursor));
  run.source = source;
  source.addEventListener("open", () => alive(w, run));
  source.addEventListener("error", () => failed(w, run, source));
  for (const name of FRAME_NAMES) source.addEventListener(name, (event) => framed(w, run, frameOf(name, event)));
  armed(w, run);
}

function alive(w: Wiring, run: Run) {
  run.failures = 0;
  if (run.connection !== "live") connection(w, run, "live");
  armed(w, run);
}

// A stream that says nothing for twice a heartbeat is not trusted to be alive: a socket can stay open
// with nobody on the other end, and the browser would never call that an error.
function armed(w: Wiring, run: Run) {
  if (run.watchdog !== null) window.clearTimeout(run.watchdog);
  run.watchdog = window.setTimeout(() => silent(w, run), WATCHDOG_MS);
}

function silent(w: Wiring, run: Run) {
  run.source?.close();
  run.source = null;
  run.failures += 1;
  if (run.failures >= MAX_FAILURES) return degraded(w, run);
  connection(w, run, "reconnecting");
  opened(w, run);
}

function failed(w: Wiring, run: Run, source: StreamSource) {
  if (run.stopped || run.source !== source) return;
  run.failures += 1;
  if (source.readyState === CLOSED || run.failures >= MAX_FAILURES) return degraded(w, run);
  connection(w, run, "reconnecting");
}

function framed(w: Wiring, run: Run, frame: Frame | null) {
  if (run.stopped || frame === null) return;
  alive(w, run);
  if (frame.type === "line") return buffered(w, run, frame.event, frame.id, null);
  if (frame.type === "view") return buffered(w, run, null, frame.id, frame.view);
  if (frame.type === "activity") return observed(w, run, frame.observation);
  if (frame.type === "end") return ended(w, run, frame.reason);
}

// Lines that arrive together are drawn together: a burst of a hundred lines is one render, not a hundred.
function buffered(w: Wiring, run: Run, line: LiveEvent | null, id: string | null, view: TaskView | null) {
  if (line) run.lines.push(line);
  if (view) run.view = view;
  if (id) run.cursor = id;
  if (run.batch === null) run.batch = window.setTimeout(() => flushed(w, run), BATCH_MS);
}

// A check's observation is drawn with the lines that arrive with it: one render for a burst of both.
function observed(w: Wiring, run: Run, observation: Observation) {
  run.observations.push(observation);
  if (run.batch === null) run.batch = window.setTimeout(() => flushed(w, run), BATCH_MS);
}

function flushed(w: Wiring, run: Run) {
  const lines = run.lines;
  const view = run.view;
  const observations = run.observations;
  Object.assign(run, { lines: [], observations: [], view: null, batch: null });
  applied(w, run, lines, run.cursor, view);
  if (observations.length > 0) w.dispatch({ type: "observed", observations });
}

function ended(w: Wiring, run: Run, reason: string) {
  if (run.batch !== null) window.clearTimeout(run.batch);
  flushed(w, run);
  if (reason === "terminal") return finished(w, run);
  run.source?.close();
  run.source = null;
  return reason === "reset" ? restarted(w, run) : degraded(w, run);
}

function finished(w: Wiring, run: Run) {
  connection(w, run, "finished");
  stopped(run);
}

// The journal the page was reading was begun again: nothing it holds can be trusted to be the same lines.
function restarted(w: Wiring, run: Run) {
  run.cursor = null;
  w.dispatch({ type: "reset" });
  void first(w, run);
}

// ---- when a stream cannot be kept open: read, and say so ----------------------------------------------

function degraded(w: Wiring, run: Run) {
  run.source?.close();
  run.source = null;
  if (run.watchdog !== null) window.clearTimeout(run.watchdog);
  connection(w, run, "degraded");
  if (run.poll === null) run.poll = window.setInterval(() => void polled(w, run), POLL_MS);
  if (run.retry === null && w.open !== null) run.retry = window.setInterval(() => retried(w, run), SSE_RETRY_MS);
}

async function polled(w: Wiring, run: Run) {
  try {
    const answer = await missionApi.activity(w.ref, run.cursor);
    if (run.stopped) return;
    applied(w, run, answer.events, answer.cursor, answer.view);
    w.dispatch({ type: "observed", observations: observationsOf(answer.activity) });
    if (answer.terminal) return finished(w, run);
    if (run.connection === "offline") connection(w, run, "degraded");
  } catch (e) {
    if (!run.stopped && e instanceof ApiError && e.status === 0) connection(w, run, "offline");
  }
}

function retried(w: Wiring, run: Run) {
  if (run.stopped) return;
  cleared(run);
  run.failures = 0;
  connection(w, run, "connecting");
  opened(w, run);
}

function cleared(run: Run) {
  for (const timer of [run.poll, run.retry]) if (timer !== null) window.clearInterval(timer);
  run.poll = null;
  run.retry = null;
}

function stopped(run: Run) {
  run.stopped = true;
  run.source?.close();
  run.source = null;
  for (const timer of [run.batch, run.watchdog]) if (timer !== null) window.clearTimeout(timer);
  cleared(run);
}
