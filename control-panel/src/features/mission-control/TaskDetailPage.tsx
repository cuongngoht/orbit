import { Button, Caption1, MessageBar, MessageBarBody, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import type { ReactNode } from "react";
import { useParams } from "react-router";
import { mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { formatDateTime } from "../../shared/format";
import { useNow } from "../../shared/hooks/useNow";
import { SandboxCard } from "./SandboxCard";
import { LiveTask } from "./live/LiveTask";
import { covers, useTaskStream } from "./live/useTaskStream";
import { MissionTrail } from "./ApprovalsPage";
import { DecisionError, Facts, WordBadge, useDecisions, type Asking, type Confirming } from "./components";
import { useTask } from "./mission.api";
import type { Action, Readiness, TaskRef, TaskView } from "./mission.types";
import { ACTION, APPROVAL, EVIDENCE, LIFECYCLE, VERIFICATION, readinessTone, stageLabel, stopSay } from "./missionWords";

const useStyles = makeStyles({
  grid: { display: "grid", gap: tokens.spacingHorizontalL, gridTemplateColumns: "repeat(auto-fit, minmax(24rem, 1fr))" },
  wide: { gridColumn: "1 / -1" },
  line: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
  paths: { margin: 0, paddingInlineStart: tokens.spacingHorizontalXL },
});

/** The task this page is about, read off its address: both identities of its checkout, and its own. */
function useTaskRef(): TaskRef | null {
  const { key, checkout, task } = useParams();
  return key && checkout && task ? { key, checkout, task } : null;
}

// `/mission-control/:key/checkouts/:checkout/tasks/:task`: one task execution, as its journal says
// -- where it stands, what it decided last and on what evidence, every attempt, every line in order,
// what it changed, what has actually been verified, and what a person may decide about it. A task still
// going is LIVE (Orbit Live): one stream brings every line as it is written, and the page reads on a timer
// only when that stream cannot be kept open. A finished one is a replay of its journal.
export function TaskDetailPage() {
  const ref = useTaskRef();
  if (!ref) {
    return (
      <MessageBar intent="warning">
        <MessageBarBody>This address does not name a task.</MessageBarBody>
      </MessageBar>
    );
  }
  return <Loaded key={`${ref.key}/${ref.checkout}/${ref.task}`} taskRef={ref} />;
}

function Loaded({ taskRef }: { taskRef: TaskRef }) {
  const live = useTaskStream(taskRef);
  const task = useTask(taskRef, { polling: !covers(live.state.connection) });
  const view = task.data?.task ?? null;
  const now = useNow(view !== null && !view.terminal);
  const { ask, confirm, dialog, decide } = useDecisions();
  return (
    <>
      <PageHeader
        title={view?.task.objective ?? "Task"}
        context={<MissionTrail current={taskRef.task} />}
        badges={view && <WordBadge word={view.lifecycle} tone={LIFECYCLE[view.lifecycle].tone} />}
        actions={
          <>
            {view && <Governance view={view} taskRef={taskRef} onAsk={ask} />}
            <Button icon={<ArrowClockwise20Regular />} disabled={task.isFetching} onClick={() => task.refetch()}>
              Refresh
            </Button>
          </>
        }
      />
      {task.isPending && <LoadingState label="Reading the task's journal…" />}
      {task.isError && <ErrorState error={task.error} title="Could not read this task" onRetry={() => task.refetch()} />}
      {decide.isError && <DecisionError error={decide.error} />}
      {view && (
        <Detail view={view} taskRef={taskRef} onAsk={ask} onConfirm={confirm}>
          <LiveTask view={view} taskRef={taskRef} live={live.state} now={now} onAsk={ask} onFollow={live.follow} onUnfollow={live.unfollow} onLoadEarlier={() => void live.loadEarlier()} />
        </Detail>
      )}
      {dialog}
    </>
  );
}

// A person's controls. Pausing stops nothing that is running; cancelling stops no process. There is
// no button to skip a rule, mark something verified or force success.
function Governance({ view, taskRef, onAsk }: { view: TaskView; taskRef: TaskRef; onAsk: (asking: Asking) => void }) {
  const off = !mutationToken();
  const decision = (kind: "pause" | "resume" | "cancel") => ({ ref: taskRef, decision: { kind, expectedRevision: view.revision } });
  if (view.terminal) return null;
  return (
    <>
      {view.paused ? (
        <Button disabled={off} onClick={() => onAsk({ request: decision("resume"), title: "Resume this task?", confirmLabel: "Resume", body: <Text>It may start new work again from where its journal stands.</Text> })}>Resume</Button>
      ) : (
        <Button disabled={off} onClick={() => onAsk({ request: decision("pause"), title: "Pause this task?", confirmLabel: "Pause", body: <Text>Nothing new starts until a person resumes it. An action already running is not interrupted; how it ends is still recorded.</Text> })}>Pause</Button>
      )}
      <Button disabled={off} onClick={() => onAsk({ request: decision("cancel"), title: "Cancel this task?", confirmLabel: "Cancel the task", cancelLabel: "Keep it", destructive: true, body: <Text>Nothing new starts and it cannot be resumed. Cancelling stops no process: anything already running is left to finish, and its end may still be recorded.</Text> })}>
        Cancel task
      </Button>
    </>
  );
}

// The live card first -- an approval a person is asked for is shown inside it, the moment it is asked --
// then the cards that say what the journal holds as a whole.
function Detail({ view, taskRef, onConfirm, children }: { view: TaskView; taskRef: TaskRef; onAsk: (asking: Asking) => void; onConfirm: (asking: Confirming) => void; children: ReactNode }) {
  const styles = useStyles();
  const labels = new Map(view.actions.map((a) => [a.id, a.label ?? a.type]));
  return (
    <div className={styles.grid}>
      <div className={styles.wide}>{children}</div>
      <ReadinessCard view={view} />
      <SandboxCard taskRef={taskRef} active={!view.terminal} onConfirm={onConfirm} />
      <StateCard view={view} labels={labels} />
      <DecisionCard view={view} />
      <ChangesCard view={view} />
      <AttemptsCard view={view} labels={labels} />
      <VerificationCard view={view} />
      <ReferencesCard view={view} />
      <BudgetCard view={view} />
      {view.approvals.some((a) => !a.open) && <ApprovalHistory view={view} />}
    </div>
  );
}

function ReadinessRow({ readiness }: { readiness: Readiness }) {
  const styles = useStyles();
  return (
    <span className={styles.line}>
      <WordBadge word={readiness.state} tone={readinessTone(readiness.state)} />
      {readiness.ref && <span className={styles.mono}>{readiness.ref}</span>}
      {readiness.source === "registry" && <Caption1 className={styles.muted}>as the checkout's last command said{readiness.at ? `, ${formatDateTime(readiness.at)}` : ""}</Caption1>}
      {readiness.because && <Caption1 className={styles.muted}>{readiness.because}</Caption1>}
    </span>
  );
}

function ReadinessCard({ view }: { view: TaskView }) {
  const r = view.readiness;
  return (
    <Card title="Readiness" subtitle="What the journal and this machine's registry say. Nothing is probed to answer.">
      <Facts
        label="Readiness"
        rows={[
          ["Requirement", <ReadinessRow readiness={r.requirement} />],
          ["Environment", <ReadinessRow readiness={r.environment} />],
          ["Workspace", <ReadinessRow readiness={r.workspace} />],
          ["Agent", `${r.agent.actor ?? "unknown"} · ${stageLabel(r.agent.stage)}`],
        ]}
      />
    </Card>
  );
}

const running = (view: TaskView, labels: ReadonlyMap<string, string>) => view.actions.filter((a) => a.state === "running").map((a) => labels.get(a.id) ?? a.id);

function StateCard({ view, labels }: { view: TaskView; labels: ReadonlyMap<string, string> }) {
  const still = running(view, labels);
  const stop = stopSay(view.stopReason);
  return (
    <Card title="Current state" subtitle={LIFECYCLE[view.lifecycle].say}>
      <Facts
        label="Current state"
        rows={[
          ["State", <WordBadge word={view.lifecycle} tone={LIFECYCLE[view.lifecycle].tone} />],
          ["Stage", stageLabel(view.stage)],
          ["Attempt", view.attempt.count ? `${view.attempt.number} / ${view.attempt.limit ?? "?"}${view.attempt.open ? "" : " (none open)"}` : "no attempt yet"],
          ...(stop ? [["Why it stopped", `${view.stopReason} — ${stop}`] as const] : []),
          ...(view.paused ? [["Paused", `${formatDateTime(view.paused.at)}${view.paused.because ? ` — ${view.paused.because}` : ""}`] as const] : []),
          ...(view.blocked?.because ? [["Blocked because", view.blocked.because] as const] : []),
          ...(still.length ? [["Still running", still.join(", ")] as const] : []),
        ]}
      />
    </Card>
  );
}

// What led to the next action, as the task recorded it -- never a model's reasoning.
function DecisionCard({ view }: { view: TaskView }) {
  const styles = useStyles();
  const d = view.decision;
  return (
    <Card title="Current decision" subtitle={d ? `${d.id}${d.attempt ? ` · ${d.attempt}` : ""} · ${formatDateTime(d.at)}` : undefined}>
      {d ? (
        <Facts
          label="Current decision"
          rows={[
            ["Observed", d.observed],
            ["Hypothesis", d.hypothesis],
            ["Evidence", d.evidence.length ? <span className={styles.mono}>{d.evidence.join(", ")}</span> : "none cited"],
            ["Next action", <span className={styles.mono}>{d.nextAction}</span>],
            ...(d.reason ? [["Reason", d.reason] as const] : []),
          ]}
        />
      ) : (
        <Text className={styles.muted}>No decision has been recorded yet.</Text>
      )}
    </Card>
  );
}

const actionWords = (a: Action, labels: ReadonlyMap<string, string>) => `${labels.get(a.id) ?? a.type} ${ACTION[a.state].label}${a.summary ? ` (${a.summary})` : ""}`;

function AttemptsCard({ view, labels }: { view: TaskView; labels: ReadonlyMap<string, string> }) {
  const styles = useStyles();
  const actions = new Map(view.actions.map((a) => [a.id, a]));
  return (
    <Card title="Attempts" subtitle={view.repeats >= 2 ? `The last ${view.repeats} attempts ended on the same failure signature.` : undefined} className={styles.wide}>
      {view.attempts.length === 0 ? (
        <Text className={styles.muted}>No attempt has started yet.</Text>
      ) : (
        <Table aria-label="Attempts" size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Attempt</TableHeaderCell>
              <TableHeaderCell>Why it began</TableHeaderCell>
              <TableHeaderCell>What it did</TableHeaderCell>
              <TableHeaderCell>How it ended</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.attempts.map((a) => (
              <TableRow key={a.id}>
                <TableCell>{`Attempt ${a.number}${a.number === view.attempt.number && view.attempt.open ? " (current)" : ""}`}</TableCell>
                <TableCell>{a.cause ?? "—"}</TableCell>
                <TableCell>{a.actions.map((id) => actions.get(id)).filter((x): x is Action => x !== undefined).map((x) => actionWords(x, labels)).join(" · ") || "—"}</TableCell>
                <TableCell>{a.outcome ? `${a.outcome}${a.failureSignature ? ` · ${a.failureSignature}` : ""}` : "still open"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function ChangesCard({ view }: { view: TaskView }) {
  const styles = useStyles();
  const c = view.changes;
  return (
    <Card title="Changes" subtitle={c.files ? `${c.files} file(s) changed  +${c.added} −${c.removed}` : undefined}>
      {c.files === 0 ? (
        <Text className={styles.muted}>No change has been recorded.</Text>
      ) : (
        <ul className={styles.paths} aria-label="Changed files">
          {c.paths.map((p) => (
            <li key={p.path}>
              <span className={styles.mono}>{p.path}</span> <Caption1 className={styles.muted}>{`${p.change} +${p.added} −${p.removed}`}</Caption1>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// What has actually been verified: only with a receipt. With none, it says so.
function VerificationCard({ view }: { view: TaskView }) {
  const styles = useStyles();
  return (
    <Card title="Verification" subtitle="Satisfied or violated only with a receipt Orbit holds." className={styles.wide}>
      {view.verification.length === 0 ? (
        <Text className={styles.muted}>Nothing has been verified yet: no obligation has a receipt linked.</Text>
      ) : (
        <Table aria-label="Verification" size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Requirement / obligation</TableHeaderCell>
              <TableHeaderCell>Evidence</TableHeaderCell>
              <TableHeaderCell>State</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.verification.map((v) => (
              <TableRow key={v.subject ?? v.obligation}>
                <TableCell>{v.obligation}</TableCell>
                <TableCell>{v.evidence ? <span className={styles.mono}>{v.evidence}</span> : "—"}</TableCell>
                <TableCell>
                  <WordBadge word={v.state} tone={VERIFICATION[v.state].tone} label={VERIFICATION[v.state].label} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

const shownId = (value: string | null, mono: string): ReactNode => (value ? <span className={mono}>{value}</span> : "—");

function ReferencesCard({ view }: { view: TaskView }) {
  const styles = useStyles();
  const t = view.task;
  return (
    <Card title="References" subtitle="What the task rests on, by id. The domain that owns each is its source of truth.">
      <Facts
        label="References"
        rows={[
          ["Work", shownId(t.work, styles.mono)],
          ["Requirement", shownId(t.root, styles.mono)],
          ["Snapshot", shownId(t.snapshot, styles.mono)],
          ["Base revision", shownId(t.baseRevision, styles.mono)],
          ["Provider", t.provider ?? "—"],
          ["Receipts", view.receipts.length ? <span className={styles.mono}>{view.receipts.map((r) => `${r.key}${r.outcome ? ` (${r.outcome})` : ""}`).join(", ")}</span> : "none linked"],
          ["Actions", view.actions.length ? `${view.actions.filter((a) => a.evidence === "receipt").length} with a receipt · ${view.actions.filter((a) => a.evidence === "reported").length} ${EVIDENCE.reported}` : "none"],
        ]}
      />
    </Card>
  );
}

const spend = (s: { spent: number; limit: number | null }) => `${s.spent} / ${s.limit ?? "no limit"}`;

function BudgetCard({ view }: { view: TaskView }) {
  const b = view.budget;
  return (
    <Card title="Budget">
      <Facts
        label="Budget"
        rows={[
          ["Attempts", spend(b.attempts)],
          ["Actions", spend(b.actions)],
          ["Minutes", spend(b.minutes)],
        ]}
      />
    </Card>
  );
}

function ApprovalHistory({ view }: { view: TaskView }) {
  const styles = useStyles();
  return (
    <Card title="Approvals decided">
      <ul className={styles.paths} aria-label="Approvals decided">
        {view.approvals.filter((a) => !a.open).map((a) => (
          <li key={a.id}>
            <span className={styles.mono}>{a.id}</span> {a.action} on {a.environment ?? "?"} — <WordBadge word={a.state} tone={APPROVAL[a.state].tone} label={APPROVAL[a.state].label} />
            {a.consumedBy && <Caption1 className={styles.muted}>{` used by ${a.consumedBy}`}</Caption1>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
