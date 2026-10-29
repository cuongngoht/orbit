import { Badge, Button, Caption1, Link, MessageBar, MessageBarBody, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular, ArrowDownload20Regular } from "@fluentui/react-icons";
import { mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { formatRelative } from "../../shared/format";
import { useFollow } from "../../shared/navigation/useFollow";
import { toolsApi, useToolChange, useTools } from "./tools.api";
import type { Tool } from "./tools.types";
import { FETCHES_ITSELF, SOURCE_LABEL, toolPath } from "./toolWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  rows: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" },
  row: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalL, flexWrap: "wrap", paddingBlock: tokens.spacingVerticalS, borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`, ":first-child": { borderTop: "none" } },
  who: { display: "flex", flexDirection: "column", flexGrow: 1, minWidth: "14rem" },
  muted: { color: tokens.colorNeutralForeground3 },
});

// READY is what was observed ready; everything else -- missing, unknown, an
// update to take -- needs attention. The split is the observation's, never a
// guess: a tool nobody has looked for yet is "not checked", not "missing".
export function ToolsPage() {
  const styles = useStyles();
  const tools = useTools();
  const refreshAll = useToolChange((id: string) => toolsApi.refresh(id));
  const readOnly = !mutationToken();
  const all = tools.data ?? [];
  const refresh = () => Promise.all(all.map((t) => refreshAll.mutateAsync(t.id)));
  return (
    <>
      <PageHeader
        title="Tools & Runtimes"
        description="The CLI tools Orbit can use, where each was found, and a private install where one is verified. Install puts that private copy in place now. For a tool marked as one Orbit fetches itself, Orbit may also fetch the same pinned, checksum-verified copy by itself the first time a task needs it. Nothing else is installed, and nothing on PATH changes."
        actions={
          <Button icon={<ArrowClockwise20Regular />} disabled={readOnly || refreshAll.isPending || !all.length} onClick={refresh}>
            {refreshAll.isPending ? "Checking…" : "Check again"}
          </Button>
        }
      />
      <div className={styles.stack}>
        {tools.isPending && <LoadingState label="Loading tools…" />}
        {tools.isError && <ErrorState error={tools.error} title="Could not list tools" onRetry={() => tools.refetch()} />}
        {refreshAll.isError && <ErrorState error={refreshAll.error} title="A check did not finish" />}
        {tools.data && !all.some((t) => t.checkedAt) && (
          <MessageBar intent="info">
            <MessageBarBody>Nothing has been checked on this machine yet. Press Check again to look for each tool.</MessageBarBody>
          </MessageBar>
        )}
        {tools.data && (
          <>
            <Card title="Ready">
              <Rows tools={all.filter((t) => t.status === "ready" && !t.update)} empty="No tool has been found ready yet." />
            </Card>
            <Card title="Needs attention">
              <Rows tools={all.filter((t) => t.status !== "ready" || t.update)} empty="Nothing needs attention." />
            </Card>
          </>
        )}
      </div>
    </>
  );
}

function Rows({ tools, empty }: { tools: Tool[]; empty: string }) {
  const styles = useStyles();
  const follow = useFollow();
  if (!tools.length) return <Text className={styles.muted}>{empty}</Text>;
  return (
    <ul className={styles.rows}>
      {tools.map((t) => (
        <li key={t.id} className={styles.row}>
          <div className={styles.who}>
            <Link href={toolPath(t.id)} onClick={follow(toolPath(t.id))}>
              <Text weight="semibold">{t.name}</Text>
            </Link>
            <Caption1 className={styles.muted}>{t.summary}</Caption1>
            {t.autonomous && t.install.supported && t.status !== "ready" && <Caption1 className={styles.muted}>{FETCHES_ITSELF}</Caption1>}
          </div>
          <Line tool={t} />
          {t.status === "missing" && t.install.supported && <InstallButton tool={t} />}
          <Link href={toolPath(t.id)} onClick={follow(toolPath(t.id))} aria-label={`Details for ${t.name}`}>
            {t.status === "missing" && !t.install.supported ? "How to get it" : "Details"}
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Installing is explicit and one tool at a time; what it did (or why it did
// not) is said right here, and the detail page has the receipt.
export function InstallButton({ tool, update = false }: { tool: Tool; update?: boolean }) {
  const install = useToolChange(update ? toolsApi.update : toolsApi.install);
  const readOnly = !mutationToken();
  return (
    <span>
      <Button appearance="primary" icon={<ArrowDownload20Regular />} disabled={readOnly || install.isPending} onClick={() => install.mutate(tool.id)} aria-label={`${update ? "Update" : "Install"} ${tool.name}`}>
        {install.isPending ? "Installing…" : update ? `Update to ${tool.update?.to ?? tool.install.version}` : "Install"}
      </Button>
      {install.isError && <ErrorState error={install.error} title={`${tool.name} was not installed`} />}
      {install.isSuccess && (
        <MessageBar intent="success">
          <MessageBarBody>{install.data.receipt.reused ? `An existing Orbit install of ${install.data.receipt.version} was verified and reused.` : `Installed ${tool.name} ${install.data.receipt.version} for Orbit, verified${install.data.receipt.checksum ? ` (${install.data.receipt.checksum.slice(0, 19)}…)` : ""}.`}</MessageBarBody>
        </MessageBar>
      )}
    </span>
  );
}

function Line({ tool }: { tool: Tool }) {
  const styles = useStyles();
  if (tool.status === "ready")
    return (
      <Caption1>
        {tool.version ?? "version unknown"} · {SOURCE_LABEL[tool.source ?? ""] ?? tool.source}
        {tool.update && <Badge appearance="tint" color="warning">{` update ${tool.update.to} available`}</Badge>}
      </Caption1>
    );
  if (tool.status === "missing") return <Badge appearance="tint" color="danger">Not installed</Badge>;
  return <Caption1 className={styles.muted}>{tool.checkedAt ? `checked ${formatRelative(tool.checkedAt)}, out of date` : "not checked yet"}</Caption1>;
}
