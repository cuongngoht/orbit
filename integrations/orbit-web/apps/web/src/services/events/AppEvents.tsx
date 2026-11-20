// THE APP STREAM, on the page: one EventSource on `GET /api/events` for the whole signed-in app, and a registry that
// hands each notification to the components that asked for its type. A component never opens a stream of its own for
// these: it calls `useAppEvent(type, handler)`. Notifications are not replayed, so each time the stream (re)opens the
// `generation` moves on and the read models (the sessions, the sources, the customizations) are read again.
import type { AnyAppStreamEvent, AppStreamEvent, AppStreamEventType } from "@orbit-web/contracts";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { subscribe } from "../sse";

type Handler = (event: AnyAppStreamEvent) => void;

interface AppEvents {
  on(type: AppStreamEventType, handler: Handler): () => void;
  connected: boolean;
  // Moves on each time the stream opens: read the read models again.
  generation: number;
}

const NONE: AppEvents = { on: () => () => undefined, connected: false, generation: 0 };

const Context = createContext<AppEvents>(NONE);

export function AppEventsProvider({ children }: { children: ReactNode }) {
  const handlers = useRef(new Map<AppStreamEventType, Set<Handler>>());
  const [connected, setConnected] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const sub = subscribe<AnyAppStreamEvent>(
      "/api/events",
      (event) => {
        for (const handler of handlers.current.get(event.type) ?? []) handler(event);
      },
      (open) => {
        setConnected(open);
        if (open) setGeneration((g) => g + 1);
      },
    );
    return () => sub.close();
  }, []);
  const value = useMemo<AppEvents>(
    () => ({
      on: (type, handler) => {
        const set = handlers.current.get(type) ?? new Set<Handler>();
        set.add(handler);
        handlers.current.set(type, set);
        return () => set.delete(handler);
      },
      connected,
      generation,
    }),
    [connected, generation],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

// Calls `handler` for each app-stream notification of `type` while the component is mounted.
export function useAppEvent<T extends AppStreamEventType>(type: T, handler: (event: AppStreamEvent<T>) => void): void {
  const { on } = useContext(Context);
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => on(type, (e) => latest.current(e as AppStreamEvent<T>)), [on, type]);
}

export const useAppStream = (): { connected: boolean; generation: number } => {
  const { connected, generation } = useContext(Context);
  return { connected, generation };
};
