// An EventSource a test drives: each one opened is kept by URL, and the test pushes events into it.
export class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((e: MessageEvent<string>) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }

  static reset(): void {
    FakeEventSource.instances = [];
  }

  static last(urlPart: string): FakeEventSource {
    const found = [...FakeEventSource.instances].reverse().find((s) => s.url.includes(urlPart) && !s.closed);
    if (!found) throw new Error(`no open EventSource for ${urlPart}`);
    return found;
  }

  emit(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }

  close(): void {
    this.closed = true;
  }
}
