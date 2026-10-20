import { useState } from "react";
import { Badge, Button, Caption1, Checkbox, Field, Input, Link, MessageBar, MessageBarBody, Select, Switch, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise20Regular } from "@fluentui/react-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router";
import { mutationToken } from "../../shared/api/client";
import { Card } from "../../shared/components/Card";
import { ErrorState } from "../../shared/components/ErrorState";
import { LoadingState } from "../../shared/components/LoadingState";
import { PageHeader } from "../../shared/components/PageHeader";
import { aqaApi, aqaKeys, useAqaOverview, useSaveAqaSettings } from "./aqa.api";
import type { AqaOverview, AqaSettings, Environment, EnvironmentKind, InvestigationSummary, JsonValue, Limits, ModeId } from "./aqa.types";
import { APPROVABLE, ENVIRONMENT_KINDS, OUTCOME_LABEL, OUTCOME_ORDER, isAvailable, listOf } from "./aqaWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(14rem, 1fr))", gap: tokens.spacingHorizontalL, alignItems: "start" },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  code: { fontFamily: tokens.fontFamilyMonospace, minHeight: "8rem" },
});

// `/autonomous-qa`: what a PERSON approves autonomous QA to do in the project
// Control was started from -- whether it may act at all, where, in which modes,
// as whom, how far, and the contracts a finding is held to -- plus the
// investigations it kept. Nothing here starts an investigation: that is the
// skill's or the CLI's, inside the gates this page approves.
export function AutonomousQaPage() {
  const client = useQueryClient();
  const view = useAqaOverview();
  return (
    <>
      <PageHeader
        title="Autonomous QA"
        description="What autonomous QA may do in this project — environments, execution modes, identities and limits — and every investigation it kept, with its evidence-backed report."
        actions={<Button icon={<ArrowClockwise20Regular />} onClick={() => client.invalidateQueries({ queryKey: aqaKeys.all })}>Refresh</Button>}
      />
      {view.isPending && <LoadingState label="Reading the autonomous QA settings…" />}
      {view.isError && <ErrorState error={view.error} title="Could not read autonomous QA" onRetry={() => view.refetch()} />}
      {view.data && !isAvailable(view.data) && <MessageBar intent="info"><MessageBarBody>{view.data.why}</MessageBarBody></MessageBar>}
      {isAvailable(view.data) && <Configured key={view.data.revision ?? "new"} view={view.data} />}
    </>
  );
}

function Configured({ view }: { view: AqaOverview }) {
  const styles = useStyles();
  const [draft, setDraft] = useState<AqaSettings>(view.settings);
  const [contracts, setContracts] = useState<ContractText>(contractTextOf(view.settings));
  const save = useSaveAqaSettings(view.revision);
  const parsed = contractsOf(contracts);
  return (
    <div className={styles.stack}>
      <StatusCard view={view} draft={draft} onChange={setDraft} />
      <EnvironmentsCard environments={draft.environments} onChange={(environments) => setDraft({ ...draft, environments })} />
      <AccessCard draft={draft} onChange={setDraft} />
      <ContractsCard text={contracts} onChange={setContracts} problem={parsed.problem} />
      <div className={styles.actions}>
        <Button appearance="primary" disabled={!mutationToken() || save.isPending || parsed.problem !== null} onClick={() => parsed.value && save.mutate({ ...draft, ...parsed.value })}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {save.isSuccess && <Caption1>Saved.</Caption1>}
      </div>
      {save.isError && <ErrorState error={save.error} title="The settings were not saved" />}
      <InvestigationsCard investigations={view.investigations} />
    </div>
  );
}

function StatusCard({ view, draft, onChange }: { view: AqaOverview; draft: AqaSettings; onChange: (next: AqaSettings) => void }) {
  const styles = useStyles();
  const open = view.blockers.flatMap((b) => b.blockers.map((x) => ({ ...x, environment: b.environment })));
  return (
    <Card title="Status" subtitle={`Project ${view.project.name}. Observe is read-only; every other mode needs a person's approval on the environment it runs in.`}>
      <div className={styles.stack}>
        <Switch checked={draft.enabled} label={draft.enabled ? "Autonomous QA may act in an approved browser" : "Autonomous QA is off: it plans, and acts nowhere"} onChange={(_, d) => onChange({ ...draft, enabled: d.checked })} />
        {!view.switchedOn && <MessageBar intent="warning"><MessageBarBody>The orbit-qa-agent skill is switched off on this machine (plugin option skill_autonomous_qa).</MessageBarBody></MessageBar>}
        {open.map((b) => (
          <MessageBar key={`${b.environment ?? "none"}-${b.id}`} intent={b.stop === "blocked" ? "error" : "warning"}>
            <MessageBarBody>{b.environment ? `${b.environment}: ` : ""}{b.say}</MessageBarBody>
          </MessageBar>
        ))}
        {open.length === 0 && <Caption1 className={styles.muted}>Nothing is missing before a first observe-mode action.</Caption1>}
        <Caption1 className={styles.muted}>
          What the skill needs, and who provides each: <Link as="span"><RouterLink to="/skills/orbit-qa">orbit-qa-agent, resolved</RouterLink></Link>
        </Caption1>
      </div>
    </Card>
  );
}

const EMPTY_ENV: Environment = { id: "", origin: "", kind: "test", modes: [] };
const isKind = (value: string): value is EnvironmentKind => ENVIRONMENT_KINDS.some((k) => k === value);

function EnvironmentsCard({ environments, onChange }: { environments: Environment[]; onChange: (next: Environment[]) => void }) {
  const styles = useStyles();
  const [adding, setAdding] = useState<Environment>(EMPTY_ENV);
  const toggle = (env: Environment, mode: ModeId, on: boolean) => onChange(environments.map((e) => (e.id === env.id ? { ...e, modes: on ? [...e.modes.filter((m) => m !== mode), mode] : e.modes.filter((m) => m !== mode) } : e)));
  return (
    <Card title="Environments" subtitle="Where autonomous QA may act, and the modes a person approved on each. No approval buys a writing mode on production.">
      <Table aria-label="Approved environments" size="small">
        <TableHeader>
          <TableRow>
            <TableHeaderCell>id</TableHeaderCell>
            <TableHeaderCell>origin</TableHeaderCell>
            <TableHeaderCell>kind</TableHeaderCell>
            <TableHeaderCell>approved modes</TableHeaderCell>
            <TableHeaderCell />
          </TableRow>
        </TableHeader>
        <TableBody>
          {environments.map((env) => (
            <TableRow key={env.id}>
              <TableCell>{env.id}</TableCell>
              <TableCell>{env.origin}</TableCell>
              <TableCell>{env.kind}</TableCell>
              <TableCell>
                <Caption1>observe</Caption1>
                {APPROVABLE.map((mode) => (
                  <Checkbox key={mode} label={mode} checked={env.modes.includes(mode)} disabled={env.kind === "production" && mode !== "regression"} onChange={(_, d) => toggle(env, mode, d.checked === true)} />
                ))}
              </TableCell>
              <TableCell>
                <Button size="small" onClick={() => onChange(environments.filter((e) => e.id !== env.id))}>Remove {env.id}</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className={styles.form}>
        <Field label="Environment id"><Input value={adding.id} onChange={(_, d) => setAdding({ ...adding, id: d.value.trim() })} /></Field>
        <Field label="Origin" hint="e.g. https://app.test.example"><Input value={adding.origin} onChange={(_, d) => setAdding({ ...adding, origin: d.value.trim() })} /></Field>
        <Field label="Kind">
          <Select value={adding.kind} onChange={(_, d) => isKind(d.value) && setAdding({ ...adding, kind: d.value })}>
            {ENVIRONMENT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </Select>
        </Field>
      </div>
      <div className={styles.actions}>
        <Button disabled={!adding.id || !adding.origin || environments.some((e) => e.id === adding.id)} onClick={() => { onChange([...environments, adding]); setAdding(EMPTY_ENV); }}>Add environment</Button>
      </div>
    </Card>
  );
}

const LIMIT_FIELDS: readonly { key: keyof Limits; label: string }[] = [
  { key: "actions", label: "Actions per investigation" },
  { key: "requestsPerAction", label: "Requests read per action" },
  { key: "minutes", label: "Minutes per investigation" },
  { key: "pollSeconds", label: "Seconds to wait for a quiet network" },
  { key: "decisions", label: "Decisions per investigation (the loop's steps)" },
  { key: "noProgress", label: "Steps without anything new before it stops" },
];

function AccessCard({ draft, onChange }: { draft: AqaSettings; onChange: (next: AqaSettings) => void }) {
  const styles = useStyles();
  return (
    <Card title="Identities, limits and the network" subtitle="Identities are signed-in browser profiles, mapped by name as for run-case. A credential is never a setting.">
      <div className={styles.form}>
        <Field label="Identities it may drive" hint="One per line, e.g. admin, tenantA, tenantB">
          <Textarea value={draft.identities.join("\n")} onChange={(_, d) => onChange({ ...draft, identities: listOf(d.value) })} />
        </Field>
        {LIMIT_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <Input type="number" min={1} value={String(draft.limits[f.key])} onChange={(_, d) => onChange({ ...draft, limits: { ...draft.limits, [f.key]: Number(d.value) || 1 } })} />
          </Field>
        ))}
        <Switch checked={draft.network.details} label="Read each request's detail (headers are kept as names only)" onChange={(_, d) => onChange({ ...draft, network: { ...draft.network, details: d.checked } })} />
        <Switch checked={draft.network.fingerprints} label="Fingerprint write bodies to compare them (a body is never kept)" onChange={(_, d) => onChange({ ...draft, network: { ...draft.network, fingerprints: d.checked } })} />
        <Switch checked={draft.reports.internal} label="Allow an UNREDACTED report from the CLI" onChange={(_, d) => onChange({ ...draft, reports: { internal: d.checked } })} />
        <Switch checked={draft.memory.project} label="Keep what an investigation verified in the project's knowledge (results against an accepted oracle only)" onChange={(_, d) => onChange({ ...draft, memory: { project: d.checked } })} />
      </div>
    </Card>
  );
}

interface ContractText {
  duplicates: string;
  consistency: string;
  tenancy: string;
}

const contractTextOf = (s: AqaSettings): ContractText => ({ duplicates: JSON.stringify(s.duplicates, null, 2), consistency: JSON.stringify(s.consistency, null, 2), tenancy: JSON.stringify(s.tenancy, null, 2) });

function isJson(v: unknown): v is JsonValue {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return true;
  if (Array.isArray(v)) return v.every(isJson);
  return typeof v === "object" && Object.values(v).every(isJson);
}

const isRecord = (v: JsonValue): v is { [key: string]: JsonValue } => typeof v === "object" && v !== null && !Array.isArray(v);
const isSeconds = (v: { [key: string]: JsonValue }): v is { [key: string]: number } => Object.values(v).every((x) => typeof x === "number");

function parsed(text: string): JsonValue | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isJson(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

// The server validates every contract; this only refuses text that is not JSON.
function contractsOf(t: ContractText): { value: Pick<AqaSettings, "duplicates" | "consistency" | "tenancy"> | null; problem: string | null } {
  const duplicates = parsed(t.duplicates);
  const consistency = parsed(t.consistency);
  const tenancy = parsed(t.tenancy);
  if (duplicates === undefined || !isRecord(duplicates)) return { value: null, problem: "The duplicate policy is not a JSON object." };
  if (consistency === undefined || !isRecord(consistency) || !isSeconds(consistency)) return { value: null, problem: "Consistency windows are a JSON object of timing → seconds." };
  if (tenancy === undefined) return { value: null, problem: "The tenancy contract is not JSON (null for none)." };
  return { value: { duplicates, consistency, tenancy }, problem: null };
}

function ContractsCard({ text, onChange, problem }: { text: ContractText; onChange: (next: ContractText) => void; problem: string | null }) {
  const styles = useStyles();
  return (
    <Card title="Contracts a finding is held to" subtitle="What a person accepted: the duplicate-request policy, how long deferred data may take, and the tenancy contract. Only these can CONFIRM a defect — an observation never does.">
      <div className={styles.form}>
        <Field label="Duplicate policy" hint="polling · retries · idempotent · intentional · contracts, each [{ match, method? }]">
          <Textarea className={styles.code} value={text.duplicates} onChange={(_, d) => onChange({ ...text, duplicates: d.value })} />
        </Field>
        <Field label="Consistency windows" hint='A graph/meta.json timing → seconds, e.g. { "deferred": 30 }'>
          <Textarea className={styles.code} value={text.consistency} onChange={(_, d) => onChange({ ...text, consistency: d.value })} />
        </Field>
        <Field label="Tenancy contract" hint="tenants · identities · resources (synthetic, with a marker) · matrix · writeProbes — or null">
          <Textarea className={styles.code} value={text.tenancy} onChange={(_, d) => onChange({ ...text, tenancy: d.value })} />
        </Field>
      </div>
      {problem && <MessageBar intent="error"><MessageBarBody>{problem}</MessageBarBody></MessageBar>}
    </Card>
  );
}

function InvestigationsCard({ investigations }: { investigations: InvestigationSummary[] }) {
  const [problem, setProblem] = useState<string | null>(null);
  const open = (id: string) => aqaApi.report(id).then((page) => showPage(page.html)).catch((e: unknown) => setProblem(e instanceof Error ? e.message : String(e)));
  return (
    <Card title="Investigations" subtitle="Newest first. A report is always redacted here; the outcomes are the engine's, never a PASS or a FAIL.">
      {investigations.length === 0 && <Caption1>No investigation has run in this project yet.</Caption1>}
      {investigations.length > 0 && (
        <Table aria-label="Investigations" size="small">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>investigation</TableHeaderCell>
              <TableHeaderCell>objective</TableHeaderCell>
              <TableHeaderCell>mode</TableHeaderCell>
              <TableHeaderCell>where it stands</TableHeaderCell>
              <TableHeaderCell>actions</TableHeaderCell>
              <TableHeaderCell>findings</TableHeaderCell>
              <TableHeaderCell />
            </TableRow>
          </TableHeader>
          <TableBody>
            {investigations.map((i) => (
              <TableRow key={i.id}>
                <TableCell>{i.id}{i.cancelled ? " (cancelled)" : ""}</TableCell>
                <TableCell>{i.objective}</TableCell>
                <TableCell>{i.mode ?? "?"} · {i.environment ?? "?"} · {i.inputMode}</TableCell>
                <TableCell>{standing(i)}</TableCell>
                <TableCell>{i.actions}</TableCell>
                <TableCell>
                  {OUTCOME_ORDER.filter((o) => (i.findings[o] ?? 0) > 0).map((o) => (
                    <Badge key={o} appearance="tint" color={o === "CONFIRMED_DEFECT" ? "danger" : o === "SUSPECTED_DEFECT" ? "warning" : "informative"}>{OUTCOME_LABEL[o]} {i.findings[o]}</Badge>
                  ))}
                </TableCell>
                <TableCell><Button size="small" onClick={() => open(i.id)}>Open report {i.id}</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {problem && <ErrorState error={new Error(problem)} title="Could not open the report" />}
    </Card>
  );
}

// Where an investigation stands, as a person scanning the list needs it: what
// it is doing, why it stopped, and whether it is waiting for somebody.
function standing(i: InvestigationSummary): string {
  const waiting = i.openQuestions > 0 ? ` · ${i.openQuestions} question(s) waiting for a person` : "";
  return `${i.lifecycle}${i.stop ? ` — ${i.stop}` : ""}${waiting}`;
}

// The page is self-contained HTML, opened as its own document.
function showPage(html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  window.open(url, "_blank", "noopener");
}
