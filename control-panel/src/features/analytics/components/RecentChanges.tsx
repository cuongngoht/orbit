import { Caption1, Link, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { Card } from "../../../shared/components/Card";
import { formatDateTime, formatRelative } from "../../../shared/format";
import { useFollow } from "../../../shared/navigation/useFollow";
import type { SkillSummary } from "../../skills/api/skills.types";

const useStyles = makeStyles({
  list: { listStyleType: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" },
  item: {
    display: "flex",
    justifyContent: "space-between",
    gap: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalS,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`,
    ":last-child": { borderBottom: "none" },
  },
  name: { fontFamily: tokens.fontFamilyMonospace },
  when: { color: tokens.colorNeutralForeground3, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" },
});

export function RecentChanges({ skills, editPath }: { skills: SkillSummary[]; editPath: (id: string) => string }) {
  const styles = useStyles();
  const follow = useFollow();
  return (
    <Card title="Recently changed" subtitle="The last time anything in the skill's directory changed on disk.">
      <ul className={styles.list}>
        {skills.map((s) => (
          <li key={s.id} className={styles.item}>
            <Link className={styles.name} href={editPath(s.id)} onClick={follow(editPath(s.id))}>
              {s.id}
            </Link>
            <Tooltip content={formatDateTime(s.modified)} relationship="description">
              <Caption1 className={styles.when} tabIndex={0}>
                {formatRelative(s.modified)}
              </Caption1>
            </Tooltip>
          </li>
        ))}
      </ul>
    </Card>
  );
}
