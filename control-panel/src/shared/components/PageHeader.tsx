import type { ReactNode } from "react";
import { Body1, Title2, makeStyles, tokens } from "@fluentui/react-components";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Above the title: where this page sits, e.g. a breadcrumb. */
  context?: ReactNode;
  /** Beside the title: what this page's buttons do to the whole page. */
  actions?: ReactNode;
  /** Right after the title: small status badges. */
  badges?: ReactNode;
}

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS, marginBottom: tokens.spacingVerticalXL },
  row: { display: "flex", alignItems: "flex-start", gap: tokens.spacingHorizontalL, flexWrap: "wrap" },
  titles: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS, flexGrow: 1, minWidth: "16rem" },
  title: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalM, flexWrap: "wrap", margin: 0 },
  description: { color: tokens.colorNeutralForeground2, maxWidth: "70ch" },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
});

// Every page opens the same way: where you are, what this is, what you can do.
// The title is the page's one <h1> -- the app's name lives in the sidebar.
export function PageHeader({ title, description, context, actions, badges }: PageHeaderProps) {
  const styles = useStyles();
  useDocumentTitle(title);
  return (
    <header className={styles.root}>
      {context}
      <div className={styles.row}>
        <div className={styles.titles}>
          <div className={styles.title}>
            <Title2 as="h1">{title}</Title2>
            {badges}
          </div>
          {description && <Body1 className={styles.description}>{description}</Body1>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </header>
  );
}
