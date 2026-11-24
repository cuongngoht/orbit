// ASSIGN WORK: walking up to a colleague's virtual desk to hand over a brief -- who takes it, what is wanted, what
// files it must hand in, pinned research sources, and how busy desks are handled. "Start now" is the default: a busy
// employee refuses it and NOTHING is created -- everything typed stays, the held work is shown, and you can queue it
// behind that work (with a new idempotency key) or walk over to another colleague's desk.
//
// Work may also be given to a DEPARTMENT (its manager in office) or to the CEO. Who is responsible is asked of the API
// before sending and shown -- or why nobody is (no manager, no CEO, a suspended appointment), and then nothing can be
// sent. The request names who the person saw (`expectedAssignee`): when the appointment moved since, nothing is created,
// the page says who is responsible now, and sending again is a new request with a new key.
import { Badge, Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, MessageBar, MessageBarActions, MessageBarBody, Radio, RadioGroup, Select, Spinner, Text, Textarea, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Add16Regular, Dismiss16Regular } from "@fluentui/react-icons";
import {
  ASSIGNMENT_STATE_TEXT,
  WORK_LABEL_TEXT,
  checkCreateMission,
  type CreateMissionRequest,
  type Deliverable,
  type Department,
  type EmployeeBusyDetails,
  type EmployeeCard,
  type ExpectedAssignee,
  type MissionAccepted,
  type MissionRepositoryRequest,
  type MissionTarget,
  type MissionTargetPreview,
  type Roster,
  type WhenBusy,
} from "@orbit-web/contracts";
import { useEffect, useRef, useState } from "react";
import { ConnectionRequired, isConnectionRequired } from "../../components/ApiErrorBar";
import { DesksIcon, IconBadge, PolicyIcon, QueuedIcon, WorkMissionIcon } from "../../components/SectionIcons";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { useI18n, type I18nContextValue } from "../../i18n";
import { ApiError, errorText, newIdempotencyKey } from "../../services/api";
import { office } from "./api";
import { Disclosure, WorkLabelBadge, useOfficeStyles, when } from "./parts";
import { RepositoriesPicker } from "./RepositoriesPicker";
import { NO_SOURCES, SourcesPicker, type PinnedSources } from "./SourcesPicker";
import { PixelChibiSvg } from "./PixelOfficeArt";
import { deskMoodText, personaFor, presenceStatusColor } from "./VirtualDesk";

const useStyles = makeStyles({
  surface: {
    width: "min(760px, 96vw)",
    maxWidth: "min(760px, 96vw)",
    maxHeight: "90dvh",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  surfaceMobile: {
    width: "100vw",
    maxWidth: "100vw",
    height: "var(--orbit-app-height, 100dvh)",
    maxHeight: "var(--orbit-app-height, 100dvh)",
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    borderRadius: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  formWrap: { display: "contents" },
  dialogBody: {
    display: "grid",
    gridTemplateRows: "auto minmax(0, 1fr) auto",
    maxHeight: "100%",
    minHeight: 0,
    flexGrow: 1,
    overflow: "hidden",
  },
  dialogContent: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr)",
    gridAutoRows: "max-content",
    alignContent: "start",
    gap: "14px",
    overflowY: "auto",
    minHeight: 0,
    minWidth: 0,
    paddingTop: "2px",
    paddingRight: "4px",
    paddingBottom: "4px",
  },
  dialogActions: { paddingTop: "8px" },
  sectionCard: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    paddingTop: "14px",
    paddingRight: "16px",
    paddingBottom: "14px",
    paddingLeft: "16px",
    borderRadius: "14px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    minWidth: 0,
  },
  sectionHead: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    minWidth: 0,
  },
  // The three kinds of recipient side by side, wrapping on a narrow screen (never the page).
  kindGroup: { flexWrap: "wrap", rowGap: "2px", minWidth: 0 },
  colleagueCard: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    paddingTop: "10px",
    paddingRight: "14px",
    paddingBottom: "10px",
    paddingLeft: "10px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    minWidth: 0,
    "@media (max-width: 520px)": { flexDirection: "column", alignItems: "flex-start" },
  },
  responsibleCard: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    paddingTop: "10px",
    paddingRight: "14px",
    paddingBottom: "10px",
    paddingLeft: "14px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    minWidth: 0,
    overflowWrap: "anywhere",
  },
  portraitFrame: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "68px",
    height: "68px",
    borderRadius: "12px",
    backgroundColor: "#f6ebd4",
    ...shorthands.border("2px", "solid", "#9e6334"),
    flexShrink: 0,
  },
  colleagueMeta: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    flexGrow: 1,
    minWidth: 0,
  },
  seatStrip: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
    minWidth: 0,
  },
  seatChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    paddingTop: "5px",
    paddingRight: "10px",
    paddingBottom: "5px",
    paddingLeft: "6px",
    borderRadius: "9999px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    cursor: "pointer",
    fontFamily: "inherit",
    color: tokens.colorNeutralForeground1,
    transitionProperty: "border-color, background-color, box-shadow",
    transitionDuration: "140ms",
    ":hover": {
      ...shorthands.borderColor(tokens.colorBrandStroke1),
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
    ":focus-visible": {
      ...shorthands.outline("2px", "solid", tokens.colorStrokeFocus2),
      outlineOffset: "2px",
    },
  },
  seatChipSelected: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    backgroundColor: tokens.colorBrandBackground2,
    boxShadow: tokens.shadow2,
  },
  chipAvatar: {
    width: "20px",
    height: "20px",
    borderRadius: "9999px",
    color: "#ffffff",
    fontSize: "10px",
    fontWeight: 700,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipDot: {
    width: "6px",
    height: "6px",
    borderRadius: "9999px",
    flexShrink: 0,
  },
  expectGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
    gap: "12px",
    alignItems: "start",
    "@media (max-width: 580px)": { gridTemplateColumns: "1fr" },
  },
  deliverable: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    flexWrap: "wrap",
    paddingTop: "8px",
    paddingRight: "10px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    borderRadius: "10px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
  deliverableLeft: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    minWidth: 0,
  },
  addRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto auto",
    gap: "8px",
    alignItems: "end",
    "@media (max-width: 479px)": { gridTemplateColumns: "minmax(0, 1fr)" },
  },
});

type TargetKind = MissionTarget["kind"];
type Responsible = NonNullable<MissionTargetPreview["responsible"]>;

type Outcome =
  | { kind: "done"; result: MissionAccepted }
  | { kind: "busy"; details: EmployeeBusyDetails | null; message: string }
  // Who is responsible moved since the person looked: nothing was created; this is who it is now.
  | { kind: "changed"; responsible: Responsible }
  | { kind: "failed"; error: unknown }
  | null;

// The refusals that say the slot is not what the preview showed: the preview is read again.
const SLOT_REFUSALS: readonly string[] = ["no_ceo", "no_manager", "appointment_suspended", "not_working"];

// The departments a mission may be given to: not archived, in the order the office shows them.
const liveDepartments = (departments: readonly Department[]): Department[] => departments.filter((d) => !d.archived).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));

// Who is responsible, in words: "Ana (manager of Accounting)", "Eve (CEO)".
function responsibleText(t: I18nContextValue["t"], r: Pick<Responsible, "employeeName" | "role" | "departmentName">): string {
  if (r.role === "ceo") return t("office.assign.responsibleCeo", { name: r.employeeName });
  if (r.role === "manager") return t("office.assign.responsibleManager", { name: r.employeeName, department: r.departmentName ?? t("office.assign.itsDepartment") });
  return r.employeeName;
}

// Who a department or the CEO would give the work to now, as the API says it -- or why nobody would.
function TargetResponsible({ preview, loading, error }: { preview: MissionTargetPreview | null; loading: boolean; error: unknown }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  if (error !== null)
    return (
      <MessageBar intent="error" layout="multiline">
        <MessageBarBody>{errorText(error)}</MessageBarBody>
      </MessageBar>
    );
  if (loading || preview === null) return <Spinner size="tiny" label={t("office.assign.checkingResponsible")} />;
  if (preview.responsible === null)
    return (
      <MessageBar intent="warning" layout="multiline">
        <MessageBarBody>{preview.reason ?? t("office.assign.nobodyResponsible")}</MessageBarBody>
      </MessageBar>
    );
  return (
    <div className={s.responsibleCard} role="status">
      <Text weight="semibold">{t("office.assign.responsibleLine", { who: responsibleText(t, preview.responsible) })}</Text>
      <Text size={200} className={o.muted}>
        {t("office.assign.responsibleNote")}
      </Text>
    </div>
  );
}

export function AssignDialog({ employees, employeeId = null, onClose, onOpenMission }: { employees: EmployeeCard[]; employeeId?: string | null; onClose: () => void; onOpenMission: (missionId: string) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const { isMobile } = useViewport();
  const choices = employees.filter((e) => e.employment !== "archived");
  const [kind, setKind] = useState<TargetKind>("employee");
  const [target, setTarget] = useState<string>(employeeId ?? choices[0]?.id ?? "");
  const [departmentChoice, setDepartmentChoice] = useState("");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [newName, setNewName] = useState("");
  const [newRequired, setNewRequired] = useState(true);
  const [criteria, setCriteria] = useState("");
  const [deadline, setDeadline] = useState("");
  const [whenBusy, setWhenBusy] = useState<WhenBusy>("reject");
  const [sources, setSources] = useState<PinnedSources>(NO_SOURCES);
  // The repositories chosen, for the employee who takes it (another employee may use others: a change clears them).
  const [repositories, setRepositories] = useState<{ for: string; list: MissionRepositoryRequest[] }>({ for: "", list: [] });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const select = useRef<HTMLSelectElement>(null);
  // The key of the request as last sent: the same body is the same request (sent again with its key), any other is new.
  const sent = useRef<{ body: string; key: string } | null>(null);
  const employee = choices.find((e) => e.id === target) ?? null;

  // The departments, read when the person chooses to give the work to one.
  const roster = useResource<Roster>(kind === "department" ? () => office.roster({ department: null, q: "", status: null }) : null, [kind === "department"]);
  const departments = liveDepartments(roster.data?.departments ?? []);
  const departmentId = departments.some((d) => d.id === departmentChoice) ? departmentChoice : (departments[0]?.id ?? "");
  const missionTarget: MissionTarget | null = kind === "ceo" ? { kind: "ceo" } : kind === "department" ? (departmentId === "" ? null : { kind: "department", departmentId }) : target === "" ? null : { kind: "employee", employeeId: target };

  // Who a department or the CEO would give it to now (an employee is named by the person: nothing to ask).
  const previewKey = missionTarget === null || missionTarget.kind === "employee" ? null : JSON.stringify(missionTarget);
  const [preview, setPreview] = useState<{ key: string; value: MissionTargetPreview | null; error: unknown } | null>(null);
  const [previewRound, setPreviewRound] = useState(0);
  useEffect(() => {
    if (previewKey === null) return undefined;
    let current = true;
    office
      .targetPreview(JSON.parse(previewKey) as MissionTarget)
      .then((value) => {
        if (current) setPreview({ key: previewKey, value, error: null });
      })
      .catch((error: unknown) => {
        if (current) setPreview({ key: previewKey, value: null, error });
      });
    return () => {
      current = false;
    };
  }, [previewKey, previewRound]);
  const shown = preview !== null && preview.key === previewKey ? preview : null;
  const responsible = kind === "employee" ? null : (shown?.value?.responsible ?? null);
  const expected: ExpectedAssignee | null = responsible === null ? null : { employeeId: responsible.employeeId, appointmentId: responsible.appointmentId, appointmentRevision: responsible.appointmentRevision };
  // Who takes it: the employee chosen, or whoever the department or the CEO resolves to now.
  const recipientId = kind === "employee" ? target : (responsible?.employeeId ?? "");
  const recipientName = kind === "employee" ? (employee?.name ?? null) : (responsible?.employeeName ?? null);
  const chosenRepositories = repositories.for === recipientId ? repositories.list : [];
  const ready = missionTarget !== null && (kind === "employee" || expected !== null);

  // A change of who takes it clears what was said about the one before.
  const clearRecipientOutcome = () => {
    if (outcome?.kind === "busy" || outcome?.kind === "changed") setOutcome(null);
  };
  const chooseTarget = (nextId: string) => {
    setTarget(nextId);
    clearRecipientOutcome();
  };
  const chooseKind = (next: TargetKind) => {
    setKind(next);
    clearRecipientOutcome();
  };
  const chooseDepartment = (next: string) => {
    setDepartmentChoice(next);
    clearRecipientOutcome();
  };

  const bodyOf = (to: MissionTarget, mode: WhenBusy): CreateMissionRequest => ({
    goal: goal.trim(),
    ...(title.trim() ? { title: title.trim() } : {}),
    target: to,
    ...(to.kind !== "employee" && expected !== null ? { expectedAssignee: expected } : {}),
    whenBusy: mode,
    deliverables,
    acceptanceCriteria: criteria
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
    deadline: deadline ? new Date(deadline).toISOString() : null,
    ...(sources.workspaceId !== null && sources.revisionIds.length > 0 ? { workspaceId: sources.workspaceId, sourceRevisionIds: sources.revisionIds } : {}),
    ...(chosenRepositories.length > 0 ? { repositories: chosenRepositories } : {}),
  });

  // Refused because who is responsible moved: nothing was created, and the refusal is kept under its key -- so the page
  // takes who is responsible now as the one expected, and the next send is a new request with a new key.
  const targetChanged = (err: ApiError, to: MissionTarget) => {
    sent.current = null;
    const current = (err.details as { current?: Responsible | null } | null)?.current ?? null;
    if (current === null) {
      setPreviewRound((n) => n + 1);
      setOutcome({ kind: "failed", error: err });
      return;
    }
    setPreview({ key: JSON.stringify(to), value: { target: to, responsible: current, code: null, reason: null }, error: null });
    setOutcome({ kind: "changed", responsible: current });
  };

  const submit = async (mode: WhenBusy) => {
    if (missionTarget === null || !ready) return;
    const body = bodyOf(missionTarget, mode);
    const checked = checkCreateMission(body);
    if (!checked.ok) {
      setProblems(checked.errors);
      return;
    }
    setProblems([]);
    const text = JSON.stringify(body);
    const key = sent.current?.body === text ? sent.current.key : newIdempotencyKey();
    sent.current = { body: text, key };
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome({ kind: "done", result: await office.createMission(body, key) });
    } catch (err) {
      if (err instanceof ApiError && err.code === "employee_busy") setOutcome({ kind: "busy", details: (err.details as EmployeeBusyDetails | null) ?? null, message: err.message });
      else if (err instanceof ApiError && err.code === "target_changed") targetChanged(err, missionTarget);
      else {
        if (err instanceof ApiError && SLOT_REFUSALS.includes(err.code)) setPreviewRound((n) => n + 1);
        setOutcome({ kind: "failed", error: err });
      }
    } finally {
      setBusy(false);
    }
  };

  const addDeliverable = () => {
    const name = newName.trim();
    if (name === "" || deliverables.some((d) => d.name.toLowerCase() === name.toLowerCase())) return;
    setDeliverables([...deliverables, { name, required: newRequired }]);
    setNewName("");
    setNewRequired(true);
  };

  if (outcome?.kind === "done") {
    const r = outcome.result;
    const recipient = choices.find((e) => e.id === r.employeeId);
    const who = recipient?.name ?? (responsible?.employeeId === r.employeeId ? responsible.employeeName : null) ?? t("office.assign.defaultRecipient");
    const queued = r.state === "QUEUED";
    return (
      <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
        <DialogSurface className={mergeClasses("orbit-touch", isMobile ? s.surfaceMobile : s.surface)}>
          <DialogBody>
            <DialogTitle>{queued ? t("office.assign.doneQueued") : t("office.assign.doneStarted")}</DialogTitle>
            <DialogContent className={s.dialogContent}>
              <div className={s.colleagueCard}>
                <div className={s.portraitFrame}>
                  <PixelChibiSvg name={who} workLabel={recipient?.workLabel ?? "working"} size={50} />
                </div>
                <div className={s.colleagueMeta}>
                  <Text weight="semibold" size={400}>
                    {who}
                  </Text>
                  <Text size={200} className={o.muted}>
                    {recipient?.title ?? t("office.assign.defaultTitle")}
                    {title.trim() ? ` · ${title.trim()}` : ""}
                  </Text>
                </div>
              </div>
              <MessageBar intent={queued ? "info" : "success"}>
                <MessageBarBody>
                  {queued ? t("office.assign.queuedBody", { who }) : t("office.assign.startedBody", { who })}
                  {t("office.assign.stateLine", { state: ASSIGNMENT_STATE_TEXT[r.state] })}
                </MessageBarBody>
              </MessageBar>
            </DialogContent>
            <DialogActions>
              <Button type="button" onClick={onClose}>
                {t("office.assign.close")}
              </Button>
              <Button type="button" appearance="primary" onClick={() => onOpenMission(r.missionId)}>
                {t("office.assign.openWork")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    );
  }

  const holding = outcome?.kind === "busy" ? outcome.details?.holding : null;
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={mergeClasses("orbit-touch", isMobile ? s.surfaceMobile : s.surface)}>
        <form
          className={s.formWrap}
          onSubmit={(e) => {
            e.preventDefault();
            void submit(whenBusy);
          }}
        >
          <DialogBody className={s.dialogBody}>
            <DialogTitle>{t("office.assign.title")}</DialogTitle>
            <DialogContent className={s.dialogContent}>
              <div className={s.sectionCard}>
                <div className={s.sectionHead}>
                  <IconBadge icon={<DesksIcon size={14} active />} tone="brand" size="sm" />
                  <Text weight="semibold" size={300}>
                    {t("office.assign.colleagueDesk")}
                  </Text>
                </div>
                <Field label={t("office.assign.giveToLabel")}>
                  <RadioGroup className={s.kindGroup} layout="horizontal" value={kind} onChange={(_, d) => chooseKind(d.value as TargetKind)}>
                    <Radio value="employee" label={t("office.assign.toEmployee")} />
                    <Radio value="department" label={t("office.assign.toDepartment")} />
                    <Radio value="ceo" label={t("office.assign.toCeo")} />
                  </RadioGroup>
                </Field>
                {kind === "employee" && employee && (
                  <div className={s.colleagueCard}>
                    <div className={s.portraitFrame}>
                      <PixelChibiSvg name={employee.name} workLabel={employee.workLabel} size={50} />
                    </div>
                    <div className={s.colleagueMeta}>
                      <div className={o.row}>
                        <Text weight="semibold" size={400}>
                          {employee.name}
                        </Text>
                        <WorkLabelBadge label={employee.workLabel} />
                      </div>
                      <Text size={200} className={o.muted}>
                        {employee.title}
                      </Text>
                      {employee.holding && outcome?.kind !== "busy" ? (
                        <Text size={200} className={o.muted}>
                          {t("office.assign.workingOnNow", {
                            name: employee.name,
                            title: employee.holding.title,
                            queued: employee.queued > 0 ? t("office.assign.withQueued", { count: employee.queued }) : "",
                          })}
                        </Text>
                      ) : (
                        <Text size={200} className={o.muted}>
                          {employee.workLabel === "ready" ? t("office.assign.readyAtDesk") : deskMoodText(employee.workLabel)}
                        </Text>
                      )}
                    </div>
                  </div>
                )}
                {kind === "employee" && choices.length > 1 && choices.length <= 8 && (
                  <div className={s.seatStrip} role="group" aria-label={t("office.assign.quickDeskSwitch")}>
                    {choices.map((c) => {
                      const p = personaFor(c.name);
                      const selected = c.id === target;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className={mergeClasses(s.seatChip, selected && s.seatChipSelected)}
                          aria-pressed={selected}
                          aria-label={t("office.assign.walkUpToDesk", { name: c.name })}
                          onClick={() => chooseTarget(c.id)}
                        >
                          <span className={s.chipAvatar} style={{ backgroundColor: p.shirt }} aria-hidden>
                            {p.initials}
                          </span>
                          <Text size={200} weight={selected ? "semibold" : "regular"}>
                            {c.name}
                          </Text>
                          <span className={s.chipDot} style={{ backgroundColor: presenceStatusColor(c.workLabel) }} aria-hidden />
                        </button>
                      );
                    })}
                  </div>
                )}
                {kind === "employee" && (
                  <Field label={t("office.assign.employeeLabel")} required>
                    <Select ref={select} value={target} onChange={(_, d) => chooseTarget(d.value)}>
                      {choices.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name} — {e.title} ({WORK_LABEL_TEXT[e.workLabel]})
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                {kind === "department" &&
                  (roster.data === null ? (
                    roster.error !== null ? (
                      <MessageBar intent="error">
                        <MessageBarBody>{roster.error}</MessageBarBody>
                      </MessageBar>
                    ) : (
                      <Spinner size="tiny" label={t("office.assign.readingDepartments")} />
                    )
                  ) : departments.length === 0 ? (
                    <Text size={200} className={o.muted}>
                      {t("office.assign.noDepartment")}
                    </Text>
                  ) : (
                    <Field label={t("office.assign.departmentLabel")} required hint={t("office.assign.departmentHint")}>
                      <Select value={departmentId} onChange={(_, d) => chooseDepartment(d.value)}>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  ))}
                {previewKey !== null && <TargetResponsible preview={shown?.value ?? null} loading={shown === null} error={shown?.error ?? null} />}
              </div>

              <div className={s.sectionCard}>
                <div className={s.sectionHead}>
                  <IconBadge icon={<WorkMissionIcon size={14} active />} tone="brand" size="sm" />
                  <Text weight="semibold" size={300}>
                    {t("office.assign.theBrief")}
                  </Text>
                </div>
                <Field label={t("office.assign.titleLabel")} hint={t("office.assign.titleHint")}>
                  <Input value={title} maxLength={120} onChange={(_, d) => setTitle(d.value)} />
                </Field>
                <Field label={t("office.assign.goalLabel")} required hint={t("office.assign.goalHint")}>
                  <Textarea value={goal} resize="vertical" rows={4} onChange={(_, d) => setGoal(d.value)} />
                </Field>
              </div>

              <div className={s.sectionCard}>
                <div className={s.sectionHead}>
                  <IconBadge icon={<PolicyIcon size={14} active />} tone="teal" size="sm" />
                  <Text weight="semibold" size={300}>
                    {t("office.assign.deliverablesAndSources")}
                  </Text>
                </div>
                <div role="group" aria-label={t("office.assign.deliverables")} className={o.stack}>
                  <Text weight="semibold" size={300}>
                    {t("office.assign.deliverables")}
                  </Text>
                  <Text size={200} className={o.muted}>
                    {t("office.assign.deliverablesHint")}
                  </Text>
                  <div className={o.stack}>
                    {deliverables.length > 0 && (
                      <ul className={o.list} aria-label={t("office.assign.deliverablesListAria")}>
                        {deliverables.map((d) => (
                          <li key={d.name} className={s.deliverable}>
                            <div className={s.deliverableLeft}>
                              <Text weight="medium">{d.name}</Text>
                              <Badge appearance="tint" color={d.required ? "brand" : "subtle"} size="small" style={{ borderRadius: "9999px" }}>
                                {d.required ? t("office.assign.requiredTag") : t("office.assign.optionalTag")}
                              </Badge>
                            </div>
                            <Button type="button" size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={t("office.assign.removeDeliverable", { name: d.name })} onClick={() => setDeliverables(deliverables.filter((x) => x !== d))} />
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className={s.addRow}>
                      <Input aria-label={t("office.assign.deliverableNameAria")} placeholder={t("office.assign.deliverablePlaceholder")} value={newName} onChange={(_, d) => setNewName(d.value)} />
                      <Checkbox label={t("office.assign.requiredLabel")} checked={newRequired} onChange={(_, d) => setNewRequired(d.checked === true)} />
                      <Button type="button" icon={<Add16Regular />} onClick={addDeliverable} disabled={newName.trim() === ""}>
                        {t("office.assign.add")}
                      </Button>
                    </div>
                  </div>
                </div>
                <div className={o.divider} />
                <SourcesPicker value={sources} onChange={setSources} />
                {recipientId !== "" && (
                  <>
                    <div className={o.divider} />
                    <RepositoriesPicker employeeId={recipientId} employeeName={recipientName ?? ""} value={chosenRepositories} onChange={(list) => setRepositories({ for: recipientId, list })} />
                  </>
                )}
              </div>

              <div className={s.sectionCard}>
                <div className={s.sectionHead}>
                  <IconBadge icon={<QueuedIcon size={14} active />} tone="neutral" size="sm" />
                  <Text weight="semibold" size={300}>
                    {t("office.assign.expectationsTiming")}
                  </Text>
                </div>
                <div className={s.expectGrid}>
                  <Field label={t("office.assign.criteriaLabel")} hint={t("office.assign.criteriaHint")}>
                    <Textarea value={criteria} resize="vertical" rows={3} onChange={(_, d) => setCriteria(d.value)} />
                  </Field>
                  <Field label={t("office.assign.deadlineLabel")} hint={t("office.assign.deadlineHint")}>
                    <Input type="datetime-local" value={deadline} onChange={(_, d) => setDeadline(d.value)} />
                  </Field>
                </div>
                <Field label={t("office.assign.whenBusyLabel")}>
                  <RadioGroup value={whenBusy} onChange={(_, d) => setWhenBusy(d.value as WhenBusy)}>
                    <Radio value="reject" label={t("office.assign.whenBusyReject")} />
                    <Radio value="enqueue" label={t("office.assign.whenBusyEnqueue")} />
                  </RadioGroup>
                </Field>
              </div>

              <Disclosure />
              {problems.length > 0 && (
                <MessageBar intent="error" layout="multiline">
                  <MessageBarBody>{problems.join("; ")}</MessageBarBody>
                </MessageBar>
              )}
              {outcome?.kind === "changed" && (
                <MessageBar intent="warning" layout="multiline">
                  <MessageBarBody>{t("office.assign.targetChanged", { who: responsibleText(t, outcome.responsible) })}</MessageBarBody>
                </MessageBar>
              )}
              {outcome?.kind === "busy" && (
                <MessageBar intent="warning" layout="multiline">
                  <MessageBarBody>
                    {t("office.assign.busyTitle", { name: recipientName ?? t("office.assign.defaultRecipient") })}
                    {holding ? t("office.assign.busyHolding", { title: holding.title, state: ASSIGNMENT_STATE_TEXT[holding.state], since: when(holding.since) }) : t("office.assign.busyOther")}
                  </MessageBarBody>
                  <MessageBarActions>
                    <Button type="button" size="small" appearance="primary" disabled={busy} onClick={() => void submit("enqueue")}>
                      {t("office.assign.queueIt")}
                    </Button>
                    <Button
                      type="button"
                      size="small"
                      onClick={() => {
                        setOutcome(null);
                        setKind("employee");
                        select.current?.focus();
                      }}
                    >
                      {t("office.assign.chooseAnother")}
                    </Button>
                  </MessageBarActions>
                </MessageBar>
              )}
              {outcome?.kind === "failed" &&
                (isConnectionRequired(outcome.error) ? (
                  <ConnectionRequired />
                ) : (
                  <MessageBar intent="error">
                    <MessageBarBody>{errorText(outcome.error)}</MessageBarBody>
                  </MessageBar>
                ))}
            </DialogContent>
            <DialogActions className={s.dialogActions}>
              <Button type="button" onClick={onClose}>
                {t("office.assign.cancel")}
              </Button>
              <Button appearance="primary" type="submit" disabled={busy || !ready || goal.trim() === ""}>
                {busy ? t("office.assign.assigning") : whenBusy === "enqueue" ? t("office.assign.assignOrQueue") : t("office.assign.startNow")}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
