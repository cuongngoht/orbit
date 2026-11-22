// What the account's governance stands on right now: the account, its policy in effect, its chats and research
// workspaces and what runs or waits in them, the deployment's isolation of the agent -- said as the deployment fact it
// is, never as more -- and whether the account's audit record's chain holds.
import { Button, MessageBar, MessageBarBody, Spinner, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import {
  ApprovalsIcon,
  AuditChainIcon,
  FindingsIcon,
  OverviewIcon,
  PolicyIcon,
  ResearchIcon,
  ShieldClearIcon,
  WorkingIcon,
  WorkspacesIcon,
} from "../../components/SectionIcons";
import type { ChainVerification, Deployment, GovernanceOverview, RevisionSource } from "@orbit-web/contracts";
import { useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, ErrorBar, Stat, Word, plural, short, useParts, when } from "./parts";

// The deployment, said as what it is. In the single deployment every account's runs share one container with Orbit
// Web: an account id on a record separates their data, not their processes.
const DEPLOYMENT: Record<Deployment, string> = {
  single:
    "Single-container deployment: the agent runs in Orbit Web's own container, beside every other account's runs. Your records are your account's alone, but the agent's isolation from Orbit Web is not proven here.",
  governed: "Governed deployment: the agent runs in a container of its own, reached through a runner, and reaches the network only through Orbit Web's egress proxy.",
};

const SOURCE: Record<RevisionSource, string> = {
  owner: "Written by you",
  agent: "Proposed by an agent and confirmed by you",
  default: "The default policy Orbit Web published for your account",
  copy: "A copy of an earlier revision",
};

const useStyles = makeStyles({
  checkOk: { borderLeftWidth: "3px", borderLeftColor: tokens.colorPaletteGreenBorder2 },
  checkFail: { borderLeftWidth: "3px", borderLeftColor: tokens.colorPaletteRedBorder2 },
});

export function OverviewPage({ go }: { go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  const st = useStyles();
  const overview = useResource<GovernanceOverview>(() => get("/api/governance/overview"), []);
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useAppEvent("governance.changed", () => void overview.reload());
  useAppEvent("approval.changed", () => void overview.reload());

  if (overview.data === null)
    return overview.error ? (
      <MessageBar intent="error">
        <MessageBarBody>{overview.error}</MessageBarBody>
      </MessageBar>
    ) : (
      <Spinner label="Reading the overview…" />
    );
  const o = overview.data;
  const c = o.counts;
  const verify = () => {
    setError(null);
    setVerifying(true);
    void send<ChainVerification>("POST", "/api/governance/audit/verify")
      .then(setVerification)
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setVerifying(false));
  };
  const chain = verification ?? o.audit.lastVerification;
  const name = o.account.displayName || o.account.email;

  return (
    <div className={s.page}>
      <Card title="Now" icon={<OverviewIcon size={18} active />} tone="brand" description={`The governance of ${name}: your chats, your research and your policy. Nobody else's, and nobody else decides here.`}>
        <div className={s.grid}>
          <Stat label="Workspaces" value={c.workspaces} icon={<WorkspacesIcon size={14} />} iconTone="brand" onClick={() => go("workspaces")} />
          <Stat label="Research workspaces" value={c.researchWorkspaces} icon={<ResearchIcon size={14} />} iconTone="teal" onClick={() => go("research")} />
          <Stat label="Runs running" value={c.runningRuns} icon={<WorkingIcon size={14} />} iconTone={c.runningRuns > 0 ? "success" : "neutral"} />
          <Stat label="Approvals waiting" value={c.pendingApprovals} icon={<ApprovalsIcon size={14} />} iconTone={c.pendingApprovals > 0 ? "warning" : "neutral"} tone={c.pendingApprovals > 0 ? "warning" : "neutral"} onClick={() => go("approvals")} />
          <Stat label="Open findings" value={c.openFindings} icon={<FindingsIcon size={14} />} iconTone={c.openFindings > 0 ? "danger" : "neutral"} tone={c.openFindings > 0 ? "danger" : "neutral"} onClick={() => go("findings")} />
          <Stat label="Drafts" value={c.draftRevisions} icon={<PolicyIcon size={14} />} iconTone={c.draftRevisions > 0 ? "warning" : "neutral"} tone={c.draftRevisions > 0 ? "warning" : "neutral"} onClick={() => go("policy")} />
        </div>
      </Card>
      <div className={s.bento}>
        <Card
          title="Policy in effect"
          icon={<PolicyIcon size={18} />}
          tone="brand"
          actions={
            <Button size="small" shape="circular" onClick={() => go("policy")}>
              Open
            </Button>
          }
        >
          {o.effective === null ? (
            <MessageBar intent="warning">
              <MessageBarBody>No policy is in effect: nothing a run asks is allowed until you publish one.</MessageBarBody>
            </MessageBar>
          ) : (
            <div className={s.inset}>
              <Text>
                Revision {o.effective.revision}, published {when(o.effective.publishedAt)} · digest <span className={s.codeChip}>{short(o.effective.digest, 16)}</span>
              </Text>
              <Text size={200} className={s.muted}>
                {SOURCE[o.effective.source]}.
              </Text>
            </div>
          )}
          <Text size={200} className={s.muted}>
            {c.overrides === 0 ? "No override narrows it anywhere." : `${plural(c.overrides, "override")} narrow it, each for one chat or research workspace.`}
          </Text>
        </Card>
        <Card
          title="Audit record"
          icon={<AuditChainIcon size={18} />}
          tone="teal"
          actions={
            <Button size="small" shape="circular" disabled={verifying} onClick={verify}>
              {verifying ? "Verifying…" : "Verify the chain"}
            </Button>
          }
        >
          <div className={s.inset}>
            <Text>
              {plural(o.audit.count, "record")} · head <span className={s.codeChip}>{short(o.audit.head, 16)}</span>
            </Text>
          </div>
          {chain && (
            <MessageBar intent={chain.ok ? "success" : "error"}>
              <MessageBarBody>{chain.ok ? `The chain holds: ${plural(chain.count, "record")}, checked ${when(chain.checkedAt)}.` : `The chain does NOT hold at record ${chain.brokenAt} (${chain.problem}).`}</MessageBarBody>
            </MessageBar>
          )}
          <ErrorBar text={error} />
          <Text size={200} className={s.muted}>
            The chain shows a record of your account changed, removed or reordered after it was written. It is tamper evidence on this host, not proof against somebody who controls the host and every copy of its head.
          </Text>
        </Card>
      </div>
      <Card
        title={
          <>
            Agent isolation <Word value={o.isolation.state} />
          </>
        }
        icon={o.isolation.state === "attested" ? <ShieldClearIcon size={18} /> : <FindingsIcon size={18} />}
        tone={o.isolation.state === "attested" ? "success" : o.isolation.state === "failed" ? "danger" : "warning"}
      >
        <Text>{DEPLOYMENT[o.deployment]}</Text>
        <Text size={200} className={s.muted}>
          {o.isolation.detail.replace(/ -- /g, " — ")}
        </Text>
        {o.isolation.checks.length > 0 && (
          <ul className={s.list} aria-label="Isolation checks">
            {o.isolation.checks.map((check) => (
              <li key={check.name} className={mergeClasses(s.inset, check.ok ? st.checkOk : st.checkFail)}>
                <div className={s.row}>
                  <Word value={check.ok ? "allow" : "deny"} label={check.ok ? "held" : "failed"} />
                  <Text className={s.mono}>{check.name}</Text>
                </div>
                <Text size={200} className={s.muted}>
                  {check.detail}
                </Text>
              </li>
            ))}
          </ul>
        )}
        {o.isolation.checkedAt && (
          <Text size={200} className={s.muted}>
            Checked {when(o.isolation.checkedAt)} — the agent container's own answer: a check of the deployment's wiring, not proof against a runner the agent has taken over.
          </Text>
        )}
      </Card>
    </div>
  );
}
