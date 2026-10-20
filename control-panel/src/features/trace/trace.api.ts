import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { TurnResponse, TurnsResponse, UsageResponse } from "./trace.types";

// The session trail's three reads. All GETs: the trail is written by the hooks
// and only ever read here.
export const traceApi = {
  turns: (days: number) => api.get<TurnsResponse>(`/api/v1/trace/turns?days=${days}`),
  turn: (id: string) => api.get<TurnResponse>(`/api/v1/trace/turns/${encodeURIComponent(id)}`),
  usage: (days: number) => api.get<UsageResponse>(`/api/v1/analytics/usage?days=${days}`),
};

export const traceKeys = {
  all: ["trace"] as const,
  turns: (days: number) => [...traceKeys.all, "turns", days] as const,
  turn: (id: string) => [...traceKeys.all, "turn", id] as const,
  usage: (days: number) => [...traceKeys.all, "usage", days] as const,
};

// Polled: a session appends as it works, and the page is watched while it does.
export const TRACE_REFRESH_MS = 5000;

export const useTurns = (days: number) => useQuery({ queryKey: traceKeys.turns(days), queryFn: () => traceApi.turns(days), refetchInterval: TRACE_REFRESH_MS });

export const useTurn = (id: string) => useQuery({ queryKey: traceKeys.turn(id), queryFn: () => traceApi.turn(id) });

export const useUsage = (days: number) => useQuery({ queryKey: traceKeys.usage(days), queryFn: () => traceApi.usage(days) });

// For a page's Refresh button: every usage window read so far, read again.
export function useRefreshUsage() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: [...traceKeys.all, "usage"] });
}
