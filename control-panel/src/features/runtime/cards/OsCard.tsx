import { Badge, Caption1, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, makeStyles, tokens } from "@fluentui/react-components";
import { Card } from "../../../shared/components/Card";
import type { OsCell, OsEvidence, Platform, PlanComponent, RuntimeStatus } from "../runtime.types";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  muted: { color: tokens.colorNeutralForeground3 },
  key: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
});

const COLOR = { yes: "success", no: "danger", unknown: "informative" } as const;

// Where each component could run NATIVELY, system by system: what its own files say it requires
// decides a cell, and the matrix is per component, never one answer for the project -- a web client
// that runs anywhere beside a backend only Windows runs is both. Where the checkout's files show it
// is built is evidence, said beneath, and never a requirement.
export function OsCard({ status }: { status: RuntimeStatus }) {
  const styles = useStyles();
  const { platforms, components, osEvidence } = status.plan;
  if (!platforms.length || !components.length) return null;
  return (
    <Card title="Operating systems" subtitle="Where each component could run natively, from what its own files say it needs. Per component, never one answer for the project.">
      <div className={styles.stack}>
        <Table aria-label="Operating systems" size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Component</TableHeaderCell>
              {platforms.map((p) => (
                <TableHeaderCell key={p.id}>{p.name}</TableHeaderCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {components.map((c) => (
              <TableRow key={c.key}>
                <TableCell className={styles.key}>{c.key}</TableCell>
                {platforms.map((p) => (
                  <TableCell key={p.id}>
                    <Cell cell={c.os[p.id]} where={`${c.key} on ${p.name}`} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {components.flatMap((c) => reasons(c, platforms)).map((line) => (
          <Caption1 key={line}>{line}</Caption1>
        ))}
        {osEvidence.map((e) => (
          <Caption1 key={`${e.os.join(",")}:${e.evidence.join(",")}`} className={styles.muted}>
            {evidenceLine(e, platforms)}
          </Caption1>
        ))}
      </div>
    </Card>
  );
}

// A cell says its state, and its reason in the label a screen reader reads; the reasons are also
// written out under the table, because a status page is read, not hovered.
function Cell({ cell, where }: { cell: OsCell | undefined; where: string }) {
  const state = cell?.state ?? "unknown";
  return (
    <Badge appearance="tint" color={COLOR[state]} aria-label={`${where}: ${state}${cell?.because ? `, ${cell.because}` : ""}`}>
      {state}
    </Badge>
  );
}

// One line per component and reason: where it is not "yes", and why.
function reasons(c: PlanComponent, platforms: Platform[]): string[] {
  const by = new Map<string, string[]>();
  for (const p of platforms) {
    const because = c.os[p.id]?.state !== "yes" ? c.os[p.id]?.because : null;
    if (because) by.set(because, [...(by.get(because) ?? []), p.name]);
  }
  return [...by].map(([because, names]) => `${c.key}: ${c.os[platforms.find((p) => p.name === names[0])?.id ?? ""]?.state ?? "unknown"} on ${names.join(", ")} — ${because}`);
}

// How each kind of evidence is said: a pipeline is where it is built or run, scripts what they are written for.
const SAID: Record<string, string> = { ci: "Built or run on", script: "Its scripts are written for" };

const evidenceLine = (e: OsEvidence, platforms: Platform[]) =>
  `${SAID[e.source ?? ""] ?? "Seen on"} ${e.os.map((id) => platforms.find((p) => p.id === id)?.name ?? id).join(", ")} (${e.evidence.join(", ")}): where somebody runs it, not what it requires.`;
