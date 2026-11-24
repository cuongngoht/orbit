// ONE MISSION: what was wanted, who it was given to (an employee, a department through its manager, the CEO) and who has
// to act on it now; its assignments as the tree its leads made (each part reviewed by its lead, the root by the person),
// the questions they asked and where each went, and what each lead shared with its parts -- which a person may take back.
// Then what happened in order, the results handed in -- grouped by assignment, each revision with its artifacts, its
// claims (supported by a source, or not) and what it is missing -- and the last attempt, its model, effort and resources
// as asked, resolved and observed. A command names the version of the assignment read (If-Match) and a review the
// revision being read (its digest): if either moved on, nothing is done and the page offers the latest.
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Link,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarBody,
  Radio,
  RadioGroup,
  Select,
  Spinner,
  Tab,
  TabList,
  Text,
  Textarea,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
  useRestoreFocusTarget,
} from "@fluentui/react-components";
import { ArrowDownload16Regular, MoreHorizontal16Regular } from "@fluentui/react-icons";
import {
  ASSIGNMENT_STATE_TEXT,
  DELIVERY_STATE_TEXT,
  WORK_LABEL_TEXT,
  type AssignmentAction,
  type AssignmentTarget,
  type AssignmentView,
  type ClarificationKind,
  type ClarificationState,
  type ClarificationView,
  type DataShareView,
  type DeliveryView,
  type Employment,
  type HandoffStatus,
  type HandoffView,
  type MissionDetail,
  type Roster,
  type TeamRoomChange,
} from "@orbit-web/contracts";
import { useState } from "react";
import type { OfficePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useI18n, type I18nContextValue, type MessageKey } from "../../i18n";
import { bytesText } from "../resources/format";
import { isNotServed, office, useOfficeRead, wholeRoster, type AssignmentCommand } from "./api";
import { AsOf, EmployeeAvatar, ProblemBar, RUN_STATE_KEYS, StateBadge, short, useAction, useOfficeStyles, when } from "./parts";
import { RunDetails } from "./RunDetails";

const useStyles = makeStyles({
  nested: { borderLeftWidth: "3px", borderLeftColor: tokens.colorBrandStroke2 },
  // A part's own parts, under it: indented a few levels, then flat -- a deep tree never pushes the page sideways.
  branch: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    listStyleType: "none",
    marginTop: "8px",
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    paddingLeft: "14px",
    minWidth: 0,
  },
  branchFlat: { paddingLeft: 0 },
  node: { minWidth: 0 },
  // What a person or an employee wrote, shown as the plain text it is: line breaks kept, never markup.
  plain: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", minWidth: 0 },
  route: { display: "flex", flexDirection: "column", gap: "2px", marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, paddingLeft: "18px", minWidth: 0 },
  group: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 },
  timelineList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    listStyleType: "none",
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: "6px",
    paddingLeft: "16px",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.colorNeutralStroke2,
    minWidth: 0,
  },
  timelineItem: { position: "relative" },
  timelineDot: {
    position: "absolute",
    left: "-22px",
    top: "14px",
    width: "10px",
    height: "10px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorBrandBackground,
    ...shorthands.border("2px", "solid", "var(--orbit-card-bg)"),
  },
});

type Go = (page: OfficePage, item?: string | null, tab?: string | null) => void;

export const MISSION_TABS = ["overview", "timeline", "handoffs", "team", "run"] as const;
type MissionTab = (typeof MISSION_TABS)[number];
const TAB_KEYS: Record<MissionTab, MessageKey> = {
  overview: "office.mission.tab.overview",
  timeline: "office.mission.tab.timeline",
  handoffs: "office.mission.tab.handoffs",
  team: "office.mission.tab.team",
  run: "office.mission.tab.run",
};

const HANDOFF_KEYS: Record<HandoffStatus, MessageKey> = {
  submitted: "office.mission.handoff.submitted",
  revision_requested: "office.mission.handoff.revision_requested",
  accepted: "office.mission.handoff.accepted",
  superseded: "office.mission.handoff.superseded",
};

const ACTION_KEYS: Partial<Record<AssignmentCommand, MessageKey>> = {
  pause: "office.mission.action.pause",
  resume: "office.mission.action.resume",
  cancel: "office.mission.action.cancel",
  retry: "office.mission.action.retry",
};

const QUESTION_STATE_KEYS: Record<ClarificationState, MessageKey> = {
  open: "office.mission.questionState.open",
  answered: "office.mission.questionState.answered",
  withdrawn: "office.mission.questionState.withdrawn",
};

const QUESTION_KIND_KEYS: Record<ClarificationKind, MessageKey> = {
  information: "office.mission.questionKind.information",
  human_decision: "office.mission.questionKind.human_decision",
  beyond_authority: "office.mission.questionKind.beyond_authority",
  deadline: "office.mission.questionKind.deadline",
  unanswered: "office.mission.questionKind.unanswered",
};

// The commands of an assignment given at once (a review is given from its hand-in, an answer from its question; a
// handover and a repin ask first).
const COMMAND_OF: Partial<Record<AssignmentAction, AssignmentCommand>> = { pause: "pause", resume: "resume", cancel: "cancel", retry: "retry" };

// Who may take work handed over (the API's rule, said again here only to offer the right people): on trial or active.
const WORKING: readonly Employment[] = ["probation", "active"];

// How deep the tree is drawn under its root; what lies deeper is shown at the top, never hidden.
const MAX_DEPTH = 8;

interface TreeNode {
  a: AssignmentView;
  children: TreeNode[];
}

// The assignments as the tree their parents make: the root and, under each, the parts it gave its team. Anything whose
// parent is not in the list (or that lies deeper than MAX_DEPTH) is shown at the top, never hidden.
function treeOf(assignments: readonly AssignmentView[]): TreeNode[] {
  const ids = new Set(assignments.map((a) => a.id));
  const placed = new Set<string>();
  const build = (a: AssignmentView, depth: number): TreeNode => {
    placed.add(a.id);
    const children = depth < MAX_DEPTH ? assignments.filter((x) => x.parentId === a.id && !placed.has(x.id)) : [];
    return { a, children: children.map((c) => build(c, depth + 1)) };
  };
  const out: TreeNode[] = [];
  for (const a of assignments) if (!placed.has(a.id) && (a.parentId === null || !ids.has(a.parentId))) out.push(build(a, 0));
  for (const a of assignments) if (!placed.has(a.id)) out.push(build(a, 0));
  return out;
}

const flatten = (nodes: readonly TreeNode[]): AssignmentView[] => nodes.flatMap((n) => [n.a, ...flatten(n.children)]);

// Who reviews an assignment's hand-ins: the person (a mission's root) or its lead (a part).
const reviewText = (t: I18nContextValue["t"], a: AssignmentView): string =>
  a.reviewedBy === "owner" ? t("office.mission.reviewedByYou") : a.leadName ? t("office.mission.reviewedByLead", { name: a.leadName }) : t("office.mission.reviewedByItsLead");

// Who a mission was given to: an employee by name, a department through its manager, the CEO -- and by which slot
// revision of the appointment that resolved it.
function givenToText(t: I18nContextValue["t"], target: AssignmentTarget): string {
  const revision = target.appointmentRevision === null ? "" : t("office.mission.appointmentRevision", { revision: target.appointmentRevision });
  if (target.kind === "department") return t("office.mission.givenToDepartment", { department: target.departmentName ?? t("office.mission.aDepartment"), revision });
  if (target.kind === "ceo") return t("office.mission.givenToCeo", { revision });
  return t("office.mission.givenToEmployee");
}

// ---- the commands on one assignment -------------------------------------------------------------------------------

function useCommands(a: AssignmentView, onDone: () => void) {
  const act = useAction();
  const [dialog, setDialog] = useState<"hand_over" | "repin" | null>(null);
  const commands = a.actions.map((x) => COMMAND_OF[x]).filter((c): c is AssignmentCommand => c !== undefined);
  const run = async (command: AssignmentCommand, body?: unknown) => {
    if (await act.run(() => office.command(a.id, a.version, command, body))) onDone();
  };
  return { act, dialog, setDialog, commands, run, handOver: a.actions.includes("hand_over"), repin: a.actions.includes("repin") };
}

// HAND OVER: open work moves to another employee, chosen among those on trial or active -- a person's act, against the
// version of the assignment read. What the API refuses (an attempt still running, an employee who cannot take it) is
// said as it said it.
function HandOverDialog({ a, onClose, onDone, onLoadLatest }: { a: AssignmentView; onClose: () => void; onDone: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const people = useResource<Roster>(() => wholeRoster(), []);
  const act = useAction();
  const [employeeId, setEmployeeId] = useState("");
  const [reason, setReason] = useState("");
  const candidates = (people.data?.employees ?? []).filter((e) => WORKING.includes(e.employment) && e.id !== a.employeeId);
  const save = async () => {
    const body = { employeeId, ...(reason.trim() === "" ? {} : { reason: reason.trim() }) };
    if (await act.run(() => office.handOver(a.id, a.version, body))) {
      onClose();
      onDone();
    }
  };
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className="orbit-touch">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogBody>
            <DialogTitle>{t("office.mission.handOver.title", { title: a.title })}</DialogTitle>
            <DialogContent className={o.form}>
              <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
                {t("office.mission.handOver.means", { name: a.employeeName })}
              </Text>
              {people.data === null ? (
                people.error !== null ? (
                  <Text size={200} className={o.danger}>
                    {people.error}
                  </Text>
                ) : (
                  <Spinner size="tiny" label={t("office.mission.handOver.reading")} />
                )
              ) : candidates.length === 0 ? (
                <Text size={200} className={o.muted}>
                  {t("office.mission.handOver.nobody")}
                </Text>
              ) : (
                <Field label={t("office.mission.handOver.whoLabel")} required>
                  <Select value={employeeId} onChange={(_, d) => setEmployeeId(d.value)}>
                    <option value="">{t("office.mission.handOver.choose")}</option>
                    {candidates.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} — {e.title} ({WORK_LABEL_TEXT[e.workLabel]})
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field label={t("office.mission.handOver.reasonLabel")} hint={t("office.mission.handOver.reasonHint")}>
                <Input value={reason} maxLength={1000} onChange={(_, d) => setReason(d.value)} />
              </Field>
              <ProblemBar
                problem={act.problem}
                onLoadLatest={() => {
                  onClose();
                  onLoadLatest();
                }}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>{t("office.assign.cancel")}</Button>
              <Button appearance="primary" type="submit" disabled={act.busy || employeeId === ""}>
                {t("office.mission.handOver.submit")}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

// REPIN: work blocked or paused goes on with its employee's profile in effect now, asked first.
function RepinDialog({ a, onClose, onDone, onLoadLatest }: { a: AssignmentView; onClose: () => void; onDone: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const act = useAction();
  const save = async () => {
    if (await act.run(() => office.repin(a.id, a.version))) {
      onClose();
      onDone();
    }
  };
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className="orbit-touch">
        <DialogBody>
          <DialogTitle>{t("office.mission.repin.title", { title: a.title })}</DialogTitle>
          <DialogContent className={o.form}>
            <Text className={o.wrap}>{t("office.mission.repin.means", { name: a.employeeName })}</Text>
            <ProblemBar
              problem={act.problem}
              onLoadLatest={() => {
                onClose();
                onLoadLatest();
              }}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t("office.assign.cancel")}</Button>
            <Button appearance="primary" disabled={act.busy} onClick={() => void save()}>
              {t("office.mission.repin.submit")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function CommandDialogs({ a, dialog, onClose, onDone, onLoadLatest }: { a: AssignmentView; dialog: "hand_over" | "repin" | null; onClose: () => void; onDone: () => void; onLoadLatest: () => void }) {
  if (dialog === "hand_over") return <HandOverDialog a={a} onClose={onClose} onDone={onDone} onLoadLatest={onLoadLatest} />;
  if (dialog === "repin") return <RepinDialog a={a} onClose={onClose} onDone={onDone} onLoadLatest={onLoadLatest} />;
  return null;
}

// The commands of the mission's root, under its plan. Its question is answered where the questions are; here only when
// the mission says no question of it (an answer the API still asks for is never left without a form).
function AssignmentActions({ a, answerHere, onDone, onLoadLatest }: { a: AssignmentView; answerHere: boolean; onDone: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const restore = useRestoreFocusTarget();
  const c = useCommands(a, onDone);
  const [answer, setAnswer] = useState("");
  return (
    <div className={o.stack}>
      {(c.commands.length > 0 || c.handOver || c.repin) && (
        <div className={o.row}>
          {c.commands.map((command) => (
            <Button key={command} className={o.touch} size="small" disabled={c.act.busy} onClick={() => void c.run(command)}>
              {ACTION_KEYS[command] ? t(ACTION_KEYS[command]!) : command}
            </Button>
          ))}
          {c.handOver && (
            <Button className={o.touch} size="small" disabled={c.act.busy} onClick={() => c.setDialog("hand_over")} {...restore}>
              {t("office.mission.action.handOver")}
            </Button>
          )}
          {c.repin && (
            <Button className={o.touch} size="small" disabled={c.act.busy} onClick={() => c.setDialog("repin")} {...restore}>
              {t("office.mission.action.repin")}
            </Button>
          )}
        </div>
      )}
      {answerHere && a.actions.includes("answer") && (
        <form
          className={o.form}
          aria-label={t("office.mission.answerAria")}
          onSubmit={(e) => {
            e.preventDefault();
            void c.run("answer", { answer: answer.trim() });
          }}
        >
          <Field label={t("office.mission.yourAnswer")} hint={a.waitingOn ? t("office.mission.itAsked", { question: a.waitingOn }) : t("office.mission.waitsForInfo")}>
            <Textarea value={answer} resize="vertical" onChange={(_, d) => setAnswer(d.value)} />
          </Field>
          <div>
            <Button type="submit" appearance="primary" disabled={c.act.busy || answer.trim() === ""}>
              {t("office.mission.sendAnswer")}
            </Button>
          </div>
        </form>
      )}
      <ProblemBar problem={c.act.problem} onLoadLatest={onLoadLatest} />
      <CommandDialogs a={a} dialog={c.dialog} onClose={() => c.setDialog(null)} onDone={onDone} onLoadLatest={onLoadLatest} />
    </div>
  );
}

// The commands of a part, in a menu on its row.
function PartActions({ a, c }: { a: AssignmentView; c: ReturnType<typeof useCommands> }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  if (c.commands.length === 0 && !c.handOver && !c.repin) return null;
  return (
    <Menu>
      <MenuTrigger disableButtonEnhancement>
        <Button className={o.touch} appearance="subtle" size="small" icon={<MoreHorizontal16Regular />} disabled={c.act.busy} aria-label={t("office.mission.partActions", { title: a.title })} />
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          {c.commands.map((command) => (
            <MenuItem key={command} onClick={() => void c.run(command)}>
              {ACTION_KEYS[command] ? t(ACTION_KEYS[command]!) : command}
            </MenuItem>
          ))}
          {c.handOver && <MenuItem onClick={() => c.setDialog("hand_over")}>{t("office.mission.action.handOver")}</MenuItem>}
          {c.repin && <MenuItem onClick={() => c.setDialog("repin")}>{t("office.mission.action.repin")}</MenuItem>}
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

// ---- the plan: the assignments as a tree --------------------------------------------------------------------------

function AssignmentRow({ a, nested, go, onDone, onLoadLatest }: { a: AssignmentView; nested: boolean; go: Go; onDone: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const c = useCommands(a, onDone);
  const part = a.parentId !== null;
  const facts = [reviewText(t, a), a.planCount > 0 ? t("office.mission.plansGiven", { count: a.planCount }) : null, a.questionCount > 0 ? t("office.mission.questionsAskedCount", { count: a.questionCount }) : null].filter((f): f is string => f !== null);
  return (
    <div className={mergeClasses(o.item, nested && s.nested)}>
      <div className={o.between}>
        <div className={o.row}>
          <StateBadge text={ASSIGNMENT_STATE_TEXT[a.state]} state={a.state} />
          <Text weight="semibold" className={o.wrap}>
            {a.title}
          </Text>
        </div>
        {part && <PartActions a={a} c={c} />}
      </div>
      <Text size={200} className={o.wrap}>
        {t("office.mission.heldByPrefix")}
        <Link as="button" onClick={() => go("employee", a.employeeId)}>
          {a.employeeName}
        </Link>
        {a.pinned.departmentName ? t("office.mission.deptWhenClaimed", { dept: a.pinned.departmentName }) : ""}
        {t("office.mission.attemptsAndRevision", { attempts: a.attempts, revision: a.handoffRevision })}
      </Text>
      <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
        {facts.join(" · ")}
      </Text>
      {a.target?.kind === "department" && (
        <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
          {t("office.mission.givenThroughDepartment", {
            department: a.target.departmentName ?? t("office.mission.aDepartment"),
            revision: a.target.appointmentRevision === null ? "" : t("office.mission.appointmentRevision", { revision: a.target.appointmentRevision }),
          })}
        </Text>
      )}
      {a.unitKey !== null && a.parentId !== null && (
        <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
          {t("office.mission.partOfPlan", { key: a.unitKey })}
          {a.brief.dependsOn.length > 0 ? t("office.mission.waitsForDeps", { deps: a.brief.dependsOn.map((k) => `“${k}”`).join(", ") }) : ""}
        </Text>
      )}
      {(a.reason || a.waitingOn) && (
        <Text size={200} className={mergeClasses(o.warn, o.wrap)}>
          {a.reason ?? ""}
          {a.waitingOn ? t("office.mission.waitingOn", { what: a.waitingOn }) : ""}
        </Text>
      )}
      {a.lastRun && (a.lastRun.state === "waiting_for_resources" || a.lastRun.state === "unschedulable") && (
        <Text size={200} className={mergeClasses(a.lastRun.state === "unschedulable" ? o.danger : o.warn, o.wrap)}>
          {t(RUN_STATE_KEYS[a.lastRun.state])}: {a.lastRun.waitingReason ?? t("office.run.noReasonGiven")}
        </Text>
      )}
      {a.lastRun?.wakeReason && (
        <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
          {t("office.mission.lastWake", { no: a.lastRun.attemptNo, why: a.lastRun.wakeReason })}
        </Text>
      )}
      {part && (
        <>
          <ProblemBar problem={c.act.problem} onLoadLatest={onLoadLatest} />
          <CommandDialogs a={a} dialog={c.dialog} onClose={() => c.setDialog(null)} onDone={onDone} onLoadLatest={onLoadLatest} />
        </>
      )}
    </div>
  );
}

function AssignmentNode({ node, depth, go, onDone, onLoadLatest }: { node: TreeNode; depth: number; go: Go; onDone: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  return (
    <li className={s.node}>
      <AssignmentRow a={node.a} nested={depth > 0} go={go} onDone={onDone} onLoadLatest={onLoadLatest} />
      {node.children.length > 0 && (
        <ul className={mergeClasses(s.branch, depth >= 2 && s.branchFlat)} aria-label={t("office.mission.partsOf", { title: node.a.title })}>
          {node.children.map((child) => (
            <AssignmentNode key={child.a.id} node={child} depth={depth + 1} go={go} onDone={onDone} onLoadLatest={onLoadLatest} />
          ))}
        </ul>
      )}
    </li>
  );
}

// The plan: the root assignment and, under each, the parts it gave its team.
function Plan({ assignments, go, onDone, onLoadLatest }: { assignments: AssignmentView[]; go: Go; onDone: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  return (
    <ul className={o.list} aria-label={t("office.mission.assignmentsAria")}>
      {treeOf(assignments).map((node) => (
        <AssignmentNode key={node.a.id} node={node} depth={0} go={go} onDone={onDone} onLoadLatest={onLoadLatest} />
      ))}
    </ul>
  );
}

// ---- who acts now, the questions, what was shared ---------------------------------------------------------------

// Who holds the mission's next move now, and why: the employees acting, the leads reviewing or asked a question, and the
// person, for what is theirs.
function ResponsibleNowCard({ m, go }: { m: MissionDetail; go: Go }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  return (
    <section className={o.card} aria-label={t("office.mission.responsibleNow")}>
      <Text weight="semibold" size={400}>
        {t("office.mission.responsibleNow")}
      </Text>
      {m.responsibleNow.length === 0 ? (
        <Text className={o.muted}>{t("office.mission.nobodyNow")}</Text>
      ) : (
        <ul className={o.list} aria-label={t("office.mission.responsibleNowAria")}>
          {m.responsibleNow.map((r, i) => (
            <li key={`${r.assignmentId}:${i}`} className={o.item}>
              <Text size={300} className={o.wrap}>
                {r.employeeId !== null ? (
                  <Link as="button" inline onClick={() => go("employee", r.employeeId)}>
                    {r.name}
                  </Link>
                ) : (
                  <Text weight="semibold">{r.name}</Text>
                )}{" "}
                {r.what}
              </Text>
              <Text size={200} className={mergeClasses(o.muted, s.plain)}>
                {t("office.mission.why", { why: r.why })}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// One question: who asked whom, how it stands, the answer and who gave it, and every hop it took (to whom, why, when). A
// question asked of the person is answered here, against the version of the asker read.
function Question({ c, asker, onDone, onLoadLatest }: { c: ClarificationView; asker: AssignmentView | null; onDone: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const act = useAction();
  const [answer, setAnswer] = useState("");
  const to = c.addressee === "owner" ? t("office.mission.toYou") : (c.addresseeName ?? t("office.mission.toItsLead"));
  const answerable = c.state === "open" && c.addressee === "owner" && asker !== null && asker.actions.includes("answer");
  const send = async () => {
    if (asker === null) return;
    if (await act.run(() => office.command(asker.id, asker.version, "answer", { answer: answer.trim() }))) onDone();
  };
  return (
    <li className={o.item} aria-label={t("office.mission.questionAria", { name: c.askerName })}>
      <div className={o.between}>
        <Text weight="semibold" size={300} className={o.wrap}>
          {t("office.mission.questionHead", { asker: c.askerName, to })}
        </Text>
        <Badge appearance="tint" color={c.state === "open" ? "warning" : c.state === "answered" ? "success" : "subtle"} style={{ borderRadius: "9999px", flexShrink: 0 }}>
          {t(QUESTION_STATE_KEYS[c.state])}
        </Badge>
      </div>
      <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
        {t("office.mission.askedAt", { at: when(c.askedAt) })}
        {c.kind !== "information" ? ` · ${t(QUESTION_KIND_KEYS[c.kind])}` : ""}
      </Text>
      <Text className={s.plain}>{c.question}</Text>
      {c.answer !== null && (
        <div className={o.inset}>
          <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
            {t("office.mission.answeredBy", { by: c.answeredBy ?? "—", at: when(c.answeredAt) })}
          </Text>
          <Text size={200} className={s.plain}>
            {c.answer}
          </Text>
        </div>
      )}
      {c.route.length > 0 && (
        <ol className={s.route} aria-label={t("office.mission.routeAria")}>
          {c.route.map((hop, i) => (
            <li key={`${i}:${hop.at}`}>
              <Text size={200} className={s.plain}>
                {t("office.mission.routeHop", { to: hop.addressee === "owner" ? t("office.mission.routeToYou") : (hop.addresseeName ?? t("office.mission.toItsLead")), why: hop.why, at: when(hop.at) })}
              </Text>
            </li>
          ))}
        </ol>
      )}
      {answerable && (
        <form
          className={o.form}
          aria-label={t("office.mission.answerQuestionAria", { name: c.askerName })}
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <Field label={t("office.mission.yourAnswer")} required>
            <Textarea value={answer} resize="vertical" onChange={(_, d) => setAnswer(d.value)} />
          </Field>
          <div>
            <Button type="submit" appearance="primary" disabled={act.busy || answer.trim() === ""}>
              {t("office.mission.sendAnswer")}
            </Button>
          </div>
        </form>
      )}
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
    </li>
  );
}

function Questions({ m, onDone, onLoadLatest }: { m: MissionDetail; onDone: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  return (
    <section className={o.card} aria-label={t("office.mission.questions")}>
      <Text weight="semibold" size={400}>
        {t("office.mission.questions")}
      </Text>
      <ul className={o.list} aria-label={t("office.mission.questionsAria")}>
        {m.clarifications.map((c) => (
          <Question key={c.id} c={c} asker={m.assignments.find((a) => a.id === c.askerAssignmentId) ?? null} onDone={onDone} onLoadLatest={onLoadLatest} />
        ))}
      </ul>
    </section>
  );
}

// One thing a lead shared with a part of its team: what (a source revision, or a part's hand-in -- its summary or in
// full), with whom, and whether it still holds. Taking it back asks first; every attempt that holds it is stopped.
function Share({ sh, leadName, onDone }: { sh: DataShareView; leadName: string; onDone: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const act = useAction();
  const restore = useRestoreFocusTarget();
  const [confirming, setConfirming] = useState(false);
  const revoked = sh.revokedAt !== null;
  const unit = sh.fromUnit ?? t("office.mission.unknownUnit");
  const what = sh.kind === "source" ? t("office.mission.shareSource", { revision: short(sh.sourceRevisionId) }) : t(sh.mode === "full" ? "office.mission.shareHandoffFull" : "office.mission.shareHandoffSummary", { unit });
  const revoke = async () => {
    const ok = await act.run(() => office.revokeShare(sh.id));
    setConfirming(false);
    if (ok) onDone();
  };
  return (
    <li className={o.item} aria-label={t("office.mission.shareItemAria", { recipient: sh.recipientName, unit: sh.recipientUnit })}>
      <div className={o.between}>
        <Text size={200} weight="semibold" className={o.wrap}>
          {t("office.mission.shareLine", { lead: leadName, recipient: sh.recipientName, unit: sh.recipientUnit })}
        </Text>
        <Badge appearance="tint" color={revoked ? "subtle" : "success"} style={{ borderRadius: "9999px", flexShrink: 0 }}>
          {revoked ? t("office.mission.shareRevoked") : t("office.mission.shareHolds")}
        </Badge>
      </div>
      <Text size={200} className={o.wrap}>
        {what}
      </Text>
      <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
        {t("office.mission.sharedAt", { at: when(sh.sharedAt) })}
        {revoked ? t("office.mission.revokedMeta", { at: when(sh.revokedAt), by: sh.revokedBy ?? "—" }) : ""}
      </Text>
      {!revoked && (
        <div>
          <Button className={o.touch} size="small" disabled={act.busy} onClick={() => setConfirming(true)} {...restore}>
            {t("office.mission.revokeShare")}
          </Button>
        </div>
      )}
      <ProblemBar problem={act.problem} />
      {confirming && (
        <Dialog open onOpenChange={(_, d) => !d.open && setConfirming(false)}>
          <DialogSurface className="orbit-touch">
            <DialogBody>
              <DialogTitle>{t("office.mission.revokeTitle")}</DialogTitle>
              <DialogContent className={o.form}>
                <Text className={o.wrap}>{t("office.mission.revokeMeans", { recipient: sh.recipientName, unit: sh.recipientUnit })}</Text>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setConfirming(false)}>{t("office.assign.cancel")}</Button>
                <Button appearance="primary" disabled={act.busy} onClick={() => void revoke()}>
                  {t("office.mission.revokeConfirm")}
                </Button>
              </DialogActions>
            </DialogBody>
          </DialogSurface>
        </Dialog>
      )}
    </li>
  );
}

function Shares({ m, onDone }: { m: MissionDetail; onDone: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  return (
    <section className={o.card} aria-label={t("office.mission.shares")}>
      <Text weight="semibold" size={400}>
        {t("office.mission.shares")}
      </Text>
      <Text size={200} className={o.muted}>
        {t("office.mission.sharesSub")}
      </Text>
      <ul className={o.list} aria-label={t("office.mission.sharesAria")}>
        {m.dataShares.map((sh) => (
          <Share key={sh.id} sh={sh} leadName={m.assignments.find((a) => a.id === sh.leadAssignmentId)?.employeeName ?? sh.sharedBy} onDone={onDone} />
        ))}
      </ul>
    </section>
  );
}

// The mission's team room: every change its members' attempts made, in order -- which file, what it became, and whose
// attempt changed it. The room is a workbench shared by the mission's team; what was accepted is in the handoffs.
function TeamRoom({ missionId, go }: { missionId: string; go: Go }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const changes = useOfficeRead<TeamRoomChange[]>(() => office.teamRoom(missionId), [missionId], ["missions"], missionId);
  if (changes.data === null)
    return changes.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{t("office.mission.teamRoomError", { error: changes.error })}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner size="tiny" label={t("office.mission.readingTeamRoom")} />
    );
  if (changes.data.length === 0)
    return (
      <Text className={o.muted}>
        {t("office.mission.teamRoomEmpty")}
      </Text>
    );
  return (
    <ol className={o.list} aria-label={t("office.mission.teamRoomChangesAria")}>
      {changes.data.map((c, i) => (
        <li key={`${i}:${c.path}`} className={o.item}>
          <div className={o.row}>
            <Text weight="semibold" size={200} className={o.mono}>
              {c.path}
            </Text>
            <Text size={200} className={o.muted}>
              {c.sha256 === null ? t("office.mission.removed") : `${bytesText(c.size)} · ${short(c.sha256)}`}
            </Text>
          </div>
          <Text size={200} className={o.muted}>
            {when(c.at)} ·{" "}
            {c.employeeId !== null && c.employeeName !== null ? (
              <Link as="button" onClick={() => go("employee", c.employeeId)}>
                {c.employeeName}
              </Link>
            ) : (
              t("office.mission.attemptNoLongerOnRecord")
            )}
          </Text>
        </li>
      ))}
    </ol>
  );
}

function Delivery({ d, onDone }: { d: DeliveryView; onDone: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const act = useAction();
  const [outcome, setOutcome] = useState<"delivered" | "resend">("delivered");
  const [reason, setReason] = useState("");
  return (
    <li className={o.item}>
      <div className={o.row}>
        <Text weight="semibold" size={200}>
          {d.recipient.address}
        </Text>
        <Badge appearance="tint" color={d.state === "SENT" ? "success" : d.state === "FAILED" || d.state === "NEEDS_RECONCILIATION" ? "danger" : "informative"}>
          {DELIVERY_STATE_TEXT[d.state]}
        </Badge>
        <Text size={200} className={o.muted}>
          {t("office.mission.attemptsCount", { count: d.attempts, receipt: d.receipt ? t("office.mission.receiptSuffix", { receipt: d.receipt }) : "" })}
        </Text>
      </div>
      {d.detail && <Text size={200}>{d.detail}</Text>}
      {d.state === "NEEDS_RECONCILIATION" && (
        <form
          className={o.form}
          aria-label={t("office.mission.settleDeliveryAria", { address: d.recipient.address })}
          onSubmit={(e) => {
            e.preventDefault();
            void act.run(() => office.resolveDelivery(d.id, { outcome, reason: reason.trim() }).catch((err: unknown) => Promise.reject(isNotServed(err) ? new Error(t("office.mission.deliveriesNotServed")) : err))).then((ok) => ok && onDone());
          }}
        >
          <RadioGroup value={outcome} onChange={(_, v) => setOutcome(v.value as "delivered" | "resend")}>
            <Radio value="delivered" label={t("office.mission.deliveryReached")} />
            <Radio value="resend" label={t("office.mission.deliveryResend")} />
          </RadioGroup>
          <Field label={t("office.mission.howYouKnow")} required>
            <Input value={reason} onChange={(_, v) => setReason(v.value)} />
          </Field>
          <div>
            <Button type="submit" disabled={act.busy || reason.trim() === ""}>
              {t("office.mission.recordIt")}
            </Button>
          </div>
          <ProblemBar problem={act.problem} />
        </form>
      )}
    </li>
  );
}

function AcceptDialog({ h, onClose, onConfirm, busy }: { h: HandoffView; onClose: () => void; onConfirm: (note: string) => void; busy: boolean }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className="orbit-touch">
        <DialogBody>
          <DialogTitle>
            {t("office.mission.acceptTitle", { revision: h.revision })}
          </DialogTitle>
          <DialogContent className={o.form}>
            <Text>
              {t("office.mission.acceptConfirmBefore", { revision: h.revision })}
              <span className={o.mono}>{short(h.digest)}</span>
              {t("office.mission.acceptConfirmAfter")}
            </Text>
            {h.missing.length > 0 && (
              <MessageBar intent="warning">
                <MessageBarBody>{t("office.mission.missingRequired", { missing: h.missing.join(", ") })}</MessageBarBody>
              </MessageBar>
            )}
            <Field label={t("office.mission.noteLabel")} hint={t("office.mission.noteHint")}>
              <Input value={note} onChange={(_, d) => setNote(d.value)} />
            </Field>
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t("office.assign.cancel")}</Button>
            <Button appearance="primary" disabled={busy} onClick={() => onConfirm(note.trim())}>
              {t("office.mission.acceptBtn", { revision: h.revision })}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function Handoff({ h, a, onDone, onLoadLatest }: { h: HandoffView; a: AssignmentView | null; onDone: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const act = useAction();
  const restore = useRestoreFocusTarget();
  const [revising, setRevising] = useState(false);
  const [criteria, setCriteria] = useState("");
  const [accepting, setAccepting] = useState(false);
  const reviewable = h.status === "submitted" && a !== null;
  const review = async (command: AssignmentCommand, body: object) => {
    if (a === null) return;
    const ok = await act.run(() => office.command(a.id, a.version, command, { handoffDigest: h.digest, ...body }));
    setAccepting(false);
    if (ok) {
      setRevising(false);
      onDone();
    }
  };
  return (
    <article className={o.card} aria-label={t("office.mission.revisionAria", { revision: h.revision })}>
      <div className={o.between}>
        <div className={o.row}>
          <Text weight="semibold">{t("office.mission.revisionTitle", { revision: h.revision })}</Text>
          <Badge appearance="tint" color={h.status === "accepted" ? "success" : h.status === "submitted" ? "important" : "subtle"}>
            {t(HANDOFF_KEYS[h.status])}
          </Badge>
        </div>
        <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
          {t("office.mission.digestPrefix")}
          <span className={o.mono}>{short(h.digest)}</span>
          {t("office.mission.handedIn", { at: when(h.submittedAt), by: h.submittedBy })}
        </Text>
      </div>
      <Text className={o.wrap}>{h.summary}</Text>
      {h.artifacts.length > 0 && (
        <ul className={o.list} aria-label={t("office.mission.artifactsAria", { revision: h.revision })}>
          {h.artifacts.map((x) => (
            <li key={x.id} className={o.row}>
              <Link className="orbit-target" href={office.artifactHref(x.id)} download={x.name} target="_blank" rel="noopener noreferrer">
                <ArrowDownload16Regular aria-hidden /> {x.name}
              </Link>
              <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
                {x.kind} · {x.mediaType} · {bytesText(x.size)} · sha256 {short(x.sha256)}
              </Text>
            </li>
          ))}
        </ul>
      )}
      {h.claims.length > 0 && (
        <ul className={o.list} aria-label={t("office.mission.claimsAria", { revision: h.revision })}>
          {h.claims.map((c, i) => (
            <li key={`${i}:${c.text}`} className={o.item}>
              <div className={o.row}>
                <Badge appearance="tint" color={c.supported ? "success" : "warning"}>
                  {c.supported ? t("office.mission.supported") : t("office.mission.notSupported")}
                </Badge>
              </div>
              <Text size={200} className={o.wrap}>
                {c.text}
              </Text>
              {c.sources.map((src) => (
                <Text key={`${src.label}:${src.revisionId}`} size={200} className={mergeClasses(o.muted, o.wrap)}>
                  [{src.label}] {src.locator}: “{src.excerpt}”
                </Text>
              ))}
            </li>
          ))}
        </ul>
      )}
      {h.missing.length > 0 && (
        <Text size={200} className={mergeClasses(o.danger, o.wrap)}>
          {t("office.mission.missingDeliverables", { missing: h.missing.join(", ") })}
        </Text>
      )}
      {h.review && (
        <Text size={200} className={mergeClasses(o.muted, s.plain)}>
          {t("office.mission.reviewedBy", { by: h.review.by, at: when(h.review.at) })}
          {h.review.note ? `: ${h.review.note}` : ""}
        </Text>
      )}
      {h.status === "submitted" && a !== null && a.reviewedBy === "lead" && (
        <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
          {a.leadName ? t("office.mission.leadReviewsIt", { name: a.leadName }) : t("office.mission.itsLeadReviewsIt")}
        </Text>
      )}
      {reviewable && (
        <div className={o.row}>
          {a.actions.includes("request_revision") && (
            <Button className={o.touch} disabled={act.busy} onClick={() => setRevising(!revising)}>
              {t("office.mission.requestRevision")}
            </Button>
          )}
          {a.actions.includes("accept") && (
            <Button className={o.touch} appearance="primary" disabled={act.busy} onClick={() => setAccepting(true)} {...restore}>
              {t("office.mission.acceptEllipsis")}
            </Button>
          )}
        </div>
      )}
      {revising && (
        <form
          className={o.form}
          aria-label={t("office.mission.requestRevisionAria", { revision: h.revision })}
          onSubmit={(e) => {
            e.preventDefault();
            void review("request-revision", { criteria: criteria.trim() });
          }}
        >
          <Field label={t("office.mission.whatMustChange")} required hint={t("office.mission.whatMustChangeHint", { revision: h.revision, digest: short(h.digest) })}>
            <Textarea value={criteria} resize="vertical" onChange={(_, d) => setCriteria(d.value)} />
          </Field>
          <div>
            <Button type="submit" appearance="primary" disabled={act.busy || criteria.trim() === ""}>
              {t("office.mission.sendRequest")}
            </Button>
          </div>
        </form>
      )}
      <ProblemBar problem={act.problem} onLoadLatest={onLoadLatest} />
      {accepting && <AcceptDialog h={h} busy={act.busy} onClose={() => setAccepting(false)} onConfirm={(note) => void review("accept", { note })} />}
    </article>
  );
}

// The hand-ins, grouped by the assignment that handed them in (in the order of the tree), newest revision first; a
// part's are its lead's to review, so only the root's offer a review here.
function HandIns({ m, onDone, onLoadLatest }: { m: MissionDetail; onDone: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const newestFirst = (list: HandoffView[]) => [...list].sort((x, y) => y.revision - x.revision);
  const order = flatten(treeOf(m.assignments));
  const groups: { key: string; a: AssignmentView | null; list: HandoffView[] }[] = order.map((a) => ({ key: a.id, a, list: newestFirst(m.handoffs.filter((h) => h.assignmentId === a.id)) }));
  // Hand-ins of an assignment the mission does not list: shown, never hidden (there is nothing to review them against).
  groups.push({ key: "", a: null, list: newestFirst(m.handoffs.filter((h) => !order.some((a) => a.id === h.assignmentId))) });
  const shown = groups.filter((g) => g.list.length > 0);
  if (shown.length === 0) return <Text className={o.muted}>{t("office.mission.handoffsEmpty")}</Text>;
  return (
    <>
      {shown.map((g) => (
        <section key={g.key} className={s.group} aria-label={g.a === null ? t("office.mission.handInsOther") : t("office.mission.handInsOf", { title: g.a.title })}>
          {g.a !== null && (
            <div className={o.row}>
              <Text weight="semibold" size={400} className={o.wrap}>
                {g.a.title}
              </Text>
              <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
                {t("office.mission.handInsBy", { name: g.a.employeeName, review: reviewText(t, g.a) })}
              </Text>
            </div>
          )}
          {g.list.map((h) => (
            <Handoff key={`${h.id}:${h.status}`} h={h} a={g.a} onDone={onDone} onLoadLatest={onLoadLatest} />
          ))}
        </section>
      ))}
    </>
  );
}

export function MissionPage({ id, tab, go }: { id: string; tab: string | null; go: Go }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const mission = useOfficeRead<MissionDetail>(() => office.mission(id), [id], ["missions", "inbox"], id);
  const current: MissionTab = (MISSION_TABS as readonly string[]).includes(tab ?? "") ? (tab as MissionTab) : "overview";
  if (mission.data === null)
    return mission.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{mission.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner label={t("office.mission.reading")} />
    );
  const m = mission.data;
  const root = m.assignments.find((a) => a.id === m.assignment.id) ?? m.assignments.find((a) => a.parentId === null) ?? null;
  const reload = () => void mission.reload();
  // A mission whose work was split into parts has a team room (the tab shows when asked for by its address too).
  const hasTeam = m.assignments.some((a) => a.parentId !== null) || current === "team";
  // The root's question, when the mission lists it, is answered where the questions are.
  const rootAsked = root !== null && m.clarifications.some((c) => c.askerAssignmentId === root.id && c.state === "open" && c.addressee === "owner");
  return (
    <div className={o.page}>
      <section className={o.heroCard} aria-label={m.title}>
        <Text as="h2" weight="semibold" size={600} className={o.wrap}>
          {m.title}
        </Text>
        <div className={o.row}>
          <StateBadge text={ASSIGNMENT_STATE_TEXT[m.assignment.state]} state={m.assignment.state} />
          <EmployeeAvatar name={m.assignment.employeeName} size="sm" />
          <Text size={200} className={o.wrap}>
            {t("office.mission.heldByPrefix")}
            <Link as="button" onClick={() => go("employee", m.assignment.employeeId)}>
              {m.assignment.employeeName}
            </Link>
            {m.deadline ? t("office.work.due", { at: when(m.deadline) }) : ""}
            {m.nextAction ? t("office.work.next", { next: m.nextAction }) : ""}
          </Text>
        </div>
        <AsOf at={mission.loadedAt} />
      </section>
      <div className={`${o.tabStrip} orbit-hscroll`}>
        <TabList selectedValue={current} onTabSelect={(_, d) => go("mission", id, d.value as string)} aria-label={t("office.mission.tabsAria")}>
          {MISSION_TABS.filter((tabKey) => tabKey !== "team" || hasTeam).map((tabKey) => (
            <Tab key={tabKey} value={tabKey}>
              {t(TAB_KEYS[tabKey])}
              {tabKey === "handoffs" && m.handoffs.length > 0 ? ` (${m.handoffs.length})` : ""}
            </Tab>
          ))}
        </TabList>
      </div>

      {current === "overview" && (
        <>
          <ResponsibleNowCard m={m} go={go} />
          <section className={o.card} aria-label={t("office.mission.whatIsWanted")}>
            <Text weight="semibold" size={400}>
              {t("office.mission.whatIsWanted")}
            </Text>
            <Text className={o.wrap} style={{ whiteSpace: "pre-wrap" }}>
              {m.goal}
            </Text>
            <div className={o.divider} />
            <dl className={o.dl}>
              {m.target !== null && (
                <>
                  <dt className={o.dt}>{t("office.mission.givenTo")}</dt>
                  <dd className={o.dd}>{givenToText(t, m.target)}</dd>
                </>
              )}
              <dt className={o.dt}>{t("office.assign.deliverables")}</dt>
              <dd className={o.dd}>{m.deliverables.length === 0 ? t("office.mission.noneNamed") : m.deliverables.map((d) => `${d.name}${d.required ? "" : ` (${t("office.assign.optionalTag")})`}`).join(", ")}</dd>
              <dt className={o.dt}>{t("office.mission.acceptedWhen")}</dt>
              <dd className={o.dd}>{m.acceptanceCriteria.length === 0 ? t("office.mission.noCriteriaNamed") : m.acceptanceCriteria.join("; ")}</dd>
              <dt className={o.dt}>{t("office.mission.acceptedBy")}</dt>
              <dd className={o.dd}>{m.acceptanceMode === "owner_review" ? t("office.mission.ownerYou") : t("office.mission.itsManager")}</dd>
              <dt className={o.dt}>{t("office.sources.title")}</dt>
              <dd className={o.dd}>{m.sourceRevisionIds.length === 0 ? t("office.mission.nonePinned") : t("office.mission.sourcesPinned", { count: m.sourceRevisionIds.length })}</dd>
              <dt className={o.dt}>{t("office.repos.title")}</dt>
              <dd className={o.dd}>{(m.repositories ?? []).length === 0 ? t("office.mission.none") : (m.repositories ?? []).map((r) => `${r.fullName}${r.branch === null ? "" : ` (${r.branch})`}`).join(", ")}</dd>
              <dt className={o.dt}>{t("office.mission.created")}</dt>
              <dd className={o.dd}>
                {t("office.mission.createdBy", { at: when(m.createdAt), by: m.createdBy })}
              </dd>
            </dl>
          </section>
          <section className={o.card} aria-label={t("office.mission.plan")}>
            <Text weight="semibold">{t("office.mission.plan")}</Text>
            <Plan assignments={m.assignments} go={go} onDone={reload} onLoadLatest={reload} />
            {root && <AssignmentActions a={root} answerHere={!rootAsked} onDone={reload} onLoadLatest={reload} />}
          </section>
          {m.clarifications.length > 0 && <Questions m={m} onDone={reload} onLoadLatest={reload} />}
          {m.dataShares.length > 0 && <Shares m={m} onDone={reload} />}
          {m.deliveries.length > 0 && (
            <section className={o.card} aria-label={t("office.mission.deliveries")}>
              <Text weight="semibold">{t("office.mission.deliveries")}</Text>
              <ul className={o.list}>
                {m.deliveries.map((d) => (
                  <Delivery key={d.id} d={d} onDone={reload} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {current === "timeline" && (
        <section className={o.card} aria-label={t("office.mission.tab.timeline")}>
          {m.timeline.length === 0 ? (
            <Text className={o.muted}>{t("office.mission.timelineEmpty")}</Text>
          ) : (
            <ol className={s.timelineList}>
              {m.timeline.map((item) => (
                <li key={item.seq} className={mergeClasses(o.item, s.timelineItem)}>
                  <span className={s.timelineDot} aria-hidden />
                  <Text size={200} className={o.muted}>
                    {when(item.at)} · {item.actor}
                  </Text>
                  <Text size={200} className={o.wrap}>
                    {item.summary}
                  </Text>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {current === "handoffs" && <HandIns m={m} onDone={reload} onLoadLatest={reload} />}

      {current === "team" && (
        <section className={o.card} aria-label={t("office.mission.tab.team")}>
          <TeamRoom missionId={m.id} go={go} />
        </section>
      )}

      {current === "run" && (
        <section className={o.card} aria-label={t("office.mission.tab.run")}>
          {root?.lastRun ? <RunDetails run={root.lastRun} /> : <Text className={o.muted}>{t("office.mission.runEmpty")}</Text>}
        </section>
      )}
    </div>
  );
}
