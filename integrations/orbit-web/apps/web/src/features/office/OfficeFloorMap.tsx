// GATHER-STYLE REAL-TIME COMPANY OFFICE FLOOR: one physical walker per employee moving smoothly with directional
// facing & 2-frame walking stride along real doorway/hallway routes between their desk, Pantry lounge, and Director's Office.
// Each department's room says who manages it (or that nobody does); its menu appoints, replaces, suspends, reinstates or
// revokes that manager -- the company's authority, as Leadership changes it -- beside renaming and archiving the room.
import {
  Badge,
  Button,
  Link,
  MenuItem,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Text,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
  useRestoreFocusTarget,
} from "@fluentui/react-components";
import {
  Add16Regular,
  Alert16Regular,
  ChevronDown16Regular,
  ChevronUp16Regular,
  Clock16Regular,
  Color16Regular,
  ErrorCircle16Regular,
  Eye16Regular,
  Flash16Regular,
  Grid16Regular,
  Keyboard16Regular,
  Pause16Regular,
  Play16Regular,
  Pulse20Regular,
  Speaker216Regular,
  SpeakerOff16Regular,
  Warning16Regular,
} from "@fluentui/react-icons";
import { RUNTIME_LABELS, type AppointmentSummary, type AuthAccount, type Department, type EmployeeCard, type ResourceSummary, type WorkLabel } from "@orbit-web/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconBadge, OfficeIcon } from "../../components/SectionIcons";
import { settingsHref } from "../../hooks/useHashRoute";
import { useI18n } from "../../i18n";
import { sizeText } from "../resources/format";
import { AppointmentDialog, AppointmentHolder, AppointmentMenu, type AppointmentEdit } from "./AppointmentDialogs";
import type { DepartmentEdit } from "./DepartmentDialogs";
import {
  DEFAULT_FLOOR_PREFS,
  accentForDepartment,
  formatElapsed,
  needsAttention,
  type AvatarCustomization,
  type FloorDensity,
  type FloorPrefs,
} from "./floorPrefs";
import { LiveOfficePulseStrip, useOfficePulse } from "./LiveOfficePulse";
import { createWalker, resnapIdleWalkers, stepWalkers, type SimEmployee, type WalkerState, type WaypointMap } from "./officeSim";
import { Callout, WorkLabelBadge, useOfficeStyles, when } from "./parts";
import {
  GatherNamePill,
  PixelBookshelfSvg,
  PixelChibiSvg,
  PixelDirectorDeskSvg,
  PixelEmptyDeskClusterSvg,
  PixelHuddleTableSvg,
  PixelModernDeskSvg,
  PixelPantryLoungeSvg,
  PixelPlantSvg,
  PixelQuestBubble,
} from "./PixelOfficeArt";
import { TeammateSpotlight } from "./TeammateSpotlight";
import { presenceKindOf } from "./VirtualDesk";

interface FloorGroup {
  department: Department | null;
  employees: EmployeeCard[];
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
    gap: "8px",
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
    gap: "4px",
    flexWrap: "wrap",
    minWidth: 0,
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
    gap: "9px",
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
  capacityPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    paddingTop: "3px",
    paddingRight: "9px",
    paddingBottom: "3px",
    paddingLeft: "8px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    fontSize: tokens.fontSizeBase100,
    color: tokens.colorNeutralForeground2,
    textDecorationLine: "none",
    whiteSpace: "nowrap",
    ":hover": {
      ...shorthands.borderColor(tokens.colorBrandStroke2),
      color: tokens.colorNeutralForeground1,
    },
  },
  hudStat: {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    whiteSpace: "nowrap",
  },
  hudToggleOn: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    ...shorthands.border("1px", "solid", tokens.colorBrandStroke2),
  },
  hudAttentionOn: {
    backgroundColor: tokens.colorPaletteDarkOrangeBackground1,
    color: tokens.colorPaletteDarkOrangeForeground1,
    ...shorthands.border("1px", "solid", tokens.colorPaletteDarkOrangeBorder1),
  },
  roomJumpBar: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    overflowX: "auto",
    paddingTop: "2px",
    paddingBottom: "2px",
    minWidth: 0,
  },
  roomJumpChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    paddingTop: "4px",
    paddingRight: "10px",
    paddingBottom: "4px",
    paddingLeft: "9px",
    borderRadius: "9999px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    fontSize: "11.5px",
    fontWeight: 500,
    color: tokens.colorNeutralForeground1,
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap",
    flexShrink: 0,
    transitionProperty: "border-color, background-color",
    transitionDuration: "120ms",
    ":hover": {
      ...shorthands.borderColor(tokens.colorBrandStroke2),
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
    ":focus-visible": { ...shorthands.outline("2px", "solid", tokens.colorStrokeFocus2), outlineOffset: "2px" },
  },
  huddleBanner: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
    paddingTop: "8px",
    paddingRight: "14px",
    paddingBottom: "8px",
    paddingLeft: "14px",
    borderRadius: "14px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorBrandStroke2),
    boxShadow: "var(--orbit-floor-room-shadow)",
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
  visitorsClusterActive: {
    ...shorthands.borderColor(tokens.colorPaletteDarkOrangeBorder2),
    boxShadow: `inset 0 0 0 1px ${tokens.colorPaletteDarkOrangeBorder1}`,
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
  deptControls: { display: "inline-flex", alignItems: "center", gap: "4px", flexShrink: 0 },
  colorDotBtn: {
    width: "22px",
    height: "22px",
    borderRadius: "9999px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground2,
    cursor: "pointer",
    ":hover": { ...shorthands.borderColor(tokens.colorBrandStroke2), color: tokens.colorNeutralForeground1 },
    ":focus-visible": { ...shorthands.outline("2px", "solid", tokens.colorStrokeFocus2), outlineOffset: "2px" },
  },
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
    justifyContent: "space-between",
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
  desksGridCompact: {
    gridTemplateColumns: "repeat(auto-fill, minmax(176px, 206px))",
    rowGap: "10px",
    columnGap: "10px",
    paddingTop: "10px",
    paddingRight: "10px",
    paddingBottom: "10px",
    paddingLeft: "10px",
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
    transitionProperty: "border-color, box-shadow, opacity, transform",
    transitionDuration: "160ms",
    transitionTimingFunction: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    minWidth: 0,
    ":hover": {
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
      boxShadow: "0 4px 14px -4px rgba(28, 25, 23, 0.12)",
    },
  },
  deskArticleCompact: {
    gap: "5px",
    paddingTop: "8px",
    paddingRight: "9px",
    paddingBottom: "8px",
    paddingLeft: "9px",
    borderRadius: "12px",
  },
  deskArticleDimmed: {
    opacity: 0.42,
    ":hover": { opacity: 0.92 },
  },
  deskArticleAttention: {
    ...shorthands.borderColor(tokens.colorPaletteDarkOrangeBorder2),
    boxShadow: `0 0 0 2px ${tokens.colorPaletteDarkOrangeBackground1}, 0 4px 14px -4px rgba(217, 119, 6, 0.24)`,
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
  chairAnchorCompact: {
    height: "46px",
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
  elapsedMeta: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "10px",
    color: tokens.colorNeutralForeground3,
  },
  shortcutsTable: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "6px 12px",
    alignItems: "center",
    marginTop: "8px",
  },
  kbd: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: "24px",
    paddingTop: "1px",
    paddingRight: "6px",
    paddingBottom: "1px",
    paddingLeft: "6px",
    borderRadius: "6px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke1),
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "11px",
    fontWeight: 600,
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

type RestoreProps = ReturnType<typeof useRestoreFocusTarget>;

function EmployeeDeskCard({
  employee: e,
  walker: w,
  measured,
  density,
  executive = false,
  selected = false,
  dimmed = false,
  attention = false,
  inTeamSync = false,
  nowMs,
  avatarStyle,
  onAssign,
  onOpenEmployee,
  onOpenMission,
  onInspect,
  restore,
}: {
  employee: EmployeeCard;
  walker: WalkerState | undefined;
  measured: boolean;
  density: FloorDensity;
  executive?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  attention?: boolean;
  inTeamSync?: boolean;
  nowMs: number;
  avatarStyle?: AvatarCustomization;
  onAssign: (employeeId: string) => void;
  onOpenEmployee: (employeeId: string) => void;
  onOpenMission: (missionId: string) => void;
  onInspect: (employeeId: string) => void;
  restore: RestoreProps;
}) {
  const { t } = useI18n();
  const s = useStyles();
  const o = useOfficeStyles();
  const compact = density === "compact";
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
  const elapsed = e.holding ? formatElapsed(e.holding.since, nowMs) : null;
  const deskArt = executive ? (
    <PixelDirectorDeskSvg />
  ) : (
    <PixelModernDeskSvg workLabel={e.workLabel} occupied={atDeskNow} penSpinning={atDeskNow && e.workLabel === "ready"} />
  );

  return (
    <article
      className={mergeClasses(
        s.deskArticle,
        compact && s.deskArticleCompact,
        executive && s.ceoArticle,
        dimmed && s.deskArticleDimmed,
        attention && !selected && s.deskArticleAttention,
        selected && s.deskArticleSelected,
      )}
      aria-label={e.name}
    >
      <span className={s.deskStatusHairline} style={{ backgroundColor: dotColorOf(e.workLabel) }} aria-hidden />
      {!measured ? (
        <div className={s.deskStage}>
          <div className={mergeClasses(s.chairAnchorWrap, compact && s.chairAnchorCompact)}>
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
              {!compact && <PixelQuestBubble workLabel={e.workLabel} title={e.holding?.title ?? null} />}
              <div style={{ marginBottom: "-8px" }}>
                <PixelChibiSvg
                  name={e.name}
                  workLabel={e.workLabel}
                  activity={e.workLabel === "ready" ? "pen-spin" : e.workLabel === "working" ? "typing" : "asking"}
                  executive={executive}
                  avatarStyle={avatarStyle}
                  seed={e.id}
                  size={compact ? 30 : 38}
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
          <div className={mergeClasses(s.chairAnchorWrap, compact && s.chairAnchorCompact)}>
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
        {!compact && (
          <span className={s.deskSubtitle} title={`${e.title} · ${runtimeSummaryOf(e)}`}>
            {e.title} · {runtimeSummaryOf(e)}
          </span>
        )}
      </div>

      {inTeamSync && (
        <Badge appearance="tint" color="informative" size="small" style={{ width: "fit-content", borderRadius: "9999px" }}>
          {t("office.floor.teamSyncBadge")}
        </Badge>
      )}

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
          {(elapsed || e.queued > 0) && (
            <span className={s.elapsedMeta}>
              {elapsed && (
                <>
                  <Clock16Regular style={{ fontSize: "11px" }} />
                  <span>{elapsed}</span>
                </>
              )}
              {elapsed && e.queued > 0 && <span>·</span>}
              {e.queued > 0 && <span>{t("office.floor.queuedBehind", { count: e.queued })}</span>}
            </span>
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

export function OfficeFloorMap({
  groups,
  departments = [],
  ceo = null,
  ceoEmployee = null,
  filter,
  account,
  inboxCount = 0,
  canHire = false,
  resourceSummary = null,
  prefs = DEFAULT_FLOOR_PREFS,
  motionPaused: controlledPaused,
  onToggleMotionPaused,
  onToggleDensity,
  onToggleSound,
  onTogglePulse,
  onToggleRoomCollapsed,
  onCycleDeptAccent,
  onSetAvatarStyle,
  onAssign,
  onOpenEmployee,
  onOpenMission,
  onEditDepartment,
  onAppointment,
  onRecruit = null,
  onHireCeo = null,
  onHireInDepartment = null,
  onOpenReview = null,
  onRosterChanged,
}: {
  groups: FloorGroup[];
  departments?: Department[];
  ceo?: AppointmentSummary | null;
  ceoEmployee?: EmployeeCard | null;
  filter: string;
  account: AuthAccount | null;
  inboxCount?: number;
  canHire?: boolean;
  resourceSummary?: ResourceSummary | null;
  prefs?: FloorPrefs;
  motionPaused?: boolean;
  onToggleMotionPaused?: () => void;
  onToggleDensity?: () => void;
  onToggleSound?: () => void;
  onTogglePulse?: () => void;
  onToggleRoomCollapsed?: (deptKey: string) => void;
  onCycleDeptAccent?: (deptId: string, label: string) => void;
  onSetAvatarStyle?: (employeeId: string, style: AvatarCustomization | null) => void;
  onAssign: (employeeId: string) => void;
  onOpenEmployee: (employeeId: string) => void;
  onOpenMission: (missionId: string) => void;
  onEditDepartment: (edit: DepartmentEdit) => void;
  onAppointment?: (edit: AppointmentEdit) => void;
  onRecruit?: ((departmentId: string) => void) | null;
  onHireCeo?: (() => void) | null;
  onHireInDepartment?: ((departmentId: string) => void) | null;
  onOpenReview?: ((missionId: string | null) => void) | null;
  onRosterChanged?: () => void;
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
  const [localPaused, setLocalPaused] = useState(false);
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const motionPaused = controlledPaused ?? localPaused;
  const toggleMotionPaused = onToggleMotionPaused ?? (() => setLocalPaused((p) => !p));

  const simItems: SimEmployee[] = useMemo(() => {
    let slot = 0;
    const out: SimEmployee[] = [];
    if (ceoEmployee !== null) {
      out.push({ employee: ceoEmployee, deptKey: "director", visitorSlot: 0 });
    }
    for (const g of groups) {
      const deptKey = g.department?.id ?? "unassigned";
      const collapsed = Boolean(prefs.collapsedRooms[deptKey]);
      if (collapsed) continue;
      for (const e of g.employees) {
        if (ceoEmployee !== null && e.id === ceoEmployee.id) continue;
        const isWaiting = presenceKindOf(e.workLabel) === "waiting";
        out.push({ employee: e, deptKey, visitorSlot: isWaiting ? slot++ : 0 });
      }
    }
    return out;
  }, [groups, ceoEmployee, prefs.collapsedRooms]);

  const allEmployees = useMemo(() => {
    const out: EmployeeCard[] = [];
    if (ceoEmployee !== null) out.push(ceoEmployee);
    for (const g of groups) {
      for (const e of g.employees) {
        if (ceoEmployee !== null && e.id === ceoEmployee.id) continue;
        out.push(e);
      }
    }
    return out;
  }, [groups, ceoEmployee]);

  const pulseEvents = useOfficePulse(allEmployees, prefs.soundEnabled);

  // Tick every 30s only when at least one employee is holding active work, keeping elapsed durations fresh.
  const hasHolding = allEmployees.some((e) => e.holding !== null);
  useEffect(() => {
    if (!hasHolding) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [hasHolding]);

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

  // Spotlight keyboard navigation: Escape closes, ArrowLeft/ArrowRight cycles teammates when not typing.
  useEffect(() => {
    if (inspectedId === null) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setInspectedId(null);
        return;
      }
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (ev.target as HTMLElement | null)?.isContentEditable) return;
      if ((ev.key === "ArrowLeft" || ev.key === "ArrowRight") && allEmployees.length > 1) {
        ev.preventDefault();
        const curIdx = allEmployees.findIndex((e) => e.id === inspectedId);
        if (curIdx === -1) return;
        const step = ev.key === "ArrowRight" ? 1 : -1;
        const next = allEmployees[(curIdx + step + allEmployees.length) % allEmployees.length];
        if (next) setInspectedId(next.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inspectedId, allEmployees]);

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
  }, [simItems, prefs.density]);

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

  const attentionCount = allEmployees.filter(needsAttention).length;

  // Detect active multi-employee collaborations (shared missionId or waiting_team).
  const activeHuddles = useMemo(() => {
    const byMission = new Map<string, { missionId: string; title: string; members: EmployeeCard[] }>();
    for (const e of allEmployees) {
      if (!e.holding) continue;
      const cur = byMission.get(e.holding.missionId) ?? { missionId: e.holding.missionId, title: e.holding.title, members: [] };
      cur.members.push(e);
      byMission.set(e.holding.missionId, cur);
    }
    return [...byMission.values()].filter((h) => h.members.length >= 2 || h.members.some((m) => m.workLabel === "waiting_team"));
  }, [allEmployees]);

  const teamSyncIds = useMemo(() => {
    const ids = new Set<string>();
    for (const h of activeHuddles) for (const m of h.members) ids.add(m.id);
    return ids;
  }, [activeHuddles]);

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
  const cycleInspect = (dir: -1 | 1) => {
    if (inspectedId === null || allEmployees.length < 2) return;
    const idx = allEmployees.findIndex((e) => e.id === inspectedId);
    if (idx === -1) return;
    const next = allEmployees[(idx + dir + allEmployees.length) % allEmployees.length];
    if (next) setInspectedId(next.id);
  };

  const scrollToRoom = (roomId: string) => {
    const el = buildingRef.current?.querySelector<HTMLElement>(`[data-room-id="${roomId}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const reviewWaitingCount = Math.max(inboxCount, directorCount);
  const allDepts = departments.length > 0 ? departments : groups.map((g) => g.department).filter((d): d is Department => d !== null);

  return (
    <div ref={buildingRef} className={s.building}>
      {/* Studio Floor HUD */}
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
          {resourceSummary && (
            <a
              href={settingsHref("compute")}
              className={s.capacityPill}
              aria-label={t("office.floor.capacityAria")}
              title={t("office.floor.capacityAria")}
            >
              <span
                className={s.dot}
                style={{
                  backgroundColor:
                    resourceSummary.waiting > 0 || resourceSummary.running >= resourceSummary.budget.maxConcurrent
                      ? "#f59e0b"
                      : "#16a34a",
                }}
                aria-hidden
              />
              <span>
                {t("office.floor.capacityPill", {
                  running: resourceSummary.running,
                  max: resourceSummary.budget.maxConcurrent,
                  memUsed: sizeText(resourceSummary.reserved.memoryMiB),
                  memTotal: sizeText(resourceSummary.budget.memoryMiB),
                })}
                {resourceSummary.waiting > 0 ? t("office.floor.capacityWaiting", { count: resourceSummary.waiting }) : ""}
              </span>
            </a>
          )}
        </div>
        <div className={s.hudRight}>
          <Button
            size="small"
            appearance="subtle"
            className={mergeClasses(attentionOnly && s.hudAttentionOn)}
            icon={<Alert16Regular />}
            aria-pressed={attentionOnly}
            title={t("office.floor.attentionFilter")}
            onClick={() => setAttentionOnly((v) => !v)}
          >
            {attentionCount > 0 ? t("office.floor.attentionCount", { count: attentionCount }) : t("office.floor.attentionFilter")}
          </Button>
          {onToggleDensity && (
            <Button
              size="small"
              appearance="subtle"
              className={mergeClasses(prefs.density === "compact" && s.hudToggleOn)}
              icon={<Grid16Regular />}
              aria-pressed={prefs.density === "compact"}
              title={prefs.density === "compact" ? t("office.floor.densityCozy") : t("office.floor.densityCompact")}
              aria-label={prefs.density === "compact" ? t("office.floor.densityCozy") : t("office.floor.densityCompact")}
              onClick={onToggleDensity}
            />
          )}
          {onTogglePulse && (
            <Button
              size="small"
              appearance="subtle"
              className={mergeClasses(prefs.pulseOpen && s.hudToggleOn)}
              icon={<Pulse20Regular />}
              aria-pressed={prefs.pulseOpen}
              title={t("office.floor.pulseTitle")}
              aria-label={t("office.floor.pulseTitle")}
              onClick={onTogglePulse}
            />
          )}
          {onToggleSound && (
            <Button
              size="small"
              appearance="subtle"
              className={mergeClasses(prefs.soundEnabled && s.hudToggleOn)}
              icon={prefs.soundEnabled ? <Speaker216Regular /> : <SpeakerOff16Regular />}
              aria-pressed={prefs.soundEnabled}
              title={prefs.soundEnabled ? t("office.floor.soundOn") : t("office.floor.soundOff")}
              aria-label={prefs.soundEnabled ? t("office.floor.soundOn") : t("office.floor.soundOff")}
              onClick={onToggleSound}
            />
          )}
          {measured && (
            <Button
              size="small"
              appearance="subtle"
              icon={motionPaused ? <Play16Regular /> : <Pause16Regular />}
              aria-pressed={motionPaused}
              title={motionPaused ? t("office.floor.resumeMotion") : t("office.floor.pauseMotion")}
              aria-label={motionPaused ? t("office.floor.resumeMotion") : t("office.floor.pauseMotion")}
              onClick={toggleMotionPaused}
            >
              {motionPaused ? t("office.floor.resumeMotion") : t("office.floor.pauseMotion")}
            </Button>
          )}
          <Popover positioning="below-end">
            <PopoverTrigger disableButtonEnhancement>
              <Button
                size="small"
                appearance="subtle"
                icon={<Keyboard16Regular />}
                aria-label={t("office.floor.shortcutsAria")}
                title={t("office.floor.shortcutsAria")}
              />
            </PopoverTrigger>
            <PopoverSurface>
              <Text weight="semibold" size={200}>
                {t("office.floor.shortcutsTitle")}
              </Text>
              <div className={s.shortcutsTable}>
                <span className={s.kbd}>/</span>
                <Text size={200}>{t("office.floor.shortcutSearch")}</Text>
                <span className={s.kbd}>V</span>
                <Text size={200}>{t("office.floor.shortcutView")}</Text>
                <span className={s.kbd}>C</span>
                <Text size={200}>{t("office.floor.shortcutDensity")}</Text>
                <span className={s.kbd}>Space</span>
                <Text size={200}>{t("office.floor.shortcutPause")}</Text>
                <span className={s.kbd}>A</span>
                <Text size={200}>{t("office.floor.shortcutAssign")}</Text>
                <span className={s.kbd}>← / →</span>
                <Text size={200}>{t("office.floor.shortcutCycle")}</Text>
                <span className={s.kbd}>Esc</span>
                <Text size={200}>{t("office.floor.shortcutClose")}</Text>
              </div>
            </PopoverSurface>
          </Popover>
        </div>
      </div>

      {/* Optional Live Office Pulse Ribbon */}
      {prefs.pulseOpen && (
        <LiveOfficePulseStrip
          events={pulseEvents}
          onSelectEmployee={(empId) => setInspectedId(empId)}
          onOpenMission={onOpenMission}
        />
      )}

      {/* Room Jump Bar when multiple department rooms exist */}
      {groups.length >= 2 && (
        <nav className={mergeClasses(s.roomJumpBar, "orbit-hscroll")} aria-label={t("office.floor.roomJumpAria")}>
          <button type="button" className={s.roomJumpChip} onClick={() => scrollToRoom("director")}>
            <span className={s.dot} style={{ backgroundColor: "#4f46e5" }} aria-hidden />
            <span>{t("office.floor.directorsOffice")}</span>
          </button>
          {groups.map((g) => {
            const key = g.department?.id ?? "unassigned";
            const name = g.department?.name ?? t("office.overview.unassigned");
            const accent = accentForDepartment(g.department?.id ?? null, name, prefs);
            const hasAlert = g.employees.some(needsAttention);
            return (
              <button key={key} type="button" className={s.roomJumpChip} onClick={() => scrollToRoom(key)}>
                <span className={s.dot} style={{ backgroundColor: accent.dot }} aria-hidden />
                <span>{name}</span>
                <Text size={100} className={s.muted}>
                  {g.employees.length}
                </Text>
                {hasAlert && <span className={s.dot} style={{ backgroundColor: "#f59e0b" }} aria-hidden />}
              </button>
            );
          })}
        </nav>
      )}

      {/* Active Team Huddle Strip when teammates collaborate on the same mission */}
      {activeHuddles.length > 0 && (
        <div className={s.huddleBanner} role="region" aria-label={t("office.floor.teamHuddleTitle")}>
          <div className={o.row} style={{ gap: "10px" }}>
            <PixelHuddleTableSvg />
            <div className={o.stack} style={{ gap: "2px" }}>
              <Text weight="semibold" size={200}>
                {t("office.floor.teamHuddleTitle")}
              </Text>
              {activeHuddles.map((h) => (
                <Text key={h.missionId} size={200} className={s.muted}>
                  <Link as="button" onClick={() => onOpenMission(h.missionId)}>
                    {t("office.floor.teamHuddleSync", { count: h.members.length, title: h.title })}
                  </Link>
                  {" · "}
                  {h.members.map((m) => m.name).join(", ")}
                </Text>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Top Wing: Director's Office (left) & Pantry & Lounge (right) */}
      <div className={mergeClasses(s.topWing, pantryCount === 0 && s.topWingEmptyPantry)}>
        <span data-wp="hall-aisle" style={{ position: "absolute", left: "50%", top: 0, width: 0, height: 0, pointerEvents: "none" }} aria-hidden />

        <section className={s.execRoom} data-room-id="director" aria-label={t("office.floor.directorsOffice")}>
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
              {ceo === null && canHire && onHireCeo && (
                <Button className={o.touch} size="small" appearance="outline" icon={<Add16Regular />} onClick={onHireCeo}>
                  {t("office.floor.hireCeo")}
                </Button>
              )}
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
                  density={prefs.density}
                  executive
                  selected={inspectedId === ceoEmployee.id}
                  dimmed={attentionOnly && !needsAttention(ceoEmployee)}
                  attention={attentionOnly && needsAttention(ceoEmployee)}
                  inTeamSync={teamSyncIds.has(ceoEmployee.id)}
                  nowMs={nowMs}
                  avatarStyle={prefs.avatarStyles[ceoEmployee.id]}
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
            <div className={mergeClasses(s.visitorsCluster, reviewWaitingCount > 0 && s.visitorsClusterActive)}>
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
              {reviewWaitingCount > 0 && onOpenReview ? (
                <Button size="small" appearance="primary" icon={<Flash16Regular />} onClick={() => onOpenReview(null)}>
                  {t("office.floor.reviewNow")} ({reviewWaitingCount})
                </Button>
              ) : (
                directorCount === 0 && (
                  <Text size={100} className={s.muted} style={{ textAlign: "center" }} aria-hidden>
                    {t("office.floor.directorEmptyNote")}
                  </Text>
                )
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
              <span data-wp="pantry-coffee" style={{ position: "absolute", left: "26%", bottom: "10px", width: 0, height: 0 }} aria-hidden />
              <span data-wp="pantry-sofa" style={{ position: "absolute", left: "52%", bottom: "8px", width: 0, height: 0 }} aria-hidden />
              <span data-wp="pantry-pingpong" style={{ position: "absolute", left: "78%", bottom: "10px", width: 0, height: 0 }} aria-hidden />
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
            const accent = accentForDepartment(g.department?.id ?? null, roomName, prefs);
            const collapsed = Boolean(prefs.collapsedRooms[deptKey]);
            const deptMembers =
              g.department && ceoEmployee !== null && ceoEmployee.departmentId === g.department.id
                ? Math.max(0, g.department.members - 1)
                : (g.department?.members ?? 0);
            return (
              <section key={deptKey} data-room-id={deptKey} className={s.deptRoom} aria-label={roomName}>
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
                  <div className={s.deptControls}>
                    {g.department && canHire && onHireInDepartment && (
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={<Add16Regular />}
                        aria-label={t("office.floor.hireInDept", { name: g.department.name })}
                        title={t("office.floor.hireInDept", { name: g.department.name })}
                        onClick={() => g.department && onHireInDepartment(g.department.id)}
                      >
                        {t("office.floor.hireInDeptShort")}
                      </Button>
                    )}
                    {g.department && onCycleDeptAccent && (
                      <button
                        type="button"
                        className={s.colorDotBtn}
                        aria-label={t("office.floor.roomColorAria", { name: g.department.name })}
                        title={t("office.floor.roomColorAria", { name: g.department.name })}
                        onClick={() => g.department && onCycleDeptAccent(g.department.id, g.department.name)}
                      >
                        <Color16Regular style={{ fontSize: "12px", color: accent.dot }} />
                      </button>
                    )}
                    {onToggleRoomCollapsed && (
                      <Button
                        size="small"
                        appearance="subtle"
                        icon={collapsed ? <ChevronDown16Regular /> : <ChevronUp16Regular />}
                        aria-expanded={!collapsed}
                        aria-label={collapsed ? t("office.floor.expandRoom", { name: roomName }) : t("office.floor.collapseRoom", { name: roomName })}
                        onClick={() => onToggleRoomCollapsed(deptKey)}
                      />
                    )}
                    {g.department && (
                      <AppointmentMenu slot={{ role: "manager", department: g.department, incumbent: g.department.manager ?? null }} label={t("office.floor.actionsForDept", { name: g.department.name })} onPick={pickAppointment}>
                        {onRecruit !== null && <MenuItem onClick={() => g.department && onRecruit(g.department.id)}>{t("office.floor.recruit")}</MenuItem>}
                        <MenuItem onClick={() => g.department && onEditDepartment({ kind: "rename", department: g.department })}>{t("office.floor.rename")}</MenuItem>
                        <MenuItem onClick={() => g.department && onEditDepartment({ kind: "archive", department: g.department })}>{t("office.floor.archive")}</MenuItem>
                      </AppointmentMenu>
                    )}
                  </div>
                </div>

                {!collapsed &&
                  (g.employees.length === 0 ? (
                    <div className={s.emptyFloor} style={{ backgroundColor: accent.tint, border: `1px solid ${accent.border}` }}>
                      <div className={o.row} style={{ gap: "12px" }}>
                        <PixelEmptyDeskClusterSvg />
                        <Text size={200} className={s.muted}>
                          {t("office.floor.noEmployeeHere", { suffix: filter === "all" ? t("office.floor.noEmployeeYet") : t("office.floor.noEmployeeMatches") })}
                        </Text>
                      </div>
                      {filter === "all" && canHire && g.department && onHireInDepartment && (
                        <Button size="small" appearance="outline" icon={<Add16Regular />} onClick={() => g.department && onHireInDepartment(g.department.id)}>
                          {t("office.floor.hireInDept", { name: g.department.name })}
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div
                      className={mergeClasses(s.desksGrid, prefs.density === "compact" && s.desksGridCompact)}
                      style={{ backgroundColor: accent.tint, border: `1px solid ${accent.border}` }}
                    >
                      {g.employees.map((e) => (
                        <EmployeeDeskCard
                          key={e.id}
                          employee={e}
                          walker={walkerById.get(e.id)}
                          measured={measured}
                          density={prefs.density}
                          selected={inspectedId === e.id}
                          dimmed={attentionOnly && !needsAttention(e)}
                          attention={attentionOnly && needsAttention(e)}
                          inTeamSync={teamSyncIds.has(e.id)}
                          nowMs={nowMs}
                          avatarStyle={prefs.avatarStyles[e.id]}
                          onAssign={onAssign}
                          onOpenEmployee={onOpenEmployee}
                          onOpenMission={onOpenMission}
                          onInspect={toggleInspect}
                          restore={restore}
                        />
                      ))}
                    </div>
                  ))}
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
            const waitingHere = w.zone === "director" && (e.workLabel === "waiting_review" || e.workLabel === "waiting_info");
            let spreadDx = 0;
            let spreadDy = 0;
            if (!seatedAtDesk) {
              const crowd = walkers.filter((other) => other.zone === w.zone && Math.hypot(other.x - w.x, other.y - w.y) < 34);
              if (crowd.length > 1) {
                const pos = crowd.findIndex((other) => other.id === w.id);
                const centered = pos - (crowd.length - 1) / 2;
                spreadDx = centered * 64;
                spreadDy = pos % 2 === 0 ? -12 : 8;
              }
            }
            const rawX = w.x + spreadDx;
            const clampedX = !seatedAtDesk && buildingWidth > 140 ? Math.min(buildingWidth - 68, Math.max(68, rawX)) : rawX;
            const finalY = w.y + spreadDy;
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
                  opacity: attentionOnly && !needsAttention(e) ? 0.38 : 1,
                  transform: seatedAtDesk
                    ? `translate3d(${Math.round(clampedX)}px, ${Math.round(w.y)}px, 0) translate(-50%, -100%)`
                    : `translate3d(${Math.round(clampedX)}px, ${Math.round(finalY)}px, 0) translate(-50%, -94%)`,
                }}
                onMouseEnter={() => setHoveredId(e.id)}
                onMouseLeave={() => setHoveredId((cur) => (cur === e.id ? null : cur))}
                onClick={() => {
                  if (waitingHere && onOpenReview) onOpenReview(e.holding?.missionId ?? null);
                  else toggleInspect(e.id);
                }}
                {...restore}
              >
                {w.walking ? pill : !(prefs.density === "compact" && seatedAtDesk) && <PixelQuestBubble workLabel={e.workLabel} title={e.holding?.title ?? null} />}
                <PixelChibiSvg
                  name={e.name}
                  workLabel={e.workLabel}
                  activity={w.activity}
                  facing={w.facing}
                  walking={w.walking}
                  stride={w.stride}
                  executive={isCeo}
                  avatarStyle={prefs.avatarStyles[e.id]}
                  seed={e.id}
                  size={prefs.density === "compact" && seatedAtDesk ? 30 : 38}
                />
                {!seatedAtDesk && !w.walking && pill}
              </button>
            );
          })}
        </div>
      )}

      {/* Floating Teammate Quick-Inspect & Control Spotlight */}
      {inspectedEmployee !== null && (
        <TeammateSpotlight
          key={inspectedEmployee.id}
          employee={inspectedEmployee}
          walker={walkerById.get(inspectedEmployee.id)}
          departmentLabel={inspectedDept}
          departments={allDepts}
          isCeo={inspectedIsCeo}
          isManager={inspectedIsManager}
          canCycle={allEmployees.length > 1}
          nowMs={nowMs}
          avatarStyle={prefs.avatarStyles[inspectedEmployee.id]}
          onSetAvatarStyle={(style) => onSetAvatarStyle?.(inspectedEmployee.id, style)}
          onCycle={cycleInspect}
          onClose={() => setInspectedId(null)}
          onAssign={onAssign}
          onOpenEmployee={onOpenEmployee}
          onOpenMission={onOpenMission}
          onOpenReview={onOpenReview ?? undefined}
          onRosterChanged={onRosterChanged}
        />
      )}

      {appointing && <AppointmentDialog edit={appointing} onClose={() => setAppointing(null)} onDone={() => setAppointing(null)} />}
    </div>
  );
}
