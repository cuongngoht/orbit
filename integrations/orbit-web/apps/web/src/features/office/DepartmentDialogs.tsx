// A DEPARTMENT: made, renamed, or archived. Archiving one that has members asks where they go first -- another
// department, or Unassigned -- because the API refuses to leave anybody in an archived department.
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, Select, Text } from "@fluentui/react-components";
import { WORKFORCE_ERRORS, type Department } from "@orbit-web/contracts";
import { useState } from "react";
import { useI18n } from "../../i18n";
import { ApiError } from "../../services/api";
import { office } from "./api";
import { ProblemBar, problemOf, useOfficeStyles, type Problem } from "./parts";

export type DepartmentEdit = { kind: "new" } | { kind: "rename"; department: Department } | { kind: "archive"; department: Department };

export function DepartmentDialog({ edit, departments, onClose, onDone }: { edit: DepartmentEdit; departments: Department[]; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const [name, setName] = useState(edit.kind === "rename" ? edit.department.name : "");
  const others = edit.kind === "archive" ? departments.filter((d) => !d.archived && d.id !== edit.department.id) : [];
  const [moveTo, setMoveTo] = useState<string>("");
  // Whether the members' destination must be chosen: the department has members, or the API said so in between.
  const [needsMove, setNeedsMove] = useState(edit.kind === "archive" && edit.department.members > 0);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const title = edit.kind === "new" ? t("office.department.newTitle") : edit.kind === "rename" ? t("office.department.renameTitle", { name: edit.department.name }) : t("office.department.archiveTitle", { name: edit.department.name });
  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (edit.kind === "new") await office.createDepartment(name.trim());
      else if (edit.kind === "rename") await office.renameDepartment(edit.department, name.trim());
      else await office.archiveDepartment(edit.department, needsMove ? { moveTo: moveTo === "" ? null : moveTo } : {});
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === WORKFORCE_ERRORS.departmentNotEmpty) setNeedsMove(true);
      setProblem(problemOf(err, t("office.department.stale")));
    } finally {
      setBusy(false);
    }
  };
  const targetLabel = edit.kind === "archive" ? (edit.department.members === 1 ? t("office.department.oneMember") : t("office.department.manyMembers", { count: edit.department.members })) : "";
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className="orbit-touch">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogBody>
            <DialogTitle>{title}</DialogTitle>
            <DialogContent className={o.form}>
              {edit.kind !== "archive" ? (
                <Field label={t("office.department.nameLabel")} required>
                  <Input value={name} maxLength={80} autoFocus onChange={(_, d) => setName(d.value)} />
                </Field>
              ) : (
                <>
                  <Text>{t("office.department.archiveNote")}</Text>
                  {needsMove && (
                    <Field label={t("office.department.moveMembersLabel", { target: targetLabel })} required>
                      <Select value={moveTo} onChange={(_, d) => setMoveTo(d.value)}>
                        <option value="">{t("office.overview.unassigned")}</option>
                        {others.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </>
              )}
              <ProblemBar problem={problem} />
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>{t("office.department.cancel")}</Button>
              <Button appearance="primary" type="submit" disabled={busy || (edit.kind !== "archive" && name.trim() === "")}>
                {edit.kind === "new" ? t("office.department.create") : edit.kind === "rename" ? t("office.floor.rename") : t("office.floor.archive")}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
