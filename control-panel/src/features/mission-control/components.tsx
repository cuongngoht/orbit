import type { ReactNode } from "react";
import { useState } from "react";
import { Badge, Button, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle, makeStyles, tokens } from "@fluentui/react-components";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../shared/api/client";
import { ConfirmDialog } from "../../shared/components/ConfirmDialog";
import { ErrorState } from "../../shared/components/ErrorState";
import { missionKeys, useDecision, type DecisionRequest } from "./mission.api";
import type { Tone } from "./missionWords";

const useStyles = makeStyles({
  facts: { display: "grid", gridTemplateColumns: "max-content 1fr", columnGap: tokens.spacingHorizontalL, rowGap: tokens.spacingVerticalXS, margin: 0 },
  term: { color: tokens.colorNeutralForeground3 },
  value: { margin: 0, minWidth: 0, overflowWrap: "anywhere" },
  pair: { display: "contents" },
});

/** One engine word, in the tone its table gives it. The word is always shown. */
export function WordBadge({ word, tone, label }: { word: string; tone: Tone; label?: string }) {
  return (
    <Badge appearance="tint" color={tone}>
      {label ?? word}
    </Badge>
  );
}

/** Label and value pairs, as a description list a screen reader reads in order. */
export function Facts({ rows, label }: { rows: readonly (readonly [string, ReactNode])[]; label: string }) {
  const styles = useStyles();
  return (
    <dl className={styles.facts} aria-label={label}>
      {rows.map(([term, value]) => (
        <div key={term} className={styles.pair}>
          <dt className={styles.term}>{term}</dt>
          <dd className={styles.value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** What a person is about to confirm: the words the dialog says, and what happens when they press its button. */
export interface Confirming {
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  body: ReactNode;
  /** Runs when -- and only when -- the dialog's own button is pressed; the dialog stays up until it settles. */
  run: () => Promise<unknown>;
}

// The page's ONE confirmation dialog, hosted ABOVE the cards that open it: an approval card leaves the
// page the moment its approval is decided, and a dialog whose owner unmounts as it closes leaves the
// whole page hidden from assistive technology. Nothing is sent until the dialog's own button is
// pressed, and nothing is shown as done until the server answers.
export function useConfirm() {
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => setConfirming(null);
  const confirm = () => {
    if (!confirming) return;
    setBusy(true);
    confirming.run().catch(() => undefined).finally(() => { setBusy(false); close(); });
  };
  const dialog = (
    <ConfirmDialog open={confirming !== null} title={confirming?.title ?? ""} confirmLabel={confirming?.confirmLabel ?? ""} cancelLabel={confirming?.cancelLabel} destructive={confirming?.destructive} busy={busy} onConfirm={confirm} onCancel={close}>
      {confirming?.body}
    </ConfirmDialog>
  );
  return { ask: setConfirming, dialog };
}

/** What a person is about to decide about a task: the decision, and the words the dialog says about it. */
export interface Asking {
  request: DecisionRequest;
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  body: ReactNode;
}

// A task's decisions go through that one dialog; what a decision answered is `decide`'s to show, so a
// refusal is read from there and the dialog closes on either answer.
export function useDecisions() {
  const decide = useDecision();
  const { ask, dialog } = useConfirm();
  const asking = ({ request, ...words }: Asking) => ask({ ...words, run: () => decide.mutateAsync(request) });
  return { ask: asking, confirm: ask, dialog, decide };
}

// A decision the server refused, in its own words. A STALE one means the task moved after the page
// was read: it is never retried against what is there now -- the person reads the task again and
// decides again.
export function DecisionError({ error }: { error: unknown }) {
  const client = useQueryClient();
  if (!(error instanceof ApiError) || error.code !== "STALE_REVISION") return <ErrorState error={error} title="Your decision was not recorded" />;
  return (
    <MessageBar intent="warning" layout="multiline">
      <MessageBarBody>
        <MessageBarTitle>The task moved before your decision reached it</MessageBarTitle>
        {error.message} Nothing was recorded. Read it again, then decide on what is there now.
      </MessageBarBody>
      <MessageBarActions>
        <Button onClick={() => client.invalidateQueries({ queryKey: missionKeys.all })}>Load the latest</Button>
      </MessageBarActions>
    </MessageBar>
  );
}
