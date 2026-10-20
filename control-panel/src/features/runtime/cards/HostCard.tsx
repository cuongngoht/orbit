import { Button, Caption1, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, makeStyles, tokens } from "@fluentui/react-components";
import { mutationToken } from "../../../shared/api/client";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { formatRelative } from "../../../shared/format";
import { StateBadge } from "../StateBadge";
import { runtimeApi, useRuntimeOperation } from "../runtime.api";
import type { CheckoutRef, DoctorResult, RuntimeStatus } from "../runtime.types";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  muted: { color: tokens.colorNeutralForeground3 },
});

// THIS machine, as far as it has been asked. A tool nobody asked about is "not known", never
// "missing"; one that did not answer in time is "not known" too. Asking costs a few commands run
// with their arguments, never a shell, and only for the tools this checkout's requirements name.
export function HostCard({ at, status }: { at: CheckoutRef; status: RuntimeStatus }) {
  const styles = useStyles();
  const doctor = useRuntimeOperation<Record<string, never>, DoctorResult>(at, (ref) => runtimeApi.doctor(ref));
  const tools = Object.entries(status.machine.tools);
  return (
    <Card title="This machine" subtitle={`${status.machine.platform} · ${status.machine.arch}. Only the tools this checkout's requirements name are asked about.`}>
      <div className={styles.stack}>
        {tools.length === 0 ? (
          <Caption1 className={styles.muted}>Nothing here needs a tool to be asked about.</Caption1>
        ) : (
          <Table aria-label="Tools on this machine" size="small">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Tool</TableHeaderCell>
                <TableHeaderCell>Answer</TableHeaderCell>
                <TableHeaderCell>Version</TableHeaderCell>
                <TableHeaderCell>Asked</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tools.map(([id, t]) => (
                <TableRow key={id}>
                  <TableCell>{id}</TableCell>
                  <TableCell><StateBadge word={t.state} label={t.state === "UNKNOWN" ? "not known" : t.state === "AVAILABLE" ? "available" : "not available"} /></TableCell>
                  <TableCell>{t.version ?? "—"}</TableCell>
                  <TableCell>{t.checkedAt ? formatRelative(t.checkedAt) : "never"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div>
          <Button disabled={!mutationToken() || doctor.isPending} onClick={() => doctor.mutate({})}>{doctor.isPending ? "Asking this machine…" : "Ask this machine"}</Button>
        </div>
        {doctor.isError && <ErrorState error={doctor.error} title="This machine could not be asked" />}
      </div>
    </Card>
  );
}
