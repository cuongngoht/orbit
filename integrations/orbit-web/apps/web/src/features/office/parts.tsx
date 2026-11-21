// What every page of the office shares: the network disclosure, a work label said as text, when the page's data was
// read (or that the live connection is lost), a refusal said as it was -- with "Load the latest" when the record moved
// on since the page read it, never a silent retry -- and the words of a run's state.
import { Badge, Button, MessageBar, MessageBarActions, MessageBarBody, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { WORK_LABEL_TEXT, type AssignmentState, type RunState, type WorkLabel } from "@orbit-web/contracts";
import { useState } from "react";
import { errorText, isStale } from "../../services/api";
import { useAppStream } from "../../services/events/AppEvents";

// The one sentence a person reads wherever an employee's network access matters: Governance, Hire → Review, Assign.
export const NETWORK_DISCLOSURE = "In Autonomous mode an employee can send the data of its assignment to any public website. Use Restricted mode, or do not give it data that must not leave.";

export const useOfficeStyles = makeStyles({
  page: { display: "flex", flexDirection: "column", gap: "16px", maxWidth: "1120px", width: "100%", marginLeft: "auto", marginRight: "auto", boxSizing: "border-box", minWidth: 0 },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    paddingTop: "16px",
    paddingRight: "16px",
    paddingBottom: "16px",
    paddingLeft: "16px",
    "@media (max-width: 639px)": { paddingTop: "12px", paddingRight: "12px", paddingBottom: "12px", paddingLeft: "12px" },
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    borderRadius: "14px",
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "var(--orbit-soft-shadow)",
    minWidth: 0,
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: "12px", minWidth: 0 },
  row: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", minWidth: 0 },
  between: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap", minWidth: 0 },
  stack: { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  warn: { color: tokens.colorPaletteDarkOrangeForeground1 },
  danger: { color: tokens.colorPaletteRedForeground1 },
  list: { display: "flex", flexDirection: "column", gap: "8px", listStyleType: "none", margin: 0, paddingLeft: 0, minWidth: 0 },
  item: { display: "flex", flexDirection: "column", gap: "4px", paddingTop: "10px", paddingRight: "12px", paddingBottom: "10px", paddingLeft: "12px", borderRadius: "12px", backgroundColor: tokens.colorNeutralBackground2, minWidth: 0 },
  inset: { display: "flex", flexDirection: "column", gap: "6px", paddingTop: "10px", paddingRight: "12px", paddingBottom: "10px", paddingLeft: "12px", borderRadius: "12px", backgroundColor: tokens.colorNeutralBackground2, minWidth: 0 },
  mono: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, wordBreak: "break-all" },
  wrap: { overflowWrap: "anywhere", minWidth: 0 },
  tableWrap: { width: "100%", overflowX: "auto", minWidth: 0 },
  // A control a finger can hit on a touch screen.
  touch: { "@media (pointer: coarse)": { minHeight: "44px", minWidth: "44px" } },
  form: { display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 },
  formGrid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px", "@media (max-width: 639px)": { gridTemplateColumns: "1fr" } },
  dl: { display: "grid", gridTemplateColumns: "minmax(0, 180px) minmax(0, 1fr)", gap: "4px 12px", margin: 0, "@media (max-width: 479px)": { gridTemplateColumns: "1fr" } },
  dt: { color: tokens.colorNeutralForeground3 },
  dd: { margin: 0, overflowWrap: "anywhere", minWidth: 0 },
  disclosure: { display: "flex", flexDirection: "column", gap: "4px" },
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
  return (
    <Badge appearance="tint" color={WORK_TONE[label]} style={{ borderRadius: "9999px", whiteSpace: "nowrap", flexShrink: 0 }}>
      {WORK_LABEL_TEXT[label]}
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
  return (
    <Badge appearance="tint" color={(state && STATE_TONE[state]) ?? "informative"} style={{ borderRadius: "9999px", whiteSpace: "nowrap", flexShrink: 0 }}>
      {text}
    </Badge>
  );
}

export const RUN_STATE_TEXT: Record<RunState, string> = {
  requested: "Requested",
  waiting_for_resources: "Waiting for resources",
  unschedulable: "Cannot start as configured",
  starting: "Starting",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  interrupted: "Interrupted",
  cancelled: "Cancelled",
  unknown: "Unknown",
};

export const when = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

export const short = (hex: string | null | undefined, n = 12): string => (hex ? hex.slice(0, n) : "—");

// When the page's data was read -- or, once the live connection was open and is not now, that it is reconnecting (the
// data shown may be behind until it is back).
export function AsOf({ at }: { at: string | null }) {
  const s = useOfficeStyles();
  const { connected, generation } = useAppStream();
  if (generation > 0 && !connected)
    return (
      <Text size={200} className={s.warn} role="status">
        Connection lost — reconnecting…
      </Text>
    );
  return (
    <Text size={200} className={s.muted}>
      {at ? `Data as of ${when(at)}` : "Reading…"}
    </Text>
  );
}

// A refusal as the API said it; when the record moved on since the page read it, the way to read it again.
export interface Problem {
  text: string;
  stale: boolean;
}

export const problemOf = (err: unknown, staleText = "This changed since the page read it: nothing was done."): Problem => ({ text: isStale(err) ? staleText : errorText(err), stale: isStale(err) });

export function ProblemBar({ problem, onLoadLatest }: { problem: Problem | null; onLoadLatest?: () => void }) {
  if (problem === null) return null;
  return (
    <MessageBar intent={problem.stale ? "warning" : "error"} layout="multiline">
      <MessageBarBody>{problem.text}</MessageBarBody>
      {problem.stale && onLoadLatest && (
        <MessageBarActions>
          <Button size="small" onClick={onLoadLatest}>
            Load the latest
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
  const s = useOfficeStyles();
  return (
    <MessageBar intent="warning" layout="multiline">
      <MessageBarBody>
        <span className={s.disclosure}>
          <Text weight="semibold" size={200}>
            Network access
          </Text>
          <Text size={200}>{NETWORK_DISCLOSURE}</Text>
        </span>
      </MessageBarBody>
    </MessageBar>
  );
}
