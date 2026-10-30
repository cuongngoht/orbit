import { useState } from "react";
import { Button, Caption1, Field, Input, Link, MessageBar, MessageBarBody, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useParams } from "react-router";
import { ApiError, mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { ConfirmDialog } from "../../shared/components/ConfirmDialog";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { formatDateTime } from "../../shared/format";
import { useFollow } from "../../shared/navigation/useFollow";
import { Facts, WordBadge } from "../mission-control/components";
import { useCampaign, useDecision } from "./improvement.api";
import type { Campaign, Decision, Evaluation, EvaluationSide } from "./improvement.types";
import { DECISIONS, DECISION_IDS, IMPROVEMENT_PATH, VERDICT_TONE, phaseTone } from "./improvementWords";

const useStyles = makeStyles({
  grid: { display: "grid", gap: tokens.spacingHorizontalL, gridTemplateColumns: "repeat(auto-fit, minmax(24rem, 1fr))" },
  wide: { gridColumn: "1 / -1" },
  mono: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
  list: { margin: 0, paddingInlineStart: tokens.spacingHorizontalXL, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  muted: { color: tokens.colorNeutralForeground3 },
});

// `/improvement/:key/campaigns/:id`: one CAMPAIGN and its candidate, as its journal says -- the version it would replace
// beside the successor, why it was drafted, every evaluation's baseline and candidate with what each ratio divides by,
// the regressions found, the promotion gates, the promotion and rollback history, and what stops it. The only things a
// person does here are the three decisions the campaign's phase takes, each on the revision this page read.
export function CampaignPage() {
  const { key, id } = useParams();
  if (!key || !id) return <MessageBar intent="warning"><MessageBarBody>This address does not name a campaign.</MessageBarBody></MessageBar>;
  return <Loaded key={`${key}/${id}`} project={key} id={id} />;
}

function Loaded({ project, id }: { project: string; id: string }) {
  const read = useCampaign(project, id);
  const follow = useFollow();
  const c = read.data?.campaign ?? null;
  return (
    <>
      <PageHeader
        title={c ? `${c.subject.id ?? "?"} — ${c.phase}` : id}
        context={<Caption1><Link href={`${IMPROVEMENT_PATH}?project=${encodeURIComponent(project)}`} onClick={follow(`${IMPROVEMENT_PATH}?project=${encodeURIComponent(project)}`)}>Autonomous improvement</Link>{` / ${id}`}</Caption1>}
        badges={c && <><WordBadge word={c.phase} tone={phaseTone(c.phase)} /><WordBadge word={c.mode} label={`mode ${c.mode}`} tone="subtle" /><WordBadge word={c.carrier} label={`carried by ${c.carrier}`} tone="subtle" /></>}
        actions={<Button icon={<ArrowClockwise20Regular />} disabled={read.isFetching} onClick={() => read.refetch()}>Refresh</Button>}
      />
      {read.isPending && <LoadingState label="Reading the campaign's journal…" />}
      {read.isError && <ErrorState error={read.error} title="Could not read this campaign" onRetry={() => read.refetch()} />}
      {c && <Decisions project={project} campaign={c} />}
      {c && <Detail campaign={c} />}
    </>
  );
}

// ---- a person's decisions ----------------------------------------------------------------------------------------

function Decisions({ project, campaign }: { project: string; campaign: Campaign }) {
  const decide = useDecision(project, campaign.id);
  const [asked, setAsked] = useState<Decision | null>(null);
  const [because, setBecause] = useState("");
  // A blocked campaign offers every decision: what its phase beneath the block does not take, the server refuses.
  const offered = DECISION_IDS.filter((d) => campaign.phase === "BLOCKED" || DECISIONS[d].phases.includes(campaign.phase));
  const stale = decide.error instanceof ApiError && decide.error.code === "STALE_REVISION";
  if (!offered.length && !decide.isError) return null;
  return (
    <Card title="Decide" subtitle={mutationToken() ? "Each decision is made on the revision this page read; a promotion is held to every gate again." : "Read-only: open Control from the link it printed to decide."}>
      <div>{offered.map((d) => <Button key={d} appearance={d === "promote" ? "primary" : "secondary"} disabled={!mutationToken() || decide.isPending} onClick={() => setAsked(d)}>{DECISIONS[d].label}</Button>)}</div>
      {stale && <MessageBar intent="warning"><MessageBarBody>The campaign moved since you opened it. Refresh, then decide on what is there now.</MessageBarBody></MessageBar>}
      {decide.isError && !stale && <ErrorState error={decide.error} title="The decision was not made" />}
      <ConfirmDialog open={asked !== null} title={asked ? DECISIONS[asked].label : ""} confirmLabel={asked ? DECISIONS[asked].label : "Confirm"} destructive={asked ? DECISIONS[asked].destructive : false} busy={decide.isPending} onCancel={() => setAsked(null)} onConfirm={() => { if (asked) decide.mutate({ decision: asked, expectedRevision: campaign.revision, because: because || undefined }); setAsked(null); }}>
        <Text>{asked ? DECISIONS[asked].say : ""}</Text>
        {asked === "reject" && <Field label="Why (one sentence, kept with the decision)"><Input value={because} onChange={(_, d) => setBecause(d.value.slice(0, 240))} /></Field>}
      </ConfirmDialog>
    </Card>
  );
}

// ---- what the journal says --------------------------------------------------------------------------------------------

function Detail({ campaign: c }: { campaign: Campaign }) {
  const styles = useStyles();
  return (
    <div className={styles.grid}>
      <AboutCard c={c} />
      <WhyCard c={c} />
      <SuccessorCard c={c} />
      <div className={styles.wide}><EvaluationsCard c={c} /></div>
      <GatesCard c={c} />
      <HistoryCard c={c} />
      <div className={styles.wide}><EventsCard c={c} /></div>
    </div>
  );
}

function AboutCard({ c }: { c: Campaign }) {
  const styles = useStyles();
  return (
    <Card title="What it is about" subtitle={c.say ?? undefined}>
      <Facts label="What it is about" rows={[["Definition", `${c.subject.kind} ${c.subject.id}`], ["Version", <span className={styles.mono}>{c.pin}</span>], ["Signal", `${c.signal} on ${c.signature.join(", ") || "—"}`], ["Evidence", `${c.runs ?? "?"} run(s) in ${c.sessions ?? "?"} independent session(s)`], ["Opportunity", <span className={styles.mono}>{c.opportunity}</span>]]} />
      <ul className={styles.list} aria-label="Evidence references">{c.evidence.map((e) => <li key={e} className={styles.mono}>{e}</li>)}</ul>
    </Card>
  );
}

function WhyCard({ c }: { c: Campaign }) {
  const d = c.diagnosis;
  if (!d) return <Card title="Why"><Text>Not diagnosed yet.</Text></Card>;
  return (
    <Card title="Why" subtitle={`${d.cause} (${d.confidence} confidence)`}>
      <Facts label="Diagnosis" rows={[["Hypothesis", d.hypothesis ?? "—"], ["Against it", (d.contradicting ?? []).join("; ") || "nothing"], ["Not known", (d.unknowns ?? []).join("; ") || "—"], ["How it is tested", d.test ?? "—"], ["What must show", d.expected ?? "—"]]} />
    </Card>
  );
}

function SuccessorCard({ c }: { c: Campaign }) {
  const styles = useStyles();
  if (!c.candidate) return <Card title="The successor"><Text>{c.phase === "GENERATING" ? "Drafted from the current version; the host writes what changes." : "No candidate yet."}</Text></Card>;
  return (
    <Card title="The successor" subtitle={c.proposal?.change ?? undefined}>
      <Facts label="The successor" rows={[["Candidate", <span className={styles.mono}>{c.candidate.id}</span>], ["Replaces", <span className={styles.mono}>{c.pin}</span>], ["Proposed version", <span className={styles.mono}>{c.candidate.pin}</span>], ["Changed", c.candidate.changed.join(", ") || "—"]]} />
    </Card>
  );
}

const side = (s: EvaluationSide | undefined) => (s ? `met ${s.met} of ${s.runs} · verified ${s.verified} · ${s.failing} failing · ${s.blocked} blocked · ${s.retries} retries · ${s.calls} calls · ${s.ms === null ? "time not measured" : `${s.ms} ms`}` : "not measured");

function EvaluationsCard({ c }: { c: Campaign }) {
  if (!c.evaluations.length) return <Card title="Baseline beside candidate"><Text>No evaluation yet.</Text></Card>;
  return (
    <Card title="Baseline beside candidate" subtitle={c.aggregate ? `${c.aggregate.verdict} — ${c.aggregate.because}` : "Run n of each version on the same frozen inputs."}>
      <Table aria-label="Evaluations">
        <TableHeader><TableRow><TableHeaderCell>Evaluation</TableHeaderCell><TableHeaderCell>Baseline</TableHeaderCell><TableHeaderCell>Candidate</TableHeaderCell><TableHeaderCell>Verdict</TableHeaderCell></TableRow></TableHeader>
        <TableBody>{c.evaluations.map((e) => <EvaluationLine key={e.evaluation} e={e} />)}</TableBody>
      </Table>
    </Card>
  );
}

function EvaluationLine({ e }: { e: Evaluation }) {
  return (
    <TableRow>
      <TableCell>{e.evaluation}<br /><Caption1>{`${e.recorded}${e.planned ? ` of ${e.planned}` : ""} run(s) · ${e.session ?? e.host ?? "?"} · ${formatDateTime(e.at)} · ${e.attribution.join(", ") || "—"}`}</Caption1></TableCell>
      <TableCell>{side(e.metrics?.baseline)}</TableCell>
      <TableCell>{side(e.metrics?.candidate)}{(e.metrics?.unknown ?? []).map((u) => <Caption1 key={u.id}><br />{`${u.id}: not available — ${u.because}`}</Caption1>)}</TableCell>
      <TableCell><WordBadge word={e.verdict ?? (e.open ? "OPEN" : "?")} tone={VERDICT_TONE[e.verdict ?? ""] ?? "informative"} /><br /><Caption1>{e.because ?? ""}</Caption1>{e.regressions.length ? <Caption1><br />{`critical regression: ${e.regressions.join(", ")}`}</Caption1> : null}</TableCell>
    </TableRow>
  );
}

function GatesCard({ c }: { c: Campaign }) {
  const styles = useStyles();
  if (!c.gates) return <Card title="Promotion gates"><Text>Asked once the candidate qualifies.</Text></Card>;
  return (
    <Card title="Promotion gates" subtitle={c.gates.failed ? `Held by ${c.gates.failed}` : "Every gate held"}>
      <ul className={styles.list} aria-label="Promotion gates">{c.gates.rows.map((g) => <li key={g.id}>{`${g.holds ? "✓" : "✗"} ${g.id}`}</li>)}</ul>
      {c.awaiting && <Caption1>{c.awaiting}</Caption1>}
    </Card>
  );
}

function HistoryCard({ c }: { c: Campaign }) {
  const rows: (readonly [string, string])[] = [
    ...(c.promotion ? [["Promoted", `${c.promotion.from} → ${c.promotion.to} by ${c.promotion.by} (${c.promotion.door}) ${formatDateTime(c.promotion.at)}`] as const] : []),
    ...c.observations.slice(-3).map((o, i) => [`Watched ${i + 1}`, `${o.word}: ${o.runs} run(s) in ${o.sessions} session(s)`] as const),
    ...(c.regression ? [["Regression", c.regression.because ?? `${c.regression.sessions ?? "?"} session(s)`] as const] : []),
    ...(c.rollback ? [["Rollback", `${c.rollback.state} ${c.rollback.from} → ${c.rollback.to} (${c.rollback.door})`] as const] : []),
    ...(c.blocked ? [["Blocked", `${c.blocked.stop}${c.blocked.because ? ` — ${c.blocked.because}` : ""}`] as const] : []),
    ...(c.rejected ? [["Rejected", `${c.rejected.reason}${c.rejected.by ? ` by ${c.rejected.by}` : ""}${c.rejected.because ? ` — ${c.rejected.because}` : ""}`] as const] : []),
    ...(c.ended ? [["Ended", `${c.ended.outcome}${c.ended.because ? ` — ${c.ended.because}` : ""}`] as const] : []),
    ...(c.learned ? [["Learned", `${c.learned.kept ? "kept" : "not kept"}${c.learned.because ? ` — ${c.learned.because}` : ""}`] as const] : []),
  ];
  return <Card title="Promotion and rollback history">{rows.length ? <Facts label="History" rows={rows} /> : <Text>Nothing has been promoted or put back.</Text>}</Card>;
}

function EventsCard({ c }: { c: Campaign }) {
  const styles = useStyles();
  return (
    <Card title="Transitions" subtitle="The campaign's newest lines, by the names Orbit Live shows them under.">
      <ul className={styles.list} aria-label="Transitions">{c.events.map((e) => <li key={e.n}><span className={styles.mono}>{e.event}</span>{` ${formatDateTime(e.at)}${e.mode ? ` · ${e.mode}` : ""}${e.verdict ? ` · ${e.verdict}` : ""}${e.outcome ? ` · ${e.outcome}` : ""}${e.stop ? ` · ${e.stop}` : ""}`}</li>)}</ul>
    </Card>
  );
}
