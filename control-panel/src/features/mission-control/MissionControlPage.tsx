import { Button, Caption1, Field, Link, MessageBar, MessageBarBody, MessageBarTitle, Select, Subtitle2, Tab, TabList, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { StatTile } from "../../shared/components/StatTile";
import { formatCount, formatRelative } from "../../shared/format";
import { useFollow } from "../../shared/navigation/useFollow";
import { ApprovalCard } from "./ApprovalCard";
import { DecisionError, WordBadge, useDecisions } from "./components";
import { useMissionControl } from "./mission.api";
import { isUnreadable, type Lifecycle, type MachineRow, type MachineView, type QueueItem, type TaskRow } from "./mission.types";
import { APPROVALS_PATH, LIFECYCLE, TERMINAL, stageLabel, stopSay, taskPath } from "./missionWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  tiles: { display: "grid", gap: tokens.spacingHorizontalL, gridTemplateColumns: "repeat(auto-fit, minmax(10.5rem, 1fr))" },
  filters: { display: "flex", gap: tokens.spacingHorizontalL, alignItems: "end", flexWrap: "wrap" },
  rows: { listStyleType: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  row: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS, paddingBlock: tokens.spacingVerticalS, borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}` },
  line: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  approvals: { display: "grid", gap: tokens.spacingHorizontalL, gridTemplateColumns: "repeat(auto-fit, minmax(22rem, 1fr))" },
});

type Filter = "all" | "active" | "waiting" | "blocked" | "completed";

const FILTERS: readonly { id: Filter; label: string; keeps: (row: TaskRow) => boolean }[] = [
  { id: "all", label: "All", keeps: () => true },
  { id: "active", label: "Active", keeps: (row) => !TERMINAL.includes(row.lifecycle) },
  { id: "waiting", label: "Waiting approval", keeps: (row) => row.lifecycle === "WAITING_APPROVAL" },
  { id: "blocked", label: "Blocked", keeps: (row) => row.lifecycle === "BLOCKED" },
  { id: "completed", label: "Completed", keeps: (row) => row.lifecycle === "COMPLETED" },
];

const isFilter = (value: unknown): value is Filter => FILTERS.some((f) => f.id === value);

const ALL_PROJECTS = "";

// `/mission-control`: every task execution on this machine, across every project Orbit knows, as the
// task journals say -- read off the registry, never a scan, and stored nowhere. What is still going
// is read again every few seconds; what waits for a person can be decided here.
export function MissionControlPage() {
  const styles = useStyles();
  const view = useMissionControl();
  const { ask, dialog, decide } = useDecisions();
  return (
    <>
      <PageHeader
        title="Tasks"
        description="Mission Control: every task on this machine, in every project Orbit knows — where each stands, which attempt it is on, why it stopped, and what waits for a person. A workflow's engineering task names the workflow it belongs to. Every word comes from a task's own journal."
        actions={
          <Button icon={<ArrowClockwise20Regular />} disabled={view.isFetching} onClick={() => view.refetch()}>
            Refresh
          </Button>
        }
      />
      <div className={styles.stack}>
        {view.isPending && <LoadingState label="Reading the tasks on this machine…" />}
        {view.isError && <ErrorState error={view.error} title="Could not read the tasks on this machine" onRetry={() => view.refetch()} />}
        {decide.isError && <DecisionError error={decide.error} />}
        {view.data && <Overview view={view.data} onAsk={ask} />}
      </div>
      {dialog}
    </>
  );
}

function Overview({ view, onAsk }: { view: MachineView; onAsk: ReturnType<typeof useDecisions>["ask"] }) {
  const styles = useStyles();
  const c = view.counts;
  return (
    <>
      <div className={styles.tiles}>
        <StatTile label="Running" value={formatCount(c.running)} caption="preparing, executing or verifying" />
        <StatTile label="Waiting approval" value={formatCount(c.waitingApproval)} href={APPROVALS_PATH} />
        <StatTile label="Blocked" value={formatCount(c.blocked)} />
        <StatTile label="Completed today" value={formatCount(c.completedToday)} />
        <StatTile label="Projects" value={formatCount(c.projects)} caption={`${formatCount(c.checkouts)} checkout(s)`} />
      </div>
      {view.problems.length > 0 && (
        <MessageBar intent="warning" layout="multiline">
          <MessageBarBody>
            <MessageBarTitle>Some projects could not be read</MessageBarTitle>
            {view.problems.map((p) => `${p.name}: ${p.why}`).join(" · ")}
          </MessageBarBody>
        </MessageBar>
      )}
      {view.approvals.length > 0 && <Queue items={view.approvals} onAsk={onAsk} />}
      {view.tasks.length === 0 ? <Empty /> : <Tasks rows={view.tasks} />}
    </>
  );
}

function Empty() {
  return (
    <MessageBar intent="info">
      <MessageBarBody>No task execution has been recorded on this machine yet. A task appears here as soon as an agent starts one with Orbit's task command in a project's checkout.</MessageBarBody>
    </MessageBar>
  );
}

export function Queue({ items, onAsk }: { items: QueueItem[]; onAsk: ReturnType<typeof useDecisions>["ask"] }) {
  const styles = useStyles();
  return (
    <section aria-label={`Approvals (${items.length})`} className={styles.stack}>
      <Subtitle2 as="h2">{`Approvals (${items.length})`}</Subtitle2>
      <div className={styles.approvals}>
        {items.map((item) => (
          <ApprovalCard key={`${item.task}/${item.id}`} approval={item} taskRef={{ key: item.project, checkout: item.checkout, task: item.task }} revision={item.revision} objective={item.objective} projectName={item.projectName} onAsk={onAsk} review />
        ))}
      </div>
    </section>
  );
}

const readable = (rows: MachineRow[]) => rows.filter((row): row is TaskRow => !isUnreadable(row));

function Tasks({ rows }: { rows: MachineRow[] }) {
  const styles = useStyles();
  const [filter, setFilter] = useState<Filter>("all");
  const [project, setProject] = useState(ALL_PROJECTS);
  const projects = [...new Map(rows.map((row) => [row.project, row.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const keeps = FILTERS.find((f) => f.id === filter)?.keeps ?? (() => true);
  const shown = readable(rows).filter((row) => keeps(row) && (project === ALL_PROJECTS || row.project === project));
  const unreadable = rows.filter(isUnreadable).filter((row) => project === ALL_PROJECTS || row.project === project);
  return (
    <>
      <div className={styles.filters}>
        <TabList selectedValue={filter} onTabSelect={(_, data) => isFilter(data.value) && setFilter(data.value)} aria-label="Which tasks">
          {FILTERS.map((f) => (
            <Tab key={f.id} value={f.id}>
              {f.label}
            </Tab>
          ))}
        </TabList>
        <Field label="Project">
          <Select value={project} onChange={(_, data) => setProject(data.value)}>
            <option value={ALL_PROJECTS}>Every project</option>
            {projects.map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {projects.filter(([key]) => project === ALL_PROJECTS || key === project).map(([key, name]) => (
        <ProjectTasks key={key} name={name} rows={shown.filter((row) => row.project === key)} unreadable={unreadable.filter((row) => row.project === key).map((row) => `${row.id}: ${row.why}`)} />
      ))}
    </>
  );
}

function ProjectTasks({ name, rows, unreadable }: { name: string; rows: TaskRow[]; unreadable: string[] }) {
  const styles = useStyles();
  if (rows.length === 0 && unreadable.length === 0) return null;
  return (
    <Card title={name}>
      <ul className={styles.rows} aria-label={`Tasks of ${name}`}>
        {rows.map((row) => (
          <TaskLine key={row.id} row={row} />
        ))}
        {unreadable.map((line) => (
          <li key={line} className={styles.row}>
            <Caption1 className={styles.muted}>cannot be read — {line}</Caption1>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const attemptWords = (row: { attempt: TaskRow["attempt"] }) => (row.attempt.count ? `Attempt ${row.attempt.number} / ${row.attempt.limit ?? "?"}` : "No attempt yet");

function TaskLine({ row }: { row: TaskRow }) {
  const styles = useStyles();
  const follow = useFollow();
  const to = taskPath({ key: row.project, checkout: row.checkout, task: row.id });
  const lifecycle: Lifecycle = row.lifecycle;
  return (
    <li className={styles.row}>
      <span className={styles.line}>
        <Link href={to} onClick={follow(to)}>
          {row.objective}
        </Link>
        <WordBadge word={lifecycle} tone={LIFECYCLE[lifecycle].tone} />
        {row.provider === "automation" && <WordBadge word="workflow" tone="informative" label="Workflow" />}
      </span>
      <span className={styles.line}>
        <Text>
          {/* ● a task still going, ○ one that ended: the word beside it says which, so the glyph is never the only signal. */}
          <span role="img" aria-label={row.terminal ? "ended" : "active"}>{row.terminal ? "○" : "●"}</span> {row.terminal ? stageLabel(row.stage) : (row.stage ?? "no stage yet")} · {attemptWords(row)}
          {!row.terminal && row.running > 0 ? ` · ${row.running} running` : ""}
        </Text>
        {row.stopReason && <Caption1>— {stopSay(row.stopReason)}</Caption1>}
        {row.approvals.map((a) => (
          <Caption1 key={a.id}>
            — {a.action} on {a.environment ?? "?"} waits for a person
          </Caption1>
        ))}
      </span>
      <Caption1 className={styles.muted}>
        {row.id}
        {row.parent ? ` · part of workflow ${row.parent}` : ""} · updated {formatRelative(row.updatedAt)}
        {row.checkoutRoot ? ` · ${row.checkoutRoot}` : ""}
        {row.checkoutPresent ? "" : " · its checkout folder is gone"}
      </Caption1>
    </li>
  );
}
