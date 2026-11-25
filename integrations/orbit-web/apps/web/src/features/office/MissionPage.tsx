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
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
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
import {
  ArrowDownload16Regular,
  ChevronDown16Regular,
  ChevronRight16Regular,
  ChevronUp16Regular,
  Info16Regular,
  MoreHorizontal16Regular,
  Settings16Regular,
  Warning16Regular,
} from "@fluentui/react-icons";
import { Markdown } from "../../components/Markdown";
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
  type TimelineEntry,
} from "@orbit-web/contracts";
import { useState } from "react";
import type { OfficePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useI18n, type I18nContextValue, type MessageKey } from "../../i18n";
import { bytesText } from "../resources/format";
import { isNotServed, office, useOfficeRead, wholeRoster, type AssignmentCommand } from "./api";
import { AsOf, Callout, EmployeeAvatar, ProblemBar, RUN_STATE_KEYS, StateBadge, humanizeActor, humanizeWaitingOn, short, useAction, useOfficeStyles, when, whenSeconds } from "./parts";
import { MissionCommunication } from "./MissionThread";
import { RunDetails } from "./RunDetails";

const useStyles = makeStyles({
  overviewGrid: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)",
    gap: "16px",
    alignItems: "start",
    "@media (max-width: 960px)": { gridTemplateColumns: "1fr" },
  },
  colStack: { display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 },
  progressTrack: {
    width: "100%",
    height: "6px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralBackground3,
    overflow: "hidden",
    display: "flex",
    gap: "2px",
  },
  criteriaList: { marginTop: 0, marginBottom: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px" },
  fileRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    paddingTop: "8px",
    paddingRight: "10px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    borderRadius: "10px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
  },
  digestPill: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: tokens.fontSizeBase100,
    paddingTop: "1px",
    paddingRight: "6px",
    paddingBottom: "1px",
    paddingLeft: "6px",
    borderRadius: "6px",
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
  },
  tabBarRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    flexWrap: "nowrap",
    minWidth: 0,
  },
  tabBarMain: { display: "flex", alignItems: "center", gap: "4px", minWidth: 0 },
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
  planTree: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    listStyleType: "none",
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    paddingLeft: 0,
    minWidth: 0,
  },
  // Nested children branch with vertical guide rail + subtle elbow connectors for clear hierarchy.
  treeBranch: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    listStyleType: "none",
    marginTop: "8px",
    marginRight: 0,
    marginBottom: 0,
    marginLeft: "17px",
    paddingLeft: "18px",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: tokens.colorNeutralStroke2,
    minWidth: 0,
  },
  treeBranchFlat: { marginLeft: "6px", paddingLeft: "10px" },
  treeNode: { position: "relative", minWidth: 0 },
  treeNodeChild: {
    "::before": {
      content: '""',
      position: "absolute",
      left: "-18px",
      top: "23px",
      width: "16px",
      height: "2px",
      backgroundColor: tokens.colorNeutralStroke2,
    },
  },
  treeCard: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "10px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    transitionProperty: "border-color, background-color, box-shadow",
    transitionDuration: "140ms",
    ":hover": {
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
      backgroundColor: tokens.colorNeutralBackground1,
    },
    minWidth: 0,
  },
  treeCardRoot: {
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke1),
  },
  treeCardAttention: {
    borderLeftWidth: "3px",
    borderLeftColor: tokens.colorPaletteRedBorder2,
  },
  treeCardActive: {
    borderLeftWidth: "3px",
    borderLeftColor: tokens.colorBrandStroke1,
  },
  treeCardDone: {
    borderLeftWidth: "3px",
    borderLeftColor: tokens.colorPaletteGreenBorder2,
  },
  treeRowLayout: {
    display: "flex",
    alignItems: "flex-start",
    gap: "6px",
    minWidth: 0,
  },
  treeToggleSlot: {
    width: "24px",
    height: "24px",
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginTop: "1px",
  },
  treeToggleBtn: {
    minWidth: "24px",
    width: "24px",
    height: "24px",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
  },
  treeLeafDot: {
    width: "7px",
    height: "7px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralStroke1,
  },
  treeLeafDotDone: { backgroundColor: tokens.colorPaletteGreenBackground3 },
  treeLeafDotActive: { backgroundColor: tokens.colorBrandBackground },
  treeLeafDotDanger: { backgroundColor: tokens.colorPaletteRedBackground3 },
  treeContent: {
    display: "flex",
    flexDirection: "column",
    gap: "5px",
    flexGrow: 1,
    minWidth: 0,
  },
  rowHead: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px", minWidth: 0 },
  rowMain: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", flexGrow: 1, minWidth: 0 },
  rowControls: { display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 },
  metaLine: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap", minWidth: 0 },
  deptChip: {
    display: "inline-flex",
    alignItems: "center",
    paddingTop: "1px",
    paddingRight: "7px",
    paddingBottom: "1px",
    paddingLeft: "7px",
    borderRadius: "9999px",
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
  detailsDrawer: {
    marginTop: "4px",
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    borderRadius: "10px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground1,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    minWidth: 0,
  },
  disclosureToggle: {
    alignSelf: "flex-start",
    paddingLeft: "4px",
    paddingRight: "8px",
    color: tokens.colorNeutralForeground2,
    fontWeight: tokens.fontWeightMedium,
  },
  menuItemBody: { display: "flex", flexDirection: "column", gap: "1px" },
  menuItemSub: { fontSize: tokens.fontSizeBase100, color: tokens.colorNeutralForeground3 },
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

export const MISSION_TABS = ["overview", "communication", "timeline", "handoffs", "team", "run"] as const;
type MissionTab = (typeof MISSION_TABS)[number];
const PRIMARY_MISSION_TABS: readonly MissionTab[] = ["overview", "handoffs", "communication"];
const ADVANCED_MISSION_TABS: readonly MissionTab[] = ["timeline", "team", "run"];
const TAB_KEYS: Record<MissionTab, MessageKey> = {
  overview: "office.mission.tab.overview",
  communication: "office.mission.tab.communication",
  timeline: "office.mission.tab.timeline",
  handoffs: "office.mission.tab.handoffs",
  team: "office.mission.tab.team",
  run: "office.mission.tab.run",
};
const ADVANCED_TAB_DESC: Record<"timeline" | "team" | "run", MessageKey> = {
  timeline: "office.mission.tab.timelineDesc",
  team: "office.mission.tab.teamDesc",
  run: "office.mission.tab.runDesc",
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
// How many levels the tree is indented; deeper parts line up under the last indented one.
const INDENTED = 3;

interface TreeNode {
  a: AssignmentView;
  children: TreeNode[];
}

// Order sibling parts so prerequisites come before dependents, and active/handed-in work comes before queued work.
function sortSiblings(siblings: AssignmentView[]): AssignmentView[] {
  const byKey = new Map<string, AssignmentView>();
  for (const s of siblings) if (s.unitKey) byKey.set(s.unitKey, s);
  const depthMemo = new Map<string, number>();
  const depDepth = (a: AssignmentView, seen = new Set<string>()): number => {
    if (depthMemo.has(a.id)) return depthMemo.get(a.id)!;
    if (seen.has(a.id)) return 0;
    const nextSeen = new Set(seen);
    nextSeen.add(a.id);
    let maxParent = 0;
    for (const key of a.brief.dependsOn) {
      const target = byKey.get(key);
      if (target) maxParent = Math.max(maxParent, 1 + depDepth(target, nextSeen));
    }
    depthMemo.set(a.id, maxParent);
    return maxParent;
  };
  const stateOrder: Partial<Record<AssignmentView["state"], number>> = {
    COMPLETED: 0,
    AWAITING_ACCEPTANCE: 1,
    REVIEWING: 2,
    RUNNING: 3,
    RECOVERING: 3,
    ASSIGNED: 4,
    BLOCKED: 5,
    PAUSED: 6,
    QUEUED: 7,
  };
  return [...siblings].sort((a, b) => {
    const dd = depDepth(a) - depDepth(b);
    if (dd !== 0) return dd;
    return (stateOrder[a.state] ?? 8) - (stateOrder[b.state] ?? 8);
  });
}

// The assignments as the tree their parents make: the root and, under each, the parts it gave its team. Anything whose
// parent is not in the list (or that lies deeper than MAX_DEPTH) is shown at the top, never hidden.
function treeOf(assignments: readonly AssignmentView[]): TreeNode[] {
  const ids = new Set(assignments.map((a) => a.id));
  const placed = new Set<string>();
  const build = (a: AssignmentView, depth: number): TreeNode => {
    placed.add(a.id);
    const children = depth < MAX_DEPTH ? sortSiblings(assignments.filter((x) => x.parentId === a.id && !placed.has(x.id))) : [];
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

// Who a mission was given to, in plain non-technical words (appointment revision stays in Advanced details).
function givenToPlainText(t: I18nContextValue["t"], target: AssignmentTarget): string {
  if (target.kind === "department") return t("office.mission.givenToDepartmentPlain", { department: target.departmentName ?? t("office.mission.aDepartment") });
  if (target.kind === "ceo") return t("office.mission.givenToCeoPlain");
  return t("office.mission.givenToEmployee");
}

function givenToText(t: I18nContextValue["t"], target: AssignmentTarget): string {
  const revision = target.appointmentRevision === null ? "" : t("office.mission.appointmentRevision", { revision: target.appointmentRevision });
  if (target.kind === "department") return t("office.mission.givenToDepartment", { department: target.departmentName ?? t("office.mission.aDepartment"), revision });
  if (target.kind === "ceo") return t("office.mission.givenToCeo", { revision });
  return t("office.mission.givenToEmployee");
}

// Count leaf & nested descendants completed under a branch node so collapsed subtrees still show live progress.
function branchProgress(node: TreeNode): { done: number; total: number } {
  let done = 0;
  let total = 0;
  const walk = (children: readonly TreeNode[]) => {
    for (const child of children) {
      total += 1;
      if (child.a.state === "COMPLETED") done += 1;
      walk(child.children);
    }
  };
  walk(node.children);
  return { done, total };
}

function collectBranchIds(nodes: readonly TreeNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: readonly TreeNode[]) => {
    for (const n of list) {
      if (n.children.length > 0) {
        ids.push(n.a.id);
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return ids;
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
function CancelConfirmDialog({
  open,
  title,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && !busy && onCancel()}>
      <DialogSurface className="orbit-touch">
        <DialogBody>
          <DialogTitle>{t("office.mission.confirmCancelTitle", { title })}</DialogTitle>
          <DialogContent>
            <Text>{t("office.mission.confirmCancelBody")}</Text>
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={onCancel}>
              {t("office.mission.confirmCancelKeep")}
            </Button>
            <Button
              appearance="primary"
              disabled={busy}
              style={{ backgroundColor: tokens.colorPaletteRedBackground3, color: tokens.colorNeutralForegroundOnBrand }}
              onClick={onConfirm}
            >
              {t("office.mission.action.cancel")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function AssignmentActions({ a, answerHere, onDone, onLoadLatest }: { a: AssignmentView; answerHere: boolean; onDone: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const restore = useRestoreFocusTarget();
  const c = useCommands(a, onDone);
  const [answer, setAnswer] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const directCommands = c.commands.filter((cmd) => cmd !== "cancel");
  const canCancel = c.commands.includes("cancel");
  const hasMore = canCancel || c.handOver || c.repin;
  return (
    <div className={o.stack}>
      {(directCommands.length > 0 || hasMore) && (
        <div className={o.row} style={{ gap: "6px" }}>
          {directCommands.map((command) => (
            <Button
              key={command}
              className={o.touch}
              size="small"
              appearance={command === "retry" || command === "resume" ? "primary" : "secondary"}
              disabled={c.act.busy}
              onClick={() => void c.run(command)}
            >
              {ACTION_KEYS[command] ? t(ACTION_KEYS[command]!) : command}
            </Button>
          ))}
          {hasMore && (
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Button
                  className={o.touch}
                  size="small"
                  appearance="subtle"
                  icon={<ChevronDown16Regular />}
                  iconPosition="after"
                  disabled={c.act.busy}
                  aria-label={t("office.mission.moreActionsAria")}
                  {...restore}
                >
                  {t("office.mission.moreActions")}
                </Button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  {(c.handOver || c.repin) && (
                    <MenuGroup>
                      <MenuGroupHeader>{t("office.mission.advancedMenuHeader")}</MenuGroupHeader>
                      {c.handOver && <MenuItem onClick={() => c.setDialog("hand_over")}>{t("office.mission.action.handOver")}</MenuItem>}
                      {c.repin && <MenuItem onClick={() => c.setDialog("repin")}>{t("office.mission.action.repin")}</MenuItem>}
                    </MenuGroup>
                  )}
                  {(c.handOver || c.repin) && canCancel && <MenuDivider />}
                  {canCancel && (
                    <MenuItem className={o.dangerMenuItem} onClick={() => setConfirmCancel(true)}>
                      {t("office.mission.action.cancel")}
                    </MenuItem>
                  )}
                </MenuList>
              </MenuPopover>
            </Menu>
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
      <CancelConfirmDialog
        open={confirmCancel}
        title={a.title}
        busy={c.act.busy}
        onConfirm={() => {
          setConfirmCancel(false);
          void c.run("cancel");
        }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}

// The commands of a part, in a menu on its tree row.
function PartActions({ a, c, go, onInspectRun }: { a: AssignmentView; c: ReturnType<typeof useCommands>; go: Go; onInspectRun: (assignmentId: string) => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const directCommands = c.commands.filter((cmd) => cmd !== "cancel");
  const canCancel = c.commands.includes("cancel");
  const hasAdvanced = c.handOver || c.repin || canCancel || a.lastRun !== null;
  if (directCommands.length === 0 && !hasAdvanced) return null;
  return (
    <>
      <Menu>
        <MenuTrigger disableButtonEnhancement>
          <Button className={o.touch} appearance="subtle" size="small" icon={<MoreHorizontal16Regular />} disabled={c.act.busy} aria-label={t("office.mission.partActions", { title: a.title })} />
        </MenuTrigger>
        <MenuPopover>
          <MenuList>
            {directCommands.map((command) => (
              <MenuItem key={command} onClick={() => void c.run(command)}>
                {ACTION_KEYS[command] ? t(ACTION_KEYS[command]!) : command}
              </MenuItem>
            ))}
            {directCommands.length > 0 && <MenuDivider />}
            <MenuItem onClick={() => go("employee", a.employeeId)}>{t("office.mission.openEmployeeProfile", { name: a.employeeName })}</MenuItem>
            {hasAdvanced && (
              <>
                <MenuDivider />
                <MenuGroup>
                  <MenuGroupHeader>{t("office.mission.advancedMenuHeader")}</MenuGroupHeader>
                  {a.lastRun !== null && <MenuItem onClick={() => onInspectRun(a.id)}>{t("office.mission.inspectRunAction")}</MenuItem>}
                  {c.handOver && <MenuItem onClick={() => c.setDialog("hand_over")}>{t("office.mission.action.handOver")}</MenuItem>}
                  {c.repin && <MenuItem onClick={() => c.setDialog("repin")}>{t("office.mission.action.repin")}</MenuItem>}
                  {canCancel && (
                    <MenuItem className={o.dangerMenuItem} onClick={() => setConfirmCancel(true)}>
                      {t("office.mission.action.cancel")}
                    </MenuItem>
                  )}
                </MenuGroup>
              </>
            )}
          </MenuList>
        </MenuPopover>
      </Menu>
      <CancelConfirmDialog
        open={confirmCancel}
        title={a.title}
        busy={c.act.busy}
        onConfirm={() => {
          setConfirmCancel(false);
          void c.run("cancel");
        }}
        onCancel={() => setConfirmCancel(false)}
      />
    </>
  );
}

// ---- the plan: hierarchical interactive TreeView -----------------------------------------------------------------

function AssignmentTreeItem({
  node,
  depth,
  collapsedIds,
  onToggleCollapse,
  titleByUnitKey,
  go,
  onInspectRun,
  onDone,
  onLoadLatest,
}: {
  node: TreeNode;
  depth: number;
  collapsedIds: ReadonlySet<string>;
  onToggleCollapse: (id: string) => void;
  titleByUnitKey: ReadonlyMap<string, string>;
  go: Go;
  onInspectRun: (assignmentId: string) => void;
  onDone: () => void;
  onLoadLatest: () => void;
}) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const a = node.a;
  const c = useCommands(a, onDone);
  const [showDetails, setShowDetails] = useState(false);
  const part = a.parentId !== null;
  const hasChildren = node.children.length > 0;
  const expanded = !collapsedIds.has(a.id);
  const progress = hasChildren ? branchProgress(node) : null;
  const isAttention = a.state === "BLOCKED" || a.state === "FAILED_FINAL";
  const isActive = a.state === "RUNNING" || a.state === "RECOVERING" || a.state === "AWAITING_ACCEPTANCE" || a.state === "REVIEWING";
  const isDone = a.state === "COMPLETED";
  const runAlert = a.lastRun !== null && (a.state === "BLOCKED" || a.lastRun.state === "failed" || a.lastRun.state === "interrupted");
  const extraRunDetail = runAlert && a.lastRun?.detail && !(a.reason ?? "").includes(a.lastRun.detail) ? a.lastRun.detail : null;
  const facts = [
    reviewText(t, a),
    a.planCount > 0 ? t("office.mission.plansGiven", { count: a.planCount }) : null,
    a.questionCount > 0 ? t("office.mission.questionsAskedCount", { count: a.questionCount }) : null,
  ].filter((f): f is string => f !== null);
  const friendlyDeps = a.brief.dependsOn.map((k) => titleByUnitKey.get(k) ?? k);
  const needsOwnerCallout = a.waitingOn !== null && a.waitingOn !== "team" && a.state !== "WAITING_FOR_SUBORDINATES";
  const showReasonLine = isAttention || (a.reason !== null && a.state !== "WAITING_FOR_SUBORDINATES" && a.state !== "COMPLETED");
  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? expanded : undefined}
      aria-level={depth + 1}
      aria-label={a.title}
      className={mergeClasses(s.treeNode, depth > 0 && depth <= INDENTED && s.treeNodeChild)}
    >
      <div
        className={mergeClasses(
          s.treeCard,
          depth === 0 && s.treeCardRoot,
          isAttention ? s.treeCardAttention : isDone ? s.treeCardDone : isActive ? s.treeCardActive : undefined,
        )}
      >
        <div className={s.treeRowLayout}>
          <div className={s.treeToggleSlot}>
            {hasChildren ? (
              <Button
                type="button"
                size="small"
                appearance="subtle"
                className={s.treeToggleBtn}
                icon={expanded ? <ChevronDown16Regular /> : <ChevronRight16Regular />}
                aria-label={expanded ? t("office.mission.collapseBranch", { title: a.title }) : t("office.mission.expandBranch", { title: a.title })}
                onClick={() => onToggleCollapse(a.id)}
              />
            ) : (
              <span
                className={mergeClasses(s.treeLeafDot, isDone && s.treeLeafDotDone, isActive && s.treeLeafDotActive, isAttention && s.treeLeafDotDanger)}
                aria-hidden
              />
            )}
          </div>
          <div className={s.treeContent}>
            <div className={s.rowHead}>
              <div className={s.rowMain}>
                <Text weight="semibold" size={300} className={o.wrap}>
                  {a.title}
                </Text>
                {progress !== null && (
                  <Badge
                    appearance="tint"
                    color={progress.done === progress.total ? "success" : "subtle"}
                    size="small"
                    style={{ borderRadius: "9999px", flexShrink: 0 }}
                  >
                    {t("office.mission.branchProgress", { done: progress.done, total: progress.total })}
                  </Badge>
                )}
              </div>
              <div className={s.rowControls}>
                <StateBadge text={ASSIGNMENT_STATE_TEXT[a.state]} state={a.state} />
                <Button
                  type="button"
                  size="small"
                  appearance="subtle"
                  icon={<Info16Regular />}
                  aria-expanded={showDetails}
                  aria-label={t("office.mission.nodeDetailsAria", { title: a.title })}
                  title={showDetails ? t("office.mission.nodeHideDetails") : t("office.mission.nodeDetails")}
                  onClick={() => setShowDetails((prev) => !prev)}
                />
                {part && <PartActions a={a} c={c} go={go} onInspectRun={onInspectRun} />}
              </div>
            </div>
            <div className={s.metaLine}>
              <EmployeeAvatar name={a.employeeName} employeeId={a.employeeId} size="sm" />
              <Link as="button" onClick={() => go("employee", a.employeeId)} style={{ fontSize: tokens.fontSizeBase200, fontWeight: 600 }}>
                {a.employeeName}
              </Link>
              {a.pinned.departmentName && <span className={s.deptChip}>{a.pinned.departmentName}</span>}
              {friendlyDeps.length > 0 && a.state !== "COMPLETED" && (
                <Text size={200} className={o.muted}>
                  · {t("office.mission.waitsForFriendly", { deps: friendlyDeps.join(", ") })}
                </Text>
              )}
            </div>
            {(showReasonLine || needsOwnerCallout) && (
              <Text size={200} className={mergeClasses(isAttention ? o.danger : o.warn, o.wrap)}>
                {showReasonLine ? (a.reason ?? "") : ""}
                {showReasonLine && a.reason && needsOwnerCallout ? " · " : ""}
                {needsOwnerCallout && a.waitingOn ? t("office.mission.waitingOnFriendly", { what: humanizeWaitingOn(a.waitingOn, t) }) : ""}
              </Text>
            )}
            {a.lastRun && (a.lastRun.state === "waiting_for_resources" || a.lastRun.state === "unschedulable") && (
              <Text size={200} className={mergeClasses(a.lastRun.state === "unschedulable" ? o.danger : o.warn, o.wrap)}>
                {t(RUN_STATE_KEYS[a.lastRun.state])}: {a.lastRun.waitingReason ?? t("office.run.noReasonGiven")}
              </Text>
            )}
            {extraRunDetail && (
              <Text size={200} className={mergeClasses(o.danger, o.wrap)}>
                {t("office.mission.runDetailLabel", { detail: extraRunDetail })}
              </Text>
            )}
            {runAlert && (
              <div>
                <Link as="button" onClick={() => onInspectRun(a.id)} style={{ fontSize: tokens.fontSizeBase200 }}>
                  {t("office.mission.inspectRunAction")}
                </Link>
              </div>
            )}
            {showDetails && (
              <div className={s.detailsDrawer} aria-label={t("office.mission.nodeDetailsAria", { title: a.title })}>
                <dl className={o.dl}>
                  <dt className={o.dt}>{t("office.mission.detailReviewer")}</dt>
                  <dd className={o.dd}>{facts.join(" · ")}</dd>
                  <dt className={o.dt}>{t("office.mission.detailAttempts")}</dt>
                  <dd className={o.dd}>
                    {a.employeeName}
                    {a.pinned.departmentName ? t("office.mission.deptWhenClaimed", { dept: a.pinned.departmentName }) : ""}
                    {t("office.mission.attemptsAndRevision", { attempts: a.attempts, revision: a.handoffRevision })}
                  </dd>
                  {a.target?.kind === "department" && (
                    <>
                      <dt className={o.dt}>{t("office.mission.detailRouting")}</dt>
                      <dd className={o.dd}>
                        {t("office.mission.givenThroughDepartment", {
                          department: a.target.departmentName ?? t("office.mission.aDepartment"),
                          revision: a.target.appointmentRevision === null ? "" : t("office.mission.appointmentRevision", { revision: a.target.appointmentRevision }),
                        })}
                      </dd>
                    </>
                  )}
                  {a.unitKey !== null && a.parentId !== null && (
                    <>
                      <dt className={o.dt}>{t("office.mission.detailPlanKey")}</dt>
                      <dd className={o.dd}>
                        {t("office.mission.partOfPlan", { key: a.unitKey })}
                        {a.brief.dependsOn.length > 0 ? t("office.mission.waitsForDeps", { deps: a.brief.dependsOn.map((k) => `“${k}”`).join(", ") }) : ""}
                      </dd>
                    </>
                  )}
                  {a.lastRun?.wakeReason && (
                    <>
                      <dt className={o.dt}>{t("office.mission.detailLastStart")}</dt>
                      <dd className={o.dd}>{t("office.mission.lastWake", { no: a.lastRun.attemptNo, why: a.lastRun.wakeReason })}</dd>
                    </>
                  )}
                </dl>
                {a.lastRun !== null && (
                  <div>
                    <Link as="button" onClick={() => onInspectRun(a.id)} style={{ fontSize: tokens.fontSizeBase200 }}>
                      {t("office.mission.inspectRunAction")}
                    </Link>
                  </div>
                )}
              </div>
            )}
            {part && (
              <>
                <ProblemBar problem={c.act.problem} onLoadLatest={onLoadLatest} />
                <CommandDialogs a={a} dialog={c.dialog} onClose={() => c.setDialog(null)} onDone={onDone} onLoadLatest={onLoadLatest} />
              </>
            )}
          </div>
        </div>
      </div>
      {hasChildren && expanded && (
        <ul
          role="group"
          className={mergeClasses(s.treeBranch, depth + 1 > INDENTED && s.treeBranchFlat)}
          aria-label={t("office.mission.partsOf", { title: a.title })}
        >
          {node.children.map((child) => (
            <AssignmentTreeItem
              key={child.a.id}
              node={child}
              depth={depth + 1}
              collapsedIds={collapsedIds}
              onToggleCollapse={onToggleCollapse}
              titleByUnitKey={titleByUnitKey}
              go={go}
              onInspectRun={onInspectRun}
              onDone={onDone}
              onLoadLatest={onLoadLatest}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

// The plan: interactive collapsible TreeView from root assignment down through department leads and teammates.
function Plan({
  assignments,
  collapsedIds,
  onToggleCollapse,
  go,
  onInspectRun,
  onDone,
  onLoadLatest,
}: {
  assignments: AssignmentView[];
  collapsedIds: ReadonlySet<string>;
  onToggleCollapse: (id: string) => void;
  go: Go;
  onInspectRun: (assignmentId: string) => void;
  onDone: () => void;
  onLoadLatest: () => void;
}) {
  const { t } = useI18n();
  const s = useStyles();
  const roots = treeOf(assignments);
  const titleByUnitKey = new Map<string, string>();
  for (const a of assignments) if (a.unitKey) titleByUnitKey.set(a.unitKey, a.title);
  return (
    <ul role="tree" className={s.planTree} aria-label={t("office.mission.assignmentsAria")}>
      {roots.map((node) => (
        <AssignmentTreeItem
          key={node.a.id}
          node={node}
          depth={0}
          collapsedIds={collapsedIds}
          onToggleCollapse={onToggleCollapse}
          titleByUnitKey={titleByUnitKey}
          go={go}
          onInspectRun={onInspectRun}
          onDone={onDone}
          onLoadLatest={onLoadLatest}
        />
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
function Question({ c, asker, assignments, onDone, onLoadLatest }: { c: ClarificationView; asker: AssignmentView | null; assignments: readonly AssignmentView[]; onDone: () => void; onLoadLatest: () => void }) {
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
            {t("office.mission.answeredBy", { by: humanizeActor(c.answeredBy, assignments, t).label, at: when(c.answeredAt) })}
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
          <Question key={c.id} c={c} asker={m.assignments.find((a) => a.id === c.askerAssignmentId) ?? null} assignments={m.assignments} onDone={onDone} onLoadLatest={onLoadLatest} />
        ))}
      </ul>
    </section>
  );
}

// One thing a lead shared with a part of its team: what (a source revision, or a part's hand-in -- its summary or in
// full), with whom, and whether it still holds. Taking it back asks first; every attempt that holds it is stopped.
function Share({ sh, leadName, assignments, onDone }: { sh: DataShareView; leadName: string; assignments: readonly AssignmentView[]; onDone: () => void }) {
  const { t } = useI18n();
  const o = useOfficeStyles();
  const act = useAction();
  const restore = useRestoreFocusTarget();
  const [confirming, setConfirming] = useState(false);
  const revoked = sh.revokedAt !== null;
  const unit = sh.fromUnit ?? t("office.mission.unknownUnit");
  const what = sh.kind === "source" ? t("office.mission.shareSource", { revision: short(sh.sourceRevisionId, 8) }) : t(sh.mode === "full" ? "office.mission.shareHandoffFull" : "office.mission.shareHandoffSummary", { unit });
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
        <div className={o.row} style={{ gap: "6px", flexShrink: 0 }}>
          <Badge appearance="tint" color={revoked ? "subtle" : "success"} style={{ borderRadius: "9999px", flexShrink: 0 }}>
            {revoked ? t("office.mission.shareRevoked") : t("office.mission.shareHolds")}
          </Badge>
          {!revoked && (
            <Button className={o.touch} size="small" disabled={act.busy} onClick={() => setConfirming(true)} {...restore}>
              {t("office.mission.revokeShare")}
            </Button>
          )}
        </div>
      </div>
      <Text size={200} className={o.wrap}>
        {what}
      </Text>
      <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
        {t("office.mission.sharedAt", { at: when(sh.sharedAt) })}
        {revoked ? t("office.mission.revokedMeta", { at: when(sh.revokedAt), by: humanizeActor(sh.revokedBy, assignments, t).label }) : ""}
      </Text>
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
          <Share key={sh.id} sh={sh} leadName={m.assignments.find((a) => a.id === sh.leadAssignmentId)?.employeeName ?? humanizeActor(sh.sharedBy, m.assignments, t).label} assignments={m.assignments} onDone={onDone} />
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

const SHOWN = /^(text\/(markdown|plain|csv)|application\/(json|pdf)|image\/(png|jpeg))$/;

function Handoff({ h, a, assignments, onDone, onLoadLatest }: { h: HandoffView; a: AssignmentView | null; assignments: readonly AssignmentView[]; onDone: () => void; onLoadLatest: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const act = useAction();
  const restore = useRestoreFocusTarget();
  const [revising, setRevising] = useState(false);
  const [criteria, setCriteria] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [showTech, setShowTech] = useState(false);
  const reviewable = h.status === "submitted" && a !== null;
  const submitter = humanizeActor(h.submittedBy, assignments, t);
  const reviewer = h.review ? humanizeActor(h.review.by, assignments, t) : null;
  const supportedCount = h.claims.filter((c) => c.supported).length;
  const unverifiedCount = h.claims.length - supportedCount;
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
        <Text size={200} className={mergeClasses(o.muted, o.wrap)} title={submitter.raw ?? undefined}>
          {t("office.mission.handedIn", { at: when(h.submittedAt), by: submitter.label }).replace(/^ · /, "")}
        </Text>
      </div>
      <Markdown text={h.summary} />
      {h.artifacts.length > 0 && (
        <ul className={o.list} aria-label={t("office.mission.artifactsAria", { revision: h.revision })}>
          {h.artifacts.map((x) => {
            const canPreview = SHOWN.test(x.mediaType);
            return (
              <li key={x.id} className={s.fileRow}>
                <div className={o.row}>
                  <Link className="orbit-target" href={office.artifactHref(x.id)} {...(canPreview ? {} : { download: x.name })} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                    {!canPreview && <ArrowDownload16Regular aria-hidden />} {x.name}
                  </Link>
                  <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
                    {bytesText(x.size)}
                    {showTech ? ` · ${x.kind} · ${x.mediaType} · sha256 ${short(x.sha256)}` : ""}
                  </Text>
                </div>
                {canPreview && (
                  <Link className="orbit-target" href={office.artifactHref(x.id)} download={x.name} target="_blank" rel="noopener noreferrer" style={{ fontSize: tokens.fontSizeBase200 }}>
                    <ArrowDownload16Regular aria-hidden /> {t("office.mission.downloadFile")}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {h.claims.length > 0 && (
        <div className={o.stack} style={{ gap: "8px" }}>
          <div className={o.stack} style={{ gap: "2px" }}>
            <Text size={200} weight="semibold">
              {t("office.mission.claimsSummary", { total: h.claims.length, supported: supportedCount, unverified: unverifiedCount })}
            </Text>
            {unverifiedCount > 0 && (
              <Text size={200} className={o.muted}>
                {t("office.mission.claimsUnverifiedHint")}
              </Text>
            )}
          </div>
          <ul className={o.list} aria-label={t("office.mission.claimsAria", { revision: h.revision })}>
            {h.claims.map((c, i) => (
              <li key={`${i}:${c.text}`} className={o.item}>
                <div className={o.row}>
                  <Badge appearance="tint" color={c.supported ? "success" : "warning"} title={c.supported ? t("office.mission.supported") : t("office.mission.claimsUnverifiedHint")}>
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
        </div>
      )}
      {h.missing.length > 0 && (
        <Text size={200} className={mergeClasses(o.danger, o.wrap)}>
          {t("office.mission.missingDeliverables", { missing: h.missing.join(", ") })}
        </Text>
      )}
      {h.review && reviewer && (
        <Text size={200} className={mergeClasses(o.muted, s.plain)} title={reviewer.raw ?? undefined}>
          {t("office.mission.reviewedBy", { by: reviewer.label, at: when(h.review.at) })}
          {h.review.note ? `: ${h.review.note}` : ""}
        </Text>
      )}
      {h.status === "submitted" && a !== null && a.reviewedBy === "lead" && (
        <Text size={200} className={mergeClasses(o.muted, o.wrap)}>
          {a.leadName ? t("office.mission.leadReviewsIt", { name: a.leadName }) : t("office.mission.itsLeadReviewsIt")}
        </Text>
      )}
      <div className={o.between}>
        {reviewable ? (
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
        ) : (
          <span />
        )}
        <Button
          type="button"
          size="small"
          appearance="subtle"
          className={s.disclosureToggle}
          icon={showTech ? <ChevronUp16Regular /> : <ChevronDown16Regular />}
          iconPosition="after"
          aria-expanded={showTech}
          onClick={() => setShowTech((v) => !v)}
        >
          {showTech ? t("office.mission.hideTechnicalDetails") : t("office.mission.technicalDetails")}
        </Button>
      </div>
      {showTech && (
        <div className={s.detailsDrawer}>
          <dl className={o.dl}>
            <dt className={o.dt}>{t("office.mission.revisionDigestLabel")}</dt>
            <dd className={o.dd}>
              <span className={s.digestPill}>{short(h.digest)}</span>
            </dd>
          </dl>
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
            <Handoff key={`${h.id}:${h.status}`} h={h} a={g.a} assignments={m.assignments} onDone={onDone} onLoadLatest={onLoadLatest} />
          ))}
        </section>
      ))}
    </>
  );
}

interface TimelineGroup {
  key: number;
  at: string;
  lastAt: string;
  actor: string;
  summary: string;
  count: number;
}

function collapseTimeline(items: readonly TimelineEntry[]): TimelineGroup[] {
  const out: TimelineGroup[] = [];
  for (const item of items) {
    const prev = out[out.length - 1];
    if (prev && prev.actor === item.actor && prev.summary === item.summary) {
      prev.count += 1;
      prev.lastAt = item.at;
    } else {
      out.push({ key: item.seq, at: item.at, lastAt: item.at, actor: item.actor, summary: item.summary, count: 1 });
    }
  }
  return out;
}

function MissionTimeline({ items, assignments }: { items: readonly TimelineEntry[]; assignments: readonly AssignmentView[] }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const [grouped, setGrouped] = useState(true);
  if (items.length === 0) return <Text className={o.muted}>{t("office.mission.timelineEmpty")}</Text>;
  const rows: TimelineGroup[] = grouped
    ? collapseTimeline(items)
    : items.map((item) => ({ key: item.seq, at: item.at, lastAt: item.at, actor: item.actor, summary: item.summary, count: 1 }));
  return (
    <div className={o.stack} style={{ gap: "12px" }}>
      <div className={o.between}>
        <Text weight="semibold" size={300}>
          {t("office.mission.tab.timeline")} ({items.length})
        </Text>
        <div className={o.row} style={{ gap: "4px" }}>
          <Button size="small" appearance={grouped ? "primary" : "subtle"} onClick={() => setGrouped(true)}>
            {t("office.mission.timelineCollapse")}
          </Button>
          <Button size="small" appearance={!grouped ? "primary" : "subtle"} onClick={() => setGrouped(false)}>
            {t("office.mission.timelineAll")}
          </Button>
        </div>
      </div>
      <ol className={s.timelineList}>
        {rows.map((row) => {
          const actor = humanizeActor(row.actor, assignments, t);
          return (
            <li key={row.key} className={mergeClasses(o.item, s.timelineItem)}>
              <span className={s.timelineDot} aria-hidden />
              <div className={o.between}>
                <Text size={200} className={o.muted} title={actor.raw ?? undefined}>
                  {whenSeconds(row.at)}
                  {row.count > 1 && row.lastAt !== row.at ? ` – ${whenSeconds(row.lastAt)}` : ""} · {actor.label}
                </Text>
                {row.count > 1 && (
                  <Badge appearance="tint" color="informative" size="small">
                    {t("office.mission.timelineRepeated", { count: row.count })}
                  </Badge>
                )}
              </div>
              <Text size={200} className={o.wrap}>
                {row.summary}
              </Text>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function MissionPage({ id, tab, go }: { id: string; tab: string | null; go: Go }) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const mission = useOfficeRead<MissionDetail>(() => office.mission(id), [id], ["missions", "inbox"], id);
  const [runAssignmentId, setRunAssignmentId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [showBriefAdvanced, setShowBriefAdvanced] = useState(false);
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
  const roots = treeOf(m.assignments);
  const branchIds = collectBranchIds(roots);
  const allCollapsed = branchIds.length > 0 && branchIds.every((bid) => collapsedIds.has(bid));
  const toggleCollapse = (assignmentId: string) =>
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(assignmentId)) next.delete(assignmentId);
      else next.add(assignmentId);
      return next;
    });
  const toggleAllBranches = () => setCollapsedIds(allCollapsed ? new Set() : new Set(branchIds));
  const ordered = flatten(roots);
  const root = m.assignments.find((a) => a.id === m.assignment.id) ?? m.assignments.find((a) => a.parentId === null) ?? null;
  const selectedRunAssignment = (runAssignmentId !== null ? ordered.find((a) => a.id === runAssignmentId) : undefined) ?? root ?? ordered[0] ?? null;
  const inspectRun = (assignmentId: string) => {
    setRunAssignmentId(assignmentId);
    go("mission", id, "run");
  };
  const reload = () => void mission.reload();
  // A mission whose work was split into parts has a team room (the tab shows when asked for by its address too).
  const parts = m.assignments.filter((a) => a.parentId !== null);
  const hasTeam = parts.length > 0 || current === "team";
  const advancedTabs = ADVANCED_MISSION_TABS.filter((tabKey): tabKey is "timeline" | "team" | "run" => tabKey !== "team" || hasTeam);
  const onAdvancedTab = (ADVANCED_MISSION_TABS as readonly string[]).includes(current);
  // The root's question, when the mission lists it, is answered where the questions are.
  const rootAsked = root !== null && m.clarifications.some((c) => c.askerAssignmentId === root.id && c.state === "open" && c.addressee === "owner");
  const doneCount = parts.filter((p) => p.state === "COMPLETED").length;
  const awaitingCount = parts.filter((p) => p.state === "AWAITING_ACCEPTANCE" || p.state === "REVIEWING").length;
  const workingCount = parts.filter((p) => p.state === "RUNNING" || p.state === "RECOVERING" || p.state === "ASSIGNED" || p.state === "ANSWERING" || p.state === "WAITING_FOR_SUBORDINATES").length;
  const queuedCount = parts.filter((p) => p.state === "QUEUED").length;
  const creator = humanizeActor(m.createdBy, m.assignments, t);
  const rootRunWaiting = root?.lastRun && (root.lastRun.state === "waiting_for_resources" || root.lastRun.state === "unschedulable") ? root.lastRun : null;
  const awaitingOwnerAcceptance = root?.state === "AWAITING_ACCEPTANCE" && root.actions.includes("accept");
  return (
    <div className={o.page}>
      <section className={o.heroCard} aria-label={m.title}>
        <div className={o.between} style={{ alignItems: "flex-start" }}>
          <Text as="h2" weight="semibold" size={600} className={mergeClasses(o.wrap, o.headingReset)}>
            {m.title}
          </Text>
          {m.handoffs.length > 0 && current !== "handoffs" && (
            <Button size="small" appearance="primary" onClick={() => go("mission", id, "handoffs")}>
              {awaitingOwnerAcceptance ? t("office.mission.reviewAndAccept", { count: m.handoffs.length }) : t("office.mission.jumpHandoffs", { count: m.handoffs.length })}
            </Button>
          )}
        </div>
        <div className={o.row}>
          <StateBadge text={ASSIGNMENT_STATE_TEXT[m.assignment.state]} state={m.assignment.state} />
          <EmployeeAvatar name={m.assignment.employeeName} employeeId={m.assignment.employeeId} size="sm" />
          <Text size={200} className={o.wrap}>
            {t("office.mission.heldByPrefix")}
            <Link as="button" onClick={() => go("employee", m.assignment.employeeId)}>
              {m.assignment.employeeName}
            </Link>
            {m.deadline ? t("office.work.due", { at: when(m.deadline) }) : ""}
            {m.nextAction ? t("office.work.next", { next: m.nextAction }) : ""}
          </Text>
        </div>
        {parts.length > 0 && (
          <div className={o.stack} style={{ gap: "6px" }}>
            <div className={s.progressTrack} aria-hidden>
              {doneCount > 0 && <div style={{ flexGrow: doneCount, backgroundColor: tokens.colorPaletteGreenBackground3 }} />}
              {awaitingCount > 0 && <div style={{ flexGrow: awaitingCount, backgroundColor: tokens.colorPaletteMarigoldBackground3 }} />}
              {workingCount > 0 && <div style={{ flexGrow: workingCount, backgroundColor: tokens.colorBrandBackground }} />}
              {queuedCount > 0 && <div style={{ flexGrow: queuedCount, backgroundColor: tokens.colorNeutralStroke1 }} />}
            </div>
            <div className={o.row} style={{ gap: "8px" }}>
              <Text size={200} weight="semibold">
                {t("office.mission.progressParts", { done: doneCount, total: parts.length })}
              </Text>
              {awaitingCount > 0 && (
                <Text size={200} className={o.warn}>
                  · {t("office.mission.progressAwaiting", { count: awaitingCount })}
                </Text>
              )}
              {workingCount > 0 && (
                <Text size={200} className={o.muted}>
                  · {t("office.mission.progressWorking", { count: workingCount })}
                </Text>
              )}
              {queuedCount > 0 && (
                <Text size={200} className={o.muted}>
                  · {t("office.mission.progressQueued", { count: queuedCount })}
                </Text>
              )}
            </div>
          </div>
        )}
        {rootRunWaiting && (
          <Callout tone={rootRunWaiting.state === "unschedulable" ? "danger" : "warn"} icon={<Warning16Regular />}>
            <div className={o.between}>
              <div className={o.stack} style={{ gap: "2px", flexGrow: 1 }}>
                <Text size={200} weight="semibold">
                  {t(RUN_STATE_KEYS[rootRunWaiting.state])}: {rootRunWaiting.waitingReason ?? t("office.run.noReasonGiven")}
                </Text>
                <Text size={200}>{t("office.mission.resourceWaitExplain")}</Text>
              </div>
              {current !== "run" && root && (
                <Button size="small" onClick={() => inspectRun(root.id)} style={{ flexShrink: 0 }}>
                  {t("office.mission.inspectLastRun")}
                </Button>
              )}
            </div>
          </Callout>
        )}
        <AsOf at={mission.loadedAt} />
      </section>
      <div className={`${o.tabStrip} orbit-hscroll`}>
        <div className={s.tabBarRow}>
          <div className={s.tabBarMain}>
            <TabList selectedValue={onAdvancedTab ? "" : current} onTabSelect={(_, d) => go("mission", id, d.value as string)} aria-label={t("office.mission.tabsAria")}>
              {PRIMARY_MISSION_TABS.map((tabKey) => (
                <Tab key={tabKey} value={tabKey}>
                  {t(TAB_KEYS[tabKey])}
                  {tabKey === "handoffs" && m.handoffs.length > 0 ? ` (${m.handoffs.length})` : ""}
                </Tab>
              ))}
            </TabList>
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<Settings16Regular />}
                  className={mergeClasses(s.advancedTabBtn, onAdvancedTab && s.advancedTabBtnActive)}
                  aria-label={t("office.mission.tab.advancedAria")}
                >
                  {onAdvancedTab ? t("office.mission.tab.advancedActive", { tab: t(TAB_KEYS[current]) }) : t("office.mission.tab.advanced")}{" "}
                  <ChevronDown16Regular aria-hidden style={{ verticalAlign: "middle", marginLeft: "2px" }} />
                </Button>
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuGroup>
                    <MenuGroupHeader>{t("office.mission.advancedMenuHeader")}</MenuGroupHeader>
                    {advancedTabs.map((tabKey) => (
                      <MenuItem key={tabKey} onClick={() => go("mission", id, tabKey)}>
                        <div className={s.menuItemBody}>
                          <Text weight={current === tabKey ? "semibold" : "regular"}>{t(TAB_KEYS[tabKey])}</Text>
                          <span className={s.menuItemSub}>{t(ADVANCED_TAB_DESC[tabKey])}</span>
                        </div>
                      </MenuItem>
                    ))}
                  </MenuGroup>
                </MenuList>
              </MenuPopover>
            </Menu>
          </div>
        </div>
      </div>

      {current === "overview" && (
        <div className={s.overviewGrid}>
          <div className={s.colStack}>
            <section className={o.card} aria-label={t("office.mission.plan")}>
              <div className={o.between}>
                <div className={o.row} style={{ gap: "8px" }}>
                  <Text weight="semibold" size={400}>
                    {t("office.mission.plan")}
                  </Text>
                  {branchIds.length > 0 && (
                    <Button size="small" appearance="subtle" onClick={toggleAllBranches}>
                      {allCollapsed ? t("office.mission.expandAll") : t("office.mission.collapseAll")}
                    </Button>
                  )}
                </div>
                {root && <AssignmentActions a={root} answerHere={!rootAsked} onDone={reload} onLoadLatest={reload} />}
              </div>
              <Plan
                assignments={m.assignments}
                collapsedIds={collapsedIds}
                onToggleCollapse={toggleCollapse}
                go={go}
                onInspectRun={inspectRun}
                onDone={reload}
                onLoadLatest={reload}
              />
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
          </div>
          <div className={s.colStack}>
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
                    <dd className={o.dd}>{givenToPlainText(t, m.target)}</dd>
                  </>
                )}
                {m.deliverables.length > 0 && (
                  <>
                    <dt className={o.dt}>{t("office.assign.deliverables")}</dt>
                    <dd className={o.dd}>{m.deliverables.map((d) => `${d.name}${d.required ? "" : ` (${t("office.assign.optionalTag")})`}`).join(", ")}</dd>
                  </>
                )}
                {m.acceptanceCriteria.length > 0 && (
                  <>
                    <dt className={o.dt}>{t("office.mission.acceptedWhen")}</dt>
                    <dd className={o.dd}>
                      <ul className={s.criteriaList}>
                        {m.acceptanceCriteria.map((criterion, idx) => (
                          <li key={`${idx}:${criterion}`}>{criterion}</li>
                        ))}
                      </ul>
                    </dd>
                  </>
                )}
                {(m.repositories ?? []).length > 0 && (
                  <>
                    <dt className={o.dt}>{t("office.repos.title")}</dt>
                    <dd className={o.dd}>{(m.repositories ?? []).map((r) => `${r.fullName}${r.branch === null ? "" : ` (${r.branch})`}`).join(", ")}</dd>
                  </>
                )}
                <dt className={o.dt}>{t("office.mission.created")}</dt>
                <dd className={o.dd} title={creator.raw ?? undefined}>
                  {t("office.mission.createdBy", { at: when(m.createdAt), by: creator.label })}
                </dd>
              </dl>
              <Button
                type="button"
                size="small"
                appearance="subtle"
                className={s.disclosureToggle}
                icon={showBriefAdvanced ? <ChevronUp16Regular /> : <ChevronDown16Regular />}
                iconPosition="after"
                aria-expanded={showBriefAdvanced}
                onClick={() => setShowBriefAdvanced((v) => !v)}
              >
                {showBriefAdvanced ? t("office.mission.hideAdvancedDetails") : t("office.mission.advancedDetails")}
              </Button>
              {showBriefAdvanced && (
                <div className={s.detailsDrawer}>
                  <dl className={o.dl}>
                    {m.target !== null && (
                      <>
                        <dt className={o.dt}>{t("office.mission.detailRouting")}</dt>
                        <dd className={o.dd}>{givenToText(t, m.target)}</dd>
                      </>
                    )}
                    {m.deliverables.length === 0 && (
                      <>
                        <dt className={o.dt}>{t("office.assign.deliverables")}</dt>
                        <dd className={o.dd}>{t("office.mission.noneNamed")}</dd>
                      </>
                    )}
                    {m.acceptanceCriteria.length === 0 && (
                      <>
                        <dt className={o.dt}>{t("office.mission.acceptedWhen")}</dt>
                        <dd className={o.dd}>{t("office.mission.noCriteriaNamed")}</dd>
                      </>
                    )}
                    <dt className={o.dt}>{t("office.mission.acceptedBy")}</dt>
                    <dd className={o.dd}>{m.acceptanceMode === "owner_review" ? t("office.mission.ownerYou") : t("office.mission.itsManager")}</dd>
                    <dt className={o.dt}>{t("office.sources.title")}</dt>
                    <dd className={o.dd}>{m.sourceRevisionIds.length === 0 ? t("office.mission.nonePinned") : t("office.mission.sourcesPinned", { count: m.sourceRevisionIds.length })}</dd>
                    {(m.repositories ?? []).length === 0 && (
                      <>
                        <dt className={o.dt}>{t("office.repos.title")}</dt>
                        <dd className={o.dd}>{t("office.mission.none")}</dd>
                      </>
                    )}
                  </dl>
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {current === "timeline" && (
        <section className={o.card} aria-label={t("office.mission.tab.timeline")}>
          <MissionTimeline items={m.timeline} assignments={m.assignments} />
        </section>
      )}

      {current === "communication" && <MissionCommunication m={m} />}

      {current === "handoffs" && <HandIns m={m} onDone={reload} onLoadLatest={reload} />}

      {current === "team" && (
        <section className={o.card} aria-label={t("office.mission.tab.team")}>
          <TeamRoom missionId={m.id} go={go} />
        </section>
      )}

      {current === "run" && (
        <section className={o.card} aria-label={t("office.mission.tab.run")}>
          {ordered.length > 1 && selectedRunAssignment && (
            <Field label={t("office.mission.runForAssignment")}>
              <Select
                aria-label={t("office.mission.runAssignmentAria")}
                value={selectedRunAssignment.id}
                onChange={(_, d) => setRunAssignmentId(d.value)}
              >
                {ordered.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.employeeName} — {a.title} ({ASSIGNMENT_STATE_TEXT[a.state]}
                    {a.lastRun ? ` · ${t(RUN_STATE_KEYS[a.lastRun.state])}` : ""})
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {selectedRunAssignment?.lastRun ? <RunDetails run={selectedRunAssignment.lastRun} /> : <Text className={o.muted}>{t("office.mission.runEmpty")}</Text>}
        </section>
      )}
    </div>
  );
}
