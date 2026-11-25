// What every page of the office shares: the network disclosure, a work label said as text, when the page's data was
// read (or that the live connection is lost), a refusal said as it was -- with "Load the latest" when the record moved
// on since the page read it, never a silent retry -- and the words of a run's state.
import { Badge, Button, MessageBar, MessageBarActions, MessageBarBody, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { WORK_LABEL_TEXT, type AssignmentState, type RunState, type WorkLabel } from "@orbit-web/contracts";
import { useState, type ReactNode } from "react";
import { IconBadge, type IconTone } from "../../components/SectionIcons";
import { t, useI18n, type I18nContextValue, type MessageKey } from "../../i18n";
import { errorText, isStale } from "../../services/api";
import { useAppStream } from "../../services/events/AppEvents";

// The one sentence a person reads wherever an employee's network access matters: Governance, Hire → Review, Assign.
export const NETWORK_DISCLOSURE = t("office.shared.networkDisclosure");

export const useOfficeStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: "12px", maxWidth: "1160px", width: "100%", marginLeft: "auto", marginRight: "auto", boxSizing: "border-box", minWidth: 0 },
  headingReset: { marginTop: 0, marginBottom: 0 },
  heroCard: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    paddingTop: "13px",
    paddingRight: "18px",
    paddingBottom: "13px",
    paddingLeft: "18px",
    "@media (max-width: 639px)": { paddingTop: "12px", paddingRight: "12px", paddingBottom: "12px", paddingLeft: "12px" },
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    borderRadius: "16px",
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "var(--orbit-soft-shadow)",
    minWidth: 0,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    paddingTop: "16px",
    paddingRight: "20px",
    paddingBottom: "16px",
    paddingLeft: "20px",
    "@media (max-width: 639px)": { paddingTop: "14px", paddingRight: "14px", paddingBottom: "14px", paddingLeft: "14px" },
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    borderRadius: "16px",
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "var(--orbit-soft-shadow)",
    minWidth: 0,
  },
  cardInteractive: {
    transitionProperty: "box-shadow, border-color, transform",
    transitionDuration: "160ms",
    transitionTimingFunction: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    ":hover": {
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
      boxShadow: tokens.shadow8,
      transform: "translateY(-1px)",
    },
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 290px), 1fr))", gap: "14px", minWidth: 0 },
  statGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    gap: "8px",
    minWidth: 0,
    "@media (min-width: 480px) and (max-width: 900px)": { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" },
    "@media (max-width: 479px)": { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
  },
  statCard: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    minHeight: "38px",
    paddingTop: "6px",
    paddingRight: "10px",
    paddingBottom: "6px",
    paddingLeft: "10px",
    borderRadius: "10px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
    overflow: "hidden",
    textAlign: "left",
  },
  statCardAction: {
    cursor: "pointer",
    fontFamily: "inherit",
    color: "inherit",
    transitionProperty: "background-color, border-color, box-shadow",
    transitionDuration: "140ms",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      ...shorthands.borderColor(tokens.colorBrandStroke1),
      boxShadow: tokens.shadow4,
    },
    ":focus-visible": {
      ...shorthands.outline("2px", "solid", tokens.colorStrokeFocus2),
      outlineOffset: "2px",
    },
  },
  dangerMenuItem: { color: tokens.colorPaletteRedForeground1 },
  row: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", minWidth: 0 },
  between: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap", minWidth: 0 },
  stack: { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  warn: { color: tokens.colorPaletteDarkOrangeForeground1 },
  danger: { color: tokens.colorPaletteRedForeground1 },
  list: { display: "flex", flexDirection: "column", gap: "10px", listStyleType: "none", marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, paddingLeft: 0, minWidth: 0 },
  item: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
  },
  inset: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
  },
  callout: {
    display: "flex",
    alignItems: "flex-start",
    gap: "8px",
    paddingTop: "8px",
    paddingRight: "12px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    borderRadius: "10px",
    fontSize: tokens.fontSizeBase200,
    lineHeight: tokens.lineHeightBase200,
    minWidth: 0,
  },
  calloutInfo: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    ...shorthands.border("1px", "solid", tokens.colorBrandStroke2),
  },
  calloutWarn: {
    backgroundColor: tokens.colorPaletteDarkOrangeBackground1,
    color: tokens.colorPaletteDarkOrangeForeground1,
    ...shorthands.border("1px", "solid", tokens.colorPaletteDarkOrangeBorder1),
  },
  calloutDanger: {
    backgroundColor: tokens.colorPaletteRedBackground1,
    color: tokens.colorPaletteRedForeground1,
    ...shorthands.border("1px", "solid", tokens.colorPaletteRedBorder1),
  },
  calloutIcon: { flexShrink: 0, marginTop: "2px", display: "inline-flex" },
  calloutBody: { flexGrow: 1, minWidth: 0, overflowWrap: "anywhere" },
  divider: { height: "1px", width: "100%", backgroundColor: tokens.colorNeutralStroke2, flexShrink: 0 },
  emptyState: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    gap: "10px",
    paddingTop: "36px",
    paddingRight: "24px",
    paddingBottom: "36px",
    paddingLeft: "24px",
    borderRadius: "16px",
    ...shorthands.border("1px", "dashed", tokens.colorNeutralStroke1),
    backgroundColor: tokens.colorNeutralBackground2,
    minWidth: 0,
  },
  emptyIcon: {
    width: "44px",
    height: "44px",
    borderRadius: "12px",
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, wordBreak: "break-all" },
  wrap: { overflowWrap: "anywhere", minWidth: 0 },
  tableWrap: { width: "100%", overflowX: "auto", minWidth: 0 },
  // A control a finger can hit on a touch screen.
  touch: { "@media (pointer: coarse)": { minHeight: "44px", minWidth: "44px" } },
  form: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "12px", alignItems: "start", "@media (max-width: 639px)": { gridTemplateColumns: "1fr" } },
  dl: { display: "grid", gridTemplateColumns: "minmax(0, 180px) minmax(0, 1fr)", gap: "6px 14px", marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, "@media (max-width: 479px)": { gridTemplateColumns: "1fr" } },
  dt: { color: tokens.colorNeutralForeground3 },
  dd: { marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, overflowWrap: "anywhere", minWidth: 0 },
  disclosure: { display: "flex", flexDirection: "column", gap: "4px" },
  // Tabs that do not fit a narrow screen scroll sideways inside their own strip, never the page.
  tabStrip: { overflowX: "auto", minWidth: 0, maxWidth: "100%", paddingTop: "2px", paddingRight: "2px", paddingBottom: "2px", paddingLeft: "2px", ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2) },
  asOfRow: { display: "inline-flex", alignItems: "center", gap: "6px" },
  liveDot: { width: "7px", height: "7px", borderRadius: "9999px", flexShrink: 0, backgroundColor: tokens.colorPaletteGreenForeground1 },
  lostDot: { width: "7px", height: "7px", borderRadius: "9999px", flexShrink: 0, backgroundColor: tokens.colorPaletteDarkOrangeForeground1, animationName: "orbit-pulse", animationDuration: "1.6s", animationIterationCount: "infinite" },
  badgeInner: { display: "inline-flex", alignItems: "center", gap: "5px" },
  badgeDot: { width: "6px", height: "6px", borderRadius: "9999px", backgroundColor: "currentColor", flexShrink: 0 },
});

type Tone = "brand" | "danger" | "important" | "informative" | "severe" | "subtle" | "success" | "warning";

const WORK_TONE: Record<WorkLabel, Tone> = {
  ready: "success",
  working: "brand",
  waiting_resources: "warning",
  waiting_team: "informative",
  waiting_info: "warning",
  waiting_review: "important",
  paused: "subtle",
  cancelling: "warning",
  reconciling: "warning",
  not_ready: "danger",
};

// An employee's work label, as words (a colour never says it alone).
export function WorkLabelBadge({ label }: { label: WorkLabel }) {
  const s = useOfficeStyles();
  return (
    <Badge appearance="tint" color={WORK_TONE[label]} style={{ borderRadius: "9999px", whiteSpace: "nowrap", flexShrink: 0 }}>
      <span className={s.badgeInner}>
        <span className={s.badgeDot} aria-hidden />
        <span>{WORK_LABEL_TEXT[label]}</span>
      </span>
    </Badge>
  );
}

const STATE_TONE: Partial<Record<AssignmentState, Tone>> = {
  QUEUED: "subtle",
  RUNNING: "brand",
  BLOCKED: "danger",
  PAUSED: "subtle",
  AWAITING_ACCEPTANCE: "important",
  COMPLETED: "success",
  CANCELLED: "subtle",
  FAILED_FINAL: "danger",
  RECOVERING: "warning",
};

export function StateBadge({ text, state }: { text: string; state?: AssignmentState }) {
  const s = useOfficeStyles();
  return (
    <Badge appearance="tint" color={(state && STATE_TONE[state]) ?? "informative"} style={{ borderRadius: "9999px", whiteSpace: "nowrap", flexShrink: 0 }}>
      <span className={s.badgeInner}>
        <span className={s.badgeDot} aria-hidden />
        <span>{text}</span>
      </span>
    </Badge>
  );
}

const AVATAR_TONES = [
  { bg: tokens.colorBrandBackground2, fg: tokens.colorBrandForeground1 },
  { bg: tokens.colorPaletteTealBackground2, fg: tokens.colorPaletteTealForeground2 },
  { bg: tokens.colorPaletteGrapeBackground2, fg: tokens.colorPaletteGrapeForeground2 },
  { bg: tokens.colorPaletteMarigoldBackground2, fg: tokens.colorPaletteMarigoldForeground2 },
  { bg: tokens.colorPaletteForestBackground2, fg: tokens.colorPaletteForestForeground2 },
  { bg: tokens.colorPaletteBerryBackground2, fg: tokens.colorPaletteBerryForeground2 },
] as const;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function toneIndexOf(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % AVATAR_TONES.length;
}

export function EmployeeAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const tone = AVATAR_TONES[toneIndexOf(name)]!;
  const px = size === "sm" ? 30 : size === "lg" ? 48 : 38;
  const fontSize = size === "sm" ? "11px" : size === "lg" ? "16px" : "13px";
  return (
    <span
      aria-hidden
      style={{
        width: `${px}px`,
        height: `${px}px`,
        borderRadius: "12px",
        backgroundColor: tone.bg,
        color: tone.fg,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 600,
        fontSize,
        letterSpacing: "0.02em",
        flexShrink: 0,
      }}
    >
      {initialsOf(name)}
    </span>
  );
}

export function Callout({ tone, icon, children, role }: { tone: "info" | "warn" | "danger"; icon?: ReactNode; children: ReactNode; role?: "status" }) {
  const s = useOfficeStyles();
  const toneClass = tone === "danger" ? s.calloutDanger : tone === "warn" ? s.calloutWarn : s.calloutInfo;
  return (
    <div className={mergeClasses(s.callout, toneClass)} role={role}>
      {icon && (
        <span className={s.calloutIcon} aria-hidden>
          {icon}
        </span>
      )}
      <div className={s.calloutBody}>{children}</div>
    </div>
  );
}

export function EmptyState({ icon, tone = "brand", title, body, action }: { icon?: ReactNode; tone?: IconTone; title: string; body?: string; action?: ReactNode }) {
  const s = useOfficeStyles();
  return (
    <div className={s.emptyState}>
      {icon && <IconBadge icon={icon} tone={tone} size="lg" />}
      <Text weight="semibold" size={300} style={{ textAlign: "center" }}>
        {title}
      </Text>
      {body && (
        <Text size={200} className={s.muted} style={{ maxWidth: "420px", textAlign: "center" }}>
          {body}
        </Text>
      )}
      {action}
    </div>
  );
}

export const RUN_STATE_TEXT: Record<RunState, string> = {
  requested: t("office.shared.runState.requested"),
  waiting_for_resources: t("office.shared.runState.waiting_for_resources"),
  unschedulable: t("office.shared.runState.unschedulable"),
  starting: t("office.shared.runState.starting"),
  running: t("office.shared.runState.running"),
  succeeded: t("office.shared.runState.succeeded"),
  failed: t("office.shared.runState.failed"),
  interrupted: t("office.shared.runState.interrupted"),
  cancelled: t("office.shared.runState.cancelled"),
  unknown: t("office.shared.runState.unknown"),
};

export const RUN_STATE_KEYS: Record<RunState, MessageKey> = {
  requested: "office.shared.runState.requested",
  waiting_for_resources: "office.shared.runState.waiting_for_resources",
  unschedulable: "office.shared.runState.unschedulable",
  starting: "office.shared.runState.starting",
  running: "office.shared.runState.running",
  succeeded: "office.shared.runState.succeeded",
  failed: "office.shared.runState.failed",
  interrupted: "office.shared.runState.interrupted",
  cancelled: "office.shared.runState.cancelled",
  unknown: "office.shared.runState.unknown",
};

export const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

export const whenSeconds = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium" }) : "—");

export const short = (hex: string | null | undefined, n = 12): string => (hex ? hex.slice(0, n) : "—");

export function humanizeActor(
  actor: string | null | undefined,
  assignments: readonly { employeeId: string; employeeName: string }[],
  tr: I18nContextValue["t"],
): { label: string; raw: string | null } {
  if (!actor) return { label: "—", raw: null };
  if (actor.startsWith("owner:")) return { label: tr("office.mission.actorOwner"), raw: actor };
  if (actor.startsWith("agent:employee:") || actor.startsWith("employee:")) {
    const empId = actor.startsWith("agent:employee:") ? actor.slice("agent:employee:".length) : actor.slice("employee:".length);
    const match = assignments.find((a) => a.employeeId === empId);
    return { label: match?.employeeName ?? empId.slice(0, 8), raw: actor };
  }
  if (actor === "system:admission") return { label: tr("office.mission.actorAdmission"), raw: actor };
  if (actor === "system:execution-worker") return { label: tr("office.mission.actorWorker"), raw: actor };
  if (actor === "system:scheduler") return { label: tr("office.mission.actorScheduler"), raw: actor };
  return { label: actor, raw: null };
}

export function humanizeWaitingOn(raw: string, tr: I18nContextValue["t"]): string {
  if (raw === "owner_review") return tr("office.mission.waitingOnReadable.owner_review");
  if (raw === "information") return tr("office.mission.waitingOnReadable.information");
  return raw;
}

// When the page's data was read -- or, once the live connection was open and is not now, that it is reconnecting (the
// data shown may be behind until it is back).
export function AsOf({ at }: { at: string | null }) {
  const { t: tr } = useI18n();
  const s = useOfficeStyles();
  const { connected, generation } = useAppStream();
  if (generation > 0 && !connected)
    return (
      <span className={s.asOfRow}>
        <span className={s.lostDot} aria-hidden />
        <Text size={200} className={s.warn} role="status">
          {tr("office.shared.connectionLost")}
        </Text>
      </span>
    );
  return (
    <span className={s.asOfRow}>
      <span className={s.liveDot} aria-hidden />
      <Text size={200} className={s.muted}>
        {at ? tr("office.shared.dataAsOf", { at: when(at) }) : tr("office.shared.reading")}
      </Text>
    </span>
  );
}

// A refusal as the API said it; when the record moved on since the page read it, the way to read it again.
export interface Problem {
  text: string;
  stale: boolean;
}

export const problemOf = (err: unknown, staleText = t("office.shared.staleDefault")): Problem => ({ text: isStale(err) ? staleText : errorText(err), stale: isStale(err) });

export function ProblemBar({ problem, onLoadLatest }: { problem: Problem | null; onLoadLatest?: () => void }) {
  const { t: tr } = useI18n();
  if (problem === null) return null;
  return (
    <MessageBar intent={problem.stale ? "warning" : "error"} layout="multiline">
      <MessageBarBody>{problem.text}</MessageBarBody>
      {problem.stale && onLoadLatest && (
        <MessageBarActions>
          <Button size="small" onClick={onLoadLatest}>
            {tr("office.shared.loadLatest")}
          </Button>
        </MessageBarActions>
      )}
    </MessageBar>
  );
}

// One action at a time, with its refusal kept: `run` resolves true when the action went through.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const run = async (work: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      return true;
    } catch (err) {
      setProblem(problemOf(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, problem, setProblem, run };
}

export function Disclosure() {
  const { t: tr } = useI18n();
  const s = useOfficeStyles();
  return (
    <MessageBar intent="warning" layout="multiline">
      <MessageBarBody>
        <span className={s.disclosure}>
          <Text weight="semibold" size={200}>
            {tr("office.shared.networkAccessTitle")}
          </Text>
          <Text size={200}>{tr("office.shared.networkDisclosure")}</Text>
        </span>
      </MessageBarBody>
    </MessageBar>
  );
}
