import { Badge, Spinner, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import type { ConnectionState, SessionStatus } from "@orbit-web/contracts";
import { useI18n, type MessageKey } from "../i18n";

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

const SESSION: Record<SessionStatus, { labelKey: MessageKey; tone: keyof ReturnType<typeof useStyles> }> = {
  preparing: { labelKey: "common.status.session.preparing", tone: "preparing" },
  ready: { labelKey: "common.status.session.ready", tone: "ready" },
  running: { labelKey: "common.status.session.running", tone: "running" },
  completed: { labelKey: "common.status.session.completed", tone: "completed" },
  failed: { labelKey: "common.status.session.failed", tone: "failed" },
  interrupted: { labelKey: "common.status.session.interrupted", tone: "interrupted" },
  setup_failed: { labelKey: "common.status.session.setup_failed", tone: "failed" },
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
  const { t } = useI18n();
  const styles = useStyles();
  const item = SESSION[status];
  const active = status === "running" || status === "preparing";
  return (
    <span className={mergeClasses(styles.pill, styles[item.tone])}>
      {active ? <Spinner size="extra-tiny" /> : <span className={mergeClasses(styles.dot, styles[DOT_TONE[status]])} aria-hidden />}
      <span>{t(item.labelKey)}</span>
    </span>
  );
}

const CONNECTION: Record<ConnectionState, { labelKey: MessageKey; tone: Tone }> = {
  connected: { labelKey: "common.status.connection.connected", tone: "success" },
  not_connected: { labelKey: "common.status.connection.not_connected", tone: "subtle" },
  expired: { labelKey: "common.status.connection.expired", tone: "warning" },
  unavailable: { labelKey: "common.status.connection.unavailable", tone: "danger" },
};

export function ConnectionBadge({ state }: { state: ConnectionState }) {
  const { t } = useI18n();
  const c = CONNECTION[state];
  return (
    <Badge appearance="tint" color={c.tone}>
      {t(c.labelKey)}
    </Badge>
  );
}
