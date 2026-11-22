// ASSIGN WORK: walking up to a colleague's virtual desk to hand over a brief -- who takes it, what is wanted, what
// files it must hand in, pinned research sources, and how busy desks are handled. "Start now" is the default: a busy
// employee refuses it and NOTHING is created -- everything typed stays, the held work is shown, and you can queue it
// behind that work (with a new idempotency key) or walk over to another colleague's desk.
import { Badge, Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, MessageBar, MessageBarActions, MessageBarBody, Radio, RadioGroup, Select, Text, Textarea, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Add16Regular, Dismiss16Regular } from "@fluentui/react-icons";
import { ASSIGNMENT_STATE_TEXT, WORK_LABEL_TEXT, checkCreateMission, type CreateMissionRequest, type Deliverable, type EmployeeBusyDetails, type EmployeeCard, type MissionAccepted, type WhenBusy, type MissionRepositoryRequest } from "@orbit-web/contracts";
import { useRef, useState } from "react";
import { ConnectionRequired, isConnectionRequired } from "../../components/ApiErrorBar";
import { DesksIcon, IconBadge, PolicyIcon, QueuedIcon, WorkMissionIcon } from "../../components/SectionIcons";
import { useViewport } from "../../hooks/useViewport";
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

type Outcome = { kind: "done"; result: MissionAccepted } | { kind: "busy"; details: EmployeeBusyDetails | null; message: string } | { kind: "failed"; error: unknown } | null;

export function AssignDialog({ employees, employeeId = null, onClose, onOpenMission }: { employees: EmployeeCard[]; employeeId?: string | null; onClose: () => void; onOpenMission: (missionId: string) => void }) {
  const s = useStyles();
  const o = useOfficeStyles();
  const { isMobile } = useViewport();
  const choices = employees.filter((e) => e.employment !== "archived");
  const [target, setTarget] = useState<string>(employeeId ?? choices[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [newName, setNewName] = useState("");
  const [newRequired, setNewRequired] = useState(true);
  const [criteria, setCriteria] = useState("");
  const [deadline, setDeadline] = useState("");
  const [whenBusy, setWhenBusy] = useState<WhenBusy>("reject");
  const [sources, setSources] = useState<PinnedSources>(NO_SOURCES);
  // The repositories chosen, for the employee chosen (another employee may use others: a change of employee clears them).
  const [repositories, setRepositories] = useState<{ for: string; list: MissionRepositoryRequest[] }>({ for: "", list: [] });
  const chosenRepositories = repositories.for === target ? repositories.list : [];
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const select = useRef<HTMLSelectElement>(null);
  // The key of the request as last sent: the same body is the same request (sent again with its key), any other is new.
  const sent = useRef<{ body: string; key: string } | null>(null);
  const employee = choices.find((e) => e.id === target) ?? null;

  const chooseTarget = (nextId: string) => {
    setTarget(nextId);
    if (outcome?.kind === "busy") setOutcome(null);
  };

  const bodyOf = (mode: WhenBusy): CreateMissionRequest => ({
    goal: goal.trim(),
    ...(title.trim() ? { title: title.trim() } : {}),
    targetEmployeeId: target,
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

  const submit = async (mode: WhenBusy) => {
    const body = bodyOf(mode);
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
      else setOutcome({ kind: "failed", error: err });
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
    const who = recipient?.name ?? "The employee";
    const queued = r.state === "QUEUED";
    return (
      <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
        <DialogSurface className={mergeClasses("orbit-touch", isMobile ? s.surfaceMobile : s.surface)}>
          <DialogBody>
            <DialogTitle>{queued ? "Queued" : "Started"}</DialogTitle>
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
                    {recipient?.title ?? "Teammate"}
                    {title.trim() ? ` · ${title.trim()}` : ""}
                  </Text>
                </div>
              </div>
              <MessageBar intent={queued ? "info" : "success"}>
                <MessageBarBody>
                  {queued ? `It waits behind ${who}'s current work.` : `${who} holds it now.`} State: {ASSIGNMENT_STATE_TEXT[r.state]}.
                </MessageBarBody>
              </MessageBar>
            </DialogContent>
            <DialogActions>
              <Button type="button" onClick={onClose}>
                Close
              </Button>
              <Button type="button" appearance="primary" onClick={() => onOpenMission(r.missionId)}>
                Open the work
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
            <DialogTitle>Assign work</DialogTitle>
            <DialogContent className={s.dialogContent}>
              <div className={s.sectionCard}>
                <div className={s.sectionHead}>
                  <IconBadge icon={<DesksIcon size={14} active />} tone="brand" size="sm" />
                  <Text weight="semibold" size={300}>
                    Colleague desk
                  </Text>
                </div>
                {employee && (
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
                          {employee.name} is working on “{employee.holding.title}” now{employee.queued > 0 ? `, with ${employee.queued} queued` : ""}.
                        </Text>
                      ) : (
                        <Text size={200} className={o.muted}>
                          {employee.workLabel === "ready" ? "At desk and ready to start right away." : deskMoodText(employee.workLabel)}
                        </Text>
                      )}
                    </div>
                  </div>
                )}
                {choices.length > 1 && choices.length <= 8 && (
                  <div className={s.seatStrip} role="group" aria-label="Quick desk switch">
                    {choices.map((c) => {
                      const p = personaFor(c.name);
                      const selected = c.id === target;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          className={mergeClasses(s.seatChip, selected && s.seatChipSelected)}
                          aria-pressed={selected}
                          aria-label={`Walk up to ${c.name}'s desk`}
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
                <Field label="Employee" required>
                  <Select ref={select} value={target} onChange={(_, d) => chooseTarget(d.value)}>
                    {choices.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} — {e.title} ({WORK_LABEL_TEXT[e.workLabel]})
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className={s.sectionCard}>
                <div className={s.sectionHead}>
                  <IconBadge icon={<WorkMissionIcon size={14} active />} tone="brand" size="sm" />
                  <Text weight="semibold" size={300}>
                    The brief
                  </Text>
                </div>
                <Field label="Title" hint="Optional: the goal's first line is used otherwise.">
                  <Input value={title} maxLength={120} onChange={(_, d) => setTitle(d.value)} />
                </Field>
                <Field label="Goal" required hint="What you want done, as you would tell a colleague.">
                  <Textarea value={goal} resize="vertical" rows={4} onChange={(_, d) => setGoal(d.value)} />
                </Field>
              </div>

              <div className={s.sectionCard}>
                <div className={s.sectionHead}>
                  <IconBadge icon={<PolicyIcon size={14} active />} tone="teal" size="sm" />
                  <Text weight="semibold" size={300}>
                    Deliverables & sources
                  </Text>
                </div>
                <div role="group" aria-label="Deliverables" className={o.stack}>
                  <Text weight="semibold" size={300}>
                    Deliverables
                  </Text>
                  <Text size={200} className={o.muted}>
                    Files it must hand in (a plain file name each).
                  </Text>
                  <div className={o.stack}>
                    {deliverables.length > 0 && (
                      <ul className={o.list} aria-label="Deliverables to hand in">
                        {deliverables.map((d) => (
                          <li key={d.name} className={s.deliverable}>
                            <div className={s.deliverableLeft}>
                              <Text weight="medium">{d.name}</Text>
                              <Badge appearance="tint" color={d.required ? "brand" : "subtle"} size="small" style={{ borderRadius: "9999px" }}>
                                {d.required ? "required" : "optional"}
                              </Badge>
                            </div>
                            <Button type="button" size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={`Remove ${d.name}`} onClick={() => setDeliverables(deliverables.filter((x) => x !== d))} />
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className={s.addRow}>
                      <Input aria-label="Deliverable file name" placeholder="report.pdf" value={newName} onChange={(_, d) => setNewName(d.value)} />
                      <Checkbox label="Required" checked={newRequired} onChange={(_, d) => setNewRequired(d.checked === true)} />
                      <Button type="button" icon={<Add16Regular />} onClick={addDeliverable} disabled={newName.trim() === ""}>
                        Add
                      </Button>
                    </div>
                  </div>
                </div>
                <div className={o.divider} />
                <SourcesPicker value={sources} onChange={setSources} />
                <div className={o.divider} />
                <RepositoriesPicker employeeId={target} employeeName={choices.find((c) => c.id === target)?.name ?? ""} value={chosenRepositories} onChange={(list) => setRepositories({ for: target, list })} />
              </div>

              <div className={s.sectionCard}>
                <div className={s.sectionHead}>
                  <IconBadge icon={<QueuedIcon size={14} active />} tone="neutral" size="sm" />
                  <Text weight="semibold" size={300}>
                    Expectations & timing
                  </Text>
                </div>
                <div className={s.expectGrid}>
                  <Field label="Acceptance criteria" hint="Optional, one per line: what makes the result acceptable.">
                    <Textarea value={criteria} resize="vertical" rows={3} onChange={(_, d) => setCriteria(d.value)} />
                  </Field>
                  <Field label="Deadline" hint="Optional.">
                    <Input type="datetime-local" value={deadline} onChange={(_, d) => setDeadline(d.value)} />
                  </Field>
                </div>
                <Field label="If the employee is busy">
                  <RadioGroup value={whenBusy} onChange={(_, d) => setWhenBusy(d.value as WhenBusy)}>
                    <Radio value="reject" label="Start now — if it is busy, nothing is created and you choose what next" />
                    <Radio value="enqueue" label="Queue it behind its current work" />
                  </RadioGroup>
                </Field>
              </div>

              <Disclosure />
              {problems.length > 0 && (
                <MessageBar intent="error" layout="multiline">
                  <MessageBarBody>{problems.join("; ")}</MessageBarBody>
                </MessageBar>
              )}
              {outcome?.kind === "busy" && (
                <MessageBar intent="warning" layout="multiline">
                  <MessageBarBody>
                    {employee?.name ?? "The employee"} is busy, so nothing was created.{" "}
                    {holding ? `It is working on “${holding.title}” (${ASSIGNMENT_STATE_TEXT[holding.state]}) since ${when(holding.since)}.` : "It holds other work you may not read."}
                  </MessageBarBody>
                  <MessageBarActions>
                    <Button type="button" size="small" appearance="primary" disabled={busy} onClick={() => void submit("enqueue")}>
                      Queue it
                    </Button>
                    <Button
                      type="button"
                      size="small"
                      onClick={() => {
                        setOutcome(null);
                        select.current?.focus();
                      }}
                    >
                      Choose another employee
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
                Cancel
              </Button>
              <Button appearance="primary" type="submit" disabled={busy || target === "" || goal.trim() === ""}>
                {busy ? "Assigning…" : whenBusy === "enqueue" ? "Assign or queue" : "Start now"}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}
