import { useState } from "react";
import { Caption1, Field, Input, Switch, Textarea } from "@fluentui/react-components";
import { Card } from "../../../shared/components/Card";
import { ErrorState } from "../../../shared/components/ErrorState";
import { LoadingState } from "../../../shared/components/LoadingState";
import { useReportSettings } from "../reports.api";
import type { ReportSettings, SettingsView } from "../reports.types";
import { isAvailable } from "../reportWords";
import { NotHere } from "./OverviewTab";
import { SaveBar, useFormStyles, useSaveSettings } from "./SettingsTab";

export function SectionsTab() {
  const view = useReportSettings();
  if (view.isPending) return <LoadingState label="Loading…" />;
  if (view.isError) return <ErrorState error={view.error} title="Could not read the report settings" onRetry={() => view.refetch()} />;
  if (!isAvailable(view.data)) return <NotHere why={view.data.why} />;
  return <SectionsForm key={view.data.revision ?? "new"} view={view.data} />;
}

const listOf = (text: string) => text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
const numberOr = (text: string, fallback: number | undefined) => (text.trim() === "" || Number.isNaN(Number(text)) ? fallback : Number(text));

// A switched-off section is not hidden in the page: its data is not in the
// page at all. Data coverage & method is always there -- it is how a reader
// knows what the numbers stand on.
function SectionsForm({ view }: { view: SettingsView }) {
  const styles = useFormStyles();
  const [draft, setDraft] = useState<ReportSettings>(view.settings);
  const save = useSaveSettings(view);
  const mapping = (patch: Partial<ReportSettings["mapping"]>) => setDraft({ ...draft, mapping: { ...draft.mapping, ...patch } });
  const forecast = (patch: NonNullable<ReportSettings["assumptions"]["forecast"]>) => setDraft({ ...draft, assumptions: { ...draft.assumptions, forecast: { ...(draft.assumptions.forecast ?? {}), ...patch } } });
  return (
    <div className={styles.stack}>
      <Card title="Sections" subtitle="Contributors (per-person numbers) is off unless you turn it on: counts of pull requests and lines are activity, never productivity.">
        <div className={styles.form}>
          {view.sections.map((s) => (
            <Switch key={s.id} label={s.title} disabled={s.locked} checked={s.locked ? true : draft.sections[s.id] ?? s.enabled} onChange={(_, d) => setDraft({ ...draft, sections: { ...draft.sections, [s.id]: d.checked } })} />
          ))}
        </div>
      </Card>
      <Card title="Mapping" subtitle="What this project's names mean. Empty uses the pack's defaults.">
        <div className={styles.form}>
          <Field label="Bot accounts" hint="Logins, one per line; they are kept apart from people.">
            <Textarea value={(draft.mapping.bots ?? []).join("\n")} onChange={(_, d) => mapping({ bots: listOf(d.value) })} />
          </Field>
          <Field label="AI-assisted markers" hint="Text in a commit that marks AI help, one per line.">
            <Textarea value={(draft.mapping.aiMarkers ?? []).join("\n")} onChange={(_, d) => mapping({ aiMarkers: listOf(d.value) })} />
          </Field>
          <Field label="AI-heavy threshold" hint="Share of a pull request's commits, 0 to 1.">
            <Input type="number" step="0.05" min={0} max={1} value={draft.mapping.aiHeavyThreshold === undefined ? "" : String(draft.mapping.aiHeavyThreshold)} onChange={(_, d) => mapping({ aiHeavyThreshold: numberOr(d.value, undefined) })} />
          </Field>
          <Field label="Sprint cadence start" hint="Used only when the source has no iterations: the first day of a sprint.">
            <Input type="date" value={draft.mapping.iterations?.start ?? ""} onChange={(_, d) => mapping({ iterations: d.value ? { start: d.value, days: draft.mapping.iterations?.days ?? 14 } : undefined })} />
          </Field>
          <Field label="Sprint length (days)">
            <Input type="number" min={1} value={draft.mapping.iterations ? String(draft.mapping.iterations.days) : ""} disabled={!draft.mapping.iterations} onChange={(_, d) => draft.mapping.iterations && mapping({ iterations: { start: draft.mapping.iterations.start, days: numberOr(d.value, 14) ?? 14 } })} />
          </Field>
        </div>
      </Card>
      <Card title="Forecast assumptions" subtitle="The forecast samples only complete periods of the window; it never reaches further back to look better.">
        <div className={styles.form}>
          <Field label="Periods needed" hint="Fewer complete periods than this: no forecast, and why.">
            <Input type="number" min={2} value={String(draft.assumptions.forecast?.minSamples ?? "")} placeholder="4" onChange={(_, d) => forecast({ minSamples: numberOr(d.value, undefined) })} />
          </Field>
          <Field label="Horizon (periods)">
            <Input type="number" min={1} value={String(draft.assumptions.forecast?.horizon ?? "")} placeholder="52" onChange={(_, d) => forecast({ horizon: numberOr(d.value, undefined) })} />
          </Field>
          <Field label="Simulations">
            <Input type="number" min={100} value={String(draft.assumptions.forecast?.runs ?? "")} placeholder="10000" onChange={(_, d) => forecast({ runs: numberOr(d.value, undefined) })} />
          </Field>
        </div>
        <Caption1 className={styles.muted}>Every assumption is printed in the report beside the forecast it shaped.</Caption1>
      </Card>
      <SaveBar save={save} onSave={() => save.mutate(draft)} />
    </div>
  );
}
