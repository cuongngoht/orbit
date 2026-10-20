import { useMutation, useQueryClient } from "@tanstack/react-query";
import { skillKeys, skillsApi } from "../api/skills.api";

// The server answers a save with the skill as it now is on disk, so that answer
// becomes the cached detail directly; the list is refetched because a changed
// description or user-invocable flag shows there too.
export function useUpdateSkill() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: skillsApi.update,
    onSuccess: (skill) => {
      client.setQueryData(skillKeys.detail(skill.id), skill);
      return client.invalidateQueries({ queryKey: skillKeys.list() });
    },
  });
}
