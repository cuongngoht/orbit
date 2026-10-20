import { Caption1, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Card } from "../../shared/components/Card";
import { formatDateTime } from "../../shared/format";
import { WordBadge } from "./components";
import { useTaskPlan } from "./mission.api";
import type { TaskRef, TaskView } from "./mission.types";
import type { Tone } from "./missionWords";
import type { PlanStep, PlanView, SkillRun, SkillRunStep } from "./plan.types";

// A coordinated workflow's PLAN on its task page (0.0.4): each step in the word its evidence earned, and under a
// playbook step the run a DECLARED playbook made of its workflow -- its pinned version, where it stands, and each of
// its steps as its receipts say: the provider it went through, how often it was asked again, what it waits for and
// the receipts it rests on. Every word is the server's projection (the live core's own planViewOf), the one a
// terminal's Plan view draws; this card only shows it, and a word it does not know is shown as it is.

const useStyles = makeStyles({
  wide: { gridColumn: "1 / -1" },
  line: { display: "flex", gap: tokens.spacingHorizontalS, alignItems: "center", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  mono: { fontFamily: tokens.fontFamilyMonospace, overflowWrap: "anywhere" },
  run: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, paddingInlineStart: tokens.spacingHorizontalXL, borderInlineStartWidth: tokens.strokeWidthThick, borderInlineStartStyle: "solid", borderInlineStartColor: tokens.colorNeutralStroke2 },
});

/** The tone of each word; the word itself is always shown, so a colour is never the only signal. */
const TONES: Record<string, Tone> = {
  VERIFIED: "success",
  DONE: "success",
  REPORTED: "warning",
  CONTRACT_MET: "warning",
  RUNNING: "brand",
  BINDING: "informative",
  VERIFYING: "informative",
  FAILED: "danger",
  VERIFY_FAILED: "danger",
  REFUSED: "danger",
  AMBIGUOUS: "danger",
  BLOCKED: "warning",
  INTERRUPTED: "warning",
  SKIPPED: "subtle",
  PENDING: "subtle",
};

const toneOf = (word: string): Tone => TONES[word] ?? "subtle";

/** What each step word of a run means, in a sentence: a met contract proves nothing past the call. */
const STEP_SAY: Record<string, string> = {
  VERIFIED: "answered, met its contract, and an owner's record proves it",
  CONTRACT_MET: "answered and met its contract — reported, not proven",
  VERIFY_FAILED: "answered, and its contract or the owner's record says no",
  FAILED: "its call failed, every retry spent",
  REFUSED: "its provider's owner gate refused the call",
  BLOCKED: "it could not run now",
  SKIPPED: "a step it reads from did not answer",
  INTERRUPTED: "what ran it is gone; it read, so the next attempt asks again",
  AMBIGUOUS: "it may have changed something — never asked again; a person decides",
  RUNNING: "its call is out",
  PENDING: "nothing has been recorded for it yet",
};

export function PlanCard({ view, taskRef }: { view: TaskView; taskRef: TaskRef }) {
  const styles = useStyles();
  const plan = useTaskPlan(taskRef, view.revision, view.task.provider === "automation");
  const p = plan.data?.plan ?? null;
  if (view.task.provider !== "automation") return null;
  return (
    <Card title="Plan" subtitle={subtitleOf(p, plan.isError)} className={styles.wide}>
      {p && <PlanTable plan={p} />}
    </Card>
  );
}

function subtitleOf(p: PlanView | null, failed: boolean): string {
  if (failed) return "The plan could not be read just now.";
  if (!p) return "Reading the plan…";
  const goal = p.goal ? ` · goal ${p.goal.goal}${p.goal.unit ? ` ${p.goal.unit}` : ""}` : "";
  return `plan-${p.n ?? "?"} (${p.workflow ?? "workflow"}) · ${p.steps.length} step(s)${p.replans.length ? ` · revised ${p.replans.length}×` : ""}${p.readable ? "" : " · read off its receipts"}${goal}`;
}

function PlanTable({ plan }: { plan: PlanView }) {
  return (
    <Table size="small" aria-label="Plan steps">
      <TableHeader>
        <TableRow>
          <TableHeaderCell>Step</TableHeaderCell>
          <TableHeaderCell>State</TableHeaderCell>
          <TableHeaderCell>Why it is in the plan</TableHeaderCell>
        </TableRow>
      </TableHeader>
      <TableBody>
        {plan.steps.map((s) => (
          <StepRows key={s.id} step={s} runs={plan.runs.filter((r) => r.step === s.id)} />
        ))}
      </TableBody>
    </Table>
  );
}

function StepRows({ step, runs }: { step: PlanStep; runs: SkillRun[] }) {
  const styles = useStyles();
  return (
    <>
      <TableRow>
        <TableCell>
          <Text weight="semibold">{step.id}</Text>
          {step.after.length > 0 && <Caption1 className={styles.muted}> ← {step.after.join(", ")}</Caption1>}
        </TableCell>
        <TableCell>
          <WordBadge word={step.state} tone={toneOf(step.state)} />
        </TableCell>
        <TableCell>{step.because}</TableCell>
      </TableRow>
      {runs.map((r) => (
        <TableRow key={r.run}>
          <TableCell colSpan={3}>
            <RunView run={r} />
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

function RunView({ run }: { run: SkillRun }) {
  const styles = useStyles();
  return (
    <div className={styles.run} aria-label={`Skill run ${run.run}`}>
      <span className={styles.line}>
        <Text weight="semibold">Skill {String(run.pin ?? "a playbook").split(":")[0]}</Text>
        <WordBadge word={run.state} tone={toneOf(run.state)} />
        <span className={styles.mono}>{run.pin}</span>
        <Caption1 className={styles.muted}>{run.calls} call(s)</Caption1>
      </span>
      {run.unread && <Caption1 className={styles.muted}>Its workflow could not be read: these are the steps its receipts name.</Caption1>}
      <Table size="extra-small" aria-label={`Steps of ${run.run}`}>
        <TableHeader>
          <TableRow>
            <TableHeaderCell>Step</TableHeaderCell>
            <TableHeaderCell>State</TableHeaderCell>
            <TableHeaderCell>Provider</TableHeaderCell>
            <TableHeaderCell>What it rests on</TableHeaderCell>
          </TableRow>
        </TableHeader>
        <TableBody>
          {run.steps.map((s) => (
            <RunStepRow key={s.id} step={s} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RunStepRow({ step }: { step: SkillRunStep }) {
  const styles = useStyles();
  return (
    <TableRow>
      <TableCell>
        <Text weight="semibold">{step.id}</Text>
        <Caption1 className={styles.muted}> {step.capability}{step.tool ? ` · ${step.tool}` : ""}</Caption1>
      </TableCell>
      <TableCell>
        <span className={styles.line}>
          <WordBadge word={step.word} tone={toneOf(step.word)} />
          {step.waiting && <Caption1>waits for {step.waiting}</Caption1>}
          {step.retries > 0 && <Caption1>asked again {step.retries}×</Caption1>}
        </span>
        <Caption1 className={styles.muted}>{STEP_SAY[step.word] ?? step.because}</Caption1>
      </TableCell>
      <TableCell>
        <span className={styles.mono}>{step.provider ?? "—"}</span>
        {step.startedAt && <Caption1 className={styles.muted}> since {formatDateTime(step.startedAt)}</Caption1>}
      </TableCell>
      <TableCell>
        {[step.verification?.evidence, step.invocation, step.receipt].filter(Boolean).map((ref) => (
          <div key={ref} className={styles.mono}>
            {ref}
          </div>
        ))}
      </TableCell>
    </TableRow>
  );
}
