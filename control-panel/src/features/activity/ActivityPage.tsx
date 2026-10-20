import { Badge, Button, Caption1, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { formatDateTime } from "../../shared/format";
import { useMcpActivity } from "../mcp/mcp.api";
import type { ActivityEvent } from "../mcp/mcp.types";

const useStyles = makeStyles({
  muted: { color: tokens.colorNeutralForeground3 },
});

const KIND: Record<ActivityEvent["kind"], { label: string; color: "success" | "danger" | "warning" | "informative" }> = {
  "mcp-started": { label: "Started", color: "informative" },
  "mcp-invoked": { label: "Called", color: "success" },
  "mcp-failed": { label: "Failed", color: "danger" },
  "mcp-blocked": { label: "Blocked", color: "warning" },
};

// What Orbit-managed MCP servers did, newest first, as the machine store's
// activity lines record it: which server, which tool, what for, how it ended.
// Never an argument, a result or a prompt -- the lines do not hold them.
export function ActivityPage() {
  const styles = useStyles();
  const activity = useMcpActivity();
  return (
    <>
      <PageHeader
        title="Activity"
        description="Every call through Orbit's MCP broker, and every one a gate stopped. Nothing here holds what was asked or answered."
        actions={
          <Button icon={<ArrowClockwise20Regular />} onClick={() => activity.refetch()} disabled={activity.isFetching}>
            Refresh
          </Button>
        }
      />
      <Card title="MCP activity" subtitle="Local to this machine: <store>/control/activity/.">
        {activity.isPending && <LoadingState label="Loading activity…" />}
        {activity.isError && <ErrorState error={activity.error} title="Could not read the activity" />}
        {activity.data && !activity.data.length && <Text className={styles.muted}>Nothing has been called through Orbit yet.</Text>}
        {activity.data && activity.data.length > 0 && (
          <Table aria-label="MCP activity" size="small">
            <TableHeader>
              <TableRow>
                {["When", "What", "Server", "Tool", "For", "Outcome"].map((h) => (
                  <TableHeaderCell key={h}>{h}</TableHeaderCell>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {activity.data.map((e, at) => (
                <TableRow key={`${e.at}:${at}`}>
                  <TableCell>{formatDateTime(e.at)}</TableCell>
                  <TableCell>
                    <Badge appearance="tint" color={KIND[e.kind]?.color ?? "informative"}>
                      {KIND[e.kind]?.label ?? e.kind}
                    </Badge>
                  </TableCell>
                  <TableCell>{e.resource ?? "—"}</TableCell>
                  <TableCell>{e.tool ?? "—"}</TableCell>
                  <TableCell>{[e.capability, e.workflow].filter(Boolean).join(" · ") || "—"}</TableCell>
                  <TableCell>
                    {e.outcome ?? "—"}
                    {e.reason && <Caption1 className={styles.muted}> — {e.reason}</Caption1>}
                    {e.ms !== undefined && <Caption1 className={styles.muted}> ({e.ms} ms)</Caption1>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
