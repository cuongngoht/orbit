// GATHER-STYLE UNIFIED VIRTUAL COMPANY FLOOR: one complete architectural company plan on warm hardwood planks
// with partitioned walls & doorways -- Top Wing (Director's Office where teammates bring questions/reviews + Pantry &
// Lounge for resting with coffee/ping-pong) connected via the Main Hallway to Integrated Department Work Rooms below
// (modern desks, loading monitors, thought bubbles, pen-spinning idle animations, and desk actions).
import { Button, Link, Menu, MenuItem, MenuList, MenuPopover, MenuTrigger, Text, makeStyles, mergeClasses, shorthands, tokens, useRestoreFocusTarget } from "@fluentui/react-components";
import { Dismiss16Regular, ErrorCircle16Regular, MoreHorizontal16Regular, TaskListLtr20Regular, Warning16Regular } from "@fluentui/react-icons";
import type { AuthAccount, Department, EmployeeCard, WorkLabel } from "@orbit-web/contracts";
import { useState } from "react";
import { IconBadge, OfficeIcon } from "../../components/SectionIcons";
import type { DepartmentEdit } from "./DepartmentDialogs";
import { Callout, WorkLabelBadge, useOfficeStyles, when } from "./parts";
import {
  GatherNamePill,
  PixelBookshelfSvg,
  PixelChibiSvg,
  PixelDirectorDeskSvg,
  PixelEmptyDeskClusterSvg,
  PixelModernDeskSvg,
  PixelPantryLoungeSvg,
  PixelPlantSvg,
  PixelQuestBubble,
} from "./PixelOfficeArt";
import { deskMoodText, presenceKindOf } from "./VirtualDesk";

interface FloorGroup {
  department: Department | null;
  employees: EmployeeCard[];
}

const ROOM_ACCENTS = [
  { dot: "#6366f1", tint: "rgba(99, 102, 241, 0.05)" },
  { dot: "#0d9488", tint: "rgba(13, 148, 136, 0.05)" },
  { dot: "#d97706", tint: "rgba(217, 119, 6, 0.05)" },
  { dot: "#9333ea", tint: "rgba(147, 51, 234, 0.05)" },
  { dot: "#2563eb", tint: "rgba(37, 99, 235, 0.05)" },
] as const;

function roomAccentFor(label: string) {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return ROOM_ACCENTS[h % ROOM_ACCENTS.length]!;
}

function dialogueSpeech(e: EmployeeCard): string {
  const title = e.holding?.title;
  if (e.workLabel === "waiting_review") {
    return title
      ? `“I walked over to your office with ‘${title}’ — ready for your opinion and review! Or want to assign the next task?”`
      : "“Came by the Director's Office — I have work ready for your review!”";
  }
  if (e.workLabel === "waiting_info") {
    return title
      ? `“Stopped by the Director's desk to ask your thoughts on ‘${title}’. Take a quick look or queue another brief?”`
      : "“I popped into the Director's Office to ask a quick question!”";
  }
  if (presenceKindOf(e.workLabel) === "waiting") {
    return title
      ? `“Waiting at the Director's Office regarding ‘${title}’. Want to inspect it or hand over another brief?”`
      : "“Waiting at the Director's Office for a quick check-in.”";
  }
  if (e.workLabel === "working") {
    return title
      ? `“Focused at my desk on ‘${title}’. Want to check progress or queue something behind it?”`
      : "“Typing away at my desk! Want to queue the next brief?”";
  }
  if (e.workLabel === "ready") {
    return "“Taking a breather in the Pantry with coffee — and twirling my pen at my desk. Ready whenever you have a new brief!”";
  }
  if (e.workLabel === "paused") {
    return "“Stepped into the Pantry to rest while paused. Resume or hand me a brief anytime!”";
  }
  if (e.workLabel === "not_ready") {
    return `“Desk is offline (${e.notReadyReason ?? "needs connection/setup"}). Check my desk profile?”`;
  }
  return "“Standing by in the office — ready whenever you are!”";
}

const useStyles = makeStyles({
  building: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    paddingTop: "14px",
    paddingRight: "16px",
    paddingBottom: "16px",
    paddingLeft: "16px",
    borderRadius: "20px",
    ...shorthands.border("2px", "solid", "var(--orbit-wall-outer)"),
    backgroundColor: "var(--orbit-floor-wood)",
    backgroundImage: "repeating-linear-gradient(180deg, transparent 0px, transparent 22px, var(--orbit-floor-plank) 22px, var(--orbit-floor-plank) 24px)",
    boxShadow: "var(--orbit-soft-shadow)",
    minWidth: 0,
  },
  topHud: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    paddingTop: "8px",
    paddingRight: "12px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    minWidth: 0,
  },
  hudLeft: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    minWidth: 0,
  },
  hudPillGroup: {
    display: "inline-flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    paddingTop: "3px",
    paddingRight: "10px",
    paddingBottom: "3px",
    paddingLeft: "10px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground2,
  },
  hudStat: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    whiteSpace: "nowrap",
  },
  dot: { width: "7px", height: "7px", borderRadius: "9999px", flexShrink: 0 },
  topWing: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: "14px",
    minWidth: 0,
    "@media (max-width: 820px)": { gridTemplateColumns: "1fr" },
  },
  execRoom: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "14px",
    paddingLeft: "14px",
    borderRadius: "16px",
    ...shorthands.border("2.5px", "solid", "var(--orbit-wall-outer)"),
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "inset 0 0 0 2px var(--orbit-wall-inner)",
    minWidth: 0,
  },
  execCarpet: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: "14px",
    flexWrap: "wrap",
    paddingTop: "12px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-rug-exec)",
    minHeight: "106px",
    minWidth: 0,
  },
  pantryCarpet: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-rug-pantry)",
    minHeight: "106px",
    minWidth: 0,
  },
  roomTitleBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    flexWrap: "wrap",
    minWidth: 0,
  },
  roomTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    paddingTop: "2px",
    paddingRight: "9px",
    paddingBottom: "2px",
    paddingLeft: "8px",
    borderRadius: "8px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    fontSize: tokens.fontSizeBase200,
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
  },
  doorwayBottom: {
    position: "absolute",
    bottom: "-4px",
    left: "50%",
    transform: "translateX(-50%)",
    width: "54px",
    height: "7px",
    backgroundColor: "var(--orbit-floor-wood)",
    borderLeftWidth: "2.5px",
    borderLeftStyle: "solid",
    borderLeftColor: "var(--orbit-wall-outer)",
    borderRightWidth: "2.5px",
    borderRightStyle: "solid",
    borderRightColor: "var(--orbit-wall-outer)",
    pointerEvents: "none",
  },
  doorwayTop: {
    position: "absolute",
    top: "-4px",
    left: "50%",
    transform: "translateX(-50%)",
    width: "54px",
    height: "7px",
    backgroundColor: "var(--orbit-floor-wood)",
    borderLeftWidth: "2.5px",
    borderLeftStyle: "solid",
    borderLeftColor: "var(--orbit-wall-outer)",
    borderRightWidth: "2.5px",
    borderRightStyle: "solid",
    borderRightColor: "var(--orbit-wall-outer)",
    pointerEvents: "none",
  },
  execDeskCluster: {
    display: "flex",
    alignItems: "flex-end",
    gap: "12px",
    flexWrap: "wrap",
    minWidth: 0,
  },
  directorSeat: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
  },
  visitorsCluster: {
    display: "flex",
    alignItems: "flex-end",
    gap: "10px",
    flexWrap: "wrap",
    flexGrow: 1,
    justifyContent: "flex-end",
    minWidth: 0,
  },
  pantryPeople: {
    display: "flex",
    alignItems: "flex-end",
    gap: "10px",
    flexWrap: "wrap",
    flexGrow: 1,
    justifyContent: "center",
    minWidth: 0,
  },
  npcFloorBtn: {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    paddingTop: "4px",
    paddingRight: "6px",
    paddingBottom: "4px",
    paddingLeft: "6px",
    borderRadius: "10px",
    ...shorthands.border("1.5px", "solid", "transparent"),
    backgroundColor: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    color: tokens.colorNeutralForeground1,
    transitionProperty: "transform, background-color, border-color",
    transitionDuration: "140ms",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      ...shorthands.borderColor(tokens.colorBrandStroke1),
      transform: "translateY(-2px)",
    },
    ":focus-visible": {
      ...shorthands.outline("2px", "solid", tokens.colorStrokeFocus2),
      outlineOffset: "2px",
    },
  },
  npcSelected: {
    backgroundColor: tokens.colorBrandBackground2,
    ...shorthands.borderColor(tokens.colorBrandStroke1),
  },
  roamA: {
    animationName: "orbit-roam-a",
    animationDuration: "6.5s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
  },
  roamB: {
    animationName: "orbit-roam-b",
    animationDuration: "7.5s",
    animationIterationCount: "infinite",
    animationTimingFunction: "ease-in-out",
  },
  hallway: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    paddingTop: "4px",
    paddingRight: "14px",
    paddingBottom: "4px",
    paddingLeft: "14px",
    borderRadius: "10px",
    backgroundColor: "rgba(255, 255, 255, 0.24)",
    ...shorthands.border("1px", "dashed", "var(--orbit-wall-inner)"),
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground2,
    minWidth: 0,
  },
  departmentsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 310px), 1fr))",
    gap: "14px",
    minWidth: 0,
  },
  deptRoom: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    paddingTop: "14px",
    paddingRight: "14px",
    paddingBottom: "14px",
    paddingLeft: "14px",
    borderRadius: "16px",
    ...shorthands.border("2.5px", "solid", "var(--orbit-wall-outer)"),
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "inset 0 0 0 2px var(--orbit-wall-inner)",
    minWidth: 0,
  },
  countPill: {
    paddingTop: "1px",
    paddingRight: "7px",
    paddingBottom: "1px",
    paddingLeft: "7px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
  emptyFloor: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    flexWrap: "wrap",
    paddingTop: "12px",
    paddingRight: "12px",
    paddingBottom: "12px",
    paddingLeft: "12px",
    borderRadius: "12px",
    minWidth: 0,
  },
  desksGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 275px), 1fr))",
    gap: "12px",
    minWidth: 0,
  },
  deskArticle: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "12px",
    paddingLeft: "12px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    minWidth: 0,
  },
  deskStageBtn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    paddingTop: "8px",
    paddingRight: "8px",
    paddingBottom: "8px",
    paddingLeft: "8px",
    borderRadius: "10px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1.5px", "solid", tokens.colorNeutralStroke2),
    cursor: "pointer",
    fontFamily: "inherit",
    color: tokens.colorNeutralForeground1,
    width: "100%",
    transitionProperty: "border-color, box-shadow",
    transitionDuration: "140ms",
    ":hover": {
      ...shorthands.borderColor(tokens.colorBrandStroke1),
      boxShadow: tokens.shadow4,
    },
    ":focus-visible": {
      ...shorthands.outline("2px", "solid", tokens.colorStrokeFocus2),
      outlineOffset: "2px",
    },
  },
  deskStageSelected: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    backgroundColor: tokens.colorBrandBackground2,
  },
  empNameBtn: {
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: 0,
    paddingBottom: 0,
    minWidth: 0,
    minHeight: "auto",
    justifyContent: "flex-start",
    fontWeight: 600,
    fontSize: tokens.fontSizeBase300,
    textAlign: "left",
    overflowWrap: "anywhere",
    height: "auto",
  },
  holdingBox: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    paddingTop: "7px",
    paddingRight: "10px",
    paddingBottom: "7px",
    paddingLeft: "10px",
    borderRadius: "9px",
    backgroundColor: "var(--orbit-card-bg)",
    borderTopWidth: "1px",
    borderRightWidth: "1px",
    borderBottomWidth: "1px",
    borderLeftWidth: "3px",
    ...shorthands.borderStyle("solid"),
    borderTopColor: tokens.colorNeutralStroke2,
    borderRightColor: tokens.colorNeutralStroke2,
    borderBottomColor: tokens.colorNeutralStroke2,
    borderLeftColor: tokens.colorBrandStroke1,
    minWidth: 0,
  },
  dialoguePanel: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "16px",
    flexWrap: "wrap",
    paddingTop: "12px",
    paddingRight: "16px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    borderRadius: "14px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("2px", "solid", tokens.colorBrandStroke1),
    boxShadow: tokens.shadow16,
    minWidth: 0,
  },
  dialogueLeft: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexGrow: 1,
    flexBasis: "340px",
    minWidth: 0,
  },
  portraitFrame: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "62px",
    height: "62px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-rug-pantry)",
    ...shorthands.border("1.5px", "solid", "var(--orbit-wall-outer)"),
    flexShrink: 0,
  },
  dialogueActions: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    flexShrink: 0,
  },
  keyCap: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "17px",
    height: "17px",
    borderRadius: "9999px",
    fontSize: "10px",
    fontWeight: 800,
    lineHeight: 1,
    flexShrink: 0,
  },
  keyPrimary: { backgroundColor: "rgba(255, 255, 255, 0.24)", color: "#ffffff" },
  keySecondary: { backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground2 },
  muted: { color: tokens.colorNeutralForeground3 },
});

function dotColorOf(label: WorkLabel): string {
  const k = presenceKindOf(label);
  if (k === "working") return "#6366f1";
  if (k === "ready") return "#16a34a";
  if (k === "waiting") return "#f59e0b";
  if (k === "offline") return "#ef4444";
  return "#9ca3af";
}

export function OfficeFloorMap({
  groups,
  filter,
  account,
  onAssign,
  onOpenEmployee,
  onOpenMission,
  onEditDepartment,
}: {
  groups: FloorGroup[];
  filter: string;
  account: AuthAccount | null;
  onAssign: (employeeId: string) => void;
  onOpenEmployee: (employeeId: string) => void;
  onOpenMission: (missionId: string) => void;
  onEditDepartment: (edit: DepartmentEdit) => void;
}) {
  const s = useStyles();
  const o = useOfficeStyles();
  const restore = useRestoreFocusTarget();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const allEmployees = groups.flatMap((g) => g.employees);
  const selected = allEmployees.find((e) => e.id === selectedId) ?? null;

  const directorName = account?.fullName?.trim() || "You";
  const waitingVisitors = allEmployees.filter((e) => presenceKindOf(e.workLabel) === "waiting");
  const pantryGuests = allEmployees.filter((e) => e.workLabel === "ready" || e.workLabel === "paused");
  const deskWorkers = allEmployees.filter((e) => e.workLabel === "working");

  return (
    <div className={s.building}>
      {/* Compact Company Floor HUD */}
      <div className={s.topHud}>
        <div className={s.hudLeft}>
          <IconBadge icon={<OfficeIcon size={15} active />} tone="brand" size="sm" />
          <Text weight="semibold" size={300}>
            Company floor
          </Text>
          <span className={s.hudPillGroup} aria-hidden>
            <span className={s.hudStat}>
              <span className={s.dot} style={{ backgroundColor: "#16a34a" }} />
              {pantryGuests.length} in Pantry
            </span>
            <span className={s.hudStat}>
              <span className={s.dot} style={{ backgroundColor: "#6366f1" }} />
              {deskWorkers.length} at desk
            </span>
            <span className={s.hudStat}>
              <span className={s.dot} style={{ backgroundColor: "#f59e0b" }} />
              {waitingVisitors.length} at Director&apos;s Office
            </span>
          </span>
        </div>
        <Text size={100} className={s.muted} aria-hidden>
          Click any teammate to chat or hand over a brief
        </Text>
      </div>

      {/* Top Wing: Director's Office (Executive Chair & Ask Opinions) + Pantry & Chill Lounge */}
      <div className={s.topWing}>
        <div className={s.execRoom} aria-label="Director's Office">
          <div className={s.roomTitleBar} aria-hidden>
            <span className={s.roomTag}>
              <span className={s.dot} style={{ backgroundColor: "#3b82f6" }} />
              <span>Director&apos;s Office</span>
            </span>
            <Text size={100} className={s.muted}>
              {waitingVisitors.length > 0 ? `${waitingVisitors.length} asking opinion` : "Ask opinion & review"}
            </Text>
          </div>
          <div className={s.execCarpet}>
            <div className={s.execDeskCluster}>
              <PixelBookshelfSvg />
              <div className={s.directorSeat}>
                <div style={{ marginBottom: "-10px" }} aria-hidden>
                  <PixelChibiSvg name={directorName} workLabel="ready" activity="director" size={38} />
                </div>
                <PixelDirectorDeskSvg />
                <GatherNamePill name={directorName} dotColor="#3b82f6" suffix="Director" />
              </div>
            </div>
            <div className={s.visitorsCluster}>
              {waitingVisitors.length > 0 ? (
                waitingVisitors.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    className={mergeClasses(s.npcFloorBtn, selected?.id === v.id && s.npcSelected)}
                    aria-label={`Greet ${v.name} at Director's desk`}
                    title={`${v.name} — ${v.holding ? v.holding.title : deskMoodText(v.workLabel)}`}
                    onClick={() => setSelectedId((cur) => (cur === v.id ? null : v.id))}
                  >
                    <PixelQuestBubble workLabel={v.workLabel} title={v.holding?.title ?? null} />
                    <PixelChibiSvg name={v.name} workLabel={v.workLabel} activity="asking" size={38} />
                    <GatherNamePill name={v.name} dotColor="#f59e0b" />
                  </button>
                ))
              ) : (
                <Text size={100} className={s.muted} aria-hidden>
                  Teammates walk here when they need your input.
                </Text>
              )}
            </div>
          </div>
          <span className={s.doorwayBottom} aria-hidden />
        </div>

        <div className={s.execRoom} aria-label="Pantry Lounge">
          <div className={s.roomTitleBar} aria-hidden>
            <span className={s.roomTag}>
              <span className={s.dot} style={{ backgroundColor: "#16a34a" }} />
              <span>Pantry &amp; Lounge</span>
            </span>
            <Text size={100} className={s.muted}>
              {pantryGuests.length > 0 ? `${pantryGuests.length} resting` : "Coffee & break area"}
            </Text>
          </div>
          <div className={s.pantryCarpet}>
            <PixelPantryLoungeSvg />
            <div className={s.pantryPeople}>
              {pantryGuests.length > 0 ? (
                pantryGuests.map((g, idx) => (
                  <div key={g.id} className={g.workLabel === "ready" ? (idx % 2 === 0 ? s.roamA : s.roamB) : undefined}>
                    <button
                      type="button"
                      className={mergeClasses(s.npcFloorBtn, selected?.id === g.id && s.npcSelected)}
                      aria-label={`Greet ${g.name} in Pantry`}
                      title={`${g.name} is taking a coffee break in the Pantry — click to talk & assign work`}
                      onClick={() => setSelectedId((cur) => (cur === g.id ? null : g.id))}
                    >
                      <PixelChibiSvg name={g.name} workLabel={g.workLabel} activity="coffee" size={36} />
                      <GatherNamePill name={g.name} dotColor={g.workLabel === "ready" ? "#16a34a" : "#9ca3af"} iconText="☕" />
                    </button>
                  </div>
                ))
              ) : (
                <Text size={100} className={s.muted} aria-hidden>
                  Coffee is fresh — teammates relax here when free.
                </Text>
              )}
            </div>
          </div>
          <span className={s.doorwayBottom} aria-hidden />
        </div>
      </div>

      {/* Central Hardwood Hallway connecting all rooms */}
      <div className={s.hallway} aria-hidden>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
          <PixelPlantSvg variant="green" />
          <span>← Director&apos;s Office · Main Company Hallway · Pantry →</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
          <span>Departments ↓</span>
          <PixelPlantSvg variant="autumn" />
        </span>
      </div>

      {/* Bottom Wing: Integrated Partitioned Department Rooms (replacing the redundant list below) */}
      <div className={s.departmentsGrid}>
        {groups.map((g) => {
          const roomName = g.department?.name ?? "Unassigned";
          const accent = roomAccentFor(roomName);
          return (
            <section key={g.department?.id ?? "unassigned"} className={s.deptRoom} aria-label={roomName}>
              <span className={s.doorwayTop} aria-hidden />
              <div className={s.roomTitleBar}>
                <div className={o.row}>
                  <span className={s.dot} style={{ backgroundColor: accent.dot }} aria-hidden />
                  <Text as="h3" weight="semibold" size={300}>
                    {roomName}
                  </Text>
                  <Text size={200} className={mergeClasses(s.muted, s.countPill)}>
                    ({g.department ? `${g.department.members} ${g.department.members === 1 ? "member" : "members"}` : `${g.employees.length} shown`})
                  </Text>
                </div>
                {g.department && (
                  <Menu>
                    <MenuTrigger disableButtonEnhancement>
                      <Button className={o.touch} appearance="subtle" size="small" icon={<MoreHorizontal16Regular />} aria-label={`Actions for ${g.department.name}`} />
                    </MenuTrigger>
                    <MenuPopover>
                      <MenuList>
                        <MenuItem onClick={() => g.department && onEditDepartment({ kind: "rename", department: g.department })}>Rename</MenuItem>
                        <MenuItem onClick={() => g.department && onEditDepartment({ kind: "archive", department: g.department })}>Archive</MenuItem>
                      </MenuList>
                    </MenuPopover>
                  </Menu>
                )}
              </div>

              {g.employees.length === 0 ? (
                <div className={s.emptyFloor} style={{ backgroundColor: accent.tint }}>
                  <PixelEmptyDeskClusterSvg />
                  <Text size={200} className={s.muted}>
                    No employee here{filter === "all" ? " yet" : " matches"}.
                  </Text>
                </div>
              ) : (
                <div className={s.desksGrid} style={{ padding: "8px", borderRadius: "12px", backgroundColor: accent.tint }}>
                  {g.employees.map((e) => {
                    const kind = presenceKindOf(e.workLabel);
                    const isSelected = selected?.id === e.id;
                    const deskActivity = e.workLabel === "ready" ? "pen-spin" : kind === "working" ? "typing" : kind === "waiting" ? "asking" : "default";
                    return (
                      <article key={e.id} className={s.deskArticle} aria-label={e.name}>
                        <button
                          type="button"
                          className={mergeClasses(s.deskStageBtn, isSelected && s.deskStageSelected)}
                          aria-label={`Talk to ${e.name} at ${roomName} desk`}
                          title={`${e.name} — ${e.holding ? e.holding.title : deskMoodText(e.workLabel)}`}
                          onClick={() => setSelectedId((cur) => (cur === e.id ? null : e.id))}
                        >
                          <PixelQuestBubble workLabel={e.workLabel} title={e.holding?.title ?? null} />
                          <div style={{ marginBottom: "-8px" }}>
                            <PixelChibiSvg name={e.name} workLabel={e.workLabel} activity={deskActivity} size={42} />
                          </div>
                          <PixelModernDeskSvg workLabel={e.workLabel} occupied penSpinning={e.workLabel === "ready"} />
                          <GatherNamePill
                            name={e.name}
                            dotColor={dotColorOf(e.workLabel)}
                            iconText={e.workLabel === "ready" ? "✏️" : kind === "waiting" ? "↑" : undefined}
                          />
                        </button>

                        <div className={o.between}>
                          <Button className={s.empNameBtn} appearance="transparent" onClick={() => onOpenEmployee(e.id)}>
                            {e.name}
                          </Button>
                          <WorkLabelBadge label={e.workLabel} />
                        </div>

                        <Text size={200} className={mergeClasses(s.muted, o.wrap)}>
                          {e.title}
                          {e.kind === "assistant" ? ` · temporary assistant${e.expiresAt ? ` until ${when(e.expiresAt)}` : ""}` : ""}
                        </Text>

                        {e.holding && (
                          <div className={s.holdingBox}>
                            <Text size={200} className={o.wrap}>
                              Holding:{" "}
                              <Link as="button" onClick={() => onOpenMission(e.holding?.missionId ?? "")}>
                                {e.holding.title}
                              </Link>{" "}
                              <span className={s.muted}>since {when(e.holding.since)}</span>
                            </Text>
                            {e.queued > 0 && (
                              <Text size={200} className={s.muted}>
                                {e.queued} queued behind it
                              </Text>
                            )}
                          </div>
                        )}
                        {!e.holding && e.queued > 0 && (
                          <Text size={200} className={s.muted}>
                            {e.queued} queued behind it
                          </Text>
                        )}
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

                        <div className={o.divider} />
                        <div className={o.between}>
                          <Text size={200} className={s.muted}>
                            Updated {when(e.updatedAt)}
                          </Text>
                          <Button
                            className={o.touch}
                            size="small"
                            appearance={e.workLabel === "ready" ? "primary" : "secondary"}
                            icon={<TaskListLtr20Regular />}
                            disabled={e.employment === "archived"}
                            onClick={() => onAssign(e.id)}
                            aria-label={`Assign work to ${e.name}`}
                            {...restore}
                          >
                            Assign work
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {/* Interactive Switch-Style NPC Desk Dialogue Bar */}
      {selected && (
        <div className={s.dialoguePanel} role="region" aria-label={`Desk chat with ${selected.name}`}>
          <div className={s.dialogueLeft}>
            <div className={s.portraitFrame}>
              <PixelChibiSvg
                name={selected.name}
                workLabel={selected.workLabel}
                activity={presenceKindOf(selected.workLabel) === "waiting" ? "asking" : selected.workLabel === "ready" ? "coffee" : "typing"}
                size={48}
              />
            </div>
            <div className={o.stack}>
              <div className={o.row}>
                <Text weight="semibold" size={400}>
                  {selected.name}
                </Text>
                <Text size={200} className={s.muted}>
                  {selected.title}
                </Text>
                <span aria-hidden>
                  <WorkLabelBadge label={selected.workLabel} />
                </span>
              </div>
              <Text size={300}>{dialogueSpeech(selected)}</Text>
            </div>
          </div>

          <div className={s.dialogueActions}>
            <Button
              type="button"
              appearance="primary"
              icon={<TaskListLtr20Regular />}
              disabled={selected.employment === "archived"}
              onClick={() => {
                const id = selected.id;
                setSelectedId(null);
                onAssign(id);
              }}
            >
              <span className={mergeClasses(s.keyCap, s.keyPrimary)} style={{ marginRight: "6px" }} aria-hidden>
                A
              </span>
              Assign work
            </Button>
            {selected.holding && (
              <Button
                type="button"
                appearance="secondary"
                onClick={() => {
                  const mid = selected.holding?.missionId;
                  setSelectedId(null);
                  if (mid) onOpenMission(mid);
                }}
              >
                <span className={mergeClasses(s.keyCap, s.keySecondary)} style={{ marginRight: "6px" }} aria-hidden>
                  B
                </span>
                Open current work
              </Button>
            )}
            <Button
              type="button"
              appearance="secondary"
              onClick={() => {
                const id = selected.id;
                setSelectedId(null);
                onOpenEmployee(id);
              }}
            >
              <span className={mergeClasses(s.keyCap, s.keySecondary)} style={{ marginRight: "6px" }} aria-hidden>
                Y
              </span>
              Desk profile
            </Button>
            <Button type="button" appearance="subtle" size="small" icon={<Dismiss16Regular />} aria-label="Close desk dialogue" onClick={() => setSelectedId(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
