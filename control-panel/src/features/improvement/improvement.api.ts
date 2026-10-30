import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { CampaignResponse, Decision, ImprovementOverview, ImprovementSettings, Opportunity, SettingValue } from "./improvement.types";

const base = (key: string) => `/api/v1/projects/${encodeURIComponent(key)}/improvement`;

// What the engine found and decided is READ here; a person's promote, revert and reject and the project's bounds are
// the only writes, each on the revision the page read.
export const improvementApi = {
  overview: (key: string) => api.get<ImprovementOverview>(base(key)),
  opportunities: (key: string) => api.get<{ opportunities: Opportunity[] }>(`${base(key)}/opportunities`),
  campaign: (key: string, id: string) => api.get<CampaignResponse>(`${base(key)}/campaigns/${encodeURIComponent(id)}`),
  decide: (key: string, id: string, decision: Decision, expectedRevision: number, because?: string) => api.post<CampaignResponse & { result: unknown }>(`${base(key)}/campaigns/${encodeURIComponent(id)}/${decision}`, { expectedRevision, because }),
  saveSettings: (key: string, settings: Record<string, SettingValue>, revision: string | null) => api.put<{ saved: ImprovementSettings }>(`${base(key)}/settings`, { settings, revision }),
};

export const improvementKeys = {
  all: ["improvement"] as const,
  overview: (key: string) => [...improvementKeys.all, "overview", key] as const,
  opportunities: (key: string) => [...improvementKeys.all, "opportunities", key] as const,
  campaign: (key: string, id: string) => [...improvementKeys.all, "campaign", key, id] as const,
};

/** How often what is still moving is read again. */
export const IMPROVEMENT_REFRESH_MS = 10000;

export const useImprovement = (key: string | null) => useQuery({ queryKey: improvementKeys.overview(key ?? ""), queryFn: () => improvementApi.overview(key ?? ""), enabled: key !== null, refetchInterval: IMPROVEMENT_REFRESH_MS });

export const useOpportunities = (key: string | null) => useQuery({ queryKey: improvementKeys.opportunities(key ?? ""), queryFn: () => improvementApi.opportunities(key ?? ""), enabled: key !== null });

export const useCampaign = (key: string, id: string) => useQuery({ queryKey: improvementKeys.campaign(key, id), queryFn: () => improvementApi.campaign(key, id), refetchInterval: (q) => (q.state.data?.campaign.ended ? false : IMPROVEMENT_REFRESH_MS) });

export function useDecision(key: string, id: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (d: { decision: Decision; expectedRevision: number; because?: string }) => improvementApi.decide(key, id, d.decision, d.expectedRevision, d.because), onSettled: () => client.invalidateQueries({ queryKey: improvementKeys.all }) });
}

export function useSaveSettings(key: string, revision: string | null) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (settings: Record<string, SettingValue>) => improvementApi.saveSettings(key, settings, revision), onSuccess: () => client.invalidateQueries({ queryKey: improvementKeys.all }) });
}
