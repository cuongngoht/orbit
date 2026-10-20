import { useMutation, useQueryClient } from "@tanstack/react-query";
import { skillKeys, skillsApi } from "../api/skills.api";

export function useDeleteSkill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: skillsApi.remove,
    onSuccess: (deleted) => {
      client.removeQueries({ queryKey: skillKeys.detail(deleted.id) });
      return client.invalidateQueries({ queryKey: skillKeys.list() });
    },
  });
}
