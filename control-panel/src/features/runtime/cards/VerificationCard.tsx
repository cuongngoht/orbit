import { Caption1, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, makeStyles, tokens } from "@fluentui/react-components";
import { Card } from "../../../shared/components/Card";
import { StateBadge } from "../StateBadge";
import type { RuntimeStatus } from "../runtime.types";
import { CAPABILITY_LABEL, CAPABILITY_SAY } from "../runtimeWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  muted: { color: tokens.colorNeutralForeground3 },
  code: { fontFamily: tokens.fontFamilyMonospace },
});

const ORDER = ["browser", "http", "database", "testRunner"] as const;

// What could be CHECKED right now, and nothing about whether anything is correct. An application can
// be perfectly up and wrong: a verdict belongs to a test run and to an investigation, never here.
export function VerificationCard({ status }: { status: RuntimeStatus }) {
  const styles = useStyles();
  const commands = status.verification.testRunner.commands ?? [];
  return (
    <Card title="What could be checked now" subtitle="Not a verdict. It says what a test or an investigation could reach on this machine right now.">
      <div className={styles.stack}>
        <Table aria-label="Verification" size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Capability</TableHeaderCell>
              <TableHeaderCell>Now</TableHeaderCell>
              <TableHeaderCell>Why</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ORDER.map((k) => (
              <TableRow key={k}>
                <TableCell>{CAPABILITY_LABEL[k]}</TableCell>
                <TableCell><StateBadge word={status.verification[k].state} label={CAPABILITY_SAY[status.verification[k].state]} /></TableCell>
                <TableCell>{status.verification[k].because}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {commands.length > 0 && (
          <div>
            <Caption1 className={styles.muted}>Test commands the files declare (none is chosen for a change):</Caption1>
            <ul aria-label="Declared test commands">{commands.map((c) => <li key={`${c.component}|${c.declaredAs}`}><span className={styles.code}>{c.text}</span> <Caption1 className={styles.muted}>in {c.component}{c.safe ? "" : " — shown, not launched"}</Caption1></li>)}</ul>
          </div>
        )}
      </div>
    </Card>
  );
}
