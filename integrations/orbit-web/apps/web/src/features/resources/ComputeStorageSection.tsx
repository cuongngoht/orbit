// SETTINGS → COMPUTE & STORAGE: what this account's employees may use, level by level -- what the host can give (and how
// that was learned), the account's budget beside the ceiling the operator authorized, what is reserved by work running
// now and what is free, what the running attempts were last measured USING (never what they reserved), the storage
// promised and really used per category with how each limit is enforced, and how much work runs, waits, or can never
// start as configured. The owner may lower the budget; raising it above the authorization is the operator's, in a
// terminal of the server, and the API refuses it whatever a page sends.
import { Badge, Button, Field, Input, MessageBar, MessageBarActions, MessageBarBody, ProgressBar, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import type { AccountResourceBudget, PerEmployeeCeiling, ResourceSummary, StorageCategory, UpdateBudgetRequest } from "@orbit-web/contracts";
import { STORAGE_CATEGORIES } from "@orbit-web/contracts";
import { ArrowSync16Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useI18n, type MessageKey } from "../../i18n";
import { errorText, get, ifMatch, isStale, send } from "../../services/api";
import { useAppEvent, useAppStream } from "../../services/events/AppEvents";
import { CAPACITY_SOURCE_KEYS, CATEGORY_KEYS, LEVEL_KEYS, LEVEL_TONE, cpuText, fromGiB, fromVcpu, sizeText, toGiB, toVcpu } from "./format";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 },
  block: { display: "flex", flexDirection: "column", gap: "10px", padding: "14px 16px", borderRadius: "14px", ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2), minWidth: 0 },
  table: { width: "100%", overflowX: "auto", minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  row: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  stats: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "8px" },
  stat: { display: "flex", flexDirection: "column", gap: "2px", padding: "10px 12px", borderRadius: "12px", backgroundColor: tokens.colorNeutralBackground2, minWidth: 0 },
  value: { fontSize: tokens.fontSizeBase500, fontWeight: tokens.fontWeightSemibold, fontVariantNumeric: "tabular-nums" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "10px" },
  button: { alignSelf: "flex-start", "@media (max-width: 639px), (pointer: coarse)": { alignSelf: "stretch", minHeight: "44px" } },
  meters: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" },
  meter: { display: "flex", flexDirection: "column", gap: "4px" },
  meterHead: { display: "flex", justifyContent: "space-between", gap: "8px", fontSize: tokens.fontSizeBase200 },
  code: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, wordBreak: "break-all" },
});

const useWhen = () => {
  const { t } = useI18n();
  return (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : t("settings.resources.notYet"));
};

// The account's resources, read again when the office changes (a hire commits storage) and when the stream reopens.
export function useResourceSummary() {
  const { generation } = useAppStream();
  const [changed, setChanged] = useState(0);
  useAppEvent("office.changed", (e) => {
    if (e.data.areas.includes("roster") || e.data.areas.includes("missions")) setChanged((x) => x + 1);
  });
  return useResource<ResourceSummary>(() => get("/api/office/resources"), [generation, changed]);
}

function Stat({ label, value }: { label: string; value: string | number }) {
  const s = useStyles();
  return (
    <div className={s.stat}>
      <Text size={200} className={s.muted}>
        {label}
      </Text>
      <Text className={s.value}>{value}</Text>
    </div>
  );
}

// OBSERVED USE: what the running attempts' containers were last measured using -- memory now and at peak, CPU time --
// kept apart from what admission reserved for them and from the storage committed. A number nobody measured is said as
// such, and nothing sampled lately says so instead of a zero.
function ObservedUse({ observed }: { observed: ResourceSummary["observed"] }) {
  const { t } = useI18n();
  const when = useWhen();
  const s = useStyles();
  const measured = (v: string | null) => v ?? t("settings.resources.observed.notMeasured");
  return (
    <section className={s.block} aria-label={t("settings.resources.observed.title")}>
      <Text weight="semibold">{t("settings.resources.observed.title")}</Text>
      <Text size={200} className={s.muted}>
        {t("settings.resources.observed.hint")}
      </Text>
      {observed.sampledAt === null ? (
        <Text size={200}>{t("settings.resources.observed.none")}</Text>
      ) : (
        <>
          <div className={s.stats}>
            <Stat label={t("settings.resources.observed.memoryNow")} value={measured(observed.memoryCurrentMiB === null ? null : sizeText(observed.memoryCurrentMiB))} />
            <Stat label={t("settings.resources.observed.memoryPeak")} value={measured(observed.memoryPeakMiB === null ? null : sizeText(observed.memoryPeakMiB))} />
            <Stat label={t("settings.resources.observed.cpuTime")} value={measured(observed.cpuSeconds === null ? null : t("settings.resources.observed.seconds", { value: observed.cpuSeconds.toLocaleString("en-US", { maximumFractionDigits: 1 }) }))} />
            <Stat label={t("settings.resources.observed.runs")} value={observed.runs} />
          </div>
          <Text size={200} className={s.muted}>
            {t("settings.resources.observed.sampled", { when: when(observed.sampledAt) })}
          </Text>
        </>
      )}
    </section>
  );
}

// The budget a person may set: every field at most what the operator authorized.
interface Draft {
  cpu: string;
  memory: string;
  storage: string;
  concurrent: string;
  perCpu: string;
  perMemory: string;
  perDesk: string;
  perScratch: string;
  perCache: string;
}

const draftOf = (b: AccountResourceBudget): Draft => ({
  cpu: String(toVcpu(b.cpuMillis)),
  memory: String(toGiB(b.memoryMiB)),
  storage: String(toGiB(b.storageMiB)),
  concurrent: String(b.maxConcurrent),
  perCpu: String(toVcpu(b.perEmployee.cpuMillis)),
  perMemory: String(toGiB(b.perEmployee.memoryMiB)),
  perDesk: String(toGiB(b.perEmployee.deskStorageMiB)),
  perScratch: String(toGiB(b.perEmployee.scratchStorageMiB)),
  perCache: String(toGiB(b.perEmployee.cacheStorageMiB)),
});

interface Limit {
  key: keyof Draft;
  labelKey: MessageKey;
  unitKey: MessageKey;
  unitKind: "vcpu" | "gib" | "attempts";
  step: number;
  // The value in the API's units, from the typed one.
  toApi: (v: number) => number;
  current: (b: AccountResourceBudget) => number;
  authorized: (b: AccountResourceBudget) => number;
}

const per = (k: keyof PerEmployeeCeiling) => ({ current: (b: AccountResourceBudget) => b.perEmployee[k], authorized: (b: AccountResourceBudget) => b.authorized.perEmployee[k] });

const LIMITS: Limit[] = [
  { key: "cpu", labelKey: "settings.resources.limit.cpu", unitKey: "settings.resources.unit.vcpu", unitKind: "vcpu", step: 0.25, toApi: fromVcpu, current: (b) => b.cpuMillis, authorized: (b) => b.authorized.cpuMillis },
  { key: "memory", labelKey: "settings.resources.limit.memory", unitKey: "settings.resources.unit.gib", unitKind: "gib", step: 0.5, toApi: fromGiB, current: (b) => b.memoryMiB, authorized: (b) => b.authorized.memoryMiB },
  { key: "storage", labelKey: "settings.resources.limit.storage", unitKey: "settings.resources.unit.gib", unitKind: "gib", step: 1, toApi: fromGiB, current: (b) => b.storageMiB, authorized: (b) => b.authorized.storageMiB },
  { key: "concurrent", labelKey: "settings.resources.limit.concurrent", unitKey: "settings.resources.unit.attempts", unitKind: "attempts", step: 1, toApi: (v) => Math.round(v), current: (b) => b.maxConcurrent, authorized: (b) => b.authorized.maxConcurrent },
  { key: "perCpu", labelKey: "settings.resources.limit.perCpu", unitKey: "settings.resources.unit.vcpu", unitKind: "vcpu", step: 0.25, toApi: fromVcpu, ...per("cpuMillis") },
  { key: "perMemory", labelKey: "settings.resources.limit.perMemory", unitKey: "settings.resources.unit.gib", unitKind: "gib", step: 0.5, toApi: fromGiB, ...per("memoryMiB") },
  { key: "perDesk", labelKey: "settings.resources.limit.perDesk", unitKey: "settings.resources.unit.gib", unitKind: "gib", step: 1, toApi: fromGiB, ...per("deskStorageMiB") },
  { key: "perScratch", labelKey: "settings.resources.limit.perScratch", unitKey: "settings.resources.unit.gib", unitKind: "gib", step: 1, toApi: fromGiB, ...per("scratchStorageMiB") },
  { key: "perCache", labelKey: "settings.resources.limit.perCache", unitKey: "settings.resources.unit.gib", unitKind: "gib", step: 1, toApi: fromGiB, ...per("cacheStorageMiB") },
];

const isCpu = (l: Limit) => l.unitKind === "vcpu";
const isCount = (l: Limit) => l.unitKind === "attempts";
const shown = (l: Limit, v: number): string => (isCpu(l) ? cpuText(v) : isCount(l) ? String(v) : sizeText(v));

function BudgetForm({ budget, onSaved, onLoadLatest }: { budget: AccountResourceBudget; onSaved: (r: ResourceSummary) => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const [draft, setDraft] = useState<Draft>(() => draftOf(budget));
  // What each field said when the form opened: a field is a change only once its text differs from it -- comparing the
  // rounded GiB shown with the MiB kept made a field nobody touched look changed (18374 MiB shown 17.94, sent 18371).
  const [opened] = useState<Draft>(() => draftOf(budget));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<{ text: string; stale: boolean } | null>(null);
  const values = LIMITS.map((l) => ({ l, value: l.toApi(Number(draft[l.key])), typed: draft[l.key] }));
  const invalid = values.filter((v) => v.typed.trim() === "" || !Number.isFinite(Number(v.typed)) || v.value < 0);
  const above = values.filter((v) => !invalid.includes(v) && v.value > v.l.authorized(budget));
  const change: UpdateBudgetRequest = {};
  const perEmployee: Partial<PerEmployeeCeiling> = {};
  for (const v of values) {
    if (invalid.includes(v) || v.typed.trim() === opened[v.l.key].trim() || v.value === v.l.current(budget)) continue;
    if (v.l.key === "cpu") change.cpuMillis = v.value;
    if (v.l.key === "memory") change.memoryMiB = v.value;
    if (v.l.key === "storage") change.storageMiB = v.value;
    if (v.l.key === "concurrent") change.maxConcurrent = v.value;
    if (v.l.key === "perCpu") perEmployee.cpuMillis = v.value;
    if (v.l.key === "perMemory") perEmployee.memoryMiB = v.value;
    if (v.l.key === "perDesk") perEmployee.deskStorageMiB = v.value;
    if (v.l.key === "perScratch") perEmployee.scratchStorageMiB = v.value;
    if (v.l.key === "perCache") perEmployee.cacheStorageMiB = v.value;
  }
  if (Object.keys(perEmployee).length > 0) change.perEmployee = perEmployee;
  const changed = Object.keys(change).length > 0;
  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      onSaved(await send<ResourceSummary>("PATCH", "/api/office/resources/budget", change, ifMatch(budget.version)));
      setSaved(true);
    } catch (err) {
      setError({ text: isStale(err) ? t("settings.resources.budget.stale") : errorText(err), stale: isStale(err) });
    } finally {
      setBusy(false);
    }
  };
  const renderField = (l: Limit) => {
    const typed = draft[l.key];
    const bad = invalid.some((v) => v.l === l) ? t("settings.resources.budget.invalid") : above.some((v) => v.l === l) ? t("settings.resources.budget.above", { max: shown(l, l.authorized(budget)) }) : undefined;
    return (
      <Field key={l.key} label={t("settings.resources.budget.fieldLabel", { label: t(l.labelKey), unit: t(l.unitKey) })} validationState={bad ? "error" : "none"} validationMessage={bad} hint={t("settings.resources.budget.authorizedHint", { value: shown(l, l.authorized(budget)) })}>
        <Input type="number" inputMode="decimal" min={0} step={l.step} max={isCpu(l) ? toVcpu(l.authorized(budget)) : isCount(l) ? l.authorized(budget) : toGiB(l.authorized(budget))} value={typed} onChange={(_, d) => setDraft((x) => ({ ...x, [l.key]: d.value }))} />
      </Field>
    );
  };
  const accountLimits = LIMITS.filter((l) => !l.key.startsWith("per"));
  const perEmployeeLimits = LIMITS.filter((l) => l.key.startsWith("per"));
  return (
    <form
      className={s.block}
      aria-label={t("settings.resources.budget.formTitle")}
      // The form checks each value itself (a number, at least 0, at most the authorization): the browser's own check
      // refused any value off the arrows' step -- an authorization of 0.05 vCPU on a 0.25 step could not be saved.
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Text weight="semibold">{t("settings.resources.budget.formTitle")}</Text>
      <Text size={200} className={s.muted}>
        {t("settings.resources.budget.formHint")}
      </Text>
      <Text size={200} weight="semibold">
        {t("settings.resources.budget.accountGroup")}
      </Text>
      <div className={s.grid}>{accountLimits.map(renderField)}</div>
      <Text size={200} weight="semibold">
        {t("settings.resources.budget.perEmployeeGroup")}
      </Text>
      <div className={s.grid}>{perEmployeeLimits.map(renderField)}</div>
      {error && (
        <MessageBar intent={error.stale ? "warning" : "error"}>
          <MessageBarBody>{error.text}</MessageBarBody>
          {error.stale && (
            <MessageBarActions>
              <Button size="small" onClick={onLoadLatest}>
                {t("settings.connections.loadLatest")}
              </Button>
            </MessageBarActions>
          )}
        </MessageBar>
      )}
      {saved && !changed && (
        <Text size={200} className={s.muted} role="status">
          {t("settings.resources.budget.saved")}
        </Text>
      )}
      <div className={s.row}>
        <Button className={s.button} appearance="primary" type="submit" disabled={busy || !changed || invalid.length > 0 || above.length > 0}>
          {busy ? t("settings.resources.budget.saving") : t("settings.resources.budget.save")}
        </Button>
        {changed && (
          <Button className={s.button} type="button" disabled={busy} onClick={() => setDraft(opened)}>
            {t("settings.resources.budget.reset")}
          </Button>
        )}
      </div>
      <Text size={200} className={s.muted}>
        {t("settings.resources.budget.operatorPrefix")} <span className={s.code}>node dist/cli/governance.js budget set</span> {t("settings.resources.budget.operatorSuffix")}
      </Text>
    </form>
  );
}

// Re-check: the host's capacity read again now; the budgets that follow it move with it.
function Recheck({ onDone }: { onDone: (r: ResourceSummary) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recheck = async () => {
    setBusy(true);
    setError(null);
    try {
      onDone(await send<ResourceSummary>("POST", "/api/office/resources/capacity/check"));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button className={s.button} size="small" icon={busy ? <Spinner size="extra-tiny" /> : <ArrowSync16Regular />} disabled={busy} onClick={() => void recheck()} title={t("settings.resources.recheck.title")}>
        {t("settings.resources.recheck")}
      </Button>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
    </>
  );
}

export function ComputeStorageSection() {
  const { t } = useI18n();
  const when = useWhen();
  const s = useStyles();
  const summary = useResourceSummary();
  if (summary.data === null)
    return summary.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{summary.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner size="tiny" label={t("settings.resources.loading")} />
    );
  const r = summary.data;
  const cap = r.capacity;
  const b = r.budget;
  const overBudget = r.reserved.cpuMillis > b.cpuMillis || r.reserved.memoryMiB > b.memoryMiB;
  return (
    <div className={`${s.root} orbit-touch`}>
      <section className={s.block} aria-label={t("settings.resources.capacity.title")}>
        <div className={s.row}>
          <Text weight="semibold">{t("settings.resources.capacity.title")}</Text>
          <Badge appearance="outline">{t(CAPACITY_SOURCE_KEYS[cap.source])}</Badge>
          <Recheck onDone={summary.set} />
        </div>
        <Text size={200} className={s.muted}>
          {t("settings.resources.capacity.hint", { when: when(cap.checkedAt) })}
        </Text>
        <div className={s.table}>
          <Table size="small" aria-label={t("settings.resources.capacity.tableAria")}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t("settings.resources.capacity.colResource")}</TableHeaderCell>
                <TableHeaderCell>{t("settings.resources.capacity.colTotal")}</TableHeaderCell>
                <TableHeaderCell>{t("settings.resources.capacity.colKeptBack")}</TableHeaderCell>
                <TableHeaderCell>{t("settings.resources.capacity.colUsable")}</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>{t("settings.resources.row.cpu")}</TableCell>
                <TableCell>{cpuText(cap.total.cpuMillis)}</TableCell>
                <TableCell>{cpuText(cap.headroom.cpuMillis)}</TableCell>
                <TableCell>{cpuText(cap.usable.cpuMillis)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{t("settings.resources.row.memory")}</TableCell>
                <TableCell>{sizeText(cap.total.memoryMiB)}</TableCell>
                <TableCell>{sizeText(cap.headroom.memoryMiB)}</TableCell>
                <TableCell>{sizeText(cap.usable.memoryMiB)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>{t("settings.resources.row.storage")}</TableCell>
                <TableCell>{sizeText(cap.total.storageMiB)}</TableCell>
                <TableCell>{sizeText(cap.headroom.storageMiB)}</TableCell>
                <TableCell>{sizeText(cap.usable.storageMiB)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <div className={s.row}>
          <Text size={200}>{t("settings.resources.storageLimitsPerArea")}</Text>
          <Badge appearance="tint" color={LEVEL_TONE[cap.storage.perArea]}>
            {t(LEVEL_KEYS[cap.storage.perArea])}
          </Badge>
          <Text size={200}>{t("settings.resources.hostDiskProtection")}</Text>
          <Badge appearance="tint" color={LEVEL_TONE[cap.storage.hostProtection]}>
            {t(LEVEL_KEYS[cap.storage.hostProtection])}
          </Badge>
        </div>
        <Text size={200} className={s.muted}>
          {t("settings.resources.mechanism", { mechanism: cap.storage.mechanism, evidence: cap.storage.evidence, when: when(cap.storage.probedAt) })}
        </Text>
      </section>

      <section className={s.block} aria-label={t("settings.resources.accountBudget.title")}>
        <Text weight="semibold">{t("settings.resources.accountBudget.title")}</Text>
        <div className={s.table}>
          <Table size="small" aria-label={t("settings.resources.accountBudget.tableAria")}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t("settings.resources.accountBudget.colLimit")}</TableHeaderCell>
                <TableHeaderCell>{t("settings.resources.accountBudget.colBudget")}</TableHeaderCell>
                <TableHeaderCell>{t("settings.resources.accountBudget.colAuthorized")}</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {LIMITS.map((l) => (
                <TableRow key={l.key}>
                  <TableCell>{t(l.labelKey)}</TableCell>
                  <TableCell>{shown(l, l.current(b))}</TableCell>
                  <TableCell>{shown(l, l.authorized(b))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className={s.block} aria-label={t("settings.resources.now.title")}>
        <Text weight="semibold">{t("settings.resources.now.title")}</Text>
        {overBudget && (
          <MessageBar intent="warning">
            <MessageBarBody>{t("settings.resources.now.overBudget")}</MessageBarBody>
          </MessageBar>
        )}
        <div className={s.meters}>
          <div className={s.meter}>
            <div className={s.meterHead}>
              <Text size={200}>{t("settings.resources.row.cpu")}</Text>
              <Text size={200} className={s.muted}>
                {cpuText(r.reserved.cpuMillis)} / {cpuText(b.cpuMillis)}
              </Text>
            </div>
            <ProgressBar value={b.cpuMillis > 0 ? Math.min(1, r.reserved.cpuMillis / b.cpuMillis) : 0} color={r.reserved.cpuMillis > b.cpuMillis ? "warning" : "brand"} />
          </div>
          <div className={s.meter}>
            <div className={s.meterHead}>
              <Text size={200}>{t("settings.resources.row.memory")}</Text>
              <Text size={200} className={s.muted}>
                {sizeText(r.reserved.memoryMiB)} / {sizeText(b.memoryMiB)}
              </Text>
            </div>
            <ProgressBar value={b.memoryMiB > 0 ? Math.min(1, r.reserved.memoryMiB / b.memoryMiB) : 0} color={r.reserved.memoryMiB > b.memoryMiB ? "warning" : "brand"} />
          </div>
        </div>
        <div className={s.stats}>
          <Stat label={t("settings.resources.now.cpuReserved")} value={cpuText(r.reserved.cpuMillis)} />
          <Stat label={t("settings.resources.now.cpuAvailable")} value={cpuText(r.available.cpuMillis)} />
          <Stat label={t("settings.resources.now.memoryReserved")} value={sizeText(r.reserved.memoryMiB)} />
          <Stat label={t("settings.resources.now.memoryAvailable")} value={sizeText(r.available.memoryMiB)} />
          <Stat label={t("settings.resources.now.scratchReserved")} value={sizeText(r.reserved.scratchMiB)} />
          <Stat label={t("settings.resources.now.running")} value={r.running} />
          <Stat label={t("settings.resources.now.waiting")} value={r.waiting} />
          <Stat label={t("settings.resources.now.unschedulable")} value={r.unschedulable} />
        </div>
        <Text size={200} className={s.muted}>
          {t("settings.resources.now.idleNote")}
        </Text>
        {r.modelPlane.length > 0 && (
          <Text size={200} className={s.muted}>
            {t("settings.resources.now.modelPlanePrefix", { items: r.modelPlane.map((m) => t("settings.resources.now.modelPlaneItem", { runtime: m.runtime, cpu: cpuText(m.cpuMillis), memory: sizeText(m.memoryMiB) })).join("; ") })}
          </Text>
        )}
        <Text size={200} className={s.muted}>
          {t("settings.resources.now.reservedNote")}
        </Text>
      </section>

      {r.observed && <ObservedUse observed={r.observed} />}

      <section className={s.block} aria-label={t("settings.resources.storage.title")}>
        <Text weight="semibold">{t("settings.resources.storage.title")}</Text>
        <Text size={200}>
          {t("settings.resources.storage.summary", { committed: sizeText(r.storage.committedMiB), used: sizeText(r.storage.usedMiB), budget: sizeText(r.storage.budgetMiB), when: when(r.storage.measuredAt) })}
        </Text>
        <ProgressBar
          value={r.storage.budgetMiB > 0 ? Math.min(1, r.storage.committedMiB / r.storage.budgetMiB) : 0}
          color={r.storage.budgetMiB > 0 && r.storage.committedMiB / r.storage.budgetMiB >= 0.9 ? "warning" : "brand"}
        />
        <div className={s.table}>
          <Table size="small" aria-label={t("settings.resources.storage.tableAria")}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell>{t("settings.resources.storage.colCategory")}</TableHeaderCell>
                <TableHeaderCell>{t("settings.resources.storage.colCommitted")}</TableHeaderCell>
                <TableHeaderCell>{t("settings.resources.storage.colUsed")}</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {STORAGE_CATEGORIES.map((c: StorageCategory) => (
                <TableRow key={c}>
                  <TableCell>{t(CATEGORY_KEYS[c])}</TableCell>
                  <TableCell>{sizeText(r.storage.byCategory[c]?.committedMiB ?? 0)}</TableCell>
                  <TableCell>{sizeText(r.storage.byCategory[c]?.usedMiB ?? 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Text size={200} className={s.muted}>
          {t("settings.resources.storage.hint")}
        </Text>
      </section>

      <BudgetForm key={b.version} budget={b} onSaved={summary.set} onLoadLatest={() => void summary.reload()} />
      <Text size={200} className={s.muted}>
        {t("settings.resources.asOf", { when: when(r.asOf) })}
      </Text>
    </div>
  );
}
