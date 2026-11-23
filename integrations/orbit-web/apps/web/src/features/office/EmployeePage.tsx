// ONE EMPLOYEE: its profile (each change a revision, any revision restorable), its work (what it holds, what waits behind
// it, what it did), its Personal Sandbox and resources (the areas and how each limit is enforced, the attempt running now
// and what its containers use, the resource revisions, and an edit that applies to future attempts), and its employment
// -- each move with its reason. Every change names the version read; a stale one offers the latest.
import {
  Badge,
  Button,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
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
  ChevronRight16Regular,
  Clock16Regular,
  Code16Regular,
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
import { ASSIGNMENT_STATE_TEXT, DEFAULT_PRESETS, RUNTIME_LABELS, effortFor, effortLabel, type AssignmentSummary, type EmployeeDetail, type Employment, type EmploymentCommand, type ResourcePreset, type ResourceProfile, type Roster, type SandboxState } from "@orbit-web/contracts";
import { useState, type ReactElement } from "react";
import { IconBadge } from "../../components/SectionIcons";
import type { OfficePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useResourceSummary } from "../resources/ComputeStorageSection";
import { AREA_TEXT, LEVEL_TEXT, LEVEL_TONE, cpuText, sizeText } from "../resources/format";
import { office, useOfficeRead } from "./api";
import { AssignDialog } from "./AssignDialog";
import { AccessTab } from "./EmployeeAccessTab";
import { useConnections } from "../connections/AiConnectionsSection";
import { usableForEmployees } from "./HireWizard";
import { AsOf, Callout, EmptyState, ProblemBar, StateBadge, WorkLabelBadge, useAction, useOfficeStyles, when } from "./parts";
import { EmployeeDeskScene, deskMoodText } from "./VirtualDesk";
import { ResourceFields, resourceProblems, storageProblem } from "./ResourceFields";
import { RunDetails } from "./RunDetails";

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

export const EMPLOYEE_TABS = ["profile", "work", "access", "resources", "employment"] as const;
type EmployeeTab = (typeof EMPLOYEE_TABS)[number];
const TAB_TEXT: Record<EmployeeTab, string> = { profile: "Profile", work: "Work", access: "Access", resources: "Sandbox & resources", employment: "Employment" };

const TAB_ICON: Record<EmployeeTab, ReactElement> = {
  profile: <Person16Regular />,
  work: <TaskListLtr20Regular />,
  access: <Key16Regular />,
  resources: <Box16Regular />,
  employment: <Briefcase16Regular />,
};

const EMPLOYMENT_TEXT: Record<Employment, string> = { candidate: "Candidate", probation: "On probation", active: "Active", suspended: "Suspended", archived: "Archived", deleted: "Desk deleted" };

const EMPLOYMENT_TONE: Record<Employment, "success" | "warning" | "subtle" | "informative" | "danger"> = {
  candidate: "informative",
  probation: "warning",
  active: "success",
  suspended: "warning",
  archived: "subtle",
  deleted: "danger",
};

const SANDBOX_TEXT: Record<SandboxState, string> = { PROVISIONING: "Being prepared", READY: "Ready", FAILED: "Failed", ARCHIVED: "Archived", DELETING: "Being deleted", DELETED: "Deleted" };

// What may be done next with an employment, and what each move means.
// An archived employee's desk is deleted from Governance → Employee desks, where what it holds is shown first.
const MOVES: Record<Employment, EmploymentCommand[]> = { candidate: ["start_probation", "activate", "reject"], probation: ["activate", "reject"], active: ["suspend", "archive"], suspended: ["reinstate", "archive"], archived: [], deleted: [] };
const MOVE_TEXT: Record<EmploymentCommand, { label: string; means: string; danger?: boolean }> = {
  start_probation: { label: "Start the trial", means: "It works trial assignments you review before it is active." },
  activate: { label: "Activate", means: "It takes work as a member of the office." },
  reject: { label: "Reject", means: "It is not hired; its sandbox is archived.", danger: true },
  suspend: { label: "Suspend", means: "It takes no new work until you reinstate it." },
  reinstate: { label: "Reinstate", means: "It takes work again." },
  archive: { label: "Archive", means: "It leaves the office; its desk and toolbox are kept, read only, until you delete them in Governance → Employee desks.", danger: true },
  delete: { label: "Delete the desk", means: "Its desk, cache and workspaces are deleted for good and their storage released.", danger: true },
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
    paddingTop: "8px",
    paddingRight: "12px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    borderRadius: "14px",
    backgroundColor: "var(--orbit-tool-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    flexShrink: 0,
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
});

function AssignmentList({ items, go, label, empty }: { items: AssignmentSummary[]; go: Go; label: string; empty: string }) {
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
              Updated {when(a.updatedAt)}
              {a.reason ? ` · ${a.reason}` : ""}
              {a.waitingOn ? ` · waiting on ${a.waitingOn}` : ""}
            </Text>
          </div>
          <ChevronRight16Regular className={s.chevron} aria-hidden />
        </li>
      ))}
    </ul>
  );
}

// HOW AN EMPLOYEE RUNS, changed in place: a connection that can run employees now (the server says which: employeeReady), a
// model of that connection's own catalog and an effort the model takes. Web search stays on only where the new
// connection offers it; the Orbit plugin only on the Claude Code connection it was granted on. The server holds the
// change to the same rules as a hire (an OpenAI Codex model observed held to Orbit's tools, above all).
function RunsOnForm({ e, onSaved, onCancel }: { e: EmployeeDetail; onSaved: (d: EmployeeDetail) => void; onCancel: () => void }) {
  const o = useOfficeStyles();
  const s = useStyles();
  const act = useAction();
  const connections = useConnections();
  const x = e.profile.execution;
  const ready = (connections.data?.connections ?? []).filter(usableForEmployees);
  const [connectionId, setConnectionId] = useState<string | null>(x.connectionId);
  const [modelId, setModelId] = useState<string | null>(x.model);
  const [effortId, setEffortId] = useState<string | null>(x.effort);
  const connection = ready.find((c) => c.id === connectionId) ?? ready[0] ?? null;
  const models = connection?.catalog.models ?? [];
  const model = models.find((m) => m.id === modelId) ?? models.find((m) => m.id === connection?.catalog.recommended) ?? models[0] ?? null;
  const effort = model === null || model.efforts.length === 0 ? null : effortId !== null && model.efforts.includes(effortId) ? effortId : effortFor(model, "medium");
  const save = () =>
    act.run(async () => {
      if (connection === null || model === null) return;
      const execution = { runtime: connection.runtime, connectionId: connection.id, model: model.id, effort, webSearch: x.webSearch && connection.capabilities.webSearch === "yes", orbitPlugin: x.orbitPlugin && connection.runtime === "claude" && connection.id === x.connectionId };
      onSaved(await office.updateEmployee(e, { profile: { ...e.profile, execution }, note: `Runs on ${RUNTIME_LABELS[connection.runtime]} — ${connection.label}, ${model.label}` }));
    });
  if (connections.data === null) return <Spinner size="tiny" label="Reading your AI connections…" />;
  return (
    <form
      aria-label="Change how it runs"
      className={s.inlineFormBox}
      onSubmit={(ev) => {
        ev.preventDefault();
        void save();
      }}
    >
      <div className={o.formGrid}>
        <Field label="AI connection" hint="Only a connection that can run employees now is offered (Settings → AI Connections says why another cannot).">
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
        <Field label="Model" hint="From this connection's own catalog.">
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
                {connection?.catalog.recommended === m.id ? " (recommended)" : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Effort" hint={model && model.efforts.length === 0 ? "This model takes no effort level." : "How thoroughly it works."}>
          <Select value={effort ?? ""} disabled={model === null || model.efforts.length === 0} onChange={(_, d) => setEffortId(d.value)}>
            {model?.efforts.length === 0 && <option value="">No effort level</option>}
            {(model?.efforts ?? []).map((v) => (
              <option key={v} value={v}>
                {effortLabel(v)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className={s.actionRow}>
        <Button type="submit" appearance="primary" disabled={act.busy || connection === null || model === null}>
          Save how it runs
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
      <ProblemBar problem={act.problem} />
    </form>
  );
}

function ProfileTab({ e, onSaved, onLoadLatest }: { e: EmployeeDetail; onSaved: (d: EmployeeDetail) => void; onLoadLatest: () => void }) {
  const o = useOfficeStyles();
  const s = useStyles();
  const act = useAction();
  const p = e.profile;
  const [title, setTitle] = useState(p.title);
  const [duties, setDuties] = useState(p.duties);
  const [instructions, setInstructions] = useState(p.instructions);
  const [note, setNote] = useState("");
  const changed = title.trim() !== p.title || duties.trim() !== p.duties || instructions.trim() !== p.instructions;
  const save = () => act.run(async () => onSaved(await office.updateEmployee(e, { profile: { ...p, title: title.trim(), duties: duties.trim(), instructions: instructions.trim() }, note: note.trim() })));
  const reset = () => {
    setTitle(p.title);
    setDuties(p.duties);
    setInstructions(p.instructions);
    setNote("");
  };
  const restore = (revision: number) =>
    act.run(async () => {
      const old = await office.profileRevision(e.id, revision);
      onSaved(await office.updateEmployee(e, { profile: old.profile, basedOn: revision, note: `Restored revision ${revision}` }));
    });
  const x = p.execution;
  const [changing, setChanging] = useState(false);
  return (
    <div className={s.colStack}>
      <div className={s.twoCol}>
        <form
          className={o.card}
          aria-label="Role"
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
                  Role — profile revision {e.profileRevision}
                </Text>
                <Text size={200} className={o.muted}>
                  Every save creates a restorable revision.
                </Text>
              </div>
            </div>
            {changed && (
              <Badge appearance="tint" color="warning" style={{ borderRadius: "9999px" }}>
                Unsaved changes
              </Badge>
            )}
          </div>
          <div className={o.divider} />
          <Field label="Role title" required>
            <Input value={title} onChange={(_, d) => setTitle(d.value)} />
          </Field>
          <Field label="Duties" hint="What this employee owns and delivers.">
            <Textarea value={duties} rows={3} resize="vertical" onChange={(_, d) => setDuties(d.value)} />
          </Field>
          <Field label="Instructions" hint="Working style, standards, and guardrails.">
            <Textarea value={instructions} rows={5} resize="vertical" onChange={(_, d) => setInstructions(d.value)} />
          </Field>
          <Field label="Why it changes" hint="Optional: kept with the revision.">
            <Input value={note} placeholder="e.g. Narrowed scope to quarterly filings" onChange={(_, d) => setNote(d.value)} />
          </Field>
          <div className={o.inset}>
            <Text size={200} className={o.muted}>
              Skills: {p.skills.join(", ") || "none named"} · Languages: {p.languages.join(", ") || "none named"}
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
              Save as a new revision
            </Button>
            {changed && (
              <Button type="button" appearance="subtle" disabled={act.busy} onClick={reset}>
                Discard changes
              </Button>
            )}
          </div>
        </form>

        <div className={s.colStack}>
          <section className={o.card} aria-label="How it runs">
            <div className={o.between}>
              <div className={s.sectionHead}>
                <IconBadge icon={<Code16Regular />} tone="teal" size="md" />
                <div className={s.sectionTitleWrap}>
                  <Text weight="semibold" size={400}>
                    How it runs
                  </Text>
                  <Text size={200} className={o.muted}>
                    Runtime, model, and capabilities
                  </Text>
                </div>
              </div>
              {!changing && (
                <Button size="small" icon={<Edit16Regular />} onClick={() => setChanging(true)}>
                  Change how it runs
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
                  Runtime
                </dt>
                <dd className={o.dd} style={{ fontWeight: 600 }}>
                  {RUNTIME_LABELS[x.runtime]}
                </dd>
              </div>
              <div className={s.kvCell}>
                <dt className={o.dt} style={{ fontSize: tokens.fontSizeBase100 }}>
                  Model
                </dt>
                <dd className={o.dd} style={{ fontWeight: 600 }}>
                  {x.model}
                </dd>
              </div>
              <div className={s.kvCell}>
                <dt className={o.dt} style={{ fontSize: tokens.fontSizeBase100 }}>
                  Effort
                </dt>
                <dd className={o.dd}>{x.effort ? effortLabel(x.effort) : "None"}</dd>
              </div>
              <div className={s.kvCell}>
                <dt className={o.dt} style={{ fontSize: tokens.fontSizeBase100 }}>
                  Desk
                </dt>
                <dd className={o.dd}>
                  version {e.desk.version} · {e.desk.files} file(s)
                </dd>
              </div>
              <div className={s.kvCell}>
                <dt className={o.dt} style={{ fontSize: tokens.fontSizeBase100 }}>
                  Web search
                </dt>
                <dd className={o.dd}>
                  <Badge appearance="tint" color={x.webSearch ? "success" : "subtle"} size="small" style={{ borderRadius: "9999px" }}>
                    {x.webSearch ? "On" : "Off"}
                  </Badge>
                </dd>
              </div>
              <div className={s.kvCell}>
                <dt className={o.dt} style={{ fontSize: tokens.fontSizeBase100 }}>
                  Orbit plugin
                </dt>
                <dd className={o.dd}>
                  <Badge appearance="tint" color={x.orbitPlugin ? "brand" : "subtle"} size="small" style={{ borderRadius: "9999px" }}>
                    {x.orbitPlugin ? "On (skills only)" : "Off"}
                  </Badge>
                </dd>
              </div>
              <div className={mergeClasses(s.kvCell, s.kvFull)}>
                <dt className={o.dt} style={{ fontSize: tokens.fontSizeBase100 }}>
                  Connection
                </dt>
                <dd className={o.dd}>{x.connectionId ? <span className={o.mono}>{x.connectionId}</span> : "The account's default"}</dd>
              </div>
            </dl>
          </section>

          <section className={o.card} aria-label="Profile history">
            <div className={o.between}>
              <div className={s.sectionHead}>
                <IconBadge icon={<History16Regular />} tone="neutral" size="md" />
                <div className={s.sectionTitleWrap}>
                  <Text weight="semibold" size={400}>
                    Profile history
                  </Text>
                  <Text size={200} className={o.muted}>
                    {e.revisions.length} {e.revisions.length === 1 ? "revision" : "revisions"} recorded
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
                            Revision {r.revision}
                            {isCurrent ? " (current)" : ""}
                          </Text>
                          {isCurrent && (
                            <Badge appearance="tint" color="brand" size="small" style={{ borderRadius: "9999px" }}>
                              Active
                            </Badge>
                          )}
                        </div>
                        {!isCurrent && (
                          <Button className={o.touch} size="small" appearance="subtle" icon={<ArrowCounterclockwise16Regular />} disabled={act.busy} onClick={() => void restore(r.revision)}>
                            Restore revision {r.revision}
                          </Button>
                        )}
                      </div>
                      <Text size={200} className={o.muted}>
                        {when(r.createdAt)} by {r.createdBy}
                        {r.basedOn ? ` · copied from revision ${r.basedOn}` : ""}
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
  const o = useOfficeStyles();
  const s = useStyles();
  return (
    <div className={s.colStack}>
      <section className={o.card} aria-label="Working on">
        <div className={o.between}>
          <div className={s.sectionHead}>
            <IconBadge icon={<TaskListLtr20Regular />} tone={e.holding ? "brand" : "success"} size="md" />
            <div className={s.sectionTitleWrap}>
              <Text weight="semibold" size={400}>
                Working on
              </Text>
              <Text size={200} className={o.muted}>
                Current active assignment on this desk
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
                Open mission
              </Button>
            </div>
            <Text size={200} className={o.muted}>
              Since {when(e.holding.since)}
            </Text>
            {e.workLabel.startsWith("waiting") && (
              <Callout tone="warn" icon={<Clock16Regular />}>
                Waiting: <WorkLabelBadge label={e.workLabel} />
              </Callout>
            )}
          </div>
        ) : (
          <EmptyState
            icon={<TaskListLtr20Regular />}
            tone="success"
            title="Nothing: it is free for work."
            body="Assign a new mission when you are ready for this employee to start."
            action={
              e.employment !== "archived" ? (
                <Button size="small" appearance="primary" onClick={onAssign}>
                  Assign work
                </Button>
              ) : undefined
            }
          />
        )}
      </section>

      <div className={s.equalCols}>
        <section className={o.card} aria-label="Queue">
          <div className={o.between}>
            <div className={s.sectionHead}>
              <IconBadge icon={<Clock16Regular />} tone="warning" size="md" />
              <Text weight="semibold" size={400}>
                Queued behind it ({e.queue.length})
              </Text>
            </div>
            <Badge appearance="tint" color={e.queue.length > 0 ? "warning" : "subtle"} style={{ borderRadius: "9999px" }}>
              {e.queue.length}
            </Badge>
          </div>
          <AssignmentList items={e.queue} go={go} label="Queued work" empty="Nothing waits for it." />
        </section>

        <section className={o.card} aria-label="History">
          <div className={o.between}>
            <div className={s.sectionHead}>
              <IconBadge icon={<History16Regular />} tone="neutral" size="md" />
              <Text weight="semibold" size={400}>
                History
              </Text>
            </div>
            <Badge appearance="tint" color="subtle" style={{ borderRadius: "9999px" }}>
              {e.history.length}
            </Badge>
          </div>
          <AssignmentList items={e.history} go={go} label="Past work" empty="No work finished yet." />
        </section>
      </div>
    </div>
  );
}

function EditResources({ e, onSaved, onCancel, onLoadLatest }: { e: EmployeeDetail; onSaved: (d: EmployeeDetail) => void; onCancel: () => void; onLoadLatest: () => void }) {
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
      aria-label="Edit resources"
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
              Edit resources
            </Text>
            <Text size={200} className={o.muted}>
              Applies to future attempts: an attempt already admitted keeps the resources it was admitted under.
            </Text>
          </div>
        </div>
      </div>
      <div className={o.divider} />
      <ResourceFields value={value} onChange={setValue} presets={presets} summary={summary.data} runtime={e.execution.runtime} committed={committed} />
      <Field label="Why it changes" hint="Optional: kept with the revision.">
        <Input value={note} onChange={(_, d) => setNote(d.value)} />
      </Field>
      <div className={s.actionRow}>
        <Button type="submit" appearance="primary" disabled={act.busy || !changed || problems.length > 0}>
          Save resources
        </Button>
        <Button type="button" onClick={onCancel} disabled={act.busy}>
          Cancel
        </Button>
      </div>
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
    </form>
  );
}

function ResourcesTab({ e, onSaved, onLoadLatest }: { e: EmployeeDetail; onSaved: (d: EmployeeDetail) => void; onLoadLatest: () => void }) {
  const o = useOfficeStyles();
  const s = useStyles();
  const [editing, setEditing] = useState(false);
  const sb = e.sandbox;
  const r = sb.resources;
  const run = e.activeRun;
  const specs = [
    { label: "CPU", value: cpuText(r.cpuMillis) },
    { label: "Memory", value: sizeText(r.memoryMiB) },
    { label: "Desk", value: sizeText(r.deskStorageMiB) },
    { label: "Scratch", value: sizeText(r.scratchStorageMiB) },
    { label: "Cache", value: sizeText(r.cacheStorageMiB) },
    { label: "Processes", value: `${r.pidsLimit}` },
    { label: "Time limit", value: `${r.timeoutMinutes} min` },
  ];
  return (
    <div className={s.colStack}>
      <section className={o.card} aria-label="Personal Sandbox">
        <div className={o.between}>
          <div className={s.sectionHead}>
            <IconBadge icon={<Box16Regular />} tone={sb.state === "READY" ? "success" : sb.state === "FAILED" ? "danger" : "warning"} size="md" />
            <div className={o.row}>
              <Text weight="semibold" size={400}>
                Personal Sandbox
              </Text>
              <Badge appearance="tint" color={sb.state === "READY" ? "success" : sb.state === "FAILED" ? "danger" : sb.state === "PROVISIONING" ? "warning" : "subtle"} style={{ borderRadius: "9999px" }}>
                {SANDBOX_TEXT[sb.state]}
              </Badge>
              {sb.provider === "process" && (
                <Badge appearance="outline" color="warning" style={{ borderRadius: "9999px" }}>
                  Development only: no isolation, no shell
                </Badge>
              )}
            </div>
          </div>
          <Button className={o.touch} icon={<Edit16Regular />} disabled={editing || sb.state === "ARCHIVED"} onClick={() => setEditing(true)}>
            Edit resources
          </Button>
        </div>
        {sb.reason && (
          <Callout tone="warn" icon={<Warning16Regular />}>
            {sb.reason}
          </Callout>
        )}
        <Text size={200} className={o.muted}>
          Resources (revision {sb.resourceRevision}): {cpuText(r.cpuMillis)} · {sizeText(r.memoryMiB)} memory · {sizeText(r.deskStorageMiB)} desk · {sizeText(r.scratchStorageMiB)} scratch · {sizeText(r.cacheStorageMiB)} cache · {r.pidsLimit} processes · {r.timeoutMinutes} minutes per attempt
        </Text>
        <div className={s.resourceTiles}>
          {specs.map((item) => (
            <div key={item.label} className={s.resourceTile}>
              <Text size={100} className={o.muted}>
                {item.label}
              </Text>
              <Text className={s.resourceValue}>{item.value}</Text>
            </div>
          ))}
        </div>
        <div className={o.divider} />
        <div className={o.tableWrap}>
          <Table size="small" aria-label="Storage areas">
            <TableHeader>
              <TableRow>
                <TableHeaderCell style={{ width: "165px" }}>Area</TableHeaderCell>
                <TableHeaderCell style={{ width: "92px" }}>Quota</TableHeaderCell>
                <TableHeaderCell style={{ width: "104px" }}>Used</TableHeaderCell>
                <TableHeaderCell>Enforcement</TableHeaderCell>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sb.areas.map((a) => (
                <TableRow key={a.area}>
                  <TableCell>{AREA_TEXT[a.area]}</TableCell>
                  <TableCell style={{ whiteSpace: "nowrap" }}>{sizeText(a.quotaMiB)}</TableCell>
                  <TableCell style={{ whiteSpace: "nowrap" }}>{a.usedMiB === null ? "not measured" : sizeText(a.usedMiB)}</TableCell>
                  <TableCell>
                    <Badge appearance="tint" color={LEVEL_TONE[a.level]} style={{ height: "auto", minHeight: "20px", paddingTop: "3px", paddingBottom: "3px", whiteSpace: "normal", textAlign: "left", lineHeight: "1.3" }}>
                      {LEVEL_TEXT[a.level]}
                    </Badge>
                    <Text size={200} className={o.muted} block style={{ marginTop: "4px", overflowWrap: "anywhere" }}>
                      {a.evidence}
                    </Text>
                  </TableCell>
                </TableRow>
              ))}
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
        <section className={o.card} aria-label="Attempt now">
          <div className={s.sectionHead}>
            <IconBadge icon={<Code16Regular />} tone={run ? "brand" : "neutral"} size="md" />
            <div className={s.sectionTitleWrap}>
              <Text weight="semibold" size={400}>
                Attempt now
              </Text>
              <Text size={200} className={o.muted}>
                Live container usage and isolation checks
              </Text>
            </div>
          </div>
          {run ? <RunDetails run={run} /> : <Text className={o.muted}>No attempt runs now: it holds no CPU or memory.</Text>}
        </section>

        <section className={o.card} aria-label="Resource history">
          <div className={s.sectionHead}>
            <IconBadge icon={<History16Regular />} tone="neutral" size="md" />
            <div className={s.sectionTitleWrap}>
              <Text weight="semibold" size={400}>
                Resource history
              </Text>
              <Text size={200} className={o.muted}>
                {e.resourceRevisions.length} {e.resourceRevisions.length === 1 ? "revision" : "revisions"} recorded
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
                        Revision {rv.revision}
                        {isCurrent ? " (current)" : ""}
                      </Text>
                      <Badge appearance="outline" size="small" style={{ borderRadius: "9999px" }}>
                        {rv.profile.presetId ? `${rv.profile.presetId} preset` : "custom"}
                      </Badge>
                    </div>
                    <Text size={200}>
                      {cpuText(rv.profile.cpuMillis)} · {sizeText(rv.profile.memoryMiB)} memory · {sizeText(rv.profile.deskStorageMiB)} desk
                      {rv.profile.presetId ? ` · ${rv.profile.presetId} preset` : " · custom"}
                    </Text>
                    <Text size={200} className={o.muted}>
                      {when(rv.createdAt)} by {rv.createdBy}
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
  const currentDept = departments.find((d) => d.id === e.departmentId)?.name ?? "Unassigned";
  return (
    <div className={s.colStack}>
      <div className={s.twoCol}>
        <section className={o.card} aria-label="Employment">
          <div className={o.between}>
            <div className={s.sectionHead}>
              <IconBadge icon={<Briefcase16Regular />} tone={e.employment === "active" ? "success" : e.employment === "suspended" ? "warning" : "neutral"} size="md" />
              <div className={s.sectionTitleWrap}>
                <Text weight="semibold" size={400}>
                  Employment
                </Text>
                <Text size={200} className={o.muted}>
                  Lifecycle transitions are logged with your reason.
                </Text>
              </div>
            </div>
            <Badge appearance="tint" color={EMPLOYMENT_TONE[e.employment]} style={{ borderRadius: "9999px" }}>
              {EMPLOYMENT_TEXT[e.employment]}
            </Badge>
          </div>
          <div className={o.divider} />
          {moves.length === 0 ? (
            <Callout tone="info" icon={<Shield16Regular />}>
              Nothing more can change: it is archived.
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
              <RadioGroup value={command ?? ""} onChange={(_, d) => setCommand(d.value as EmploymentCommand)} aria-label="What to do" className={s.moveList}>
                {moves.map((m) => {
                  const selected = command === m;
                  const danger = MOVE_TEXT[m].danger === true;
                  return (
                    <div key={m} className={mergeClasses(s.moveCard, selected && (danger ? s.moveCardDanger : s.moveCardSelected))}>
                      <Radio value={m} label={`${MOVE_TEXT[m].label} — ${MOVE_TEXT[m].means}`} />
                    </div>
                  );
                })}
              </RadioGroup>
              {command === "suspend" && e.holding && (
                <div className={o.inset}>
                  <Field label={`What happens to “${e.holding.title}”`}>
                    <RadioGroup value={held} onChange={(_, d) => setHeld(d.value as "keep_paused" | "cancel")}>
                      <Radio value="keep_paused" label="Keep it, paused" />
                      <Radio value="cancel" label="Cancel it" />
                    </RadioGroup>
                  </Field>
                </div>
              )}
              <Field label="Reason" hint="Recorded with the decision.">
                <Input value={reason} placeholder="Explain why this change is being made" onChange={(_, d) => setReason(d.value)} />
              </Field>
              <div className={s.actionRow}>
                <Button type="submit" appearance="primary" disabled={act.busy || command === null}>
                  {command ? MOVE_TEXT[command].label : "Choose what to do"}
                </Button>
                {command !== null && (
                  <Button type="button" appearance="subtle" onClick={() => setCommand(null)}>
                    Clear choice
                  </Button>
                )}
              </div>
            </form>
          )}
        </section>

        <section className={o.card} aria-label="Department">
          <div className={o.between}>
            <div className={s.sectionHead}>
              <IconBadge icon={<Organization16Regular />} tone="teal" size="md" />
              <div className={s.sectionTitleWrap}>
                <Text weight="semibold" size={400}>
                  Department
                </Text>
                <Text size={200} className={o.muted}>
                  Organize where this employee sits
                </Text>
              </div>
            </div>
            <Badge appearance="outline" style={{ borderRadius: "9999px" }}>
              {currentDept}
            </Badge>
          </div>
          <div className={o.divider} />
          <div className={o.form}>
            <Field label="Move to">
              <Select value={departmentId} onChange={(_, d) => setDepartmentId(d.value)}>
                <option value="">Unassigned</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className={s.actionRow}>
              <Button className={o.touch} appearance="primary" disabled={act.busy || departmentId === (e.departmentId ?? "")} onClick={() => void act.run(async () => onSaved(await office.moveEmployee(e, departmentId === "" ? null : departmentId)))}>
                Move
              </Button>
            </div>
            <Text size={200} className={o.muted}>
              Work it already holds keeps the department it was claimed under.
            </Text>
          </div>
        </section>
      </div>
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
    </div>
  );
}

export function EmployeePage({ id, tab, go }: { id: string; tab: string | null; go: Go }) {
  const o = useOfficeStyles();
  const s = useStyles();
  const employee = useOfficeRead<EmployeeDetail>(() => office.employee(id), [id], ["roster", "missions", "connections"]);
  const [assigning, setAssigning] = useState(false);
  const restore = useRestoreFocusTarget();
  const current: EmployeeTab = (EMPLOYEE_TABS as readonly string[]).includes(tab ?? "") ? (tab as EmployeeTab) : "profile";
  if (employee.data === null)
    return employee.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{employee.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner label="Reading the employee…" />
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
              <EmployeeDeskScene name={e.name} workLabel={e.workLabel} compact />
            </div>
            <div className={o.stack}>
              <div className={o.row}>
                <Text as="h2" weight="semibold" size={600} className={o.wrap}>
                  {e.name}
                </Text>
                <WorkLabelBadge label={e.workLabel} />
                <Badge appearance="tint" color={EMPLOYMENT_TONE[e.employment]} style={{ borderRadius: "9999px" }}>
                  {EMPLOYMENT_TEXT[e.employment]}
                </Badge>
              </div>
              <Text size={200} className={o.muted}>
                {e.title} · {RUNTIME_LABELS[e.execution.runtime]} · {e.execution.model}
                {e.execution.effort ? ` · ${effortLabel(e.execution.effort)}` : ""}
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
            Assign work
          </Button>
        </div>

        <div className={s.kpiStrip}>
          <button type="button" className={mergeClasses(s.kpiTile, current === "work" && s.kpiTileActive)} onClick={() => go("employee", id, "work")}>
            <span className={s.kpiLabel}>
              <TaskListLtr20Regular aria-hidden />
              Current work
            </span>
            <span className={s.kpiValue}>{e.holding ? e.holding.title : "Idle · free"}</span>
            <span className={s.kpiSub}>
              {e.queue.length > 0 ? `${e.queue.length} queued · ` : ""}
              {e.history.length} completed
            </span>
          </button>

          <button type="button" className={mergeClasses(s.kpiTile, current === "resources" && s.kpiTileActive)} onClick={() => go("employee", id, "resources")}>
            <span className={s.kpiLabel}>
              <Box16Regular aria-hidden />
              Sandbox
            </span>
            <span className={s.kpiValue}>
              {cpuText(r.cpuMillis)} · {sizeText(r.memoryMiB)}
            </span>
            <span className={s.kpiSub}>
              {SANDBOX_TEXT[e.sandbox.state]} · {sizeText(r.deskStorageMiB)} desk
            </span>
          </button>

          <button type="button" className={mergeClasses(s.kpiTile, current === "profile" && s.kpiTileActive)} onClick={() => go("employee", id, "profile")}>
            <span className={s.kpiLabel}>
              <Code16Regular aria-hidden />
              Model & profile
            </span>
            <span className={s.kpiValue}>{e.execution.model}</span>
            <span className={s.kpiSub}>
              {RUNTIME_LABELS[e.execution.runtime]} · rev {e.profileRevision}
            </span>
          </button>

          <button type="button" className={mergeClasses(s.kpiTile, current === "employment" && s.kpiTileActive)} onClick={() => go("employee", id, "employment")}>
            <span className={s.kpiLabel}>
              <Briefcase16Regular aria-hidden />
              Employment
            </span>
            <span className={s.kpiValue}>{EMPLOYMENT_TEXT[e.employment]}</span>
            <span className={s.kpiSub}>
              Desk v{e.desk.version} · {e.desk.files} {e.desk.files === 1 ? "file" : "files"}
            </span>
          </button>
        </div>

        {e.notReadyReason && (
          <Callout tone="danger" icon={<ErrorCircle16Regular />}>
            Not ready: {e.notReadyReason}
          </Callout>
        )}
        {e.connectionWarning && (
          <Callout tone="warn" icon={<Warning16Regular />}>
            Connection: {e.connectionWarning}
          </Callout>
        )}
      </section>

      <div className={`${o.tabStrip} orbit-hscroll`}>
        <TabList selectedValue={current} onTabSelect={(_, d) => go("employee", id, d.value as string)} aria-label="Employee">
          {EMPLOYEE_TABS.map((t) => (
            <Tab key={t} value={t} icon={TAB_ICON[t]}>
              <span className={s.tabLabel}>
                <span>{TAB_TEXT[t]}</span>
                {t === "work" && workCount > 0 && (
                  <Badge appearance="tint" color="brand" size="small" style={{ borderRadius: "9999px" }}>
                    {workCount}
                  </Badge>
                )}
              </span>
            </Tab>
          ))}
        </TabList>
      </div>

      {current === "profile" && <ProfileTab key={e.version} e={e} onSaved={saved} onLoadLatest={reload} />}
      {current === "work" && <WorkTab e={e} go={go} onAssign={() => setAssigning(true)} />}
      {current === "access" && <AccessTab e={e} />}
      {current === "resources" && <ResourcesTab key={e.version} e={e} onSaved={saved} onLoadLatest={reload} />}
      {current === "employment" && <EmploymentTab key={e.version} e={e} onSaved={saved} onLoadLatest={reload} />}
      {assigning && <AssignDialog employees={[e]} employeeId={e.id} onClose={() => setAssigning(false)} onOpenMission={(m) => go("mission", m)} />}
    </div>
  );
}
