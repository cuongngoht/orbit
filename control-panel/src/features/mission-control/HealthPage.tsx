import { Button, Caption1, Link, MessageBar, MessageBarBody, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { formatRelative } from "../../shared/format";
import { useFollow } from "../../shared/navigation/useFollow";
import { WordBadge } from "./components";
import { MissionTrail } from "./ApprovalsPage";
import { useMissionHealth } from "./mission.api";
import type { HealthCheck, HealthLink, HealthView } from "./mission.types";
import { AREA_LABEL, HEALTH_LEVEL, healthLinkPath } from "./missionWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  rows: { listStyleType: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  row: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS },
  line: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
});

// `/mission-control/health`: what on this machine needs a person -- a restriction kept from before autonomy was the
// default, a task waiting, blocked, stalled or orphaned, a tool or MCP server enabled but not ready, a host without
// something Orbit could use. Every row is the server's, read off what Orbit already keeps; the page runs no check of
// its own, and its one action (lifting a kept restriction) names the revision it was read on.
export function HealthPage() {
  const styles = useStyles();
  const health = useMissionHealth();
  return (
    <>
      <PageHeader
        title="Health"
        context={<MissionTrail current="Health" />}
        description="What needs a person on this machine, and where to act. Nothing here has to be set up first: Orbit is autonomous by default, and each row says what it found and why."
        actions={
          <Button icon={<ArrowClockwise20Regular />} disabled={health.isFetching} onClick={() => health.refetch()}>
            Refresh
          </Button>
        }
      />
      <div className={styles.stack}>
        {health.isPending && <LoadingState label="Reading what needs a person…" />}
        {health.isError && <ErrorState error={health.error} title="Could not read this machine's health" onRetry={() => health.refetch()} />}
        {health.data && <Areas view={health.data} />}
      </div>
    </>
  );
}

const SUMMARY: Record<HealthView["status"], { intent: "success" | "info" | "warning" | "error"; say: string }> = {
  ok: { intent: "success", say: "Nothing needs a person." },
  info: { intent: "info", say: "Nothing needs a person; a few things could be better." },
  attention: { intent: "warning", say: "Something needs a person: each row says what, and where to act." },
  problem: { intent: "error", say: "Something could not be read: each row says what." },
};

function Areas({ view }: { view: HealthView }) {
  const styles = useStyles();
  return (
    <>
      <MessageBar intent={SUMMARY[view.status].intent}>
        <MessageBarBody>{`${SUMMARY[view.status].say} Read ${formatRelative(view.at)}.`}</MessageBarBody>
      </MessageBar>
      {view.areas.map((area) => (
        <Card key={area} title={AREA_LABEL[area] ?? area}>
          <ul className={styles.rows} aria-label={`Health: ${AREA_LABEL[area] ?? area}`}>
            {view.checks.filter((c) => c.area === area).map((c) => (
              <CheckLine key={`${c.title}/${c.say}`} check={c} />
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}

function CheckLine({ check }: { check: HealthCheck }) {
  const styles = useStyles();
  const level = HEALTH_LEVEL[check.level];
  return (
    <li className={styles.row}>
      <span className={styles.line}>
        <WordBadge word={check.level} tone={level.tone} label={level.label} />
        <Text weight="semibold">{check.title}</Text>
      </span>
      <Caption1 className={styles.muted}>{check.say}</Caption1>
      <span className={styles.line}>
        {check.link && <Where link={check.link} />}
      </span>
    </li>
  );
}

function Where({ link }: { link: HealthLink }) {
  const follow = useFollow();
  const to = healthLinkPath(link);
  if (!to) return null;
  return (
    <Link href={to} onClick={follow(to)}>
      {link.task ? "Open the task" : "Go there"}
    </Link>
  );
}
