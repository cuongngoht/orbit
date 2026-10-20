import { useState } from "react";
import { Badge, Button, Caption1, Field, Input, MessageBar, MessageBarBody, Select, Switch, Tab, TabList, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { ApiError, mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { useProjects } from "../projects/projects.api";
import { automationKeys, useAutomation, useGeneratedSkill, useGeneratedSkills, useMoveSkill, useProjectAutomation, useSaveLive, useSaveMachine, useSaveProject } from "./automation.api";
import type { AutomationOverview, DeclaredWorkflow, Effective, FieldRow, GeneratedSkill, GeneratedSkillDetail, HostReadiness, MatrixRow, SettingValue, SettingsDoc, SettingsTree, SkillMove } from "./automation.types";
import { STATUS_COLOR, TABS, VERDICT_COLOR, VERDICT_LABEL, byLabel, fieldsOf, isTab, treeOf, valueAt, type TabId } from "./automationWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))", gap: tokens.spacingHorizontalL, alignItems: "start" },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  // The tabs together are wider than a narrow window: they wrap onto a second row
  // rather than clip behind the edge with nothing to scroll.
  tabs: { flexWrap: "wrap" },
  code: { fontFamily: tokens.fontFamilyMonospace, whiteSpace: "pre-wrap", maxHeight: "24rem", overflow: "auto", backgroundColor: tokens.colorNeutralBackground3, padding: tokens.spacingHorizontalM },
});

// `/automation`: an ADVANCED page. Orbit is autonomous by default -- a task named to /orbit-help is coordinated with
// nothing to turn on, and every action is gated by its own class -- so nothing here is a switch that turns
// autonomy on or picks a mode. What is here: the limits an administrator may narrow (budgets, the skill
// factory's bounds, how Live looks), for this machine and narrowed for one project; a restriction a person kept
// from before, with the one way to lift it; the policy those give; what each host can do; and the playbooks
// Orbit generated. Nothing here starts a workflow.
export function AutomationPage() {
  const styles = useStyles();
  const client = useQueryClient();
  const view = useAutomation();
  const [params, setParams] = useSearchParams();
  const asked = params.get("tab");
  const tab: TabId = isTab(asked) ? asked : "general";
  return (
    <>
      <PageHeader
        title="Automation limits"
        description="Orbit coordinates a task handed to /orbit-help by default; nothing here turns that on. These are the limits a workflow is held to — budgets, the skill factory's bounds, how Live looks — and the playbooks it generated. Manual skills are never affected."
        actions={<Button icon={<ArrowClockwise20Regular />} onClick={() => client.invalidateQueries({ queryKey: automationKeys.all })}>Refresh</Button>}
      />
      <TabList className={styles.tabs} selectedValue={tab} onTabSelect={(_, d) => isTab(d.value) && setParams({ tab: d.value })} aria-label="Automation">
        {TABS.map((t) => <Tab key={t.id} value={t.id}>{t.label}</Tab>)}
      </TabList>
      {view.isPending && <LoadingState label="Reading the automation settings…" />}
      {view.isError && <ErrorState error={view.error} title="Could not read automation" onRetry={() => view.refetch()} />}
      {view.data && <TabBody tab={tab} view={view.data} />}
    </>
  );
}

function TabBody({ tab, view }: { tab: TabId; view: AutomationOverview }) {
  if (tab === "governance") return <GovernanceTab view={view} />;
  if (tab === "skills") return <GeneratedSkillsTab />;
  if (tab === "live") return <LiveTab view={view} />;
  return <SettingsTab tab={tab} view={view} />;
}

// ---- settings, machine or project ---------------------------------------------------------------------

function SettingsTab({ tab, view }: { tab: TabId; view: AutomationOverview }) {
  const styles = useStyles();
  const [project, setProject] = useState<string | null>(null);
  return (
    <div className={styles.stack}>
      <MessageBar intent="success"><MessageBarBody>Autonomous by default. Every action is gated by its own class.</MessageBarBody></MessageBar>
      <ScopePicker project={project} onChange={setProject} />
      {project === null ? <MachineSettings key={view.machine.revision ?? "new"} fields={fieldsOf(view.fields, tab)} view={view} /> : <ProjectSettings key={project} project={project} fields={fieldsOf(view.fields, tab)} />}
    </div>
  );
}

function ScopePicker({ project, onChange }: { project: string | null; onChange: (key: string | null) => void }) {
  const projects = useProjects();
  return (
    <Field label="Settings for" hint="A project can only narrow what this machine allows; every value below says who set it.">
      <Select value={project ?? ""} onChange={(_, d) => onChange(d.value === "" ? null : d.value)}>
        <option value="">This machine</option>
        {(projects.data?.projects ?? []).map((p) => <option key={p.key} value={p.key}>{`Project ${p.name}`}</option>)}
      </Select>
    </Field>
  );
}

function MachineSettings({ fields, view }: { fields: FieldRow[]; view: AutomationOverview }) {
  const save = useSaveMachine(view.machine.revision);
  return <SettingsForm fields={fields} doc={view.machine} effective={view.effective} fixed={view.fixed} save={save} />;
}

function ProjectSettings({ project, fields }: { project: string; fields: FieldRow[] }) {
  const view = useProjectAutomation(project);
  const save = useSaveProject(project, view.data?.settings.revision ?? null);
  if (view.isPending) return <LoadingState label="Reading the project's automation settings…" />;
  if (view.isError) return <ErrorState error={view.error} title="Could not read the project's settings" />;
  return (
    <>
      <Caption1>{`Project ${project}: it can only narrow what this machine allows.`}</Caption1>
      <SettingsForm key={view.data.settings.revision ?? "new"} fields={fields} doc={view.data.settings} effective={view.data.effective} fixed={{}} save={save} />
    </>
  );
}

interface Saving {
  mutate: (settings: SettingsTree) => void;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
}

function SettingsForm({ fields, doc, effective, fixed, save }: { fields: FieldRow[]; doc: SettingsDoc; effective: Effective; fixed: Record<string, boolean>; save: Saving }) {
  const styles = useStyles();
  const [changes, setChanges] = useState<Record<string, SettingValue>>({});
  const stale = save.error instanceof ApiError && save.error.code === "STALE_REVISION";
  const shown = (f: FieldRow): SettingValue => (f.path in changes ? changes[f.path] ?? null : valueAt(doc.settings, f.path) ?? f.default);
  return (
    <Card title={doc.exists ? `Saved ${doc.updatedAt ?? ""}` : "Not saved yet — defaults apply"} subtitle={doc.unreadable ? `The saved document is unreadable (${doc.unreadable}); saving copies it aside.` : undefined}>
      <div className={styles.form}>
        {fields.map((f) => <SettingField key={f.path} field={f} value={shown(f)} effective={effective.fields[f.path]?.value} by={effective.fields[f.path]?.by ?? "default"} onChange={(v) => setChanges({ ...changes, [f.path]: v })} />)}
      </div>
      {Object.entries(fixed).filter(([k]) => fields.some((f) => f.path.split(".")[0] === k.split(".")[0])).map(([k, v]) => <Caption1 key={k} className={styles.muted}>{`${k} is fixed at ${String(v)} in this release.`}</Caption1>)}
      <div className={styles.actions}>
        <Button appearance="primary" disabled={!mutationToken() || save.isPending || Object.keys(changes).length === 0} onClick={() => save.mutate(treeOf(changes))}>{save.isPending ? "Saving…" : "Save"}</Button>
        {!mutationToken() && <Caption1 className={styles.muted}>Read-only: open Control from the link it printed to change settings.</Caption1>}
        {save.isSuccess && <Caption1>Saved.</Caption1>}
      </div>
      {stale && <MessageBar intent="warning"><MessageBarBody>Somebody changed these settings since you opened them. Refresh, then make your change again.</MessageBarBody></MessageBar>}
      {save.isError && !stale && <ErrorState error={save.error} title="The settings were not saved" />}
    </Card>
  );
}

function SettingField({ field, value, effective, by, onChange }: { field: FieldRow; value: SettingValue; effective: SettingValue | undefined; by: string; onChange: (v: SettingValue) => void }) {
  const hint = `${field.say}. Effective: ${String(effective ?? field.default)} (${byLabel(by)}).`;
  if (field.type === "boolean") return <Field hint={hint}><Switch checked={value === true} label={field.path} onChange={(_, d) => onChange(d.checked)} /></Field>;
  if (field.type === "enum") return <Field label={field.path} hint={hint}><Select value={String(value ?? "")} onChange={(_, d) => onChange(d.value)}>{(field.values ?? []).map((v) => <option key={v} value={v}>{v}</option>)}</Select></Field>;
  return <Field label={field.path} hint={hint}><Input type="number" min={field.min ?? undefined} max={field.max ?? undefined} value={value === null ? "" : String(value)} onChange={(_, d) => onChange(d.value === "" ? null : Number(d.value))} /></Field>;
}

// ---- governance -----------------------------------------------------------------------------------

function GovernanceTab({ view }: { view: AutomationOverview }) {
  return (
    <Card title="What a coordinated workflow may do on its own" subtitle="Computed per action, never wider than a resource's own policy. Under the defaults every class is its own default; only a restriction a person kept narrows one. Nothing here is a switch.">
      <Table aria-label="Policy matrix">
        <TableHeader><TableRow><TableHeaderCell>Action</TableHeaderCell><TableHeaderCell>Now</TableHeaderCell><TableHeaderCell>Narrowed by</TableHeaderCell></TableRow></TableHeader>
        <TableBody>{view.effective.matrix.map((m) => <MatrixLine key={m.id} row={m} />)}</TableBody>
      </Table>
    </Card>
  );
}

const MatrixLine = ({ row }: { row: MatrixRow }) => (
  <TableRow>
    <TableCell><Text weight="semibold">{row.id}</Text><br /><Caption1>{row.say}</Caption1></TableCell>
    <TableCell><Badge appearance="tint" color={VERDICT_COLOR[row.verdict]}>{VERDICT_LABEL[row.verdict]}</Badge></TableCell>
    <TableCell>{row.narrowedBy ?? "—"}</TableCell>
  </TableRow>
);

// ---- live and hosts -----------------------------------------------------------------------------------

function LiveTab({ view }: { view: AutomationOverview }) {
  const styles = useStyles();
  const save = useSaveLive(view.live.revision);
  return (
    <div className={styles.stack}>
      <SettingsTab tab="live" view={view} />
      <Card title="How Live looks" subtitle="The status line and the terminal console read the same journals; these are their presentation settings.">
        <SettingsForm key={view.live.revision ?? "new"} fields={view.live.fields} doc={{ settings: view.live.settings, set: {}, revision: view.live.revision, exists: view.live.exists, unreadable: null, updatedAt: null }} effective={{ values: view.live.settings, fields: {}, matrix: [] }} fixed={{}} save={save} />
      </Card>
      <ReadinessCard hosts={view.readiness} />
    </div>
  );
}

const statusLineSay = (h: HostReadiness): string => ({ installed: "Orbit Live is in the status line", "not-installed": "not installed — run node <engine>/cli/host.mjs render --host=claude --kind=statusline, then apply --human (this page never writes a host's settings)", unavailable: "unavailable on this host — use node <engine>/cli/live.mjs watch <task>" })[h.statusLine];

function ReadinessCard({ hosts }: { hosts: HostReadiness[] }) {
  return (
    <Card title="What each host can do" subtitle="A host with no native agents runs each step's skill in its main session, one step at a time. A prompt trigger is advisory everywhere: no host starts a workflow from an ordinary prompt.">
      <Table aria-label="Host readiness">
        <TableHeader><TableRow><TableHeaderCell>Host</TableHeaderCell><TableHeaderCell>Agents</TableHeaderCell><TableHeaderCell>Prompt trigger</TableHeaderCell><TableHeaderCell>Status line</TableHeaderCell></TableRow></TableHeader>
        <TableBody>
          {hosts.map((h) => (
            <TableRow key={h.id}>
              <TableCell>{h.name}</TableCell>
              <TableCell>{h.agents ? "native" : "main session"}</TableCell>
              <TableCell>{h.promptRouter ? "advisory" : "Unavailable on this host"}</TableCell>
              <TableCell>{statusLineSay(h)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

// ---- generated playbooks --------------------------------------------------------------------------

function GeneratedSkillsTab() {
  const styles = useStyles();
  const projects = useProjects();
  const [project, setProject] = useState<string | null>(null);
  const key = project ?? projects.data?.projects[0]?.key ?? null;
  return (
    <div className={styles.stack}>
      <Field label="Project" hint="A generated playbook belongs to one project and is never a shipped skill.">
        <Select value={key ?? ""} onChange={(_, d) => setProject(d.value)}>{(projects.data?.projects ?? []).map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</Select>
      </Field>
      {key === null ? <Caption1>No project is known on this machine yet.</Caption1> : <SkillsOf project={key} />}
    </div>
  );
}

function SkillsOf({ project }: { project: string }) {
  const list = useGeneratedSkills(project);
  const move = useMoveSkill(project);
  const [open, setOpen] = useState<string | null>(null);
  if (list.isPending) return <LoadingState label="Reading the generated playbooks…" />;
  if (list.isError) return <ErrorState error={list.error} title="Could not read the generated playbooks" />;
  return (
    <Card title={`${list.data.skills.length} generated playbook(s)`} subtitle={list.data.drafts.length ? `Drafts a workflow is still writing: ${list.data.drafts.join(", ")}` : "Generated only on a workflow gap, within its configured bounds; held to the same contract as a shipped skill."}>
      <Table aria-label="Generated playbooks">
        <TableHeader><TableRow><TableHeaderCell>Playbook</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell>Provides / needs</TableHeaderCell><TableHeaderCell>From</TableHeaderCell><TableHeaderCell>Actions</TableHeaderCell></TableRow></TableHeader>
        <TableBody>{list.data.skills.map((s) => <SkillLine key={s.id} skill={s} onView={() => setOpen(s.id)} onMove={(m) => move.mutate({ id: s.id, move: m })} busy={move.isPending} />)}</TableBody>
      </Table>
      {move.isError && <ErrorState error={move.error} title="That was not done" />}
      {open !== null && <PlaybookView project={project} id={open} />}
    </Card>
  );
}

const MOVES: { move: SkillMove; label: string; when: (s: GeneratedSkill) => boolean }[] = [
  { move: "revalidate", label: "Test again", when: (s) => !s.archived },
  { move: "activate", label: "Activate", when: (s) => !s.archived && s.status !== "active" && !s.quarantined },
  { move: "disable", label: "Disable", when: (s) => !s.archived && s.status === "active" },
  { move: "retire", label: "Retire", when: (s) => !s.archived && s.status !== "retired" },
  { move: "archive", label: "Archive", when: (s) => !s.archived },
];

function SkillLine({ skill, onView, onMove, busy }: { skill: GeneratedSkill; onView: () => void; onMove: (m: SkillMove) => void; busy: boolean }) {
  const styles = useStyles();
  return (
    <TableRow>
      <TableCell><Text weight="semibold">{skill.id}</Text><br /><Caption1 className={styles.muted}>{skill.pin}</Caption1><br /><Caption1>{skill.summary}</Caption1></TableCell>
      <TableCell>
        <Badge appearance="tint" color={STATUS_COLOR[skill.status] ?? "subtle"}>{skill.archived ? "archived" : skill.status}</Badge>
        {skill.quarantined && <Badge appearance="filled" color="danger">files changed</Badge>}
        {skill.offered && <Caption1>offered to the resolver</Caption1>}
      </TableCell>
      <TableCell><Caption1>{`provides ${skill.provides.join(", ")}`}</Caption1><br /><Caption1>{`needs ${skill.needs.join(", ") || "nothing"}`}</Caption1></TableCell>
      <TableCell><Caption1>{skill.sourceTask ?? "—"}</Caption1></TableCell>
      <TableCell>
        <div className={styles.actions}>
          <Button size="small" onClick={onView}>View</Button>
          {MOVES.filter((m) => m.when(skill)).map((m) => <Button key={m.move} size="small" disabled={!mutationToken() || busy} onClick={() => onMove(m.move)}>{m.label}</Button>)}
        </div>
      </TableCell>
    </TableRow>
  );
}

function PlaybookView({ project, id }: { project: string; id: string }) {
  const styles = useStyles();
  const detail = useGeneratedSkill(project, id);
  if (detail.isPending) return <LoadingState label="Reading the playbook…" />;
  if (detail.isError) return <ErrorState error={detail.error} title="Could not read the playbook" />;
  const declared = detail.data.skill.runs === "declared";
  return (
    <Card title={`${detail.data.playbook.pin} (${detail.data.playbook.status})`} subtitle={declared ? "Its text, and the workflow the engine runs step by step — each step through its provider's own owner gate, reading only." : "Its text as a host is handed it — printable, never run by Orbit."}>
      {declared && <WorkflowView workflow={detail.data.workflow ?? null} />}
      {declared && <RunsView detail={detail.data} />}
      {detail.data.playbook.files.map((f) => <div key={f.name}><Caption1>{f.name}</Caption1><pre className={styles.code}>{f.text}</pre></div>)}
    </Card>
  );
}

// A declared playbook's workflow: each step, the capability it asks (the resolver picks who serves it, at the moment
// it runs), what it waits for and what it must prove.
function WorkflowView({ workflow }: { workflow: GeneratedSkillDetail["workflow"] }) {
  if (!workflow) return <Caption1>No workflow is declared.</Caption1>;
  if ("unreadable" in workflow) return <Caption1>{`Its workflow cannot be read: ${workflow.because}`}</Caption1>;
  return <WorkflowTable workflow={workflow} />;
}

function WorkflowTable({ workflow }: { workflow: DeclaredWorkflow }) {
  return (
    <Table size="small" aria-label="Workflow steps">
      <TableHeader><TableRow><TableHeaderCell>Step</TableHeaderCell><TableHeaderCell>Asks</TableHeaderCell><TableHeaderCell>Waits for</TableHeaderCell><TableHeaderCell>Must prove</TableHeaderCell></TableRow></TableHeader>
      <TableBody>
        {workflow.steps.map((s) => (
          <TableRow key={s.id}>
            <TableCell><Text weight="semibold">{s.id}</Text>{!s.required && <Caption1> optional</Caption1>}</TableCell>
            <TableCell><Caption1>{s.capability}{s.tool ? ` · ${s.tool}` : ""}</Caption1></TableCell>
            <TableCell><Caption1>{s.after.join(", ") || "—"}</Caption1></TableCell>
            <TableCell><Caption1>{s.evidence === "owner-record" ? "an owner's record, read back" : "a report: its call answered within its contract"}{s.approval === "owner" ? " · a person allows it" : ""}</Caption1></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// What its runs did, newest first, and the review they answer -- read from the project's journals on every look.
function RunsView({ detail }: { detail: GeneratedSkillDetail }) {
  const runs = detail.runs ?? [];
  const review = detail.review;
  return (
    <div>
      {review && <Caption1>{`Review: ${review.reliability.word} — ${review.reliability.because}`}</Caption1>}
      {review && (
        <ul aria-label="Review">
          {review.questions.map((q) => <li key={q.id}><Caption1>{`${q.answer} · ${q.ask} — ${q.because}`}</Caption1></li>)}
          <li><Caption1>{`${review.proposal.successor ? "A successor version is proposed" : "No successor is proposed"} — ${review.proposal.because}`}</Caption1></li>
        </ul>
      )}
      <Table size="small" aria-label="Runs">
        <TableHeader><TableRow><TableHeaderCell>When</TableHeaderCell><TableHeaderCell>Came to</TableHeaderCell><TableHeaderCell>Version</TableHeaderCell><TableHeaderCell>Steps</TableHeaderCell></TableRow></TableHeader>
        <TableBody>
          {runs.map((r) => (
            <TableRow key={`${r.task}/${r.run}`}>
              <TableCell><Caption1>{r.at ?? "—"}</Caption1></TableCell>
              <TableCell><Badge appearance="tint" color={r.word === "VERIFIED" ? "success" : r.word === "FAILED" ? "danger" : "warning"}>{r.word}</Badge></TableCell>
              <TableCell><Caption1>{r.pin}</Caption1></TableCell>
              <TableCell><Caption1>{r.steps.map((s) => `${s.id} ${s.word}`).join(", ")}</Caption1></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {runs.length === 0 && <Caption1>It has not run in this project's workflows yet.</Caption1>}
    </div>
  );
}
