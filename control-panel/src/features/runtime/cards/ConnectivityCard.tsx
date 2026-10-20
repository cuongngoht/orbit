import { Badge, Button, Caption1, Subtitle2, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, makeStyles, tokens } from "@fluentui/react-components";
import { mutationToken } from "../../../shared/api/client";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { LoadingState } from "../../../shared/components/LoadingState";
import { StateBadge } from "../StateBadge";
import { type ReachAsk, runtimeApi, useConnectivity, useReachOperation } from "../runtime.api";
import type { CheckoutRef, Connectivity, Observation, Provider, ReachTarget } from "../runtime.types";
import { PROVIDER_SAY, REACH_SAY, RESOLUTION_SAY, TRANSPORT_SAY, observationLine } from "../runtimeWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  target: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  head: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  answer: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: tokens.spacingVerticalXXS },
  badges: { display: "flex", gap: tokens.spacingHorizontalXS, flexWrap: "wrap" },
  actions: { display: "flex", gap: tokens.spacingHorizontalXS, flexWrap: "wrap" },
  code: { fontFamily: tokens.fontFamilyMonospace },
  muted: { color: tokens.colorNeutralForeground3 },
  // A fixed layout shares the width out evenly; the answer is the column that has something to say.
  from: { width: "9rem" },
  fact: { width: "10rem" },
  act: { width: "11rem" },
});

type Mode = "check" | "retry";

/** Which button a person pressed, so only that one says it is asking. */
interface Asking {
  mode: Mode;
  ask: ReachAsk | undefined;
}

// Whether a server this checkout needs can be REACHED -- from each place a component can run, each
// asked on its own: the host reaching a database through a VPN says nothing about the dev container
// reaching it. Reading this card asks nothing: it shows what was kept and how old it is, and an answer
// older than the engine's freshness is STALE, never "now". Check once is one attempt; Retry is the
// saved policy, run by the engine. One click is one request, and nothing here loops, polls or watches.
export function ConnectivityCard({ at, names = {} }: { at: CheckoutRef; names?: Record<string, string> }) {
  const styles = useStyles();
  const connectivity = useConnectivity(at);
  const check = useReachOperation(at, runtimeApi.checkReach);
  const retry = useReachOperation(at, runtimeApi.retryReach);
  const asking: Asking | null = check.isPending ? { mode: "check", ask: check.variables } : retry.isPending ? { mode: "retry", ask: retry.variables } : null;
  const onAsk = (mode: Mode, ask: ReachAsk) => (mode === "check" ? check : retry).mutate(ask);
  return (
    <Card title="Connectivity" subtitle="Whether each server this checkout needs can be reached, from this machine and from inside the dev container — asked separately, because they are two networks. Orbit controls no VPN.">
      <div className={styles.stack}>
        {connectivity.isPending && <LoadingState label="Reading what was last observed…" />}
        {connectivity.isError && <ErrorState error={connectivity.error} title="Could not read what was last observed" />}
        {connectivity.data && <Targets connectivity={connectivity.data} names={names} off={!mutationToken() || asking !== null} asking={asking} onAsk={onAsk} />}
        {check.isError && <ErrorState error={check.error} title="The check was not made" />}
        {retry.isError && <ErrorState error={retry.error} title="The retry was not made" />}
        <Caption1 className={styles.muted}>Reachable is not ready and not a login: a connection was accepted, and nothing was asked of what answered.</Caption1>
      </div>
    </Card>
  );
}

interface AskProps {
  off: boolean;
  asking: Asking | null;
  onAsk: (mode: Mode, ask: ReachAsk) => void;
}

function Targets({ connectivity, names, ...ask }: { connectivity: Connectivity; names: Record<string, string> } & AskProps) {
  const styles = useStyles();
  if (connectivity.targets.length === 0) return <Caption1 className={styles.muted}>No server this checkout needs is named for this machine. Name one under Settings for this machine: a host, a port, and where to check it from.</Caption1>;
  return <>{connectivity.targets.map((t) => <Target key={t.id} target={t} names={names} {...ask} />)}</>;
}

function Target({ target, names, ...ask }: { target: ReachTarget; names: Record<string, string> } & AskProps) {
  const styles = useStyles();
  return (
    <div className={styles.target}>
      <div className={styles.head}>
        <Subtitle2 as="h3">{target.label}</Subtitle2>
        <Caption1 className={styles.code}>{target.host}:{target.port}</Caption1>
        {target.beforeStart && target.requiredBy.length > 0 && <Badge appearance="outline">checked before a start</Badge>}
      </div>
      <Caption1>{target.requiredBy.length ? `Needed by ${target.requiredBy.map((k) => names[k] ?? k).join(", ")}` : target.beforeStart ? "Set to be checked before a start, and no component requires it: it gates nothing yet" : "No component is said to need it"}</Caption1>
      <Caption1 className={styles.muted}>Retry asks up to {target.retry.attempts} time(s), {target.retry.intervalMs} ms apart, {target.retry.timeoutMs} ms each.</Caption1>
      {target.note && <Caption1>Note: {target.note}</Caption1>}
      <Table aria-label={`Connectivity of ${target.label}`} size="small">
        <TableHeader>
          <TableRow>
            <TableHeaderCell className={styles.from}>From</TableHeaderCell>
            <TableHeaderCell className={styles.fact}>DNS</TableHeaderCell>
            <TableHeaderCell className={styles.fact}>TCP</TableHeaderCell>
            <TableHeaderCell>Last answer</TableHeaderCell>
            <TableHeaderCell className={styles.act} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {target.checkFrom.map((p) => <Location key={p} target={target} provider={p} observation={target.observations[p]} {...ask} />)}
        </TableBody>
      </Table>
    </div>
  );
}

const pressed = (asking: Asking | null, mode: Mode, id: string, provider: Provider) => asking?.mode === mode && asking.ask?.id === id && asking.ask.body.provider === provider;

function Location({ target, provider, observation, off, asking, onAsk }: { target: ReachTarget; provider: Provider; observation: Observation | undefined } & AskProps) {
  const styles = useStyles();
  const where = PROVIDER_SAY[provider];
  const ask = { id: target.id, body: { provider } };
  return (
    <TableRow>
      <TableCell>{where}</TableCell>
      <TableCell>{observation ? <StateBadge word={observation.resolution} label={RESOLUTION_SAY[observation.resolution]} /> : "—"}</TableCell>
      <TableCell>{observation ? <StateBadge word={observation.transport} label={TRANSPORT_SAY[observation.transport]} /> : "—"}</TableCell>
      <TableCell>{observation ? <Answer observation={observation} /> : <Caption1 className={styles.muted}>not checked yet</Caption1>}</TableCell>
      <TableCell>
        <div className={styles.actions}>
          <Button size="small" disabled={off} aria-label={`Check ${target.label} from ${where} once`} onClick={() => onAsk("check", ask)}>{pressed(asking, "check", target.id, provider) ? "Checking…" : "Check once"}</Button>
          <Button size="small" disabled={off} aria-label={`Retry ${target.label} from ${where}`} onClick={() => onAsk("retry", ask)}>{pressed(asking, "retry", target.id, provider) ? "Retrying…" : "Retry"}</Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

// A kept answer says how old it is; one past the engine's freshness says STALE, so a person never
// reads an hour-old "reachable" as the network now.
function Answer({ observation }: { observation: Observation }) {
  const styles = useStyles();
  const stale = observation.state !== "NOT_CHECKED" && observation.freshness.stale;
  const line = observationLine(observation);
  return (
    <div className={styles.answer}>
      <div className={styles.badges}>
        <StateBadge word={observation.state} label={REACH_SAY[observation.state]} />
        {stale && <StateBadge word="STALE" label="stale: check again" />}
      </div>
      {line !== REACH_SAY[observation.state] && <Caption1><Said text={line} /></Caption1>}
    </div>
  );
}

// The engine's sentences mark a command `like this`: shown as code, never as stray backticks.
function Said({ text }: { text: string }) {
  const styles = useStyles();
  return <>{text.split("`").map((part, i) => (i % 2 === 1 ? <code key={i} className={styles.code}>{part}</code> : part))}</>;
}
