import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { PartsView, ReportSettings, ReportsOverview, Saved, SettingsView, Unavailable, Verified } from "./reports.types";

const BASE = "/api/v1/reports";

export const reportsApi = {
  overview: () => api.get<ReportsOverview | Unavailable>(`${BASE}/overview`),
  settings: () => api.get<SettingsView | Unavailable>(`${BASE}/settings`),
  saveSettings: (settings: ReportSettings, revision: string | null) => api.put<Saved>(`${BASE}/settings`, { settings, revision }),
  parts: () => api.get<PartsView | Unavailable>(`${BASE}/parts`),
  switchPart: (action: "enable" | "disable" | "approve" | "unapprove", part: string, revision: string | null) => api.post<Saved>(`${BASE}/parts/${action}`, { part, revision }),
  verify: (extension: string) => api.post<Verified>(`${BASE}/parts/verify`, { extension }),
  rollback: (extension: string, to: string | null) => api.post<{ extension: string; version: string | null }>(`${BASE}/parts/rollback`, { extension, to }),
};

export const reportKeys = {
  all: ["reports"] as const,
  overview: () => [...reportKeys.all, "overview"] as const,
  settings: () => [...reportKeys.all, "settings"] as const,
  parts: () => [...reportKeys.all, "parts"] as const,
};

export const useReportsOverview = () => useQuery({ queryKey: reportKeys.overview(), queryFn: reportsApi.overview });
export const useReportSettings = () => useQuery({ queryKey: reportKeys.settings(), queryFn: reportsApi.settings });
export const useReportParts = () => useQuery({ queryKey: reportKeys.parts(), queryFn: reportsApi.parts });

// Every change moves the settings' revision, so every report view is read again.
export function useReportChange<I, O>(fn: (input: I) => Promise<O>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => client.invalidateQueries({ queryKey: reportKeys.all }) });
}
