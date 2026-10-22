import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { AqaOverview, AqaSettings, ArtifactView, ReportPage, Saved, TestsView, Unavailable, VersionView } from "./aqa.types";

const BASE = "/api/v1/autonomous-qa";

export const aqaApi = {
  overview: () => api.get<AqaOverview | Unavailable>(BASE),
  saveSettings: (settings: AqaSettings, revision: string | null) => api.put<Saved>(`${BASE}/settings`, { settings, revision }),
  report: (id: string) => api.get<ReportPage>(`${BASE}/investigations/${encodeURIComponent(id)}/report`),
  tests: (id: string) => api.get<TestsView>(`${BASE}/investigations/${encodeURIComponent(id)}/tests`),
  artifact: (id: string, kind: string, digest: string) => api.get<ArtifactView>(`${BASE}/investigations/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(kind)}/${encodeURIComponent(digest)}`),
  version: (id: string, version: string) => api.get<VersionView>(`${BASE}/investigations/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`),
};

export const aqaKeys = {
  all: ["autonomous-qa"] as const,
  overview: () => [...aqaKeys.all, "overview"] as const,
  tests: (id: string) => [...aqaKeys.all, "tests", id] as const,
};

export const useAqaOverview = () => useQuery({ queryKey: aqaKeys.overview(), queryFn: aqaApi.overview });

// An investigation's generated tests, read only when a person opens them.
export const useAqaTests = (id: string | null) => useQuery({ queryKey: aqaKeys.tests(id ?? ""), queryFn: () => aqaApi.tests(id ?? ""), enabled: id !== null });

// A save moves the revision, so the overview (and its blockers) is read again.
export function useSaveAqaSettings(revision: string | null) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (next: AqaSettings) => aqaApi.saveSettings(next, revision), onSuccess: () => client.invalidateQueries({ queryKey: aqaKeys.all }) });
}
