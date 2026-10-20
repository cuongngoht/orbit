import type { ReactNode } from "react";
import { Caption1, Subtitle2, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";

interface CardProps {
  title?: string;
  subtitle?: ReactNode;
  /** Top-right of the card: a toggle or a link that belongs to this card only. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "section" | "figure";
}

const useStyles = makeStyles({
  root: {
    margin: 0,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalM,
    padding: tokens.spacingHorizontalL,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    minWidth: 0,
  },
  head: { display: "flex", alignItems: "flex-start", gap: tokens.spacingHorizontalM },
  titles: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS, flexGrow: 1 },
  subtitle: { color: tokens.colorNeutralForeground3 },
});

export function Card({ title, subtitle, action, children, className, as: Root = "section" }: CardProps) {
  const styles = useStyles();
  return (
    <Root className={mergeClasses(styles.root, className)}>
      {(title || action) && (
        <div className={styles.head}>
          <div className={styles.titles}>
            {title && <Subtitle2 as="h2">{title}</Subtitle2>}
            {subtitle && <Caption1 className={styles.subtitle}>{subtitle}</Caption1>}
          </div>
          {action}
        </div>
      )}
      {children}
    </Root>
  );
}
