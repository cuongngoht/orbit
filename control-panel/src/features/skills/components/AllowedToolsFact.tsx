import { Caption1, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { Wrench16Regular } from "@fluentui/react-icons";
import { describeTool, parseTool } from "../allowedTools";

const useStyles = makeStyles({
  // Above the card's stretched link: without a z-index the link's ::after
  // covers the whole card, and a pointer never reaches this to open the tooltip.
  trigger: {
    position: "relative",
    zIndex: 1,
    display: "inline-flex",
    alignItems: "center",
    gap: tokens.spacingHorizontalXXS,
    whiteSpace: "nowrap",
    cursor: "help",
    textDecorationLine: "underline",
    textDecorationStyle: "dotted",
    textUnderlineOffset: "3px",
    borderRadius: tokens.borderRadiusSmall,
    ":focus-visible": { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`, outlineOffset: "2px" },
  },
  content: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS, maxWidth: "22rem" },
  list: { margin: 0, padding: 0, listStyleType: "none", display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  tool: { fontFamily: tokens.fontFamilyMonospace, fontWeight: tokens.fontWeightSemibold },
  scope: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere", color: tokens.colorNeutralForeground2 },
  hint: { color: tokens.colorNeutralForeground3 },
});

// "N allowed tools" on a card, and on hover OR keyboard focus, which ones and
// how far each is narrowed. A Tooltip, not a Popover: the list is read, never
// clicked, so nothing inside it needs focus -- and Fluent's Tooltip already
// stays open while hovered and closes on Escape (WCAG 1.4.13).
export function AllowedToolsFact({ rules }: { rules: string[] }) {
  const styles = useStyles();
  const label = `${rules.length} allowed ${rules.length === 1 ? "tool" : "tools"}`;
  return (
    <Tooltip withArrow relationship="description" content={<ToolList rules={rules} />}>
      {/* Focusable, or a keyboard user could never open it. `description`, not
          `label`: the count stays the name, the list is read after it. */}
      <span className={styles.trigger} tabIndex={0}>
        <Wrench16Regular aria-hidden />
        {label}
      </span>
    </Tooltip>
  );
}

function ToolList({ rules }: { rules: string[] }) {
  const styles = useStyles();
  return (
    <div className={styles.content}>
      <Caption1 className={styles.hint}>Used without a permission prompt:</Caption1>
      <ul className={styles.list}>
        {rules.map(parseTool).map((t) => (
          <li key={t.rule}>
            <span className={styles.tool}>{t.tool}</span>
            {t.scope && <div className={styles.scope}>only {t.scope}</div>}
            {describeTool(t) && <Caption1 className={styles.hint}>{describeTool(t)}</Caption1>}
          </li>
        ))}
      </ul>
    </div>
  );
}
