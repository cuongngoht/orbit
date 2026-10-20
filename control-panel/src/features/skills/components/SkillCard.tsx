import { Badge, Button, Caption1, Link, Text, Tooltip, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Bot16Regular, Clock16Regular, Delete16Regular, DocumentMultiple16Regular, Person16Regular } from "@fluentui/react-icons";
import { formatBytes, formatDateTime, formatRelative } from "../../../shared/format";
import { useFollow } from "../../../shared/navigation/useFollow";
import type { SkillSummary } from "../api/skills.types";
import { attentionOf } from "../attention";
import { AllowedToolsFact } from "./AllowedToolsFact";
import { editPath } from "../paths";

interface SkillCardProps {
  skill: SkillSummary;
  readOnly: boolean;
  onDelete: (skill: SkillSummary) => void;
}

const useStyles = makeStyles({
  // The whole card is the click target, but only ONE element is the link: the
  // name's ::after stretches over the card. A card wrapped in an <a> would put
  // the Delete button inside a link, and a screen reader would read every word
  // of the card as the link's name.
  root: {
    position: "relative",
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: tokens.spacingVerticalS,
    padding: tokens.spacingHorizontalL,
    minWidth: 0,
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow2,
    transitionProperty: "box-shadow, border-color, transform",
    transitionDuration: tokens.durationFaster,
    ":hover": { boxShadow: tokens.shadow8, ...shorthands.borderColor(tokens.colorNeutralStroke1Hover), transform: "translateY(-1px)" },
    // Keyboard focus lands on the link, but the ring belongs around the card it opens.
    ":focus-within": { outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`, outlineOffset: "2px" },
    "@media (prefers-reduced-motion: reduce)": { transitionDuration: "0s", ":hover": { transform: "none" } },
  },
  invalid: { borderTopColor: tokens.colorPaletteRedBorder2, borderTopWidth: tokens.strokeWidthThickest },
  head: { display: "flex", alignItems: "flex-start", gap: tokens.spacingHorizontalS },
  name: {
    flexGrow: 1,
    fontFamily: tokens.fontFamilyMonospace,
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase400,
    overflowWrap: "anywhere",
    ":focus-visible": { outlineStyle: "none" },
    "::after": { content: '""', position: "absolute", inset: 0, borderRadius: tokens.borderRadiusLarge },
  },
  // Above the stretched link, so it is its own click target and never opens the editor.
  above: { position: "relative", zIndex: 1 },
  badges: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalXS },
  description: { color: tokens.colorNeutralForeground2, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" },
  // marginTop auto pins the facts to the bottom, so a row of cards lines up
  // whatever their descriptions' lengths.
  meta: {
    marginTop: "auto",
    paddingTop: tokens.spacingVerticalS,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`,
    display: "flex",
    flexWrap: "wrap",
    gap: `${tokens.spacingVerticalXS} ${tokens.spacingHorizontalM}`,
    color: tokens.colorNeutralForeground3,
  },
  fact: { display: "inline-flex", alignItems: "center", gap: tokens.spacingHorizontalXXS, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
});

export function SkillCard({ skill, readOnly, onDelete }: SkillCardProps) {
  const styles = useStyles();
  const follow = useFollow();
  const href = editPath(skill.id);
  const attention = attentionOf(skill);
  return (
    <article className={mergeClasses(styles.root, !skill.valid && styles.invalid)}>
      <div className={styles.head}>
        {/* The directory is the skill's identity, so the ID is what the card shows;
            a frontmatter name that disagrees is one of the problems the badge reports. */}
        <Link href={href} onClick={follow(href)} className={styles.name}>
          {skill.id}
        </Link>
        <Tooltip content={readOnly ? "Read-only: open the URL the server printed to delete" : `Delete ${skill.id}`} relationship="label">
          <Button className={styles.above} size="small" appearance="subtle" icon={<Delete16Regular />} onClick={() => onDelete(skill)} disabled={readOnly} />
        </Tooltip>
      </div>
      <div className={styles.badges}>
        <Badge appearance="tint" color={skill.userInvocable ? "brand" : "informative"} icon={skill.userInvocable ? <Person16Regular /> : <Bot16Regular />}>
          {skill.userInvocable ? "User-invocable" : "Model-only"}
        </Badge>
        {attention.map((a) => (
          <Badge key={a.kind} color={a.kind === "invalid" ? "danger" : "warning"} appearance="tint">
            {a.badge}
          </Badge>
        ))}
      </div>
      <Text className={styles.description} title={skill.description}>
        {skill.description}
      </Text>
      <Caption1 as="p" className={styles.meta}>
        <span className={styles.fact}>
          <DocumentMultiple16Regular aria-hidden />
          {skill.files} {skill.files === 1 ? "file" : "files"} · {formatBytes(skill.bytes)}
        </span>
        {skill.allowedTools.length > 0 && <AllowedToolsFact rules={skill.allowedTools} />}
        <time className={mergeClasses(styles.fact, styles.above)} dateTime={skill.modified} title={formatDateTime(skill.modified)}>
          <Clock16Regular aria-hidden />
          {formatRelative(skill.modified)}
        </time>
      </Caption1>
    </article>
  );
}
