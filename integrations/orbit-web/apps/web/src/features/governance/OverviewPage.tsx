// What governance stands on right now: the Constitution in effect, who and what is under it, what waits for a person,
// whether the agent's isolation was shown (and how), and whether the audit record's chain holds.
import { Button, MessageBar, MessageBarBody, Spinner, Text } from "@fluentui/react-components";
import { Board16Regular, DocumentCheckmark16Regular, History16Regular, ShieldCheckmark16Regular } from "@fluentui/react-icons";
import type { ChainVerification, GovernanceOverview } from "@orbit-web/contracts";
import { useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { useOperator } from "../../services/operator";
import { Card, Stat, Word, short, useParts, when } from "./parts";

export function OverviewPage({ go }: { go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  const { can } = useOperator();
  const overview = useResource<GovernanceOverview>(() => get("/api/governance/overview"), []);
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useAppEvent("governance.changed", () => void overview.reload());
  useAppEvent("approval.changed", () => void overview.reload());

  if (overview.data === null) return overview.error ? <MessageBar intent="error"><MessageBarBody>{overview.error}</MessageBarBody></MessageBar> : <Spinner label="Reading the overview…" />;
  const o = overview.data;
  const verify = () => {
    setError(null);
    setVerifying(true);
    void send<ChainVerification>("POST", "/api/governance/audit/verify")
      .then(setVerification)
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setVerifying(false));
  };
  const chain = verification ?? o.audit.lastVerification;

  return (
    <div className={s.page}>
      <Card title="Now" icon={<Board16Regular />}>
        <div className={s.grid}>
          <Stat label="Active operators" value={o.counts.operators} onClick={() => go("operators")} />
          <Stat label="Active agents" value={o.counts.agents} onClick={() => go("agents")} />
          <Stat label="Governed workspaces" value={o.counts.governedWorkspaces} onClick={() => go("agents")} />
          <Stat label="Approvals waiting" value={o.counts.pendingApprovals} tone={o.counts.pendingApprovals > 0 ? "warning" : "neutral"} onClick={() => go("approvals")} />
          <Stat label="Open findings" value={o.counts.openFindings} tone={o.counts.openFindings > 0 ? "danger" : "neutral"} onClick={() => go("findings")} />
          <Stat label="Revisions in review" value={o.counts.revisionsInReview} tone={o.counts.revisionsInReview > 0 ? "warning" : "neutral"} onClick={() => go("constitution")} />
        </div>
      </Card>
      <div className={s.bento}>
        <Card
          title="Constitution in effect"
          icon={<DocumentCheckmark16Regular />}
          actions={
            <Button size="small" shape="circular" onClick={() => go("constitution")}>
              Open
            </Button>
          }
        >
          {o.effective === null ? (
            <MessageBar intent="warning">
              <MessageBarBody>No Constitution is published: a governed workspace runs nothing, and nothing an agent asks is allowed, until one is.</MessageBarBody>
            </MessageBar>
          ) : (
            <div className={s.inset}>
              <Text>
                Revision {o.effective.revision}, published {when(o.effective.publishedAt)} · digest{" "}
                <span className={s.codeChip}>{short(o.effective.digest, 16)}</span>
              </Text>
            </div>
          )}
        </Card>
        <Card
          title="Audit record"
          icon={<History16Regular />}
          actions={
            can("audit.verify") ? (
              <Button size="small" shape="circular" disabled={verifying} onClick={verify}>
                {verifying ? "Verifying…" : "Verify the chain"}
              </Button>
            ) : undefined
          }
        >
          <div className={s.inset}>
            <Text>
              {o.audit.count} record(s) · head <span className={s.codeChip}>{short(o.audit.head, 16)}</span>
            </Text>
          </div>
          {chain && (
            <MessageBar intent={chain.ok ? "success" : "error"}>
              <MessageBarBody>
                {chain.ok ? `The chain holds: ${chain.count} record(s), checked ${when(chain.checkedAt)}.` : `The chain does NOT hold at record ${chain.brokenAt} (${chain.problem}).`}
              </MessageBarBody>
            </MessageBar>
          )}
          {error && (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}
          <Text size={200} className={s.muted}>
            The chain shows a record changed, removed or reordered after it was written. It is tamper evidence on this host, not proof against somebody who controls the host and every copy of its head.
          </Text>
        </Card>
      </div>
      <Card title={<>Agent isolation <Word value={o.isolation.state} /></>} icon={<ShieldCheckmark16Regular />}>
        <Text>{o.isolation.detail}</Text>
        {o.isolation.checks.length > 0 && (
          <ul className={s.list} aria-label="Isolation checks">
            {o.isolation.checks.map((c) => (
              <li key={c.name} className={s.inset}>
                <div className={s.row}>
                  <Word value={c.ok ? "allow" : "deny"} label={c.ok ? "held" : "failed"} />
                  <Text className={s.mono}>{c.name}</Text>
                </div>
                <Text size={200} className={s.muted}>
                  {c.detail}
                </Text>
              </li>
            ))}
          </ul>
        )}
        {o.isolation.checkedAt && (
          <Text size={200} className={s.muted}>
            Checked {when(o.isolation.checkedAt)} -- the agent container's own answer: a check of the deployment's wiring, not proof against a runner the agent has taken over.
          </Text>
        )}
      </Card>
    </div>
  );
}
