// A Server-Sent Events subscription. The browser's EventSource reconnects on its own and sends Last-Event-ID, so a
// durable event is never missed; the caller de-duplicates by sequence number.
export interface Subscription {
  close(): void;
}

const CLOSED_READY_STATE = 2;

export function subscribe<T>(url: string, onData: (data: T) => void, onState?: (open: boolean) => void): Subscription {
  let closed = false;
  const connect = (): EventSource => {
    const es = new EventSource(url, { withCredentials: true });
    es.onmessage = (e: MessageEvent<string>) => {
      try {
        onData(JSON.parse(e.data) as T);
      } catch {
        // A frame that is not JSON is not ours.
      }
    };
    es.onopen = () => onState?.(true);
    es.onerror = () => onState?.(false);
    return es;
  };
  let source = connect();
  const onVisibility = () => {
    if (closed || typeof document === "undefined" || document.visibilityState !== "visible") return;
    if ((source as { readyState?: number }).readyState === CLOSED_READY_STATE) {
      source.close();
      source = connect();
    }
  };
  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", onVisibility);
  }
  return {
    close: () => {
      closed = true;
      if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      source.close();
    },
  };
}
