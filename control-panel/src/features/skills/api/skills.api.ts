import { api } from "../../../shared/api/client";
import type { DeletedSkill, Skill, SkillResources, SkillSummary, UpdateSkillInput } from "./skills.types";

const BASE = "/api/v1/skills";
const one = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

export const skillsApi = {
  list: () => api.get<{ skills: SkillSummary[] }>(BASE).then((r) => r.skills),
  get: (id: string) => api.get<Skill>(one(id)),
  update: ({ id, content, revision }: UpdateSkillInput) => api.put<Skill>(one(id), { content, revision }),
  remove: (id: string) => api.delete<DeletedSkill>(one(id)),
  resources: (id: string) => api.get<SkillResources>(`${one(id)}/resources`),
};

// Every query this feature owns hangs under ["skills"], so one prefix
// invalidates all of it.
export const skillKeys = {
  all: ["skills"] as const,
  list: () => [...skillKeys.all, "list"] as const,
  detail: (id: string) => [...skillKeys.all, "detail", id] as const,
  resources: (id: string) => [...skillKeys.all, "resources", id] as const,
};
