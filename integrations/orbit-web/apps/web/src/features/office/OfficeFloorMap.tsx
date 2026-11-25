// GATHER-STYLE REAL-TIME COMPANY OFFICE FLOOR: one physical walker per employee moving smoothly with directional
// facing & 2-frame walking stride along real doorway/hallway routes between their desk, Pantry lounge, and Director's Office.
// Each department's room says who manages it (or that nobody does); its menu appoints, replaces, suspends, reinstates or
// revokes that manager -- the company's authority, as Leadership changes it -- beside renaming and archiving the room.
import { Badge, Button, Link, MenuItem, Text, makeStyles, mergeClasses, shorthands, tokens, useRestoreFocusTarget } from "@fluentui/react-components";
import {
  Chat16Regular,
  Dismiss16Regular,
  ErrorCircle16Regular,
  Eye16Regular,
  FolderOpen16Regular,
  Location16Regular,
  Pause16Regular,
  Person16Regular,
  Play16Regular,
  TaskListLtr20Regular,
  Warning16Regular,
} from "@fluentui/react-icons";
import { RUNTIME_LABELS, type AppointmentSummary, type AuthAccount, type Department, type EmployeeCard, type WorkLabel } from "@orbit-web/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconBadge, OfficeIcon } from "../../components/SectionIcons";
import { hrefOf } from "../../hooks/useHashRoute";
import { useI18n } from "../../i18n";
import { AppointmentDialog, AppointmentHolder, AppointmentMenu, type AppointmentEdit } from "./AppointmentDialogs";
import type { DepartmentEdit } from "./DepartmentDialogs";
import { createWalker, resnapIdleWalkers, stepWalkers, type SimEmployee, type WalkerState, type WaypointMap } from "./officeSim";
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
import { EmployeeDeskScene, presenceKindOf } from "./VirtualDesk";

interface FloorGroup {
  department: Department | null;
  employees: EmployeeCard[];
}

export const ROOM_ACCENTS = [
  { dot: "#5b58d4", tint: "rgba(91, 88, 212, 0.045)", border: "rgba(91, 88, 212, 0.16)" },
  { dot: "#0d9488", tint: "rgba(13, 148, 136, 0.045)", border: "rgba(13, 148, 136, 0.16)" },
  { dot: "#d97706", tint: "rgba(217, 119, 6, 0.045)", border: "rgba(217, 119, 6, 0.16)" },
  { dot: "#9333ea", tint: "rgba(147, 51, 234, 0.045)", border: "rgba(147, 51, 234, 0.16)" },
  { dot: "#2563eb", tint: "rgba(37, 99, 235, 0.045)", border: "rgba(37, 99, 235, 0.16)" },
] as const;

export function roomAccentFor(label: string) {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  return ROOM_ACCENTS[h % ROOM_ACCENTS.length]!;
}

function measureWaypoints(root: HTMLElement): WaypointMap {
  const base = root.getBoundingClientRect();
  const map: WaypointMap = {};
  root.querySelectorAll<HTMLElement>("[data-wp]").forEach((el) => {
    const key = el.dataset.wp;
    if (!key) return;
    const r = el.getBoundingClientRect();
    map[key] = {
      x: r.left + r.width / 2 - base.left,
      y: r.top + r.height / 2 - base.top,
    };
  });
  return map;
}

function dotColorOf(label: WorkLabel): string {
  const k = presenceKindOf(label);
  if (k === "working") return "#6366f1";
  if (k === "ready") return "#16a34a";
  if (k === "waiting") return "#f59e0b";
  if (k === "offline") return "#ef4444";
  return "#9ca3af";
}

function runtimeSummaryOf(e: EmployeeCard): string {
  const runtime = RUNTIME_LABELS[e.execution.runtime];
  const model = e.execution.model?.trim();
  return model ? `${runtime} · ${model}` : runtime;
}

const useStyles = makeStyles({
  building: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    paddingTop: "14px",
    paddingRight: "16px",
    paddingBottom: "16px",
    paddingLeft: "16px",
    borderRadius: "22px",
    ...shorthands.border("1.5px", "solid", "var(--orbit-wall-outer)"),
    backgroundColor: "var(--orbit-floor-wood)",
    backgroundImage:
      "radial-gradient(circle at 20% 0%, var(--orbit-floor-sheen) 0%, transparent 52%), repeating-linear-gradient(180deg, transparent 0px, transparent 31px, var(--orbit-floor-plank) 31px, var(--orbit-floor-plank) 32px), repeating-linear-gradient(90deg, transparent 0px, transparent 95px, var(--orbit-floor-plank) 95px, var(--orbit-floor-plank) 96px)",
    boxShadow: "var(--orbit-soft-shadow)",
    minWidth: 0,
    "@media (max-width: 639px)": {
      paddingTop: "10px",
      paddingRight: "10px",
      paddingBottom: "12px",
      paddingLeft: "10px",
      borderRadius: "18px",
    },
  },
  topHud: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    paddingTop: "7px",
    paddingRight: "12px",
    paddingBottom: "7px",
    paddingLeft: "12px",
    borderRadius: "14px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    boxShadow: "0 1px 2px rgba(28, 25, 23, 0.03)",
    minWidth: 0,
  },
  hudLeft: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    minWidth: 0,
  },
  hudRight: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
    minWidth: 0,
  },
  hudHintText: {
    color: tokens.colorNeutralForeground3,
    "@media (max-width: 1120px)": { display: "none" },
  },
  liveChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    paddingTop: "2px",
    paddingRight: "8px",
    paddingBottom: "2px",
    paddingLeft: "7px",
    borderRadius: "9999px",
    backgroundColor: "rgba(22, 163, 74, 0.1)",
    color: tokens.colorPaletteGreenForeground1,
    fontSize: "11px",
    fontWeight: 600,
    lineHeight: 1.3,
  },
  liveChipPaused: {
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground3,
  },
  livePulse: {
    width: "6px",
    height: "6px",
    borderRadius: "9999px",
    backgroundColor: "#16a34a",
    animationName: "orbit-pulse",
    animationDuration: "1.8s",
    animationIterationCount: "infinite",
  },
  livePulsePaused: {
    backgroundColor: tokens.colorNeutralForeground3,
    animationName: "none",
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
    position: "relative",
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.2fr) minmax(0, 1fr)",
    alignItems: "stretch",
    gap: "12px",
    minWidth: 0,
    "@media (max-width: 760px)": { gridTemplateColumns: "1fr" },
  },
  topWingEmptyPantry: {
    gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)",
    "@media (max-width: 760px)": { gridTemplateColumns: "1fr" },
  },
  execRoom: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    height: "100%",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "14px",
    paddingLeft: "14px",
    borderRadius: "16px",
    ...shorthands.border("1.5px", "solid", "var(--orbit-wall-outer)"),
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "var(--orbit-floor-room-shadow)",
    minWidth: 0,
  },
  roomAccentLine: {
    position: "absolute",
    top: 0,
    left: "18px",
    right: "18px",
    height: "3px",
    borderBottomLeftRadius: "9999px",
    borderBottomRightRadius: "9999px",
    opacity: 0.72,
    pointerEvents: "none",
  },
  execCarpet: {
    display: "grid",
    gridTemplateColumns: "minmax(208px, 1.25fr) minmax(136px, 1fr)",
    flexGrow: 1,
    alignItems: "stretch",
    columnGap: "12px",
    rowGap: "12px",
    paddingTop: "12px",
    paddingRight: "12px",
    paddingBottom: "12px",
    paddingLeft: "12px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-rug-exec)",
    ...shorthands.border("1px", "solid", "var(--orbit-rug-exec-border)"),
    minHeight: "108px",
    minWidth: 0,
    "@media (max-width: 600px)": { gridTemplateColumns: "1fr" },
  },
  directorRight: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    flexShrink: 0,
  },
  pantryCarpet: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "10px",
    paddingLeft: "14px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-rug-pantry)",
    ...shorthands.border("1px", "solid", "var(--orbit-rug-pantry-border)"),
    minHeight: "108px",
    minWidth: 0,
  },
  pantryAnchorsZone: {
    position: "relative",
    width: "100%",
    minHeight: "48px",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
    paddingTop: "14px",
  },
  visitorsCluster: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "6px",
    minWidth: 0,
    minHeight: "96px",
    paddingTop: "10px",
    paddingRight: "10px",
    paddingBottom: "10px",
    paddingLeft: "10px",
    borderRadius: "10px",
    ...shorthands.border("1px", "dashed", "var(--orbit-rug-exec-border)"),
    backgroundColor: "var(--orbit-lounge-panel)",
  },
  visitorHeaderRow: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: "6px",
    width: "100%",
  },
  visitorWaypointsRow: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-around",
    width: "100%",
    flexGrow: 1,
    minHeight: "44px",
  },
  visitorZoneTag: {
    fontSize: "10px",
    fontWeight: 600,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    color: tokens.colorNeutralForeground3,
    alignSelf: "flex-start",
  },
  roomTitleBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    flexWrap: "wrap",
    minWidth: 0,
  },
  deptTitleBar: { marginBottom: "2px", alignItems: "flex-start" },
  roomHead: { display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: "10px", rowGap: "2px", flexGrow: 1, flexBasis: 0, minWidth: "min(100%, 160px)" },
  deptHead: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "3px", flexGrow: 1, flexBasis: 0, minWidth: "min(100%, 160px)" },
  deptNameRow: { display: "flex", alignItems: "center", gap: "8px", minWidth: 0, maxWidth: "100%", flexWrap: "nowrap" },
  deptNameText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  roomTag: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    paddingTop: "2px",
    paddingRight: "9px",
    paddingBottom: "2px",
    paddingLeft: "8px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    fontSize: tokens.fontSizeBase200,
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
  },
  doorwayBottom: {
    position: "absolute",
    bottom: "-3px",
    left: "50%",
    transform: "translateX(-50%)",
    width: "52px",
    height: "6px",
    borderRadius: "2px",
    backgroundColor: "var(--orbit-floor-wood)",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: "var(--orbit-wall-outer)",
    borderRightWidth: "2px",
    borderRightStyle: "solid",
    borderRightColor: "var(--orbit-wall-outer)",
    pointerEvents: "none",
  },
  doorwayTop: {
    position: "absolute",
    top: "-3px",
    left: "50%",
    transform: "translateX(-50%)",
    width: "52px",
    height: "6px",
    borderRadius: "2px",
    backgroundColor: "var(--orbit-floor-wood)",
    borderLeftWidth: "2px",
    borderLeftStyle: "solid",
    borderLeftColor: "var(--orbit-wall-outer)",
    borderRightWidth: "2px",
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
  bookshelfSlot: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: "4px",
    "@media (max-width: 480px)": { display: "none" },
  },
  directorSeat: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "4px",
  },
  hallway: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    paddingTop: "5px",
    paddingRight: "14px",
    paddingBottom: "5px",
    paddingLeft: "14px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-hallway-bg)",
    ...shorthands.border("1px", "solid", "var(--orbit-wall-inner)"),
    fontSize: "11px",
    color: tokens.colorNeutralForeground2,
    minWidth: 0,
  },
  wayfindCluster: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  wayfindPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    paddingTop: "2px",
    paddingRight: "8px",
    paddingBottom: "2px",
    paddingLeft: "8px",
    borderRadius: "9999px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    fontSize: "10.5px",
    fontWeight: 500,
    color: tokens.colorNeutralForeground2,
  },
  anchorDot: {
    position: "relative",
    width: "2px",
    height: "2px",
    pointerEvents: "none",
  },
  departmentsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    rowGap: "18px",
    columnGap: "14px",
    minWidth: 0,
    "@media (max-width: 760px)": { gridTemplateColumns: "1fr" },
  },
  departmentsGridSingle: {
    gridTemplateColumns: "1fr",
  },
  deptRoom: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    paddingTop: "13px",
    paddingRight: "14px",
    paddingBottom: "14px",
    paddingLeft: "14px",
    borderRadius: "16px",
    ...shorthands.border("1.5px", "solid", "var(--orbit-wall-outer)"),
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "var(--orbit-floor-room-shadow)",
    minWidth: 0,
  },
  countPill: {
    paddingTop: "1px",
    paddingRight: "8px",
    paddingBottom: "1px",
    paddingLeft: "8px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    fontSize: "11px",
  },
  emptyFloor: {
    display: "flex",
    alignItems: "center",
    gap: "14px",
    flexWrap: "wrap",
    paddingTop: "14px",
    paddingRight: "14px",
    paddingBottom: "14px",
    paddingLeft: "14px",
    borderRadius: "12px",
    minWidth: 0,
  },
  desksGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(204px, 240px))",
    rowGap: "18px",
    columnGap: "14px",
    justifyContent: "flex-start",
    paddingTop: "14px",
    paddingRight: "14px",
    paddingBottom: "14px",
    paddingLeft: "14px",
    borderRadius: "12px",
    minWidth: 0,
    "@media (max-width: 520px)": { gridTemplateColumns: "repeat(auto-fill, minmax(168px, 1fr))" },
  },
  deskArticle: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    paddingTop: "10px",
    paddingRight: "11px",
    paddingBottom: "10px",
    paddingLeft: "11px",
    borderRadius: "14px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    boxShadow: "0 1px 2px rgba(28, 25, 23, 0.04), 0 4px 10px -4px rgba(28, 25, 23, 0.06)",
    transitionProperty: "border-color, box-shadow, transform",
    transitionDuration: "160ms",
    transitionTimingFunction: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    minWidth: 0,
    ":hover": {
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
      boxShadow: "0 4px 14px -4px rgba(28, 25, 23, 0.12)",
    },
  },
  deskArticleSelected: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    boxShadow: `0 0 0 2px ${tokens.colorBrandBackground2}, 0 6px 18px -6px rgba(91, 88, 212, 0.28)`,
  },
  ceoArticle: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    ...shorthands.borderColor(tokens.colorBrandStroke2),
  },
  deskStatusHairline: {
    position: "absolute",
    top: 0,
    left: "16px",
    right: "16px",
    height: "2.5px",
    borderBottomLeftRadius: "9999px",
    borderBottomRightRadius: "9999px",
    opacity: 0.85,
    pointerEvents: "none",
  },
  deskStage: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "100%",
    paddingTop: "4px",
    paddingRight: "6px",
    paddingBottom: "4px",
    paddingLeft: "6px",
    borderRadius: "10px",
    backgroundColor: "var(--orbit-desk-bay)",
  },
  staticAvatarBtn: {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    ...shorthands.border("0", "none", "transparent"),
    backgroundColor: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    color: tokens.colorNeutralForeground1,
    transitionProperty: "filter",
    transitionDuration: "140ms",
    ":hover": {
      filter: "drop-shadow(0 4px 8px rgba(0, 0, 0, 0.22))",
    },
    ":focus-visible": {
      ...shorthands.outline("2px", "solid", tokens.colorStrokeFocus2),
      outlineOffset: "2px",
      borderRadius: "8px",
    },
    ":disabled": {
      cursor: "default",
      opacity: 0.7,
    },
  },
  deskStageBtn: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    paddingTop: "4px",
    paddingRight: "4px",
    paddingBottom: "4px",
    paddingLeft: "4px",
    borderRadius: "8px",
    backgroundColor: "transparent",
    ...shorthands.border("1px", "solid", "transparent"),
    cursor: "pointer",
    fontFamily: "inherit",
    color: tokens.colorNeutralForeground1,
    width: "100%",
    transitionProperty: "background-color, border-color",
    transitionDuration: "140ms",
    ":hover": {
      backgroundColor: "rgba(91, 88, 212, 0.08)",
      ...shorthands.borderColor(tokens.colorBrandStroke2),
    },
    ":focus-visible": {
      ...shorthands.outline("2px", "solid", tokens.colorStrokeFocus2),
      outlineOffset: "2px",
    },
  },
  chairAnchorWrap: {
    position: "relative",
    width: "100%",
    height: "68px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  awayNote: {
    fontSize: "10px",
    fontWeight: 500,
    color: tokens.colorNeutralForeground2,
    paddingTop: "2px",
    paddingRight: "8px",
    paddingBottom: "2px",
    paddingLeft: "8px",
    borderRadius: "9999px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    marginBottom: "6px",
  },
  deskMetaBlock: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    width: "100%",
    minWidth: 0,
  },
  deskNameRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "6px",
    width: "100%",
    minWidth: 0,
  },
  deskSubtitle: {
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    minWidth: 0,
  },
  deskActionsRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "6px",
    width: "100%",
    paddingTop: "6px",
    ...shorthands.borderTop("1px", "solid", tokens.colorNeutralStroke2),
  },
  deskAssignBtn: {
    flexGrow: 1,
    minWidth: 0,
    borderRadius: "8px",
  },
  walkersLayer: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    pointerEvents: "none",
    zIndex: 12,
    overflow: "hidden",
  },
  walkerBtn: {
    position: "absolute",
    top: 0,
    left: 0,
    pointerEvents: "auto",
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "2px",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    ...shorthands.border("0", "none", "transparent"),
    backgroundColor: "transparent",
    cursor: "pointer",
    fontFamily: "inherit",
    color: tokens.colorNeutralForeground1,
    willChange: "transform",
    transitionProperty: "filter",
    transitionDuration: "140ms",
    ":hover": {
      filter: "drop-shadow(0 4px 10px rgba(0, 0, 0, 0.24))",
    },
    ":focus-visible": {
      ...shorthands.outline("2px", "solid", tokens.colorStrokeFocus2),
      outlineOffset: "3px",
      borderRadius: "8px",
    },
  },
  empNameBtn: {
    paddingLeft: 0,
    paddingRight: 0,
    paddingTop: "1px",
    paddingBottom: "1px",
    minWidth: 0,
    minHeight: "auto",
    justifyContent: "flex-start",
    fontWeight: 600,
    fontSize: tokens.fontSizeBase200,
    textAlign: "left",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    height: "auto",
  },
  holdingBox: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    width: "100%",
    paddingTop: "6px",
    paddingRight: "8px",
    paddingBottom: "6px",
    paddingLeft: "8px",
    borderRadius: "8px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderTopWidth: "1px",
    borderRightWidth: "1px",
    borderBottomWidth: "1px",
    borderLeftWidth: "3px",
    ...shorthands.borderStyle("solid"),
    borderTopColor: tokens.colorNeutralStroke2,
    borderRightColor: tokens.colorNeutralStroke2,
    borderBottomColor: tokens.colorNeutralStroke2,
    borderLeftColor: tokens.colorBrandStroke1,
    fontSize: "10.5px",
    minWidth: 0,
  },
  spotlight: {
    position: "sticky",
    bottom: "10px",
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "14px",
    flexWrap: "wrap",
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
  spotlightMain: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    flexGrow: 1,
    minWidth: "min(100%, 260px)",
  },
  spotlightScene: {
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
  spotlightInfo: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    minWidth: 0,
    flexGrow: 1,
  },
  spotlightMeta: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    flexWrap: "wrap",
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground2,
  },
  spotlightMetaItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
  },
  spotlightActions: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexWrap: "wrap",
    flexShrink: 0,
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

type RestoreProps = ReturnType<typeof useRestoreFocusTarget>;

function EmployeeDeskCard({
  employee: e,
  walker: w,
  measured,
  executive = false,
  selected = false,
  onAssign,
  onOpenEmployee,
  onOpenMission,
  onInspect,
  restore,
}: {
  employee: EmployeeCard;
  walker: WalkerState | undefined;
  measured: boolean;
  executive?: boolean;
  selected?: boolean;
  onAssign: (employeeId: string) => void;
  onOpenEmployee: (employeeId: string) => void;
  onOpenMission: (missionId: string) => void;
  onInspect: (employeeId: string) => void;
  restore: RestoreProps;
}) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const atDeskNow = !measured || (w ? w.zone === "desk" && w.path.length === 0 : true);
  const awayReason = w?.walking
    ? t("office.floor.walkingInOffice")
    : w && w.path.length > 0
      ? t("office.floor.inCorridor")
      : w?.zone === "pantry"
        ? t("office.floor.inPantryNote")
        : w?.zone === "director"
          ? t("office.floor.atDirectorNote")
          : w?.zone === "hallway"
            ? t("office.floor.inCorridor")
            : null;
  const deskArt = executive ? (
    <PixelDirectorDeskSvg />
  ) : (
    <PixelModernDeskSvg workLabel={e.workLabel} occupied={atDeskNow} penSpinning={atDeskNow && e.workLabel === "ready"} />
  );

  return (
    <article
      className={mergeClasses(s.deskArticle, executive && s.ceoArticle, selected && s.deskArticleSelected)}
      aria-label={e.name}
    >
      <span className={s.deskStatusHairline} style={{ backgroundColor: dotColorOf(e.workLabel) }} aria-hidden />
      {!measured ? (
        <div className={s.deskStage}>
          <div className={s.chairAnchorWrap}>
            <span data-wp={`desk-${e.id}`} style={{ position: "absolute", left: "50%", bottom: "-4px", width: 0, height: 0, pointerEvents: "none" }} aria-hidden />
            <button
              type="button"
              className={s.staticAvatarBtn}
              aria-label={t("office.floor.assignWorkTo", { name: e.name })}
              disabled={e.employment === "archived"}
              title={e.employment === "archived" ? t("office.floor.archivedTitle", { name: e.name }) : t("office.floor.assignWorkTo", { name: e.name })}
              onClick={() => onAssign(e.id)}
              {...restore}
            >
              <PixelQuestBubble workLabel={e.workLabel} title={e.holding?.title ?? null} />
              <div style={{ marginBottom: "-8px" }}>
                <PixelChibiSvg
                  name={e.name}
                  workLabel={e.workLabel}
                  activity={e.workLabel === "ready" ? "pen-spin" : e.workLabel === "working" ? "typing" : "asking"}
                  executive={executive}
                  size={38}
                />
              </div>
            </button>
          </div>
          <button
            type="button"
            className={s.deskStageBtn}
            aria-label={t("office.floor.openProfileAria", { name: e.name })}
            title={t("office.floor.openProfileAria", { name: e.name })}
            onClick={() => onOpenEmployee(e.id)}
          >
            {deskArt}
          </button>
        </div>
      ) : (
        <div className={s.deskStage}>
          <div className={s.chairAnchorWrap}>
            <span data-wp={`desk-${e.id}`} style={{ position: "absolute", left: "50%", bottom: "0px", width: 0, height: 0, pointerEvents: "none" }} aria-hidden />
            {!atDeskNow && awayReason && (
              <span className={s.awayNote} aria-hidden>
                {awayReason}
              </span>
            )}
          </div>
          <button
            type="button"
            className={s.deskStageBtn}
            aria-label={t("office.floor.openProfileAria", { name: e.name })}
            title={t("office.floor.openProfileAria", { name: e.name })}
            onClick={() => onOpenEmployee(e.id)}
          >
            {deskArt}
          </button>
        </div>
      )}

      <div className={s.deskMetaBlock}>
        <div className={s.deskNameRow}>
          <Button className={s.empNameBtn} appearance="transparent" title={e.name} onClick={() => onOpenEmployee(e.id)}>
            {e.name}
          </Button>
          <WorkLabelBadge label={e.workLabel} />
        </div>
        <span className={s.deskSubtitle} title={`${e.title} · ${runtimeSummaryOf(e)}`}>
          {e.title} · {runtimeSummaryOf(e)}
        </span>
      </div>

      {e.kind === "assistant" && (
        <Text size={100} className={mergeClasses(s.muted, o.wrap)}>
          {t("office.floor.temporaryAssistant", { until: e.expiresAt ? t("office.floor.until", { when: when(e.expiresAt) }) : "" })}
        </Text>
      )}

      {e.holding && (
        <div className={s.holdingBox}>
          <Text size={100} className={o.wrap}>
            <Link as="button" onClick={() => onOpenMission(e.holding?.missionId ?? "")}>
              {e.holding.title}
            </Link>
          </Text>
          {e.queued > 0 && (
            <Text size={100} className={s.muted}>
              {t("office.floor.queuedBehind", { count: e.queued })}
            </Text>
          )}
        </div>
      )}
      {!e.holding && e.queued > 0 && (
        <Text size={100} className={s.muted}>
          {t("office.floor.queuedBehind", { count: e.queued })}
        </Text>
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

      {measured && (
        <div className={s.deskActionsRow}>
          {e.employment !== "archived" && (
            <Button
              size="small"
              appearance="outline"
              className={s.deskAssignBtn}
              aria-label={t("office.floor.assignWorkTo", { name: e.name })}
              onClick={() => onAssign(e.id)}
              {...restore}
            >
              {t("office.overview.assignWork")}
            </Button>
          )}
          <Button
            size="small"
            appearance={selected ? "primary" : "subtle"}
            icon={<Eye16Regular />}
            aria-label={t("office.floor.inspectAria", { name: e.name })}
            aria-pressed={selected}
            title={t("office.floor.inspectAria", { name: e.name })}
            onClick={() => onInspect(e.id)}
          />
        </div>
      )}
    </article>
  );
}

function TeammateSpotlight({
  employee: e,
  walker: w,
  departmentLabel,
  isCeo,
  isManager,
  onClose,
  onAssign,
  onOpenEmployee,
  onOpenMission,
}: {
  employee: EmployeeCard;
  walker: WalkerState | undefined;
  departmentLabel: string;
  isCeo: boolean;
  isManager: boolean;
  onClose: () => void;
  onAssign: (employeeId: string) => void;
  onOpenEmployee: (employeeId: string) => void;
  onOpenMission: (missionId: string) => void;
}) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();

  const locationText =
    w?.walking || w?.zone === "hallway" || (w && w.path.length > 0)
      ? t("office.floor.locWalking")
      : w?.zone === "pantry"
        ? t("office.floor.locInPantry")
        : w?.zone === "director"
          ? t("office.floor.locAtDirector")
          : t("office.floor.locAtDesk");

  const deskHref = hrefOf({ view: { view: "governance", page: "desks", item: e.id }, settings: null });
  const ceoHref = hrefOf({ view: { view: "ceo", conversationId: null }, settings: null });

  return (
    <aside className={s.spotlight} aria-label={t("office.floor.spotlightAria", { name: e.name })}>
      <div className={s.spotlightMain}>
        <div className={s.spotlightScene} aria-hidden>
          <EmployeeDeskScene name={e.name} workLabel={e.workLabel} compact />
        </div>
        <div className={s.spotlightInfo}>
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
          <Text size={200} className={s.muted}>
            {e.title} · {departmentLabel} · {runtimeSummaryOf(e)}
          </Text>
          <div className={s.spotlightMeta}>
            <span className={s.spotlightMetaItem}>
              <Location16Regular />
              <span>{locationText}</span>
            </span>
            {e.holding ? (
              <span className={s.spotlightMetaItem}>
                <Text size={100} className={s.muted}>
                  {t("office.floor.currentWorkLabel")}:
                </Text>
                <Link as="button" style={{ fontSize: tokens.fontSizeBase100 }} onClick={() => onOpenMission(e.holding?.missionId ?? "")}>
                  {e.holding.title}
                </Link>
              </span>
            ) : (
              <span className={s.spotlightMetaItem}>
                <Text size={100} className={s.muted}>
                  {t("office.floor.currentWorkLabel")}: {t("office.overview.noCurrentWork")}
                </Text>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className={s.spotlightActions}>
        {e.employment !== "archived" && (
          <Button
            size="small"
            appearance="primary"
            icon={<TaskListLtr20Regular />}
            onClick={() => {
              onClose();
              onAssign(e.id);
            }}
          >
            {t("office.overview.assignWork")}
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
          appearance="subtle"
          icon={<Dismiss16Regular />}
          aria-label={t("office.floor.closeInspect")}
          onClick={onClose}
        />
      </div>
    </aside>
  );
}

export function OfficeFloorMap({
  groups,
  ceo = null,
  ceoEmployee = null,
  filter,
  account,
  onAssign,
  onOpenEmployee,
  onOpenMission,
  onEditDepartment,
  onAppointment,
  onRecruit = null,
}: {
  groups: FloorGroup[];
  ceo?: AppointmentSummary | null;
  ceoEmployee?: EmployeeCard | null;
  filter: string;
  account: AuthAccount | null;
  onAssign: (employeeId: string) => void;
  onOpenEmployee: (employeeId: string) => void;
  onOpenMission: (missionId: string) => void;
  onEditDepartment: (edit: DepartmentEdit) => void;
  // A change of a department's manager, when the page holds the dialog itself; without it the floor asks in its own
  // (the change moves the roster, which the page reads again when the office says so).
  onAppointment?: (edit: AppointmentEdit) => void;
  // A hiring request for one department, when the CEO can plan one now (null: not offered).
  onRecruit?: ((departmentId: string) => void) | null;
}) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const restore = useRestoreFocusTarget();
  const [appointing, setAppointing] = useState<AppointmentEdit | null>(null);
  const pickAppointment = onAppointment ?? setAppointing;
  const buildingRef = useRef<HTMLDivElement>(null);
  const wpsRef = useRef<WaypointMap>({});
  const walkersRef = useRef<WalkerState[]>([]);
  const [measured, setMeasured] = useState(false);
  const [buildingWidth, setBuildingWidth] = useState(0);
  const [walkers, setWalkers] = useState<WalkerState[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [motionPaused, setMotionPaused] = useState(false);

  const simItems: SimEmployee[] = useMemo(() => {
    let slot = 0;
    const out: SimEmployee[] = [];
    if (ceoEmployee !== null) {
      out.push({ employee: ceoEmployee, deptKey: "director", visitorSlot: 0 });
    }
    for (const g of groups) {
      const deptKey = g.department?.id ?? "unassigned";
      for (const e of g.employees) {
        if (ceoEmployee !== null && e.id === ceoEmployee.id) continue;
        const isWaiting = presenceKindOf(e.workLabel) === "waiting";
        out.push({ employee: e, deptKey, visitorSlot: isWaiting ? slot++ : 0 });
      }
    }
    return out;
  }, [groups, ceoEmployee]);

  const simItemsRef = useRef(simItems);
  const pausedWalkerIdRef = useRef<string | null>(null);
  const motionPausedRef = useRef(motionPaused);

  useEffect(() => {
    simItemsRef.current = simItems;
  }, [simItems]);

  useEffect(() => {
    pausedWalkerIdRef.current = inspectedId ?? hoveredId;
  }, [inspectedId, hoveredId]);

  useEffect(() => {
    motionPausedRef.current = motionPaused;
  }, [motionPaused]);

  useEffect(() => {
    if (inspectedId === null) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setInspectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspectedId]);

  useEffect(() => {
    const root = buildingRef.current;
    if (!root) return;

    const syncMeasure = () => {
      const rect = root.getBoundingClientRect();
      if (rect.width < 100) {
        setMeasured(false);
        return false;
      }
      const nextWps = measureWaypoints(root);
      wpsRef.current = nextWps;
      if (walkersRef.current.length === 0) {
        walkersRef.current = simItemsRef.current.map((item) => createWalker(item, nextWps));
      } else {
        walkersRef.current = resnapIdleWalkers(stepWalkers(walkersRef.current, simItemsRef.current, nextWps, 0, pausedWalkerIdRef.current), nextWps);
      }
      setWalkers(walkersRef.current);
      setBuildingWidth(rect.width);
      setMeasured(true);
      return true;
    };

    const ok = syncMeasure();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => syncMeasure());
      ro.observe(root);
    }

    const reducedMotion = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!ok || reducedMotion) {
      return () => ro?.disconnect();
    }

    let rafId = 0;
    let lastTs = performance.now();
    let renderAccumMs = 0;

    const tick = (now: number) => {
      const dtMs = Math.min(64, Math.max(0, now - lastTs));
      lastTs = now;
      if (!motionPausedRef.current) {
        walkersRef.current = stepWalkers(walkersRef.current, simItemsRef.current, wpsRef.current, dtMs, pausedWalkerIdRef.current);
        renderAccumMs += dtMs;
        if (renderAccumMs >= 32) {
          renderAccumMs = 0;
          setWalkers(walkersRef.current);
        }
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
      ro?.disconnect();
    };
  }, [simItems]);

  const allEmployees = simItems.map((i) => i.employee);
  const walkerById = new Map(walkers.map((w) => [w.id, w]));
  const directorName = account?.displayName?.trim() || t("office.floor.directorFallback");

  const pantryCount = measured
    ? walkers.filter((w) => w.zone === "pantry" && !w.walking).length
    : allEmployees.filter((e) => e.workLabel === "ready" || e.workLabel === "paused").length;
  const walkingCount = measured ? walkers.filter((w) => w.walking).length : 0;
  const deskCount = measured
    ? walkers.filter((w) => w.zone === "desk" && !w.walking).length
    : allEmployees.filter((e) => e.workLabel === "working" || (ceoEmployee !== null && e.id === ceoEmployee.id && presenceKindOf(e.workLabel) === "waiting")).length;
  const directorCount = measured
    ? walkers.filter((w) => w.zone === "director" && !w.walking).length
    : allEmployees.filter((e) => (ceoEmployee === null || e.id !== ceoEmployee.id) && presenceKindOf(e.workLabel) === "waiting").length;

  const inspectedEmployee = inspectedId !== null ? (allEmployees.find((e) => e.id === inspectedId) ?? null) : null;
  const inspectedIsCeo = inspectedEmployee !== null && ((ceoEmployee !== null && inspectedEmployee.id === ceoEmployee.id) || inspectedEmployee.role === "ceo");
  const inspectedDept =
    inspectedEmployee === null
      ? ""
      : inspectedIsCeo
        ? t("office.floor.directorsOffice")
        : (groups.find((g) => g.department?.id === inspectedEmployee.departmentId)?.department?.name ?? t("office.overview.unassigned"));
  const inspectedIsManager =
    inspectedEmployee !== null &&
    (inspectedEmployee.role === "manager" || groups.some((g) => g.department?.manager?.employeeId === inspectedEmployee.id));

  const toggleInspect = (employeeId: string) => setInspectedId((cur) => (cur === employeeId ? null : employeeId));

  return (
    <div ref={buildingRef} className={s.building}>
      {/* Compact Studio Floor HUD */}
      <div className={s.topHud}>
        <div className={s.hudLeft}>
          <IconBadge icon={<OfficeIcon size={15} active />} tone="brand" size="sm" />
          <Text weight="semibold" size={300}>
            {t("office.floor.companyFloor")}
          </Text>
          {measured && (
            <span className={mergeClasses(s.liveChip, motionPaused && s.liveChipPaused)} aria-hidden>
              <span className={mergeClasses(s.livePulse, motionPaused && s.livePulsePaused)} />
              <span>{motionPaused ? t("office.floor.motionPaused") : t("office.floor.liveBadge")}</span>
            </span>
          )}
          <span className={s.hudPillGroup} aria-hidden>
            <span className={s.hudStat}>
              <span className={s.dot} style={{ backgroundColor: "#16a34a" }} />
              {t("office.floor.inPantry", { count: pantryCount })}
            </span>
            <span className={s.hudStat}>
              <span className={s.dot} style={{ backgroundColor: "#6366f1" }} />
              {t("office.floor.atDesk", { count: deskCount })}
            </span>
            <span className={s.hudStat}>
              <span className={s.dot} style={{ backgroundColor: "#f59e0b" }} />
              {t("office.floor.atDirector", { count: directorCount })}
            </span>
            {walkingCount > 0 && <span className={s.hudStat}>{t("office.floor.walkingCount", { count: walkingCount })}</span>}
          </span>
        </div>
        <div className={s.hudRight}>
          <Text size={100} className={s.hudHintText} aria-hidden>
            {t("office.floor.hudHint")}
          </Text>
          {measured && (
            <Button
              size="small"
              appearance="subtle"
              icon={motionPaused ? <Play16Regular /> : <Pause16Regular />}
              aria-pressed={motionPaused}
              onClick={() => setMotionPaused((p) => !p)}
            >
              {motionPaused ? t("office.floor.resumeMotion") : t("office.floor.pauseMotion")}
            </Button>
          )}
        </div>
      </div>

      {/* Top Wing: Director's Office (left) & Pantry & Lounge (right) */}
      <div className={mergeClasses(s.topWing, pantryCount === 0 && s.topWingEmptyPantry)}>
        <span data-wp="hall-aisle" style={{ position: "absolute", left: "50%", top: 0, width: 0, height: 0, pointerEvents: "none" }} aria-hidden />

        <section className={s.execRoom} aria-label={t("office.floor.directorsOffice")}>
          <span className={s.roomAccentLine} style={{ backgroundColor: "#4f46e5" }} aria-hidden />
          <div className={mergeClasses(s.roomTitleBar, s.deptTitleBar)}>
            <div className={s.roomHead}>
              <span className={s.roomTag}>
                <span className={s.dot} style={{ backgroundColor: "#4f46e5" }} aria-hidden />
                <Text as="h3" weight="semibold" size={200} className={mergeClasses(o.wrap, o.headingReset)}>
                  {t("office.floor.directorsOffice")}
                </Text>
              </span>
              {ceo ? (
                <AppointmentHolder who={ceo} prefix={`${t("office.leadership.ceo")}: `} onOpen={onOpenEmployee} />
              ) : (
                <Text size={200} className={s.muted}>
                  {t("office.floor.noCeo")}
                </Text>
              )}
            </div>
            <div className={s.directorRight}>
              <Text size={100} className={s.muted} aria-hidden>
                {directorCount > 0 ? t("office.floor.askingOpinion", { count: directorCount }) : t("office.floor.askOpinionReview")}
              </Text>
              <AppointmentMenu slot={{ role: "ceo", incumbent: ceo }} label={t("office.floor.actionsForDirector")} onPick={pickAppointment} />
            </div>
          </div>
          <div className={s.execCarpet}>
            <div className={s.execDeskCluster}>
              {ceoEmployee !== null ? (
                <EmployeeDeskCard
                  employee={ceoEmployee}
                  walker={walkerById.get(ceoEmployee.id)}
                  measured={measured}
                  executive
                  selected={inspectedId === ceoEmployee.id}
                  onAssign={onAssign}
                  onOpenEmployee={onOpenEmployee}
                  onOpenMission={onOpenMission}
                  onInspect={toggleInspect}
                  restore={restore}
                />
              ) : ceo !== null ? (
                <div className={s.directorSeat}>
                  <PixelDirectorDeskSvg />
                  <Text size={100} className={s.muted}>
                    {t("office.floor.ceoFilteredOut", { name: ceo.name })}
                  </Text>
                </div>
              ) : (
                <div className={s.directorSeat}>
                  <div style={{ marginBottom: "-10px" }} aria-hidden>
                    <PixelChibiSvg name={directorName} workLabel="ready" activity="director" size={38} />
                  </div>
                  <PixelDirectorDeskSvg />
                  <GatherNamePill name={directorName} dotColor="#4f46e5" suffix={t("office.floor.directorSuffix")} />
                </div>
              )}
            </div>
            <div className={s.visitorsCluster}>
              <div className={s.visitorHeaderRow}>
                <span className={s.visitorZoneTag} aria-hidden>
                  {t("office.floor.visitorZoneLabel")}
                </span>
                <div className={s.bookshelfSlot} aria-hidden>
                  <PixelBookshelfSvg />
                </div>
              </div>
              <div className={s.visitorWaypointsRow}>
                <span data-wp="director-visitor-0" style={{ position: "relative", width: "2px", height: "44px" }} aria-hidden />
                <span data-wp="director-visitor-1" style={{ position: "relative", width: "2px", height: "44px" }} aria-hidden />
              </div>
              {directorCount === 0 && (
                <Text size={100} className={s.muted} style={{ textAlign: "center" }} aria-hidden>
                  {t("office.floor.directorEmptyNote")}
                </Text>
              )}
            </div>
          </div>
          <span className={s.doorwayBottom} data-wp="director-door" aria-hidden />
        </section>

        <section className={s.execRoom} aria-label={t("office.floor.pantryTitle")}>
          <span className={s.roomAccentLine} style={{ backgroundColor: "#16a34a" }} aria-hidden />
          <div className={s.roomTitleBar}>
            <span className={s.roomTag}>
              <span className={s.dot} style={{ backgroundColor: "#16a34a" }} aria-hidden />
              <Text as="h3" weight="semibold" size={200} className={mergeClasses(o.wrap, o.headingReset)}>
                {t("office.floor.pantryTitle")}
              </Text>
            </span>
            <Text size={100} className={s.muted} aria-hidden>
              {pantryCount > 0 ? t("office.floor.restingCount", { count: pantryCount }) : t("office.floor.coffeeBreakArea")}
            </Text>
          </div>
          <div className={s.pantryCarpet}>
            <PixelPantryLoungeSvg />
            <div className={s.pantryAnchorsZone}>
              <span data-wp="pantry-coffee" style={{ position: "absolute", left: "18%", bottom: "10px", width: 0, height: 0 }} aria-hidden />
              <span data-wp="pantry-sofa" style={{ position: "absolute", left: "50%", bottom: "8px", width: 0, height: 0 }} aria-hidden />
              <span data-wp="pantry-pingpong" style={{ position: "absolute", left: "82%", bottom: "10px", width: 0, height: 0 }} aria-hidden />
              {pantryCount === 0 && !walkers.some((w) => w.zone === "pantry" || w.targetZone === "pantry") && (
                <Text size={100} className={s.muted} style={{ textAlign: "center" }} aria-hidden>
                  {t("office.floor.pantryEmptyNote")}
                </Text>
              )}
            </div>
          </div>
          <span className={s.doorwayBottom} data-wp="pantry-door" aria-hidden />
        </section>
      </div>

      {/* Central Architectural Hallway */}
      <div className={s.hallway} aria-hidden>
        <span className={s.wayfindCluster}>
          <PixelPlantSvg variant="green" size={18} />
          <span className={s.wayfindPill}>↑ {t("office.floor.hallwayDirector")}</span>
          <Text size={100} className={s.muted}>
            {t("office.floor.hallwayCenter")}
          </Text>
          <span className={s.wayfindPill}>↑ {t("office.floor.hallwayPantry")}</span>
        </span>
        <span data-wp="hall-center" className={s.anchorDot} />
        {groups.length > 0 && (
          <span className={s.wayfindCluster}>
            <span className={s.wayfindPill}>{t("office.floor.hallwayDepartments")} ↓</span>
            <PixelPlantSvg variant="autumn" size={18} />
          </span>
        )}
      </div>

      {/* Bottom Wing: Integrated Partitioned Department Rooms */}
      {groups.length > 0 && (
        <div className={mergeClasses(s.departmentsGrid, groups.length === 1 && s.departmentsGridSingle)}>
          {groups.map((g) => {
            const deptKey = g.department?.id ?? "unassigned";
            const roomName = g.department?.name ?? t("office.overview.unassigned");
            const accent = roomAccentFor(roomName);
            const deptMembers =
              g.department && ceoEmployee !== null && ceoEmployee.departmentId === g.department.id
                ? Math.max(0, g.department.members - 1)
                : (g.department?.members ?? 0);
            return (
              <section key={deptKey} className={s.deptRoom} aria-label={roomName}>
                <span className={s.roomAccentLine} style={{ backgroundColor: accent.dot }} aria-hidden />
                <span className={s.doorwayTop} data-wp={`dept-door-${deptKey}`} aria-hidden />
                <div className={mergeClasses(s.roomTitleBar, s.deptTitleBar)}>
                  <div className={s.deptHead}>
                    <div className={s.deptNameRow}>
                      <span className={s.dot} style={{ backgroundColor: accent.dot }} aria-hidden />
                      <Text as="h3" weight="semibold" size={300} className={mergeClasses(s.deptNameText, o.headingReset)} title={roomName}>
                        {roomName}
                      </Text>
                      <Text size={200} className={mergeClasses(s.muted, s.countPill)} style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
                        {g.department
                          ? t("office.floor.membersCount", { count: deptMembers, word: deptMembers === 1 ? t("office.floor.memberOne") : t("office.floor.memberMany") })
                          : t("office.floor.shownCount", { count: g.employees.length })}
                      </Text>
                    </div>
                    {g.department &&
                      (g.department.manager ? (
                        <AppointmentHolder who={g.department.manager} prefix={`${t("office.leadership.managerLabel")} `} onOpen={onOpenEmployee} />
                      ) : (
                        <Text size={200} className={s.muted}>
                          {t("office.leadership.noManager")}
                        </Text>
                      ))}
                  </div>
                  {g.department && (
                    <AppointmentMenu slot={{ role: "manager", department: g.department, incumbent: g.department.manager ?? null }} label={t("office.floor.actionsForDept", { name: g.department.name })} onPick={pickAppointment}>
                      {onRecruit !== null && <MenuItem onClick={() => g.department && onRecruit(g.department.id)}>{t("office.floor.recruit")}</MenuItem>}
                      <MenuItem onClick={() => g.department && onEditDepartment({ kind: "rename", department: g.department })}>{t("office.floor.rename")}</MenuItem>
                      <MenuItem onClick={() => g.department && onEditDepartment({ kind: "archive", department: g.department })}>{t("office.floor.archive")}</MenuItem>
                    </AppointmentMenu>
                  )}
                </div>

                {g.employees.length === 0 ? (
                  <div className={s.emptyFloor} style={{ backgroundColor: accent.tint, border: `1px solid ${accent.border}` }}>
                    <PixelEmptyDeskClusterSvg />
                    <Text size={200} className={s.muted}>
                      {t("office.floor.noEmployeeHere", { suffix: filter === "all" ? t("office.floor.noEmployeeYet") : t("office.floor.noEmployeeMatches") })}
                    </Text>
                  </div>
                ) : (
                  <div className={s.desksGrid} style={{ backgroundColor: accent.tint, border: `1px solid ${accent.border}` }}>
                    {g.employees.map((e) => (
                      <EmployeeDeskCard
                        key={e.id}
                        employee={e}
                        walker={walkerById.get(e.id)}
                        measured={measured}
                        selected={inspectedId === e.id}
                        onAssign={onAssign}
                        onOpenEmployee={onOpenEmployee}
                        onOpenMission={onOpenMission}
                        onInspect={toggleInspect}
                        restore={restore}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Single Live Physical Walkers Overlay (never clones employees!) */}
      {measured && walkers.length > 0 && (
        <div className={s.walkersLayer}>
          {walkers.map((w, idx) => {
            const e = allEmployees.find((emp) => emp.id === w.id);
            if (!e) return null;
            const isCeo = (ceoEmployee !== null && e.id === ceoEmployee.id) || e.role === "ceo";
            const seatedAtDesk = w.zone === "desk" && !w.walking && w.path.length === 0;
            const isSelected = inspectedId === e.id || hoveredId === e.id;
            // Gently spread non-desk walkers who share the exact same spot so names & sprites never stack on top of each other.
            let spreadDx = 0;
            if (!seatedAtDesk) {
              const crowd = walkers.filter((other) => other.zone === w.zone && Math.hypot(other.x - w.x, other.y - w.y) < 34);
              if (crowd.length > 1) {
                const pos = crowd.findIndex((other) => other.id === w.id);
                spreadDx = (pos - (crowd.length - 1) / 2) * 56;
              }
            }
            const rawX = w.x + spreadDx;
            const clampedX =
              !seatedAtDesk && buildingWidth > 140
                ? Math.min(buildingWidth - 68, Math.max(68, rawX))
                : rawX;
            const iconText = w.walking
              ? "🚶"
              : w.path.length > 0 || w.zone === "hallway"
                ? "💬"
                : w.zone === "pantry"
                  ? "☕"
                  : undefined;
            const pill = (
              <GatherNamePill
                name={e.name}
                dotColor={dotColorOf(e.workLabel)}
                suffix={isCeo ? t("office.leadership.ceo") : undefined}
                iconText={iconText}
                selected={isSelected}
              />
            );
            return (
              <button
                key={w.id}
                type="button"
                className={s.walkerBtn}
                aria-label={t("office.floor.inspectAria", { name: e.name })}
                title={t("office.floor.inspectAria", { name: e.name })}
                style={{
                  zIndex: isSelected ? 18 : 12 + idx,
                  transform: seatedAtDesk
                    ? `translate3d(${Math.round(clampedX)}px, ${Math.round(w.y)}px, 0) translate(-50%, -100%)`
                    : `translate3d(${Math.round(clampedX)}px, ${Math.round(w.y)}px, 0) translate(-50%, -94%)`,
                }}
                onMouseEnter={() => setHoveredId(e.id)}
                onMouseLeave={() => setHoveredId((cur) => (cur === e.id ? null : cur))}
                onClick={() => toggleInspect(e.id)}
                {...restore}
              >
                {w.walking ? pill : <PixelQuestBubble workLabel={e.workLabel} title={e.holding?.title ?? null} />}
                <PixelChibiSvg
                  name={e.name}
                  workLabel={e.workLabel}
                  activity={w.activity}
                  facing={w.facing}
                  walking={w.walking}
                  stride={w.stride}
                  executive={isCeo}
                  size={38}
                />
                {!seatedAtDesk && !w.walking && pill}
              </button>
            );
          })}
        </div>
      )}

      {/* Floating Teammate Quick-Inspect Spotlight */}
      {inspectedEmployee !== null && (
        <TeammateSpotlight
          employee={inspectedEmployee}
          walker={walkerById.get(inspectedEmployee.id)}
          departmentLabel={inspectedDept}
          isCeo={inspectedIsCeo}
          isManager={inspectedIsManager}
          onClose={() => setInspectedId(null)}
          onAssign={onAssign}
          onOpenEmployee={onOpenEmployee}
          onOpenMission={onOpenMission}
        />
      )}

      {appointing && <AppointmentDialog edit={appointing} onClose={() => setAppointing(null)} onDone={() => setAppointing(null)} />}
    </div>
  );
}
