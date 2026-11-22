// System Status: the programs, the plugin, the storage and the database this container uses, and the versions it was
// built with -- and, under Updates, whether each one's publisher has a newer release (asked when a person checks, and
// daily) and how it reaches this installation without waiting for a new Orbit Web. The database is said as PostgreSQL answers about itself -- reachable, the schema applied, pgvector enabled --
// and never by its address, its user or a connection string.
import { Badge, Button, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowSync16Regular, CheckmarkCircle16Filled, DismissCircle16Filled } from "@fluentui/react-icons";
import { UPDATE_LABELS, type ComponentCheck, type ComponentUpdate, type DatabaseCheck, type SetupStatus, type SystemUpdates } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
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

// One component's word: what the check found, said as plainly as it is known.
function UpdateState({ u }: { u: ComponentUpdate }) {
  const s = useStyles();
  if (u.state === "update_available")
    return u.security === true ? (
      <Badge appearance="filled" color="danger" size="small">
        Security update
      </Badge>
    ) : (
      <Badge appearance="filled" color="warning" size="small">
        Update available
      </Badge>
    );
  if (u.state === "up_to_date")
    return (
      <Badge appearance="tint" color="success" size="small">
        Up to date
      </Badge>
    );
  const said = u.detail === "Not checked yet." ? u.detail : `${u.state === "unknown" ? "Couldn't check" : "Not checked"}: ${u.detail ?? "no reason given"}`;
  return <Text className={s.muted}>{said}</Text>;
}

function summary(u: SystemUpdates): string {
  if (u.checkedAt === null) return "Not checked yet: the publishers are asked when you check, and once a day.";
  const n = u.components.filter((c) => c.state === "update_available").length;
  return `Checked ${new Date(u.checkedAt).toLocaleString()} · ${n === 0 ? "nothing newer found" : `${n} update${n === 1 ? "" : "s"} available`}.`;
}

// Whether each component's publisher has a newer release; a check is a person's (and the server's, once a day).
function Updates() {
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
    <section className={s.updates} aria-label="Updates">
      <div className={s.head}>
        <Text weight="semibold">Updates</Text>
        <Button size="small" icon={<ArrowSync16Regular />} disabled={busy} onClick={() => void check()}>
          {busy ? "Checking…" : "Check for updates"}
        </Button>
      </div>
      {error !== null && <Text className={s.bad}>{error}</Text>}
      {u === null ? (
        <Text className={s.muted}>{read.error ?? "Reading…"}</Text>
      ) : (
        <>
          <Text className={s.muted}>{summary(u)}</Text>
          <div className={s.updatesTable}>
            <Table size="small" aria-label="Updates of what this image holds">
              <TableHeader>
                <TableRow>
                  <TableHeaderCell>Component</TableHeaderCell>
                  <TableHeaderCell>Here</TableHeaderCell>
                  <TableHeaderCell>Newest</TableHeaderCell>
                  <TableHeaderCell>State</TableHeaderCell>
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
              These are pinned in Orbit Web's image. A newer release reaches this installation without waiting for a new Orbit Web -- an operator, in a terminal of the server:
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
        <Text>OpenAI Codex CLI</Text>
        <Text className={s.mono}>{v.codex ?? "not in this image"}</Text>
        <Text>Antigravity CLI</Text>
        <Text className={s.mono}>{v.agy ?? "not in this image"}</Text>
        <Text>Node.js</Text>
        <Text className={s.mono}>{v.node}</Text>
      </div>
      <Updates />
    </section>
  );
}
