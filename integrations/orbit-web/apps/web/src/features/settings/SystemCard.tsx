// System Status: the programs, the plugin and the storage this container holds, and the versions it was built with.
import { Text, makeStyles, tokens } from "@fluentui/react-components";
import { CheckmarkCircle16Filled, DismissCircle16Filled } from "@fluentui/react-icons";
import type { ComponentCheck, SetupStatus } from "@orbit-web/contracts";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "14px" },
  table: { display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: "16px", rowGap: "6px", alignItems: "center" },
  ok: { color: tokens.colorPaletteGreenForeground1, verticalAlign: "middle" },
  bad: { color: tokens.colorPaletteRedForeground1, verticalAlign: "middle" },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace },
});

function Check({ label, check }: { label: string; check: ComponentCheck }) {
  const s = useStyles();
  return (
    <>
      <Text>{label}</Text>
      <Text>
        {check.ok ? <CheckmarkCircle16Filled className={s.ok} aria-label="ok" /> : <DismissCircle16Filled className={s.bad} aria-label="not ok" />} <span className={s.muted}>{check.detail ?? (check.ok ? "ok" : "not usable")}</span>
      </Text>
    </>
  );
}

export function SystemCard({ status }: { status: SetupStatus | null }) {
  const s = useStyles();
  if (status === null) return null;
  const v = status.versions;
  return (
    <section className={s.root} aria-label="System Status">
      <Text className={s.muted}>{status.health.status === "ok" ? "Everything is in place." : "Something here is not usable."}</Text>
      <div className={s.table}>
        <Check label="Claude CLI" check={status.health.claude} />
        <Check label="GitHub CLI" check={status.health.gh} />
        <Check label="Git" check={status.health.git} />
        <Check label="Azure CLI (optional)" check={status.health.az} />
        <Check label="Orbit plugin" check={status.health.orbitPlugin} />
        <Check label="Storage" check={status.health.storage} />
        <Text>Orbit Engine</Text>
        <Text className={s.mono}>
          {v.orbit ?? "unknown"}
          {v.orbitCommit ? ` (${v.orbitCommit.slice(0, 12)})` : ""}
        </Text>
        <Text>Orbit Web</Text>
        <Text className={s.mono}>{v.web}</Text>
        <Text>Node.js</Text>
        <Text className={s.mono}>{v.node}</Text>
      </div>
    </section>
  );
}
