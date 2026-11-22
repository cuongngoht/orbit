// GOVERNANCE → EMPLOYEE DESKS (ADR 0069): every employee who left -- archived, or rejected at its trial -- and the desk it
// still holds. Its desk and cache stay committed of the account's storage (an archive keeps them, read only) until the
// owner reviews them here and deletes the desk: then the desk, the cache and every workspace go for good, and the storage
// is released once the sandbox is read back gone. A desk being deleted is shown until it is.
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, MessageBar, MessageBarBody, Spinner, Text } from "@fluentui/react-components";
import { Delete16Regular } from "@fluentui/react-icons";
import type { EmployeeDesk, EmployeeDeskList } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { errorText, get, ifMatch, isStale, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { sizeText } from "../resources/format";
import { Card, ErrorBar, Word, useParts, when } from "./parts";

const LEFT_TEXT: Record<string, string> = { archived: "Left the office", deleted: "Desk being deleted" };

function Desk({ d, onChanged }: { d: EmployeeDesk; onChanged: () => void }) {
  const s = useParts();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = d.deskMiB + d.cacheMiB;
  const deleting = d.employment === "deleted";
  const remove = async () => {
    setConfirm(false);
    setBusy(true);
    setError(null);
    try {
      await send("POST", `/api/employees/${encodeURIComponent(d.employeeId)}/employment`, { command: "delete", reason: "Desk deleted from Governance → Employee desks" }, ifMatch(d.version));
      onChanged();
    } catch (err) {
      setError(isStale(err) ? "This employee changed since the page read it: nothing was deleted. Read the list again." : errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={<>{d.name} <Word value={LEFT_TEXT[d.employment] ?? d.employment} /></>}>
      <Text size={200} className={s.muted}>
        {deleting ? "Its owner deleted the desk" : "Left"} {when(d.leftAt)}
        {d.reason ? ` · ${d.reason}` : ""}
      </Text>
      <Text>
        Holds {sizeText(held)} of the account's storage: desk {sizeText(d.deskMiB)}
        {d.cacheMiB > 0 ? `, cache ${sizeText(d.cacheMiB)}` : ""}
        {d.usedMiB !== null ? ` (${sizeText(d.usedMiB)} measured in use)` : ""}.
      </Text>
      {deleting ? (
        <Spinner size="tiny" label={d.sandbox?.reason ?? "Being deleted…"} labelPosition="after" />
      ) : (
        <div className={s.row}>
          <Button size="small" icon={<Delete16Regular />} disabled={busy} onClick={() => setConfirm(true)}>
            Delete the desk…
          </Button>
        </div>
      )}
      <ErrorBar text={error} />
      {confirm && (
        <Dialog open onOpenChange={(_, v) => !v.open && setConfirm(false)}>
          <DialogSurface className="orbit-touch">
            <DialogBody>
              <DialogTitle>Delete {d.name}'s desk?</DialogTitle>
              <DialogContent>
                Its desk and toolbox, its cache and every workspace it kept are deleted for good, and {sizeText(held)} of the account's storage is released once they are gone. What it delivered stays with the work it was given. This cannot be undone.
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setConfirm(false)}>Cancel</Button>
                <Button appearance="primary" onClick={() => void remove()}>
                  Delete the desk
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </Card>
  );
}

export function EmployeeDesksPage() {
  const s = useParts();
  const list = useResource<EmployeeDeskList>(() => get("/api/office/desks"), []);
  useAppEvent("office.changed", (e) => e.data.areas.includes("roster") && void list.reload());
  if (list.data === null) return list.error ? <MessageBar intent="error"><MessageBarBody>{list.error}</MessageBarBody></MessageBar> : <Spinner label="Reading the desks…" />;
  const { desks, storage } = list.data;
  return (
    <div className={s.page}>
      <Text>
        An employee who leaves the office -- archived, or rejected at its trial -- keeps its desk, read only, and its storage stays committed: {sizeText(storage.committedMiB)} of the account's {sizeText(storage.budgetMiB)} is committed now. Review each one here and delete the desks you no longer need.
      </Text>
      {desks.length === 0 && (
        <div className={s.empty}>
          <Text>No desk is held: nobody has left the office with one.</Text>
        </div>
      )}
      {desks.map((d) => (
        <Desk key={`${d.employeeId}:${d.version}`} d={d} onChanged={() => void list.reload()} />
      ))}
    </div>
  );
}
