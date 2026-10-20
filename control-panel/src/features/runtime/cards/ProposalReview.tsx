import { useState } from "react";
import { Button, Caption1, MessageBar, MessageBarBody, Text, makeStyles, tokens } from "@fluentui/react-components";
import { mutationToken } from "../../../shared/api/client";
import { Card } from "../../../shared/components/Card";
import { ConfirmDialog } from "../../../shared/components/ConfirmDialog";
import { ErrorState } from "../../../shared/components/ErrorState";
import { LoadingState } from "../../../shared/components/LoadingState";
import { StateBadge } from "../StateBadge";
import { runtimeApi, useProposal, useRuntimeOperation } from "../runtime.api";
import type { AdoptResult, CheckoutRef, Proposal } from "../runtime.types";
import { PROPOSAL_SAY } from "../runtimeWords";

const useStyles = makeStyles({
  stack: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS },
  file: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS },
  code: { fontFamily: tokens.fontFamilyMonospace, margin: 0, padding: tokens.spacingHorizontalS, overflow: "auto", maxHeight: "18rem", backgroundColor: tokens.colorNeutralBackground3, borderRadius: tokens.borderRadiusMedium },
  list: { margin: 0, paddingLeft: tokens.spacingHorizontalL },
  muted: { color: tokens.colorNeutralForeground3 },
});

// `onPin` is called when the person confirms: an adopted proposal is no longer an OPEN one, and the
// list that showed it would drop it -- along with the answer to what they just did.
export function ProposalReview({ at, id, onPin }: { at: CheckoutRef; id: string; onPin: () => void }) {
  const proposal = useProposal(at, id);
  if (proposal.isPending) return <LoadingState label="Reading the proposal…" />;
  if (proposal.isError) return <ErrorState error={proposal.error} title="Could not read the proposal" onRetry={() => proposal.refetch()} />;
  return <Reviewed at={at} proposal={proposal.data} onPin={onPin} />;
}

// What an environment would have to change to provide what this checkout needs -- as a PROPOSAL.
// It has written nothing: every file, every edit, every gap and every risk is shown as it is, and
// adopting is the one act on this page that writes the repository. It is a person's, it names the
// files, and it is refused if the understanding or an environment file moved since this was made.
function Reviewed({ at, proposal, onPin }: { at: CheckoutRef; proposal: Proposal; onPin: () => void }) {
  const styles = useStyles();
  const [asking, setAsking] = useState(false);
  const adopt = useRuntimeOperation<string, AdoptResult>(at, runtimeApi.adopt);
  const adoptable = (proposal.state === "CREATE" || proposal.state === "PATCH") && proposal.status === "open";
  const paths = [...proposal.files.create.map((f) => f.path), ...proposal.files.patch.map((f) => f.path)];
  return (
    <Card title={`Proposal ${proposal.id}`} subtitle="Review it before anything is written. It is yours to edit afterwards.">
      <div className={styles.stack}>
        <div><StateBadge word={proposal.state} /> <StateBadge word={proposal.status} /> <Text>{PROPOSAL_SAY[proposal.state]}</Text></div>
        <Caption1>{proposal.because}</Caption1>
        {proposal.files.create.map((f) => (
          <div key={f.path} className={styles.file}>
            <Text weight="semibold">Creates {f.path}</Text>
            <pre className={styles.code} aria-label={`Contents of ${f.path}`}>{f.text}</pre>
          </div>
        ))}
        {proposal.files.patch.map((f) => (
          <div key={f.path} className={styles.file}>
            <Text weight="semibold">Changes {f.path}: {f.edits.length} edit(s), and nothing else in it</Text>
            <pre className={styles.code} aria-label={`Edits to ${f.path}`}>{f.edits.map((e) => JSON.stringify(e)).join("\n")}</pre>
          </div>
        ))}
        <Lines label="What an environment would provide" lines={proposal.gaps.map((g) => `${g.id}: ${g.state}${g.because ? ` — ${g.because}` : ""}`)} />
        <Lines label="Nothing can provide these: a person decides" lines={proposal.unresolved.map((u) => `${u.id}: ${u.why}`)} />
        <Lines label="Risks" lines={proposal.risks} />
        <Lines label="Notes" lines={proposal.notes} />
        <div>
          <Button appearance="primary" disabled={!mutationToken() || !adoptable || adopt.isPending} onClick={() => setAsking(true)}>Adopt…</Button>
          {!adoptable && <Caption1 className={styles.muted}> {proposal.status === "adopted" ? "Already adopted." : "There is nothing to adopt in this proposal."}</Caption1>}
        </div>
        {adopt.isError && <ErrorState error={adopt.error} title="The proposal was not adopted" />}
        {adopt.data && (
          <MessageBar intent="success" layout="multiline">
            <MessageBarBody>
              Adopted {adopt.data.files.map((f) => `${f.path} (${f.created ? "created" : "patched"}, read back and verified)`).join(", ")}. Adopted is not validated: validating builds it.
            </MessageBarBody>
          </MessageBar>
        )}
      </div>
      <ConfirmDialog open={asking} title="Write these files into the repository?" confirmLabel="Adopt" busy={adopt.isPending} onConfirm={() => { onPin(); adopt.mutate(proposal.id, { onSettled: () => setAsking(false) }); }} onCancel={() => setAsking(false)}>
        <div className={styles.stack}>
          <Text>Adopting writes into your working tree, and only these paths:</Text>
          <ul className={styles.list}>{paths.map((p) => <li key={p}>{p}</li>)}</ul>
          <Text>Each file is read back and checked against the proposal. Nothing is committed.</Text>
        </div>
      </ConfirmDialog>
    </Card>
  );
}

function Lines({ label, lines }: { label: string; lines: string[] }) {
  const styles = useStyles();
  if (lines.length === 0) return null;
  return (
    <div>
      <Text weight="semibold">{label}</Text>
      <ul className={styles.list}>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  );
}
