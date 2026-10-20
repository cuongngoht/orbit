import { useState } from "react";
import { Button, Caption1, MessageBar, MessageBarBody, MessageBarTitle, Select, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { useQueryClient } from "@tanstack/react-query";
import { mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { formatDateTime, formatRelative } from "../../shared/format";
import { StateBadge } from "../runtime/StateBadge";
import { runtimeApi, useReachOperation } from "../runtime/runtime.api";
import { PROVIDER_SAY, REACH_SAY, SANDBOX_SAY, shortTree } from "../runtime/runtimeWords";
import type { LogStream, SandboxComponent, SandboxReach, SandboxView } from "../runtime/sandbox.types";
import { Facts, type Confirming } from "./components";
import { missionKeys, useSandboxLogs, useSandboxOperation, useTaskSandbox, type SandboxOperation } from "./mission.api";
import type { TaskRef } from "./mission.types";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  line: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
  log: { margin: 0, padding: tokens.spacingHorizontalS, maxHeight: "16rem", overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: tokens.fontFamilyMonospace, backgroundColor: tokens.colorNeutralBackground3, borderRadius: tokens.borderRadiusMedium },
});

const NONE = "This task has no sandbox. The agent prepares one when it needs to run the changed code; Control starts nothing.";

// The task's SANDBOX: an environment it owns, built from the source tree it holds. This card READS it --
// what runs there, which way, where it answers, what its locations reached, whose data it touches -- and
// a person may Stop what runs there or Release it. There is no Start, Restart or Build: the agent's next
// start-sandbox rebuilds a stale one, and nothing a page does starts anything.
export function SandboxCard({ taskRef, active, onConfirm }: { taskRef: TaskRef; active: boolean; onConfirm: (asking: Confirming) => void }) {
  const styles = useStyles();
  const sandbox = useTaskSandbox(taskRef, active);
  const subtitle = "An environment this task owns, built from its changed source tree. It is never your own running application.";
  return (
    <Card title="Sandbox" subtitle={subtitle}>
      {sandbox.isPending && <LoadingState label="Reading the task's sandbox…" />}
      {sandbox.isError && <ErrorState error={sandbox.error} title="Could not read this task's sandbox" onRetry={() => sandbox.refetch()} />}
      {sandbox.data && (sandbox.data.sandbox ? <Present taskRef={taskRef} view={sandbox.data.sandbox} onConfirm={onConfirm} /> : <Text className={styles.muted}>{NONE}</Text>)}
    </Card>
  );
}

const STOP: Omit<Confirming, "run"> = { title: "Stop what this sandbox runs?", confirmLabel: "Stop the sandbox", body: <Text>Only the processes and containers Orbit can prove it started for this task are ended. The sandbox stays, and the agent can start it again.</Text> };

const RELEASE: Omit<Confirming, "run"> = { title: "Release this sandbox?", confirmLabel: "Release the sandbox", destructive: true, body: <Text>Everything of it that runs is stopped and every port it holds is given back. A released sandbox is not started again: the agent prepares a new one.</Text> };

const WORDS: Record<SandboxOperation, Omit<Confirming, "run">> = { stop: STOP, release: RELEASE };

function Present({ taskRef, view, onConfirm }: { taskRef: TaskRef; view: SandboxView; onConfirm: (asking: Confirming) => void }) {
  const styles = useStyles();
  const stale = view.stale || view.state === "STALE";
  return (
    <div className={styles.stack}>
      <div className={styles.line}>
        <StateBadge word={view.state} />
        <Caption1 className={styles.muted}>{SANDBOX_SAY[view.state]}</Caption1>
        <Caption1>{`Owned by ${view.owner.id}`}</Caption1>
      </div>
      {stale && view.state !== "RELEASED" && <Stale view={view} />}
      <Facts label="Sandbox" rows={factsOf(view, styles.mono)} />
      <Components taskRef={taskRef} view={view} />
      {view.connectivity.length > 0 && <Connectivity taskRef={taskRef} rows={view.connectivity} />}
      <Operations taskRef={taskRef} view={view} onConfirm={onConfirm} />
    </div>
  );
}

function Stale({ view }: { view: SandboxView }) {
  return (
    <MessageBar intent="warning" layout="multiline">
      <MessageBarBody>
        <MessageBarTitle>This sandbox runs older code than the task holds now</MessageBarTitle>
        {`It was built from source tree ${shortTree(view.tree)}, and the task's workspace is at ${shortTree(view.currentTree)}. The agent's next start-sandbox rebuilds it; nothing here starts, restarts or builds anything.`}
        {view.because ? ` ${view.because}.` : ""}
      </MessageBarBody>
    </MessageBar>
  );
}

const executionOf = (view: SandboxView) => (view.components.length ? view.components.map((c) => `${c.component}: ${PROVIDER_SAY[c.execution]}`).join(" · ") : "nothing placed yet");

function factsOf(view: SandboxView, mono: string) {
  const o = view.ownership;
  return [
    ["Environment", <span className={mono}>{view.environment}</span>],
    ["Workspace", <span className={mono}>{view.workspace}</span>],
    ["Running tree", <span className={mono}>{shortTree(view.tree)}</span>],
    ["Current tree", <span className={mono}>{shortTree(view.currentTree)}</span>],
    ["Execution", executionOf(view)],
    ["Ownership", `${o.processes} process(es) and ${o.containers} container(s) Orbit can prove are this task's · ${o.external} other(s) found there and never touched`],
    ["Data isolation", `${view.dataIsolation.state} — ${view.dataIsolation.because}`],
    ["Updated", formatDateTime(view.updatedAt)],
  ] as const;
}

function Components({ taskRef, view }: { taskRef: TaskRef; view: SandboxView }) {
  const styles = useStyles();
  const [shown, setShown] = useState<string | null>(null);
  if (view.components.length === 0) return <Caption1 className={styles.muted}>Nothing has been started in this sandbox yet.</Caption1>;
  return (
    <>
      <Table aria-label="Sandbox components" size="small">
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Component</TableHeaderCell>
            <TableHeaderCell>Execution</TableHeaderCell>
            <TableHeaderCell>State</TableHeaderCell>
            <TableHeaderCell>Ready</TableHeaderCell>
            <TableHeaderCell>Answers at</TableHeaderCell>
            <TableHeaderCell>Output</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.components.map((c) => <ComponentRow key={c.component} c={c} open={shown === c.session && c.session !== null} onToggle={() => setShown(shown === c.session ? null : c.session)} />)}
        </TableBody>
      </Table>
      {shown && <Output taskRef={taskRef} component={view.components.find((c) => c.session === shown)} session={shown} />}
    </>
  );
}

const readyWord = (c: SandboxComponent) => (c.readiness ? c.readiness.state : "NOT_CHECKED");

function ComponentRow({ c, open, onToggle }: { c: SandboxComponent; open: boolean; onToggle: () => void }) {
  const styles = useStyles();
  return (
    <TableRow>
      <TableCell><span className={styles.mono}>{c.component}</span></TableCell>
      <TableCell>{PROVIDER_SAY[c.execution]}</TableCell>
      <TableCell><StateBadge word={c.state} /></TableCell>
      <TableCell><StateBadge word={readyWord(c)} /></TableCell>
      <TableCell>{c.endpoint ? <span className={styles.mono}>{c.endpoint}</span> : "—"}</TableCell>
      <TableCell>{c.session ? <Button size="small" aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} logs of ${c.component}`} onClick={onToggle}>{open ? "Hide logs" : "Show logs"}</Button> : "—"}</TableCell>
    </TableRow>
  );
}

const isStream = (value: string): value is LogStream => value === "out" || value === "err";

// One session's output, INLINE: an overlay's unmount would leave the page hidden from assistive
// technology. Read once when asked and again only when the person presses Reload -- never polled.
function Output({ taskRef, component, session }: { taskRef: TaskRef; component: SandboxComponent | undefined; session: string }) {
  const styles = useStyles();
  const client = useQueryClient();
  const [stream, setStream] = useState<LogStream>("out");
  const logs = useSandboxLogs(taskRef, session, stream, true);
  const name = component?.component ?? session;
  return (
    <div className={styles.stack}>
      <div className={styles.line}>
        <Select aria-label={`Stream of ${name}`} value={stream} onChange={(_, d) => isStream(d.value) && setStream(d.value)}>
          <option value="out">standard output</option>
          <option value="err">standard error</option>
        </Select>
        <Button size="small" disabled={logs.isFetching} onClick={() => client.invalidateQueries({ queryKey: missionKeys.logs(taskRef, session, stream) })}>Reload</Button>
        {logs.data?.truncated && <Caption1 className={styles.muted}>Only the last lines are shown.</Caption1>}
      </div>
      {logs.isPending && <LoadingState label="Reading the output…" />}
      {logs.isError && <ErrorState error={logs.error} title="Could not read this output" />}
      {logs.data && <pre role="log" aria-label={`Output of ${name}`} className={styles.log}>{logs.data.lines.length ? logs.data.lines.join("\n") : "Nothing written to this stream yet."}</pre>}
    </div>
  );
}

const blockedWord = (rows: SandboxReach[]) => rows.some((r) => r.state === "BLOCKED");

// What each location last answered about a server this sandbox's components need -- from this machine and
// from inside a container, two networks. Retry asks ONE location again, by the target's id, and sends
// nothing but where to ask from.
function Connectivity({ taskRef, rows }: { taskRef: TaskRef; rows: SandboxReach[] }) {
  const styles = useStyles();
  const client = useQueryClient();
  const retry = useReachOperation(taskRef, runtimeApi.retryReach);
  const off = !mutationToken() || retry.isPending;
  const again = (r: SandboxReach) => retry.mutate({ id: r.target, body: { provider: r.from } }, { onSettled: () => client.invalidateQueries({ queryKey: missionKeys.sandbox(taskRef) }) });
  return (
    <div className={styles.stack}>
      {blockedWord(rows) && (
        <MessageBar intent="warning" layout="multiline">
          <MessageBarBody>A location could not be checked at all. If the server needs a VPN or a route this machine does not have, that is yours to bring up: Orbit controls no VPN, no route and no DNS.</MessageBarBody>
        </MessageBar>
      )}
      <Table aria-label="Sandbox connectivity" size="small">
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Server</TableHeaderCell>
            <TableHeaderCell>Asked from</TableHeaderCell>
            <TableHeaderCell>Answer</TableHeaderCell>
            <TableHeaderCell>Detail</TableHeaderCell>
            <TableHeaderCell>Again</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={`${r.target}/${r.from}`}>
              <TableCell><span className={styles.mono}>{r.target}</span></TableCell>
              <TableCell>{PROVIDER_SAY[r.from]}</TableCell>
              <TableCell><StateBadge word={r.state} label={REACH_SAY[r.state]} /></TableCell>
              <TableCell>{r.because}{r.checkedAt ? <Caption1 className={styles.muted}>{` · checked ${formatRelative(r.checkedAt)}${r.stale ? ", stale" : ""}`}</Caption1> : null}</TableCell>
              <TableCell><Button size="small" disabled={off} aria-label={`Retry ${r.target} from ${PROVIDER_SAY[r.from]}`} onClick={() => again(r)}>Retry</Button></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {retry.isError && <ErrorState error={retry.error} title="That check was not made" />}
    </div>
  );
}

// A person's two decisions, each confirmed in the page's one dialog and sent as `{ human: true }`. What
// the server answers is shown, and nothing is shown stopped, or released, before it does.
function Operations({ taskRef, view, onConfirm }: { taskRef: TaskRef; view: SandboxView; onConfirm: (asking: Confirming) => void }) {
  const styles = useStyles();
  const stop = useSandboxOperation(taskRef, "stop");
  const release = useSandboxOperation(taskRef, "release");
  const ended = view.state === "RELEASED";
  const off = !mutationToken() || stop.isPending || release.isPending || ended;
  const ask = (operation: SandboxOperation, run: () => Promise<unknown>) => onConfirm({ ...WORDS[operation], run });
  return (
    <div className={styles.stack}>
      <div className={styles.line}>
        <Button disabled={off} onClick={() => ask("stop", () => stop.mutateAsync())}>Stop sandbox</Button>
        <Button disabled={off} onClick={() => ask("release", () => release.mutateAsync())}>Release sandbox</Button>
      </div>
      {stop.isError && <ErrorState error={stop.error} title="The sandbox was not stopped" />}
      {release.isError && <ErrorState error={release.error} title="The sandbox was not released" />}
    </div>
  );
}
