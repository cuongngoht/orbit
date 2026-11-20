// PUSH BRANCH, in an open chat's header -- for a chat whose repository came from GitHub or Azure DevOps. Orbit Web
// pushes the chat's working branch itself, with the source's own sign-in (GitHub CLI's, or the Azure CLI's), after a
// person approves exactly that push: the commit, the branch, the remote, where the remote's branch stood. Claude Code
// never holds the sign-in for it. Pushing is a protected action and Orbit Web's API is reachable from the agent's shell
// too, so it is asked for by an operator signed in to governance -- never by whoever reaches the page.
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, MessageBar, MessageBarBody, Spinner, Text, Tooltip, makeStyles } from "@fluentui/react-components";
import { ArrowUpload20Regular } from "@fluentui/react-icons";
import type { AgentPushResult, ApprovalList, ApprovalView, SessionDetail } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";
import { useOperator } from "../../services/operator";
import { ApprovalCard } from "../governance/ApprovalCard";
import { Word, when } from "../governance/parts";

const useStyles = makeStyles({
  surface: { width: "min(680px, 96vw)", maxWidth: "min(680px, 96vw)" },
  body: { display: "flex", flexDirection: "column", gap: "12px" },
  compact: { minWidth: "44px", minHeight: "44px", flexShrink: 0 },
  list: { display: "flex", flexDirection: "column", gap: "4px", paddingLeft: 0, marginTop: 0, marginBottom: 0, listStyleType: "none" },
});

const sourceName = (source: SessionDetail["source"]): string => (source === "azure" ? "Azure DevOps" : "GitHub");

function PushBody({ session }: { session: SessionDetail }) {
  const s = useStyles();
  const operator = useOperator();
  const [approval, setApproval] = useState<ApprovalView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const earlier = useResource<ApprovalList>(operator.state?.session ? () => get(`/api/sessions/${session.id}/pushes`) : null, [session.id, operator.state?.session?.operator.id, approval?.state]);

  if (!operator.loaded) return <Spinner label="Reading who is signed in…" />;
  if (!operator.state?.session) {
    return (
      <MessageBar intent="info">
        <MessageBarBody>
          Pushing is a protected action, made by Orbit Web after an operator approves it -- so it is asked for by an operator signed in to governance. <a href="#/governance/overview">Open Governance</a> to sign in
          {operator.state && !operator.state.initialized ? " (or enrol its first owner)" : ""}.
        </MessageBarBody>
      </MessageBar>
    );
  }
  const prepare = () => {
    setBusy(true);
    setError(null);
    void send<AgentPushResult & { approval: ApprovalView | null }>("POST", `/api/sessions/${session.id}/push`, {})
      .then((r) => setApproval(r.approval))
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };
  return (
    <div className={s.body}>
      <Text>
        Push <b>{session.workBranch}</b> to <b>{session.repository}</b> ({sourceName(session.source)}). Orbit Web reads the branch's commit from this chat's workspace, works out exactly what the push is, and asks for its approval;{" "}
        {operator.can("approvals.decide") ? "you approve it here, and Orbit Web pushes it with the source's sign-in." : "an operator who may approve pushes then decides it (Governance → Approvals)."}
      </Text>
      {approval === null && (
        <div>
          <Button appearance="primary" icon={<ArrowUpload20Regular />} disabled={busy || session.workBranch === null} onClick={prepare}>
            {busy ? "Working it out…" : "Prepare the push"}
          </Button>
        </div>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {approval && <ApprovalCard approval={approval} inline onChanged={setApproval} />}
      {earlier.data && earlier.data.approvals.length > 0 && (
        <ul className={s.list} aria-label="Earlier pushes">
          {earlier.data.approvals.slice(0, 5).map((a) => (
            <li key={a.id}>
              <Text size={200}>
                <Word value={a.state} /> {when(a.requestedAt)} · {String(a.params.commit ?? "").slice(0, 12)} → {String(a.params.branch ?? "")} {a.outcome ? `· ${a.outcome}` : ""}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PushButton({ session, compact }: { session: SessionDetail; compact: boolean }) {
  const s = useStyles();
  const [open, setOpen] = useState(false);
  if (session.source === null) return null;
  return (
    <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <Tooltip content={`Push this chat's branch to ${sourceName(session.source)}`} relationship="description">
        <Button className={compact ? s.compact : undefined} size="small" appearance="subtle" icon={<ArrowUpload20Regular />} aria-label="Push branch" onClick={() => setOpen(true)}>
          {!compact && "Push"}
        </Button>
      </Tooltip>
      <DialogSurface className={s.surface}>
        <DialogBody>
          <DialogTitle>Push branch</DialogTitle>
          <DialogContent>{open && <PushBody session={session} />}</DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
