import { Button, Caption1, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { mutationToken } from "../../../shared/api/client";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { StateBadge } from "../StateBadge";
import { runtimeApi, useRuntimeOperation, type StartBody } from "../runtime.api";
import type { CheckoutRef, PlanComponent, RuntimeStatus, StartResult } from "../runtime.types";
import { COMPATIBILITY_SAY, COMPONENT_SAY, OVERALL_SAY } from "../runtimeWords";
import { StartResultNote } from "./SessionsCard";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  code: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
  // A long dotted name breaks where it must, rather than running under the next column.
  name: { overflowWrap: "anywhere" },
  muted: { color: tokens.colorNeutralForeground3 },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
});

// What the checkout is made of and whether each part COULD start on this machine, with the reason
// and every way it was considered. A way that does not work is never offered: a preference chooses
// among the ways that work and cannot make an incompatible one compatible. The command is the one a
// FILE declared, shown as it would be launched -- never anything a person or a page typed.
export function ComponentsCard({ at, status }: { at: CheckoutRef; status: RuntimeStatus }) {
  const styles = useStyles();
  const start = useRuntimeOperation<StartBody, StartResult>(at, runtimeApi.start);
  const running = new Set(status.sessions.filter((s) => s.state === "RUNNING").map((s) => s.component));
  const { components, overall } = status.plan;
  return (
    <Card title="Components" subtitle={`${OVERALL_SAY[overall]}. Each part is judged on its own: one blocked part does not stop the rest.`}>
      <div className={styles.stack}>
        {components.length === 0 && <Caption1 className={styles.muted}>No component could be identified from this checkout's files.</Caption1>}
        {components.length > 0 && (
          <Table aria-label="Components" size="small">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Component</TableHeaderCell>
                <TableHeaderCell>Can it run here?</TableHeaderCell>
                <TableHeaderCell>How it starts</TableHeaderCell>
                <TableHeaderCell />
              </TableRow>
            </TableHeader>
            <TableBody>
              {components.map((c) => (
                <Row key={c.key} component={c} running={running.has(c.key)} busy={start.isPending} onStart={() => start.mutate({ component: c.key, wait: 30 })} />
              ))}
            </TableBody>
          </Table>
        )}
        {start.isError && <ErrorState error={start.error} title="It was not started" />}
        {start.data && <StartResultNote result={start.data} />}
      </div>
    </Card>
  );
}

function Row({ component: c, running, busy, onStart }: { component: PlanComponent; running: boolean; busy: boolean; onStart: () => void }) {
  const styles = useStyles();
  return (
    <TableRow>
      <TableCell>
        <Text weight="semibold" className={styles.name}>{c.name}</Text>
        <Caption1 className={styles.muted}> {c.kind}</Caption1>
        <div className={styles.code}>{c.key}</div>
      </TableCell>
      <TableCell>
        <StateBadge word={c.state} label={COMPONENT_SAY[c.state]} />
        <div><Caption1>{c.because}</Caption1></div>
        {c.blocking.some((b) => !c.because.includes(b)) && <ul className={styles.list} aria-label={`What is in the way of ${c.name}`}>{c.blocking.filter((b) => !c.because.includes(b)).map((b) => <li key={b}>{b}</li>)}</ul>}
        {c.candidates.length > 0 && (
          <details>
            <summary>Ways to run it</summary>
            <ul className={styles.list}>
              {c.candidates.map((w) => (
                <li key={w.provider}>
                  <Text weight="semibold">{w.provider}</Text>: {COMPATIBILITY_SAY[w.state]} — {w.because}
                </li>
              ))}
            </ul>
          </details>
        )}
      </TableCell>
      <TableCell>{c.command ? <><span className={styles.code}>{c.command.argv.join(" ")}</span><Caption1 className={styles.muted}> in {c.command.cwd}</Caption1></> : <Caption1 className={styles.muted}>no file declares a way to start it</Caption1>}</TableCell>
      <TableCell>
        {c.state === "ready" && c.command && (
          <Button size="small" disabled={!mutationToken() || busy || running} onClick={onStart} aria-label={`Start ${c.name}`}>
            {running ? "Running" : "Start"}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}
