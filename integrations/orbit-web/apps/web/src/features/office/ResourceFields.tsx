// AN EMPLOYEE'S PERSONAL SANDBOX, as numbers: a preset to start from (Lightweight, Research, Developer, Build / Test) or
// custom values, each a number field beside a slider -- CPU, memory, desk storage, scratch storage, the dependency cache --
// and the process and time limits. What a value breaks is said beside it: the account's per-employee limits (the API
// refuses past them) and the bounds every profile keeps. Beside the fields, the account's budget as it stands now.
import { Input, MessageBar, MessageBarBody, Slider, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { RESOURCE_BOUNDS, ceilingProblems, checkResourceProfile, type PerEmployeeCeiling, type ResourcePreset, type ResourceProfile, type ResourceSummary, type RuntimeKind } from "@orbit-web/contracts";
import { useState } from "react";
import { t as tr, useI18n, type MessageKey } from "../../i18n";
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
  labelKey: MessageKey;
  hintKey: MessageKey;
  // The field's unit, and how its value maps to the profile's.
  unit: "vCPU" | "GiB" | "processes" | "minutes";
  unitKey: MessageKey;
  slider: boolean;
}

const SPECS: Spec[] = [
  { key: "cpuMillis", labelKey: "office.resources.spec.cpuMillis.label", hintKey: "office.resources.spec.cpuMillis.hint", unit: "vCPU", unitKey: "office.resources.unit.vCPU", slider: true },
  { key: "memoryMiB", labelKey: "office.resources.spec.memoryMiB.label", hintKey: "office.resources.spec.memoryMiB.hint", unit: "GiB", unitKey: "office.resources.unit.GiB", slider: true },
  { key: "deskStorageMiB", labelKey: "office.resources.spec.deskStorageMiB.label", hintKey: "office.resources.spec.deskStorageMiB.hint", unit: "GiB", unitKey: "office.resources.unit.GiB", slider: true },
  { key: "scratchStorageMiB", labelKey: "office.resources.spec.scratchStorageMiB.label", hintKey: "office.resources.spec.scratchStorageMiB.hint", unit: "GiB", unitKey: "office.resources.unit.GiB", slider: true },
  { key: "cacheStorageMiB", labelKey: "office.resources.spec.cacheStorageMiB.label", hintKey: "office.resources.spec.cacheStorageMiB.hint", unit: "GiB", unitKey: "office.resources.unit.GiB", slider: true },
  { key: "pidsLimit", labelKey: "office.resources.spec.pidsLimit.label", hintKey: "office.resources.spec.pidsLimit.hint", unit: "processes", unitKey: "office.resources.unit.processes", slider: false },
  { key: "timeoutMinutes", labelKey: "office.resources.spec.timeoutMinutes.label", hintKey: "office.resources.spec.timeoutMinutes.hint", unit: "minutes", unitKey: "office.resources.unit.minutes", slider: false },
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

export const profileLine = (p: ResourceProfile): string => tr("office.resources.profileLine", { cpu: cpuText(p.cpuMillis), memory: sizeText(p.memoryMiB), desk: sizeText(p.deskStorageMiB) });

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
  return after > summary.budget.storageMiB
    ? tr("office.resources.storageProblem", { total: sizeText(p.deskStorageMiB + p.cacheStorageMiB), after: sizeText(after), budget: sizeText(summary.budget.storageMiB) })
    : null;
}

export function BudgetSummary({ summary, runtime }: { summary: ResourceSummary | null; runtime?: RuntimeKind | null }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  if (summary === null)
    return (
      <aside className={s.aside} aria-label={t("office.resources.budgetAria")}>
        <Text size={200} className={o.muted}>
          {t("office.resources.budgetUnread")}
        </Text>
      </aside>
    );
  const b = summary.budget;
  const overhead = runtime ? summary.modelPlane.find((m) => m.runtime === runtime) : undefined;
  return (
    <aside className={s.aside} aria-label={t("office.resources.budgetAria")}>
      <Text weight="semibold" size={300}>
        {t("office.resources.budgetNow")}
      </Text>
      <Text size={200} className={s.num}>
        {t("office.resources.budgetCpu", { total: cpuText(b.cpuMillis), reserved: cpuText(summary.reserved.cpuMillis), available: cpuText(summary.available.cpuMillis) })}
      </Text>
      <Text size={200} className={s.num}>
        {t("office.resources.budgetMemory", { total: sizeText(b.memoryMiB), reserved: sizeText(summary.reserved.memoryMiB), available: sizeText(summary.available.memoryMiB) })}
      </Text>
      <Text size={200} className={s.num}>
        {t("office.resources.budgetStorage", { budget: sizeText(summary.storage.budgetMiB), committed: sizeText(summary.storage.committedMiB), used: sizeText(summary.storage.usedMiB) })}
      </Text>
      <Text size={200} className={s.num}>
        {t("office.resources.budgetConcurrent", { max: b.maxConcurrent, running: summary.running })}
      </Text>
      <Text size={200} className={s.num}>
        {t("office.resources.budgetPerEmployee", { cpu: cpuText(b.perEmployee.cpuMillis), memory: sizeText(b.perEmployee.memoryMiB), desk: sizeText(b.perEmployee.deskStorageMiB) })}
      </Text>
      {overhead && (
        <Text size={200} className={o.muted}>
          {t("office.resources.budgetOverhead", { cpu: cpuText(overhead.cpuMillis), memory: sizeText(overhead.memoryMiB) })}
        </Text>
      )}
      <Text size={200}>{t("office.resources.budgetIdleNote")}</Text>
    </aside>
  );
}

export function ResourceFields({ value, onChange, presets, summary, runtime = null, committed = 0 }: { value: ResourceProfile; onChange: (p: ResourceProfile) => void; presets: readonly ResourcePreset[]; summary: ResourceSummary | null; runtime?: RuntimeKind | null; committed?: number }) {
  const { t } = useI18n();
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
        <div className={s.presets} role="radiogroup" aria-label={t("office.resources.presetAria")}>
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
            <Text weight="semibold">{t("office.resources.customName")}</Text>
            <Text size={200} className={o.muted}>
              {t("office.resources.customDesc")}
            </Text>
          </button>
        </div>
        {SPECS.map((spec) => {
          const b = RESOURCE_BOUNDS[spec.key];
          const min = toField(spec, b.min);
          const field = toField(spec, value[spec.key]);
          const step = spec.unit === "vCPU" ? 0.25 : spec.unit === "GiB" ? 0.25 : 1;
          const specLabel = t(spec.labelKey);
          const label = `${specLabel} (${t(spec.unitKey)})`;
          return (
            <div key={spec.key} className={s.field} role="group" aria-label={specLabel}>
              <Text weight="semibold" size={300}>
                {label}
              </Text>
              <div className={s.pair}>
                {spec.slider ? <Slider className={s.slider} aria-label={t("office.resources.sliderAria", { label: specLabel })} min={min} max={sliderMax(spec, ceiling, value[spec.key])} step={step} value={field} onChange={(_, d) => set(spec, d.value)} /> : <span />}
                <NumberInput label={label} value={field} onValue={(v) => set(spec, v)} min={min} max={toField(spec, b.max)} step={step} />
              </div>
              <Text size={200} className={o.muted}>
                {t(spec.hintKey)}
              </Text>
            </div>
          );
        })}
        {problems.length > 0 && (
          <MessageBar intent="error" layout="multiline">
            <MessageBarBody>
              <ul aria-label={t("office.resources.breaksAria")} style={{ margin: 0, paddingLeft: "18px" }}>
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
