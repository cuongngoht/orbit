import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { routerKeys } from "../router/router.api";
import type { Installed, Tool } from "./tools.types";

const BASE = "/api/v1/tools";
const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export const toolsApi = {
  list: () => api.get<{ tools: Tool[] }>(BASE).then((r) => r.tools),
  get: (id: string) => api.get<Tool>(one(id)),
  refresh: (id: string) => api.post<Tool>(`${one(id)}/refresh`),
  install: (id: string) => api.post<Installed>(`${one(id)}/install`),
  update: (id: string) => api.post<Installed>(`${one(id)}/update`),
};

export const toolKeys = {
  all: ["tools"] as const,
  list: () => [...toolKeys.all, "list"] as const,
  detail: (id: string) => [...toolKeys.all, "detail", id] as const,
};

export const useTools = () => useQuery({ queryKey: toolKeys.list(), queryFn: toolsApi.list });
export const useTool = (id: string) => useQuery({ queryKey: toolKeys.detail(id), queryFn: () => toolsApi.get(id) });

// A tool that appeared or went is a change in what the router can see too.
export function useToolChange<O>(fn: (id: string) => Promise<O>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => Promise.all([client.invalidateQueries({ queryKey: toolKeys.all }), client.invalidateQueries({ queryKey: routerKeys.all })]),
  });
}
