// Envelopes as the API's two streams send them, pushed into the EventSource the page opened -- for the web app's tests.
import { act } from "@testing-library/react";
import { FakeEventSource } from "./fakeEventSource";

let next = 0;
const eventId = () => `ev-${++next}`;

// A notification on the app stream (`GET /api/events`): never stored, so no sequence number.
export function pushApp(type: string, data: unknown): void {
  act(() => FakeEventSource.last("/api/events").emit({ id: eventId(), type, stream: "app", sessionId: null, seq: null, runId: null, at: "2026-11-20T00:00:00.000Z", data }));
}

// Events on one chat's stream, numbered as the journal numbers them (a transient one has no number).
export function sessionStream(sessionId: string): (type: string, data: unknown, durable?: boolean) => void {
  let seq = 0;
  return (type, data, durable = true) =>
    act(() => FakeEventSource.last(`/api/sessions/${sessionId}/events`).emit({ id: eventId(), type, stream: "session", sessionId, seq: durable ? ++seq : null, runId: "r1", at: "2026-11-20T00:00:00.000Z", data }));
}
