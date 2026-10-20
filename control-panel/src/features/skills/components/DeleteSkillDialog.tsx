import { useState } from "react";
import { Text } from "@fluentui/react-components";
import { formatBytes } from "../../../shared/format";
import { ConfirmDialog } from "../../../shared/components/ConfirmDialog";
import { ErrorState } from "../../../shared/components/ErrorState";
import type { DeletedSkill, SkillSummary } from "../api/skills.types";
import { useDeleteSkill } from "../hooks/useDeleteSkill";

interface DeleteSkillDialogProps {
  skill: SkillSummary | null;
  onDismiss: () => void;
  onDeleted: (deleted: DeletedSkill) => void;
}

// Always mounted, and closed by `open`, never by unmounting: a Fluent modal that
// is removed while open leaves the rest of the page aria-hidden. The last skill
// is kept so the text does not vanish while the dialog animates closed.
export function DeleteSkillDialog({ skill, onDismiss, onDeleted }: DeleteSkillDialogProps) {
  const remove = useDeleteSkill();
  const [shown, setShown] = useState(skill);
  if (skill && skill !== shown) setShown(skill);
  const cancel = () => {
    remove.reset();
    onDismiss();
  };
  const id = shown?.id ?? "";
  return (
    <ConfirmDialog open={skill !== null} title={`Delete ${id}?`} confirmLabel="Delete skill" destructive busy={remove.isPending} onConfirm={() => remove.mutate(id, { onSuccess: onDeleted })} onCancel={cancel}>
      <Text as="p" block>
        This removes the entire skill directory{shown ? ` — ${shown.files} ${shown.files === 1 ? "file" : "files"}, ${formatBytes(shown.bytes)} —` : ""} including the scripts, helpers and templates stored in it.
      </Text>
      <Text as="p" block>
        A backup will be created first.
      </Text>
      {remove.isError && <ErrorState error={remove.error} title="Delete failed" />}
    </ConfirmDialog>
  );
}
