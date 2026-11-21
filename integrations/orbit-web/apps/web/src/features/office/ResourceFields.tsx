// AN EMPLOYEE'S PERSONAL SANDBOX, as numbers: a preset to start from (Lightweight, Research, Developer, Build / Test) or
// custom values, each a number field beside a slider -- CPU, memory, desk storage, scratch storage, the dependency cache --
// and the process and time limits. What a value breaks is said beside it: the account's per-employee limits (the API
// refuses past them) and the bounds every profile keeps. Beside the fields, the account's budget as it stands now.
import { Input, MessageBar, MessageBarBody, Slider, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { RESOURCE_BOUNDS, ceilingProblems, checkResourceProfile, type PerEmployeeCeiling, type ResourcePreset, type ResourceProfile, type ResourceSummary, type RuntimeKind } from "@orbit-web/contracts";
import { useState } from "react";
import { cpuText, fromGiB, fromVcpu, sizeText, toGiB, toVcpu } from "../resources/format";
import { useOfficeStyles } from "./parts";

const useStyles = makeStyles({
  layout: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 300px)", gap: "16px", "@media (max-width: 899px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
  presets: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 150px), 1fr))", gap: "8px" },
  preset: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "2px",
    textAlign: "left",
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    minHeight: "44px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: "var(--orbit-card-bg)",
    color: tokens.colorNeutralForeground1,
    cursor: "pointer",
    ":focus-visible": { outline: `2px solid ${tokens.colorStrokeFocus2}`, outlineOffset: "2px" },
  },
  presetOn: { ...shorthands.borderColor(tokens.colorBrandStroke1), backgroundColor: tokens.colorSubtleBackgroundSelected },
  fields: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 },
  field: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 },
  pair: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 110px", gap: "10px", alignItems: "end", "@media (max-width: 479px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
  slider: { width: "100%", minWidth: 0 },
  aside: { display: "flex", flexDirection: "column", gap: "8px", paddingTop: "12px", paddingRight: "14px", paddingBottom: "12px", paddingLeft: "14px", borderRadius: "12px", backgroundColor: tokens.colorNeutralBackground2, alignSelf: "start", minWidth: 0 },
  num: { fontVariantNumeric: "tabular-nums" },
});

// A number a person types: what they typed is kept while they type it, and the field follows the value when something
// else (a preset, the slider) changes it.
function NumberInput({ label, value, onValue, min, max, step }: { label: string; value: number; onValue: (v: number) => void; min: number; max: number; step: number }) {
  const [draft, setDraft] = useState<{ text: string; value: number } | null>(null);
  const text = draft !== null && draft.value === value ? draft.text : String(value);
  return (
    <Input
      type="number"
      inputMode="decimal"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={text}
      onChange={(_, d) => {
        const v = Number(d.value);
        const ok = d.value.trim() !== "" && Number.isFinite(v);
        setDraft({ text: d.value, value: ok ? v : value });
        if (ok) onValue(v);
      }}
    />
  );
}

interface Spec {
  key: keyof Omit<ResourceProfile, "presetId">;
  label: string;
  hint: string;
  // The field's unit, and how its value maps to the profile's.
  unit: "vCPU" | "GiB" | "processes" | "minutes";
  slider: boolean;
}

const SPECS: Spec[] = [
  { key: "cpuMillis", label: "CPU", hint: "Held while it works; an idle employee holds none.", unit: "vCPU", slider: true },
  { key: "memoryMiB", label: "Memory", hint: "Held while it works; past it the work is stopped as out of memory.", unit: "GiB", slider: true },
  { key: "deskStorageMiB", label: "Desk storage", hint: "Its persistent desk and toolbox: committed at hire.", unit: "GiB", slider: true },
  { key: "scratchStorageMiB", label: "Scratch storage", hint: "One assignment's working space, held while it works.", unit: "GiB", slider: true },
  { key: "cacheStorageMiB", label: "Dependency cache", hint: "Packages it installs, kept between assignments (0 for none).", unit: "GiB", slider: true },
  { key: "pidsLimit", label: "Processes", hint: "How many processes an attempt may run at once.", unit: "processes", slider: false },
  { key: "timeoutMinutes", label: "Time limit", hint: "How long one attempt may run.", unit: "minutes", slider: false },
];

const toField = (spec: Spec, v: number): number => (spec.unit === "vCPU" ? toVcpu(v) : spec.unit === "GiB" ? toGiB(v) : v);
const fromField = (spec: Spec, v: number): number => (spec.unit === "vCPU" ? fromVcpu(v) : spec.unit === "GiB" ? fromGiB(v) : Math.round(v));

const ceilingKey = (k: Spec["key"]): keyof PerEmployeeCeiling | null => (k === "pidsLimit" || k === "timeoutMinutes" ? null : k);

function sliderMax(spec: Spec, ceiling: PerEmployeeCeiling | null, value: number): number {
  const c = ceilingKey(spec.key);
  const fallback = spec.unit === "vCPU" ? 16 : spec.key === "memoryMiB" ? 64 : 200;
  const top = c !== null && ceiling !== null ? toField(spec, ceiling[c]) : fallback;
  return Math.max(top, toField(spec, value), spec.unit === "vCPU" ? 0.25 : 1);
}

export const profileLine = (p: ResourceProfile): string => `${cpuText(p.cpuMillis)} · ${sizeText(p.memoryMiB)} memory · ${sizeText(p.deskStorageMiB)} desk`;

// What a profile breaks, in words: the bounds every profile keeps, and the account's per-employee limits.
export function resourceProblems(p: ResourceProfile, ceiling: PerEmployeeCeiling | null): string[] {
  const checked = checkResourceProfile(p);
  return [...(checked.ok ? [] : checked.errors), ...(ceiling ? ceilingProblems(p, ceiling) : [])];
}

// What the account's storage budget says about committing this profile's desk and cache now (`already`: what this
// employee has committed so far, 0 at hire).
export function storageProblem(p: ResourceProfile, summary: ResourceSummary | null, already = 0): string | null {
  if (summary === null) return null;
  const after = summary.storage.committedMiB - already + p.deskStorageMiB + p.cacheStorageMiB;
  return after > summary.budget.storageMiB ? `Its desk and cache (${sizeText(p.deskStorageMiB + p.cacheStorageMiB)}) would bring the storage committed to ${sizeText(after)}, above the account's storage budget of ${sizeText(summary.budget.storageMiB)}: it would be refused.` : null;
}

export function BudgetSummary({ summary, runtime }: { summary: ResourceSummary | null; runtime?: RuntimeKind | null }) {
  const s = useStyles();
  const o = useOfficeStyles();
  if (summary === null)
    return (
      <aside className={s.aside} aria-label="Account budget">
        <Text size={200} className={o.muted}>
          The account's budget could not be read now.
        </Text>
      </aside>
    );
  const b = summary.budget;
  const overhead = runtime ? summary.modelPlane.find((m) => m.runtime === runtime) : undefined;
  return (
    <aside className={s.aside} aria-label="Account budget">
      <Text weight="semibold" size={300}>
        Account budget now
      </Text>
      <Text size={200} className={s.num}>
        CPU: {cpuText(b.cpuMillis)} in all · {cpuText(summary.reserved.cpuMillis)} reserved now · {cpuText(summary.available.cpuMillis)} available
      </Text>
      <Text size={200} className={s.num}>
        Memory: {sizeText(b.memoryMiB)} in all · {sizeText(summary.reserved.memoryMiB)} reserved now · {sizeText(summary.available.memoryMiB)} available
      </Text>
      <Text size={200} className={s.num}>
        Storage: {sizeText(summary.storage.budgetMiB)} budget · {sizeText(summary.storage.committedMiB)} committed · {sizeText(summary.storage.usedMiB)} actually used
      </Text>
      <Text size={200} className={s.num}>
        Work at once: at most {b.maxConcurrent} · {summary.running} running now
      </Text>
      <Text size={200} className={s.num}>
        Per employee: at most {cpuText(b.perEmployee.cpuMillis)}, {sizeText(b.perEmployee.memoryMiB)} memory, {sizeText(b.perEmployee.deskStorageMiB)} desk
      </Text>
      {overhead && (
        <Text size={200} className={o.muted}>
          Each attempt also reserves its CLI's container: {cpuText(overhead.cpuMillis)} and {sizeText(overhead.memoryMiB)}.
        </Text>
      )}
      <Text size={200}>An idle employee reserves no CPU or memory; when the account is busy, work waits — hiring is never refused for that.</Text>
    </aside>
  );
}

export function ResourceFields({ value, onChange, presets, summary, runtime = null, committed = 0 }: { value: ResourceProfile; onChange: (p: ResourceProfile) => void; presets: readonly ResourcePreset[]; summary: ResourceSummary | null; runtime?: RuntimeKind | null; committed?: number }) {
  const s = useStyles();
  const o = useOfficeStyles();
  const ceiling = summary?.budget.perEmployee ?? null;
  const problems = resourceProblems(value, ceiling);
  const storage = storageProblem(value, summary, committed);
  // Changing a number makes the profile custom: a preset is a starting point, not a promise.
  const set = (spec: Spec, v: number) => onChange({ ...value, presetId: null, [spec.key]: fromField(spec, v) });
  return (
    <div className={s.layout}>
      <div className={s.fields}>
        <div className={s.presets} role="radiogroup" aria-label="Preset">
          {presets.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={value.presetId === p.id} className={mergeClasses(s.preset, value.presetId === p.id && s.presetOn)} onClick={() => onChange({ ...p.profile, presetId: p.id })}>
              <Text weight="semibold">{p.name}</Text>
              <Text size={200} className={o.muted}>
                {profileLine(p.profile)}
              </Text>
              <Text size={200} className={o.muted}>
                {p.description}
              </Text>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={value.presetId === null} className={mergeClasses(s.preset, value.presetId === null && s.presetOn)} onClick={() => onChange({ ...value, presetId: null })}>
            <Text weight="semibold">Custom</Text>
            <Text size={200} className={o.muted}>
              Your own numbers.
            </Text>
          </button>
        </div>
        {SPECS.map((spec) => {
          const b = RESOURCE_BOUNDS[spec.key];
          const min = toField(spec, b.min);
          const field = toField(spec, value[spec.key]);
          const step = spec.unit === "vCPU" ? 0.25 : spec.unit === "GiB" ? 0.25 : 1;
          const label = `${spec.label} (${spec.unit})`;
          return (
            <div key={spec.key} className={s.field} role="group" aria-label={spec.label}>
              <Text weight="semibold" size={300}>
                {label}
              </Text>
              <div className={s.pair}>
                {spec.slider ? <Slider className={s.slider} aria-label={`${spec.label} slider`} min={min} max={sliderMax(spec, ceiling, value[spec.key])} step={step} value={field} onChange={(_, d) => set(spec, d.value)} /> : <span />}
                <NumberInput label={label} value={field} onValue={(v) => set(spec, v)} min={min} max={toField(spec, b.max)} step={step} />
              </div>
              <Text size={200} className={o.muted}>
                {spec.hint}
              </Text>
            </div>
          );
        })}
        {problems.length > 0 && (
          <MessageBar intent="error" layout="multiline">
            <MessageBarBody>
              <ul aria-label="What these resources break" style={{ margin: 0, paddingLeft: "18px" }}>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </MessageBarBody>
          </MessageBar>
        )}
        {storage && (
          <MessageBar intent="error" layout="multiline">
            <MessageBarBody>{storage}</MessageBarBody>
          </MessageBar>
        )}
      </div>
      <BudgetSummary summary={summary} runtime={runtime} />
    </div>
  );
}
