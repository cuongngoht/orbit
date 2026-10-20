import { useQuery } from "@tanstack/react-query";
import { skillKeys, skillsApi } from "../api/skills.api";

export const useSkills = () => useQuery({ queryKey: skillKeys.list(), queryFn: skillsApi.list });
