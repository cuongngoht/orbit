import { Badge, Button, Caption1, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useParams } from "react-router";
import { mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { formatDateTime, formatRelative } from "../../shared/format";
import { toolsApi, useTool, useToolChange } from "./tools.api";
import type { Tool } from "./tools.types";
import { InstallButton } from "./ToolsPage";
import { SOURCE_LABEL } from "./toolWords";

const useStyles = makeStyles({
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(20rem, 1fr))", gap: tokens.spacingHorizontalL, alignItems: "start" },
  facts: { display: "grid", gridTemplateColumns: "auto 1fr", columnGap: tokens.spacingHorizontalXL, rowGap: tokens.spacingVerticalS, margin: 0 },
  dd: { margin: 0, overflowWrap: "anywhere" },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  muted: { color: tokens.colorNeutralForeground3 },
  install: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, alignItems: "flex-start" },
});

// `/tools/:id`: where the tool was looked for, in the order it is looked for,
// what each place answered, and -- only if a verified private install exists
// for this machine -- the button that installs it.
export function ToolDetailPage() {
  const { id = "" } = useParams();
  const tool = useTool(id);
  if (tool.isPending) return <LoadingState label="Loading the tool…" />;
  if (tool.isError) return <ErrorState error={tool.error} title="Could not load the tool" onRetry={() => tool.refetch()} />;
  return <Detail tool={tool.data} />;
}

function Detail({ tool }: { tool: Tool }) {
  const styles = useStyles();
  const refresh = useToolChange(toolsApi.refresh);
  return (
    <>
      <PageHeader
        title={tool.name}
        description={tool.summary}
        badges={<StatusBadge tool={tool} />}
        actions={
          <Button icon={<ArrowClockwise20Regular />} disabled={!mutationToken() || refresh.isPending} onClick={() => refresh.mutate(tool.id)}>
            {refresh.isPending ? "Checking…" : "Check again"}
          </Button>
        }
      />
      {refresh.isError && <ErrorState error={refresh.error} title="The check did not finish" />}
      <div className={styles.grid}>
        <Card title="Status">
          <Facts
            rows={[
              ["Status", statusWord(tool)],
              ["Version", tool.version ?? "—"],
              ["Source", tool.source ? SOURCE_LABEL[tool.source] ?? tool.source : "—"],
              ["Path", tool.path ?? "—"],
              ["Checked", tool.checkedAt ? `${formatDateTime(tool.checkedAt)} (${formatRelative(tool.checkedAt)})${tool.stale ? " — out of date" : ""}` : "Never"],
              ["Wanted", tool.enabled ? "Yes" : "No — switched off"],
            ]}
          />
        </Card>
        <Card title="Provides">
          <ul className={styles.list}>
            {tool.provides.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Card>
        <Card title="Detected sources" subtitle="Looked for in this order; the first that answers wins.">
          <Sources tool={tool} />
        </Card>
        <Card title="Installation">
          <Installation tool={tool} />
        </Card>
      </div>
    </>
  );
}

function StatusBadge({ tool }: { tool: Tool }) {
  if (tool.status === "ready") return <Badge appearance="tint" color="success">Ready</Badge>;
  if (tool.status === "missing") return <Badge appearance="tint" color="danger">Not installed</Badge>;
  return <Badge appearance="tint" color="informative">Not checked</Badge>;
}

const statusWord = (t: Tool) => ({ ready: "Ready", missing: t.reason ? `Not usable — ${t.reason}` : "Not installed", unknown: "Unknown — not checked, or the check is out of date" })[t.status];

function Facts({ rows }: { rows: [string, string][] }) {
  const styles = useStyles();
  return (
    <dl className={styles.facts}>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "contents" }}>
          <dt>
            <Text weight="semibold">{k}</Text>
          </dt>
          <dd className={styles.dd}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Sources({ tool }: { tool: Tool }) {
  const styles = useStyles();
  if (!tool.sources.length) return <Text className={styles.muted}>Nothing has been looked for yet.</Text>;
  return (
    <Facts
      rows={tool.sources.map((s) => [SOURCE_LABEL[s.source] ?? s.source, s.found ? `${s.ok ? s.version ?? "found" : `found, not usable${s.reason ? ` — ${s.reason}` : ""}`}${s.path ? ` · ${s.path}` : ""}` : s.source === "orbit-managed" ? "not installed" : "not found"])}
    />
  );
}

function Installation({ tool }: { tool: Tool }) {
  const styles = useStyles();
  return (
    <div className={styles.install}>
      {tool.managed && (
        <Text>
          Orbit Managed {tool.managed.version}
          {tool.managed.installedAt ? `, installed ${formatDateTime(tool.managed.installedAt)}` : ""}
          {tool.managed.checksum ? <Caption1 className={styles.muted}> · verified {tool.managed.checksum.slice(0, 19)}…</Caption1> : null}
        </Text>
      )}
      {tool.install.supported ? (
        <>
          <Text>Install privately for Orbit{tool.install.version ? ` — version ${tool.install.version}` : ""}. It goes into Orbit's own store: not the plugin, not the project, not PATH.</Text>
          {tool.install.source && <Caption1 className={styles.muted}>From {tool.install.source}, checked against its published SHA-256.</Caption1>}
          {tool.status !== "ready" && <InstallButton tool={tool} />}
          {tool.update && <InstallButton tool={tool} update />}
          {tool.status === "ready" && !tool.update && <Caption1 className={styles.muted}>Already usable here, so nothing needs installing.</Caption1>}
        </>
      ) : (
        <Text>{tool.install.reason ?? tool.install.instructions ?? "Orbit does not install this tool."}</Text>
      )}
    </div>
  );
}
