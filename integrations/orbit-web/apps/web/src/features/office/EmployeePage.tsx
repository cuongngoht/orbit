// ONE EMPLOYEE: its profile (each change a revision, any revision restorable), its role in the company (the appointment
// it holds, every one it held, whom it reports to), its work (what it holds, what waits behind it, what it did), its
// Personal Sandbox and resources (the areas and how each limit is enforced, the attempt running now and what its
// containers use, the resource revisions, and an edit that applies to future attempts), and its employment -- each move
// with its reason. Every change names the version read; a stale one offers the latest.
import {
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Link,
  Menu,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarBody,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Radio,
  RadioGroup,
  Select,
  Spinner,
  Tab,
  TabList,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
  useRestoreFocusTarget,
} from "@fluentui/react-components";
import {
  ArrowCounterclockwise16Regular,
  Box16Regular,
  Briefcase16Regular,
  ChevronDown16Regular,
  ChevronRight16Regular,
  Clock16Regular,
  Code16Regular,
  Color16Regular,
  Edit16Regular,
  ErrorCircle16Regular,
  History16Regular,
  Key16Regular,
  Organization16Regular,
  Person16Regular,
  Settings16Regular,
  Shield16Regular,
  TaskListLtr20Regular,
  Warning16Regular,
} from "@fluentui/react-icons";
import { ASSIGNMENT_STATE_TEXT, DEFAULT_PRESETS, RUNTIME_LABELS, effortFor, effortLabel, type AiConnectionsView, type AppointmentView, type AssignmentSummary, type EmployeeDetail, type Employment, type EmploymentCommand, type ExecutionProfile, type ResourcePreset, type ResourceProfile, type Roster, type SandboxState } from "@orbit-web/contracts";
import { useState, type ReactElement } from "react";
import { IconBadge } from "../../components/SectionIcons";
import type { OfficePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useI18n, type I18nContextValue, type MessageKey } from "../../i18n";
import { get } from "../../services/api";
import { useResourceSummary } from "../resources/ComputeStorageSection";
import { AREA_TEXT, LEVEL_TEXT, LEVEL_TONE, cpuText, sizeText } from "../resources/format";
import { office, useOfficeRead, wholeRoster } from "./api";
import { AppointmentStateBadge } from "./AppointmentDialogs";
import { AssignDialog } from "./AssignDialog";
import { AvatarCustomizer } from "./AvatarCustomizer";
import { AccessTab } from "./EmployeeAccessTab";
import { EmployeeRuntimeSecurityTab } from "./EmployeeRuntimeSecurityTab";
import { useFloorPrefs } from "./floorPrefs";
import { useConnections } from "../connections/AiConnectionsSection";
import { useExecutiveState } from "../executive/api";
import { DraftWithAi, type DraftFields } from "./DraftWithAi";
import { AssistantsField, DefaultsThatApply, INHERITED, inheritsModel, usableForEmployees } from "./HireWizard";
import { AsOf, Callout, EmptyState, ProblemBar, StateBadge, WorkLabelBadge, humanizeActor, humanizeWaitingOn, useAction, useOfficeStyles, when } from "./parts";
import { EmployeeDeskScene, deskMoodText } from "./VirtualDesk";
import { ResourceFields, resourceProblems, storageProblem } from "./ResourceFields";
import { RunDetails } from "./RunDetails";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

export const EMPLOYEE_TABS = ["profile", "work", "access", "resources", "employment", "security"] as const;
type EmployeeTab = (typeof EMPLOYEE_TABS)[number];
const PRIMARY_EMPLOYEE_TABS: readonly EmployeeTab[] = ["profile", "work", "access"];
type AdvancedTab = "resources" | "employment" | "security";
const ADVANCED_EMPLOYEE_TABS: readonly AdvancedTab[] = ["resources", "employment", "security"];
const isAdvanced = (tab: EmployeeTab): tab is AdvancedTab => (ADVANCED_EMPLOYEE_TABS as readonly string[]).includes(tab);
const TAB_KEYS: Record<EmployeeTab, MessageKey> = {
  profile: "office.employee.tab.profile",
  work: "office.employee.tab.work",
  access: "office.employee.tab.access",
  resources: "office.employee.tab.resources",
  employment: "office.employee.tab.employment",
  security: "office.employee.tab.security",
};
const ADVANCED_EMP_TAB_DESC: Record<AdvancedTab, MessageKey> = {
  resources: "office.employee.tab.resourcesDesc",
  employment: "office.employee.tab.employmentDesc",
  security: "office.employee.tab.securityDesc",
};

const TAB_ICON: Record<EmployeeTab, ReactElement> = {
  profile: <Person16Regular />,
  work: <TaskListLtr20Regular />,
  access: <Key16Regular />,
  resources: <Box16Regular />,
  employment: <Briefcase16Regular />,
  security: <Shield16Regular />,
};

const EMPLOYMENT_KEYS: Record<Employment, MessageKey> = {
  candidate: "office.employee.employment.candidate",
  probation: "office.employee.employment.probation",
  active: "office.employee.employment.active",
  suspended: "office.employee.employment.suspended",
  archived: "office.employee.employment.archived",
  deleted: "office.employee.employment.deleted",
};

const EMPLOYMENT_TONE: Record<Employment, "success" | "warning" | "subtle" | "informative" | "danger"> = {
  candidate: "informative",
  probation: "warning",
  active: "success",
  suspended: "warning",
  archived: "subtle",
  deleted: "danger",
};

const SANDBOX_KEYS: Record<SandboxState, MessageKey> = {
  PROVISIONING: "office.employee.sandbox.PROVISIONING",
  READY: "office.employee.sandbox.READY",
  FAILED: "office.employee.sandbox.FAILED",
  ARCHIVED: "office.employee.sandbox.ARCHIVED",
  DELETING: "office.employee.sandbox.DELETING",
  DELETED: "office.employee.sandbox.DELETED",
};

// What may be done next with an employment, and what each move means.
// An archived employee's desk is deleted from Governance → Employee desks, where what it holds is shown first.
const MOVES: Record<Employment, EmploymentCommand[]> = { candidate: ["start_probation", "activate", "reject"], probation: ["activate", "reject"], active: ["suspend", "archive"], suspended: ["reinstate", "archive"], archived: [], deleted: [] };
const MOVE_KEYS: Record<EmploymentCommand, { labelKey: MessageKey; meansKey: MessageKey; danger?: boolean }> = {
  start_probation: { labelKey: "office.employee.move.start_probation.label", meansKey: "office.employee.move.start_probation.means" },
  activate: { labelKey: "office.employee.move.activate.label", meansKey: "office.employee.move.activate.means" },
  reject: { labelKey: "office.employee.move.reject.label", meansKey: "office.employee.move.reject.means", danger: true },
  suspend: { labelKey: "office.employee.move.suspend.label", meansKey: "office.employee.move.suspend.means" },
  reinstate: { labelKey: "office.employee.move.reinstate.label", meansKey: "office.employee.move.reinstate.means" },
  archive: { labelKey: "office.employee.move.archive.label", meansKey: "office.employee.move.archive.means", danger: true },
  delete: { labelKey: "office.employee.move.delete.label", meansKey: "office.employee.move.delete.means", danger: true },
};

const useStyles = makeStyles({
  heroTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    flexWrap: "wrap",
    minWidth: 0,
  },
  heroIdentity: {
    display: "flex",
    alignItems: "center",
    gap: "16px",
    flexWrap: "wrap",
    minWidth: 0,
    flexGrow: 1,
  },
  deskFrame: {
    position: "relative",
    paddingTop: "8px",
    paddingRight: "12px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    borderRadius: "14px",
    backgroundColor: "var(--orbit-tool-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    flexShrink: 0,
  },
  avatarEditBtn: {
    position: "absolute",
    right: "4px",
    bottom: "4px",
    minWidth: "24px",
    height: "24px",
    paddingLeft: "4px",
    paddingRight: "4px",
    borderRadius: "9999px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    boxShadow: "0 1px 3px rgba(15, 23, 42, 0.12)",
  },
  kpiStrip: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: "10px",
    minWidth: 0,
    "@media (max-width: 899px)": { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
    "@media (max-width: 479px)": { gridTemplateColumns: "1fr" },
  },
  kpiTile: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: "left",
    cursor: "pointer",
    fontFamily: "inherit",
    color: "inherit",
    minWidth: 0,
    transitionProperty: "background-color, border-color, box-shadow",
    transitionDuration: "140ms",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      ...shorthands.borderColor(tokens.colorBrandStroke1),
      boxShadow: tokens.shadow4,
    },
    ":focus-visible": {
      ...shorthands.outline("2px", "solid", tokens.colorStrokeFocus2),
      outlineOffset: "2px",
    },
  },
  kpiTileActive: {
    ...shorthands.borderColor(tokens.colorBrandStroke2),
    backgroundColor: tokens.colorSubtleBackgroundSelected,
  },
  kpiLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  kpiValue: {
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  kpiSub: {
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase100,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tabLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
  },
  twoCol: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)",
    gap: "16px",
    alignItems: "start",
    minWidth: 0,
    "@media (max-width: 959px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  equalCols: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "16px",
    alignItems: "start",
    minWidth: 0,
    "@media (max-width: 899px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
  colStack: {
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    minWidth: 0,
  },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    minWidth: 0,
  },
  sectionTitleWrap: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0,
  },
  inlineFormBox: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    paddingTop: "14px",
    paddingRight: "14px",
    paddingBottom: "14px",
    paddingLeft: "14px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorBrandStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
  },
  actionRow: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  kvGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "10px",
    minWidth: 0,
    "@media (max-width: 479px)": { gridTemplateColumns: "1fr" },
  },
  kvCell: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    paddingTop: "8px",
    paddingRight: "10px",
    paddingBottom: "8px",
    paddingLeft: "10px",
    borderRadius: "10px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    minWidth: 0,
  },
  kvFull: {
    gridColumn: "1 / -1",
  },
  chipRow: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
  },
  revisionCurrent: {
    ...shorthands.borderColor(tokens.colorBrandStroke2),
    backgroundColor: tokens.colorSubtleBackgroundSelected,
  },
  assignmentItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
    transitionProperty: "border-color, background-color",
    transitionDuration: "140ms",
    ":hover": {
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
  },
  holdingSpotlight: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    paddingTop: "14px",
    paddingRight: "16px",
    paddingBottom: "14px",
    paddingLeft: "16px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorBrandStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
  },
  resourceTiles: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(128px, 1fr))",
    gap: "8px",
    minWidth: 0,
  },
  resourceTile: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    paddingTop: "8px",
    paddingRight: "10px",
    paddingBottom: "8px",
    paddingLeft: "10px",
    borderRadius: "10px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
  },
  resourceValue: {
    fontVariantNumeric: "tabular-nums",
    fontWeight: tokens.fontWeightSemibold,
    fontSize: tokens.fontSizeBase300,
  },
  moveCard: {
    display: "flex",
    alignItems: "flex-start",
    paddingTop: "8px",
    paddingRight: "12px",
    paddingBottom: "8px",
    paddingLeft: "8px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    transitionProperty: "border-color, background-color",
    transitionDuration: "140ms",
    ":hover": {
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
    },
  },
  moveCardSelected: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    backgroundColor: tokens.colorSubtleBackgroundSelected,
  },
  moveCardDanger: {
    ...shorthands.borderColor(tokens.colorPaletteRedBorder2),
    backgroundColor: tokens.colorPaletteRedBackground1,
  },
  moveList: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  chevron: {
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  tabBarRow: { display: "flex", alignItems: "center", gap: "4px", minWidth: 0 },
  advancedTabBtn: {
    flexShrink: 0,
    borderRadius: "8px",
    fontWeight: tokens.fontWeightMedium,
    color: tokens.colorNeutralForeground2,
  },
  advancedTabBtnActive: {
    color: tokens.colorBrandForeground1,
    backgroundColor: tokens.colorBrandBackground2,
    fontWeight: tokens.fontWeightSemibold,
  },
  menuItemBody: { display: "flex", flexDirection: "column", gap: "1px" },
  menuItemSub: { fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 },
  usageCell: { display: "flex", flexDirection: "column", gap: "4px", minWidth: "88px" },
  usageTrack: {
    width: "100%",
    maxWidth: "96px",
    height: "5px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralBackground3,
    overflow: "hidden",
  },
  usageFill: {
    height: "100%",
    borderRadius: "9999px",
    backgroundColor: tokens.colorBrandBackground,
  },
  usageFillWarn: { backgroundColor: tokens.colorPaletteDarkOrangeBackground3 },
  usageFillDanger: { backgroundColor: tokens.colorPaletteRedBackground3 },
});

// What a profile runs on, in words: its runtime, then its own model and effort -- or that it leaves them to its
// department's default, else the company's.
const modelShown = (t: I18nContextValue["t"], x: ExecutionProfile): string => (inheritsModel(x) ? t("office.employee.fromDefaults") : x.model);
const effortShown = (t: I18nContextValue["t"], x: ExecutionProfile): string => (x.inherit?.includes("effort") === true ? t("office.employee.fromDefaults") : x.effort ? effortLabel(x.effort) : t("office.hire.effortNoneShort"));
const runsOnShown = (t: I18nContextValue["t"], x: ExecutionProfile): string => [RUNTIME_LABELS[x.runtime], modelShown(t, x), ...(!inheritsModel(x) && x.effort ? [effortLabel(x.effort)] : [])].join(" · ");

// An appointment in words: "CEO", "Manager of Accounting".
const appointmentShown = (t: I18nContextValue["t"], a: AppointmentView): string => (a.role === "ceo" ? t("office.employee.appointmentCeo") : t("office.employee.appointmentManager", { department: a.departmentName ?? "" }));

// ITS ROLE IN THE COMPANY: the appointment it holds -- authority is that, never a title or the team-lead switch -- every
// appointment it held, and whom it reports to, named when the roster has them.
function RoleCard({ e, go }: { e: EmployeeDetail; go: Go }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const s = useStyles();
  const managerId = e.managerId;
  const history = [...(e.appointments ?? [])].sort((a, b) => b.appointedAt.localeCompare(a.appointedAt));
  const needsOtherNames = history.some((a) => [a.appointedBy, a.endedBy].some((b) => Boolean(b && b.includes("employee:") && !b.endsWith(e.id))));
  const roster = useOfficeRead<Roster>(managerId !== null || needsOtherNames ? () => wholeRoster() : null, [managerId, needsOtherNames], ["roster"]);
  const reportsTo = managerId === null ? null : (roster.data?.employees.find((x) => x.id === managerId) ?? null);
  const peopleList = [{ employeeId: e.id, employeeName: e.name }, ...(roster.data?.employees.map((x) => ({ employeeId: x.id, employeeName: x.name })) ?? [])];
  const now = e.appointment ?? null;
  return (
    <section className={o.card} aria-label={t("office.employee.authorityTitle")}>
      <div className={s.sectionHead}>
        <IconBadge icon={<Organization16Regular />} tone={now ? "brand" : "neutral"} size="md" />
        <div className={s.sectionTitleWrap}>
          <Text weight="semibold" size={400}>
            {t("office.employee.authorityTitle")}
          </Text>
          <Text size={200} className={o.muted}>
            {t("office.employee.authoritySub")}
          </Text>
        </div>
      </div>
      <div className={o.divider} />
      {now ? (
        <div className={o.stack}>
          <div className={o.row}>
            <Text weight="semibold">{appointmentShown(t, now)}</Text>
            <AppointmentStateBadge state={now.state} />
          </div>
          <Text size={200} className={o.muted}>
            {t("office.employee.appointmentSince", { at: when(now.appointedAt), revision: now.slotRevision })}
          </Text>
          {now.reason && (
            <Text size={200} className={o.wrap}>
              {t("office.employee.appointmentReason", { reason: now.reason })}
            </Text>
          )}
        </div>
      ) : (
        <Text size={200} className={o.muted}>
          {t("office.employee.noAppointment")}
        </Text>
      )}
      {reportsTo && (
        <dl className={o.dl}>
          <dt className={o.dt}>{t("office.employee.reportsTo")}</dt>
          <dd className={o.dd}>
            <Link as="button" inline onClick={() => go("employee", reportsTo.id)}>
              {reportsTo.name}
            </Link>
          </dd>
        </dl>
      )}
      {history.length > 0 && (
        <>
          <Text weight="semibold" size={200}>
            {t("office.employee.appointmentHistory")}
          </Text>
          <ul className={o.list} aria-label={t("office.employee.appointmentHistory")}>
            {history.map((a) => (
              <li key={a.id} className={o.item}>
                <div className={o.between}>
                  <Text weight="semibold" size={200}>
                    {appointmentShown(t, a)}
                  </Text>
                  <AppointmentStateBadge state={a.state} />
                </div>
                <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
                  {t("office.employee.appointmentMeta", { revision: a.slotRevision, at: when(a.appointedAt), by: humanizeActor(a.appointedBy, peopleList, t).label })}
                  {a.endedAt ? t("office.employee.appointmentEnded", { at: when(a.endedAt), by: humanizeActor(a.endedBy, peopleList, t).label }) : ""}
                  {a.endReason ? t("office.employee.appointmentEndReason", { reason: a.endReason }) : ""}
                </Text>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function AssignmentList({ items, go, label, empty }: { items: AssignmentSummary[]; go: Go; label: string; empty: string }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const s = useStyles();
  if (items.length === 0)
    return (
      <Text size={200} className={o.muted}>
        {empty}
      </Text>
    );
  return (
    <ul className={o.list} aria-label={label}>
      {items.map((a) => (
        <li key={a.id} className={s.assignmentItem}>
          <div className={o.stack} style={{ flexGrow: 1 }}>
            <div className={o.row}>
              <StateBadge text={ASSIGNMENT_STATE_TEXT[a.state]} state={a.state} />
              <Link className="orbit-target" as="button" onClick={() => go("mission", a.missionId)} style={{ fontWeight: 600, textAlign: "left" }}>
                {a.title}
              </Link>
            </div>
            <Text size={200} className={o.muted}>
              {t("office.employee.updatedAt", { at: when(a.updatedAt) })}
              {a.reason ? ` · ${a.reason}` : ""}
              {a.waitingOn ? t("office.employee.waitingOn", { what: humanizeWaitingOn(a.waitingOn, t) }) : ""}
            </Text>
          </div>
          <ChevronRight16Regular className={s.chevron} aria-hidden />
        </li>
      ))}
    </ul>
  );
}

// HOW AN EMPLOYEE RUNS, changed in place: a connection that can run employees now (the server says which: employeeReady), a
// model of that connection's own catalog and an effort the model takes -- or both left to its department's default,
// else the company's. Web search stays on only where the new connection offers it; the Orbit plugin only on the Claude
// Code connection it was granted on. The server holds the change to the same rules as a hire (an OpenAI Codex model
// observed held to Orbit's tools, above all).
function RunsOnForm({ e, onSaved, onCancel }: { e: EmployeeDetail; onSaved: (d: EmployeeDetail) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const s = useStyles();
  const act = useAction();
  const connections = useConnections();
  const x = e.profile.execution;
  const ready = (connections.data?.connections ?? []).filter(usableForEmployees);
  const [connectionId, setConnectionId] = useState<string | null>(x.connectionId);
  const [modelId, setModelId] = useState<string | null>(x.model);
  const [effortId, setEffortId] = useState<string | null>(x.effort);
  const [inherit, setInherit] = useState(inheritsModel(x));
  // Its department's and the company's defaults, read only once the model and effort are left to them.
  const roster = useOfficeRead<Roster>(inherit ? () => office.roster({ department: null, q: "", status: null }) : null, [inherit], ["roster"]);
  const connection = ready.find((c) => c.id === connectionId) ?? ready[0] ?? null;
  const models = connection?.catalog.models ?? [];
  const model = models.find((m) => m.id === modelId) ?? models.find((m) => m.id === connection?.catalog.recommended) ?? models[0] ?? null;
  const effort = model === null || model.efforts.length === 0 ? null : effortId !== null && model.efforts.includes(effortId) ? effortId : effortFor(model, "medium");
  const save = () =>
    act.run(async () => {
      if (connection === null || (model === null && !inherit)) return;
      const own = { runtime: connection.runtime, connectionId: connection.id, webSearch: x.webSearch && connection.capabilities.webSearch === "yes", orbitPlugin: x.orbitPlugin && connection.runtime === "claude" && connection.id === x.connectionId };
      const execution: ExecutionProfile = inherit || model === null ? { ...own, model: "", effort: null, inherit: [...INHERITED] } : { ...own, model: model.id, effort };
      onSaved(await office.updateEmployee(e, { profile: { ...e.profile, execution }, note: t("office.employee.runsOnNote", { runtime: RUNTIME_LABELS[connection.runtime], label: connection.label, model: inherit || model === null ? t("office.employee.defaultModelNote") : model.label }) }));
    });
  if (connections.data === null) return <Spinner size="tiny" label={t("office.hire.readingConnections")} />;
  return (
    <form
      aria-label={t("office.employee.runsOnFormAria")}
      className={s.inlineFormBox}
      onSubmit={(ev) => {
        ev.preventDefault();
        void save();
      }}
    >
      <div className={o.formGrid}>
        <Field label={t("office.hire.connectionLabel")} hint={t("office.employee.runsOnConnectionHint")}>
          <Select
            value={connection?.id ?? ""}
            onChange={(_, d) => {
              setConnectionId(d.value);
              setModelId(null);
              setEffortId(null);
            }}
          >
            {ready.map((c) => (
              <option key={c.id} value={c.id}>
                {`${RUNTIME_LABELS[c.runtime]} — ${c.label}`}
              </option>
            ))}
          </Select>
        </Field>
        {!inherit && (
          <Field label={t("office.hire.modelLabel")} hint={t("office.hire.modelHint")}>
            <Select
              value={model?.id ?? ""}
              onChange={(_, d) => {
                setModelId(d.value);
                setEffortId(null);
              }}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {connection?.catalog.recommended === m.id ? t("office.hire.recommendedSuffix") : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {!inherit && (
          <Field label={t("office.hire.effortLabel")} hint={model && model.efforts.length === 0 ? t("office.hire.effortNoLevelHint") : t("office.hire.effortHint")}>
            <Select value={effort ?? ""} disabled={model === null || model.efforts.length === 0} onChange={(_, d) => setEffortId(d.value)}>
              {model?.efforts.length === 0 && <option value="">{t("office.hire.noEffortOption")}</option>}
              {(model?.efforts ?? []).map((v) => (
                <option key={v} value={v}>
                  {effortLabel(v)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <Checkbox checked={inherit} onChange={(_, d) => setInherit(d.checked === true)} label={t("office.hire.inheritLabel")} />
      {inherit && connection !== null && roster.data !== null && <DefaultsThatApply connection={connection} department={roster.data.departments.find((d) => d.id === e.departmentId) ?? null} company={roster.data.office?.defaults ?? null} />}
      <div className={s.actionRow}>
        <Button type="submit" appearance="primary" disabled={act.busy || connection === null || (model === null && !inherit)}>
          {t("office.employee.saveRunsOn")}
        </Button>
        <Button onClick={onCancel}>{t("office.assign.cancel")}</Button>
      </div>
      <ProblemBar problem={act.problem} />
    </form>
  );
}

function ProfileTab({ e, go, onSaved, onLoadLatest }: { e: EmployeeDetail; go: Go; onSaved: (d: EmployeeDetail) => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const s = useStyles();
  const act = useAction();
  const p = e.profile;
  const [title, setTitle] = useState(p.title);
  const [duties, setDuties] = useState(p.duties);
  const [instructions, setInstructions] = useState(p.instructions);
  const [skills, setSkills] = useState(p.skills.join(", "));
  const [languages, setLanguages] = useState(p.languages.join(", "));
  const [handoff, setHandoff] = useState(p.handoffStandard);
  const [assistants, setAssistants] = useState(p.maxAssistants);
  const [note, setNote] = useState("");
  // Whether the CEO can draft this profile now.
  const executiveState = useExecutiveState();
  const listOf = (v: string): string[] => v.split(",").map((x) => x.trim()).filter((x) => x.length > 0);
  const changed = title.trim() !== p.title || duties.trim() !== p.duties || instructions.trim() !== p.instructions || listOf(skills).join("\n") !== p.skills.join("\n") || listOf(languages).join("\n") !== p.languages.join("\n") || handoff.trim() !== p.handoffStandard || assistants !== p.maxAssistants;
  const save = () => act.run(async () => onSaved(await office.updateEmployee(e, { profile: { ...p, title: title.trim(), duties: duties.trim(), instructions: instructions.trim(), skills: listOf(skills), languages: listOf(languages), handoffStandard: handoff.trim(), maxAssistants: assistants }, note: note.trim() })));
  const reset = () => {
    setTitle(p.title);
    setDuties(p.duties);
    setInstructions(p.instructions);
    setSkills(p.skills.join(", "));
    setLanguages(p.languages.join(", "));
    setHandoff(p.handoffStandard);
    setAssistants(p.maxAssistants);
    setNote("");
  };
  const fill = (f: DraftFields) => {
    setTitle(f.title);
    setDuties(f.duties);
    setInstructions(f.instructions);
    setSkills(f.skills);
    setLanguages(f.languages);
    setHandoff(f.handoffStandard);
  };
  const restore = (revision: number) =>
    act.run(async () => {
      const old = await office.profileRevision(e.id, revision);
      onSaved(await office.updateEmployee(e, { profile: old.profile, basedOn: revision, note: t("office.employee.restoredNote", { revision }) }));
    });
  const x = p.execution;
  const [changing, setChanging] = useState(false);
  const connections = useOfficeRead<AiConnectionsView>(x.connectionId !== null ? () => get("/api/connections") : null, [x.connectionId], ["connections"]);
  const conn = x.connectionId ? connections.data?.connections.find((c) => c.id === x.connectionId) : undefined;
  const needsCreatorNames = e.revisions.some((r) => r.createdBy.includes("employee:") && !r.createdBy.endsWith(e.id));
  const creatorRoster = useOfficeRead<Roster>(needsCreatorNames ? () => wholeRoster() : null, [needsCreatorNames], ["roster"]);
  const creatorList = [{ employeeId: e.id, employeeName: e.name }, ...(creatorRoster.data?.employees.map((emp) => ({ employeeId: emp.id, employeeName: emp.name })) ?? [])];
  return (
    <div className={s.colStack}>
      <div className={s.twoCol}>
        <form
          className={o.card}
          aria-label={t("office.employee.roleAria")}
          onSubmit={(ev) => {
            ev.preventDefault();
            void save();
          }}
        >
          <div className={o.between}>
            <div className={s.sectionHead}>
              <IconBadge icon={<Person16Regular />} tone="brand" size="md" />
              <div className={s.sectionTitleWrap}>
                <Text weight="semibold" size={400}>
                  {t("office.employee.roleTitle", { revision: e.profileRevision })}
                </Text>
                <Text size={200} className={o.muted}>
                  {t("office.employee.roleSubtitle")}
                </Text>
              </div>
            </div>
            {changed && (
              <Badge appearance="tint" color="warning" style={{ borderRadius: "9999px" }}>
                {t("office.employee.unsavedChanges")}
              </Badge>
            )}
          </div>
          <div className={o.divider} />
          <DraftWithAi form={{ title, duties, instructions, skills, languages, handoffStandard: handoff }} departmentId={e.departmentId} departmentName={null} state={executiveState.data} onFill={fill} />
          <Field label={t("office.hire.roleTitleLabel")} required>
            <Input value={title} onChange={(_, d) => setTitle(d.value)} />
          </Field>
          <Field label={t("office.hire.dutiesLabel")} hint={t("office.employee.dutiesHint")}>
            <Textarea value={duties} rows={3} resize="vertical" onChange={(_, d) => setDuties(d.value)} />
          </Field>
          <Field label={t("office.hire.instructionsLabel")} hint={t("office.employee.instructionsHint")}>
            <Textarea value={instructions} rows={5} resize="vertical" onChange={(_, d) => setInstructions(d.value)} />
          </Field>
          <Field label={t("office.hire.skillsLabel")} hint={t("office.hire.languagesHint")}>
            <Input value={skills} onChange={(_, d) => setSkills(d.value)} />
          </Field>
          <Field label={t("office.hire.languagesLabel")} hint={t("office.hire.languagesHint")}>
            <Input value={languages} onChange={(_, d) => setLanguages(d.value)} />
          </Field>
          <Field label={t("office.hire.handoffLabel")} hint={t("office.hire.handoffHint")}>
            <Input value={handoff} onChange={(_, d) => setHandoff(d.value)} />
          </Field>
          <AssistantsField value={assistants} onChange={setAssistants} />
          <Field label={t("office.employee.whyChangesLabel")} hint={t("office.employee.whyChangesHint")}>
            <Input value={note} placeholder={t("office.employee.whyChangesPlaceholder")} onChange={(_, d) => setNote(d.value)} />
          </Field>
          <div className={o.inset}>
            <Text size={200} className={o.muted}>
              {t("office.employee.skillsLanguagesLine", {
                skills: p.skills.join(", ") || t("office.employee.noneNamed"),
                languages: p.languages.join(", ") || t("office.employee.noneNamed"),
              })}
            </Text>
            {(p.skills.length > 0 || p.languages.length > 0) && (
              <div className={s.chipRow}>
                {p.skills.map((sk) => (
                  <Badge key={`sk-${sk}`} appearance="tint" color="brand" size="small" style={{ borderRadius: "9999px" }}>
                    {sk}
                  </Badge>
                ))}
                {p.languages.map((lg) => (
                  <Badge key={`lg-${lg}`} appearance="outline" color="subtle" size="small" style={{ borderRadius: "9999px" }}>
                    {lg}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          <div className={s.actionRow}>
            <Button type="submit" appearance="primary" disabled={act.busy || !changed || title.trim() === ""}>
              {t("office.employee.saveRevision")}
            </Button>
            {changed && (
              <Button type="button" appearance="subtle" disabled={act.busy} onClick={reset}>
                {t("office.employee.discardChanges")}
              </Button>
            )}
          </div>
        </form>

        <div className={s.colStack}>
          <RoleCard e={e} go={go} />
          <section className={o.card} aria-label={t("office.employee.howItRuns")}>
            <div className={o.between}>
              <div className={s.sectionHead}>
                <IconBadge icon={<Code16Regular />} tone="teal" size="md" />
                <div className={s.sectionTitleWrap}>
                  <Text weight="semibold" size={400}>
                    {t("office.employee.howItRuns")}
                  </Text>
                  <Text size={200} className={o.muted}>
                    {t("office.employee.howItRunsSub")}
                  </Text>
                </div>
              </div>
              {!changing && (
                <Button size="small" icon={<Edit16Regular />} onClick={() => setChanging(true)}>
                  {t("office.employee.changeHowItRuns")}
                </Button>
              )}
            </div>
            {changing && (
              <RunsOnForm
                e={e}
                onSaved={(d) => {
                  setChanging(false);
                  onSaved(d);
                }}
                onCancel={() => setChanging(false)}
              />
            )}
            <div className={o.divider} />
            <dl className={s.kvGrid} style={{ margin: 0 }}>
              <div className={s.kvCell}>
                <dt className={o.dt} style={{ fontSize: tokens.fontSizeBase100 }}>
                  {t("office.hire.choiceRuntime")}
                </dt>
                <dd className={o.dd} style={{ fontWeight: 600 }}>
                  {RUNTIME_LABELS[x.runtime]}
                </dd>
              </div>
              <div className={s.kvCell}>
                <dt className={o.dt} style={{ fontSize: tokens.fontSizeBase100 }}>
                  {t("office.hire.choiceModel")}
                </dt>
                <dd className={o.dd} style={{ fontWeight: 600 }}>
                  {modelShown(t, x)}
                </dd>
              </div>
              <div className={s.kvCell}>
                <dt className={o.dt} style={{ fontSize: tokens.fontSizeBase100 }}>
                  {t("office.hire.choiceEffort")}
                </dt>
                <dd className={o.dd}>{effortShown(t, x)}</dd>
              </div>
              <div className={s.kvCell}>
                <dt className={o.dt} style={{ fontSize: tokens.fontSizeBase100 }}>
                  {t("office.employee.deskLabel")}
                </dt>
                <dd className={o.dd}>
                  {t("office.employee.deskValue", { version: e.desk.version, files: e.desk.files })} ·{" "}
                  <Link href={`#/governance/desks/${encodeURIComponent(e.id)}`} inline>
                    {t("office.employee.lookIntoIt")}
                  </Link>
                </dd>
              </div>
              <div className={s.kvCell}>
                <dt className={o.dt} style={{ fontSize: tokens.fontSizeBase100 }}>
                  {t("office.hire.choiceWebSearch")}
                </dt>
                <dd className={o.dd}>
                  <Badge appearance="tint" color={x.webSearch ? "success" : "subtle"} size="small" style={{ borderRadius: "9999px" }}>
                    {x.webSearch ? t("office.hire.on") : t("office.hire.off")}
                  </Badge>
                </dd>
              </div>
              <div className={s.kvCell}>
                <dt className={o.dt} style={{ fontSize: tokens.fontSizeBase100 }}>
                  {t("office.hire.choicePlugin")}
                </dt>
                <dd className={o.dd}>
                  <Badge appearance="tint" color={x.orbitPlugin ? "brand" : "subtle"} size="small" style={{ borderRadius: "9999px" }}>
                    {x.orbitPlugin ? t("office.employee.pluginOnSkillsOnly") : t("office.hire.off")}
                  </Badge>
                </dd>
              </div>
              <div className={mergeClasses(s.kvCell, s.kvFull)}>
                <dt className={o.dt} style={{ fontSize: tokens.fontSizeBase100 }}>
                  {t("office.employee.connectionField")}
                </dt>
                <dd className={o.dd}>
                  {conn ? (
                    <span title={x.connectionId ?? undefined}>{`${RUNTIME_LABELS[conn.runtime]} — ${conn.label}`}</span>
                  ) : x.connectionId ? (
                    <span className={o.mono}>{x.connectionId}</span>
                  ) : (
                    t("office.employee.accountDefault")
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className={o.card} aria-label={t("office.employee.profileHistory")}>
            <div className={o.between}>
              <div className={s.sectionHead}>
                <IconBadge icon={<History16Regular />} tone="neutral" size="md" />
                <div className={s.sectionTitleWrap}>
                  <Text weight="semibold" size={400}>
                    {t("office.employee.profileHistory")}
                  </Text>
                  <Text size={200} className={o.muted}>
                    {t("office.employee.revisionsRecorded", {
                      count: e.revisions.length,
                      word: t(e.revisions.length === 1 ? "office.employee.revisionOne" : "office.employee.revisionMany"),
                    })}
                  </Text>
                </div>
              </div>
            </div>
            <ul className={o.list}>
              {[...e.revisions]
                .sort((a, b) => b.revision - a.revision)
                .map((r) => {
                  const isCurrent = r.revision === e.profileRevision;
                  return (
                    <li key={r.revision} className={mergeClasses(o.item, isCurrent && s.revisionCurrent)}>
                      <div className={o.between}>
                        <div className={o.row}>
                          <Text weight="semibold" size={200}>
                            {t("office.employee.revisionLabel", { revision: r.revision })}
                            {isCurrent ? t("office.employee.currentSuffix") : ""}
                          </Text>
                          {isCurrent && (
                            <Badge appearance="tint" color="brand" size="small" style={{ borderRadius: "9999px" }}>
                              {t("office.employee.activeBadge")}
                            </Badge>
                          )}
                        </div>
                        {!isCurrent && (
                          <Button className={o.touch} size="small" appearance="subtle" icon={<ArrowCounterclockwise16Regular />} disabled={act.busy} onClick={() => void restore(r.revision)}>
                            {t("office.employee.restoreRevision", { revision: r.revision })}
                          </Button>
                        )}
                      </div>
                      <Text size={200} className={o.muted}>
                        {t("office.employee.revisionMeta", { at: when(r.createdAt), by: humanizeActor(r.createdBy, creatorList, t).label })}
                        {r.basedOn ? t("office.employee.copiedFrom", { revision: r.basedOn }) : ""}
                        {r.note ? ` · ${r.note}` : ""}
                      </Text>
                    </li>
                  );
                })}
            </ul>
          </section>
        </div>
      </div>
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
    </div>
  );
}

function WorkTab({ e, go, onAssign }: { e: EmployeeDetail; go: Go; onAssign: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const s = useStyles();
  return (
    <div className={s.colStack}>
      <section className={o.card} aria-label={t("office.employee.workingOn")}>
        <div className={o.between}>
          <div className={s.sectionHead}>
            <IconBadge icon={<TaskListLtr20Regular />} tone={e.holding ? "brand" : "success"} size="md" />
            <div className={s.sectionTitleWrap}>
              <Text weight="semibold" size={400}>
                {t("office.employee.workingOn")}
              </Text>
              <Text size={200} className={o.muted}>
                {t("office.employee.workingOnSub")}
              </Text>
            </div>
          </div>
          {e.holding && <StateBadge text={ASSIGNMENT_STATE_TEXT[e.holding.state]} state={e.holding.state} />}
        </div>
        {e.holding ? (
          <div className={s.holdingSpotlight}>
            <div className={o.between}>
              <Link className="orbit-target" as="button" onClick={() => go("mission", e.holding?.missionId ?? null)} style={{ fontWeight: 600, fontSize: tokens.fontSizeBase400, textAlign: "left" }}>
                {e.holding.title}
              </Link>
              <Button size="small" appearance="subtle" icon={<ChevronRight16Regular />} iconPosition="after" onClick={() => go("mission", e.holding?.missionId ?? null)}>
                {t("office.employee.openMission")}
              </Button>
            </div>
            <Text size={200} className={o.muted}>
              {t("office.employee.since", { at: when(e.holding.since) })}
            </Text>
            {e.workLabel.startsWith("waiting") && (
              <Callout tone="warn" icon={<Clock16Regular />}>
                {t("office.employee.waitingLabel")}
                <WorkLabelBadge label={e.workLabel} />
              </Callout>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<TaskListLtr20Regular />}
            tone="success"
            title={t("office.employee.freeForWork")}
            body={t("office.employee.freeForWorkSub")}
            action={
              e.employment !== "archived" ? (
                <Button size="small" appearance="primary" onClick={onAssign}>
                  {t("office.overview.assignWork")}
                </Button>
              ) : undefined
            }
          />
        )}
      </section>

      <div className={s.equalCols}>
        <section className={o.card} aria-label={t("office.employee.queueCardAria")}>
          <div className={o.between}>
            <div className={s.sectionHead}>
              <IconBadge icon={<Clock16Regular />} tone="warning" size="md" />
              <Text weight="semibold" size={400}>
                {t("office.employee.queueTitle", { count: e.queue.length })}
              </Text>
            </div>
            <Badge appearance="tint" color={e.queue.length > 0 ? "warning" : "subtle"} style={{ borderRadius: "9999px" }}>
              {e.queue.length}
            </Badge>
          </div>
          <AssignmentList items={e.queue} go={go} label={t("office.employee.queuedWorkAria")} empty={t("office.employee.queueEmpty")} />
        </section>

        <section className={o.card} aria-label={t("office.employee.historyTitle")}>
          <div className={o.between}>
            <div className={s.sectionHead}>
              <IconBadge icon={<History16Regular />} tone="neutral" size="md" />
              <Text weight="semibold" size={400}>
                {t("office.employee.historyTitle")}
              </Text>
            </div>
            <Badge appearance="tint" color="subtle" style={{ borderRadius: "9999px" }}>
              {e.history.length}
            </Badge>
          </div>
          <AssignmentList items={e.history} go={go} label={t("office.employee.pastWorkAria")} empty={t("office.employee.historyEmpty")} />
        </section>
      </div>
    </div>
  );
}

function EditResources({ e, onSaved, onCancel, onLoadLatest }: { e: EmployeeDetail; onSaved: (d: EmployeeDetail) => void; onCancel: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const s = useStyles();
  const act = useAction();
  const summary = useResourceSummary();
  const presetsRead = useResource<ResourcePreset[]>(() => office.presets(), []);
  const presets = presetsRead.data ?? (presetsRead.error ? DEFAULT_PRESETS : []);
  const current = e.sandbox.resources;
  const [value, setValue] = useState<ResourceProfile>(current);
  const [note, setNote] = useState("");
  const committed = current.deskStorageMiB + current.cacheStorageMiB;
  const problems = [...resourceProblems(value, summary.data?.budget.perEmployee ?? null), ...(storageProblem(value, summary.data, committed) ? ["storage"] : [])];
  const changed = JSON.stringify(value) !== JSON.stringify(current);
  return (
    <form
      className={o.card}
      aria-label={t("office.employee.editResources")}
      onSubmit={(ev) => {
        ev.preventDefault();
        void act.run(async () => onSaved(await office.updateResources(e, { resources: value, note: note.trim() })));
      }}
    >
      <div className={o.between}>
        <div className={s.sectionHead}>
          <IconBadge icon={<Settings16Regular />} tone="brand" size="md" />
          <div className={s.sectionTitleWrap}>
            <Text weight="semibold" size={400}>
              {t("office.employee.editResources")}
            </Text>
            <Text size={200} className={o.muted}>
              {t("office.employee.editResourcesSub")}
            </Text>
          </div>
        </div>
      </div>
      <div className={o.divider} />
      <ResourceFields value={value} onChange={setValue} presets={presets} summary={summary.data} runtime={e.execution.runtime} committed={committed} />
      <Field label={t("office.employee.whyChangesLabel")} hint={t("office.employee.whyChangesHint")}>
        <Input value={note} onChange={(_, d) => setNote(d.value)} />
      </Field>
      <div className={s.actionRow}>
        <Button type="submit" appearance="primary" disabled={act.busy || !changed || problems.length > 0}>
          {t("office.employee.saveResources")}
        </Button>
        <Button type="button" onClick={onCancel} disabled={act.busy}>
          {t("office.assign.cancel")}
        </Button>
      </div>
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
    </form>
  );
}

function ResourcesTab({ e, onSaved, onLoadLatest }: { e: EmployeeDetail; onSaved: (d: EmployeeDetail) => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const s = useStyles();
  const [editing, setEditing] = useState(false);
  const needsCreatorNames = e.resourceRevisions.some((rv) => rv.createdBy.includes("employee:") && !rv.createdBy.endsWith(e.id));
  const creatorRoster = useOfficeRead<Roster>(needsCreatorNames ? () => wholeRoster() : null, [needsCreatorNames], ["roster"]);
  const creatorList = [{ employeeId: e.id, employeeName: e.name }, ...(creatorRoster.data?.employees.map((emp) => ({ employeeId: emp.id, employeeName: emp.name })) ?? [])];
  const sb = e.sandbox;
  const r = sb.resources;
  const run = e.activeRun;
  const specs = [
    { key: "cpu", label: t("office.employee.tileCpu"), value: cpuText(r.cpuMillis) },
    { key: "mem", label: t("office.employee.tileMemory"), value: sizeText(r.memoryMiB) },
    { key: "desk", label: t("office.employee.tileDesk"), value: sizeText(r.deskStorageMiB) },
    { key: "scratch", label: t("office.employee.tileScratch"), value: sizeText(r.scratchStorageMiB) },
    { key: "cache", label: t("office.employee.tileCache"), value: sizeText(r.cacheStorageMiB) },
    { key: "pids", label: t("office.employee.tileProcesses"), value: `${r.pidsLimit}` },
    { key: "time", label: t("office.employee.tileTimeLimit"), value: t("office.employee.tileTimeValue", { minutes: r.timeoutMinutes }) },
  ];
  return (
    <div className={s.colStack}>
      <section className={o.card} aria-label={t("office.employee.personalSandbox")}>
        <div className={o.between}>
          <div className={s.sectionHead}>
            <IconBadge icon={<Box16Regular />} tone={sb.state === "READY" ? "success" : sb.state === "FAILED" ? "danger" : "warning"} size="md" />
            <div className={o.row}>
              <Text weight="semibold" size={400}>
                {t("office.employee.personalSandbox")}
              </Text>
              <Badge appearance="tint" color={sb.state === "READY" ? "success" : sb.state === "FAILED" ? "danger" : sb.state === "PROVISIONING" ? "warning" : "subtle"} style={{ borderRadius: "9999px" }}>
                {t(SANDBOX_KEYS[sb.state])}
              </Badge>
              {sb.provider === "process" && (
                <Badge appearance="outline" color="warning" style={{ borderRadius: "9999px" }}>
                  {t("office.employee.devOnly")}
                </Badge>
              )}
            </div>
          </div>
          <div className={o.row} style={{ gap: "6px" }}>
            {(sb.state === "READY" || sb.state === "ARCHIVED") && (
              <Button as="a" href={`#/governance/desks/${encodeURIComponent(e.id)}`} className={o.touch} appearance="subtle" size="small">
                {t("office.employee.openDeskFiles")}
              </Button>
            )}
            <Button className={o.touch} icon={<Edit16Regular />} disabled={editing || sb.state === "ARCHIVED"} onClick={() => setEditing(true)}>
              {t("office.employee.editResources")}
            </Button>
          </div>
        </div>
        {sb.reason && (
          <Callout tone="warn" icon={<Warning16Regular />}>
            {sb.reason}
          </Callout>
        )}
        <Text size={200} className={o.muted}>
          {t("office.employee.resourcesLine", {
            revision: sb.resourceRevision,
            cpu: cpuText(r.cpuMillis),
            memory: sizeText(r.memoryMiB),
            desk: sizeText(r.deskStorageMiB),
            scratch: sizeText(r.scratchStorageMiB),
            cache: sizeText(r.cacheStorageMiB),
            pids: r.pidsLimit,
            timeout: r.timeoutMinutes,
          })}
        </Text>
        <div className={s.resourceTiles}>
          {specs.map((item) => (
            <div key={item.key} className={s.resourceTile}>
              <Text size={100} className={o.muted}>
                {item.label}
              </Text>
              <Text className={s.resourceValue}>{item.value}</Text>
            </div>
          ))}
        </div>
        <div className={o.divider} />
        <div className={o.tableWrap}>
          <Table size="small" aria-label={t("office.employee.storageAreasAria")}>
            <TableHeader>
              <TableRow>
                <TableHeaderCell style={{ width: "165px" }}>{t("office.employee.colArea")}</TableHeaderCell>
                <TableHeaderCell style={{ width: "92px" }}>{t("office.employee.colQuota")}</TableHeaderCell>
                <TableHeaderCell style={{ width: "104px" }}>{t("office.employee.colUsed")}</TableHeaderCell>
                <TableHeaderCell>{t("office.employee.colEnforcement")}</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sb.areas.map((a) => {
                const pct = a.usedMiB !== null && a.quotaMiB > 0 ? Math.min(100, Math.round((a.usedMiB / a.quotaMiB) * 100)) : null;
                return (
                  <TableRow key={a.area}>
                    <TableCell>{AREA_TEXT[a.area]}</TableCell>
                    <TableCell style={{ whiteSpace: "nowrap" }}>{sizeText(a.quotaMiB)}</TableCell>
                    <TableCell style={{ whiteSpace: "nowrap" }}>
                      <div className={s.usageCell}>
                        <span>{a.usedMiB === null ? t("office.employee.notMeasured") : sizeText(a.usedMiB)}</span>
                        {pct !== null && (
                          <div className={s.usageTrack} aria-hidden>
                            <div
                              className={mergeClasses(s.usageFill, pct >= 90 ? s.usageFillDanger : pct >= 70 ? s.usageFillWarn : undefined)}
                              style={{ width: `${Math.max(pct, a.usedMiB && a.usedMiB > 0 ? 4 : 0)}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge appearance="tint" color={LEVEL_TONE[a.level]} style={{ height: "auto", minHeight: "20px", paddingTop: "3px", paddingBottom: "3px", whiteSpace: "normal", textAlign: "left", lineHeight: "1.3" }}>
                        {LEVEL_TEXT[a.level]}
                      </Badge>
                      <Text size={200} className={o.muted} block style={{ marginTop: "4px", overflowWrap: "anywhere" }}>
                        {a.evidence}
                      </Text>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
      {editing && (
        <EditResources
          e={e}
          onSaved={(d) => {
            setEditing(false);
            onSaved(d);
          }}
          onCancel={() => setEditing(false)}
          onLoadLatest={onLoadLatest}
        />
      )}
      <div className={s.twoCol}>
        <section className={o.card} aria-label={t("office.employee.attemptNow")}>
          <div className={s.sectionHead}>
            <IconBadge icon={<Code16Regular />} tone={run ? "brand" : "neutral"} size="md" />
            <div className={s.sectionTitleWrap}>
              <Text weight="semibold" size={400}>
                {t("office.employee.attemptNow")}
              </Text>
              <Text size={200} className={o.muted}>
                {t("office.employee.attemptNowSub")}
              </Text>
            </div>
          </div>
          {run ? <RunDetails run={run} /> : <Text className={o.muted}>{t("office.employee.noAttemptNow")}</Text>}
        </section>

        <section className={o.card} aria-label={t("office.employee.resourceHistory")}>
          <div className={s.sectionHead}>
            <IconBadge icon={<History16Regular />} tone="neutral" size="md" />
            <div className={s.sectionTitleWrap}>
              <Text weight="semibold" size={400}>
                {t("office.employee.resourceHistory")}
              </Text>
              <Text size={200} className={o.muted}>
                {t("office.employee.revisionsRecorded", {
                  count: e.resourceRevisions.length,
                  word: t(e.resourceRevisions.length === 1 ? "office.employee.revisionOne" : "office.employee.revisionMany"),
                })}
              </Text>
            </div>
          </div>
          <ul className={o.list}>
            {[...e.resourceRevisions]
              .sort((a, b) => b.revision - a.revision)
              .map((rv) => {
                const isCurrent = rv.revision === sb.resourceRevision;
                return (
                  <li key={rv.revision} className={mergeClasses(o.item, isCurrent && s.revisionCurrent)}>
                    <div className={o.between}>
                      <Text weight="semibold" size={200}>
                        {t("office.employee.revisionLabel", { revision: rv.revision })}
                        {isCurrent ? t("office.employee.currentSuffix") : ""}
                      </Text>
                      <Badge appearance="outline" size="small" style={{ borderRadius: "9999px" }}>
                        {rv.profile.presetId ? t("office.employee.presetTag", { name: rv.profile.presetId }) : t("office.employee.customTag")}
                      </Badge>
                    </div>
                    <Text size={200}>
                      {t("office.resources.profileLine", {
                        cpu: cpuText(rv.profile.cpuMillis),
                        memory: sizeText(rv.profile.memoryMiB),
                        desk: sizeText(rv.profile.deskStorageMiB),
                      })}
                      {" · "}
                      {rv.profile.presetId ? t("office.employee.presetTag", { name: rv.profile.presetId }) : t("office.employee.customTag")}
                    </Text>
                    <Text size={200} className={o.muted}>
                      {t("office.employee.revisionMeta", { at: when(rv.createdAt), by: humanizeActor(rv.createdBy, creatorList, t).label })}
                      {rv.note ? ` · ${rv.note}` : ""}
                    </Text>
                  </li>
                );
              })}
          </ul>
        </section>
      </div>
    </div>
  );
}

function EmploymentTab({ e, onSaved, onLoadLatest }: { e: EmployeeDetail; onSaved: (d: EmployeeDetail) => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const s = useStyles();
  const act = useAction();
  const roster = useOfficeRead<Roster>(() => office.roster({ department: null, q: "", status: null }), [], ["roster"]);
  const [command, setCommand] = useState<EmploymentCommand | null>(null);
  const [reason, setReason] = useState("");
  const [held, setHeld] = useState<"keep_paused" | "cancel">("keep_paused");
  const [departmentId, setDepartmentId] = useState(e.departmentId ?? "");
  const moves = MOVES[e.employment];
  const departments = (roster.data?.departments ?? []).filter((d) => !d.archived);
  // The CEO belongs to no department: its place is the Director's Office, and it is not moved into a department.
  const isCeo = e.role === "ceo";
  const currentDept = isCeo ? t("office.floor.directorsOffice") : (departments.find((d) => d.id === e.departmentId)?.name ?? t("office.overview.unassigned"));
  return (
    <div className={s.colStack}>
      <div className={s.twoCol}>
        <section className={o.card} aria-label={t("office.employee.kpiEmployment")}>
          <div className={o.between}>
            <div className={s.sectionHead}>
              <IconBadge icon={<Briefcase16Regular />} tone={e.employment === "active" ? "success" : e.employment === "suspended" ? "warning" : "neutral"} size="md" />
              <div className={s.sectionTitleWrap}>
                <Text weight="semibold" size={400}>
                  {t("office.employee.kpiEmployment")}
                </Text>
                <Text size={200} className={o.muted}>
                  {t("office.employee.employmentSub")}
                </Text>
              </div>
            </div>
            <Badge appearance="tint" color={EMPLOYMENT_TONE[e.employment]} style={{ borderRadius: "9999px" }}>
              {t(EMPLOYMENT_KEYS[e.employment])}
            </Badge>
          </div>
          <div className={o.divider} />
          {moves.length === 0 ? (
            <Callout tone="info" icon={<Shield16Regular />}>
              {t("office.employee.archivedReadOnly")}
            </Callout>
          ) : (
            <form
              className={o.form}
              onSubmit={(ev) => {
                ev.preventDefault();
                if (command === null) return;
                void act.run(async () => onSaved(await office.employment(e, { command, reason: reason.trim(), ...(command === "suspend" ? { held } : {}) })));
              }}
            >
              <RadioGroup value={command ?? ""} onChange={(_, d) => setCommand(d.value as EmploymentCommand)} aria-label={t("office.employee.whatToDoAria")} className={s.moveList}>
                {moves.map((m) => {
                  const selected = command === m;
                  const danger = MOVE_KEYS[m].danger === true;
                  return (
                    <div key={m} className={mergeClasses(s.moveCard, selected && (danger ? s.moveCardDanger : s.moveCardSelected))}>
                      <Radio value={m} label={`${t(MOVE_KEYS[m].labelKey)} — ${t(MOVE_KEYS[m].meansKey)}`} />
                    </div>
                  );
                })}
              </RadioGroup>
              {command === "suspend" && e.holding && (
                <div className={o.inset}>
                  <Field label={t("office.employee.whatHappensToHeld", { title: e.holding.title })}>
                    <RadioGroup value={held} onChange={(_, d) => setHeld(d.value as "keep_paused" | "cancel")}>
                      <Radio value="keep_paused" label={t("office.employee.keepPaused")} />
                      <Radio value="cancel" label={t("office.employee.cancelIt")} />
                    </RadioGroup>
                  </Field>
                </div>
              )}
              <Field label={t("office.employee.reasonLabel")} hint={t("office.employee.reasonHint")}>
                <Input value={reason} placeholder={t("office.employee.reasonPlaceholder")} onChange={(_, d) => setReason(d.value)} />
              </Field>
              <div className={s.actionRow}>
                <Button type="submit" appearance="primary" disabled={act.busy || command === null}>
                  {command ? t(MOVE_KEYS[command].labelKey) : t("office.employee.chooseWhatToDo")}
                </Button>
                {command !== null && (
                  <Button type="button" appearance="subtle" onClick={() => setCommand(null)}>
                    {t("office.employee.clearChoice")}
                  </Button>
                )}
              </div>
            </form>
          )}
        </section>

        <section className={o.card} aria-label={t("office.hire.choiceDept")}>
          <div className={o.between}>
            <div className={s.sectionHead}>
              <IconBadge icon={<Organization16Regular />} tone="teal" size="md" />
              <div className={s.sectionTitleWrap}>
                <Text weight="semibold" size={400}>
                  {t("office.hire.choiceDept")}
                </Text>
                <Text size={200} className={o.muted}>
                  {t("office.employee.deptSub")}
                </Text>
              </div>
            </div>
            <Badge appearance="outline" style={{ borderRadius: "9999px" }}>
              {currentDept}
            </Badge>
          </div>
          <div className={o.divider} />
          {isCeo ? (
            <Text size={200} className={o.muted}>
              {t("office.employee.ceoNoDepartment")}
            </Text>
          ) : (
            <div className={o.form}>
              <Field label={t("office.employee.moveToLabel")}>
                <Select value={departmentId} onChange={(_, d) => setDepartmentId(d.value)}>
                  <option value="">{t("office.overview.unassigned")}</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className={s.actionRow}>
                <Button className={o.touch} appearance="primary" disabled={act.busy || departmentId === (e.departmentId ?? "")} onClick={() => void act.run(async () => onSaved(await office.moveEmployee(e, departmentId === "" ? null : departmentId)))}>
                  {t("office.employee.move")}
                </Button>
              </div>
              <Text size={200} className={o.muted}>
                {t("office.employee.deptMoveNote")}
              </Text>
            </div>
          )}
        </section>
      </div>
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
    </div>
  );
}

export function EmployeePage({ id, tab, go }: { id: string; tab: string | null; go: Go }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const s = useStyles();
  const employee = useOfficeRead<EmployeeDetail>(() => office.employee(id), [id], ["roster", "missions", "connections"]);
  const floorPrefs = useFloorPrefs();
  const [assigning, setAssigning] = useState(false);
  const restore = useRestoreFocusTarget();
  const current: EmployeeTab = (EMPLOYEE_TABS as readonly string[]).includes(tab ?? "") ? (tab as EmployeeTab) : "profile";
  if (employee.data === null)
    return employee.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{employee.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner label={t("office.employee.readingEmployee")} />
    );
  const e = employee.data;
  const reload = () => void employee.reload();
  const saved = (d: EmployeeDetail) => employee.set(d);
  const workCount = (e.holding ? 1 : 0) + e.queue.length;
  const r = e.sandbox.resources;
  return (
    <div className={o.page}>
      <section className={o.heroCard} aria-label={e.name}>
        <div className={s.heroTop}>
          <div className={s.heroIdentity}>
            <div className={s.deskFrame}>
              <EmployeeDeskScene
                name={e.name}
                workLabel={e.workLabel}
                compact
                seed={e.id}
                executive={e.appointment?.role === "ceo"}
                avatarStyle={floorPrefs.prefs.avatarStyles[e.id]}
              />
              <Popover positioning="below-start">
                <PopoverTrigger disableButtonEnhancement>
                  <Button
                    size="small"
                    appearance="subtle"
                    className={s.avatarEditBtn}
                    icon={<Color16Regular />}
                    aria-label={t("office.floor.customizeLook")}
                    title={t("office.floor.customizeLook")}
                  />
                </PopoverTrigger>
                <PopoverSurface style={{ maxWidth: "min(92vw, 380px)" }}>
                  <div className={o.stack} style={{ gap: "8px" }}>
                    <Text weight="semibold" size={200}>
                      {t("office.floor.customizeLook")} — {e.name}
                    </Text>
                    <AvatarCustomizer
                      value={floorPrefs.prefs.avatarStyles[e.id]}
                      onChange={(next) => floorPrefs.setAvatarStyle(e.id, next)}
                    />
                  </div>
                </PopoverSurface>
              </Popover>
            </div>
            <div className={o.stack}>
              <div className={o.row}>
                <Text as="h2" weight="semibold" size={600} className={o.wrap}>
                  {e.name}
                </Text>
                <WorkLabelBadge label={e.workLabel} />
                <Badge appearance="tint" color={EMPLOYMENT_TONE[e.employment]} style={{ borderRadius: "9999px" }}>
                  {t(EMPLOYMENT_KEYS[e.employment])}
                </Badge>
              </div>
              <Text size={200} className={o.muted}>
                {e.title} · {runsOnShown(t, e.execution)}
              </Text>
              <div className={o.row}>
                <AsOf at={employee.loadedAt} />
                <Text size={200} className={o.muted}>
                  · {deskMoodText(e.workLabel)}
                </Text>
              </div>
            </div>
          </div>
          <Button className={o.touch} appearance="primary" icon={<TaskListLtr20Regular />} disabled={e.employment === "archived"} onClick={() => setAssigning(true)} {...restore}>
            {t("office.overview.assignWork")}
          </Button>
        </div>

        <div className={s.kpiStrip}>
          <button type="button" className={mergeClasses(s.kpiTile, current === "work" && s.kpiTileActive)} onClick={() => go("employee", id, "work")}>
            <span className={s.kpiLabel}>
              <TaskListLtr20Regular aria-hidden />
              {t("office.employee.kpiCurrentWork")}
            </span>
            <span className={s.kpiValue}>{e.holding ? e.holding.title : t("office.employee.kpiIdle")}</span>
            <span className={s.kpiSub}>
              {e.queue.length > 0 ? t("office.employee.kpiQueuePrefix", { count: e.queue.length }) : ""}
              {t("office.employee.kpiCompleted", { count: e.history.length })}
            </span>
          </button>

          <button type="button" className={mergeClasses(s.kpiTile, current === "resources" && s.kpiTileActive)} onClick={() => go("employee", id, "resources")}>
            <span className={s.kpiLabel}>
              <Box16Regular aria-hidden />
              {t("office.employee.kpiSandbox")}
            </span>
            <span className={s.kpiValue}>
              {cpuText(r.cpuMillis)} · {sizeText(r.memoryMiB)}
            </span>
            <span className={s.kpiSub}>
              {t("office.employee.kpiSandboxSub", { state: t(SANDBOX_KEYS[e.sandbox.state]), desk: sizeText(r.deskStorageMiB) })}
            </span>
          </button>

          <button type="button" className={mergeClasses(s.kpiTile, current === "profile" && s.kpiTileActive)} onClick={() => go("employee", id, "profile")}>
            <span className={s.kpiLabel}>
              <Code16Regular aria-hidden />
              {t("office.employee.kpiModelProfile")}
            </span>
            <span className={s.kpiValue}>{modelShown(t, e.execution)}</span>
            <span className={s.kpiSub}>
              {t("office.employee.kpiModelSub", { runtime: RUNTIME_LABELS[e.execution.runtime], revision: e.profileRevision })}
            </span>
          </button>

          <button type="button" className={mergeClasses(s.kpiTile, current === "employment" && s.kpiTileActive)} onClick={() => go("employee", id, "employment")}>
            <span className={s.kpiLabel}>
              <Briefcase16Regular aria-hidden />
              {t("office.employee.kpiEmployment")}
            </span>
            <span className={s.kpiValue}>{t(EMPLOYMENT_KEYS[e.employment])}</span>
            <span className={s.kpiSub}>
              {t("office.employee.kpiEmploymentSub", {
                version: e.desk.version,
                files: e.desk.files,
                fileWord: t(e.desk.files === 1 ? "office.employee.fileOne" : "office.employee.fileMany"),
              })}
            </span>
          </button>
        </div>

        {e.employment === "probation" && (
          <Callout tone="info" role="status">
            <div className={o.between}>
              <Text size={200}>{t("office.employee.probationNotice")}</Text>
              <Button size="small" appearance="primary" onClick={() => go("employee", id, "employment")}>
                {t("office.employee.activateAction")}
              </Button>
            </div>
          </Callout>
        )}
        {e.notReadyReason && (
          <Callout tone="danger" icon={<ErrorCircle16Regular />}>
            {t("office.floor.notReady", { reason: e.notReadyReason })}
          </Callout>
        )}
        {e.connectionWarning && (
          <Callout tone="warn" icon={<Warning16Regular />}>
            {t("office.floor.connectionWarn", { reason: e.connectionWarning })}
          </Callout>
        )}
      </section>

      <div className={`${o.tabStrip} orbit-hscroll`}>
        <div className={s.tabBarRow}>
          <TabList selectedValue={isAdvanced(current) ? "" : current} onTabSelect={(_, d) => go("employee", id, d.value as string)} aria-label={t("office.employee.tabsAria")}>
            {PRIMARY_EMPLOYEE_TABS.map((tabKey) => (
              <Tab key={tabKey} value={tabKey} icon={TAB_ICON[tabKey]}>
                <span className={s.tabLabel}>
                  <span>{t(TAB_KEYS[tabKey])}</span>
                  {tabKey === "work" && workCount > 0 && (
                    <Badge appearance="tint" color="brand" size="small" style={{ borderRadius: "9999px" }}>
                      {workCount}
                    </Badge>
                  )}
                </span>
              </Tab>
            ))}
          </TabList>
          <Menu>
            <MenuTrigger disableButtonEnhancement>
              <Button
                size="small"
                appearance="subtle"
                icon={<Settings16Regular />}
                className={mergeClasses(s.advancedTabBtn, isAdvanced(current) && s.advancedTabBtnActive)}
                aria-label={t("office.employee.tab.advancedAria")}
              >
                {isAdvanced(current)
                  ? t("office.employee.tab.advancedActive", { tab: t(TAB_KEYS[current]) })
                  : t("office.employee.tab.advanced")}{" "}
                <ChevronDown16Regular aria-hidden style={{ verticalAlign: "middle", marginLeft: "2px" }} />
              </Button>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuGroup>
                  <MenuGroupHeader>{t("office.mission.advancedMenuHeader")}</MenuGroupHeader>
                  {ADVANCED_EMPLOYEE_TABS.map((tabKey) => (
                    <MenuItem key={tabKey} icon={TAB_ICON[tabKey]} onClick={() => go("employee", id, tabKey)}>
                      <div className={s.menuItemBody}>
                        <Text weight={current === tabKey ? "semibold" : "regular"}>{t(TAB_KEYS[tabKey])}</Text>
                        <span className={s.menuItemSub}>{t(ADVANCED_EMP_TAB_DESC[tabKey])}</span>
                      </div>
                    </MenuItem>
                  ))}
                </MenuGroup>
              </MenuList>
            </MenuPopover>
          </Menu>
        </div>
      </div>

      {current === "profile" && <ProfileTab key={e.version} e={e} go={go} onSaved={saved} onLoadLatest={reload} />}
      {current === "work" && <WorkTab e={e} go={go} onAssign={() => setAssigning(true)} />}
      {current === "access" && <AccessTab e={e} onChanged={() => employee.reload()} />}
      {current === "resources" && <ResourcesTab key={e.version} e={e} onSaved={saved} onLoadLatest={reload} />}
      {current === "employment" && <EmploymentTab key={e.version} e={e} onSaved={saved} onLoadLatest={reload} />}
      {current === "security" && <EmployeeRuntimeSecurityTab employeeId={e.id} />}
      {assigning && <AssignDialog employees={[e]} employeeId={e.id} onClose={() => setAssigning(false)} onOpenMission={(m) => go("mission", m)} />}
    </div>
  );
}
