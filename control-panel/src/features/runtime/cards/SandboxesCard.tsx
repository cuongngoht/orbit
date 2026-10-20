import { Caption1, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, makeStyles, tokens } from "@fluentui/react-components";
import { Link as RouterLink } from "react-router";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { LoadingState } from "../../../shared/components/LoadingState";
import { formatDateTime } from "../../../shared/format";
import { taskPath } from "../../mission-control/missionWords";
import { StateBadge } from "../StateBadge";
import { useSandboxes } from "../runtime.api";
import type { CheckoutRef } from "../runtime.types";
import { shortTree } from "../runtimeWords";
import type { SandboxList } from "../sandbox.types";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
});

// Every sandbox this checkout's tasks own, read off the runtime's own table. A READ: it starts nothing,
// probes nothing, and its owner is a link to the task, where the sandbox can be seen and stopped.
export function SandboxesCard({ at }: { at: CheckoutRef }) {
  const styles = useStyles();
  const list = useSandboxes(at);
  return (
    <Card title="Sandboxes" subtitle="One per task at most, each built from that task's own source tree. Open the task to stop or release one.">
      <div className={styles.stack}>
        {list.isPending && <LoadingState label="Reading this checkout's sandboxes…" />}
        {list.isError && <ErrorState error={list.error} title="Could not read this checkout's sandboxes" onRetry={() => list.refetch()} />}
        {list.data && <Rows at={at} list={list.data} />}
      </div>
    </Card>
  );
}

function Rows({ at, list }: { at: CheckoutRef; list: SandboxList }) {
  const styles = useStyles();
  if (list.sandboxes.length === 0) return <Caption1 className={styles.muted}>No task of this checkout has a sandbox.</Caption1>;
  return (
    <>
      <Table aria-label="Sandboxes" size="small">
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Task</TableHeaderCell>
            <TableHeaderCell>State</TableHeaderCell>
            <TableHeaderCell>Source tree</TableHeaderCell>
            <TableHeaderCell>Components</TableHeaderCell>
            <TableHeaderCell>Ports leased</TableHeaderCell>
            <TableHeaderCell>Updated</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.sandboxes.map((s) => (
            <TableRow key={s.id}>
              <TableCell><RouterLink to={taskPath({ ...at, task: s.owner.id })} className={styles.mono}>{s.owner.id}</RouterLink></TableCell>
              <TableCell><StateBadge word={s.state} />{s.stale && s.state !== "STALE" && s.state !== "RELEASED" ? <StateBadge word="STALE" /> : null}</TableCell>
              <TableCell><span className={styles.mono}>{shortTree(s.tree)}</span></TableCell>
              <TableCell>{s.components}</TableCell>
              <TableCell>{s.leases.length ? s.leases.join(", ") : "none"}</TableCell>
              <TableCell>{formatDateTime(s.updatedAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {list.staleLeases.length > 0 && <Caption1 className={styles.muted}>{`${list.staleLeases.length} lease(s) nobody holds any more: ${list.staleLeases.map((l) => `${l.port} (${l.component})`).join(", ")}. The next lease drops them.`}</Caption1>}
    </>
  );
}
