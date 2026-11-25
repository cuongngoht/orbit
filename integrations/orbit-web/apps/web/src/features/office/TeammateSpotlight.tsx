// TEAMMATE SPOTLIGHT: floating quick-inspect & control bar anchored inside the Virtual Workplace floor.
// Lets the owner preview live spatial status, cycle teammates (Prev/Next or ArrowLeft/ArrowRight), send a 1-line
// quick brief, move an employee between departments, customize their floor avatar look, or jump straight into review,
// profile, CEO Chat, or desk files.
import { Badge, Button, Input, Link, Select, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import {
  Chat16Regular,
  ChevronDown12Regular,
  ChevronLeft16Regular,
  ChevronRight16Regular,
  Clock16Regular,
  Color16Regular,
  Dismiss16Regular,
  Flash16Regular,
  FolderOpen16Regular,
  Location16Regular,
  Person16Regular,
  Send16Regular,
  Sparkle16Regular,
  TaskListLtr20Regular,
} from "@fluentui/react-icons";
import { RUNTIME_LABELS, checkCreateMission, type CreateMissionRequest, type Department, type EmployeeCard } from "@orbit-web/contracts";
import { useState } from "react";
import { hrefOf } from "../../hooks/useHashRoute";
import { useI18n } from "../../i18n";
import { errorText, newIdempotencyKey } from "../../services/api";
import { office } from "./api";
import { AvatarCustomizer } from "./AvatarCustomizer";
import { formatElapsed, type AvatarCustomization } from "./floorPrefs";
import type { WalkerState } from "./officeSim";
import { WorkLabelBadge, useOfficeStyles } from "./parts";
import { EmployeeDeskScene } from "./VirtualDesk";

function runtimeSummaryOf(e: EmployeeCard, defaultWord: string): string {
  const runtime = RUNTIME_LABELS[e.execution.runtime];
  const model = e.execution.model?.trim();
  if (e.execution.inherit?.includes("model")) return `${runtime} · ${defaultWord}`;
  return model ? `${runtime} · ${model}` : runtime;
}

const useStyles = makeStyles({
  spotlight: {
    position: "sticky",
    bottom: "10px",
    zIndex: 20,
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    borderRadius: "16px",
    backgroundColor: "var(--orbit-inspector-bg)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    ...shorthands.border("1px", "solid", tokens.colorBrandStroke2),
    boxShadow: "0 12px 32px -8px rgba(15, 23, 42, 0.22), 0 0 0 1px rgba(91, 88, 212, 0.08)",
    animationName: "orbit-inspector-in",
    animationDuration: "180ms",
    animationTimingFunction: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    minWidth: 0,
  },
  topRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
    minWidth: 0,
  },
  main: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexGrow: 1,
    minWidth: "min(100%, 260px)",
  },
  scene: {
    borderRadius: "12px",
    paddingTop: "4px",
    paddingRight: "6px",
    paddingBottom: "4px",
    paddingLeft: "6px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    flexShrink: 0,
    "@media (max-width: 520px)": { display: "none" },
  },
  info: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
    flexGrow: 1,
  },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground2,
  },
  metaItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
    flexShrink: 0,
  },
  cycleGroup: {
    display: "inline-flex",
    alignItems: "center",
    gap: "2px",
    paddingTop: "2px",
    paddingRight: "2px",
    paddingBottom: "2px",
    paddingLeft: "2px",
    borderRadius: "8px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
  controlsBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    paddingTop: "8px",
    ...shorthands.borderTop("1px", "solid", tokens.colorNeutralStroke2),
    minWidth: 0,
  },
  quickAssignForm: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexGrow: 1,
    minWidth: "min(100%, 260px)",
  },
  quickInput: {
    flexGrow: 1,
    minWidth: 0,
  },
  moveWrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    flexShrink: 0,
  },
  customizerBar: {
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    borderRadius: "10px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
  muted: { color: tokens.colorNeutralForeground3 },
  modelChipBtn: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    maxWidth: "100%",
    paddingTop: "1px",
    paddingRight: "7px",
    paddingBottom: "1px",
    paddingLeft: "6px",
    borderRadius: "9999px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground2,
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase100,
    fontWeight: tokens.fontWeightMedium,
    cursor: "pointer",
    transitionProperty: "background-color, border-color, color",
    transitionDuration: "120ms",
    ":hover": {
      backgroundColor: tokens.colorBrandBackground2,
      ...shorthands.borderColor(tokens.colorBrandStroke2),
      color: tokens.colorBrandForeground1,
    },
    ":focus-visible": {
      ...shorthands.outline("2px", "solid", tokens.colorStrokeFocus2),
      outlineOffset: "1px",
    },
  },
  feedbackOk: { color: tokens.colorPaletteGreenForeground1 },
  feedbackErr: { color: tokens.colorPaletteRedForeground1 },
});

export function TeammateSpotlight({
  employee: e,
  walker: w,
  departmentLabel,
  departments,
  isCeo,
  isManager,
  canCycle,
  nowMs,
  avatarStyle,
  onSetAvatarStyle,
  onCycle,
  onClose,
  onAssign,
  onOpenEmployee,
  onOpenMission,
  onOpenReview,
  onChangeModel,
  onRosterChanged,
}: {
  employee: EmployeeCard;
  walker: WalkerState | undefined;
  departmentLabel: string;
  departments: Department[];
  isCeo: boolean;
  isManager: boolean;
  canCycle: boolean;
  nowMs: number;
  avatarStyle?: AvatarCustomization;
  onSetAvatarStyle: (style: AvatarCustomization | null) => void;
  onCycle: (dir: -1 | 1) => void;
  onClose: () => void;
  onAssign: (employeeId: string) => void;
  onOpenEmployee: (employeeId: string) => void;
  onOpenMission: (missionId: string) => void;
  onOpenReview?: (missionId: string | null) => void;
  onChangeModel?: (employee: EmployeeCard) => void;
  onRosterChanged?: () => void;
}) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const [quickGoal, setQuickGoal] = useState("");
  const [sending, setSending] = useState(false);
  const [moving, setMoving] = useState(false);
  const [showLook, setShowLook] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "err"; text: string; missionId?: string } | null>(null);

  const locationText =
    w?.walking || w?.zone === "hallway" || (w && w.path.length > 0)
      ? t("office.floor.locWalking")
      : w?.zone === "pantry"
        ? t("office.floor.locInPantry")
        : w?.zone === "director"
          ? t("office.floor.locAtDirector")
          : t("office.floor.locAtDesk");

  const elapsed = e.holding ? formatElapsed(e.holding.since, nowMs) : null;
  const waitingForYou = e.workLabel === "waiting_review" || e.workLabel === "waiting_info";
  const deskHref = hrefOf({ view: { view: "governance", page: "desks", item: e.id }, settings: null });
  const ceoHref = hrefOf({ view: { view: "ceo", conversationId: null }, settings: null });
  const liveDepts = departments.filter((d) => !d.archived);

  const sendQuickBrief = async () => {
    const trimmed = quickGoal.trim();
    if (!trimmed || sending || e.employment === "archived") return;
    const body: CreateMissionRequest = {
      goal: trimmed,
      target: { kind: "employee", employeeId: e.id },
      whenBusy: e.holding ? "enqueue" : "reject",
      deliverables: [],
      acceptanceCriteria: [],
      deadline: null,
    };
    const checked = checkCreateMission(body);
    if (!checked.ok) {
      setFeedback({ kind: "err", text: checked.errors.join("; ") });
      return;
    }
    setSending(true);
    setFeedback(null);
    try {
      const res = await office.createMission(body, newIdempotencyKey());
      setQuickGoal("");
      setFeedback({
        kind: "ok",
        text: res.state === "QUEUED" ? t("office.floor.quickAssignQueued", { name: e.name }) : t("office.floor.quickAssignSent", { name: e.name }),
        missionId: res.missionId,
      });
      onRosterChanged?.();
    } catch (err) {
      setFeedback({ kind: "err", text: errorText(err) });
    } finally {
      setSending(false);
    }
  };

  const moveDepartment = async (nextValue: string) => {
    const targetDeptId = nextValue === "__none__" ? null : nextValue;
    if (targetDeptId === e.departmentId || moving) return;
    setMoving(true);
    setFeedback(null);
    try {
      const detail = await office.employee(e.id);
      await office.moveEmployee(detail, targetDeptId);
      onRosterChanged?.();
    } catch (err) {
      setFeedback({ kind: "err", text: errorText(err) });
    } finally {
      setMoving(false);
    }
  };

  return (
    <aside className={s.spotlight} aria-label={t("office.floor.spotlightAria", { name: e.name })}>
      <div className={s.topRow}>
        <div className={s.main}>
          <div className={s.scene} aria-hidden>
            <EmployeeDeskScene name={e.name} workLabel={e.workLabel} compact avatarStyle={avatarStyle} seed={e.id} executive={isCeo} />
          </div>
          <div className={s.info}>
            <div className={o.row} style={{ gap: "6px" }}>
              <Text weight="semibold" size={400}>
                {e.name}
              </Text>
              {isCeo && (
                <Badge appearance="tint" color="brand" size="small">
                  {t("office.floor.roleCeo")}
                </Badge>
              )}
              {!isCeo && isManager && (
                <Badge appearance="tint" color="informative" size="small">
                  {t("office.floor.roleManager")}
                </Badge>
              )}
              {e.kind === "assistant" && (
                <Badge appearance="tint" color="subtle" size="small">
                  {t("office.floor.roleAssistant")}
                </Badge>
              )}
              <WorkLabelBadge label={e.workLabel} />
            </div>
            <div className={o.row} style={{ gap: "6px" }}>
              <Text size={200} className={s.muted}>
                {e.title} · {departmentLabel}
              </Text>
              {onChangeModel && e.employment !== "archived" ? (
                <button
                  type="button"
                  className={s.modelChipBtn}
                  aria-label={t("office.floor.changeModelFor", { name: e.name })}
                  title={t("office.floor.changeModelFor", { name: e.name })}
                  onClick={() => onChangeModel(e)}
                >
                  <Sparkle16Regular style={{ fontSize: "12px", flexShrink: 0 }} aria-hidden />
                  <span>{runtimeSummaryOf(e, t("office.floor.defaultModelShort"))}</span>
                  <ChevronDown12Regular style={{ flexShrink: 0 }} aria-hidden />
                </button>
              ) : (
                <Text size={200} className={s.muted}>
                  · {runtimeSummaryOf(e, t("office.floor.defaultModelShort"))}
                </Text>
              )}
            </div>
            <div className={s.meta}>
              <span className={s.metaItem}>
                <Location16Regular />
                <span>{locationText}</span>
              </span>
              {elapsed && (
                <span className={s.metaItem}>
                  <Clock16Regular />
                  <span>{t("office.floor.elapsedPrefix", { time: elapsed })}</span>
                </span>
              )}
              {e.holding ? (
                <span className={s.metaItem}>
                  <Text size={100} className={s.muted}>
                    {t("office.floor.currentWorkLabel")}:
                  </Text>
                  <Link as="button" style={{ fontSize: tokens.fontSizeBase100 }} onClick={() => onOpenMission(e.holding?.missionId ?? "")}>
                    {e.holding.title}
                  </Link>
                </span>
              ) : (
                <span className={s.metaItem}>
                  <Text size={100} className={s.muted}>
                    {t("office.floor.currentWorkLabel")}: {t("office.overview.noCurrentWork")}
                  </Text>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className={s.actions}>
          {waitingForYou && onOpenReview && (
            <Button size="small" appearance="primary" icon={<Flash16Regular />} onClick={() => onOpenReview(e.holding?.missionId ?? null)}>
              {t("office.floor.reviewNow")}
            </Button>
          )}
          {e.employment !== "archived" && (
            <Button
              size="small"
              appearance={waitingForYou ? "outline" : "primary"}
              icon={<TaskListLtr20Regular />}
              onClick={() => {
                onClose();
                onAssign(e.id);
              }}
            >
              {t("office.floor.quickAssignFull")}
            </Button>
          )}
          <Button size="small" icon={<Person16Regular />} onClick={() => onOpenEmployee(e.id)}>
            {t("office.floor.openProfile")}
          </Button>
          {isCeo && (
            <Button as="a" href={ceoHref} size="small" appearance="subtle" icon={<Chat16Regular />}>
              {t("office.floor.openCeoChat")}
            </Button>
          )}
          <Button as="a" href={deskHref} size="small" appearance="subtle" icon={<FolderOpen16Regular />}>
            {t("office.floor.browseDesk")}
          </Button>
          <Button
            size="small"
            appearance={showLook ? "primary" : "subtle"}
            icon={<Color16Regular />}
            aria-label={t("office.floor.customizeLook")}
            aria-pressed={showLook}
            title={t("office.floor.customizeLook")}
            onClick={() => setShowLook((v) => !v)}
          />
          {canCycle && (
            <span className={s.cycleGroup}>
              <Button size="small" appearance="subtle" icon={<ChevronLeft16Regular />} aria-label={t("office.floor.prevTeammate")} onClick={() => onCycle(-1)} />
              <Button size="small" appearance="subtle" icon={<ChevronRight16Regular />} aria-label={t("office.floor.nextTeammate")} onClick={() => onCycle(1)} />
            </span>
          )}
          <Button size="small" appearance="subtle" icon={<Dismiss16Regular />} aria-label={t("office.floor.closeInspect")} onClick={onClose} />
        </div>
      </div>

      {/* Inline Quick Brief + Quick Move Department bar */}
      {e.employment !== "archived" && (
        <div className={s.controlsBar}>
          <form
            className={s.quickAssignForm}
            onSubmit={(ev) => {
              ev.preventDefault();
              void sendQuickBrief();
            }}
          >
            <Input
              size="small"
              className={s.quickInput}
              placeholder={t("office.floor.quickAssignPlaceholder", { name: e.name })}
              aria-label={t("office.floor.quickAssignAria", { name: e.name })}
              value={quickGoal}
              disabled={sending}
              onChange={(_, d) => setQuickGoal(d.value)}
            />
            <Button type="submit" size="small" appearance="primary" icon={<Send16Regular />} disabled={sending || quickGoal.trim() === ""}>
              {sending ? t("office.floor.quickAssignSending") : t("office.floor.quickAssignSend")}
            </Button>
          </form>

          {!isCeo && liveDepts.length > 0 && (
            <div className={s.moveWrap}>
              <Text size={100} className={s.muted}>
                {t("office.floor.moveDepartmentLabel")}:
              </Text>
              <Select
                size="small"
                aria-label={t("office.floor.moveDepartmentAria", { name: e.name })}
                value={e.departmentId ?? "__none__"}
                disabled={moving}
                onChange={(_, d) => void moveDepartment(d.value)}
              >
                {liveDepts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
                <option value="__none__">{t("office.overview.unassigned")}</option>
              </Select>
            </div>
          )}
        </div>
      )}

      {feedback && (
        <div className={o.row} style={{ gap: "8px" }} role="status">
          <Text size={200} className={feedback.kind === "ok" ? s.feedbackOk : s.feedbackErr}>
            {feedback.text}
          </Text>
          {feedback.missionId && (
            <Link as="button" style={{ fontSize: tokens.fontSizeBase200 }} onClick={() => onOpenMission(feedback.missionId!)}>
              {t("office.assign.openWork")}
            </Link>
          )}
        </div>
      )}

      {/* Avatar Look Customizer */}
      {showLook && (
        <div className={s.customizerBar}>
          <AvatarCustomizer value={avatarStyle} onChange={onSetAvatarStyle} />
        </div>
      )}
    </aside>
  );
}
