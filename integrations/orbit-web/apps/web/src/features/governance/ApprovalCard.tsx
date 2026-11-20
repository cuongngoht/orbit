// ONE PROTECTED ACTION waiting for -- or decided by -- a person: exactly what it is (the action's bound parameters and
// their fingerprint), what it would change (read from Orbit Web's own copy of the repository, never the agent's
// workspace), and the decision. Approving binds the fingerprint shown here; for a push, Orbit Web then pushes at once.
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, MessageBar, MessageBarBody, Text } from "@fluentui/react-components";
import type { ApprovalView } from "@orbit-web/contracts";
import { useState } from "react";
import { errorText, send } from "../../services/api";
import { useOperator } from "../../services/operator";
import { Card, Word, useParts, when } from "./parts";

// `inline`: the card is already the confirmation (a chat's Push dialog), so approving asks nothing more.
export function ApprovalCard({ approval, onChanged, inline = false }: { approval: ApprovalView; onChanged: (a: ApprovalView) => void; inline?: boolean }) {
  const s = useParts();
  const { can } = useOperator();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    void send<ApprovalView>("POST", `/api/governance/approvals/${approval.id}/${path}`, body)
      .then(onChanged)
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => {
        setBusy(false);
        setConfirm(false);
      });
  };
  const p = approval.params;
  const params = Object.entries(p).filter(([k]) => !["sourceRef", "sessionId"].includes(k));
  return (
    <Card title={<>{approval.summary} <Word value={approval.state} /></>}>
      <Text size={200} className={s.muted}>
        {approval.action} · asked {when(approval.requestedAt)} by {approval.requestedBy} · {approval.state === "pending" ? `waits until ${when(approval.expiresAt)}` : approval.decidedAt ? `decided ${when(approval.decidedAt)}` : ""}
      </Text>
      <table aria-label="What exactly is approved">
        <tbody>
          {params.map(([k, v]) => (
            <tr key={k}>
              <td style={{ paddingRight: 12, verticalAlign: "top" }}>
                <Text size={200}>{k}</Text>
              </td>
              <td>
                <Text size={200} className={s.mono}>
                  {v === null ? "none (a new branch)" : String(v)}
                </Text>
              </td>
            </tr>
          ))}
          <tr>
            <td style={{ paddingRight: 12 }}>
              <Text size={200} weight="semibold">
                fingerprint
              </Text>
            </td>
            <td>
              <Text size={200} className={s.mono}>
                {approval.fingerprint}
              </Text>
            </td>
          </tr>
        </tbody>
      </table>
      {approval.change && (
        <>
          <Text size={200}>
            {approval.change.commits} commit(s) · {approval.change.files} file(s) · +{approval.change.insertions} −{approval.change.deletions}
          </Text>
          {approval.change.diffstat && <pre className={s.pre}>{approval.change.diffstat}</pre>}
        </>
      )}
      {approval.outcome && (
        <MessageBar intent={approval.outcome.startsWith("pushed") ? "success" : "warning"}>
          <MessageBarBody>{approval.outcome}</MessageBarBody>
        </MessageBar>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {can("approvals.decide") && approval.state === "pending" && (
        <div className={s.row}>
          <Button appearance="primary" disabled={busy} onClick={() => (inline ? act("grant", { fingerprint: approval.fingerprint }) : setConfirm(true))}>
            {inline ? (approval.action === "repository.push" ? (busy ? "Pushing…" : "Approve and push") : "Approve") : "Approve…"}
          </Button>
          <Button disabled={busy} onClick={() => act("reject", { fingerprint: approval.fingerprint })}>
            Reject
          </Button>
        </div>
      )}
      {can("approvals.decide") && approval.state === "granted" && (
        <div>
          <Button disabled={busy} onClick={() => act("execute")}>
            Carry it out
          </Button>
        </div>
      )}
      <Dialog open={confirm} onOpenChange={(_, d) => setConfirm(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>Approve exactly this?</DialogTitle>
            <DialogContent>
              <Text block>{approval.summary}.</Text>
              <Text block size={200}>
                The approval is of fingerprint <span className={s.mono}>{approval.fingerprint}</span> and is spent once. If the commit, the branch or the remote moves before it is carried out, it is refused and asked for again.
              </Text>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirm(false)}>Cancel</Button>
              <Button appearance="primary" disabled={busy} onClick={() => act("grant", { fingerprint: approval.fingerprint })}>
                {approval.action === "repository.push" ? "Approve and push" : "Approve"}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </Card>
  );
}
