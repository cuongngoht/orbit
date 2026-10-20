import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { Resolved, RouterResources } from "./router.types";

export const routerApi = {
  resources: () => api.get<RouterResources>("/api/v1/router/resources"),
  resolve: (prompt: string) => api.post<Resolved>("/api/v1/router/resolve", { prompt }),
};

export const routerKeys = {
  all: ["router"] as const,
  resources: () => [...routerKeys.all, "resources"] as const,
};

export const useRouterResources = () => useQuery({ queryKey: routerKeys.resources(), queryFn: routerApi.resources });

// A mutation, not a query: a prompt is typed, resolved once, and never cached --
// the answer belongs to this screen and nowhere else.
export const useResolve = () => useMutation({ mutationFn: routerApi.resolve });
