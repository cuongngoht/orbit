// GOVERNANCE → EMPLOYEE DESKS (ADR 0061): every employee's desk -- of those in the office, of those who left (archived, or
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
import { t as tr, useI18n, type MessageKey } from "../../i18n";
import { errorText, get, ifMatch, isStale, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { sizeText } from "../resources/format";
import { DeskBrowser } from "./DeskBrowser";
import { Card, EmptyState, ErrorBar, Word, useParts, when } from "./parts";

const LEFT_KEYS: Record<string, MessageKey> = { archived: "governance.desks.word.archived", deleted: "governance.desks.word.deleted" };
const GROUPS: { nameKey: MessageKey; has: (d: EmployeeDesk) => boolean }[] = [
  { nameKey: "governance.desks.group.office", has: (d) => d.employment !== "archived" && d.employment !== "deleted" },
  { nameKey: "governance.desks.group.left", has: (d) => d.employment === "archived" },
  { nameKey: "governance.desks.group.deleting", has: (d) => d.employment === "deleted" },
];

// What was measured in the desk and its cache, and when -- or that nothing was yet.
const measuredText = (d: EmployeeDesk): string => {
  if (d.deskUsedMiB === null) return tr("governance.desks.notMeasuredYet");
  const cache = d.cacheUsedMiB !== null && d.cacheMiB > 0 ? tr("governance.desks.measuredCache", { used: sizeText(d.cacheUsedMiB) }) : "";
  const at = d.measuredAt !== null ? ` · ${when(d.measuredAt)}` : "";
  return tr("governance.desks.measured", { used: sizeText(d.deskUsedMiB), cache, at });
};

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
  const { t } = useI18n();
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
      await send("POST", `/api/employees/${encodeURIComponent(d.employeeId)}/employment`, { command: "delete", reason: t("governance.desks.deleteReason") }, ifMatch(d.version));
      onChanged();
    } catch (err) {
      setError(isStale(err) ? t("governance.desks.staleDelete") : errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={<>{d.name} <Word value={d.employment} label={LEFT_KEYS[d.employment] ? t(LEFT_KEYS[d.employment]) : undefined} /></>} icon={<DesksIcon size={18} />} tone="neutral" label={d.name}>
      {left ? (
        <Text size={200} className={s.muted}>
          {deleting ? t("governance.desks.deletedByOwner") : t("governance.desks.leftPrefix")} {when(d.leftAt)}
          {d.reason ? ` · ${d.reason}` : ""}
        </Text>
      ) : (
        <Text size={200} className={s.muted}>
          {t("governance.desks.deskVersion", { version: d.deskVersion })}
          {d.sandbox !== null && d.sandbox.state !== "READY" ? t("governance.desks.sandboxState", { state: d.sandbox.state }) : ""}
        </Text>
      )}
      <Text>
        {t("governance.desks.holdsStorage", {
          held: sizeText(held),
          desk: sizeText(d.deskMiB),
          cache: d.cacheMiB > 0 ? t("governance.desks.cachePart", { cache: sizeText(d.cacheMiB) }) : "",
          measured: measuredText(d),
        })}
      </Text>
      {d.busy && !left && <Text size={200} className={s.muted}>{t("governance.desks.holdsWorkNow")}</Text>}
      {deleting ? (
        <Spinner size="tiny" label={d.sandbox?.reason ?? t("governance.desks.beingDeleted")} labelPosition="after" />
      ) : (
        <div className={s.row}>
          {d.canBrowse && (
            <Button size="small" icon={<FolderOpen16Regular />} onClick={() => go("desks", d.employeeId)}>
              {t("governance.desks.openDesk")}
            </Button>
          )}
          {left && (
            <Button size="small" icon={<Delete16Regular />} disabled={busy} onClick={() => setConfirm(true)}>
              {t("governance.desks.deleteDeskEllipsis")}
            </Button>
          )}
        </div>
      )}
      <ErrorBar text={error} />
      {confirm && (
        <Dialog open onOpenChange={(_, v) => !v.open && setConfirm(false)}>
          <DialogSurface className="orbit-touch">
            <DialogBody>
              <DialogTitle>{t("governance.desks.deleteConfirmTitle", { name: d.name })}</DialogTitle>
              <DialogContent>
                {t("governance.desks.deleteConfirmBody", { held: sizeText(held) })}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setConfirm(false)}>{t("governance.approval.cancel")}</Button>
                <Button appearance="primary" onClick={() => void remove()}>
                  {t("governance.desks.deleteDesk")}
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
  const { t } = useI18n();
  const s = useParts();
  const st = useStyles();
  const list = useResource<EmployeeDeskList>(() => get("/api/office/desks"), []);
  useAppEvent("office.changed", (e) => e.data.areas.includes("roster") && void list.reload());
  if (list.data === null) return list.error ? <MessageBar intent="error"><MessageBarBody>{list.error}</MessageBarBody></MessageBar> : <Spinner label={t("governance.desks.readingDesks")} />;
  const { desks, storage } = list.data;
  const pct = storage.budgetMiB > 0 ? Math.min(100, Math.round((storage.committedMiB / storage.budgetMiB) * 100)) : 0;
  return (
    <div className={s.page}>
      <Card
        title={t("governance.desks.title")}
        icon={<DesksIcon size={18} />}
        tone="neutral"
        description={t("governance.desks.description", {
          committed: sizeText(storage.committedMiB),
          budget: sizeText(storage.budgetMiB),
        })}
      >
        <div className={st.barTrack} role="progressbar" aria-label={t("governance.desks.progressAria")} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className={st.barFill} style={{ width: `${pct}%` }} />
        </div>
        {desks.length === 0 && (
          <EmptyState
            icon={<DesksIcon size={22} />}
            tone="neutral"
            title={t("governance.desks.emptyTitle")}
            body={t("governance.desks.emptyBody")}
          />
        )}
      </Card>
      {GROUPS.map((g) => {
        const these = desks.filter(g.has);
        const groupName = t(g.nameKey);
        return these.length === 0 ? null : (
          <section key={g.nameKey} aria-label={groupName} className={s.page}>
            <Text weight="semibold">{groupName}</Text>
            {these.map((d) => (
              <Desk key={`${d.employeeId}:${d.version}`} d={d} go={go} onChanged={() => void list.reload()} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
