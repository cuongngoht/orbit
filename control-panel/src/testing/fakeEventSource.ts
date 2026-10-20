import type { StreamSource } from "../features/mission-control/live/stream";
import { required } from "./required";

// EventSource, controllable: jsdom has none, and a test needs to say exactly when a stream opens, what it
// sends, when it fails and whether the page closed it. Installed with vi.stubGlobal("EventSource", ...),
// so the page's own `browserStream()` is the path under test.
export class FakeEventSource implements StreamSource {
  static instances: FakeEventSource[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly url: string;
  readyState = 0;
  closed = false;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  /** The server accepted the stream. */
  open() {
    this.readyState = 1;
    this.fire("open", new Event("open"));
  }

  /** One named server event; `id` is the cursor the server put on it. */
  emit(name: string, data: unknown, id?: string) {
    this.fire(name, new MessageEvent(name, { data: JSON.stringify(data), lastEventId: id ?? "" }));
  }

  /** A failure; `closed` is the browser giving up on this stream for good. */
  error(closed = false) {
    if (closed) this.readyState = 2;
    this.fire("error", new Event("error"));
  }

  private fire(type: string, event: Event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  static reset() {
    FakeEventSource.instances = [];
  }

  static last(): FakeEventSource {
    return required(FakeEventSource.instances.at(-1), "an open stream");
  }
}
