// GATHER-STYLE REAL-TIME COMPANY OFFICE FLOOR: one physical walker per employee moving smoothly with directional
// facing & 2-frame walking stride along real doorway/hallway routes between their desk, Pantry lounge, and Director's Office.
// Each department's room says who manages it (or that nobody does); its menu appoints, replaces, suspends, reinstates or
// revokes that manager -- the company's authority, as Leadership changes it -- beside renaming and archiving the room.
import { Button, Link, MenuItem, Text, makeStyles, mergeClasses, shorthands, tokens, useRestoreFocusTarget } from "@fluentui/react-components";
import { ErrorCircle16Regular, Warning16Regular } from "@fluentui/react-icons";
import type { AppointmentSummary, AuthAccount, Department, EmployeeCard, WorkLabel } from "@orbit-web/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconBadge, OfficeIcon } from "../../components/SectionIcons";
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
import { presenceKindOf } from "./VirtualDesk";

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
    position: "relative",
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    alignItems: "stretch",
    gap: "14px",
    minWidth: 0,
    "@media (max-width: 720px)": { gridTemplateColumns: "1fr" },
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
    ...shorthands.border("2.5px", "solid", "var(--orbit-wall-outer)"),
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "inset 0 0 0 2px var(--orbit-wall-inner)",
    minWidth: 0,
  },
  execCarpet: {
    display: "flex",
    flexGrow: 1,
    alignItems: "flex-end",
    justifyContent: "space-between",
    columnGap: "18px",
    rowGap: "44px",
    flexWrap: "wrap",
    paddingTop: "40px",
    paddingRight: "14px",
    paddingBottom: "14px",
    paddingLeft: "14px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-rug-exec)",
    minHeight: "108px",
    minWidth: 0,
  },
  directorRight: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    flexShrink: 0,
  },
  pantryCarpet: {
    display: "flex",
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "space-around",
    gap: "12px",
    flexWrap: "wrap",
    paddingTop: "32px",
    paddingRight: "14px",
    paddingBottom: "14px",
    paddingLeft: "14px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-rug-pantry)",
    minHeight: "108px",
    minWidth: 0,
  },
  pantryAnchorsZone: {
    position: "relative",
    flexGrow: 1,
    minWidth: "150px",
    height: "74px",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  visitorsCluster: {
    position: "relative",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-around",
    gap: "12px",
    flexGrow: 1,
    minWidth: "136px",
    minHeight: "88px",
    paddingTop: "24px",
  },
  roomTitleBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    flexWrap: "wrap",
    minWidth: 0,
  },
  // A department room's name and who manages it: one line where they fit, the manager under the name where not -- and
  // room above the first desks, whose speech bubbles reach a little above them.
  deptTitleBar: { marginBottom: "10px", alignItems: "flex-start" },
  roomHead: { display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: "12px", rowGap: "2px", flexGrow: 1, flexBasis: 0, minWidth: "min(100%, 160px)" },
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
  hallway: {
    position: "relative",
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
  anchorDot: {
    position: "relative",
    width: "2px",
    height: "2px",
    pointerEvents: "none",
  },
  departmentsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    rowGap: "36px",
    columnGap: "24px",
    minWidth: 0,
    "@media (max-width: 720px)": { gridTemplateColumns: "1fr" },
  },
  departmentsGridSingle: {
    gridTemplateColumns: "1fr",
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
    gridTemplateColumns: "repeat(auto-fill, minmax(164px, 210px))",
    rowGap: "32px",
    columnGap: "16px",
    justifyContent: "flex-start",
    minWidth: 0,
    "@media (max-width: 480px)": { gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" },
  },
  deskArticle: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "6px",
    paddingTop: "8px",
    paddingRight: "10px",
    paddingBottom: "8px",
    paddingLeft: "10px",
    borderRadius: "12px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
    minWidth: 0,
  },
  ceoArticle: {
    minWidth: "172px",
    maxWidth: "min(100%, 248px)",
    ...shorthands.borderColor(tokens.colorBrandStroke2),
  },
  deskStage: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    width: "100%",
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
    borderRadius: "10px",
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
    height: "56px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  awayNote: {
    fontSize: "10px",
    color: tokens.colorNeutralForeground3,
    paddingTop: "1px",
    paddingRight: "7px",
    paddingBottom: "1px",
    paddingLeft: "7px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralBackground2,
    marginBottom: "4px",
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
      filter: "drop-shadow(0 4px 8px rgba(0, 0, 0, 0.22))",
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
    paddingTop: 0,
    paddingBottom: 0,
    minWidth: 0,
    minHeight: "auto",
    justifyContent: "flex-start",
    fontWeight: 600,
    fontSize: tokens.fontSizeBase200,
    textAlign: "left",
    overflowWrap: "anywhere",
    height: "auto",
  },
  holdingBox: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    width: "100%",
    paddingTop: "4px",
    paddingRight: "7px",
    paddingBottom: "4px",
    paddingLeft: "7px",
    borderRadius: "7px",
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
    fontSize: "10.5px",
    minWidth: 0,
  },
  muted: { color: tokens.colorNeutralForeground3 },
});

type RestoreProps = ReturnType<typeof useRestoreFocusTarget>;

function EmployeeDeskCard({
  employee: e,
  walker: w,
  measured,
  executive = false,
  onAssign,
  onOpenEmployee,
  onOpenMission,
  restore,
}: {
  employee: EmployeeCard;
  walker: WalkerState | undefined;
  measured: boolean;
  executive?: boolean;
  onAssign: (employeeId: string) => void;
  onOpenEmployee: (employeeId: string) => void;
  onOpenMission: (missionId: string) => void;
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
    <article className={mergeClasses(s.deskArticle, executive && s.ceoArticle)} aria-label={e.name}>
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
        <button
          type="button"
          className={s.deskStageBtn}
          aria-label={t("office.floor.openProfileAria", { name: e.name })}
          title={t("office.floor.openProfileAria", { name: e.name })}
          onClick={() => onOpenEmployee(e.id)}
        >
          <div className={s.chairAnchorWrap}>
            <span data-wp={`desk-${e.id}`} style={{ position: "absolute", left: "50%", bottom: "-4px", width: 0, height: 0, pointerEvents: "none" }} aria-hidden />
            {!atDeskNow && awayReason && (
              <span className={s.awayNote} aria-hidden>
                {awayReason}
              </span>
            )}
          </div>
          {deskArt}
        </button>
      )}

      <div className={o.between} style={{ gap: "6px", width: "100%", alignItems: "center" }}>
        <Button className={s.empNameBtn} appearance="transparent" onClick={() => onOpenEmployee(e.id)}>
          {e.name}
        </Button>
        <WorkLabelBadge label={e.workLabel} />
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
    </article>
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
  const [walkers, setWalkers] = useState<WalkerState[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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
  const hoveredIdRef = useRef(hoveredId);

  useEffect(() => {
    simItemsRef.current = simItems;
  }, [simItems]);

  useEffect(() => {
    hoveredIdRef.current = hoveredId;
  }, [hoveredId]);

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
        walkersRef.current = resnapIdleWalkers(stepWalkers(walkersRef.current, simItemsRef.current, nextWps, 0, hoveredIdRef.current), nextWps);
      }
      setWalkers(walkersRef.current);
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
      walkersRef.current = stepWalkers(walkersRef.current, simItemsRef.current, wpsRef.current, dtMs, hoveredIdRef.current);
      renderAccumMs += dtMs;
      if (renderAccumMs >= 32) {
        renderAccumMs = 0;
        setWalkers(walkersRef.current);
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

  // When an active walker gets clicked cleanly by desk stage, also sync any immediate route updates
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

  return (
    <div ref={buildingRef} className={s.building}>
      {/* Compact Company Floor HUD */}
      <div className={s.topHud}>
        <div className={s.hudLeft}>
          <IconBadge icon={<OfficeIcon size={15} active />} tone="brand" size="sm" />
          <Text weight="semibold" size={300}>
            {t("office.floor.companyFloor")}
          </Text>
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
        <Text size={100} className={s.muted} aria-hidden>
          {t("office.floor.hudHint")}
        </Text>
      </div>

      {/* Top Wing: Director's Office (left) & Pantry & Lounge (right) */}
      <div className={s.topWing}>
        <span data-wp="hall-aisle" style={{ position: "absolute", left: "50%", top: 0, width: 0, height: 0, pointerEvents: "none" }} aria-hidden />

        <section className={s.execRoom} aria-label={t("office.floor.directorsOffice")}>
          <div className={mergeClasses(s.roomTitleBar, s.deptTitleBar)}>
            <div className={s.roomHead}>
              <span className={s.roomTag}>
                <span className={s.dot} style={{ backgroundColor: "#3b82f6" }} aria-hidden />
                <Text as="h3" weight="semibold" size={200} className={o.wrap}>
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
              <PixelBookshelfSvg />
              {ceoEmployee !== null ? (
                <EmployeeDeskCard
                  employee={ceoEmployee}
                  walker={walkerById.get(ceoEmployee.id)}
                  measured={measured}
                  executive
                  onAssign={onAssign}
                  onOpenEmployee={onOpenEmployee}
                  onOpenMission={onOpenMission}
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
                  <GatherNamePill name={directorName} dotColor="#3b82f6" suffix={t("office.floor.directorSuffix")} />
                </div>
              )}
            </div>
            <div className={s.visitorsCluster}>
              <span data-wp="director-visitor-0" style={{ position: "relative", width: "2px", height: "44px" }} aria-hidden />
              <span data-wp="director-visitor-1" style={{ position: "relative", width: "2px", height: "44px" }} aria-hidden />
              {directorCount === 0 && (
                <Text size={100} className={s.muted} style={{ position: "absolute", right: "2px", bottom: "2px" }} aria-hidden>
                  {t("office.floor.directorEmptyNote")}
                </Text>
              )}
            </div>
          </div>
          <span className={s.doorwayBottom} data-wp="director-door" aria-hidden />
        </section>

        <section className={s.execRoom} aria-label={t("office.floor.pantryTitle")}>
          <div className={s.roomTitleBar}>
            <span className={s.roomTag}>
              <span className={s.dot} style={{ backgroundColor: "#16a34a" }} aria-hidden />
              <Text as="h3" weight="semibold" size={200} className={o.wrap}>
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
              <span data-wp="pantry-coffee" style={{ position: "absolute", left: "18%", bottom: "16px", width: 0, height: 0 }} aria-hidden />
              <span data-wp="pantry-sofa" style={{ position: "absolute", left: "50%", bottom: "14px", width: 0, height: 0 }} aria-hidden />
              <span data-wp="pantry-pingpong" style={{ position: "absolute", left: "82%", bottom: "16px", width: 0, height: 0 }} aria-hidden />
              {pantryCount === 0 && (
                <Text size={100} className={s.muted} aria-hidden>
                  {t("office.floor.pantryEmptyNote")}
                </Text>
              )}
            </div>
          </div>
          <span className={s.doorwayBottom} data-wp="pantry-door" aria-hidden />
        </section>
      </div>

      {/* Central Hardwood Hallway */}
      <div className={s.hallway} aria-hidden>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
          <PixelPlantSvg variant="green" />
          <span>{t("office.floor.hallwayLeft")}</span>
        </span>
        <span data-wp="hall-center" className={s.anchorDot} />
        {groups.length > 0 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
            <span>{t("office.floor.hallwayRight")}</span>
            <PixelPlantSvg variant="autumn" />
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
                <span className={s.doorwayTop} data-wp={`dept-door-${deptKey}`} aria-hidden />
                <div className={mergeClasses(s.roomTitleBar, s.deptTitleBar)}>
                  <div className={s.roomHead}>
                    <div className={o.row}>
                      <span className={s.dot} style={{ backgroundColor: accent.dot }} aria-hidden />
                      <Text as="h3" weight="semibold" size={300} className={o.wrap}>
                        {roomName}
                      </Text>
                      <Text size={200} className={mergeClasses(s.muted, s.countPill)}>
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
                  <div className={s.emptyFloor} style={{ backgroundColor: accent.tint }}>
                    <PixelEmptyDeskClusterSvg />
                    <Text size={200} className={s.muted}>
                      {t("office.floor.noEmployeeHere", { suffix: filter === "all" ? t("office.floor.noEmployeeYet") : t("office.floor.noEmployeeMatches") })}
                    </Text>
                  </div>
                ) : (
                  <div className={s.desksGrid} style={{ padding: "32px 14px 14px", borderRadius: "12px", backgroundColor: accent.tint }}>
                    {g.employees.map((e) => (
                      <EmployeeDeskCard
                        key={e.id}
                        employee={e}
                        walker={walkerById.get(e.id)}
                        measured={measured}
                        onAssign={onAssign}
                        onOpenEmployee={onOpenEmployee}
                        onOpenMission={onOpenMission}
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
          {walkers.map((w) => {
            const e = allEmployees.find((emp) => emp.id === w.id);
            if (!e) return null;
            const isCeo = (ceoEmployee !== null && e.id === ceoEmployee.id) || e.role === "ceo";
            const seatedAtDesk = w.zone === "desk" && !w.walking && w.path.length === 0;
            const isHovered = hoveredId === e.id;
            const iconText = w.walking
              ? "🚶"
              : w.path.length > 0 || w.zone === "hallway"
                ? "💬"
                : w.zone === "pantry"
                  ? "☕"
                  : undefined;
            return (
              <button
                key={w.id}
                type="button"
                className={s.walkerBtn}
                aria-label={t("office.floor.assignWorkTo", { name: e.name })}
                title={e.employment === "archived" ? t("office.floor.openProfileTitle", { name: e.name }) : t("office.floor.assignWorkTo", { name: e.name })}
                style={{
                  transform: seatedAtDesk
                    ? `translate3d(${Math.round(w.x)}px, ${Math.round(w.y)}px, 0) translate(-50%, -100%)`
                    : `translate3d(${Math.round(w.x)}px, ${Math.round(w.y)}px, 0) translate(-50%, -86%)`,
                }}
                onMouseEnter={() => setHoveredId(e.id)}
                onMouseLeave={() => setHoveredId((cur) => (cur === e.id ? null : cur))}
                onClick={() => (e.employment === "archived" ? onOpenEmployee(e.id) : onAssign(e.id))}
                {...restore}
              >
                {!w.walking && <PixelQuestBubble workLabel={e.workLabel} title={e.holding?.title ?? null} />}
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
                {!seatedAtDesk && (
                  <GatherNamePill
                    name={e.name}
                    dotColor={dotColorOf(e.workLabel)}
                    suffix={isCeo ? t("office.leadership.ceo") : undefined}
                    iconText={iconText}
                    selected={isHovered}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
      {appointing && <AppointmentDialog edit={appointing} onClose={() => setAppointing(null)} onDone={() => setAppointing(null)} />}
    </div>
  );
}
