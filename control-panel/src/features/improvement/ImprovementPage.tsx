import { useState } from "react";
import { Button, Caption1, Field, Input, Link, MessageBar, MessageBarBody, Select, Switch, Tab, TabList, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { ApiError, mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { StatTile } from "../../shared/components/StatTile";
import { formatDateTime } from "../../shared/format";
import { useFollow } from "../../shared/navigation/useFollow";
import { WordBadge } from "../mission-control/components";
import { useProjects } from "../projects/projects.api";
import { improvementKeys, useImprovement, useOpportunities, useSaveSettings } from "./improvement.api";
import type { CampaignRow, ImprovementField, ImprovementOverview, ImprovementSettings, Opportunity, SettingValue } from "./improvement.types";
import { COUNTS, TABS, byLabel, campaignPath, countOf, isTab, metricValue, phaseTone, type TabId } from "./improvementWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  tiles: { display: "grid", gap: tokens.spacingHorizontalM, gridTemplateColumns: "repeat(auto-fit, minmax(11rem, 1fr))" },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))", gap: tokens.spacingHorizontalL, alignItems: "start" },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
  tabs: { flexWrap: "wrap" },
});

// `/improvement`: AUTONOMOUS IMPROVEMENT (0.3.0, ADR 0045). What the engine found in this project's reusable playbooks
// and Satellite roles, what each campaign is doing about it and on what evidence, the nine quality metrics with what
// each divides by, and the bounds a person sets. Every count is a count of campaigns in a phase; nothing here is a
// progress percentage, and nothing here runs an evaluation -- a person only promotes, puts back or rejects, on the
// candidate's own page.
export function ImprovementPage() {
  const styles = useStyles();
  const client = useQueryClient();
  const projects = useProjects();
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab: TabId = isTab(asked) ? asked : "overview";
  const key = params.get("project") ?? projects.data?.projects[0]?.key ?? null;
  const go = (patch: Record<string, string>) => setParams({ ...(key ? { project: key } : {}), tab, ...patch });
  return (
    <>
      <PageHeader
        title="Autonomous improvement"
        description="What this project's reusable playbooks and Satellite roles showed in independent sessions, the successors Orbit drafted for them, and how each was compared with the version it would replace. A candidate runs only after it evaluated better in independent sessions and passed every gate; a person's switch always wins."
        actions={<Button icon={<ArrowClockwise20Regular />} onClick={() => client.invalidateQueries({ queryKey: improvementKeys.all })}>Refresh</Button>}
      />
      <div className={styles.actions}>
        <Field label="Project">
          <Select value={key ?? ""} onChange={(_, d) => go({ project: d.value })}>
            {(projects.data?.projects ?? []).map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </Select>
        </Field>
      </div>
      <TabList className={styles.tabs} selectedValue={tab} onTabSelect={(_, d) => isTab(d.value) && go({ tab: d.value })} aria-label="Autonomous improvement">
        {TABS.map((t) => <Tab key={t.id} value={t.id}>{t.label}</Tab>)}
      </TabList>
      {projects.isPending && <LoadingState label="Reading the projects this machine knows…" />}
      {projects.data && !key && <MessageBar intent="info"><MessageBarBody>No project is known on this machine yet: Orbit improves a project's playbooks once it has been used there.</MessageBarBody></MessageBar>}
      {key && <Body key={key} project={key} tab={tab} />}
    </>
  );
}

function Body({ project, tab }: { project: string; tab: TabId }) {
  const view = useImprovement(project);
  if (view.isPending) return <LoadingState label="Reading what self-improvement found…" />;
  if (view.isError) return <ErrorState error={view.error} title="Could not read self-improvement" onRetry={() => view.refetch()} />;
  if (tab === "opportunities") return <OpportunitiesTab project={project} />;
  if (tab === "settings") return <SettingsTab project={project} settings={view.data.settings} />;
  return <OverviewTab project={project} view={view.data} />;
}

// ---- overview ---------------------------------------------------------------------------------------------------

function OverviewTab({ project, view }: { project: string; view: ImprovementOverview }) {
  const styles = useStyles();
  const active = view.campaigns.filter((c) => !c.outcome).length;
  return (
    <div className={styles.stack}>
      <div className={styles.tiles}>
        <StatTile label="Opportunities" value={String(view.opportunities.total)} caption={`${view.opportunities.eligible} eligible`} />
        <StatTile label="Active campaigns" value={String(active)} />
        {COUNTS.map((c) => <StatTile key={c.label} label={c.label} value={String(countOf(view.phases, c.phases))} />)}
      </div>
      <Caption1 className={styles.muted}>{view.analysed?.at ? `Last analysed ${formatDateTime(view.analysed.at)}.` : "Not analysed yet: improve analyse runs after a workflow ends and from the hooks."}</Caption1>
      <CampaignsCard project={project} rows={view.campaigns} />
      <MetricsCard view={view} />
    </div>
  );
}

function CampaignsCard({ project, rows }: { project: string; rows: CampaignRow[] }) {
  const follow = useFollow();
  if (!rows.length) return <Card title="Campaigns"><Text>No campaign has started: nothing has failed the same way in enough independent sessions to be worth improving.</Text></Card>;
  return (
    <Card title="Campaigns" subtitle="One per definition at a time; each line is what its journal says now.">
      <Table aria-label="Campaigns">
        <TableHeader><TableRow><TableHeaderCell>Campaign</TableHeaderCell><TableHeaderCell>Phase</TableHeaderCell><TableHeaderCell>Definition</TableHeaderCell><TableHeaderCell>Candidate</TableHeaderCell><TableHeaderCell>Carried by</TableHeaderCell></TableRow></TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell><Link href={campaignPath(project, r.id)} onClick={follow(campaignPath(project, r.id))}>{r.id}</Link></TableCell>
              <TableCell><WordBadge word={r.phase} tone={phaseTone(r.phase)} />{r.outcome ? <Caption1>{` ${r.outcome}`}</Caption1> : null}</TableCell>
              <TableCell>{`${r.subject ?? "?"} @ ${r.pin ?? "?"}`}</TableCell>
              <TableCell>{r.candidate ?? "—"}</TableCell>
              <TableCell>{r.carrier}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function MetricsCard({ view }: { view: ImprovementOverview }) {
  return (
    <Card title="Quality of self-improvement" subtitle="Each a ratio with its own numerator and denominator, or not available yet. Promotion safety counts promotions no gate held, and is expected to stay at zero.">
      <Table aria-label="Quality metrics">
        <TableHeader><TableRow><TableHeaderCell>Metric</TableHeaderCell><TableHeaderCell>Now</TableHeaderCell></TableRow></TableHeader>
        <TableBody>
          {view.metrics.map((m) => (
            <TableRow key={m.id}>
              <TableCell><Text weight="semibold">{m.id}</Text><br /><Caption1>{m.say}</Caption1></TableCell>
              <TableCell>{metricValue(m)}{m.because ? <Caption1>{` — ${m.because}`}</Caption1> : null}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// ---- opportunities -----------------------------------------------------------------------------------------------

function OpportunitiesTab({ project }: { project: string }) {
  const read = useOpportunities(project);
  if (read.isPending) return <LoadingState label="Reading the opportunities…" />;
  if (read.isError) return <ErrorState error={read.error} title="Could not read the opportunities" />;
  if (!read.data.opportunities.length) return <Card title="Opportunities"><Text>Nothing recurring yet. One failure, or retries in one session, is never an opportunity.</Text></Card>;
  return (
    <Card title="Opportunities" subtitle="One per problem, by what it is about — the same problem seen again updates it, never adds a second.">
      <Table aria-label="Opportunities">
        <TableHeader><TableRow><TableHeaderCell>Opportunity</TableHeaderCell><TableHeaderCell>Evidence</TableHeaderCell><TableHeaderCell>Cause</TableHeaderCell><TableHeaderCell>Eligible</TableHeaderCell></TableRow></TableHeader>
        <TableBody>{read.data.opportunities.map((o) => <OpportunityLine key={o.id} o={o} />)}</TableBody>
      </Table>
    </Card>
  );
}

function OpportunityLine({ o }: { o: Opportunity }) {
  const styles = useStyles();
  if (o.unreadable) return <TableRow><TableCell className={styles.mono}>{o.id}</TableCell><TableCell colSpan={3}>{`Cannot be read (${o.unreadable}) — kept exactly as it is.`}</TableCell></TableRow>;
  return (
    <TableRow>
      <TableCell><span className={styles.mono}>{o.id}</span><br /><Caption1>{`${o.subject?.id ?? "?"} @ ${o.pin ?? "?"} · ${o.signal} on ${(o.signature ?? []).join(", ") || "—"}`}</Caption1></TableCell>
      <TableCell>{`${o.runs} run(s) in ${o.sessions} independent session(s), ${o.against} against`}<br /><Caption1>{`attribution: ${o.attribution?.bound ?? 0} of ${o.attribution?.of ?? 0} bound by an engine`}</Caption1></TableCell>
      <TableCell>{`${o.cause} (${o.confidence})`}{(o.environment ?? []).map((e) => <Caption1 key={e}><br />{e}</Caption1>)}</TableCell>
      <TableCell>{o.eligible ? "eligible" : o.check}<br /><Caption1>{o.because}</Caption1></TableCell>
    </TableRow>
  );
}

// ---- settings ----------------------------------------------------------------------------------------------------

function SettingsTab({ project, settings }: { project: string; settings: ImprovementSettings }) {
  const styles = useStyles();
  const save = useSaveSettings(project, settings.revision);
  const [changes, setChanges] = useState<Record<string, SettingValue>>({});
  const stale = save.error instanceof ApiError && save.error.code === "STALE_REVISION";
  const shown = (f: ImprovementField): SettingValue => (f.key in changes ? changes[f.key] ?? null : settings.values[f.key] ?? f.default);
  return (
    <Card title={`Bounds for project ${project}`} subtitle="These only narrow what this machine allows (Automation limits → Self-improvement); each value says who set it.">
      <div className={styles.form}>
        {settings.fields.map((f) => <SettingField key={f.key} field={f} value={shown(f)} by={settings.by[f.key] ?? "default"} onChange={(v) => setChanges({ ...changes, [f.key]: v })} />)}
      </div>
      <Caption1 className={styles.muted}>improvement.allowExecutableCandidates is fixed at false in this release.</Caption1>
      <div className={styles.actions}>
        <Button appearance="primary" disabled={!mutationToken() || save.isPending || Object.keys(changes).length === 0} onClick={() => save.mutate(changes)}>{save.isPending ? "Saving…" : "Save"}</Button>
        {!mutationToken() && <Caption1 className={styles.muted}>Read-only: open Control from the link it printed to change these.</Caption1>}
        {save.isSuccess && <Caption1>Saved.</Caption1>}
      </div>
      {stale && <MessageBar intent="warning"><MessageBarBody>Somebody changed these bounds since you opened them. Refresh, then make your change again.</MessageBarBody></MessageBar>}
      {save.isError && !stale && <ErrorState error={save.error} title="The bounds were not saved" />}
    </Card>
  );
}

function SettingField({ field, value, by, onChange }: { field: ImprovementField; value: SettingValue; by: string; onChange: (v: SettingValue) => void }) {
  const hint = `${field.say}. Now ${String(value)} (${byLabel(by)}).`;
  if (field.type === "boolean") return <Field hint={hint}><Switch checked={value === true} label={field.path} onChange={(_, d) => onChange(d.checked)} /></Field>;
  if (field.type === "enum") return <Field label={field.path} hint={hint}><Select value={String(value ?? "")} onChange={(_, d) => onChange(d.value)}>{(field.values ?? []).map((v) => <option key={v} value={v}>{v}</option>)}</Select></Field>;
  return <Field label={field.path} hint={hint}><Input type="number" min={field.min ?? undefined} max={field.max ?? undefined} value={value === null ? "" : String(value)} onChange={(_, d) => onChange(d.value === "" ? null : Number(d.value))} /></Field>;
}
