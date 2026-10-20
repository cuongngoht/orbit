import { Link, Text, makeStyles, tokens } from "@fluentui/react-components";
import { CheckmarkCircle20Filled, Warning20Filled } from "@fluentui/react-icons";
import { Card } from "../../../shared/components/Card";
import { useFollow } from "../../../shared/navigation/useFollow";
import type { Attention } from "../analytics";

const useStyles = makeStyles({
  list: { listStyleType: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  item: { display: "grid", gridTemplateColumns: "auto 1fr", columnGap: tokens.spacingHorizontalS, alignItems: "start" },
  warn: { color: "var(--viz-warning)", marginTop: "1px" },
  good: { color: "var(--viz-good)" },
  name: { fontFamily: tokens.fontFamilyMonospace, fontWeight: tokens.fontWeightSemibold },
  details: { margin: 0, paddingLeft: tokens.spacingHorizontalL, color: tokens.colorNeutralForeground2 },
  empty: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS },
});

// Status always ships as an icon AND words: the color alone never says it.
export function AttentionList({ items, editPath }: { items: Attention[]; editPath: (id: string) => string }) {
  const styles = useStyles();
  const follow = useFollow();
  return (
    <Card title="Needs attention" subtitle="Skills whose SKILL.md breaks the contract, or goes past a documented limit.">
      {items.length === 0 ? (
        <span className={styles.empty}>
          <CheckmarkCircle20Filled className={styles.good} aria-hidden />
          <Text>Nothing needs attention: every SKILL.md holds to the contract.</Text>
        </span>
      ) : (
        <ul className={styles.list}>
          {items.map((a) => (
            <li key={`${a.id}-${a.kind}`} className={styles.item}>
              <Warning20Filled className={styles.warn} aria-label="Warning" />
              <div>
                <Link className={styles.name} href={editPath(a.id)} onClick={follow(editPath(a.id))}>
                  {a.id}
                </Link>
                <Text block>{a.title}</Text>
                {a.details.length > 0 && (
                  <ul className={styles.details}>
                    {a.details.map((d) => (
                      <li key={d}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
