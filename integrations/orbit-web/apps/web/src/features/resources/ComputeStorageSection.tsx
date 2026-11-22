// SETTINGS → COMPUTE & STORAGE: what this account's employees may use, level by level -- what the host can give (and how
// that was learned), the account's budget beside the ceiling the operator authorized, what is reserved by work running
// now and what is free, the storage promised and really used per category with how each limit is enforced, and how
// much work runs, waits, or can never start as configured. The owner may lower the budget; raising it above the
// authorization is the operator's, in a terminal of the server, and the API refuses it whatever a page sends.
import { Badge, Button, Field, Input, MessageBar, MessageBarActions, MessageBarBody, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import type { AccountResourceBudget, PerEmployeeCeiling, ResourceSummary, StorageCategory, UpdateBudgetRequest } from "@orbit-web/contracts";
import { STORAGE_CATEGORIES } from "@orbit-web/contracts";
import { ArrowSync16Regular } from "@fluentui/react-icons";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { errorText, get, ifMatch, isStale, send } from "../../services/api";
import { useAppEvent, useAppStream } from "../../services/events/AppEvents";
import { CAPACITY_SOURCE_TEXT, CATEGORY_TEXT, LEVEL_TEXT, LEVEL_TONE, cpuText, fromGiB, fromVcpu, sizeText, toGiB, toVcpu } from "./format";

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
  code: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, wordBreak: "break-all" },
});

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : "not yet");

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
  label: string;
  unit: string;
  step: number;
  // The value in the API's units, from the typed one.
  toApi: (v: number) => number;
  current: (b: AccountResourceBudget) => number;
  authorized: (b: AccountResourceBudget) => number;
}

const per = (k: keyof PerEmployeeCeiling) => ({ current: (b: AccountResourceBudget) => b.perEmployee[k], authorized: (b: AccountResourceBudget) => b.authorized.perEmployee[k] });

const LIMITS: Limit[] = [
  { key: "cpu", label: "CPU", unit: "vCPU", step: 0.25, toApi: fromVcpu, current: (b) => b.cpuMillis, authorized: (b) => b.authorized.cpuMillis },
  { key: "memory", label: "Memory", unit: "GiB", step: 0.5, toApi: fromGiB, current: (b) => b.memoryMiB, authorized: (b) => b.authorized.memoryMiB },
  { key: "storage", label: "Persistent storage", unit: "GiB", step: 1, toApi: fromGiB, current: (b) => b.storageMiB, authorized: (b) => b.authorized.storageMiB },
  { key: "concurrent", label: "Work at the same time", unit: "attempts", step: 1, toApi: (v) => Math.round(v), current: (b) => b.maxConcurrent, authorized: (b) => b.authorized.maxConcurrent },
  { key: "perCpu", label: "Per employee: CPU", unit: "vCPU", step: 0.25, toApi: fromVcpu, ...per("cpuMillis") },
  { key: "perMemory", label: "Per employee: memory", unit: "GiB", step: 0.5, toApi: fromGiB, ...per("memoryMiB") },
  { key: "perDesk", label: "Per employee: desk", unit: "GiB", step: 1, toApi: fromGiB, ...per("deskStorageMiB") },
  { key: "perScratch", label: "Per employee: scratch", unit: "GiB", step: 1, toApi: fromGiB, ...per("scratchStorageMiB") },
  { key: "perCache", label: "Per employee: cache", unit: "GiB", step: 1, toApi: fromGiB, ...per("cacheStorageMiB") },
];

const isCpu = (l: Limit) => l.unit === "vCPU";
const isCount = (l: Limit) => l.unit === "attempts";
const shown = (l: Limit, v: number): string => (isCpu(l) ? cpuText(v) : isCount(l) ? String(v) : sizeText(v));

function BudgetForm({ budget, onSaved, onLoadLatest }: { budget: AccountResourceBudget; onSaved: (r: ResourceSummary) => void; onLoadLatest: () => void }) {
  const s = useStyles();
  const [draft, setDraft] = useState<Draft>(() => draftOf(budget));
  // What each field said when the form opened: a field is a change only once its text differs from it -- comparing the
  // rounded GiB shown with the MiB kept made a field nobody touched look changed (18374 MiB shown 17.94, sent 18371).
  const [opened] = useState<Draft>(() => draftOf(budget));
  const [busy, setBusy] = useState(false);
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
    try {
      onSaved(await send<ResourceSummary>("PATCH", "/api/office/resources/budget", change, ifMatch(budget.version)));
    } catch (err) {
      setError({ text: isStale(err) ? "The budget changed since this page read it: nothing was saved." : errorText(err), stale: isStale(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={s.block}
      aria-label="Change the budget"
      // The form checks each value itself (a number, at least 0, at most the authorization): the browser's own check
      // refused any value off the arrows' step -- an authorization of 0.05 vCPU on a 0.25 step could not be saved.
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Text weight="semibold">Change the budget</Text>
      <Text size={200} className={s.muted}>
        You can lower any of these, and raise it back up to what the operator authorized — never above. Lowering it never stops running work: new work waits until running work ends.
      </Text>
      <div className={s.grid}>
        {LIMITS.map((l) => {
          const typed = draft[l.key];
          const bad = invalid.some((v) => v.l === l) ? "Type a number of at least 0." : above.some((v) => v.l === l) ? `At most ${shown(l, l.authorized(budget))}, the operator's authorization.` : undefined;
          return (
            <Field key={l.key} label={`${l.label} (${l.unit})`} validationState={bad ? "error" : "none"} validationMessage={bad} hint={`Authorized: ${shown(l, l.authorized(budget))}`}>
              <Input type="number" inputMode="decimal" min={0} step={l.step} max={isCpu(l) ? toVcpu(l.authorized(budget)) : isCount(l) ? l.authorized(budget) : toGiB(l.authorized(budget))} value={typed} onChange={(_, d) => setDraft((x) => ({ ...x, [l.key]: d.value }))} />
            </Field>
          );
        })}
      </div>
      {error && (
        <MessageBar intent={error.stale ? "warning" : "error"}>
          <MessageBarBody>{error.text}</MessageBarBody>
          {error.stale && (
            <MessageBarActions>
              <Button size="small" onClick={onLoadLatest}>
                Load the latest
              </Button>
            </MessageBarActions>
          )}
        </MessageBar>
      )}
      <Button className={s.button} appearance="primary" type="submit" disabled={busy || !changed || invalid.length > 0 || above.length > 0}>
        {busy ? "Saving…" : "Save the budget"}
      </Button>
      <Text size={200} className={s.muted}>
        To raise the authorization itself, the operator runs <span className={s.code}>node dist/cli/governance.js budget set</span> on the server.
      </Text>
    </form>
  );
}

// Re-check: the host's capacity read again now; the budgets that follow it move with it.
function Recheck({ onDone }: { onDone: (r: ResourceSummary) => void }) {
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
      <Button className={s.button} size="small" icon={busy ? <Spinner size="extra-tiny" /> : <ArrowSync16Regular />} disabled={busy} onClick={() => void recheck()} title="Reads this host's CPU, memory and storage again now.">
        Re-check
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
  const s = useStyles();
  const summary = useResourceSummary();
  if (summary.data === null)
    return summary.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{summary.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner size="tiny" label="Reading the account's resources…" />
    );
  const r = summary.data;
  const cap = r.capacity;
  const b = r.budget;
  const overBudget = r.reserved.cpuMillis > b.cpuMillis || r.reserved.memoryMiB > b.memoryMiB;
  return (
    <div className={`${s.root} orbit-touch`}>
      <section className={s.block} aria-label="Infrastructure capacity">
        <div className={s.row}>
          <Text weight="semibold">Infrastructure capacity</Text>
          <Badge appearance="outline">{CAPACITY_SOURCE_TEXT[cap.source]}</Badge>
          <Recheck onDone={summary.set} />
        </div>
        <Text size={200} className={s.muted}>
          What this host can give employees: its total, minus what Orbit, the database, the proxy and the system keep. Checked {when(cap.checkedAt)}. Re-check reads the host again now (after the server was resized, or its settings changed); a budget that follows the host's capacity follows it.
        </Text>
        <div className={s.table}>
          <Table size="small" aria-label="Capacity">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Resource</TableHeaderCell>
                <TableHeaderCell>Total</TableHeaderCell>
                <TableHeaderCell>Kept back</TableHeaderCell>
                <TableHeaderCell>Usable</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>CPU</TableCell>
                <TableCell>{cpuText(cap.total.cpuMillis)}</TableCell>
                <TableCell>{cpuText(cap.headroom.cpuMillis)}</TableCell>
                <TableCell>{cpuText(cap.usable.cpuMillis)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Memory</TableCell>
                <TableCell>{sizeText(cap.total.memoryMiB)}</TableCell>
                <TableCell>{sizeText(cap.headroom.memoryMiB)}</TableCell>
                <TableCell>{sizeText(cap.usable.memoryMiB)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell>Storage</TableCell>
                <TableCell>{sizeText(cap.total.storageMiB)}</TableCell>
                <TableCell>{sizeText(cap.headroom.storageMiB)}</TableCell>
                <TableCell>{sizeText(cap.usable.storageMiB)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
        <div className={s.row}>
          <Text size={200}>Storage limits per area:</Text>
          <Badge appearance="tint" color={LEVEL_TONE[cap.storage.perArea]}>
            {LEVEL_TEXT[cap.storage.perArea]}
          </Badge>
          <Text size={200}>Host disk protection:</Text>
          <Badge appearance="tint" color={LEVEL_TONE[cap.storage.hostProtection]}>
            {LEVEL_TEXT[cap.storage.hostProtection]}
          </Badge>
        </div>
        <Text size={200} className={s.muted}>
          Mechanism: {cap.storage.mechanism}. {cap.storage.evidence} (probed {when(cap.storage.probedAt)})
        </Text>
      </section>

      <section className={s.block} aria-label="Account budget">
        <Text weight="semibold">Account budget</Text>
        <div className={s.table}>
          <Table size="small" aria-label="Budget and authorization">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Limit</TableHeaderCell>
                <TableHeaderCell>Budget</TableHeaderCell>
                <TableHeaderCell>Authorized</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {LIMITS.map((l) => (
                <TableRow key={l.key}>
                  <TableCell>{l.label}</TableCell>
                  <TableCell>{shown(l, l.current(b))}</TableCell>
                  <TableCell>{shown(l, l.authorized(b))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className={s.block} aria-label="Now">
        <Text weight="semibold">Now</Text>
        {overBudget && (
          <MessageBar intent="warning">
            <MessageBarBody>Over budget until running work ends: new work waits; nothing running is stopped.</MessageBarBody>
          </MessageBar>
        )}
        <div className={s.stats}>
          <Stat label="CPU reserved" value={cpuText(r.reserved.cpuMillis)} />
          <Stat label="CPU available" value={cpuText(r.available.cpuMillis)} />
          <Stat label="Memory reserved" value={sizeText(r.reserved.memoryMiB)} />
          <Stat label="Memory available" value={sizeText(r.available.memoryMiB)} />
          <Stat label="Scratch reserved" value={sizeText(r.reserved.scratchMiB)} />
          <Stat label="Running" value={r.running} />
          <Stat label="Waiting for resources" value={r.waiting} />
          <Stat label="Cannot start as configured" value={r.unschedulable} />
        </div>
        <Text size={200} className={s.muted}>
          An idle employee reserves no CPU or memory: it is reserved when its work starts, and released once its containers are gone.
        </Text>
        {r.modelPlane.length > 0 && (
          <Text size={200} className={s.muted}>
            Each attempt also reserves its CLI's own container: {r.modelPlane.map((m) => `${m.runtime} ${cpuText(m.cpuMillis)} and ${sizeText(m.memoryMiB)}`).join("; ")}.
          </Text>
        )}
      </section>

      <section className={s.block} aria-label="Storage">
        <Text weight="semibold">Storage</Text>
        <Text size={200}>
          {sizeText(r.storage.committedMiB)} committed and {sizeText(r.storage.usedMiB)} used, of a budget of {sizeText(r.storage.budgetMiB)}. Measured {when(r.storage.measuredAt)}.
        </Text>
        <div className={s.table}>
          <Table size="small" aria-label="Storage by category">
            <TableHeader>
              <TableRow>
                <TableHeaderCell>Category</TableHeaderCell>
                <TableHeaderCell>Committed</TableHeaderCell>
                <TableHeaderCell>Used</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {STORAGE_CATEGORIES.map((c: StorageCategory) => (
                <TableRow key={c}>
                  <TableCell>{CATEGORY_TEXT[c]}</TableCell>
                  <TableCell>{sizeText(r.storage.byCategory[c]?.committedMiB ?? 0)}</TableCell>
                  <TableCell>{sizeText(r.storage.byCategory[c]?.usedMiB ?? 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Text size={200} className={s.muted}>
          Committed is what quotas promise (desks, caches, team rooms) and what admitted work holds for scratch; used is what was measured.
        </Text>
      </section>

      <BudgetForm key={b.version} budget={b} onSaved={summary.set} onLoadLatest={() => void summary.reload()} />
      <Text size={200} className={s.muted}>
        Data as of {when(r.asOf)}.
      </Text>
    </div>
  );
}
