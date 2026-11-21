import { Badge, Spinner, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import type { ConnectionState, SessionStatus } from "@orbit-web/contracts";

type Tone = "brand" | "danger" | "important" | "informative" | "severe" | "subtle" | "success" | "warning";

const useStyles = makeStyles({
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    borderRadius: "9999px",
    paddingTop: "2px",
    paddingRight: "8px",
    paddingBottom: "2px",
    paddingLeft: "8px",
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightMedium,
    lineHeight: "1.4",
    flexShrink: 0,
  },
  dot: {
    width: "6px",
    height: "6px",
    borderRadius: "9999px",
    flexShrink: 0,
  },
  preparing: { backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground2 },
  ready: { backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground2 },
  running: { backgroundColor: tokens.colorBrandBackground2, color: tokens.colorBrandForeground1 },
  completed: { backgroundColor: tokens.colorPaletteGreenBackground1, color: tokens.colorPaletteGreenForeground1 },
  failed: { backgroundColor: tokens.colorPaletteRedBackground1, color: tokens.colorPaletteRedForeground1 },
  interrupted: { backgroundColor: tokens.colorPaletteMarigoldBackground1, color: tokens.colorPaletteDarkOrangeForeground1 },
  dotReady: { backgroundColor: tokens.colorNeutralForeground4 },
  dotRunning: { backgroundColor: tokens.colorBrandForeground1, animationName: "orbit-pulse", animationDuration: "1.4s", animationIterationCount: "infinite" },
  dotCompleted: { backgroundColor: tokens.colorPaletteGreenForeground1 },
  dotFailed: { backgroundColor: tokens.colorPaletteRedForeground1 },
  dotInterrupted: { backgroundColor: tokens.colorPaletteDarkOrangeForeground1 },
});

const SESSION: Record<SessionStatus, { label: string; tone: keyof ReturnType<typeof useStyles> }> = {
  preparing: { label: "Preparing", tone: "preparing" },
  ready: { label: "Ready", tone: "ready" },
  running: { label: "Running", tone: "running" },
  completed: { label: "Completed", tone: "completed" },
  failed: { label: "Failed", tone: "failed" },
  interrupted: { label: "Interrupted", tone: "interrupted" },
  setup_failed: { label: "Setup failed", tone: "failed" },
};

const DOT_TONE: Record<SessionStatus, "dotReady" | "dotRunning" | "dotCompleted" | "dotFailed" | "dotInterrupted"> = {
  preparing: "dotRunning",
  ready: "dotReady",
  running: "dotRunning",
  completed: "dotCompleted",
  failed: "dotFailed",
  interrupted: "dotInterrupted",
  setup_failed: "dotFailed",
};

export function SessionStatusBadge({ status }: { status: SessionStatus }) {
  const styles = useStyles();
  const item = SESSION[status];
  const active = status === "running" || status === "preparing";
  return (
    <span className={mergeClasses(styles.pill, styles[item.tone])}>
      {active ? <Spinner size="extra-tiny" /> : <span className={mergeClasses(styles.dot, styles[DOT_TONE[status]])} aria-hidden />}
      <span>{item.label}</span>
    </span>
  );
}

const CONNECTION: Record<ConnectionState, { label: string; tone: Tone }> = {
  connected: { label: "Connected", tone: "success" },
  not_connected: { label: "Not connected", tone: "subtle" },
  expired: { label: "Expired", tone: "warning" },
  unavailable: { label: "Unavailable", tone: "danger" },
};

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const c = CONNECTION[state];
  return (
    <Badge appearance="tint" color={c.tone}>
      {c.label}
    </Badge>
  );
}
