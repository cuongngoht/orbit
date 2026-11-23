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
import { useI18n, type MessageKey } from "../../i18n";
import { errorText, get, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { Card, ErrorBar, Stat, Word, plural, short, useParts, when } from "./parts";

// The deployment, said as what it is. In the single deployment every account's runs share one container with Orbit
// Web: an account id on a record separates their data, not their processes.
const DEPLOYMENT_KEYS: Record<Deployment, MessageKey> = {
  single: "governance.overview.deployment.single",
  governed: "governance.overview.deployment.governed",
};

const SOURCE_KEYS: Record<RevisionSource, MessageKey> = {
  owner: "governance.overview.source.owner",
  agent: "governance.overview.source.agent",
  default: "governance.overview.source.default",
  copy: "governance.overview.source.copy",
};

const useStyles = makeStyles({
  checkOk: { borderLeftWidth: "3px", borderLeftColor: tokens.colorPaletteGreenBorder2 },
  checkFail: { borderLeftWidth: "3px", borderLeftColor: tokens.colorPaletteRedBorder2 },
});

export function OverviewPage({ go }: { go: (page: GovernancePage, item?: string | null) => void }) {
  const { t } = useI18n();
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
      <Spinner label={t("governance.overview.reading")} />
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
      <Card title={t("governance.overview.nowTitle")} icon={<OverviewIcon size={18} active />} tone="brand" description={t("governance.overview.nowDescription", { name })}>
        <div className={s.grid}>
          <Stat label={t("governance.overview.statWorkspaces")} value={c.workspaces} icon={<WorkspacesIcon size={14} />} iconTone="brand" onClick={() => go("workspaces")} />
          <Stat label={t("governance.overview.statResearch")} value={c.researchWorkspaces} icon={<ResearchIcon size={14} />} iconTone="teal" onClick={() => go("research")} />
          <Stat label={t("governance.overview.statRunning")} value={c.runningRuns} icon={<WorkingIcon size={14} />} iconTone={c.runningRuns > 0 ? "success" : "neutral"} />
          <Stat label={t("governance.overview.statApprovals")} value={c.pendingApprovals} icon={<ApprovalsIcon size={14} />} iconTone={c.pendingApprovals > 0 ? "warning" : "neutral"} tone={c.pendingApprovals > 0 ? "warning" : "neutral"} onClick={() => go("approvals")} />
          <Stat label={t("governance.overview.statFindings")} value={c.openFindings} icon={<FindingsIcon size={14} />} iconTone={c.openFindings > 0 ? "danger" : "neutral"} tone={c.openFindings > 0 ? "danger" : "neutral"} onClick={() => go("findings")} />
          <Stat label={t("governance.overview.statDrafts")} value={c.draftRevisions} icon={<PolicyIcon size={14} />} iconTone={c.draftRevisions > 0 ? "warning" : "neutral"} tone={c.draftRevisions > 0 ? "warning" : "neutral"} onClick={() => go("policy")} />
        </div>
      </Card>
      <div className={s.bento}>
        <Card
          title={t("governance.overview.policyTitle")}
          icon={<PolicyIcon size={18} />}
          tone="brand"
          actions={
            <Button size="small" shape="circular" onClick={() => go("policy")}>
              {t("governance.overview.open")}
            </Button>
          }
        >
          {o.effective === null ? (
            <MessageBar intent="warning">
              <MessageBarBody>{t("governance.overview.noPolicy")}</MessageBarBody>
            </MessageBar>
          ) : (
            <div className={s.inset}>
              <Text>
                {t("governance.overview.policyMetaBefore", { revision: o.effective.revision, at: when(o.effective.publishedAt) })}
                <span className={s.codeChip}>{short(o.effective.digest, 16)}</span>
              </Text>
              <Text size={200} className={s.muted}>
                {t(SOURCE_KEYS[o.effective.source])}.
              </Text>
            </div>
          )}
          <Text size={200} className={s.muted}>
            {c.overrides === 0
              ? t("governance.overview.noOverrides")
              : t("governance.overview.overridesCount", {
                  countText: plural(c.overrides, t("governance.overview.overrideOne"), t("governance.overview.overrideMany")),
                })}
          </Text>
        </Card>
        <Card
          title={t("governance.overview.auditTitle")}
          icon={<AuditChainIcon size={18} />}
          tone="teal"
          actions={
            <Button size="small" shape="circular" disabled={verifying} onClick={verify}>
              {verifying ? t("governance.audit.verifying") : t("governance.audit.verifyChain")}
            </Button>
          }
        >
          <div className={s.inset}>
            <Text>
              {t("governance.overview.auditMetaBefore", {
                records: plural(o.audit.count, t("governance.audit.recordOne"), t("governance.audit.recordMany")),
              })}
              <span className={s.codeChip}>{short(o.audit.head, 16)}</span>
            </Text>
          </div>
          {chain && (
            <MessageBar intent={chain.ok ? "success" : "error"}>
              <MessageBarBody>
                {chain.ok
                  ? t("governance.overview.chainChecked", {
                      records: plural(chain.count, t("governance.audit.recordOne"), t("governance.audit.recordMany")),
                      at: when(chain.checkedAt),
                    })
                  : t("governance.overview.chainBroken", { at: chain.brokenAt ?? "", problem: chain.problem ?? "" })}
              </MessageBarBody>
            </MessageBar>
          )}
          <ErrorBar text={error} />
          <Text size={200} className={s.muted}>
            {t("governance.overview.chainNote")}
          </Text>
        </Card>
      </div>
      <Card
        title={
          <>
            {t("governance.overview.isolationTitle")}
            <Word value={o.isolation.state} />
          </>
        }
        icon={o.isolation.state === "attested" ? <ShieldClearIcon size={18} /> : <FindingsIcon size={18} />}
        tone={o.isolation.state === "attested" ? "success" : o.isolation.state === "failed" ? "danger" : "warning"}
      >
        <Text>{t(DEPLOYMENT_KEYS[o.deployment])}</Text>
        <Text size={200} className={s.muted}>
          {o.isolation.detail.replace(/ -- /g, " — ")}
        </Text>
        {o.isolation.checks.length > 0 && (
          <ul className={s.list} aria-label={t("governance.overview.isolationChecksAria")}>
            {o.isolation.checks.map((check) => (
              <li key={check.name} className={mergeClasses(s.inset, check.ok ? st.checkOk : st.checkFail)}>
                <div className={s.row}>
                  <Word value={check.ok ? "allow" : "deny"} label={t(check.ok ? "governance.overview.checkHeld" : "governance.overview.checkFailed")} />
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
            {t("governance.overview.isolationChecked", { at: when(o.isolation.checkedAt) })}
          </Text>
        )}
      </Card>
    </div>
  );
}
