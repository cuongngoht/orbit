import { Badge, Caption1, Link, MessageBar, MessageBarBody, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { LoadingState } from "../../../shared/components/LoadingState";
import { formatRelative } from "../../../shared/format";
import { useFollow } from "../../../shared/navigation/useFollow";
import { useConnections } from "../../connections/connections.api";
import { authLine } from "../../connections/connectionWords";
import { TestBadge } from "../../connections/ConnectionsPage";
import { useReportsOverview } from "../reports.api";
import type { ReportsOverview } from "../reports.types";
import { COLLECTION_COLOR, RUN_COLOR, isAvailable, pythonLine, reportTabPath } from "../reportWords";

const useStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(18rem, 1fr))", gap: tokens.spacingHorizontalL },
  rows: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  row: { display: "flex", gap: tokens.spacingHorizontalM, alignItems: "baseline", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  path: { fontFamily: tokens.fontFamilyMonospace, wordBreak: "break-all" },
});

export function OverviewTab() {
  const overview = useReportsOverview();
  if (overview.isPending) return <LoadingState label="Loading the report's overview…" />;
  if (overview.isError) return <ErrorState error={overview.error} title="Could not read the report" onRetry={() => overview.refetch()} />;
  if (!isAvailable(overview.data)) return <NotHere why={overview.data.why} />;
  return <Overview view={overview.data} />;
}

export const NotHere = ({ why }: { why: string }) => (
  <MessageBar intent="warning">
    <MessageBarBody>{why}</MessageBarBody>
  </MessageBar>
);

function Overview({ view }: { view: ReportsOverview }) {
  const styles = useStyles();
  const follow = useFollow();
  const providers = useConnections().data?.providers;
  return (
    <>
      <div className={styles.grid}>
        <Card title="Project" subtitle={view.project.root}>
          <Text weight="semibold">{view.project.name}</Text>
          <Caption1 className={styles.muted}>Reports land in <span className={styles.path}>{view.output}</span></Caption1>
        </Card>
        <Card title="Source" action={<Link href={reportTabPath("connection")} onClick={follow(reportTabPath("connection"))}>Change</Link>}>
          <Text>{view.provider ?? "Not chosen yet"}</Text>
          {view.connection ? (
            <>
              <Caption1>{view.connection.id} · {authLine(view.connection, providers?.find((p) => p.id === view.connection?.provider))}</Caption1>
              <TestBadge connection={view.connection} />
            </>
          ) : (
            <Caption1 className={styles.muted}>{view.connectionMissing ? "The connection these settings name is not on this machine." : "No connection chosen."}</Caption1>
          )}
        </Card>
        <Card title="Runtime" action={!view.python.ready && <Link href="/tools/python" onClick={follow("/tools/python")}>Install Python</Link>}>
          <Text>{pythonLine(view.python)}</Text>
          <Caption1 className={styles.muted}>The report's computations run on a Python Orbit manages or one already here; nothing on PATH is changed.</Caption1>
        </Card>
      </div>
      {view.latest && <Latest latest={view.latest} />}
      <Card title="Runs" subtitle="Newest first. Each run is one collection, frozen; rendering again reads the same collection.">
        {view.runs.length ? (
          <ul className={styles.rows}>
            {view.runs.map((r) => (
              <li key={r.runId} className={styles.row}>
                <Badge appearance="tint" color={RUN_COLOR[r.status] ?? "informative"}>{r.status}</Badge>
                <Text weight="semibold">{r.window ? `${r.window.from ?? "start"} → ${r.window.to}` : r.runId}</Text>
                <Caption1 className={styles.muted}>{r.runId} · {r.renders} render(s)</Caption1>
                {r.report && <Caption1 className={styles.path}>{r.report}</Caption1>}
              </li>
            ))}
          </ul>
        ) : (
          <Caption1>No report has been run for this project yet.</Caption1>
        )}
      </Card>
    </>
  );
}

function Latest({ latest }: { latest: NonNullable<ReportsOverview["latest"]> }) {
  const styles = useStyles();
  return (
    <Card title="Latest run" subtitle={`${latest.window.from ?? "start"} → ${latest.window.to} · cut-off ${latest.window.cutoff} · ${latest.window.tz}${latest.render ? ` · rendered ${formatRelative(latest.render.at)}` : ""}`}>
      <ul className={styles.rows} aria-label="Data coverage">
        {Object.entries(latest.completeness).map(([name, c]) => (
          <li key={name} className={styles.row}>
            <Badge appearance="tint" color={COLLECTION_COLOR[c.status] ?? "warning"}>{c.status}</Badge>
            <Text>{name}</Text>
            {c.reason && <Caption1 className={styles.muted}>{c.reason}</Caption1>}
          </li>
        ))}
      </ul>
      {latest.render && (
        <ul className={styles.rows} aria-label="Parts">
          {latest.render.parts.map((p) => (
            <li key={p.id} className={styles.row}>
              <Badge appearance="outline" color={p.status === "ok" ? "success" : "danger"}>{p.status}</Badge>
              <Text>{p.id} {p.version}</Text>
              {p.error && <Caption1 className={styles.muted}>{p.error}</Caption1>}
            </li>
          ))}
          {latest.render.skipped.map((s) => (
            <li key={s.id} className={styles.row}>
              <Badge appearance="outline">left out</Badge>
              <Text>{s.id}</Text>
              <Caption1 className={styles.muted}>{s.why}</Caption1>
            </li>
          ))}
        </ul>
      )}
      {latest.render?.warning && (
        <MessageBar intent="warning">
          <MessageBarBody>{latest.render.warning}</MessageBarBody>
        </MessageBar>
      )}
    </Card>
  );
}
