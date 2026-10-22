import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { CatalogDocument, CatalogSource, Enabled, Preview, SecurityOverview } from "./security.types";

const BASE = "/api/v1/security";

export const securityApi = {
  overview: () => api.get<SecurityOverview>(`${BASE}/catalogs`),
  catalog: (digest: string) => api.get<CatalogDocument>(`${BASE}/catalogs/${encodeURIComponent(digest)}`),
  preview: (source: CatalogSource) => api.post<{ preview: Preview }>(`${BASE}/catalogs/preview`, source),
  adopt: (source: CatalogSource, digest: string, revision: string | null) => api.post<unknown>(`${BASE}/catalogs/adopt`, { ...source, digest, revision }),
  saveEditor: (document: unknown, revision: string | null) => api.put<unknown>(`${BASE}/catalogs/editor`, { document, revision }),
  enable: (enabled: Enabled[], revision: string | null) => api.put<unknown>(`${BASE}/project/enabled`, { enabled, revision }),
  mark: (mark: { catalog: string; control: string; why?: string; clear?: boolean }, revision: string | null) => api.put<unknown>(`${BASE}/project/not-applicable`, { ...mark, revision }),
};

export const securityKeys = {
  all: ["security"] as const,
  overview: () => [...securityKeys.all, "overview"] as const,
  catalog: (digest: string) => [...securityKeys.all, "catalog", digest] as const,
};

export const useSecurityOverview = () => useQuery({ queryKey: securityKeys.overview(), queryFn: securityApi.overview });

export const useCatalogDocument = (digest: string | null) => useQuery({ queryKey: securityKeys.catalog(digest ?? ""), queryFn: () => securityApi.catalog(digest ?? ""), enabled: digest !== null });

// Every change moves a revision, so the overview is read again after one.
export function useSecurityChange<T>(fn: (input: T) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => client.invalidateQueries({ queryKey: securityKeys.all }) });
}
