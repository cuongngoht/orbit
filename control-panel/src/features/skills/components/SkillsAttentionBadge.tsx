import { CounterBadge } from "@fluentui/react-components";
import { needsAttention } from "../attention";
import { useSkills } from "../hooks/useSkills";

// The sidebar's signal that something under skills/ is broken, so it is seen
// from any page. Nothing to say, nothing shown -- a "0" badge is noise.
export function SkillsAttentionBadge() {
  const skills = useSkills();
  const broken = skills.data?.filter(needsAttention).length ?? 0;
  if (!broken) return null;
  return <CounterBadge count={broken} color="danger" size="small" aria-label={`${broken} ${broken === 1 ? "skill needs" : "skills need"} attention`} />;
}
