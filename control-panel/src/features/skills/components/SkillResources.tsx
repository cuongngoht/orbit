import type { ReactNode } from "react";
import { Badge, Caption1, Text, makeStyles, tokens } from "@fluentui/react-components";
import { useQuery } from "@tanstack/react-query";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { skillKeys, skillsApi } from "../api/skills.api";
import type { SkillNeed } from "../api/skills.types";

const useStyles = makeStyles({
  sections: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))", gap: tokens.spacingHorizontalL },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  item: { display: "flex", flexDirection: "column" },
  muted: { color: tokens.colorNeutralForeground3 },
});

const STATUS: Record<SkillNeed["status"], { label: string; color: "success" | "warning" | "danger" | "subtle" | "informative" }> = {
  selected: { label: "Resolved", color: "success" },
  "when-named": { label: "When a task names it", color: "informative" },
  approval: { label: "Approval required", color: "warning" },
  blocked: { label: "Blocked", color: "danger" },
  missing: { label: "Missing", color: "danger" },
  unprovided: { label: "Nothing provides it", color: "danger" },
  unknown: { label: "Not looked at yet", color: "subtle" },
  skipped: { label: "Nothing specific", color: "subtle" },
};

// What this skill provides and needs -- CAPABILITIES, from the plugin's catalog
// -- and who would provide each right now, as the resolver itself would decide.
// Derived on every look and never stored: there is no "skill uses server" here.
export function SkillResourcesCard({ id }: { id: string }) {
  const styles = useStyles();
  const resources = useQuery({ queryKey: skillKeys.resources(id), queryFn: () => skillsApi.resources(id) });
  if (resources.isError) return <ErrorState error={resources.error} title="Could not work out what this skill needs" />;
  if (!resources.data) return null;
  const needs = resources.data.needs ?? [];
  const provides = resources.data.provides ?? [];
  const required = needs.filter((n) => n.level === "required");
  const optional = needs.filter((n) => n.level === "optional");
  return (
    <Card title="Resources" subtitle="Derived from the capability graph now — change a server or a policy and this changes with it.">
      <div className={styles.sections}>
        <Section title="Provides">
          {provides.length ? provides.map((p) => <li key={p}>{p}</li>) : <Text className={styles.muted}>Nothing declared.</Text>}
        </Section>
        <Section title="Requires">{required.length ? required.map((n) => <Need key={n.requirement} need={n} />) : <Text className={styles.muted}>Nothing.</Text>}</Section>
        <Section title="Optional requirements">{optional.length ? optional.map((n) => <Need key={n.requirement} need={n} />) : <Text className={styles.muted}>Nothing.</Text>}</Section>
      </div>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <div>
      <Text weight="semibold">{title}</Text>
      <ul className={styles.list} aria-label={title}>
        {children}
      </ul>
    </div>
  );
}

function Need({ need }: { need: SkillNeed }) {
  const styles = useStyles();
  const s = STATUS[need.status];
  return (
    <li className={styles.item}>
      <span>
        <Text>{need.requirement}</Text>
        {need.provider && <Text> → {need.provider.id}</Text>}{" "}
        <Badge appearance="tint" size="small" color={s.color}>
          {s.label}
        </Badge>
      </span>
      {need.provider && <Caption1 className={styles.muted}>{need.provider.ownership === "orbit-managed" ? "Orbit-managed MCP" : need.provider.ownership === "orbit" ? "Orbit built-in" : `${need.provider.kind}, ${need.provider.ownership}`}</Caption1>}
      {need.why && <Caption1 className={styles.muted}>{need.why}</Caption1>}
    </li>
  );
}
