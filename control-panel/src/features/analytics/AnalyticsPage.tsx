import { Button, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular, CheckmarkCircle24Filled, Warning24Filled } from "@fluentui/react-icons";
import { formatBytes, formatCompact, formatCount } from "../../shared/format";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { useSkills } from "../skills/hooks/useSkills";
import { SKILLS_PATH, editPath, filteredPath } from "../skills/paths";
import { useRefreshUsage } from "../trace/trace.api";
import { DESCRIPTION_LIMIT, analyse, type Analysis } from "./analytics";
import { AttentionBanner } from "./components/AttentionBanner";
import { AttentionList } from "./components/AttentionList";
import { BarChart } from "./components/BarChart";
import { PermissionMatrix } from "./components/PermissionMatrix";
import { RecentChanges } from "./components/RecentChanges";
import { StatTile } from "./components/StatTile";
import { UsageSection } from "./usage/UsageSection";

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXL },
  // Refetch keeps the frame: the last render stays, dimmed -- no skeleton, no jump.
  refetching: { opacity: 0.6, transitionProperty: "opacity", transitionDuration: tokens.durationNormal },
  tiles: { display: "grid", gap: tokens.spacingHorizontalL, gridTemplateColumns: "repeat(auto-fit, minmax(10.5rem, 1fr))" },
  pair: { display: "grid", gap: tokens.spacingHorizontalL, gridTemplateColumns: "repeat(auto-fit, minmax(26rem, 1fr))", alignItems: "start" },
  // auto-FILL keeps the empty track: a card left alone keeps its half instead
  // of stretching a five-row list across the whole page.
  halves: { display: "grid", gap: tokens.spacingHorizontalL, gridTemplateColumns: "repeat(auto-fill, minmax(26rem, 1fr))", alignItems: "start" },
  good: { color: "var(--viz-good)" },
  warn: { color: "var(--viz-warning)" },
});

export function AnalyticsPage() {
  const styles = useStyles();
  const skills = useSkills();
  const refreshUsage = useRefreshUsage();
  return (
    <>
      <PageHeader
        title="Analytics"
        description="What each skill costs a session, what it may do without asking and what needs a look, read off skills/ on disk right now — then how sessions on this machine used Orbit, read off the local session trail. Nothing is sent anywhere."
        actions={
          <Button
            icon={<ArrowClockwise20Regular />}
            onClick={() => {
              void skills.refetch();
              void refreshUsage();
            }}
            disabled={skills.isFetching}
          >
            {skills.isFetching ? "Refreshing…" : "Refresh"}
          </Button>
        }
      />
      {skills.isPending && <LoadingState label="Reading skills…" />}
      {skills.isError && <ErrorState error={skills.error} title="Could not read the skills" onRetry={() => skills.refetch()} />}
      {skills.data && (
        <div className={`${styles.page} ${skills.isFetching ? styles.refetching : ""}`}>
          <Overview analysis={analyse(skills.data)} />
        </div>
      )}
      <UsageSection />
    </>
  );
}

function Overview({ analysis: a }: { analysis: Analysis }) {
  const styles = useStyles();
  const broken = new Set(a.attention.map((x) => x.id)).size;
  return (
    <>
      {broken > 0 && <AttentionBanner count={broken} href={filteredPath("attention")} />}
      <div className={styles.tiles}>
        <StatTile label="Skills" value={formatCount(a.total)} caption={`${a.userInvocable} user-invocable · ${a.total - a.userInvocable} model-only`} href={SKILLS_PATH} />
        <StatTile
          label="Needs attention"
          value={formatCount(broken)}
          status={broken ? { icon: <Warning24Filled className={styles.warn} aria-hidden />, label: "Warning" } : { icon: <CheckmarkCircle24Filled className={styles.good} aria-hidden />, label: "All good" }}
          caption={broken ? "Open the list to see why" : "Every skill holds to the contract and its limits"}
          href={broken ? filteredPath("attention") : undefined}
        />
        <StatTile label="Loaded every session" value={formatCompact(a.descriptionChars)} caption={`${formatCount(a.descriptionChars)} characters of descriptions`} />
        {a.largest && <StatTile label="Largest SKILL.md" value={formatBytes(a.largest.value * 1024)} caption={`${a.largest.id}, loaded when it runs`} href={editPath(a.largest.id)} />}
        <StatTile label="On disk" value={`${formatCount(a.files)} files`} caption={`${formatBytes(a.bytes)} across ${a.total} skills`} />
      </div>
      <div className={styles.pair}>
        <BarChart
          title="Description length"
          subtitle="Characters per skill. Every description is loaded into every session, so this is the always-on cost."
          bars={a.descriptions}
          format={(v) => `${formatCount(v)} characters`}
          label={formatCount}
          tick={formatCount}
          unit="Characters"
          reference={{ value: DESCRIPTION_LIMIT, label: `${formatCount(DESCRIPTION_LIMIT)} limit` }}
          hrefOf={editPath}
        />
        <BarChart
          title="SKILL.md size"
          subtitle="Kilobytes per skill. Only loaded when the skill runs."
          bars={a.sizes}
          format={(v) => `${v.toFixed(1)} KB`}
          label={(v) => v.toFixed(1)}
          tick={(v) => `${formatCount(v)} KB`}
          unit="Size"
          hrefOf={editPath}
        />
      </div>
      <PermissionMatrix permissions={a.permissions} editPath={editPath} />
      <div className={styles.halves}>
        {/* All clear is already said by the tile's check; an empty card would only say it again. */}
        {broken > 0 && <AttentionList items={a.attention} editPath={editPath} />}
        <RecentChanges skills={a.recent} editPath={editPath} />
      </div>
    </>
  );
}
