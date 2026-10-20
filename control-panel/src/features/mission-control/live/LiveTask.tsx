import { Caption1, Tab, TabList, Text, makeStyles, tokens } from "@fluentui/react-components";
import { useState } from "react";
import { Card } from "../../../shared/components/Card";
import { formatElapsed } from "../../../shared/format";
import { ApprovalCard } from "../ApprovalCard";
import { Facts, WordBadge, type Asking } from "../components";
import type { TaskRef, TaskView } from "../mission.types";
import { LIFECYCLE, readinessTone, stageLabel, stopSay } from "../missionWords";
import { LiveConnectionBadge } from "./LiveConnectionBadge";
import { LiveSandboxConsole } from "./LiveSandboxConsole";
import { LiveTimeline } from "./LiveTimeline";
import { currentActivity } from "./live.reducer";
import type { CurrentActivity, LiveFilter, LiveState, QaProgress } from "./live.types";
import { FILTERS, isFilter } from "./liveWords";
import { progressOf, type CaseState, type Observation } from "./observation";
import type { OpenStream } from "./stream";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  head: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalL, alignItems: "baseline" },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
  ready: { display: "flex", gap: tokens.spacingHorizontalM, flexWrap: "wrap" },
  activity: { borderInlineStartWidth: "3px", borderInlineStartStyle: "solid", borderInlineStartColor: tokens.colorBrandStroke1, paddingInlineStart: tokens.spacingHorizontalM, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXS },
  activityTitle: { fontWeight: tokens.fontWeightSemibold, letterSpacing: "0.04em" },
  person: { borderTop: `2px solid ${tokens.colorPaletteYellowBorder2}`, borderBottom: `2px solid ${tokens.colorPaletteYellowBorder2}`, paddingBlock: tokens.spacingVerticalS, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  personTitle: { fontWeight: tokens.fontWeightSemibold },
  loop: { display: "flex", flexWrap: "wrap", gap: tokens.spacingHorizontalXS, alignItems: "center" },
  step: { color: tokens.colorNeutralForeground3 },
  here: { fontWeight: tokens.fontWeightSemibold, color: tokens.colorBrandForeground1 },
});

export interface LiveTaskProps {
  view: TaskView;
  taskRef: TaskRef;
  live: LiveState;
  now: number;
  onAsk: (asking: Asking) => void;
  onFollow: () => void;
  onUnfollow: () => void;
  onLoadEarlier: () => void;
  openStream?: OpenStream | null;
}

// Orbit LIVE: one task as it runs. Where it stands and for how long; what it is doing right now; a person's
// decision the moment one is asked for; the feed of every line its journal and its QA write, as they are
// written; and, below, what its application prints. Every word is a line the engine wrote -- no progress
// bar, no estimate, no reasoning.
export function LiveTask({ view, taskRef, live, now, onAsk, onFollow, onUnfollow, onLoadEarlier, openStream }: LiveTaskProps) {
  const styles = useStyles();
  const [filter, setFilter] = useState<LiveFilter>("all");
  const labels = new Map(view.actions.map((a) => [a.id, a.label ?? a.type]));
  const open = view.approvals.filter((a) => a.open);
  const activity = currentActivity(view, live.qa, labels);
  return (
    <Card title="Live" subtitle="What this task is doing, line by line as its journal is written." action={<LiveConnectionBadge connection={live.connection} replay={live.replay} />}>
      <div className={styles.stack}>
        <LiveHeader view={view} now={now} />
        <Loop rows={live.rows.filter((r) => r.stage).map((r) => r.line)} stage={view.stage} />
        {open.length > 0 && (
          <section className={styles.person} aria-label="Human approval required">
            <Text className={styles.personTitle}>
              <span role="img" aria-label="a person">👤</span> HUMAN APPROVAL REQUIRED
            </Text>
            {open.map((a) => (
              <ApprovalCard key={a.id} approval={a} taskRef={taskRef} revision={view.revision} objective={view.task.objective} onAsk={onAsk} />
            ))}
          </section>
        )}
        <Activity activity={activity} now={now} />
        <CheckProgress view={view} observations={live.activity} now={now} />
        {activity.kind === "qa" && <QaActivity qa={activity.qa} now={now} />}
        <TabList size="small" selectedValue={filter} onTabSelect={(_, d) => typeof d.value === "string" && isFilter(d.value) && setFilter(d.value)} aria-label="Which lines">
          {FILTERS.map((f) => (
            <Tab key={f.id} value={f.id}>
              {f.label}
            </Tab>
          ))}
        </TabList>
        <LiveTimeline rows={live.rows} hidden={live.hidden} filter={filter} following={live.following} newSinceFollow={live.newSinceFollow} onFollow={onFollow} onUnfollow={onUnfollow} onLoadEarlier={onLoadEarlier} />
        <LiveSandboxConsole taskRef={taskRef} active={!view.terminal} openStream={openStream} />
      </div>
    </Card>
  );
}

const elapsedOf = (view: TaskView, now: number) => (view.ended ? Date.parse(view.ended.at) : now) - Date.parse(view.task.createdAt);

function LiveHeader({ view, now }: { view: TaskView; now: number }) {
  const styles = useStyles();
  const r = view.readiness;
  const tick = (word: string) => (readinessTone(word) === "success" ? "✓" : readinessTone(word) === "danger" ? "✗" : "○");
  return (
    <div className={styles.stack}>
      <div className={styles.head}>
        <WordBadge word={view.lifecycle} tone={LIFECYCLE[view.lifecycle].tone} />
        <Text weight="semibold">{(view.stage ?? "no stage").toUpperCase()}</Text>
        <Text>{view.attempt.count ? `Attempt ${view.attempt.number} / ${view.attempt.limit ?? "?"}` : "No attempt yet"}</Text>
        <Text className={styles.mono} aria-label="Elapsed">{formatElapsed(elapsedOf(view, now))}</Text>
      </div>
      <div className={styles.ready} aria-label="Readiness">
        {(
          [
            ["Requirement", r.requirement.state],
            ["Environment", r.environment.state],
            ["Workspace", r.workspace.state],
          ] as const
        ).map(([name, word]) => (
          <Caption1 key={name}>{`${name} ${tick(word)}`}</Caption1>
        ))}
      </div>
    </div>
  );
}

// IMPLEMENT → BUILD → TEST → DIAGNOSE → FIX → … as the journal moved through them: a picture of the stage
// lines already in the feed, never a state machine of its own.
function Loop({ rows, stage }: { rows: string[]; stage: string | null }) {
  const styles = useStyles();
  const recent = rows.slice(-8);
  if (recent.length === 0) return null;
  return (
    <div className={styles.loop} aria-label="Stages so far">
      {recent.map((word, i) => (
        <span key={`${word}-${i}`} className={i === recent.length - 1 && word === stage ? styles.here : styles.step}>
          {i > 0 && "→ "}
          {word}
        </span>
      ))}
    </div>
  );
}

const activityWords = (a: CurrentActivity, now: number): { title: string; lines: string[] } => {
  if (a.kind === "ended") return { title: `✓ ${a.lifecycle}`, lines: [a.ended.summary ?? a.ended.because ?? stopSay(a.ended.stop) ?? ""].filter(Boolean) };
  if (a.kind === "approval") return { title: "👤 WAITING FOR A PERSON", lines: [`${a.approval.action} on ${a.approval.environment ?? "?"}`, a.approval.reason ?? ""].filter(Boolean) };
  if (a.kind === "paused") return { title: "⏸ PAUSED", lines: ["Nothing new starts until a person resumes it. Anything already running may still finish.", a.paused.because ?? ""].filter(Boolean) };
  if (a.kind === "blocked") return { title: `✗ BLOCKED: ${a.blocked.stop}`, lines: [stopSay(a.blocked.stop) ?? "", a.blocked.because ?? ""].filter(Boolean) };
  if (a.kind === "qa") return { title: `▶ ${(a.stage ?? "TESTING").toUpperCase()} · QA in the browser`, lines: [a.qa.step ? `${a.qa.step.verb}${a.qa.step.on ? ` ${a.qa.step.on}` : ""}` : "Starting", `running ${formatElapsed(now - Date.parse(a.qa.startedAt))}`] };
  if (a.kind === "dispatch") return { title: `▶ ${(a.stage ?? "WORKING").toUpperCase()} · ${a.via} ${a.provider ?? ""}`.trimEnd(), lines: [a.label, `running ${formatElapsed(now - Date.parse(a.action.startedAt))}`] };
  if (a.kind === "action") return { title: `▶ ${(a.stage ?? "WORKING").toUpperCase()}`, lines: [`${a.label} (${a.action.type})`, `running ${formatElapsed(now - Date.parse(a.action.startedAt))}`] };
  if (a.kind === "diagnosing") return { title: "◇ DIAGNOSING", lines: [a.lastFailure ? `Last failure: ${a.lastFailure}` : "", a.next ? `Next action: ${a.next}` : ""].filter(Boolean) };
  return { title: `● ${(a.stage ?? stageLabel(null)).toUpperCase()}`, lines: [LIFECYCLE[a.lifecycle].say] };
};

// The one place this card speaks to a screen reader on its own: when what the task is doing CHANGES, not
// on every line.
function Activity({ activity, now }: { activity: CurrentActivity; now: number }) {
  const styles = useStyles();
  const words = activityWords(activity, now);
  return (
    <section className={styles.activity} aria-label="Current activity">
      <Caption1 className={styles.muted}>CURRENT ACTIVITY</Caption1>
      <Text className={styles.activityTitle} aria-live="polite">
        {words.title}
      </Text>
      {words.lines.map((line) => (
        <Text key={line}>{line}</Text>
      ))}
    </section>
  );
}

// What a CHECK's runner reported while it ran (1.8.5): the check running now, else the last one observed. Only what
// was reported -- a total only when the runner said one, a case as what it came to, never "running now" -- and the
// receipt named beside it as the verdict, because an observation never is one.
const observedAction = (view: TaskView, observations: Readonly<Record<string, Observation>>) => {
  const order = view.actions.filter((a) => observations[a.id] !== undefined);
  return order.find((a) => a.state === "running") ?? order.at(-1) ?? null;
};

const CASE_GLYPH: Record<CaseState, string> = { passed: "✓", failed: "✗", skipped: "–", todo: "○", cancelled: "■" };

function CheckProgress({ view, observations, now }: { view: TaskView; observations: Readonly<Record<string, Observation>>; now: number }) {
  const styles = useStyles();
  const action = observedAction(view, observations);
  const o = action ? observations[action.id] : undefined;
  if (!action || !o) return null;
  const words = progressOf(o);
  const rows: (readonly [string, string])[] = [
    ["Check", `${(action.label ?? action.type)} · ${action.state}`],
    ...(o.why ? [["Why", o.why] as const] : []),
    ["Cases", words.unavailable ?? words.cases ?? "no case reported yet"],
    ...(words.total ? [["Reported", words.total] as const] : []),
    ...(o.adapter ? [["Read from", `${o.adapter.runner ?? o.adapter.id}, in the order the runner reported${words.onlyFailures ? ` · ${words.onlyFailures}` : ""}`] as const] : []),
    ...(action.state === "running" && o.lastPrintedAt ? [["Last printed", `${formatElapsed(now - Date.parse(o.lastPrintedAt))} ago · ${o.lines ?? 0} line(s)`] as const] : []),
    ["Verdict", action.state === "running" ? "not yet: the check's receipt is written when it ends" : action.receipts.length > 0 ? `the receipt ${action.receipts.at(-1) ?? ""}` : "reported, no receipt"],
  ];
  return (
    <section aria-label="Check progress">
      <Caption1 className={styles.muted}>WHAT THE RUNNER REPORTED</Caption1>
      <Facts label="What the check's runner reported" rows={rows.map(([k, v]) => [k, <span className={styles.mono}>{v}</span>] as const)} />
      {o.failures.slice(0, 3).map((f, i) => (
        <Text key={`${f.name ?? "failure"}-${i}`} className={styles.mono}>{`✗ ${f.name ?? "a case"} — ${f.category}${f.message ? `: ${f.message.replace(/\s+/g, " ")}` : ""}${f.location ? ` (${f.location})` : ""}`}</Text>
      ))}
      {o.recent.length > 0 && <Caption1 className={styles.mono}>{o.recent.slice(-6).reverse().map((c) => `${CASE_GLYPH[c.state]} ${c.name ?? c.key}${c.before ? ` (was ${c.before})` : ""}`).join("   ")}</Caption1>}
      {o.gaps.map((g) => (
        <Caption1 key={g} className={styles.muted}>{`⚠ ${g}`}</Caption1>
      ))}
    </section>
  );
}

// What the browser is doing, when QA is: only what its lines said. A step number out of a total is never
// shown, because nothing knows the total before the case ends.
function QaActivity({ qa, now }: { qa: QaProgress; now: number }) {
  const styles = useStyles();
  const rows: (readonly [string, string])[] = [
    ["Investigation", qa.id],
    ...(qa.mode ? [["Mode", qa.mode] as const] : []),
    ...(qa.step ? [["Current step", `${qa.step.verb}${qa.step.on ? ` ${qa.step.on}` : ""} · ${formatElapsed(now - Date.parse(qa.step.at))} ago`] as const] : []),
    ...(qa.url ? [["URL", qa.url] as const] : []),
    ...(qa.lastFailure ? [["Last failed request", `${qa.lastFailure.method ?? "?"} ${qa.lastFailure.endpoint ?? "?"} → ${qa.lastFailure.status ?? "failed"}`] as const] : []),
    ["Console", `${qa.consoleErrors} error(s)`],
    ["Evidence", `${qa.screenshots} screenshot(s)`],
    ["Steps", `${qa.steps}`],
    ...(qa.runs.passed + qa.runs.failed > 0 ? [["Cases", `${qa.runs.passed} passed · ${qa.runs.failed} not passed`] as const] : []),
  ];
  return (
    <section aria-label="Playwright">
      <Caption1 className={styles.muted}>PLAYWRIGHT</Caption1>
      <Facts label="What the browser is doing" rows={rows.map(([k, v]) => [k, <span className={styles.mono}>{v}</span>] as const)} />
    </section>
  );
}
