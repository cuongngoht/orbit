import { Badge, Caption1, Text, makeStyles, tokens } from "@fluentui/react-components";
import { formatRelative } from "../../shared/format";
import type { ConnectionTest } from "./connections.types";
import { checkColor } from "./connectionWords";

const useStyles = makeStyles({
  checks: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  check: { display: "flex", gap: tokens.spacingHorizontalM, alignItems: "baseline", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
});

// One connection test, check by check: a missing permission is named, and a
// part of the report that needs it will say so rather than show a zero.
export function Checks({ test }: { test: ConnectionTest }) {
  const styles = useStyles();
  return (
    <>
      <Caption1 className={styles.muted}>
        {test.ok ? "Everything this report reads is readable" : "Something this report reads is not readable"} · {formatRelative(test.at)}
        {test.identity ? ` · as ${test.identity}` : ""}
      </Caption1>
      <ul className={styles.checks} aria-label="Checks">
        {test.checks.map((c) => (
          <li key={c.id} className={styles.check}>
            <Badge appearance="tint" color={checkColor(c)}>{c.status}</Badge>
            <Text weight="semibold">{c.id}</Text>
            {c.permission && c.status !== "ok" && <Caption1>needs {c.permission}</Caption1>}
            {c.message && <Caption1 className={styles.muted}>{c.message}</Caption1>}
          </li>
        ))}
      </ul>
    </>
  );
}
