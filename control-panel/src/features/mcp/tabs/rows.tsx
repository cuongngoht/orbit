import type { ReactNode } from "react";
import { Caption1, Link, Text, makeStyles, tokens } from "@fluentui/react-components";
import { useFollow } from "../../../shared/navigation/useFollow";

export const useRowStyles = makeStyles({
  rows: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" },
  row: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalL, flexWrap: "wrap", paddingBlock: tokens.spacingVerticalS, borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`, ":first-child": { borderTop: "none" } },
  who: { display: "flex", flexDirection: "column", flexGrow: 1, minWidth: "14rem" },
  muted: { color: tokens.colorNeutralForeground3 },
  chips: { display: "flex", gap: tokens.spacingHorizontalXS, flexWrap: "wrap" },
});

// One server in a list: its name (a link when it has a page), one line of
// what it is, and whatever badges and actions the tab puts beside it.
export function ServerRow({ name, href, line, note, children }: { name: string; href?: string; line: string; note?: string | null; children?: ReactNode }) {
  const styles = useRowStyles();
  const follow = useFollow();
  return (
    <li className={styles.row}>
      <div className={styles.who}>
        {href ? (
          <Link href={href} onClick={follow(href)}>
            <Text weight="semibold">{name}</Text>
          </Link>
        ) : (
          <Text weight="semibold">{name}</Text>
        )}
        <Caption1 className={styles.muted}>{line}</Caption1>
        {note && <Caption1>{note}</Caption1>}
      </div>
      {children}
    </li>
  );
}

export function Rows({ empty, children }: { empty: string; children: ReactNode[] }) {
  const styles = useRowStyles();
  if (!children.length) return <Text className={styles.muted}>{empty}</Text>;
  return <ul className={styles.rows}>{children}</ul>;
}
