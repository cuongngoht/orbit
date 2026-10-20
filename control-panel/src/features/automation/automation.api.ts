import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import type { AutomationOverview, GeneratedSkillDetail, GeneratedSkills, ProjectAutomation, Revalidated, SettingsTree, SkillMove } from "./automation.types";

const BASE = "/api/v1/automation";
const projectBase = (key: string) => `/api/v1/projects/${encodeURIComponent(key)}`;

export const automationApi = {
  overview: () => api.get<AutomationOverview>(BASE),
  saveMachine: (settings: SettingsTree, revision: string | null) => api.put<{ saved: AutomationOverview }>(`${BASE}/settings`, { settings, revision }),
  project: (key: string) => api.get<ProjectAutomation>(`${projectBase(key)}/automation`),
  saveProject: (key: string, settings: SettingsTree, revision: string | null) => api.put<{ saved: ProjectAutomation }>(`${projectBase(key)}/automation/settings`, { settings, revision }),
  saveLive: (settings: SettingsTree, revision: string | null) => api.put<{ saved: unknown }>("/api/v1/live/settings", { settings, revision }),
  // A restriction a person kept from before autonomy was the default, lifted on the revision read: never set again.
  skills: (key: string) => api.get<GeneratedSkills>(`${projectBase(key)}/generated-skills`),
  skill: (key: string, id: string) => api.get<GeneratedSkillDetail>(`${projectBase(key)}/generated-skills/${encodeURIComponent(id)}`),
  move: (key: string, id: string, move: SkillMove) => api.post<GeneratedSkillDetail | Revalidated>(`${projectBase(key)}/generated-skills/${encodeURIComponent(id)}/${move}`, {}),
};

export const automationKeys = {
  all: ["automation"] as const,
  overview: () => [...automationKeys.all, "overview"] as const,
  project: (key: string) => [...automationKeys.all, "project", key] as const,
  skills: (key: string) => [...automationKeys.all, "skills", key] as const,
  skill: (key: string, id: string) => [...automationKeys.all, "skill", key, id] as const,
};

export const useAutomation = () => useQuery({ queryKey: automationKeys.overview(), queryFn: automationApi.overview });

export const useProjectAutomation = (key: string | null) => useQuery({ queryKey: automationKeys.project(key ?? ""), queryFn: () => automationApi.project(key ?? ""), enabled: key !== null });

export const useGeneratedSkills = (key: string | null) => useQuery({ queryKey: automationKeys.skills(key ?? ""), queryFn: () => automationApi.skills(key ?? ""), enabled: key !== null });

export const useGeneratedSkill = (key: string | null, id: string | null) => useQuery({ queryKey: automationKeys.skill(key ?? "", id ?? ""), queryFn: () => automationApi.skill(key ?? "", id ?? ""), enabled: key !== null && id !== null });

// Every save moves a revision, so everything automation shows is read again.
function useSaved<T>(fn: (settings: SettingsTree) => Promise<T>) {
  const client = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => client.invalidateQueries({ queryKey: automationKeys.all }) });
}

export const useSaveMachine = (revision: string | null) => useSaved((s) => automationApi.saveMachine(s, revision));

export const useSaveProject = (key: string, revision: string | null) => useSaved((s) => automationApi.saveProject(key, s, revision));

export const useSaveLive = (revision: string | null) => useSaved((s) => automationApi.saveLive(s, revision));

export function useMoveSkill(key: string) {
  const client = useQueryClient();
  return useMutation({ mutationFn: (m: { id: string; move: SkillMove }) => automationApi.move(key, m.id, m.move), onSuccess: () => client.invalidateQueries({ queryKey: automationKeys.all }) });
}
