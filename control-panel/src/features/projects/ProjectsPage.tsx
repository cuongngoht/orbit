import { Badge, Button, Caption1, Link, MessageBar, MessageBarBody, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { Card } from "../../shared/components/Card";
import { ConfirmDialog } from "../../shared/components/ConfirmDialog";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { formatRelative } from "../../shared/format";
import { useFollow } from "../../shared/navigation/useFollow";
import { StateBadge } from "../runtime/StateBadge";
import { runtimePath } from "./projectWords";
import { useForget, useProjects } from "./projects.api";
import type { Checkout, Project } from "./projects.types";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  path: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
  muted: { color: tokens.colorNeutralForeground3 },
});

// `/projects`: every project and checkout Orbit has been used from on THIS machine, as each was last
// seen. It lists what the registry holds -- a checkout is known because Orbit was used from it -- and
// reads no repository, runs nothing and asks nothing of any checkout: opening Control costs a
// directory listing. A summary is a statement about a moment, and says when; the truth about a
// checkout is its own Runtime page.
interface Target {
  project: Project;
  checkout: Checkout;
}

export function ProjectsPage() {
  const styles = useStyles();
  const projects = useProjects();
  const forget = useForget();
  const [asking, setAsking] = useState<Target | null>(null);
  const list = projects.data?.projects ?? [];
  return (
    <>
      <PageHeader
        title="Projects"
        description="Every project and checkout Orbit has been used from on this machine, as each was last seen. Nothing on this page reads a repository: open a checkout to see its runtime."
        actions={
          <Button icon={<ArrowClockwise20Regular />} disabled={projects.isFetching} onClick={() => projects.refetch()}>
            Refresh
          </Button>
        }
      />
      <div className={styles.stack}>
        {projects.isPending && <LoadingState label="Reading the projects Orbit knows…" />}
        {projects.isError && <ErrorState error={projects.error} title="Could not list the projects" onRetry={() => projects.refetch()} />}
        {forget.isError && <ErrorState error={forget.error} title="The checkout was not forgotten" />}
        {projects.data && list.length === 0 && (
          <MessageBar intent="info">
            <MessageBarBody>Orbit has not been used from any project on this machine yet. Run its runtime command from a project's checkout and it appears here.</MessageBarBody>
          </MessageBar>
        )}
        {list.length > 0 && (
          <Card title="Checkouts" subtitle="One row per checkout. A project checked out twice is one project with two rows.">
            <Rows projects={list} onForget={setAsking} />
          </Card>
        )}
      </div>
      <ConfirmDialog
        open={asking !== null}
        title="Forget this checkout?"
        confirmLabel="Forget it"
        destructive
        busy={forget.isPending}
        onConfirm={() => {
          if (asking) forget.mutate({ key: asking.project.key, checkout: asking.checkout.id }, { onSettled: () => setAsking(null) });
        }}
        onCancel={() => setAsking(null)}
      >
        <Text>
          Its directory, <span className={styles.path}>{asking?.checkout.root}</span>, is gone. Orbit takes it off this list of {asking?.project.name}; what Orbit
          kept about it stays in the store. A directory that is there again is not forgotten.
        </Text>
      </ConfirmDialog>
    </>
  );
}

function Rows({ projects, onForget }: { projects: Project[]; onForget: (target: Target) => void }) {
  return (
    <Table aria-label="Checkouts" size="small">
      <TableHeader>
        <TableRow>
          <TableHeaderCell>Project</TableHeaderCell>
          <TableHeaderCell>Checkout</TableHeaderCell>
          <TableHeaderCell>Understanding</TableHeaderCell>
          <TableHeaderCell>Runtime</TableHeaderCell>
          <TableHeaderCell>Last seen</TableHeaderCell>
          <TableHeaderCell />
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.flatMap((p) => p.checkouts.map((c) => <Row key={`${p.key}/${c.id}`} project={p} checkout={c} onForget={onForget} />))}
      </TableBody>
    </Table>
  );
}

function Row({ project, checkout, onForget }: { project: Project; checkout: Checkout; onForget: (target: Target) => void }) {
  const styles = useStyles();
  const follow = useFollow();
  const to = runtimePath(project.key, checkout.id);
  const summary = checkout.summary;
  return (
    <TableRow>
      <TableCell>{project.name}</TableCell>
      <TableCell>
        <Text className={styles.path}>{checkout.root}</Text>
        {summary?.branch && <Caption1 className={styles.muted}> · {summary.branch}</Caption1>}
        {!checkout.exists && <Badge appearance="tint" color="danger">missing</Badge>}
      </TableCell>
      <TableCell>{summary ? <StateBadge word={summary.understanding} /> : <Caption1 className={styles.muted}>not said yet</Caption1>}</TableCell>
      <TableCell>{summary ? <StateBadge word={summary.runtime} /> : <Caption1 className={styles.muted}>not said yet</Caption1>}</TableCell>
      <TableCell>{checkout.lastSeen ? formatRelative(checkout.lastSeen) : "—"}</TableCell>
      <TableCell>
        {checkout.exists ? (
          <Link href={to} onClick={follow(to)} aria-label={`Open the runtime of ${project.name} at ${checkout.root}`}>
            Open runtime
          </Link>
        ) : (
          <>
            <Caption1 className={styles.muted}>its directory is gone</Caption1>{" "}
            <Button size="small" aria-label={`Forget ${checkout.root}`} onClick={() => onForget({ project, checkout })}>
              Forget
            </Button>
          </>
        )}
      </TableCell>
    </TableRow>
  );
}
