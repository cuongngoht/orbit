import { useEffect, useReducer, useState } from "react";
import { ApiError } from "../../../shared/api/client";
import { isRecord, numberOf, parsedJson, stringsOf } from "../../../shared/json";
import type { LogStream } from "../../runtime/sandbox.types";
import { missionApi, missionPaths } from "../mission.api";
import type { TaskRef } from "../mission.types";
import type { ConnectionState } from "./live.types";
import { browserStream, CLOSED, type OpenStream, type StreamSource } from "./stream";
import { MAX_FAILURES, POLL_MS } from "./useTaskStream";

// One sandbox log, live: the page reads it from byte 0, then follows it from the offset the server last
// named -- a log is never sent twice, and the server scrubs and places every line before it leaves. The
// page keeps the newest LOG_WINDOW lines; the application's own file keeps the rest.

export const LOG_WINDOW = 2000;

interface LogState {
  lines: string[];
  next: number;
  truncated: boolean;
  connection: ConnectionState;
}

type LogAction = { type: "lines"; lines: readonly string[]; next: number } | { type: "reset" } | { type: "connection"; connection: ConnectionState };

const initial = (): LogState => ({ lines: [], next: 0, truncated: false, connection: "connecting" });

function reducer(state: LogState, action: LogAction): LogState {
  if (action.type === "reset") return { ...initial(), connection: state.connection };
  if (action.type === "connection") return state.connection === action.connection ? state : { ...state, connection: action.connection };
  if (action.next <= state.next && action.lines.length === 0) return state;
  const lines = [...state.lines, ...action.lines];
  return { ...state, lines: lines.slice(-LOG_WINDOW), truncated: state.truncated || lines.length > LOG_WINDOW, next: Math.max(state.next, action.next) };
}

const offsetOf = (id: string) => numberOf(Number(id.replace(/^o=/, ""))) ?? 0;

export function useSandboxLogStream(ref: TaskRef, session: string, stream: LogStream, opts: { openStream?: OpenStream | null } = {}) {
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  // Chosen once per page: a new opener on a render is not a reason to reconnect.
  const [open] = useState(() => (opts.openStream === undefined ? browserStream() : opts.openStream));
  const { key, checkout, task } = ref;
  useEffect(() => {
    const at: TaskRef = { key, checkout, task };
    const run: { next: number; failures: number; stopped: boolean; source: StreamSource | null; poll: number | null } = { next: 0, failures: 0, stopped: false, source: null, poll: null };
    const connection = (c: ConnectionState) => dispatch({ type: "connection", connection: c });
    const got = (lines: readonly string[], next: number) => {
      run.next = Math.max(run.next, next);
      dispatch({ type: "lines", lines, next });
    };
    const polled = async () => {
      try {
        const page = await missionApi.sandboxLogPage(at, session, stream, run.next);
        if (run.stopped) return;
        if (page.reset) {
          run.next = 0;
          dispatch({ type: "reset" });
          return;
        }
        got(page.lines, page.next);
      } catch (e) {
        if (!run.stopped && e instanceof ApiError && e.status === 0) connection("offline");
      }
    };
    const degraded = () => {
      run.source?.close();
      run.source = null;
      connection("degraded");
      if (run.poll === null) run.poll = window.setInterval(() => void polled(), POLL_MS);
    };
    const opened = () => {
      if (open === null) return degraded();
      const source = open(missionPaths.logStream(at, session, stream, run.next));
      run.source = source;
      source.addEventListener("open", () => {
        run.failures = 0;
        connection("live");
      });
      source.addEventListener("log", (event) => {
        const data = event instanceof MessageEvent && typeof event.data === "string" ? parsedJson(event.data) : null;
        if (!isRecord(data) || run.stopped) return;
        connection("live");
        got(stringsOf(data.lines), numberOf(data.next) ?? (event instanceof MessageEvent ? offsetOf(event.lastEventId) : run.next));
      });
      source.addEventListener("log-reset", () => {
        run.next = 0;
        dispatch({ type: "reset" });
      });
      source.addEventListener("end", () => degraded());
      source.addEventListener("error", () => {
        if (run.stopped || run.source !== source) return;
        run.failures += 1;
        if (source.readyState === CLOSED || run.failures >= MAX_FAILURES) return degraded();
        connection("reconnecting");
      });
    };
    void (async () => {
      await polled();
      if (!run.stopped) opened();
    })();
    return () => {
      run.stopped = true;
      run.source?.close();
      if (run.poll !== null) window.clearInterval(run.poll);
    };
  }, [key, checkout, task, session, stream, open]);
  return state;
}
