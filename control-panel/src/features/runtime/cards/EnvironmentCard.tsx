import { useState } from "react";
import { Button, Caption1, MessageBar, MessageBarBody, Text, makeStyles, tokens } from "@fluentui/react-components";
import { mutationToken } from "../../../shared/api/client";
import { Card } from "../../../shared/components/Card";
import { ConfirmDialog } from "../../../shared/components/ConfirmDialog";
import { ErrorState } from "../../../shared/components/ErrorState";
import { StateBadge } from "../StateBadge";
import { runtimeApi, useRuntimeOperation } from "../runtime.api";
import type { CheckoutRef, Instance, PrepareResult, Proposal, RuntimeStatus, ValidateResult } from "../runtime.types";
import { ProposalReview } from "./ProposalReview";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM },
  actions: { display: "flex", gap: tokens.spacingHorizontalS, flexWrap: "wrap" },
  rows: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
  muted: { color: tokens.colorNeutralForeground3 },
});

type Empty = Record<string, never>;

const needsValidation = (i: Instance) => i.provider === "devcontainer" && (i.state === "ADOPTED" || i.state === "VALIDATION_FAILED");

// An environment to run things in is OPTIONAL: native running needs no container. It is designed
// only when asked, as a proposal that writes nothing; written only when a person adopts it; and
// started only after it was validated -- which is a separate, slow act that spends the machine.
export function EnvironmentCard({ at, status }: { at: CheckoutRef; status: RuntimeStatus }) {
  const styles = useStyles();
  const [open, setOpen] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const design = useRuntimeOperation<Empty, Proposal>(at, (ref) => runtimeApi.design(ref));
  const prepare = useRuntimeOperation<Empty, PrepareResult>(at, (ref) => runtimeApi.prepare(ref));
  const validate = useRuntimeOperation<Empty, ValidateResult>(at, (ref) => runtimeApi.validate(ref));
  const discovered = status.understanding.state !== "NOT_DISCOVERED";
  const off = !mutationToken();
  const shown = open ?? status.proposals[0]?.id ?? null;
  return (
    <Card title="Environment" subtitle="Optional. Native running needs no container. An environment is designed when you ask, written when you adopt it, and started only once it was validated.">
      <div className={styles.stack}>
        <Instances instances={status.instances} />
        <div className={styles.actions}>
          <Button appearance="primary" disabled={off || !discovered || design.isPending} onClick={() => design.mutate({}, { onSuccess: (p) => setOpen(p.id) })}>{design.isPending ? "Designing…" : "Design an environment"}</Button>
          <Button disabled={off || prepare.isPending} onClick={() => prepare.mutate({})}>What would it take?</Button>
          {status.instances.some(needsValidation) && <Button disabled={off || validate.isPending} onClick={() => setAsking(true)}>{validate.isPending ? "Validating…" : "Validate the environment"}</Button>}
        </div>
        {!discovered && <Caption1 className={styles.muted}>Read the checkout first: a design rests on what its files say.</Caption1>}
        {design.isError && <ErrorState error={design.error} title="No environment was designed" />}
        {prepare.isError && <ErrorState error={prepare.error} title="The plan could not be made" />}
        {prepare.data && <PlanNote plan={prepare.data} />}
        {validate.isError && <ErrorState error={validate.error} title="The environment was not validated" />}
        {validate.data && <MessageBar intent={validate.data.state === "VALIDATED" ? "success" : "error"}><MessageBarBody>{validate.data.state}: {validate.data.validation.because}</MessageBarBody></MessageBar>}
        {status.proposals.length > 1 && (
          <ul className={styles.rows} aria-label="Open proposals">
            {status.proposals.map((p) => <li key={p.id}><Button size="small" appearance={p.id === shown ? "primary" : "secondary"} onClick={() => setOpen(p.id)}>{`Review ${p.id}`}</Button> <StateBadge word={p.state} /> <Caption1>{p.because}</Caption1></li>)}
          </ul>
        )}
      </div>
      {shown && <ProposalReview at={at} id={shown} onPin={() => setOpen(shown)} />}
      <ConfirmDialog open={asking} title="Bring the environment up?" confirmLabel="Validate" busy={validate.isPending} onConfirm={() => validate.mutate({}, { onSettled: () => setAsking(false) })} onCancel={() => setAsking(false)}>
        <div className={styles.stack}>
          <Text>Validating builds the image and starts the container to see that the environment works. It can take minutes and spends this machine. Nothing in the repository changes.</Text>
          <Text>The definition may run commands of its own: an <b>initializeCommand</b> runs on THIS machine, not in the container. Read the proposal's risks before you go on.</Text>
        </div>
      </ConfirmDialog>
    </Card>
  );
}

function Instances({ instances }: { instances: Instance[] }) {
  const styles = useStyles();
  if (instances.length === 0) return <Caption1 className={styles.muted}>No environment has been adopted for this checkout.</Caption1>;
  return (
    <ul className={styles.rows} aria-label="Environments">
      {instances.map((i) => (
        <li key={i.id}>
          <Text weight="semibold">{i.provider}</Text> <StateBadge word={i.state} />
          {i.changed && <Caption1> edited since it was validated</Caption1>}
          {i.validation && <Caption1 className={styles.muted}> — {i.validation.because}</Caption1>}
        </li>
      ))}
    </ul>
  );
}

function PlanNote({ plan }: { plan: PrepareResult }) {
  const styles = useStyles();
  return (
    <MessageBar intent="info" layout="multiline">
      <MessageBarBody>
        A plan; nothing was done.
        {plan.plans.map((p) => (
          <div key={p.provider}>
            <Text weight="semibold">{p.provider}</Text>
            <ul className={styles.list}>
              {p.host.map((h) => <li key={h.say}>on this machine: {h.say}</li>)}
              {p.environment.map((e) => <li key={e.say}>{e.step}: {e.say}</li>)}
              <li>repository: {p.repository}</li>
            </ul>
          </div>
        ))}
      </MessageBarBody>
    </MessageBar>
  );
}
