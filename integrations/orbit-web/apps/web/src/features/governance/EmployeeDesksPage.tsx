// GOVERNANCE → EMPLOYEE DESKS (ADR 0069): every employee's desk -- of those in the office, of those who left (archived, or
// rejected at the trial), and the ones being deleted -- with what each holds. Any of them is opened (DeskBrowser): read
// only, each look recorded. One in the office that holds no work is cleaned up there. One who left keeps its desk and
// cache committed of the account's storage (read only) until the owner deletes the desk here: then the desk, the cache
// and every workspace go for good, and the storage is released once the sandbox is read back gone.
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, MessageBar, MessageBarBody, Spinner, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { Delete16Regular, FolderOpen16Regular } from "@fluentui/react-icons";
import { DesksIcon } from "../../components/SectionIcons";
import type { EmployeeDesk, EmployeeDeskList } from "@orbit-web/contracts";
import { useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { errorText, get, ifMatch, isStale, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { sizeText } from "../resources/format";
import { DeskBrowser } from "./DeskBrowser";
import { Card, EmptyState, ErrorBar, Word, useParts, when } from "./parts";

const LEFT_TEXT: Record<string, string> = { archived: "Left the office", deleted: "Desk being deleted" };
const GROUPS: { name: string; has: (d: EmployeeDesk) => boolean }[] = [
  { name: "In the office", has: (d) => d.employment !== "archived" && d.employment !== "deleted" },
  { name: "Left the office", has: (d) => d.employment === "archived" },
  { name: "Being deleted", has: (d) => d.employment === "deleted" },
];

// What was measured in the desk and its cache, and when -- or that nothing was yet.
const measuredText = (d: EmployeeDesk): string =>
  d.deskUsedMiB === null ? "not measured yet" : `${sizeText(d.deskUsedMiB)} measured in the desk${d.cacheUsedMiB !== null && d.cacheMiB > 0 ? `, ${sizeText(d.cacheUsedMiB)} in its cache` : ""}${d.measuredAt !== null ? ` · ${when(d.measuredAt)}` : ""}`;

const useStyles = makeStyles({
  barTrack: {
    width: "100%",
    height: "6px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralBackground3,
    overflow: "hidden",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
  barFill: {
    height: "100%",
    borderRadius: "9999px",
    backgroundColor: tokens.colorBrandBackground,
    transitionProperty: "width",
    transitionDuration: "200ms",
  },
});

function Desk({ d, onChanged, go }: { d: EmployeeDesk; onChanged: () => void; go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const held = d.deskMiB + d.cacheMiB;
  const deleting = d.employment === "deleted";
  const left = d.employment === "archived" || deleting;
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
    <Card title={<>{d.name} <Word value={LEFT_TEXT[d.employment] ?? d.employment} /></>} icon={<DesksIcon size={18} />} tone="neutral" label={d.name}>
      {left ? (
        <Text size={200} className={s.muted}>
          {deleting ? "Its owner deleted the desk" : "Left"} {when(d.leftAt)}
          {d.reason ? ` · ${d.reason}` : ""}
        </Text>
      ) : (
        <Text size={200} className={s.muted}>
          Desk version {d.deskVersion}
          {d.sandbox !== null && d.sandbox.state !== "READY" ? ` · its sandbox is ${d.sandbox.state}` : ""}
        </Text>
      )}
      <Text>
        Holds {sizeText(held)} of the account's storage: desk {sizeText(d.deskMiB)}
        {d.cacheMiB > 0 ? `, cache ${sizeText(d.cacheMiB)}` : ""} ({measuredText(d)}).
      </Text>
      {d.busy && !left && <Text size={200} className={s.muted}>It holds work now: its desk is cleaned up once that work is done.</Text>}
      {deleting ? (
        <Spinner size="tiny" label={d.sandbox?.reason ?? "Being deleted…"} labelPosition="after" />
      ) : (
        <div className={s.row}>
          {d.canBrowse && (
            <Button size="small" icon={<FolderOpen16Regular />} onClick={() => go("desks", d.employeeId)}>
              Open the desk
            </Button>
          )}
          {left && (
            <Button size="small" icon={<Delete16Regular />} disabled={busy} onClick={() => setConfirm(true)}>
              Delete the desk…
            </Button>
          )}
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

export function EmployeeDesksPage({ item, go }: { item: string | null; go: (page: GovernancePage, item?: string | null) => void }) {
  if (item) return <DeskBrowser key={item} employeeId={item} go={go} />;
  return <DeskList go={go} />;
}

function DeskList({ go }: { go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  const st = useStyles();
  const list = useResource<EmployeeDeskList>(() => get("/api/office/desks"), []);
  useAppEvent("office.changed", (e) => e.data.areas.includes("roster") && void list.reload());
  if (list.data === null) return list.error ? <MessageBar intent="error"><MessageBarBody>{list.error}</MessageBarBody></MessageBar> : <Spinner label="Reading the desks…" />;
  const { desks, storage } = list.data;
  const pct = storage.budgetMiB > 0 ? Math.min(100, Math.round((storage.committedMiB / storage.budgetMiB) * 100)) : 0;
  return (
    <div className={s.page}>
      <Card
        title="Employee desks"
        icon={<DesksIcon size={18} />}
        tone="neutral"
        description={`Every employee's desk: what its accepted work left there, and the toolbox it wrote for itself. Open one to look into it — read only, each look recorded in the audit — and clean it up when it fills. An employee who leaves keeps its desk, read only, and its storage stays committed until you delete it: ${sizeText(storage.committedMiB)} of the account's ${sizeText(storage.budgetMiB)} is committed now.`}
      >
        <div className={st.barTrack} role="progressbar" aria-label="Account storage committed" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={st.barFill} style={{ width: `${pct}%` }} />
        </div>
        {desks.length === 0 && (
          <EmptyState
            icon={<DesksIcon size={22} />}
            tone="neutral"
            title="No employee has a desk yet."
            body="An employee's desk is made when it is hired; it is listed here from then on."
          />
        )}
      </Card>
      {GROUPS.map((g) => {
        const these = desks.filter(g.has);
        return these.length === 0 ? null : (
          <section key={g.name} aria-label={g.name} className={s.page}>
            <Text weight="semibold">{g.name}</Text>
            {these.map((d) => (
              <Desk key={`${d.employeeId}:${d.version}`} d={d} go={go} onChanged={() => void list.reload()} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
