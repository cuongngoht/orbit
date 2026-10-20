import { useQuery } from "@tanstack/react-query";
import { skillKeys, skillsApi } from "../api/skills.api";

export const useSkill = (id: string) => useQuery({ queryKey: skillKeys.detail(id), queryFn: () => skillsApi.get(id) });
