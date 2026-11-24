// THE OFFICE, at a glance: its employees as cards grouped by department -- each with its work label in words, what it
// holds and how much waits behind it, why it is not ready, a warning about its connection -- filtered by department
// (or Unassigned), a search and a work label. From here a person assigns work, hires (once an AI CLI is connected) and
// shapes the departments: who leads the company (its CEO, each department's manager) and the execution defaults an
// employee may leave its model and effort to. An account with no company yet is offered to activate it -- empty -- once
// an AI connection of its own can be used.
import { Button, Field, Input, Link, MenuItem, MessageBar, MessageBarBody, SearchBox, Select, Spinner, Text, makeStyles, mergeClasses, shorthands, tokens, useRestoreFocusTarget } from "@fluentui/react-components";
import { Add16Regular, Dismiss16Regular, Filter20Regular, Options16Regular, Organization16Regular, PersonAdd20Regular, PlugDisconnected16Regular, TaskListLtr20Regular } from "@fluentui/react-icons";
import { AUTH_STATE_TEXT, RUNTIME_KINDS, RUNTIME_LABELS, WORK_LABELS, WORK_LABEL_TEXT, type AuthAccount, type Department, type EmployeeCard, type ExecutionDefaults, type Roster, type WorkLabel } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { ResponsiveSheet } from "../../components/ResponsiveSheet";
import {
  IconBadge,
  InboxActionIcon,
  NotReadyIcon,
  OfficeIcon,
  QueuedIcon,
  ReadyIcon,
  RosterIcon,
  WorkingIcon,
} from "../../components/SectionIcons";
import { settingsHref, type OfficePage } from "../../hooks/useHashRoute";
import { useViewport } from "../../hooks/useViewport";
import { useI18n } from "../../i18n";
import { errorText } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { useConnections } from "../connections/AiConnectionsSection";
import { office, useOfficeRead, type RosterQuery } from "./api";
import { AppointmentDialog, AppointmentHolder, AppointmentMenu, type AppointmentEdit } from "./AppointmentDialogs";
import { AssignDialog } from "./AssignDialog";
import { DefaultsDialog, DepartmentDialog, type DefaultsTarget, type DepartmentEdit } from "./DepartmentDialogs";
import { HireWizard } from "./HireWizard";
import { AsOf, Callout, EmptyState, useOfficeStyles } from "./parts";
import { OfficeFloorMap } from "./OfficeFloorMap";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

const useStyles = makeStyles({
  setupWrap: { maxWidth: "600px", width: "100%", marginLeft: "auto", marginRight: "auto", marginTop: "8px" },
  setupEmblem: {
    width: "44px",
    height: "44px",
    borderRadius: "12px",
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  useList: { listStyleType: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" },
  useItem: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    paddingTop: "8px",
    paddingRight: "12px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    borderRadius: "10px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
  },
  statValue: { fontVariantNumeric: "tabular-nums", lineHeight: "1.15" },
  statReady: { color: tokens.colorPaletteGreenForeground1 },
  statBusy: { color: tokens.colorBrandForeground1 },
  statDanger: { color: tokens.colorPaletteRedForeground1 },
  statWarn: { color: tokens.colorPaletteDarkOrangeForeground1 },
  statInboxAlert: {
    backgroundColor: tokens.colorPaletteDarkOrangeBackground1,
    ...shorthands.borderColor(tokens.colorPaletteDarkOrangeBorder1),
  },
  statActive: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    backgroundColor: tokens.colorSubtleBackgroundSelected,
  },
  filterBar: {
    display: "flex",
    alignItems: "flex-end",
    gap: "10px",
    flexWrap: "wrap",
    minWidth: 0,
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    borderRadius: "14px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
  search: { flexGrow: 1, minWidth: "min(100%, 220px)", maxWidth: "380px" },
  // On a phone: the search takes the row, the Filters button keeps its own width.
  toolbarMobile: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center" },
  searchMobile: { width: "100%", minWidth: 0, maxWidth: "100%" },
  select: { minWidth: "min(100%, 185px)" },
  leadHead: { display: "flex", alignItems: "center", gap: "10px", minWidth: 0 },
  // One slot per cell: several to a row on a wide screen, one on a phone -- a long name wraps, never the page.
  leadList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 250px), 1fr))",
    gap: "8px",
    listStyleType: "none",
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    paddingLeft: 0,
    minWidth: 0,
  },
  leadRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    paddingTop: "8px",
    paddingRight: "8px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
  },
  leadWho: { display: "flex", flexDirection: "column", gap: "2px", flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" },
});

// The three uses a connection is read for, in the order a card says them.
const USES = ["chat", "research", "employee"] as const;
const USE_KEYS = { chat: "office.overview.activate.useChat", research: "office.overview.activate.useResearch", employee: "office.overview.activate.useEmployee" } as const;

// ACTIVATING THE COMPANY (ADR 0061 §8): the company starts EMPTY -- no department, employee, mission or CEO -- and is
// activated only once one AI connection of this account can be used for chat, research or an employee. What each
// connection can be used for is the server's answer (uses), shown as it says it; a use its runtime does not have is left
// out. The way to connect one is a link away, and the card reads the connections again when they change.
function ActivateCompany({ account, onDone }: { account: AuthAccount | null; onDone: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const connections = useConnections();
  useAppEvent("connections.changed", () => void connections.reload());
  const [name, setName] = useState(account?.companyName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = connections.data;
  const activation = view?.activation ?? null;
  const ready = activation?.ready === true && name.trim() !== "";
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await office.setUp({ name: name.trim() });
      onDone();
    } catch (err) {
      setError(errorText(err));
      void connections.reload();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.setupWrap}>
      <form
        className={o.heroCard}
        aria-label={t("office.overview.activate.aria")}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void save();
        }}
      >
        <div className={o.row}>
          <IconBadge icon={<OfficeIcon size={22} active />} tone="brand" size="lg" />
          <div className={o.stack}>
            <Text weight="semibold" size={500} as="h2">
              {t("office.overview.activate.title")}
            </Text>
            <Text size={200} className={o.muted}>
              {t("office.overview.activate.lead")}
            </Text>
          </div>
        </div>
        <div className={o.divider} />
        <Field label={t("office.overview.activate.nameLabel")} hint={t("office.overview.activate.nameHint")}>
          <Input value={name} maxLength={80} onChange={(_, d) => setName(d.value)} />
        </Field>
        <section aria-label={t("office.overview.activate.connectionsAria")} className={o.stack}>
          <Text weight="semibold" size={300}>
            {t("office.overview.activate.connectionsTitle")}
          </Text>
          {view === null ? (
            <Spinner size="tiny" label={t("office.overview.checkingConnections")} />
          ) : view.connections.length === 0 ? (
            <Text size={200} className={o.muted}>
              {t("office.overview.activate.noConnection")}
            </Text>
          ) : (
            <ul className={s.useList}>
              {view.connections.map((c) => {
                const shown = USES.filter((u) => c.uses[u].reasonCode !== "runtime_not_supported");
                return (
                  <li key={c.id} className={s.useItem} aria-label={c.label}>
                    <Text weight="semibold" size={200}>
                      {c.label} · {RUNTIME_LABELS[c.runtime]} · {AUTH_STATE_TEXT[c.auth]}
                    </Text>
                    {shown.length === 0 ? (
                      <Text size={200} className={o.muted}>
                        {t("office.overview.activate.runsNothing", { runtime: RUNTIME_LABELS[c.runtime] })}
                      </Text>
                    ) : (
                      shown.map((u) => (
                        <Text key={u} size={200} className={c.uses[u].ready ? undefined : o.muted}>
                          {c.uses[u].ready ? t("office.overview.activate.usable", { use: t(USE_KEYS[u]) }) : t("office.overview.activate.notUsable", { use: t(USE_KEYS[u]), reason: c.uses[u].reason ?? "" })}
                        </Text>
                      ))
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <Link href={settingsHref("ai-connections")}>{t("office.overview.openAiConnections")}</Link>
        </section>
        {activation !== null && !activation.ready && (
          <Callout tone="warn" icon={<PlugDisconnected16Regular />} role="status">
            {activation.reason}
          </Callout>
        )}
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        <div className={o.row}>
          <Button appearance="primary" type="submit" disabled={busy || !ready}>
            {busy ? t("office.overview.activate.activating") : t("office.overview.activate.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}

interface Group {
  department: Department | null;
  employees: EmployeeCard[];
}

// The departments not archived, in the order the office shows them.
const liveDepartments = (departments: Department[]): Department[] => departments.filter((d) => !d.archived).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

function groupsOf(roster: Roster, employees: EmployeeCard[], filter: string): Group[] {
  const live = liveDepartments(roster.departments);
  const groups: Group[] = live.map((d) => ({ department: d, employees: employees.filter((e) => e.departmentId === d.id) }));
  const known = new Set(live.map((d) => d.id));
  groups.push({ department: null, employees: employees.filter((e) => e.departmentId === null || !known.has(e.departmentId)) });
  if (filter === "none") return groups.filter((g) => g.department === null);
  if (filter !== "all") return groups.filter((g) => g.department?.id === filter);
  return groups.filter((g) => g.department !== null || g.employees.length > 0);
}

// The runtimes a department's defaults say something for.
const defaultsSetFor = (d: ExecutionDefaults): string[] => RUNTIME_KINDS.filter((r) => Object.keys(d[r] ?? {}).length > 0).map((r) => RUNTIME_LABELS[r]);

// LEADERSHIP, compactly: the company's CEO and each department's manager -- or that there is none, which a company may
// well be -- each with what a person may do about it. Read from the roster the page already holds.
function Leadership({ roster, go, onAppointment, onDefaults }: { roster: Roster; go: Go; onAppointment: (edit: AppointmentEdit) => void; onDefaults: (department: Department) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  return (
    <section className={o.card} aria-label={t("office.leadership.title")}>
      <div className={s.leadHead}>
        <IconBadge icon={<Organization16Regular />} tone="brand" size="md" />
        <div className={o.stack} style={{ gap: "2px" }}>
          <Text weight="semibold" size={400} as="h3">
            {t("office.leadership.title")}
          </Text>
          <Text size={200} className={o.muted}>
            {t("office.leadership.sub")}
          </Text>
        </div>
      </div>
      <ul className={s.leadList} aria-label={t("office.leadership.listAria")}>
        <li className={s.leadRow} aria-label={t("office.leadership.ceo")}>
          <div className={s.leadWho}>
            <Text size={200} weight="semibold">
              {t("office.leadership.ceo")}
            </Text>
            {roster.ceo ? (
              <AppointmentHolder who={roster.ceo} stateAlways onOpen={(id) => go("employee", id)} />
            ) : (
              <Text size={200} className={o.muted}>
                {t("office.leadership.noCeo")}
              </Text>
            )}
          </div>
          <AppointmentMenu slot={{ role: "ceo", incumbent: roster.ceo ?? null }} label={t("office.leadership.ceoActions")} onPick={onAppointment} />
        </li>
        {liveDepartments(roster.departments).map((d) => {
          const defaults = defaultsSetFor(d.defaults ?? {});
          return (
            <li key={d.id} className={s.leadRow} aria-label={d.name}>
              <div className={s.leadWho}>
                <Text size={200} weight="semibold">
                  {d.name}
                </Text>
                {d.manager ? (
                  <AppointmentHolder who={d.manager} prefix={`${t("office.leadership.managerLabel")} `} onOpen={(id) => go("employee", id)} />
                ) : (
                  <Text size={200} className={o.muted}>
                    {t("office.leadership.noManager")}
                  </Text>
                )}
                {defaults.length > 0 && (
                  <Text size={100} className={o.muted}>
                    {t("office.leadership.defaultsSet", { runtimes: defaults.join(", ") })}
                  </Text>
                )}
              </div>
              <AppointmentMenu slot={{ role: "manager", department: d, incumbent: d.manager ?? null }} label={t("office.leadership.departmentActions", { name: d.name })} onPick={onAppointment}>
                <MenuItem onClick={() => onDefaults(d)}>{t("office.leadership.defaults")}</MenuItem>
              </AppointmentMenu>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// The unified company floor for one read of the roster, and any extra pages brought by "Load more".
// `onAppointment`: the floor's appointment actions open the Overview's own dialog, which outlives a re-read roster.
function RosterBody({ roster, filter, query, account, go, onAssign, onEdit, onAppointment }: { roster: Roster; filter: string; query: RosterQuery; account: AuthAccount | null; go: Go; onAssign: (id: string) => void; onEdit: (e: DepartmentEdit) => void; onAppointment: (edit: AppointmentEdit) => void }) {
  const { t } = useI18n();
  const [more, setMore] = useState<EmployeeCard[]>([]);
  const [cursor, setCursor] = useState(roster.nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const employees = [...roster.employees, ...more.filter((m) => !roster.employees.some((e) => e.id === m.id))];
  const loadMore = async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await office.roster({ ...query, cursor });
      setMore((m) => [...m, ...next.employees]);
      setCursor(next.nextCursor);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };
  const groups = groupsOf(roster, employees, filter);
  if (groups.length === 0) {
    return <EmptyState icon={<RosterIcon size={22} />} tone="brand" title={t("office.overview.emptyTitle")} body={t("office.overview.emptyBody")} />;
  }
  return (
    <>
      <OfficeFloorMap
        groups={groups}
        filter={filter}
        account={account}
        onAssign={onAssign}
        onOpenEmployee={(id) => go("employee", id)}
        onOpenMission={(id) => go("mission", id)}
        onEditDepartment={onEdit}
        onAppointment={onAppointment}
      />
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {cursor !== null && (
        <div>
          <Button disabled={loading} onClick={() => void loadMore()}>
            {loading ? t("office.overview.loading") : t("office.overview.loadMore")}
          </Button>
        </div>
      )}
    </>
  );
}

export function OverviewPage({ go, account }: { go: Go; account: AuthAccount | null }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const { isMobile } = useViewport();
  const [department, setDepartment] = useState("all");
  const [typed, setTyped] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<WorkLabel | "all">("all");
  const [hiring, setHiring] = useState(false);
  const [assigning, setAssigning] = useState<{ employeeId: string | null } | null>(null);
  const [editing, setEditing] = useState<DepartmentEdit | null>(null);
  const [appointing, setAppointing] = useState<AppointmentEdit | null>(null);
  const [defaultsOf, setDefaultsOf] = useState<DefaultsTarget | null>(null);
  const [filters, setFilters] = useState(false);
  const restore = useRestoreFocusTarget();
  // A search is asked once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setQ(typed), 250);
    return () => clearTimeout(t);
  }, [typed]);
  const query: RosterQuery = { department: department === "all" ? null : department, q, status: status === "all" ? null : status };
  const roster = useOfficeRead<Roster>(() => office.roster(query), [department, q, status], ["roster", "connections", "inbox"]);
  const connections = useConnections();
  const canHire = connections.data?.canHire === true;

  if (roster.data === null)
    return roster.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{roster.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner label={t("office.overview.readingOffice")} />
    );
  const r = roster.data;
  if (r.office === null)
    return (
      <div className={o.page}>
        <ActivateCompany account={account} onDone={() => void roster.reload()} />
      </div>
    );
  const company = r.office;
  const live = r.departments.filter((d) => !d.archived);
  const filtered = department !== "all" || status !== "all" || typed !== "";
  // After a change of who leads or of a default, the roster is read again (its slots and defaults are in it).
  const changed = () => {
    setAppointing(null);
    setDefaultsOf(null);
    void roster.reload();
  };
  const clearFilters = () => {
    setDepartment("all");
    setStatus("all");
    setTyped("");
    setQ("");
  };
  const pickers = (
    <>
      <Field label={t("office.overview.departmentLabel")} className={s.select}>
        <Select value={department} onChange={(_, d) => setDepartment(d.value)}>
          <option value="all">{t("office.overview.allDepartments")}</option>
          {live.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
          <option value="none">{t("office.overview.unassigned")}</option>
        </Select>
      </Field>
      <Field label={t("office.overview.statusLabel")} className={s.select}>
        <Select value={status} onChange={(_, d) => setStatus(d.value as WorkLabel | "all")}>
          <option value="all">{t("office.overview.anyStatus")}</option>
          {WORK_LABELS.map((l) => (
            <option key={l} value={l}>
              {WORK_LABEL_TEXT[l]}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );
  const c = r.counts;
  return (
    <div className={o.page}>
      <section className={o.heroCard} aria-label={r.office.name}>
        <div className={o.between}>
          <div className={o.stack}>
            <Text weight="semibold" size={600} as="h2">
              {r.office.name}
            </Text>
            <Text size={200} className={o.muted}>
              {t("office.overview.summaryLine", {
                employees: c.employees,
                employeeWord: c.employees === 1 ? t("office.overview.employeeOne") : t("office.overview.employeeMany"),
                ready: c.ready,
                busy: c.busy,
                notReady: c.notReady,
                queued: c.queued,
              })}
              <Link as="button" onClick={() => go("inbox")}>
                {t("office.overview.needYou", { count: c.inbox })}
              </Link>
            </Text>
            <AsOf at={r.asOf} />
          </div>
          <div className={o.row}>
            <Button className={o.touch} appearance="primary" icon={<PersonAdd20Regular />} disabled={!canHire} onClick={() => setHiring(true)} {...restore}>
              {t("office.overview.hireEmployee")}
            </Button>
            <Button className={o.touch} icon={<TaskListLtr20Regular />} disabled={r.employees.length === 0} onClick={() => setAssigning({ employeeId: null })} {...restore}>
              {t("office.overview.assignWork")}
            </Button>
            <Button className={o.touch} icon={<Add16Regular />} onClick={() => setEditing({ kind: "new" })} {...restore}>
              {t("office.overview.newDepartment")}
            </Button>
            <Button className={o.touch} icon={<Options16Regular />} onClick={() => setDefaultsOf({ kind: "company", office: company })} {...restore}>
              {t("office.overview.companyDefaults")}
            </Button>
          </div>
        </div>
        <div className={o.statGrid}>
          <button type="button" className={mergeClasses(o.statCard, o.statCardAction)} onClick={clearFilters}>
            <div className={o.between} style={{ flexWrap: "nowrap", width: "100%" }}>
              <Text size={200} className={o.muted}>
                {t("office.overview.statTotalRoster")}
              </Text>
              <IconBadge icon={<RosterIcon size={14} />} tone="brand" size="sm" />
            </div>
            <Text size={600} weight="semibold" className={s.statValue}>
              {c.employees}
            </Text>
          </button>
          <button type="button" aria-pressed={status === "ready"} className={mergeClasses(o.statCard, o.statCardAction, status === "ready" && s.statActive)} onClick={() => setStatus((cur) => (cur === "ready" ? "all" : "ready"))}>
            <div className={o.between} style={{ flexWrap: "nowrap", width: "100%" }}>
              <Text size={200} className={o.muted}>
                {t("office.overview.statReady")}
              </Text>
              <IconBadge icon={<ReadyIcon size={14} />} tone={c.ready > 0 ? "success" : "neutral"} size="sm" />
            </div>
            <Text size={600} weight="semibold" className={mergeClasses(s.statValue, c.ready > 0 && s.statReady)}>
              {c.ready}
            </Text>
          </button>
          <button type="button" aria-pressed={status === "working"} className={mergeClasses(o.statCard, o.statCardAction, status === "working" && s.statActive)} onClick={() => setStatus((cur) => (cur === "working" ? "all" : "working"))}>
            <div className={o.between} style={{ flexWrap: "nowrap", width: "100%" }}>
              <Text size={200} className={o.muted}>
                {t("office.overview.statWorking")}
              </Text>
              <IconBadge icon={<WorkingIcon size={14} />} tone={c.busy > 0 ? "brand" : "neutral"} size="sm" />
            </div>
            <Text size={600} weight="semibold" className={mergeClasses(s.statValue, c.busy > 0 && s.statBusy)}>
              {c.busy}
            </Text>
          </button>
          <button type="button" className={mergeClasses(o.statCard, o.statCardAction)} onClick={() => go("work")}>
            <div className={o.between} style={{ flexWrap: "nowrap", width: "100%" }}>
              <Text size={200} className={o.muted}>
                {t("office.overview.statQueued")}
              </Text>
              <IconBadge icon={<QueuedIcon size={14} />} tone="neutral" size="sm" />
            </div>
            <Text size={600} weight="semibold" className={s.statValue}>
              {c.queued}
            </Text>
          </button>
          <button type="button" aria-pressed={status === "not_ready"} className={mergeClasses(o.statCard, o.statCardAction, status === "not_ready" && s.statActive)} onClick={() => setStatus((cur) => (cur === "not_ready" ? "all" : "not_ready"))}>
            <div className={o.between} style={{ flexWrap: "nowrap", width: "100%" }}>
              <Text size={200} className={o.muted}>
                {t("office.overview.statNotReady")}
              </Text>
              <IconBadge icon={<NotReadyIcon size={14} />} tone={c.notReady > 0 ? "danger" : "neutral"} size="sm" />
            </div>
            <Text size={600} weight="semibold" className={mergeClasses(s.statValue, c.notReady > 0 && s.statDanger)}>
              {c.notReady}
            </Text>
          </button>
          <button type="button" className={mergeClasses(o.statCard, o.statCardAction, c.inbox > 0 && s.statInboxAlert)} onClick={() => go("inbox")} aria-label={t("office.overview.openNeedsMeAria", { count: c.inbox })}>
            <div className={o.between} style={{ flexWrap: "nowrap", width: "100%" }}>
              <Text size={200} className={c.inbox > 0 ? s.statWarn : o.muted}>
                {t("office.overview.statNeedsYou")}
              </Text>
              <IconBadge icon={<InboxActionIcon size={14} />} tone={c.inbox > 0 ? "warning" : "neutral"} size="sm" />
            </div>
            <Text size={600} weight="semibold" className={mergeClasses(s.statValue, c.inbox > 0 && s.statWarn)}>
              {c.inbox}
            </Text>
          </button>
        </div>
      </section>
      {!canHire && (
        <Callout tone={connections.data === null ? "info" : "warn"} icon={<PlugDisconnected16Regular />} role="status">
          {connections.data === null ? t("office.overview.checkingConnections") : t("office.overview.connectCliFirst")}
          {connections.data !== null && <Link href={settingsHref("ai-connections")}>{t("office.overview.openAiConnections")}</Link>}
        </Callout>
      )}
      <Leadership roster={r} go={go} onAppointment={setAppointing} onDefaults={(d) => setDefaultsOf({ kind: "department", department: d, company: company.defaults ?? {} })} />
      <div className={mergeClasses(s.filterBar, isMobile && s.toolbarMobile)}>
        {isMobile ? (
          <>
            <SearchBox className={mergeClasses(s.search, s.searchMobile)} placeholder={t("office.overview.searchPlaceholder")} aria-label={t("office.overview.searchPlaceholder")} value={typed} onChange={(_, d) => setTyped(d.value)} />
            <Button className={o.touch} icon={<Filter20Regular />} onClick={() => setFilters(true)}>
              {t("office.overview.filtersBtn", { on: department !== "all" || status !== "all" ? t("office.overview.filtersOn") : "" })}
            </Button>
          </>
        ) : (
          <>
            <Field label={t("office.overview.searchLabel")} className={s.search}>
              <SearchBox style={{ width: "100%" }} placeholder={t("office.overview.searchPlaceholder")} aria-label={t("office.overview.searchPlaceholder")} value={typed} onChange={(_, d) => setTyped(d.value)} />
            </Field>
            {pickers}
            {filtered && (
              <Button appearance="subtle" icon={<Dismiss16Regular />} onClick={clearFilters}>
                {t("office.overview.clear")}
              </Button>
            )}
          </>
        )}
      </div>
      {isMobile && (
        <ResponsiveSheet open={filters} onOpenChange={setFilters} title={t("office.overview.filtersSheetTitle")}>
          <div className={mergeClasses(o.form, "orbit-touch")}>
            {pickers}
            {filtered && (
              <Button appearance="subtle" icon={<Dismiss16Regular />} onClick={() => { clearFilters(); setFilters(false); }}>
                {t("office.overview.clearFilters")}
              </Button>
            )}
          </div>
        </ResponsiveSheet>
      )}
      <RosterBody key={`${r.asOf}:${r.version}`} roster={r} filter={department} query={query} account={account} go={go} onAssign={(id) => setAssigning({ employeeId: id })} onEdit={setEditing} onAppointment={setAppointing} />
      {hiring && (
        <HireWizard
          departments={r.departments}
          companyDefaults={company.defaults ?? {}}
          onClose={() => setHiring(false)}
          onHired={(e) => {
            setHiring(false);
            go("employee", e.id);
          }}
        />
      )}
      {assigning && <AssignDialog employees={r.employees} employeeId={assigning.employeeId} onClose={() => setAssigning(null)} onOpenMission={(id) => go("mission", id)} />}
      {editing && (
        <DepartmentDialog
          edit={editing}
          departments={r.departments}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void roster.reload();
          }}
        />
      )}
      {appointing && <AppointmentDialog edit={appointing} onClose={() => setAppointing(null)} onDone={changed} />}
      {defaultsOf && <DefaultsDialog target={defaultsOf} onClose={() => setDefaultsOf(null)} onDone={changed} />}
    </div>
  );
}
