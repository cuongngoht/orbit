// THE OFFICE, at a glance: its employees as cards grouped by department -- each with its work label in words, what it
// holds and how much waits behind it, why it is not ready, a warning about its connection -- filtered by department
// (or Unassigned), a search and a work label. From here a person assigns work, hires (once an AI CLI is connected) and
// shapes the departments: who leads the company (its CEO, each department's manager) and the execution defaults an
// employee may leave its model and effort to. An account with no company yet is offered to activate it -- empty -- once
// an AI connection of its own can be used.
import { Button, Field, Input, Link, Menu, MenuDivider, MenuGroup, MenuGroupHeader, MenuItem, MenuList, MenuPopover, MenuTrigger, MessageBar, MessageBarBody, SearchBox, Select, Spinner, Text, makeStyles, mergeClasses, shorthands, tokens, useRestoreFocusTarget } from "@fluentui/react-components";
import { Add16Regular, ChevronDown12Regular, ChevronDown16Regular, Dismiss16Regular, Filter20Regular, Options16Regular, Organization16Regular, PeopleAdd20Regular, PersonAdd20Regular, PersonStar20Regular, PlugDisconnected16Regular, Settings16Regular, Sparkle16Regular, TaskListLtr20Regular } from "@fluentui/react-icons";
import { AUTH_STATE_TEXT, RUNTIME_KINDS, RUNTIME_LABELS, WORK_LABELS, WORK_LABEL_TEXT, type AppointmentSummary, type AuthAccount, type Department, type EmployeeCard, type ExecutionDefaults, type ResourceSummary, type Roster, type WorkLabel } from "@orbit-web/contracts";
import { useEffect, useRef, useState } from "react";
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
import { useExecutiveState } from "../executive/api";
import { useResourceSummary } from "../resources/ComputeStorageSection";
import { office, useOfficeRead, type RosterQuery } from "./api";
import { AppointmentDialog, AppointmentHolder, AppointmentMenu, type AppointmentEdit } from "./AppointmentDialogs";
import { AssignDialog } from "./AssignDialog";
import { DefaultsDialog, DepartmentDialog, type DefaultsTarget, type DepartmentEdit } from "./DepartmentDialogs";
import { accentForDepartment, useFloorPrefs, type AvatarCustomization, type FloorPrefs } from "./floorPrefs";
import { HireWizard } from "./HireWizard";
import { ModelSwitcherDialog, type ModelSwitcherTarget } from "./ModelSwitcherDialog";
import { QuickReviewSheet } from "./QuickReviewSheet";
import { RecruitDialog } from "./RecruitDialog";
import { AsOf, Callout, EmployeeAvatar, EmptyState, WorkLabelBadge, useOfficeStyles } from "./parts";
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
  statValue: { fontVariantNumeric: "tabular-nums", lineHeight: "1.15", flexShrink: 0 },
  statLabelWrap: { display: "flex", alignItems: "center", gap: "6px", flex: "1 1 0", minWidth: 0, overflow: "hidden" },
  statLabel: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 },
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
    boxShadow: `inset 0 0 0 1px ${tokens.colorBrandStroke2}`,
  },
  heroHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    minWidth: 0,
  },
  heroActions: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    flexWrap: "wrap",
    minWidth: 0,
  },
  secondaryActionBtn: {
    color: tokens.colorNeutralForeground2,
    paddingLeft: "8px",
    paddingRight: "8px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    ":hover": {
      color: tokens.colorNeutralForeground1,
      backgroundColor: tokens.colorNeutralBackground1Hover,
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
    },
  },
  filterBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    flexWrap: "wrap",
    minWidth: 0,
    paddingTop: "7px",
    paddingRight: "10px",
    paddingBottom: "7px",
    paddingLeft: "10px",
    borderRadius: "14px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    boxShadow: "0 1px 2px rgba(28, 25, 23, 0.03)",
  },
  search: { flexGrow: 1, flexBasis: "200px", minWidth: "min(100%, 200px)" },
  // On a phone: search takes the full first row, floor/list toggle and Filters share the second row.
  toolbarMobile: { display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", alignItems: "center", gap: "8px" },
  searchMobile: { gridColumn: "1 / -1", width: "100%", minWidth: 0, maxWidth: "100%", flexBasis: "auto" },
  select: { minWidth: "min(100%, 158px)" },
  viewToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    paddingTop: "2px",
    paddingRight: "2px",
    paddingBottom: "2px",
    paddingLeft: "2px",
    borderRadius: "10px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    flexShrink: 0,
  },
  viewBtn: { borderRadius: "8px", minHeight: "28px" },
  viewBtnOn: {
    backgroundColor: "var(--orbit-card-bg)",
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
    boxShadow: "0 1px 2px rgba(28, 25, 23, 0.08)",
  },
  listCard: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "14px",
    paddingLeft: "14px",
    borderRadius: "16px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "var(--orbit-soft-shadow)",
    minWidth: 0,
  },
  listHeadRow: {
    display: "grid",
    gridTemplateColumns: "minmax(200px, 1.4fr) minmax(130px, 0.85fr) minmax(105px, 0.65fr) minmax(160px, 1.2fr) 176px",
    alignItems: "center",
    gap: "12px",
    paddingTop: "2px",
    paddingRight: "13px",
    paddingBottom: "6px",
    paddingLeft: "13px",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    fontSize: "11px",
    fontWeight: 600,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    color: tokens.colorNeutralForeground3,
    "@media (max-width: 900px)": { display: "none" },
  },
  listRows: { listStyleType: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 },
  listRow: {
    display: "grid",
    gridTemplateColumns: "minmax(200px, 1.4fr) minmax(130px, 0.85fr) minmax(105px, 0.65fr) minmax(160px, 1.2fr) 176px",
    alignItems: "center",
    gap: "12px",
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    transitionProperty: "background-color, border-color, box-shadow",
    transitionDuration: "140ms",
    minWidth: 0,
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
    },
    "@media (max-width: 900px)": { gridTemplateColumns: "1fr", alignItems: "start" },
  },
  deptPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    paddingTop: "2px",
    paddingRight: "9px",
    paddingBottom: "2px",
    paddingLeft: "8px",
    borderRadius: "9999px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    width: "fit-content",
    maxWidth: "100%",
  },
  deptDot: { width: "7px", height: "7px", borderRadius: "9999px", flexShrink: 0 },
  leadHead: { display: "flex", alignItems: "center", gap: "10px", minWidth: 0 },
  // One slot per cell: several to a row on a wide screen, even columns on tablet, one on a phone.
  leadList: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
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
    gap: "10px",
    paddingTop: "10px",
    paddingRight: "10px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
  },
  leadVacantBadge: {
    width: "30px",
    height: "30px",
    borderRadius: "10px",
    ...shorthands.border("1px", "dashed", tokens.colorNeutralStroke1),
    backgroundColor: "var(--orbit-card-bg)",
    color: tokens.colorNeutralForeground3,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
    fontWeight: 600,
    flexShrink: 0,
  },
  leadTitleRow: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
  },
  leadWho: { display: "flex", flexDirection: "column", gap: "2px", flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" },
  listModelChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    width: "fit-content",
    marginTop: "2px",
    paddingTop: "1px",
    paddingRight: "7px",
    paddingBottom: "1px",
    paddingLeft: "6px",
    borderRadius: "9999px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground2,
    fontFamily: "inherit",
    fontSize: "11px",
    fontWeight: tokens.fontWeightMedium,
    cursor: "pointer",
    transitionProperty: "background-color, border-color, color",
    transitionDuration: "120ms",
    ":hover": {
      backgroundColor: tokens.colorBrandBackground2,
      ...shorthands.borderColor(tokens.colorBrandStroke2),
      color: tokens.colorBrandForeground1,
    },
  },
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

const isCeoEmployee = (e: EmployeeCard, ceo: AppointmentSummary | null): boolean =>
  e.role === "ceo" || (ceo !== null && e.id === ceo.employeeId);

// The departments not archived, in the order the office shows them.
const liveDepartments = (departments: Department[]): Department[] => departments.filter((d) => !d.archived).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

function groupsOf(roster: Roster, employees: EmployeeCard[], filter: string): Group[] {
  const live = liveDepartments(roster.departments);
  const floorEmployees = employees.filter((e) => !isCeoEmployee(e, roster.ceo));
  const groups: Group[] = live.map((d) => ({ department: d, employees: floorEmployees.filter((e) => e.departmentId === d.id) }));
  const known = new Set(live.map((d) => d.id));
  groups.push({ department: null, employees: floorEmployees.filter((e) => e.departmentId === null || !known.has(e.departmentId)) });
  if (filter === "none") return groups.filter((g) => g.department === null);
  if (filter !== "all") return groups.filter((g) => g.department?.id === filter);
  return groups.filter((g) => g.department !== null || g.employees.length > 0);
}

// The runtimes a department's defaults say something for.
const defaultsSetFor = (d: ExecutionDefaults): string[] => RUNTIME_KINDS.filter((r) => Object.keys(d[r] ?? {}).length > 0).map((r) => RUNTIME_LABELS[r]);

// LEADERSHIP, compactly: the company's CEO and each department's manager -- or that there is none, which a company may
// well be -- each with what a person may do about it. Read from the roster the page already holds.
function Leadership({ roster, prefs, canHire, go, onAppointment, onDefaults, onHireCeo }: { roster: Roster; prefs: FloorPrefs; canHire: boolean; go: Go; onAppointment: (edit: AppointmentEdit) => void; onDefaults: (department: Department) => void; onHireCeo: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  return (
    <section id="office-leadership" className={o.card} aria-label={t("office.leadership.title")}>
      <div className={s.leadHead}>
        <IconBadge icon={<Organization16Regular />} tone="brand" size="md" />
        <div className={o.stack} style={{ gap: "2px" }}>
          <Text weight="semibold" size={400} as="h3" className={o.headingReset}>
            {t("office.leadership.title")}
          </Text>
          <Text size={200} className={o.muted}>
            {t("office.leadership.subFriendly")}
          </Text>
        </div>
      </div>
      <ul className={s.leadList} aria-label={t("office.leadership.listAria")}>
        <li className={s.leadRow} aria-label={t("office.leadership.ceo")}>
          {roster.ceo ? <EmployeeAvatar name={roster.ceo.name} employeeId={roster.ceo.employeeId} avatarStyle={prefs.avatarStyles[roster.ceo.employeeId]} executive size="sm" /> : <span className={s.leadVacantBadge} aria-hidden>—</span>}
          <div className={s.leadWho}>
            <span className={s.leadTitleRow}>
              <span className={s.deptDot} style={{ backgroundColor: "#4f46e5" }} aria-hidden />
              <Text size={200} weight="semibold">
                {t("office.leadership.ceo")}
              </Text>
            </span>
            {roster.ceo ? (
              <AppointmentHolder who={roster.ceo} stateAlways onOpen={(id) => go("employee", id)} />
            ) : (
              <Text size={200} className={o.muted}>
                {t("office.leadership.noCeo")}
              </Text>
            )}
          </div>
          {roster.ceo === null && (
            <Button size="small" appearance="outline" disabled={!canHire} onClick={onHireCeo}>
              {t("office.overview.hireCeo")}
            </Button>
          )}
          <AppointmentMenu slot={{ role: "ceo", incumbent: roster.ceo ?? null }} label={t("office.leadership.ceoActions")} onPick={onAppointment} />
        </li>
        {liveDepartments(roster.departments).map((d) => {
          const defaults = defaultsSetFor(d.defaults ?? {});
          const accent = accentForDepartment(d.id, d.name, prefs);
          return (
            <li key={d.id} className={s.leadRow} aria-label={d.name}>
              {d.manager ? <EmployeeAvatar name={d.manager.name} employeeId={d.manager.employeeId} avatarStyle={prefs.avatarStyles[d.manager.employeeId]} size="sm" /> : <span className={s.leadVacantBadge} aria-hidden>—</span>}
              <div className={s.leadWho}>
                <span className={s.leadTitleRow}>
                  <span className={s.deptDot} style={{ backgroundColor: accent.dot }} aria-hidden />
                  <Text size={200} weight="semibold">
                    {d.name}
                  </Text>
                </span>
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

function EmployeeListView({
  employees,
  departments,
  ceo,
  prefs,
  onAssign,
  onOpenEmployee,
  onOpenMission,
  onChangeModel,
}: {
  employees: EmployeeCard[];
  departments: Department[];
  ceo: AppointmentSummary | null;
  prefs: FloorPrefs;
  onAssign: (id: string) => void;
  onOpenEmployee: (id: string) => void;
  onOpenMission: (id: string) => void;
  onChangeModel: (employee: EmployeeCard) => void;
}) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const deptNameById = new Map(departments.map((d) => [d.id, d.name]));
  return (
    <section className={s.listCard} aria-label={t("office.overview.viewList")}>
      <div className={s.listHeadRow} aria-hidden>
        <span>{t("office.overview.colEmployee")}</span>
        <span>{t("office.overview.colDepartment")}</span>
        <span>{t("office.overview.colStatus")}</span>
        <span>{t("office.overview.colWork")}</span>
        <span style={{ textAlign: "right" }}>{t("office.overview.colActions")}</span>
      </div>
      <ul className={s.listRows}>
        {employees.map((e) => {
          const isCeo = isCeoEmployee(e, ceo);
          const deptLabel = isCeo ? t("office.floor.directorsOffice") : (e.departmentId ? (deptNameById.get(e.departmentId) ?? t("office.overview.unassigned")) : t("office.overview.unassigned"));
          const dotColor = isCeo ? "#4f46e5" : accentForDepartment(e.departmentId, deptLabel, prefs).dot;
          const runtimeText = e.execution.inherit?.includes("model")
            ? `${RUNTIME_LABELS[e.execution.runtime]} · ${t("office.floor.defaultModelShort")}`
            : e.execution.model
              ? `${RUNTIME_LABELS[e.execution.runtime]} · ${e.execution.model}`
              : RUNTIME_LABELS[e.execution.runtime];
          return (
            <li key={e.id} className={s.listRow}>
              <div className={o.row} style={{ flexWrap: "nowrap" }}>
                <EmployeeAvatar name={e.name} employeeId={e.id} avatarStyle={prefs.avatarStyles[e.id]} executive={isCeo} size="sm" />
                <div className={o.stack} style={{ gap: "1px" }}>
                  <Link as="button" style={{ fontWeight: 600, textAlign: "left" }} onClick={() => onOpenEmployee(e.id)}>
                    {e.name}
                  </Link>
                  <Text size={100} className={o.muted}>
                    {e.title}
                  </Text>
                  {e.employment !== "archived" ? (
                    <button
                      type="button"
                      className={s.listModelChip}
                      aria-label={t("office.floor.changeModelFor", { name: e.name })}
                      title={t("office.floor.changeModelFor", { name: e.name })}
                      onClick={() => onChangeModel(e)}
                    >
                      <Sparkle16Regular style={{ fontSize: "11px", flexShrink: 0 }} aria-hidden />
                      <span>{runtimeText}</span>
                      <ChevronDown12Regular style={{ flexShrink: 0 }} aria-hidden />
                    </button>
                  ) : (
                    <Text size={100} className={o.muted}>
                      {runtimeText}
                    </Text>
                  )}
                </div>
              </div>
              <span className={s.deptPill}>
                <span className={s.deptDot} style={{ backgroundColor: dotColor }} aria-hidden />
                <span>{deptLabel}</span>
              </span>
              <div>
                <WorkLabelBadge label={e.workLabel} />
              </div>
              <div className={o.stack} style={{ gap: "2px" }}>
                {e.holding ? (
                  <Link as="button" style={{ fontSize: tokens.fontSizeBase200, textAlign: "left" }} onClick={() => onOpenMission(e.holding?.missionId ?? "")}>
                    {e.holding.title}
                  </Link>
                ) : (
                  <Text size={200} className={o.muted}>
                    {t("office.overview.noCurrentWork")}
                  </Text>
                )}
                {e.queued > 0 && (
                  <Text size={100} className={o.muted}>
                    {t("office.floor.queuedBehind", { count: e.queued })}
                  </Text>
                )}
              </div>
              <div className={o.row} style={{ justifyContent: "flex-end" }}>
                <Button size="small" appearance="primary" disabled={e.employment === "archived"} onClick={() => onAssign(e.id)}>
                  {t("office.overview.assignWork")}
                </Button>
                <Button size="small" onClick={() => onOpenEmployee(e.id)}>
                  {t("office.overview.profile")}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// The unified company floor (or compact list) for one read of the roster, and any extra pages brought by "Load more".
// `onAppointment`: the floor's appointment actions open the Overview's own dialog, which outlives a re-read roster.
function RosterBody({
  roster,
  filter,
  filtered,
  query,
  viewMode,
  account,
  canHire,
  resourceSummary,
  prefs,
  motionPaused,
  onToggleMotionPaused,
  onToggleDensity,
  onToggleSound,
  onTogglePulse,
  onToggleRoomCollapsed,
  onCycleDeptAccent,
  onSetAvatarStyle,
  go,
  onAssign,
  onEdit,
  onAppointment,
  onRecruit,
  onHireCeo,
  onNewDepartment,
  onHireInDepartment,
  onOpenReview,
  onChangeModel,
  onRosterChanged,
  onClearFilters,
}: {
  roster: Roster;
  filter: string;
  filtered: boolean;
  query: RosterQuery;
  viewMode: "floor" | "list";
  account: AuthAccount | null;
  canHire: boolean;
  resourceSummary: ResourceSummary | null;
  prefs: FloorPrefs;
  motionPaused: boolean;
  onToggleMotionPaused: () => void;
  onToggleDensity: () => void;
  onToggleSound: () => void;
  onTogglePulse: () => void;
  onToggleRoomCollapsed: (deptKey: string) => void;
  onCycleDeptAccent: (deptId: string, label: string) => void;
  onSetAvatarStyle: (employeeId: string, style: AvatarCustomization | null) => void;
  go: Go;
  onAssign: (id: string) => void;
  onEdit: (e: DepartmentEdit) => void;
  onAppointment: (edit: AppointmentEdit) => void;
  onRecruit: ((departmentId: string) => void) | null;
  onHireCeo: (() => void) | null;
  onNewDepartment: () => void;
  onHireInDepartment: (departmentId: string) => void;
  onOpenReview: (missionId: string | null) => void;
  onChangeModel: (employee: EmployeeCard) => void;
  onRosterChanged: () => void;
  onClearFilters: () => void;
}) {
  const { t } = useI18n();
  const o = useOfficeStyles();
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
  const ceoEmployee = employees.find((e) => isCeoEmployee(e, roster.ceo)) ?? null;
  if (groups.length === 0 && ceoEmployee === null) {
    return filtered ? (
      <EmptyState
        icon={<RosterIcon size={22} />}
        tone="brand"
        title={t("office.overview.emptyFilteredTitle")}
        body={t("office.overview.emptyFilteredBody")}
        action={
          <Button appearance="primary" onClick={onClearFilters}>
            {t("office.overview.clearFilters")}
          </Button>
        }
      />
    ) : (
      <EmptyState
        icon={<RosterIcon size={22} />}
        tone="brand"
        title={t("office.overview.emptyTitle")}
        body={t("office.overview.emptyBody")}
        action={
          <div className={o.row}>
            {roster.ceo === null && onHireCeo !== null && (
              <Button appearance="primary" icon={<PersonStar20Regular />} disabled={!canHire} onClick={onHireCeo}>
                {t("office.overview.hireCeo")}
              </Button>
            )}
            <Button icon={<Add16Regular />} onClick={onNewDepartment}>
              {t("office.overview.newDepartment")}
            </Button>
          </div>
        }
      />
    );
  }
  return (
    <>
      {viewMode === "list" && employees.length > 0 ? (
        <EmployeeListView
          employees={employees}
          departments={roster.departments}
          ceo={roster.ceo}
          prefs={prefs}
          onAssign={onAssign}
          onOpenEmployee={(id) => go("employee", id)}
          onOpenMission={(id) => go("mission", id)}
          onChangeModel={onChangeModel}
        />
      ) : (
        <OfficeFloorMap
          groups={groups}
          departments={roster.departments}
          ceo={roster.ceo}
          ceoEmployee={ceoEmployee}
          filter={filter}
          account={account}
          inboxCount={roster.counts.inbox}
          canHire={canHire}
          resourceSummary={resourceSummary}
          prefs={prefs}
          motionPaused={motionPaused}
          onToggleMotionPaused={onToggleMotionPaused}
          onToggleDensity={onToggleDensity}
          onToggleSound={onToggleSound}
          onTogglePulse={onTogglePulse}
          onToggleRoomCollapsed={onToggleRoomCollapsed}
          onCycleDeptAccent={onCycleDeptAccent}
          onSetAvatarStyle={onSetAvatarStyle}
          onAssign={onAssign}
          onOpenEmployee={(id) => go("employee", id)}
          onOpenMission={(id) => go("mission", id)}
          onEditDepartment={onEdit}
          onAppointment={onAppointment}
          onRecruit={onRecruit}
          onHireCeo={onHireCeo}
          onHireInDepartment={onHireInDepartment}
          onOpenReview={onOpenReview}
          onChangeModel={onChangeModel}
          onRosterChanged={onRosterChanged}
        />
      )}
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
  const [viewMode, setViewMode] = useState<"floor" | "list">("floor");
  const [motionPaused, setMotionPaused] = useState(false);
  const floorPrefs = useFloorPrefs();
  const [hiring, setHiring] = useState<{ departmentId: string | null; appointRole?: "ceo" | null } | null>(null);
  const openHireCeo = () => setHiring({ departmentId: null, appointRole: "ceo" });
  // A hiring request, for the whole company (null) or one department.
  const [recruiting, setRecruiting] = useState<{ departmentId: string | null } | null>(null);
  const [assigning, setAssigning] = useState<{ employeeId: string | null } | null>(null);
  const [editing, setEditing] = useState<DepartmentEdit | null>(null);
  const [appointing, setAppointing] = useState<AppointmentEdit | null>(null);
  const [defaultsOf, setDefaultsOf] = useState<DefaultsTarget | null>(null);
  const [reviewing, setReviewing] = useState<{ missionId: string | null } | null>(null);
  const [switchingModel, setSwitchingModel] = useState<ModelSwitcherTarget | null>(null);
  const [filters, setFilters] = useState(false);
  const [checklistDismissed, setChecklistDismissed] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const restore = useRestoreFocusTarget();
  // A search is asked once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setQ(typed), 250);
    return () => clearTimeout(t);
  }, [typed]);
  const query: RosterQuery = { department: department === "all" ? null : department, q, status: status === "all" ? null : status };
  const roster = useOfficeRead<Roster>(() => office.roster(query), [department, q, status], ["roster", "connections", "inbox"]);
  const connections = useConnections();
  const resourceSummary = useResourceSummary();
  const canHire = connections.data?.canHire === true;
  // A hiring request is the CEO's to plan: offered when the CEO answers and a connection can run employees.
  const executiveState = useExecutiveState();
  const recruit = executiveState.data?.recruit ?? null;

  // Virtual workplace keyboard shortcuts (ignored when typing, holding modifiers, or when a modal/sheet is open).
  const modalOpen = Boolean(hiring || recruiting || assigning || editing || appointing || defaultsOf || reviewing || switchingModel || filters);
  const hasEmployees = (roster.data?.employees.length ?? 0) > 0;
  useEffect(() => {
    if (modalOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const target = ev.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (ev.key === "/") {
        ev.preventDefault();
        searchInputRef.current?.focus();
      } else if (ev.key === "v" || ev.key === "V") {
        setViewMode((m) => (m === "floor" ? "list" : "floor"));
      } else if ((ev.key === "c" || ev.key === "C") && viewMode === "floor") {
        floorPrefs.toggleDensity();
      } else if (ev.key === " " && viewMode === "floor" && tag !== "BUTTON" && tag !== "A") {
        ev.preventDefault();
        setMotionPaused((p) => !p);
      } else if ((ev.key === "a" || ev.key === "A") && hasEmployees) {
        ev.preventDefault();
        setAssigning({ employeeId: null });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, viewMode, hasEmployees, floorPrefs]);

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
  const mobilePickers = (
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
  const inlinePickers = (
    <>
      <Select className={s.select} aria-label={t("office.overview.departmentLabel")} value={department} onChange={(_, d) => setDepartment(d.value)}>
        <option value="all">{t("office.overview.allDepartments")}</option>
        {live.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
        <option value="none">{t("office.overview.unassigned")}</option>
      </Select>
      <Select className={s.select} aria-label={t("office.overview.statusLabel")} value={status} onChange={(_, d) => setStatus(d.value as WorkLabel | "all")}>
        <option value="all">{t("office.overview.anyStatus")}</option>
        {WORK_LABELS.map((l) => (
          <option key={l} value={l}>
            {WORK_LABEL_TEXT[l]}
          </option>
        ))}
      </Select>
    </>
  );
  const c = r.counts;
  const waitingReviewCount = r.employees.filter((e) => e.workLabel === "waiting_review").length;
  const viewSwitch = (
    <div className={s.viewToggle} role="group" aria-label={t("office.overview.viewModeAria")}>
      <Button
        size="small"
        appearance="subtle"
        className={mergeClasses(s.viewBtn, viewMode === "floor" && s.viewBtnOn)}
        aria-pressed={viewMode === "floor"}
        icon={<OfficeIcon size={14} active={viewMode === "floor"} />}
        onClick={() => setViewMode("floor")}
      >
        {t("office.overview.viewFloor")}
      </Button>
      <Button
        size="small"
        appearance="subtle"
        className={mergeClasses(s.viewBtn, viewMode === "list" && s.viewBtnOn)}
        aria-pressed={viewMode === "list"}
        icon={<TaskListLtr20Regular />}
        onClick={() => setViewMode("list")}
      >
        {t("office.overview.viewList")}
      </Button>
    </div>
  );
  return (
    <div className={o.page}>
      <section className={o.heroCard} aria-label={r.office.name}>
        <div className={s.heroHeader}>
          <div className={o.stack} style={{ gap: "2px" }}>
            <div className={o.row}>
              <Text weight="semibold" size={500} as="h2" className={o.headingReset}>
                {r.office.name}
              </Text>
              <AsOf at={r.asOf} />
            </div>
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
          </div>
          <div className={s.heroActions}>
            {r.ceo === null && (
              <Button size="small" className={o.touch} appearance={r.employees.length === 0 ? "primary" : "secondary"} icon={<PersonStar20Regular />} disabled={!canHire} onClick={openHireCeo} {...restore}>
                {t("office.overview.hireCeo")}
              </Button>
            )}
            <Button size="small" className={o.touch} appearance="primary" icon={<TaskListLtr20Regular />} disabled={r.employees.length === 0} onClick={() => setAssigning({ employeeId: null })} {...restore}>
              {t("office.overview.assignWork")}
            </Button>
            <Button size="small" className={o.touch} icon={<PersonAdd20Regular />} disabled={!canHire} onClick={() => setHiring({ departmentId: null })} {...restore}>
              {t("office.overview.hireEmployee")}
            </Button>
            <Button size="small" appearance="subtle" className={mergeClasses(o.touch, s.secondaryActionBtn)} icon={<PeopleAdd20Regular />} disabled={recruit?.ok !== true} title={recruit !== null && !recruit.ok ? (recruit.reason ?? undefined) : undefined} onClick={() => setRecruiting({ departmentId: null })} {...restore}>
              {t("office.overview.recruit")}
            </Button>
            {r.employees.length > 0 && (
              <Button
                size="small"
                appearance="subtle"
                className={mergeClasses(o.touch, s.secondaryActionBtn)}
                icon={<Sparkle16Regular />}
                disabled={!canHire}
                title={t("office.overview.changeModelsTitle")}
                onClick={() => setSwitchingModel({ kind: "bulk", initialScope: department === "all" ? "all" : department === "none" ? "unassigned" : department })}
                {...restore}
              >
                {t("office.overview.changeModels")}
              </Button>
            )}
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Button
                  size="small"
                  appearance="subtle"
                  className={mergeClasses(o.touch, s.secondaryActionBtn)}
                  icon={<Settings16Regular />}
                  aria-label={t("office.overview.manageMenuAria")}
                  {...restore}
                >
                  {t("office.overview.manageMenu")}{" "}
                  <ChevronDown16Regular aria-hidden style={{ verticalAlign: "middle", marginLeft: "2px" }} />
                </Button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuGroup>
                    <MenuGroupHeader>{t("office.overview.manageStructure")}</MenuGroupHeader>
                    <MenuItem icon={<Add16Regular />} onClick={() => setEditing({ kind: "new" })}>
                      {t("office.overview.newDepartment")}
                    </MenuItem>
                    <MenuItem
                      icon={<Organization16Regular />}
                      onClick={() => document.getElementById("office-leadership")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    >
                      {t("office.overview.jumpLeadership")}
                    </MenuItem>
                  </MenuGroup>
                  <MenuDivider />
                  <MenuGroup>
                    <MenuGroupHeader>{t("office.overview.manageAdvanced")}</MenuGroupHeader>
                    <MenuItem icon={<Options16Regular />} onClick={() => setDefaultsOf({ kind: "company", office: company })}>
                      {t("office.overview.companyDefaults")}
                    </MenuItem>
                  </MenuGroup>
                </MenuList>
              </MenuPopover>
            </Menu>
          </div>
        </div>
        <div className={o.statGrid}>
          <button type="button" className={mergeClasses(o.statCard, o.statCardAction)} onClick={clearFilters}>
            <span className={s.statLabelWrap}>
              <IconBadge icon={<RosterIcon size={13} />} tone="brand" size="sm" />
              <Text size={200} className={mergeClasses(o.muted, s.statLabel)}>
                {t("office.overview.statTotalRoster")}
              </Text>
            </span>
            <Text size={400} weight="semibold" className={s.statValue}>
              {c.employees}
            </Text>
          </button>
          <button type="button" aria-pressed={status === "ready"} className={mergeClasses(o.statCard, o.statCardAction, status === "ready" && s.statActive)} onClick={() => setStatus((cur) => (cur === "ready" ? "all" : "ready"))}>
            <span className={s.statLabelWrap}>
              <IconBadge icon={<ReadyIcon size={13} />} tone={c.ready > 0 ? "success" : "neutral"} size="sm" />
              <Text size={200} className={mergeClasses(o.muted, s.statLabel)}>
                {t("office.overview.statReady")}
              </Text>
            </span>
            <Text size={400} weight="semibold" className={mergeClasses(s.statValue, c.ready > 0 && s.statReady)}>
              {c.ready}
            </Text>
          </button>
          <button type="button" aria-pressed={status === "working"} className={mergeClasses(o.statCard, o.statCardAction, status === "working" && s.statActive)} onClick={() => setStatus((cur) => (cur === "working" ? "all" : "working"))}>
            <span className={s.statLabelWrap}>
              <IconBadge icon={<WorkingIcon size={13} />} tone={c.busy > 0 ? "brand" : "neutral"} size="sm" />
              <Text size={200} className={mergeClasses(o.muted, s.statLabel)}>
                {t("office.overview.statWorking")}
              </Text>
            </span>
            <Text size={400} weight="semibold" className={mergeClasses(s.statValue, c.busy > 0 && s.statBusy)}>
              {c.busy}
            </Text>
          </button>
          <button type="button" className={mergeClasses(o.statCard, o.statCardAction)} onClick={() => go("work")}>
            <span className={s.statLabelWrap}>
              <IconBadge icon={<QueuedIcon size={13} />} tone="neutral" size="sm" />
              <Text size={200} className={mergeClasses(o.muted, s.statLabel)}>
                {t("office.overview.statQueued")}
              </Text>
            </span>
            <Text size={400} weight="semibold" className={s.statValue}>
              {c.queued}
            </Text>
          </button>
          <button type="button" aria-pressed={status === "not_ready"} className={mergeClasses(o.statCard, o.statCardAction, status === "not_ready" && s.statActive)} onClick={() => setStatus((cur) => (cur === "not_ready" ? "all" : "not_ready"))}>
            <span className={s.statLabelWrap}>
              <IconBadge icon={<NotReadyIcon size={13} />} tone={c.notReady > 0 ? "danger" : "neutral"} size="sm" />
              <Text size={200} className={mergeClasses(o.muted, s.statLabel)}>
                {t("office.overview.statNotReady")}
              </Text>
            </span>
            <Text size={400} weight="semibold" className={mergeClasses(s.statValue, c.notReady > 0 && s.statDanger)}>
              {c.notReady}
            </Text>
          </button>
          <button type="button" className={mergeClasses(o.statCard, o.statCardAction, c.inbox > 0 && s.statInboxAlert)} onClick={() => go("inbox")} aria-label={t("office.overview.openNeedsMeAria", { count: c.inbox })}>
            <span className={s.statLabelWrap}>
              <IconBadge icon={<InboxActionIcon size={13} />} tone={c.inbox > 0 ? "warning" : "neutral"} size="sm" />
              <Text size={200} className={mergeClasses(c.inbox > 0 ? s.statWarn : o.muted, s.statLabel)}>
                {t("office.overview.statNeedsYou")}
              </Text>
            </span>
            <Text size={400} weight="semibold" className={mergeClasses(s.statValue, c.inbox > 0 && s.statWarn)}>
              {c.inbox}
            </Text>
          </button>
        </div>
      </section>
      {connections.data !== null && !canHire && (
        <Callout tone="warn" icon={<PlugDisconnected16Regular />} role="status">
          {t("office.overview.connectCliFirst")}
          <Link href={settingsHref("ai-connections")}>{t("office.overview.openAiConnections")}</Link>
        </Callout>
      )}
      {r.employees.length === 0 && !checklistDismissed && (
        <Callout tone="info">
          <div className={o.between} style={{ alignItems: "flex-start" }}>
            <div className={o.stack} style={{ gap: "4px" }}>
              <Text weight="semibold" size={300}>
                {t("office.overview.gettingStartedTitle")}
              </Text>
              <Text size={200}>{t("office.overview.gettingStartedBody")}</Text>
              <Text size={200} className={o.muted}>
                1. {t("office.overview.stepCeo")} → 2. {t("office.overview.stepHire")} → 3. {t("office.overview.stepAssign")}
              </Text>
            </div>
            <Button appearance="subtle" size="small" icon={<Dismiss16Regular />} aria-label={t("office.overview.dismissChecklistAria")} onClick={() => setChecklistDismissed(true)} />
          </div>
        </Callout>
      )}
      <div className={mergeClasses(s.filterBar, isMobile && s.toolbarMobile)}>
        {isMobile ? (
          <>
            <SearchBox ref={searchInputRef} className={mergeClasses(s.search, s.searchMobile)} placeholder={t("office.overview.searchPlaceholder")} aria-label={t("office.overview.searchPlaceholder")} value={typed} onChange={(_, d) => setTyped(d.value)} />
            {viewSwitch}
            <Button className={o.touch} style={{ justifySelf: "end" }} icon={<Filter20Regular />} onClick={() => setFilters(true)}>
              {t("office.overview.filtersBtn", { on: department !== "all" || status !== "all" ? t("office.overview.filtersOn") : "" })}
            </Button>
          </>
        ) : (
          <>
            <SearchBox ref={searchInputRef} className={s.search} placeholder={t("office.overview.searchPlaceholder")} aria-label={t("office.overview.searchPlaceholder")} value={typed} onChange={(_, d) => setTyped(d.value)} />
            {inlinePickers}
            {waitingReviewCount > 0 && (
              <Button
                size="small"
                appearance={status === "waiting_review" ? "primary" : "outline"}
                aria-pressed={status === "waiting_review"}
                onClick={() => setStatus((cur) => (cur === "waiting_review" ? "all" : "waiting_review"))}
              >
                {t("office.overview.statWaitingReview")} ({waitingReviewCount})
              </Button>
            )}
            {filtered && (
              <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} onClick={clearFilters}>
                {t("office.overview.clear")}
              </Button>
            )}
            {viewSwitch}
          </>
        )}
      </div>
      {isMobile && (
        <ResponsiveSheet open={filters} onOpenChange={setFilters} title={t("office.overview.filtersSheetTitle")}>
          <div className={mergeClasses(o.form, "orbit-touch")}>
            {mobilePickers}
            {filtered && (
              <Button appearance="subtle" icon={<Dismiss16Regular />} onClick={() => { clearFilters(); setFilters(false); }}>
                {t("office.overview.clearFilters")}
              </Button>
            )}
          </div>
        </ResponsiveSheet>
      )}
      <RosterBody
        key={`${r.asOf}:${r.version}`}
        roster={r}
        filter={department}
        filtered={filtered}
        query={query}
        viewMode={viewMode}
        account={account}
        canHire={canHire}
        resourceSummary={resourceSummary.data}
        prefs={floorPrefs.prefs}
        motionPaused={motionPaused}
        onToggleMotionPaused={() => setMotionPaused((p) => !p)}
        onToggleDensity={floorPrefs.toggleDensity}
        onToggleSound={floorPrefs.toggleSound}
        onTogglePulse={floorPrefs.togglePulse}
        onToggleRoomCollapsed={floorPrefs.toggleRoomCollapsed}
        onCycleDeptAccent={floorPrefs.cycleDeptAccent}
        onSetAvatarStyle={floorPrefs.setAvatarStyle}
        go={go}
        onAssign={(id) => setAssigning({ employeeId: id })}
        onEdit={setEditing}
        onAppointment={setAppointing}
        onRecruit={recruit?.ok === true ? (departmentId) => setRecruiting({ departmentId }) : null}
        onHireCeo={r.ceo === null ? openHireCeo : null}
        onNewDepartment={() => setEditing({ kind: "new" })}
        onHireInDepartment={(departmentId) => setHiring({ departmentId })}
        onOpenReview={(missionId) => setReviewing({ missionId })}
        onChangeModel={(emp) => setSwitchingModel({ kind: "single", employee: emp })}
        onRosterChanged={() => void roster.reload()}
        onClearFilters={clearFilters}
      />
      <Leadership roster={r} prefs={floorPrefs.prefs} canHire={canHire} go={go} onAppointment={setAppointing} onDefaults={(d) => setDefaultsOf({ kind: "department", department: d, company: company.defaults ?? {} })} onHireCeo={openHireCeo} />
      {hiring && (
        <HireWizard
          departments={r.departments}
          initialDepartmentId={hiring.departmentId}
          appointRole={hiring.appointRole ?? null}
          companyDefaults={company.defaults ?? {}}
          onClose={() => setHiring(null)}
          onHired={(e) => {
            const wasCeo = hiring.appointRole === "ceo";
            setHiring(null);
            if (wasCeo) {
              void roster.reload();
              void executiveState.reload();
            } else {
              go("employee", e.id);
            }
          }}
        />
      )}
      {reviewing && (
        <QuickReviewSheet
          open
          focusMissionId={reviewing.missionId}
          go={go}
          onClose={() => setReviewing(null)}
          onChanged={() => void roster.reload()}
        />
      )}
      {recruiting && (
        <RecruitDialog
          departments={r.departments}
          departmentId={recruiting.departmentId}
          companyDefaults={company.defaults ?? {}}
          ceoName={executiveState.data?.ceo?.name ?? null}
          onClose={() => setRecruiting(null)}
          onOpenEmployee={(id) => {
            setRecruiting(null);
            go("employee", id);
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
      {appointing && (
        <AppointmentDialog
          edit={appointing}
          onClose={() => setAppointing(null)}
          onDone={changed}
          onHireCeo={
            canHire
              ? () => {
                  setAppointing(null);
                  openHireCeo();
                }
              : undefined
          }
        />
      )}
      {defaultsOf && <DefaultsDialog target={defaultsOf} onClose={() => setDefaultsOf(null)} onDone={changed} />}
      {switchingModel && (
        <ModelSwitcherDialog
          target={switchingModel}
          departments={r.departments}
          companyDefaults={company.defaults ?? {}}
          onClose={() => setSwitchingModel(null)}
          onDone={() => void roster.reload()}
        />
      )}
    </div>
  );
}
