import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { ForgetTarget, Forgotten, ProjectList } from "./projects.types";

export const projectsApi = {
  list: () => api.get<ProjectList>("/api/v1/projects"),
  // A person's, relayed from the button they pressed; the server refuses a directory that is there.
  forget: (target: ForgetTarget) => api.post<Forgotten>(`/api/v1/projects/${encodeURIComponent(target.key)}/checkouts/${encodeURIComponent(target.checkout)}/forget`, { human: true }),
};

export const projectKeys = {
  all: ["projects"] as const,
  list: () => [...projectKeys.all, "list"] as const,
};

export const useProjects = () => useQuery({ queryKey: projectKeys.list(), queryFn: projectsApi.list });

// Forgetting reads the list again, whatever happened: a refusal may mean the directory came back.
export function useForget() {
  const client = useQueryClient();
  return useMutation({ mutationFn: projectsApi.forget, onSettled: () => client.invalidateQueries({ queryKey: projectKeys.all }) });
}
