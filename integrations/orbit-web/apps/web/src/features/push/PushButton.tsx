// PUSH BRANCH, in an open chat's header -- for a chat whose repository came from GitHub or Azure DevOps. Orbit Web
// pushes the chat's working branch itself, with the source's own sign-in (GitHub CLI's, or the Azure CLI's): at once
// where the account's policy simply allows it, otherwise after the account's owner approves exactly that push -- the
// commit, the branch, the remote, where the remote's branch stood. Claude Code never holds the sign-in for it. Pushing
// is a protected action of the chat's own account: its owner asks for it and approves it, here; somebody the chat was
// shared with reads and talks in it, but does not push it.
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, MessageBar, MessageBarBody, Text, Tooltip, makeStyles } from "@fluentui/react-components";
import { ArrowUpload20Regular } from "@fluentui/react-icons";
import type { AgentPushResult, ApprovalList, ApprovalView, SessionDetail } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { t as tr, useI18n } from "../../i18n";
import { errorText, get, send } from "../../services/api";
import { ApprovalCard } from "../governance/ApprovalCard";
import { Word, when } from "../governance/parts";

const useStyles = makeStyles({
  surface: { width: "min(680px, 96vw)", maxWidth: "min(680px, 96vw)" },
  body: { display: "flex", flexDirection: "column", gap: "12px" },
  compact: { minWidth: "44px", minHeight: "44px", flexShrink: 0 },
  list: { display: "flex", flexDirection: "column", gap: "4px", paddingLeft: 0, marginTop: 0, marginBottom: 0, listStyleType: "none" },
});

const sourceName = (source: SessionDetail["source"]): string => tr(source === "azure" ? "chat.push.azureDevOps" : "chat.push.github");

function PushBody({ session }: { session: SessionDetail }) {
  const { t } = useI18n();
  const s = useStyles();
  const owner = session.access === "owner";
  const [approval, setApproval] = useState<ApprovalView | null>(null);
  // What a push the account's policy simply allows came to: it was made at once, and no approval exists for it.
  const [pushed, setPushed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const earlier = useResource<ApprovalList>(owner ? () => get(`/api/sessions/${session.id}/pushes`) : null, [session.id, owner, approval?.state]);

  if (!owner) {
    return (
      <MessageBar intent="info">
        <MessageBarBody>{t("chat.push.sharedOnly", { owner: session.owner ? ` (${session.owner})` : "" })}</MessageBarBody>
      </MessageBar>
    );
  }
  const prepare = () => {
    setBusy(true);
    setError(null);
    void send<AgentPushResult & { approval: ApprovalView | null }>("POST", `/api/sessions/${session.id}/push`, {})
      .then((r) => (r.approval === null ? setPushed(r.message) : setApproval(r.approval)))
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };
  return (
    <div className={s.body}>
      <Text>
        {t("chat.push.introBeforeBranch")}
        <b>{session.workBranch}</b>
        {t("chat.push.introMiddle")}
        <b>{session.repository}</b>
        {t("chat.push.introAfter", { source: sourceName(session.source) })}
      </Text>
      {approval === null && pushed === null && (
        <div>
          <Button appearance="primary" icon={<ArrowUpload20Regular />} disabled={busy || session.workBranch === null} onClick={prepare}>
            {busy ? t("chat.push.workingOut") : t("chat.push.prepare")}
          </Button>
        </div>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {pushed && (
        <MessageBar intent="success">
          <MessageBarBody>{pushed}</MessageBarBody>
        </MessageBar>
      )}
      {approval && <ApprovalCard approval={approval} inline onChanged={setApproval} />}
      {earlier.data && earlier.data.approvals.length > 0 && (
        <ul className={s.list} aria-label={t("chat.push.earlierAria")}>
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
  const { t } = useI18n();
  const s = useStyles();
  const [open, setOpen] = useState(false);
  if (session.source === null) return null;
  return (
    <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <Tooltip content={t("chat.push.tooltip", { source: sourceName(session.source) })} relationship="description">
        <Button className={compact ? s.compact : undefined} size="small" appearance="subtle" icon={<ArrowUpload20Regular />} aria-label={t("chat.push.btnAria")} onClick={() => setOpen(true)}>
          {!compact && t("chat.push.btn")}
        </Button>
      </Tooltip>
      <DialogSurface className={s.surface}>
        <DialogBody>
          <DialogTitle>{t("chat.push.dialogTitle")}</DialogTitle>
          <DialogContent>{open && <PushBody session={session} />}</DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>{t("chat.push.close")}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
