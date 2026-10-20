import { Button, Caption1, Link, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { formatRelative } from "../../shared/format";
import { useFollow } from "../../shared/navigation/useFollow";
import { WordBadge } from "../mission-control/components";
import { useProjects } from "../projects/projects.api";
import type { Checkout, Project } from "../projects/projects.types";
import { useWorks } from "./work.api";
import type { WorkRow } from "./work.types";
import { workPath } from "./workWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  rows: { listStyleType: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  row: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS, paddingBlock: tokens.spacingVerticalS, borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}` },
  line: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
});

// `/work`: the works a person asked for through /orbit-help, in every checkout Orbit knows -- found from the registry, never a scan.
// A line says what was REPORTED about each (its standing); the lifecycle, the evidence and the files are on its own page.
export function WorksPage() {
  const projects = useProjects();
  return (
    <>
      <PageHeader
        title="Work"
        description="What each request came to, from /orbit-help to its result -- whether the host worked it in the session or an engineering task took it. Each work keeps identity, links and what was reported; the evidence is read back from whoever owns it."
        actions={
          <Button icon={<ArrowClockwise20Regular />} disabled={projects.isFetching} onClick={() => projects.refetch()}>
            Refresh
          </Button>
        }
      />
      {projects.isPending && <LoadingState label="Reading the projects on this machine…" />}
      {projects.isError && <ErrorState error={projects.error} title="Could not read the projects on this machine" onRetry={() => projects.refetch()} />}
      {projects.data && <Checkouts projects={projects.data.projects} />}
    </>
  );
}

function Checkouts({ projects }: { projects: Project[] }) {
  const styles = useStyles();
  const present = projects.flatMap((p) => p.checkouts.filter((c) => c.exists).map((c) => ({ project: p, checkout: c })));
  if (present.length === 0) return <Text className={styles.muted}>No checkout Orbit knows is present on this machine.</Text>;
  return (
    <div className={styles.stack}>
      {present.map(({ project, checkout }) => (
        <CheckoutWorks key={`${project.key}/${checkout.id}`} project={project} checkout={checkout} />
      ))}
    </div>
  );
}

function CheckoutWorks({ project, checkout }: { project: Project; checkout: Checkout }) {
  const styles = useStyles();
  const read = useWorks(project.key, checkout.id);
  const works = read.data?.works ?? [];
  return (
    <Card title={project.name} subtitle={checkout.summary?.branch ?? checkout.id.slice(0, 12)}>
      {read.isPending && <LoadingState label="Reading its works…" />}
      {read.isError && <ErrorState error={read.error} title="Could not read this checkout's works" onRetry={() => read.refetch()} />}
      {read.data && works.length === 0 && <Text className={styles.muted}>No work is tracked in this checkout.</Text>}
      {works.length > 0 && (
        <ul className={styles.rows} aria-label={`Works of ${project.name}`}>
          {works.map((row) => (
            <WorkLine key={row.work} row={row} projectKey={project.key} checkout={checkout.id} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function WorkLine({ row, projectKey, checkout }: { row: WorkRow; projectKey: string; checkout: string }) {
  const styles = useStyles();
  const follow = useFollow();
  const to = workPath({ key: projectKey, checkout, work: row.work });
  return (
    <li className={styles.row}>
      <span className={styles.line}>
        <Link href={to} onClick={follow(to)}>
          {row.title ?? row.work}
        </Link>
        <WordBadge word={row.standing} label={row.standing.replace("_", " ")} tone={tone(row.standing)} />
        <Caption1>{row.mode}</Caption1>
      </span>
      <span className={styles.line}>
        <Caption1 className={styles.muted}>
          {row.work}
          {row.ref ? ` · ${row.ref}` : ""} · {row.links} linked · {row.updatedAt ? formatRelative(row.updatedAt) : "never updated"}
        </Caption1>
      </span>
    </li>
  );
}

function tone(standing: string): "danger" | "success" | "warning" | "subtle" {
  if (standing === "FAILED" || standing === "CANCELLED") return "danger";
  if (standing === "REPORTED_DONE") return "success";
  return standing === "OPEN" ? "subtle" : "warning";
}
