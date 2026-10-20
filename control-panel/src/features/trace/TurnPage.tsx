import { Badge, Breadcrumb, BreadcrumbButton, BreadcrumbDivider, BreadcrumbItem, Caption1, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { ReactNode } from "react";
import { useParams } from "react-router";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { formatInstant } from "../../shared/format";
import { useFollow } from "../../shared/navigation/useFollow";
import { useTurn } from "./trace.api";
import type { GraphNode, PromptFacts, RoutedEntry, RoutingFacts, TurnDetail } from "./trace.types";
import { FOLLOWED, KIND, OUTCOME, TRACE_PATH, formatSpent, offsetFrom } from "./traceWords";

const useStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  verdict: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: tokens.spacingHorizontalS },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace },
  steps: { margin: 0, paddingInlineStart: tokens.spacingHorizontalXL, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  failed: { color: tokens.colorPaletteRedForeground1 },
  scroll: { overflowX: "auto" },
});

// `/trace/:id`: one prompt in full -- the router's whole requirement graph,
// every step the session took in order, and whether it followed, said in words.
export function TurnPage() {
  const { id = "" } = useParams();
  const turn = useTurn(id);
  if (turn.isPending) return <Shell body={<LoadingState label="Reading the turn…" />} />;
  if (turn.isError) return <Shell body={<ErrorState error={turn.error} title="Could not read this turn" onRetry={() => turn.refetch()} />} />;
  return <Detail turn={turn.data.turn} />;
}

function Shell({ body }: { body: ReactNode }) {
  return (
    <>
      <PageHeader title="Turn" context={<Trail current="Turn" />} />
      {body}
    </>
  );
}

function Trail({ current }: { current: string }) {
  const follow = useFollow();
  return (
    <Breadcrumb aria-label="Breadcrumb" size="small">
      <BreadcrumbItem>
        <BreadcrumbButton as="a" href={TRACE_PATH} onClick={follow(TRACE_PATH)}>
          Trace
        </BreadcrumbButton>
      </BreadcrumbItem>
      <BreadcrumbDivider />
      <BreadcrumbItem>
        <BreadcrumbButton current>{current}</BreadcrumbButton>
      </BreadcrumbItem>
    </Breadcrumb>
  );
}

// A salted fingerprint and a length is everything the trail knows of a prompt.
const promptSaid = (p: PromptFacts | null) => (p ? `${p.chars} characters${p.hash ? ` · fingerprint ${p.hash} (salted — the text is never kept)` : ""}` : "no prompt was recorded for these steps");

function Detail({ turn: t }: { turn: TurnDetail }) {
  const styles = useStyles();
  const title = `Prompt at ${formatInstant(t.at)}`;
  return (
    <>
      <PageHeader title={title} context={<Trail current={title} />} description={`${promptSaid(t.prompt)} · ${t.ms === null ? "still open" : `took ${formatSpent(t.ms)}`}`} />
      <div className={styles.page}>
        <Card title="Did the session follow the router?">
          <div className={styles.verdict}>
            <Badge appearance="tint" color={FOLLOWED[t.followed.verdict].color}>
              {FOLLOWED[t.followed.verdict].label}
            </Badge>
            <Text>{t.followed.say}</Text>
          </div>
          <div className={styles.verdict}>
            <Badge appearance="outline" color={OUTCOME[t.outcome].color}>
              {OUTCOME[t.outcome].label}
            </Badge>
            <Caption1 className={styles.muted}>How the turn ended</Caption1>
          </div>
        </Card>
        <Decision routing={t.routing} />
        <Steps turn={t} />
      </div>
    </>
  );
}

const ids = (list: RoutedEntry[] | undefined) => (list ?? []).map((e) => e.id).join(", ") || "—";

const decisionSaid = (r: RoutingFacts) => {
  const cues = r.cues ?? [];
  return `intent ${r.intent ?? "—"} (${r.confidence ?? "—"})${cues.length ? ` · matched ${cues.join(", ")}` : ""} · context ${r.injected ? "added to the prompt" : "not added"}`;
};

function Decision({ routing }: { routing: RoutingFacts | null }) {
  const styles = useStyles();
  if (routing?.routing !== "on") {
    return (
      <Card title="Router decision">
        <Text className={styles.muted}>No routing decision was recorded — the router was off, or the trail started after the prompt.</Text>
      </Card>
    );
  }
  return (
    <Card title="Router decision" subtitle={decisionSaid(routing)}>
      <Caption1>
        Selected: {ids(routing.selected)} · needs approval: {ids(routing.approval)} · blocked: {ids(routing.blocked)} · missing: {ids(routing.missing)}
      </Caption1>
      <div className={styles.scroll}>
        <Table aria-label="Requirement graph" size="small">
          <TableHeader>
            <TableRow>
              {["Requirement", "Level", "Status", "Provider"].map((h) => (
                <TableHeaderCell key={h}>{h}</TableHeaderCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(routing.graph ?? []).map((n) => (
              <Node key={n.requirement} node={n} />
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

function Node({ node: n }: { node: GraphNode }) {
  const styles = useStyles();
  return (
    <TableRow>
      <TableCell className={styles.mono}>{n.requirement}</TableCell>
      <TableCell>
        {n.level}
        {n.transitive ? <Caption1 className={styles.muted}> · pulled in by a provider</Caption1> : null}
      </TableCell>
      <TableCell>{n.status}</TableCell>
      <TableCell className={styles.mono}>{n.provider ? `${n.provider.kind}:${n.provider.id}` : "—"}</TableCell>
    </TableRow>
  );
}

function Steps({ turn: t }: { turn: TurnDetail }) {
  const styles = useStyles();
  return (
    <Card title="Path" subtitle="What the session did, in order. A command keeps only its Orbit script and a subcommand its usage documents — never an argument.">
      {t.steps.length === 0 && <Text className={styles.muted}>No steps were recorded for this prompt.</Text>}
      <ol className={styles.steps} aria-label="Steps">
        {t.steps.map((s, at) => (
          <li key={`${s.at}-${at}`} className={s.ok === false ? styles.failed : undefined}>
            <Caption1 className={styles.muted}>
              {offsetFrom(t.at, s.at)} · {KIND[s.kind]}
            </Caption1>{" "}
            <span className={styles.mono}>{s.label}</span>
            {s.ok === null ? " — unknown" : s.ok ? "" : " — failed"}
            {s.refused ? " — refused by its switch" : ""}
          </li>
        ))}
      </ol>
    </Card>
  );
}
