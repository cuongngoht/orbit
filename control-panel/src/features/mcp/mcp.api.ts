import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { routerKeys } from "../router/router.api";
import type { ActivityEvent, CatalogEntry, Check, ExternalServer, ManagedInput, ManagedServer, McpOverview, McpTool, PoliciesView, Policy, Selection, Verdict } from "./mcp.types";

const BASE = "/api/v1/mcp";
const managed = (id: string) => `${BASE}/managed/${encodeURIComponent(id)}`;
const external = (id: string) => `${BASE}/external/${encodeURIComponent(id)}`;

// Every change here is to Orbit's OWN records in the machine store. Nothing in
// this file can write a host's configuration: the host's servers are read and
// tested, and that is all.
export const mcpApi = {
  overview: () => api.get<McpOverview>(BASE),
  catalog: () => api.get<{ entries: CatalogEntry[] }>("/api/v1/mcp-catalog").then((r) => r.entries),
  policies: () => api.get<PoliciesView>(`${BASE}/policies`),
  activity: () => api.get<{ events: ActivityEvent[] }>(`${BASE}/activity`).then((r) => r.events),
  managed: (id: string) => api.get<ManagedServer>(managed(id)),
  external: (id: string) => api.get<ExternalServer>(external(id)),
  managedTools: (id: string) => api.get<{ id: string; checkedAt: string | null; fresh: boolean; tools: McpTool[] | null }>(`${managed(id)}/tools`),
  externalTools: (id: string) => api.get<{ id: string; checkedAt: string | null; fresh: boolean; tools: McpTool[] | null }>(`${external(id)}/tools`),
  addCatalog: (catalog: string) => api.post<ManagedServer>(`${BASE}/managed`, { catalog }),
  addCustom: (definition: ManagedInput) => api.post<ManagedServer>(`${BASE}/managed`, { definition }),
  update: ({ id, definition }: { id: string; definition: Partial<ManagedInput> }) => api.put<ManagedServer>(managed(id), { definition }),
  remove: (id: string) => api.delete<{ id: string; removed: true; runtimeKept: boolean }>(managed(id)),
  enable: (id: string) => api.post<ManagedServer>(`${managed(id)}/enable`),
  disable: (id: string) => api.post<ManagedServer>(`${managed(id)}/disable`),
  selection: ({ id, selection }: { id: string; selection: Selection }) => api.put<ManagedServer>(`${managed(id)}/selection`, { selection }),
  policy: ({ id, policy }: { id: string; policy: Partial<Policy> }) => api.put<ManagedServer>(`${managed(id)}/policy`, { policy }),
  approve: ({ id, minutes }: { id: string; minutes: number }) => api.post<{ id: string; until: string; server: ManagedServer }>(`${managed(id)}/approve`, { minutes }),
  revoke: (id: string) => api.delete<ManagedServer>(`${managed(id)}/approval`),
  test: (id: string) => api.post<{ server: ManagedServer; check: Check }>(`${managed(id)}/test`),
  testDefinition: (definition: ManagedInput) => api.post<{ check: Check }>(`${BASE}/test`, { definition }),
  install: (id: string) => api.post<{ receipt: { version: string; reused: boolean } | null; server: ManagedServer }>(`${managed(id)}/install`),
  deleteRuntime: (id: string) => api.delete<{ id: string; removed: boolean; receipts: number }>(`${managed(id)}/runtime`),
  refreshExternal: () => api.post<{ servers: ExternalServer[] }>(`${BASE}/external/refresh`),
  testExternal: (id: string) => api.post<{ server: ExternalServer; check: Check }>(`${external(id)}/test`),
  workflows: (workflows: Record<string, Record<string, Verdict>>) => api.put<PoliciesView>(`${BASE}/policies/workflows`, { workflows }),
};

// Everything under ["mcp"], and the router's view beside it: a server added,
// removed, switched or re-policed here is a change in what the router may do.
export const mcpKeys = {
  all: ["mcp"] as const,
  overview: () => [...mcpKeys.all, "overview"] as const,
  catalog: () => [...mcpKeys.all, "catalog"] as const,
  policies: () => [...mcpKeys.all, "policies"] as const,
  activity: () => [...mcpKeys.all, "activity"] as const,
  managed: (id: string) => [...mcpKeys.all, "managed", id] as const,
  external: (id: string) => [...mcpKeys.all, "external", id] as const,
  tools: (key: string) => [...mcpKeys.all, "tools", key] as const,
};

export const useMcpOverview = () => useQuery({ queryKey: mcpKeys.overview(), queryFn: mcpApi.overview });
export const useMcpCatalog = () => useQuery({ queryKey: mcpKeys.catalog(), queryFn: mcpApi.catalog });
export const useMcpPolicies = () => useQuery({ queryKey: mcpKeys.policies(), queryFn: mcpApi.policies });
export const useMcpActivity = () => useQuery({ queryKey: mcpKeys.activity(), queryFn: mcpApi.activity });
export const useManaged = (id: string) => useQuery({ queryKey: mcpKeys.managed(id), queryFn: () => mcpApi.managed(id) });
export const useExternal = (id: string) => useQuery({ queryKey: mcpKeys.external(id), queryFn: () => mcpApi.external(id) });
export const useManagedTools = (id: string) => useQuery({ queryKey: mcpKeys.tools(`managed:${id}`), queryFn: () => mcpApi.managedTools(id) });
export const useExternalTools = (id: string) => useQuery({ queryKey: mcpKeys.tools(`external:${id}`), queryFn: () => mcpApi.externalTools(id) });

export function useMcpChange<I, O>(fn: (input: I) => Promise<O>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: mcpKeys.all }), client.invalidateQueries({ queryKey: routerKeys.all })]),
  });
}

// Testing an unsaved definition changes nothing, so nothing is invalidated.
export const useTestDefinition = () => useMutation({ mutationFn: mcpApi.testDefinition });
