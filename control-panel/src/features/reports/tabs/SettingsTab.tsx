import { useState } from "react";
import { Button, Caption1, Field, Input, Radio, RadioGroup, Switch, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import { mutationToken } from "../../../shared/api/client";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { LoadingState } from "../../../shared/components/LoadingState";
import type { Provider, ProviderField } from "../../connections/connections.types";
import { reportsApi, useReportChange, useReportSettings } from "../reports.api";
import type { ReportSettings, ScopeValue, SettingsView } from "../reports.types";
import { isAvailable } from "../reportWords";
import { NotHere } from "./OverviewTab";

export const useFormStyles = makeStyles({
  form: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(16rem, 1fr))", gap: tokens.spacingHorizontalL, alignItems: "start" },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalL },
  muted: { color: tokens.colorNeutralForeground3 },
});

export function SettingsTab() {
  const view = useReportSettings();
  if (view.isPending) return <LoadingState label="Loading the report settings…" />;
  if (view.isError) return <ErrorState error={view.error} title="Could not read the report settings" onRetry={() => view.refetch()} />;
  if (!isAvailable(view.data)) return <NotHere why={view.data.why} />;
  return <SettingsForm key={view.data.revision ?? "new"} view={view.data} />;
}

// Saving sends the revision this form was opened at: a change made meanwhile
// (by a session, or another tab) is a 409 to reload, never overwritten.
export function useSaveSettings(view: SettingsView) {
  return useReportChange((next: ReportSettings) => reportsApi.saveSettings(next, view.revision));
}

const listOf = (text: string) => text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
const textOf = (value: ScopeValue | undefined) => (Array.isArray(value) ? value.join("\n") : typeof value === "string" ? value : "");

function SettingsForm({ view }: { view: SettingsView }) {
  const styles = useFormStyles();
  const [draft, setDraft] = useState<ReportSettings>(view.settings);
  const save = useSaveSettings(view);
  const provider = view.providers.find((p) => p.id === draft.provider);
  const set = <K extends keyof ReportSettings>(key: K, value: ReportSettings[K]) => setDraft({ ...draft, [key]: value });
  return (
    <div className={styles.stack}>
      <Card title="Source" subtitle="One source per project: GitHub or Azure DevOps, with as many repositories of it as the report reads.">
        <RadioGroup layout="horizontal" value={draft.provider ?? ""} onChange={(_, d) => setDraft({ ...draft, provider: d.value, scope: d.value === draft.provider ? draft.scope : {}, connection: d.value === draft.provider ? draft.connection : null })}>
          {view.providers.map((p) => (
            <Radio key={p.id} value={p.id} label={p.label} />
          ))}
        </RadioGroup>
        {provider && <ScopeFields provider={provider} scope={draft.scope} onChange={(scope) => set("scope", scope)} />}
      </Card>
      <Card title="Window and output" subtitle="By default a report covers the last two COMPLETE calendar months, and reads the backlog as it was at the end of the last one.">
        <div className={styles.form}>
          <Field label="Complete months per report" hint="1 to 60">
            <Input type="number" min={1} max={60} value={String(draft.period.months)} onChange={(_, d) => set("period", { months: Number(d.value) || 1 })} />
          </Field>
          <Field label="Time zone" hint={`An IANA name. This machine's is ${view.machineTimezone}.`}>
            <Input value={draft.timezone ?? ""} placeholder={view.machineTimezone} onChange={(_, d) => set("timezone", d.value.trim() || null)} />
          </Field>
          <Field label="Where reports go" hint="An absolute folder; empty uses the checkout's ui-tests/reports/project-reports.">
            <Input value={draft.output.dir ?? ""} onChange={(_, d) => set("output", { ...draft.output, dir: d.value.trim() || null })} />
          </Field>
          <Field label="Runs to keep" hint="Older runs are pruned; the newest and its baseline are always kept.">
            <Input type="number" min={1} max={500} value={String(draft.retention)} onChange={(_, d) => set("retention", Number(d.value) || 20)} />
          </Field>
          <Field label="Planning documents" hint="A folder of the checkout with BMAD-style stories and epics, read as it was at the cut-off. Optional.">
            <Input value={draft.docs?.path ?? ""} onChange={(_, d) => set("docs", d.value.trim() ? { path: d.value.trim() } : null)} />
          </Field>
        </div>
      </Card>
      <SaveBar save={save} onSave={() => save.mutate(draft)} />
    </div>
  );
}

function ScopeFields({ provider, scope, onChange }: { provider: Provider; scope: Record<string, ScopeValue>; onChange: (next: Record<string, ScopeValue>) => void }) {
  const styles = useFormStyles();
  return (
    <div className={styles.form}>
      {provider.scope.fields.map((f) => (
        <ScopeField key={f.name} field={f} value={scope[f.name]} onChange={(value) => onChange({ ...scope, [f.name]: value })} />
      ))}
    </div>
  );
}

function ScopeField({ field, value, onChange }: { field: ProviderField; value: ScopeValue | undefined; onChange: (v: ScopeValue) => void }) {
  if (field.type === "boolean") return <Switch label={field.label} checked={typeof value === "boolean" ? value : field.default !== false} onChange={(_, d) => onChange(d.checked)} />;
  if (field.type === "list")
    return (
      <Field label={field.label} hint={field.doc} required={field.required}>
        <Textarea value={textOf(value)} onChange={(_, d) => onChange(listOf(d.value))} resize="vertical" />
      </Field>
    );
  return (
    <Field label={field.label} hint={field.doc} required={field.required}>
      <Input value={textOf(value)} onChange={(_, d) => onChange(d.value)} />
    </Field>
  );
}

export function SaveBar({ save, onSave }: { save: { isPending: boolean; isError: boolean; isSuccess: boolean; error: unknown }; onSave: () => void }) {
  const styles = useFormStyles();
  return (
    <div className={styles.stack}>
      <div className={styles.actions}>
        <Button appearance="primary" disabled={!mutationToken() || save.isPending} onClick={onSave}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        {save.isSuccess && <Caption1>Saved.</Caption1>}
      </div>
      {save.isError && <ErrorState error={save.error} title="The settings were not saved" />}
    </div>
  );
}
