import { makeStyles, tokens } from "@fluentui/react-components";
import type { SkillSummary } from "../api/skills.types";
import { SkillCard } from "./SkillCard";

interface SkillListProps {
  skills: SkillSummary[];
  readOnly: boolean;
  onDelete: (skill: SkillSummary) => void;
}

const useStyles = makeStyles({
  // As many 20rem columns as fit, never narrower than the window: the grid
  // decides the columns, so there is no breakpoint to keep in step.
  grid: {
    listStyleType: "none",
    margin: 0,
    padding: 0,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 20rem), 1fr))",
    gap: tokens.spacingHorizontalL,
  },
  item: { display: "flex" },
});

export function SkillList({ skills, readOnly, onDelete }: SkillListProps) {
  const styles = useStyles();
  return (
    <ul aria-label="Skills" className={styles.grid}>
      {skills.map((skill) => (
        <li key={skill.id} className={styles.item}>
          <SkillCard skill={skill} readOnly={readOnly} onDelete={onDelete} />
        </li>
      ))}
    </ul>
  );
}
