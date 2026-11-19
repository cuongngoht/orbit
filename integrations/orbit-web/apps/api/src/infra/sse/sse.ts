// Server-Sent Events over a plain Express response. A durable event is sent with `id: <seq>` so the browser's
// EventSource resumes after it with Last-Event-ID; a transient one is sent without an id, which leaves the browser's
// last id unchanged. A comment line every few seconds keeps proxies from closing an idle stream.
import type { Request, Response } from "express";

export interface SseChannel {
  send(payload: unknown, id?: number | null): void;
  close(): void;
  readonly closed: boolean;
}

export const HEARTBEAT_MS = 15_000;

export function openSse(req: Request, res: Response, onClose: () => void, heartbeatMs = HEARTBEAT_MS): SseChannel {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write("retry: 2000\n\n");
  let closed = false;
  const timer = setInterval(() => res.write(": keep-alive\n\n"), heartbeatMs);
  timer.unref();
  const finish = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    onClose();
  };
  req.on("close", finish);
  return {
    send(payload: unknown, id?: number | null) {
      if (closed) return;
      const idLine = typeof id === "number" ? `id: ${id}\n` : "";
      res.write(`${idLine}data: ${JSON.stringify(payload)}\n\n`);
    },
    close() {
      finish();
      res.end();
    },
    get closed() {
      return closed;
    },
  };
}

// The sequence a reconnecting client already holds: the Last-Event-ID header, else an `after` query value.
export function resumeAfter(req: Request): number {
  const raw = req.headers["last-event-id"] ?? (typeof req.query.after === "string" ? req.query.after : undefined);
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}
