// What governance stands on right now: the Constitution in effect, who and what is under it, what waits for a person,
// whether the agent's isolation was shown (and how), and whether the audit record's chain holds.
import { Button, MessageBar, MessageBarBody, Spinner, Text } from "@fluentui/react-components";
import type { ChainVerification, GovernanceOverview } from "@orbit-web/contracts";
import { useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";
import { useOperator } from "../../services/operator";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, Stat, Word, short, useParts, when } from "./parts";

export function OverviewPage({ go }: { go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  const { can } = useOperator();
  const overview = useResource<GovernanceOverview>(() => get("/api/governance/overview"), []);
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [error, setError] = useState<string | null>(null);
  useAppEvent("governance.changed", () => void overview.reload());
  useAppEvent("approval.changed", () => void overview.reload());

  if (overview.data === null) return overview.error ? <MessageBar intent="error"><MessageBarBody>{overview.error}</MessageBarBody></MessageBar> : <Spinner label="Reading the overview…" />;
  const o = overview.data;
  const verify = () => {
    setError(null);
    void send<ChainVerification>("POST", "/api/governance/audit/verify")
      .then(setVerification)
      .catch((err: unknown) => setError(errorText(err)));
  };
  const chain = verification ?? o.audit.lastVerification;

  return (
    <div className={s.page}>
      <Card title="Constitution in effect" actions={<Button onClick={() => go("constitution")}>Open</Button>}>
        {o.effective === null ? (
          <MessageBar intent="warning">
            <MessageBarBody>No Constitution is published: a governed workspace runs nothing, and nothing an agent asks is allowed, until one is.</MessageBarBody>
          </MessageBar>
        ) : (
          <Text>
            Revision {o.effective.revision}, published {when(o.effective.publishedAt)} · digest <span className={s.mono}>{short(o.effective.digest, 16)}</span>
          </Text>
        )}
      </Card>
      <Card title="Now">
        <div className={s.grid}>
          <Stat label="Active operators" value={o.counts.operators} />
          <Stat label="Active agents" value={o.counts.agents} />
          <Stat label="Governed workspaces" value={o.counts.governedWorkspaces} />
          <Stat label="Approvals waiting" value={o.counts.pendingApprovals} />
          <Stat label="Open findings" value={o.counts.openFindings} />
          <Stat label="Revisions in review" value={o.counts.revisionsInReview} />
        </div>
      </Card>
      <Card title={<>Agent isolation <Word value={o.isolation.state} /></>}>
        <Text>{o.isolation.detail}</Text>
        {o.isolation.checks.length > 0 && (
          <ul className={s.list} aria-label="Isolation checks">
            {o.isolation.checks.map((c) => (
              <li key={c.name} className={s.row}>
                <Word value={c.ok ? "allow" : "deny"} label={c.ok ? "held" : "failed"} />
                <Text className={s.mono}>{c.name}</Text>
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
      <Card title="Audit record" actions={can("audit.verify") ? <Button onClick={verify}>Verify the chain</Button> : undefined}>
        <Text>
          {o.audit.count} record(s) · head <span className={s.mono}>{short(o.audit.head, 16)}</span>
        </Text>
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
  );
}
