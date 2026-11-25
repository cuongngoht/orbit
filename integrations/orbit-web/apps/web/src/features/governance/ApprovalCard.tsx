// ONE PROTECTED ACTION waiting for -- or decided by -- the account's owner: exactly what it is (the action's bound
// parameters and their fingerprint), what it would change (read from Orbit Web's own copy of the repository, never the
// agent's workspace), and the decision, which is the owner's alone (an agent never decides one). Approving binds the
// fingerprint shown here; for a push, Orbit Web then pushes at once.
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, MessageBar, MessageBarBody, Text, tokens } from "@fluentui/react-components";
import type { ApprovalView } from "@orbit-web/contracts";
import { useState } from "react";
import { useI18n } from "../../i18n";
import { errorText, send } from "../../services/api";
import { Card, ErrorBar, Word, byWhom, useParts, when } from "./parts";

const EMPLOYEE_PARAM_KEYS: Record<string, string> = {
  employeeId: "employee",
  targetEmployeeId: "target employee",
  fromEmployeeId: "from employee",
};

// `inline`: the card is already the confirmation (a chat's Push dialog), so approving asks nothing more.
export function ApprovalCard({
  approval,
  employeeNames,
  onChanged,
  inline = false,
}: {
  approval: ApprovalView;
  employeeNames?: ReadonlyMap<string, string>;
  onChanged: (a: ApprovalView) => void;
  inline?: boolean;
}) {
  const { t } = useI18n();
  const s = useParts();
  const [confirm, setConfirm] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
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
        setConfirmReject(false);
      });
  };
  const p = approval.params;
  const params = Object.entries(p).filter(([k]) => !["sourceRef", "sessionId"].includes(k));
  const timingExtra =
    approval.state === "pending"
      ? t("governance.approval.waitsUntil", { at: when(approval.expiresAt) })
      : approval.decidedAt
        ? t("governance.approval.decided", { at: when(approval.decidedAt) })
        : "";
  return (
    <Card
      title={
        <>
          {approval.summary} <Word value={approval.state} />
        </>
      }
      description={t("governance.approval.desc", {
        action: approval.action,
        askedAt: when(approval.requestedAt),
        by: byWhom(approval.requestedBy, employeeNames),
        extra: timingExtra,
      })}
    >
      <div className={s.inset}>
        <table aria-label={t("governance.approval.paramsAria")} style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {params.map(([k, v]) => {
              const labelKey = EMPLOYEE_PARAM_KEYS[k] ?? k;
              const resolvedName = typeof v === "string" ? employeeNames?.get(v) : undefined;
              return (
                <tr key={k}>
                  <td style={{ paddingRight: 14, paddingTop: 3, paddingBottom: 3, verticalAlign: "top", width: "120px" }}>
                    <Text size={200} className={s.muted}>
                      {labelKey}
                    </Text>
                  </td>
                  <td style={{ paddingTop: 3, paddingBottom: 3 }}>
                    <Text size={200} className={resolvedName ? undefined : s.mono} title={resolvedName && typeof v === "string" ? v : undefined}>
                      {v === null ? t("governance.approval.noneNewBranch") : (resolvedName ?? String(v))}
                    </Text>
                  </td>
                </tr>
              );
            })}
            <tr>
              <td style={{ paddingRight: 14, paddingTop: 4, paddingBottom: 2, verticalAlign: "top" }}>
                <Text size={200} weight="semibold">
                  {t("governance.approval.fingerprint")}
                </Text>
              </td>
              <td style={{ paddingTop: 4, paddingBottom: 2 }}>
                <span className={s.codeChip}>{approval.fingerprint}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {approval.change && (
        <>
          <Text size={200}>
            {t("governance.approval.diffStats", { commits: approval.change.commits, files: approval.change.files })}
            <span style={{ color: tokens.colorPaletteGreenForeground1 }}>+{approval.change.insertions}</span>{" "}
            <span style={{ color: tokens.colorPaletteRedForeground1 }}>−{approval.change.deletions}</span>
          </Text>
          {approval.change.diffstat && <pre className={s.pre}>{approval.change.diffstat}</pre>}
        </>
      )}
      {approval.outcome && (
        <MessageBar intent={approval.outcome.startsWith("pushed") ? "success" : "warning"}>
          <MessageBarBody>{approval.outcome}</MessageBarBody>
        </MessageBar>
      )}
      <ErrorBar text={error} />
      {approval.state === "pending" && (
        <div className={s.row}>
          <Button appearance="primary" disabled={busy} onClick={() => (inline ? act("grant", { fingerprint: approval.fingerprint }) : setConfirm(true))}>
            {inline
              ? approval.action === "repository.push"
                ? busy
                  ? t("governance.approval.pushing")
                  : t("governance.approval.approveAndPush")
                : t("governance.approval.approve")
              : t("governance.approval.approveEllipsis")}
          </Button>
          <Button disabled={busy} onClick={() => setConfirmReject(true)}>
            {t("governance.approval.reject")}
          </Button>
        </div>
      )}
      {approval.state === "granted" && (
        <div>
          <Button disabled={busy} onClick={() => act("execute")}>
            {t("governance.approval.carryItOut")}
          </Button>
        </div>
      )}
      <Dialog open={confirm} onOpenChange={(_, d) => setConfirm(d.open)}>
        <DialogSurface className="orbit-touch">
          <DialogBody>
            <DialogTitle>{t("governance.approval.confirmTitle")}</DialogTitle>
            <DialogContent>
              <Text block>{approval.summary}.</Text>
              <Text block size={200}>
                {t("governance.approval.confirmBodyBefore")}
                <span className={s.mono}>{approval.fingerprint}</span>
                {t("governance.approval.confirmBodyAfter")}
              </Text>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirm(false)}>{t("governance.approval.cancel")}</Button>
              <Button appearance="primary" disabled={busy} onClick={() => act("grant", { fingerprint: approval.fingerprint })}>
                {approval.action === "repository.push" ? t("governance.approval.approveAndPush") : t("governance.approval.approve")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
      <Dialog open={confirmReject} onOpenChange={(_, d) => !busy && setConfirmReject(d.open)}>
        <DialogSurface className="orbit-touch">
          <DialogBody>
            <DialogTitle>{t("governance.approval.rejectConfirmTitle")}</DialogTitle>
            <DialogContent>
              <Text block>{t("governance.approval.rejectConfirmBody", { summary: approval.summary })}</Text>
            </DialogContent>
            <DialogActions>
              <Button disabled={busy} onClick={() => setConfirmReject(false)}>
                {t("governance.approval.cancel")}
              </Button>
              <Button
                appearance="primary"
                disabled={busy}
                style={{ backgroundColor: tokens.colorPaletteRedBackground3, color: tokens.colorNeutralForegroundOnBrand }}
                onClick={() => act("reject", { fingerprint: approval.fingerprint })}
              >
                {t("governance.approval.reject")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </Card>
  );
}
