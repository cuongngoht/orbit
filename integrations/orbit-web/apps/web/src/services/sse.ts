// A Server-Sent Events subscription. The browser's EventSource reconnects on its own and sends Last-Event-ID, so a
// durable event is never missed; the caller de-duplicates by sequence number.
export interface Subscription {
  close(): void;
}

export function subscribe<T>(url: string, onData: (data: T) => void, onState?: (open: boolean) => void): Subscription {
  const source = new EventSource(url, { withCredentials: true });
  source.onmessage = (e: MessageEvent<string>) => {
    try {
      onData(JSON.parse(e.data) as T);
    } catch {
      // A frame that is not JSON is not ours.
    }
  };
  source.onopen = () => onState?.(true);
  source.onerror = () => onState?.(false);
  return { close: () => source.close() };
}
