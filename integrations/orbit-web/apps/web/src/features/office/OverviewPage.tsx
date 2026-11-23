// THE OFFICE, at a glance: its employees as cards grouped by department -- each with its work label in words, what it
// holds and how much waits behind it, why it is not ready, a warning about its connection -- filtered by department
// (or Unassigned), a search and a work label. From here a person assigns work, hires (once an AI CLI is connected) and
// shapes the departments. An account with no office yet is offered one, with example departments it may skip.
import { Button, Checkbox, Field, Input, Link, MessageBar, MessageBarBody, SearchBox, Select, Spinner, Text, makeStyles, mergeClasses, shorthands, tokens, useRestoreFocusTarget } from "@fluentui/react-components";
import { Add16Regular, Dismiss16Regular, Filter20Regular, PersonAdd20Regular, PlugDisconnected16Regular, TaskListLtr20Regular } from "@fluentui/react-icons";
import { WORK_LABELS, WORK_LABEL_TEXT, type AuthAccount, type Department, type EmployeeCard, type Roster, type WorkLabel } from "@orbit-web/contracts";
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
import { useConnections } from "../connections/AiConnectionsSection";
import { office, useOfficeRead, type RosterQuery } from "./api";
import { AssignDialog } from "./AssignDialog";
import { DepartmentDialog, type DepartmentEdit } from "./DepartmentDialogs";
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
  exampleTile: {
    paddingTop: "6px",
    paddingRight: "12px",
    paddingBottom: "6px",
    paddingLeft: "8px",
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
});

const EXAMPLES = ["Accounting", "Legal", "Sales"] as const;

function SetUpOffice({ account, onDone }: { account: AuthAccount | null; onDone: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const [name, setName] = useState(account?.companyName || t("office.overview.defaultOfficeName"));
  const [examples, setExamples] = useState<Record<string, boolean>>({ Accounting: true, Legal: true, Sales: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await office.setUp({ name: name.trim() || t("office.overview.defaultOfficeName"), departments: EXAMPLES.filter((d) => examples[d]) });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.setupWrap}>
      <form
        className={o.heroCard}
        aria-label={t("office.overview.setupAria")}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className={o.row}>
          <IconBadge icon={<OfficeIcon size={22} active />} tone="brand" size="lg" />
          <div className={o.stack}>
            <Text weight="semibold" size={500} as="h2">
              {t("office.overview.setupTitle")}
            </Text>
            <Text size={200} className={o.muted}>
              {t("office.overview.setupLead")}
            </Text>
          </div>
        </div>
        <div className={o.divider} />
        <Field label={t("office.overview.officeNameLabel")}>
          <Input value={name} maxLength={80} onChange={(_, d) => setName(d.value)} />
        </Field>
        <div role="group" aria-label={t("office.overview.exampleDeptsGroup")} className={o.stack}>
          <Text weight="semibold" size={300}>
            {t("office.overview.exampleDeptsGroup")}
          </Text>
          <div className={o.row}>
            {EXAMPLES.map((d) => (
              <span key={d} className={s.exampleTile}>
                <Checkbox label={d} checked={examples[d] === true} onChange={(_, c) => setExamples((x) => ({ ...x, [d]: c.checked === true }))} />
              </span>
            ))}
          </div>
          <Text size={200} className={o.muted}>
            {t("office.overview.exampleDeptsHint")}
          </Text>
        </div>
        {error && (
          <MessageBar intent="error">
            <MessageBarBody>{error}</MessageBarBody>
          </MessageBar>
        )}
        <div className={o.row}>
          <Button appearance="primary" type="submit" disabled={busy}>
            {busy ? t("office.overview.settingUp") : t("office.overview.setupSubmit")}
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

function groupsOf(roster: Roster, employees: EmployeeCard[], filter: string): Group[] {
  const live = [...roster.departments].filter((d) => !d.archived).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
  const groups: Group[] = live.map((d) => ({ department: d, employees: employees.filter((e) => e.departmentId === d.id) }));
  const known = new Set(live.map((d) => d.id));
  groups.push({ department: null, employees: employees.filter((e) => e.departmentId === null || !known.has(e.departmentId)) });
  if (filter === "none") return groups.filter((g) => g.department === null);
  if (filter !== "all") return groups.filter((g) => g.department?.id === filter);
  return groups.filter((g) => g.department !== null || g.employees.length > 0);
}

// The unified company floor for one read of the roster, and any extra pages brought by "Load more".
function RosterBody({ roster, filter, query, account, go, onAssign, onEdit }: { roster: Roster; filter: string; query: RosterQuery; account: AuthAccount | null; go: Go; onAssign: (id: string) => void; onEdit: (e: DepartmentEdit) => void }) {
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
        <SetUpOffice account={account} onDone={() => void roster.reload()} />
      </div>
    );
  const live = r.departments.filter((d) => !d.archived);
  const filtered = department !== "all" || status !== "all" || typed !== "";
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
      <RosterBody key={`${r.asOf}:${r.version}`} roster={r} filter={department} query={query} account={account} go={go} onAssign={(id) => setAssigning({ employeeId: id })} onEdit={setEditing} />
      {hiring && (
        <HireWizard
          departments={r.departments}
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
    </div>
  );
}
