import { Button, Caption1, MessageBar, MessageBarBody, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, makeStyles, tokens } from "@fluentui/react-components";
import { mutationToken } from "../../../shared/api/client";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { formatRelative } from "../../../shared/format";
import { StateBadge } from "../StateBadge";
import { runtimeApi, useRuntimeOperation, type StartBody, type StopBody } from "../runtime.api";
import type { CheckoutRef, ExternalServer, Readiness, RuntimeStatus, Session, StartResult, StopResult } from "../runtime.types";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
  muted: { color: tokens.colorNeutralForeground3 },
});

const live = (s: Session) => s.state === "RUNNING" || s.state === "AMBIGUOUS";

function readinessWord(r: Readiness): string {
  if (r.state === "READY") return "answers";
  if (r.state === "NOT_READY") return "not answering yet";
  if (r.state === "READINESS_UNKNOWN") return "nothing says how to tell";
  return r.state === "NOT_CHECKED" ? "not asked" : "not running";
}

// What Orbit started on this machine and can PROVE is its own -- a receipt, a pid and the pid's
// start time -- and whether it ANSWERS. Running is not ready, and ready is not verified: this card
// says whether a process is there and whether it answers where it says it listens, and nothing
// about whether the product is right. Stopping touches only what is proven; anything else is
// refused and said.
export function SessionsCard({ at, status }: { at: CheckoutRef; status: RuntimeStatus }) {
  const styles = useStyles();
  const start = useRuntimeOperation<StartBody, StartResult>(at, runtimeApi.start);
  const stop = useRuntimeOperation<StopBody, StopResult>(at, runtimeApi.stop);
  const sessions = status.sessions.filter(live);
  const ready = status.plan.components.some((c) => c.state === "ready" && c.command);
  const off = !mutationToken() || start.isPending || stop.isPending;
  return (
    <Card title="What is running" subtitle="Only what Orbit started and can prove is its own. Running is not ready, and ready is not verified.">
      <div className={styles.stack}>
        {sessions.length === 0 ? <Caption1 className={styles.muted}>Nothing of Orbit's is running for this checkout.</Caption1> : <Sessions sessions={sessions} off={off} onStop={(id) => stop.mutate({ session: id })} />}
        {(status.external ?? []).length > 0 && <External servers={status.external ?? []} />}
        <div className={styles.actions}>
          <Button appearance="primary" disabled={off || !ready} onClick={() => start.mutate({ wait: 30 })}>{start.isPending ? "Starting…" : "Start what can start"}</Button>
          <Button disabled={off || sessions.length === 0} onClick={() => stop.mutate({})}>{stop.isPending ? "Stopping…" : "Stop what Orbit started"}</Button>
        </div>
        {start.isError && <ErrorState error={start.error} title="Nothing was started" />}
        {start.data && <StartResultNote result={start.data} />}
        {stop.isError && <ErrorState error={stop.error} title="Nothing was stopped" />}
        {stop.data && <StopResultNote result={stop.data} />}
      </div>
    </Card>
  );
}

function Sessions({ sessions, off, onStop }: { sessions: Session[]; off: boolean; onStop: (id: string) => void }) {
  return (
    <Table aria-label="Running" size="small">
      <TableHeader>
        <TableRow>
          <TableHeaderCell>Component</TableHeaderCell>
          <TableHeaderCell>State</TableHeaderCell>
          <TableHeaderCell>Whose</TableHeaderCell>
          <TableHeaderCell>Answers?</TableHeaderCell>
          <TableHeaderCell>Started</TableHeaderCell>
          <TableHeaderCell />
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.map((s) => (
          <TableRow key={s.id}>
            <TableCell>{s.component}{s.pid ? ` · pid ${s.pid}` : ""}</TableCell>
            <TableCell><StateBadge word={s.state} /></TableCell>
            <TableCell><StateBadge word={s.ownership} label={s.ownership === "ORBIT_OWNED" ? "Orbit's own" : s.ownership === "EXTERNAL" ? "not Orbit's" : "cannot tell"} /></TableCell>
            <TableCell>
              <StateBadge word={s.readiness.state} label={readinessWord(s.readiness)} />
              {s.readiness.probe && <Caption1> {s.readiness.probe.source === "human" ? "you set" : "a file says"}: {s.readiness.probe.kind} {s.readiness.probe.target}</Caption1>}
            </TableCell>
            <TableCell>{s.startedAt ? formatRelative(s.startedAt) : "—"}</TableCell>
            <TableCell>{s.ownership === "ORBIT_OWNED" && s.state === "RUNNING" && <Button size="small" disabled={off} onClick={() => onStop(s.id)} aria-label={`Stop ${s.component}`}>Stop</Button>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

const probeSay = (r: Readiness) => (r.probe ? ` (${r.probe.kind} ${r.probe.target})` : "");

// Answering where a person said the component should, and started by somebody else: reused, never
// owned. There is no Stop beside it, because Orbit stops only what it can prove it started.
function External({ servers }: { servers: ExternalServer[] }) {
  const styles = useStyles();
  return (
    <div>
      <Caption1 className={styles.muted}>Answering here and not Orbit's — a start reuses it, and Orbit never stops it:</Caption1>
      <ul className={styles.list} aria-label="Reused, not Orbit's">{servers.map((s) => <li key={s.component}>{s.component}: {readinessWord(s.readiness)}{probeSay(s.readiness)}</li>)}</ul>
    </div>
  );
}

export function StartResultNote({ result }: { result: StartResult }) {
  const styles = useStyles();
  const lines = [
    ...result.started.map((s) => `started ${s.component} (pid ${s.pid})${s.readiness ? `: ${readinessWord(s.readiness)}` : ""}${s.withheld?.length ? ` — not handed to it (a value with a line break): ${s.withheld.join(", ")}` : ""}`),
    ...(result.reused ?? []).map((r) => `reused ${r.component}: already running and not Orbit's, it ${readinessWord(r.readiness)}${probeSay(r.readiness)} — never stopped by Orbit`),
    ...result.skipped.map((s) => `${s.component} was already running (pid ${s.pid})`),
    ...result.blocked.map((b) => `${b.component} is blocked: ${b.blocking.join("; ")}`),
    ...result.notReady.map((n) => `${n.component} was not started: ${n.because}`),
  ];
  return (
    <MessageBar intent={result.blocked.length ? "warning" : "success"} layout="multiline">
      <MessageBarBody>
        <ul className={styles.list} aria-label="What the start did">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
      </MessageBarBody>
    </MessageBar>
  );
}

function StopResultNote({ result }: { result: StopResult }) {
  const styles = useStyles();
  const lines = [
    ...result.stopped.map((s) => `stopped ${s.component} (${s.how})${s.residual ? `: ${s.residual}` : ""}`),
    ...result.gone.map((g) => `${g.component}: ${g.outcome === "gone" ? "it had already exited" : "the pid is another process's now; nothing was touched"}`),
    ...result.refused.map((r) => `${r.component ?? r.session} was refused: ${r.why}`),
    ...result.released.map((r) => `released ${r.component}`),
    ...(result.environment ? [`environment: ${result.environment.because}`] : []),
  ];
  return (
    <MessageBar intent={result.refused.length ? "warning" : "success"} layout="multiline">
      <MessageBarBody>
        <ul className={styles.list} aria-label="What the stop did">{(lines.length ? lines : ["nothing of Orbit's was running"]).map((l) => <li key={l}>{l}</li>)}</ul>
      </MessageBarBody>
    </MessageBar>
  );
}
