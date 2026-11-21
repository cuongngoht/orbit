// System Status: the programs, the plugin, the storage and the database this container uses, and the versions it was
// built with. The database is said as PostgreSQL answers about itself -- reachable, the schema applied, pgvector enabled --
// and never by its address, its user or a connection string.
import { Text, makeStyles, tokens } from "@fluentui/react-components";
import { CheckmarkCircle16Filled, DismissCircle16Filled } from "@fluentui/react-icons";
import type { ComponentCheck, DatabaseCheck, SetupStatus } from "@orbit-web/contracts";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "14px" },
  table: { display: "grid", gridTemplateColumns: "max-content minmax(0, 1fr)", columnGap: "16px", rowGap: "6px", alignItems: "center", "@media (max-width: 639px)": { gridTemplateColumns: "1fr", rowGap: "4px" } },
  ok: { color: tokens.colorPaletteGreenForeground1, verticalAlign: "middle" },
  bad: { color: tokens.colorPaletteRedForeground1, verticalAlign: "middle" },
  muted: { color: tokens.colorNeutralForeground3, overflowWrap: "anywhere" },
  mono: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
});

function Check({ label, check }: { label: string; check: ComponentCheck }) {
  const s = useStyles();
  return (
    <>
      <Text>{label}</Text>
      <Text>
        {check.ok ? <CheckmarkCircle16Filled className={s.ok} aria-label="ok" /> : <DismissCircle16Filled className={s.bad} aria-label="not ok" />} <span className={s.muted}>{check.detail ?? (check.ok ? "ok" : "not usable")}</span>
      </Text>
    </>
  );
}

// What the database row says: PostgreSQL's own version, the schema applied against the one this build needs, and
// pgvector's version -- or, when it does not answer, what the health check said.
function databaseLine(db: DatabaseCheck): string {
  const server = db.server ? `PostgreSQL ${db.server}` : "PostgreSQL";
  const schema = db.schema === null ? "no schema applied" : db.schema === db.latestSchema ? `schema ${db.schema}` : `schema ${db.schema} of ${db.latestSchema}`;
  const vector = db.pgvector ? `pgvector ${db.pgvector}` : "pgvector not enabled";
  const parts = [server, schema, vector].join(" · ");
  return db.ok ? parts : `${db.detail ?? "not usable"} (${parts})`;
}

function Database({ check }: { check: DatabaseCheck }) {
  const s = useStyles();
  return (
    <>
      <Text>Database</Text>
      <Text>
        {check.ok ? <CheckmarkCircle16Filled className={s.ok} aria-label="ok" /> : <DismissCircle16Filled className={s.bad} aria-label="not ok" />} <span className={s.muted}>{databaseLine(check)}</span>
      </Text>
    </>
  );
}

export function SystemCard({ status }: { status: SetupStatus | null }) {
  const s = useStyles();
  if (status === null) return null;
  const v = status.versions;
  return (
    <section className={s.root} aria-label="System Status">
      <Text className={s.muted}>{status.health.status === "ok" ? "Everything is in place." : "Something here is not usable."}</Text>
      <div className={s.table}>
        <Check label="Claude CLI" check={status.health.claude} />
        <Check label="GitHub CLI" check={status.health.gh} />
        <Check label="Git" check={status.health.git} />
        <Check label="Azure CLI (optional)" check={status.health.az} />
        <Check label="Python (optional)" check={status.health.python} />
        <Check label="Orbit plugin" check={status.health.orbitPlugin} />
        <Check label="Storage" check={status.health.storage} />
        <Database check={status.health.database} />
        <Text>Orbit Engine</Text>
        <Text className={s.mono}>
          {v.orbit ?? "unknown"}
          {v.orbitCommit ? ` (${v.orbitCommit.slice(0, 12)})` : ""}
        </Text>
        <Text>Orbit Web</Text>
        <Text className={s.mono}>{v.web}</Text>
        <Text>Node.js</Text>
        <Text className={s.mono}>{v.node}</Text>
      </div>
    </section>
  );
}
