// READ MODELS KEPT CURRENT BY THE APP STREAM: each is read once (and again whenever the stream reopens -- nothing is
// replayed), then updated from the notifications that concern it. No polling.
import type { ConnectorName, Customizations, SessionSummary, SourcesStatus } from "@orbit-web/contracts";
import { useCallback, useMemo, useState } from "react";
import { useAppEvent, useAppStream } from "../services/events/AppEvents";
import { get } from "../services/api";
import { useResource, type Resource } from "./useResource";

const byRecent = (a: SessionSummary, b: SessionSummary) => b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt);

export interface Sessions {
  sessions: SessionSummary[];
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  // A chat the page itself just created or changed, shown at once (its notification follows).
  upsert: (s: SessionSummary) => void;
  remove: (id: string) => void;
}

// The chats, newest first: `GET /api/sessions`, then `session.summary` / `session.removed` laid over it (an update
// counts unless what was read is newer; a removal always counts).
export function useSessions(): Sessions {
  const { generation } = useAppStream();
  const read = useResource<SessionSummary[]>(() => get("/api/sessions"), [generation]);
  const [updates, setUpdates] = useState<Map<string, SessionSummary | null>>(() => new Map());
  const upsert = useCallback((s: SessionSummary) => setUpdates((m) => new Map(m).set(s.id, s)), []);
  const remove = useCallback((id: string) => setUpdates((m) => new Map(m).set(id, null)), []);
  useAppEvent("session.summary", (e) => upsert(e.data.session));
  useAppEvent("session.removed", (e) => remove(e.data.sessionId));
  const sessions = useMemo(() => {
    const byId = new Map((read.data ?? []).map((s) => [s.id, s]));
    for (const [id, update] of updates) {
      const base = byId.get(id);
      if (update === null) byId.delete(id);
      else if (base === undefined || update.updatedAt >= base.updatedAt) byId.set(id, update);
    }
    return [...byId.values()].sort(byRecent);
  }, [read.data, updates]);
  return { sessions, loading: read.loading && read.data === null, error: read.error, errorCode: read.errorCode, upsert, remove };
}

// Which repository sources can list repositories now: `GET /api/sources`, then `connector.status`.
export function useSources(): Resource<SourcesStatus> {
  const { generation } = useAppStream();
  const read = useResource<SourcesStatus>(() => get("/api/sources"), [generation]);
  const { set } = read;
  const current = read.data;
  useAppEvent("connector.status", (e) => {
    const { connector, state, account } = e.data;
    if (current) set({ sources: current.sources.map((s) => (s.source === connector ? { ...s, state, account } : s)) });
  });
  return read;
}

export const isConnected = (sources: SourcesStatus | null, source: ConnectorName): boolean => sources?.sources.some((s) => s.source === source && s.state === "connected") === true;

// What Claude Code is given (Orbit's own skills and agents, each project's): read again when one changes.
export function useCustomizations(): Resource<Customizations> {
  const { generation } = useAppStream();
  const [changed, setChanged] = useState(0);
  useAppEvent("customizations.changed", () => setChanged((n) => n + 1));
  return useResource<Customizations>(() => get("/api/customizations"), [generation, changed]);
}
