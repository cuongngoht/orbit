import type { ReactNode } from "react";
import { Caption1, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { ChevronRight16Regular } from "@fluentui/react-icons";
import { useFollow } from "../navigation/useFollow";

// One number with its label: the analytics tiles and Mission Control's counters are the same tile.
interface StatTileProps {
  label: string;
  value: string;
  caption?: ReactNode;
  /** A status icon beside the value, and the word it stands for -- status is never carried by color alone. */
  status?: { icon: ReactNode; label: string };
  /** Makes the whole tile a link to the view that explains the number. */
  href?: string;
}

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalXS,
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    textDecorationLine: "none",
    minWidth: 0,
  },
  link: {
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover, ...shorthands.borderColor(tokens.colorNeutralStroke1Hover) },
    ":focus-visible": { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`, outlineOffset: "2px" },
  },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: tokens.spacingHorizontalS },
  label: { color: tokens.colorNeutralForeground2 },
  // The one mark that tells a tile you can open from a tile you can only read.
  chevron: { color: tokens.colorNeutralForeground3, flexShrink: 0 },
  // Proportional figures: tabular digits look loose at display size.
  value: { fontSize: tokens.fontSizeHero800, lineHeight: tokens.lineHeightHero800, fontWeight: tokens.fontWeightSemibold },
  valueRow: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS },
  caption: { color: tokens.colorNeutralForeground3 },
});

export function StatTile({ label, value, caption, status, href }: StatTileProps) {
  const styles = useStyles();
  const follow = useFollow();
  const body = (
    <>
      <span className={styles.head}>
        <Text className={styles.label}>{label}</Text>
        {href && <ChevronRight16Regular className={styles.chevron} aria-hidden />}
      </span>
      <span className={styles.valueRow}>
        {status?.icon}
        {/* The word rides INSIDE the value, so it is read "Warning: 1" -- two inline siblings would read "Warning1". */}
        <span className={styles.value}>
          {status && <span className="visually-hidden">{status.label}: </span>}
          {value}
        </span>
      </span>
      {caption && <Caption1 className={styles.caption}>{caption}</Caption1>}
    </>
  );
  if (!href) return <div className={styles.root}>{body}</div>;
  return (
    <a className={mergeClasses(styles.root, styles.link)} href={href} onClick={follow(href)}>
      {body}
    </a>
  );
}
