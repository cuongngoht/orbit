import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { AqaOverview, AqaSettings, ReportPage, Saved, Unavailable } from "./aqa.types";

const BASE = "/api/v1/autonomous-qa";

export const aqaApi = {
  overview: () => api.get<AqaOverview | Unavailable>(BASE),
  saveSettings: (settings: AqaSettings, revision: string | null) => api.put<Saved>(`${BASE}/settings`, { settings, revision }),
  report: (id: string) => api.get<ReportPage>(`${BASE}/investigations/${encodeURIComponent(id)}/report`),
};

export const aqaKeys = {
  all: ["autonomous-qa"] as const,
  overview: () => [...aqaKeys.all, "overview"] as const,
};

export const useAqaOverview = () => useQuery({ queryKey: aqaKeys.overview(), queryFn: aqaApi.overview });

// A save moves the revision, so the overview (and its blockers) is read again.
export function useSaveAqaSettings(revision: string | null) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (next: AqaSettings) => aqaApi.saveSettings(next, revision), onSuccess: () => client.invalidateQueries({ queryKey: aqaKeys.all }) });
}
