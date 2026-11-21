// ASSIGN WORK: what is wanted (a goal, the deliverables, how it is accepted) and who does it. "Start now" is the default:
// a busy employee refuses it and NOTHING is created -- the dialog keeps everything typed, says what the employee holds,
// and offers to queue it behind that work (a new request, with a new key) or to choose somebody else. What came back is
// said as the API said it: started, or queued.
import { Button, Checkbox, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, MessageBar, MessageBarActions, MessageBarBody, Radio, RadioGroup, Select, Text, Textarea, makeStyles } from "@fluentui/react-components";
import { Add16Regular, Dismiss16Regular } from "@fluentui/react-icons";
import { ASSIGNMENT_STATE_TEXT, WORK_LABEL_TEXT, checkCreateMission, type CreateMissionRequest, type Deliverable, type EmployeeBusyDetails, type EmployeeCard, type MissionAccepted, type WhenBusy } from "@orbit-web/contracts";
import { useRef, useState } from "react";
import { ConnectionRequired, isConnectionRequired } from "../../components/ApiErrorBar";
import { useViewport } from "../../hooks/useViewport";
import { ApiError, errorText, newIdempotencyKey } from "../../services/api";
import { office } from "./api";
import { Disclosure, useOfficeStyles, when } from "./parts";

const useStyles = makeStyles({
  surface: { width: "min(720px, 96vw)", maxWidth: "min(720px, 96vw)", maxHeight: "92dvh" },
  surfaceMobile: { width: "100vw", maxWidth: "100vw", height: "var(--orbit-app-height, 100dvh)", maxHeight: "var(--orbit-app-height, 100dvh)", marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, borderRadius: 0 },
  deliverable: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  addRow: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: "8px", alignItems: "end", "@media (max-width: 479px)": { gridTemplateColumns: "minmax(0, 1fr)" } },
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
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const select = useRef<HTMLSelectElement>(null);
  // The key of the request as last sent: the same body is the same request (sent again with its key), any other is new.
  const sent = useRef<{ body: string; key: string } | null>(null);
  const employee = choices.find((e) => e.id === target) ?? null;

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
    const who = choices.find((e) => e.id === r.employeeId)?.name ?? "The employee";
    const queued = r.state === "QUEUED";
    return (
      <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
        <DialogSurface className={isMobile ? s.surfaceMobile : s.surface}>
          <DialogBody>
            <DialogTitle>{queued ? "Queued" : "Started"}</DialogTitle>
            <DialogContent className={o.form}>
              <MessageBar intent={queued ? "info" : "success"}>
                <MessageBarBody>
                  {queued ? `It waits behind ${who}'s current work.` : `${who} holds it now.`} State: {ASSIGNMENT_STATE_TEXT[r.state]}.
                </MessageBarBody>
              </MessageBar>
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>Close</Button>
              <Button appearance="primary" onClick={() => onOpenMission(r.missionId)}>
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
      <DialogSurface className={isMobile ? s.surfaceMobile : s.surface}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(whenBusy);
          }}
        >
          <DialogBody>
            <DialogTitle>Assign work</DialogTitle>
            <DialogContent className={o.form}>
              <Field label="Employee" required>
                <Select
                  ref={select}
                  value={target}
                  onChange={(_, d) => {
                    setTarget(d.value);
                    if (outcome?.kind === "busy") setOutcome(null);
                  }}
                >
                  {choices.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} — {e.title} ({WORK_LABEL_TEXT[e.workLabel]})
                    </option>
                  ))}
                </Select>
              </Field>
              {employee?.holding && outcome?.kind !== "busy" && (
                <Text size={200} className={o.muted}>
                  {employee.name} is working on “{employee.holding.title}” now{employee.queued > 0 ? `, with ${employee.queued} queued` : ""}.
                </Text>
              )}
              <Field label="Title" hint="Optional: the goal's first line is used otherwise.">
                <Input value={title} maxLength={120} onChange={(_, d) => setTitle(d.value)} />
              </Field>
              <Field label="Goal" required hint="What you want done, as you would tell a colleague.">
                <Textarea value={goal} resize="vertical" rows={4} onChange={(_, d) => setGoal(d.value)} />
              </Field>
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
                          <Text>{d.name}</Text>
                          <Text size={200} className={o.muted}>
                            {d.required ? "required" : "optional"}
                          </Text>
                          <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={`Remove ${d.name}`} onClick={() => setDeliverables(deliverables.filter((x) => x !== d))} />
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className={s.addRow}>
                    <Input aria-label="Deliverable file name" placeholder="report.pdf" value={newName} onChange={(_, d) => setNewName(d.value)} />
                    <Checkbox label="Required" checked={newRequired} onChange={(_, d) => setNewRequired(d.checked === true)} />
                    <Button icon={<Add16Regular />} onClick={addDeliverable} disabled={newName.trim() === ""}>
                      Add
                    </Button>
                  </div>
                </div>
              </div>
              <Field label="Acceptance criteria" hint="Optional, one per line: what makes the result acceptable.">
                <Textarea value={criteria} resize="vertical" rows={3} onChange={(_, d) => setCriteria(d.value)} />
              </Field>
              <Field label="Deadline" hint="Optional.">
                <Input type="datetime-local" value={deadline} onChange={(_, d) => setDeadline(d.value)} />
              </Field>
              <Field label="If the employee is busy">
                <RadioGroup value={whenBusy} onChange={(_, d) => setWhenBusy(d.value as WhenBusy)}>
                  <Radio value="reject" label="Start now — if it is busy, nothing is created and you choose what next" />
                  <Radio value="enqueue" label="Queue it behind its current work" />
                </RadioGroup>
              </Field>
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
                    <Button size="small" appearance="primary" disabled={busy} onClick={() => void submit("enqueue")}>
                      Queue it
                    </Button>
                    <Button
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
            <DialogActions>
              <Button onClick={onClose}>Cancel</Button>
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
