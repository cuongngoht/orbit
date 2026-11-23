// System Status: the programs, the plugin, the storage and the database this container uses, and the versions it was
// built with -- and, under Updates, whether each one's publisher has a newer release (asked when a person checks, and
// daily) and how it reaches this installation without waiting for a new Orbit Web. The database is said as PostgreSQL answers about itself -- reachable, the schema applied, pgvector enabled --
// and never by its address, its user or a connection string.
import { Badge, Button, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowSync16Regular, CheckmarkCircle16Filled, DismissCircle16Filled } from "@fluentui/react-icons";
import { UPDATE_LABELS, type ComponentCheck, type ComponentUpdate, type DatabaseCheck, type SetupStatus, type SystemUpdates } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useI18n, type MessageKey, type MessageVars } from "../../i18n";
import { errorText, get, send } from "../../services/api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "14px" },
  table: { display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", columnGap: "16px", rowGap: "6px", alignItems: "center", "@media (max-width: 639px)": { gridTemplateColumns: "1fr", rowGap: "4px" } },
  ok: { color: tokens.colorPaletteGreenForeground1, verticalAlign: "middle" },
  bad: { color: tokens.colorPaletteRedForeground1, verticalAlign: "middle" },
  muted: { color: tokens.colorNeutralForeground3, overflowWrap: "anywhere" },
  mono: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
  updates: { display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" },
  updatesTable: { width: "100%", overflowX: "auto" },
  how: { display: "flex", flexDirection: "column", gap: "4px", paddingTop: "8px", paddingRight: "12px", paddingBottom: "8px", paddingLeft: "12px", borderRadius: "10px", backgroundColor: tokens.colorNeutralBackground2 },
});

function Check({ label, check }: { label: string; check: ComponentCheck }) {
  const { t } = useI18n();
  const s = useStyles();
  return (
    <>
      <Text>{label}</Text>
      <Text>
        {check.ok ? <CheckmarkCircle16Filled className={s.ok} aria-label={t("settings.system.ok")} /> : <DismissCircle16Filled className={s.bad} aria-label={t("settings.system.notOk")} />} <span className={s.muted}>{check.detail ?? (check.ok ? t("settings.system.ok") : t("settings.system.notUsable"))}</span>
      </Text>
    </>
  );
}

// What the database row says: PostgreSQL's own version, the schema applied against the one this build needs, and
// pgvector's version -- or, when it does not answer, what the health check said.
function databaseLine(db: DatabaseCheck, t: (k: MessageKey, v?: MessageVars) => string): string {
  const server = db.server ? `PostgreSQL ${db.server}` : "PostgreSQL";
  const schema = db.schema === null ? t("settings.system.db.noSchema") : db.schema === db.latestSchema ? t("settings.system.db.schemaExact", { schema: db.schema }) : t("settings.system.db.schemaOf", { schema: db.schema, latest: db.latestSchema });
  const vector = db.pgvector ? t("settings.system.db.pgvector", { version: db.pgvector }) : t("settings.system.db.pgvectorNone");
  const parts = [server, schema, vector].join(" · ");
  return db.ok ? parts : `${db.detail ?? t("settings.system.notUsable")} (${parts})`;
}

function Database({ check }: { check: DatabaseCheck }) {
  const { t } = useI18n();
  const s = useStyles();
  return (
    <>
      <Text>{t("settings.system.db.label")}</Text>
      <Text>
        {check.ok ? <CheckmarkCircle16Filled className={s.ok} aria-label={t("settings.system.ok")} /> : <DismissCircle16Filled className={s.bad} aria-label={t("settings.system.notOk")} />} <span className={s.muted}>{databaseLine(check, t)}</span>
      </Text>
    </>
  );
}

// One component's word: what the check found, said as plainly as it is known.
function UpdateState({ u }: { u: ComponentUpdate }) {
  const { t } = useI18n();
  const s = useStyles();
  if (u.state === "update_available")
    return u.security === true ? (
      <Badge appearance="filled" color="danger" size="small">
        {t("settings.system.updates.security")}
      </Badge>
    ) : (
      <Badge appearance="filled" color="warning" size="small">
        {t("settings.system.updates.available")}
      </Badge>
    );
  if (u.state === "up_to_date")
    return (
      <Badge appearance="tint" color="success" size="small">
        {t("settings.system.updates.upToDate")}
      </Badge>
    );
  const said = u.detail === "Not checked yet." ? t("settings.system.updates.notCheckedYetShort") : t("settings.system.updates.detail", { prefix: u.state === "unknown" ? t("settings.system.updates.couldntCheck") : t("settings.system.updates.notChecked"), reason: u.detail ?? t("settings.system.updates.noReason") });
  return <Text className={s.muted}>{said}</Text>;
}

function summary(u: SystemUpdates, t: (k: MessageKey, v?: MessageVars) => string): string {
  if (u.checkedAt === null) return t("settings.system.updates.summaryUnchecked");
  const n = u.components.filter((c) => c.state === "update_available").length;
  const result = n === 0 ? t("settings.system.updates.nothingNewer") : n === 1 ? t("settings.system.updates.oneAvailable") : t("settings.system.updates.manyAvailable", { count: n });
  return t("settings.system.updates.summaryChecked", { when: new Date(u.checkedAt).toLocaleString(), result });
}

// Whether each component's publisher has a newer release; a check is a person's (and the server's, once a day).
function Updates() {
  const { t } = useI18n();
  const s = useStyles();
  const read = useResource<SystemUpdates>(() => get("/api/system/updates"), []);
  const [checked, setChecked] = useState<SystemUpdates | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const u = checked ?? read.data;
  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setChecked(await send<SystemUpdates>("POST", "/api/system/updates/check"));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={s.updates} aria-label={t("settings.system.updates.title")}>
      <div className={s.head}>
        <Text weight="semibold">{t("settings.system.updates.title")}</Text>
        <Button size="small" icon={<ArrowSync16Regular />} disabled={busy} onClick={() => void check()}>
          {busy ? t("settings.system.updates.checking") : t("settings.system.updates.check")}
        </Button>
      </div>
      {error !== null && <Text className={s.bad}>{error}</Text>}
      {u === null ? (
        <Text className={s.muted}>{read.error ?? t("settings.system.updates.reading")}</Text>
      ) : (
        <>
          <Text className={s.muted}>{summary(u, t)}</Text>
          <div className={s.updatesTable}>
            <Table size="small" aria-label={t("settings.system.updates.tableAria")}>
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>{t("settings.system.updates.colComponent")}</TableHeaderCell>
                  <TableHeaderCell>{t("settings.system.updates.colHere")}</TableHeaderCell>
                  <TableHeaderCell>{t("settings.system.updates.colNewest")}</TableHeaderCell>
                  <TableHeaderCell>{t("settings.system.updates.colState")}</TableHeaderCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {u.components.map((c) => (
                  <TableRow key={c.component}>
                    <TableCell>{UPDATE_LABELS[c.component]}</TableCell>
                    <TableCell className={s.mono}>{c.installed ?? "—"}</TableCell>
                    <TableCell className={s.mono}>{c.latest ?? "—"}</TableCell>
                    <TableCell>
                      <UpdateState u={c} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className={s.how}>
            <Text size={200} className={s.muted}>
              {t("settings.system.updates.how")}
            </Text>
            {u.howToUpdate.map((line) => (
              <Text key={line} size={200} className={s.mono}>
                {line}
              </Text>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function SystemCard({ status }: { status: SetupStatus | null }) {
  const { t } = useI18n();
  const s = useStyles();
  if (status === null) return null;
  const v = status.versions;
  return (
    <section className={s.root} aria-label={t("settings.system.aria")}>
      <Text className={s.muted}>{status.health.status === "ok" ? t("settings.system.statusOk") : t("settings.system.statusBad")}</Text>
      <div className={s.table}>
        <Check label={t("settings.system.check.claude")} check={status.health.claude} />
        <Check label={t("settings.system.check.gh")} check={status.health.gh} />
        <Check label={t("settings.system.check.git")} check={status.health.git} />
        <Check label={t("settings.system.check.az")} check={status.health.az} />
        <Check label={t("settings.system.check.python")} check={status.health.python} />
        <Check label={t("settings.system.check.orbitPlugin")} check={status.health.orbitPlugin} />
        <Check label={t("settings.system.check.storage")} check={status.health.storage} />
        <Database check={status.health.database} />
        <Text>{t("settings.system.label.orbitEngine")}</Text>
        <Text className={s.mono}>
          {v.orbit ?? t("settings.connections.unknown")}
          {v.orbitCommit ? ` (${v.orbitCommit.slice(0, 12)})` : ""}
        </Text>
        <Text>{t("settings.system.label.orbitWeb")}</Text>
        <Text className={s.mono}>{v.web}</Text>
        <Text>{t("settings.system.label.codex")}</Text>
        <Text className={s.mono}>{v.codex ?? t("settings.system.notInImage")}</Text>
        <Text>{t("settings.system.label.agy")}</Text>
        <Text className={s.mono}>{v.agy ?? t("settings.system.notInImage")}</Text>
        <Text>{t("settings.system.label.node")}</Text>
        <Text className={s.mono}>{v.node}</Text>
      </div>
      <Updates />
    </section>
  );
}
