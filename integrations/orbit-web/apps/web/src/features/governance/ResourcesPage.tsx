// THE ACCOUNT'S CHATS AND RESEARCH WORKSPACES, as its governance sees them -- two groups, the owner's own and nobody
// else's. Each inherits the account's policy in effect; an override may narrow it for that one chat or research
// workspace (make an action wait for the owner's approval, or deny it) and never widen it: an allow in an override
// changes nothing. A deleted one stays listed: what concerned it stays on record, and nothing runs there to narrow.
import { Button, MessageBar, MessageBarBody, Spinner, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { ArrowLeft16Regular, ChevronRight16Regular, ShieldTask16Regular } from "@fluentui/react-icons";
import { AuditChainIcon, PolicyIcon, ResearchIcon, WorkspacesIcon } from "../../components/SectionIcons";
import { ACTIONS, type Rule } from "@orbit-web/governance-core";
import type { ResourceGovernanceList, ResourceGovernanceSummary, ResourceGovernanceView, ResourceKind } from "@orbit-web/contracts";
import { useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useI18n, type MessageKey } from "../../i18n";
import { errorText, get, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { limitOf } from "./PolicyTable";
import { overrideRowsOf, withOverrideRows, type Narrowing, type OverrideRow } from "./overrideRows";
import { Card, CleanSelect, EmptyState, ErrorBar, Stat, Word, byWhom, principalOf, short, useParts, when } from "./parts";

const GROUPS: Record<ResourceKind, { page: GovernancePage; path: string; titleKey: MessageKey; oneKey: MessageKey; allKey: MessageKey; emptyKey: MessageKey; aboutKey: MessageKey; emptyBodyKey: MessageKey }> = {
  workspace: {
    page: "workspaces",
    path: "/api/governance/workspaces",
    titleKey: "governance.resources.workspace.title",
    oneKey: "governance.resources.workspace.one",
    allKey: "governance.resources.workspace.all",
    emptyKey: "governance.resources.workspace.empty",
    aboutKey: "governance.resources.workspace.about",
    emptyBodyKey: "governance.resources.workspace.emptyBody",
  },
  research_workspace: {
    page: "research",
    path: "/api/governance/research",
    titleKey: "governance.resources.research_workspace.title",
    oneKey: "governance.resources.research_workspace.one",
    allKey: "governance.resources.research_workspace.all",
    emptyKey: "governance.resources.research_workspace.empty",
    aboutKey: "governance.resources.research_workspace.about",
    emptyBodyKey: "governance.resources.research_workspace.emptyBody",
  },
};

const NARROWING_KEYS: ReadonlyArray<{ value: Narrowing; labelKey: MessageKey }> = [
  { value: "inherit", labelKey: "governance.resources.narrowing.inherit" },
  { value: "require_approval", labelKey: "governance.resources.narrowing.require_approval" },
  { value: "deny", labelKey: "governance.resources.narrowing.deny" },
];

// What an override says about an action nobody may be granted, or that holds every host.
const OVERRIDE_NOTE_KEYS: Partial<Record<string, MessageKey>> = {
  "network.egress": "governance.resources.overrideEgressNote",
};

const useStyles = makeStyles({
  resourceRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    paddingTop: "12px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    paddingRight: "14px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    transitionProperty: "background-color, border-color",
    transitionDuration: "140ms",
    ":hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      ...shorthands.borderColor(tokens.colorNeutralStroke1Hover),
    },
    minWidth: 0,
  },
  titleBtn: {
    justifyContent: "flex-start",
    minWidth: "unset",
    paddingLeft: 0,
    paddingRight: 0,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
    textAlign: "left",
  },
  rowList: { display: "flex", flexDirection: "column", gap: "6px", listStyleType: "none", paddingLeft: 0, marginTop: 0, marginBottom: 0 },
  overrideRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    paddingTop: "8px",
    paddingBottom: "8px",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
  },
  overrideAction: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flexGrow: 1, flexBasis: "260px" },
  overrideSelect: { minWidth: "190px" },
  id: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3 },
});

function Counts({ r }: { r: ResourceGovernanceSummary }) {
  const { t } = useI18n();
  const s = useParts();
  return (
    <div className={s.row}>
      {r.deletedAt !== null && <Word value="deleted" />}
      {r.overridden && <Word value="overridden" />}
      <Text size={200} className={s.muted}>
        {t("governance.resources.countsLine", { running: r.runningRuns, waiting: r.pendingApprovals })}
      </Text>
    </div>
  );
}

function ResourceList({ kind, go }: { kind: ResourceKind; go: (page: GovernancePage, item?: string | null) => void }) {
  const { t } = useI18n();
  const s = useParts();
  const styles = useStyles();
  const group = GROUPS[kind];
  const title = t(group.titleKey);
  const list = useResource<ResourceGovernanceList>(() => get(group.path), [group.path]);
  useAppEvent("governance.changed", (e) => (e.data.area === "resources" || e.data.area === "overrides") && void list.reload());
  useAppEvent("approval.changed", () => void list.reload());
  return (
    <Card title={title} icon={kind === "workspace" ? <WorkspacesIcon size={18} /> : <ResearchIcon size={18} />} tone={kind === "workspace" ? "brand" : "teal"} description={t(group.aboutKey)}>
      {list.data === null ? (
        list.error ? (
          <ErrorBar text={list.error} />
        ) : (
          <Spinner />
        )
      ) : list.data.resources.length === 0 ? (
        <EmptyState
          icon={kind === "workspace" ? <WorkspacesIcon size={22} /> : <ResearchIcon size={22} />}
          tone={kind === "workspace" ? "brand" : "teal"}
          title={t(group.emptyKey)}
          body={t(group.emptyBodyKey)}
        />
      ) : (
        <ul className={styles.rowList} aria-label={title}>
          {list.data.resources.map((r) => (
            <li key={r.id} className={styles.resourceRow}>
              <div className={s.cardTitleStack}>
                <Button className={styles.titleBtn} appearance="transparent" onClick={() => go(group.page, r.id)}>
                  {r.title || short(r.id, 13)}
                </Button>
                <Text size={200} className={s.muted}>
                  {t("governance.resources.created", { at: when(r.createdAt) })}
                  {r.deletedAt !== null ? t("governance.resources.deletedSuffix", { at: when(r.deletedAt) }) : ""}
                </Text>
              </div>
              <div className={s.row}>
                <Counts r={r} />
                <ChevronRight16Regular aria-hidden className={s.muted} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OverrideEditor({ resource, onChanged, onRemoved }: { resource: ResourceGovernanceView; onChanged: (v: ResourceGovernanceView) => void; onRemoved: () => void }) {
  const { t } = useI18n();
  const s = useParts();
  const styles = useStyles();
  const group = GROUPS[resource.kind];
  const one = t(group.oneKey);
  const rules: Rule[] = resource.override?.override.rules ?? [];
  const [rows, setRows] = useState<OverrideRow[]>(() => overrideRowsOf(rules).rows);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kept = overrideRowsOf(rules).kept;
  const deleted = resource.deletedAt !== null;
  const path = `${group.path}/${encodeURIComponent(resource.id)}/override`;
  const narrowingOptions = NARROWING_KEYS.map((o) => ({ value: o.value, label: t(o.labelKey) }));
  const choose = (row: OverrideRow, narrowing: Narrowing) => {
    setRows(rows.map((r) => (r.action === row.action ? { ...r, narrowing } : r)));
    setDirty(true);
  };
  const save = () => {
    setBusy(true);
    setError(null);
    void send<ResourceGovernanceView>("PUT", path, { rules: withOverrideRows(rules, rows) })
      .then((v) => {
        setDirty(false);
        onChanged(v);
      })
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };
  const remove = () => {
    setBusy(true);
    setError(null);
    void send("DELETE", path)
      .then(onRemoved)
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };
  return (
    <Card
      title={<>{t("governance.resources.overrideTitle")}{resource.override ? <Word value="overridden" label={t("governance.resources.inEffect")} /> : <Word value="none" label={t("governance.resources.none")} />}</>}
      icon={<ShieldTask16Regular />}
      description={t("governance.resources.overrideDesc", { one })}
    >
      {deleted && (
        <MessageBar intent="info">
          <MessageBarBody>{t("governance.resources.deletedBanner")}</MessageBarBody>
        </MessageBar>
      )}
      {resource.override && (
        <Text size={200} className={s.muted}>
          {t("governance.resources.setMetaBefore", { at: when(resource.override.setAt), by: byWhom(resource.override.setBy) })}
          <span className={s.codeChip}>{short(resource.override.digest, 16)}</span>
        </Text>
      )}
      {resource.override?.warnings.map((w) => (
        <MessageBar key={`${w.ruleId}:${w.code}`} intent="warning">
          <MessageBarBody>
            <span className={s.mono}>{w.ruleId}</span>: {w.message}
          </MessageBarBody>
        </MessageBar>
      ))}
      <ul className={styles.rowList} aria-label={t("governance.resources.whatNarrowsAria")}>
        {rows.map((row) => {
          const limit = limitOf(row.action);
          const note = limit.fixed ? limit.note : OVERRIDE_NOTE_KEYS[row.action] ? t(OVERRIDE_NOTE_KEYS[row.action]!) : undefined;
          return (
            <li key={row.action} className={styles.overrideRow}>
              <div className={styles.overrideAction}>
                <Text>{ACTIONS[row.action].summary}</Text>
                <span className={styles.id}>{row.action}</span>
                {note && (
                  <Text size={200} className={s.muted}>
                    {note}
                  </Text>
                )}
              </div>
              <CleanSelect className={styles.overrideSelect} ariaLabel={t("governance.resources.selectAria", { one, action: row.action })} value={row.narrowing} disabled={deleted || limit.fixed || busy} options={narrowingOptions} onChange={(v) => choose(row, v as Narrowing)} />
            </li>
          );
        })}
      </ul>
      {kept.length > 0 && (
        <div className={s.inset}>
          <Text weight="semibold" size={300}>
            {t("governance.resources.rulesNotShown")}
          </Text>
          <ul className={s.list} aria-label={t("governance.resources.rulesNotShown")}>
            {kept.map((r) => (
              <li key={r.id}>
                <Text size={200}>
                  <span className={s.mono}>{r.id}</span> · {r.action}
                  {r.principalType ? t("governance.policyTable.keptFor", { who: r.principalType === "human" ? t("governance.parts.principal.you") : t("governance.policy.principalPlural", { type: r.principalType }) }) : ""}
                  {r.environment ? t("governance.policyTable.keptIn", { env: r.environment }) : ""}
                  {r.resource ? t("governance.policyTable.keptOn", { resource: r.resource }) : ""} · <Word value={r.effect} />
                  {r.effect === "allow" ? t("governance.resources.changesNothing") : ""}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!deleted && (
        <div className={s.row}>
          <Button appearance="primary" disabled={busy || !dirty} onClick={save}>
            {t("governance.resources.saveOverride")}
          </Button>
          {resource.override && (
            <Button disabled={busy} onClick={remove}>
              {t("governance.resources.removeOverride")}
            </Button>
          )}
        </div>
      )}
      <ErrorBar text={error} />
    </Card>
  );
}

function ResourceDetail({ kind, id, go }: { kind: ResourceKind; id: string; go: (page: GovernancePage, item?: string | null) => void }) {
  const { t } = useI18n();
  const s = useParts();
  const group = GROUPS[kind];
  const one = t(group.oneKey);
  const view = useResource<ResourceGovernanceView>(() => get(`${group.path}/${encodeURIComponent(id)}`), [group.path, id]);
  useAppEvent("governance.changed", (e) => e.data.area !== "reports" && e.data.area !== "isolation" && void view.reload());
  useAppEvent("approval.changed", () => void view.reload());
  const back = (
    <div>
      <Button appearance="subtle" shape="circular" icon={<ArrowLeft16Regular />} onClick={() => go(group.page)}>
        {t(group.allKey)}
      </Button>
    </div>
  );
  if (view.data === null)
    return (
      <div className={s.page}>
        {back}
        {view.error ? <ErrorBar text={view.error} /> : <Spinner />}
      </div>
    );
  const r = view.data;
  return (
    <div className={s.page}>
      {back}
      <Card
        title={<>{r.title || short(r.id, 13)} {r.deletedAt !== null && <Word value="deleted" />}</>}
        icon={kind === "workspace" ? <WorkspacesIcon size={18} /> : <ResearchIcon size={18} />}
        tone={kind === "workspace" ? "brand" : "teal"}
        description={t("governance.resources.detailDesc", {
          one,
          at: when(r.createdAt),
          deleted: r.deletedAt !== null ? t("governance.resources.deletedSuffix", { at: when(r.deletedAt) }) : "",
        })}
      >
        <div className={s.grid}>
          <Stat label={t("governance.overview.statRunning")} value={r.runningRuns} />
          <Stat label={t("governance.overview.statApprovals")} value={r.pendingApprovals} tone={r.pendingApprovals > 0 ? "warning" : "neutral"} onClick={() => go("approvals")} />
        </div>
      </Card>
      <Card
        title={t("governance.resources.policyInherits")}
        icon={<PolicyIcon size={18} />}
        tone="brand"
        actions={
          r.policy ? (
            <Button size="small" shape="circular" onClick={() => go("policy", r.policy?.revisionId ?? null)}>
              {t("governance.overview.open")}
            </Button>
          ) : undefined
        }
      >
        {r.policy ? (
          <Text>
            {t("governance.resources.policyMetaBefore", {
              revLabel: r.policy.revision !== null ? t("governance.resources.policyRevision", { revision: r.policy.revision }) : t("governance.resources.aRevision"),
            })}
            <span className={s.codeChip}>{short(r.policy.digest, 16)}</span>
          </Text>
        ) : (
          <MessageBar intent="warning">
            <MessageBarBody>{t("governance.resources.noPolicyInEffect")}</MessageBarBody>
          </MessageBar>
        )}
      </Card>
      <OverrideEditor key={`${r.override?.digest ?? "none"}:${r.deletedAt ?? ""}`} resource={r} onChanged={view.set} onRemoved={() => void view.reload()} />
      <Card title={t("governance.resources.recentActivity")} icon={<AuditChainIcon size={18} />} tone="teal">
        {r.activity.length === 0 ? (
          <EmptyState icon={<AuditChainIcon size={22} />} tone="teal" title={t("governance.resources.nothingOnRecord")} />
        ) : (
          <ul className={s.list} aria-label={t("governance.resources.recentActivity")}>
            {r.activity.map((e) => (
              <li key={e.eventId} className={s.inset}>
                <div className={s.between}>
                  <div className={s.row}>
                    <Text size={200} className={s.muted}>
                      {when(e.occurredAt)}
                    </Text>
                    <Text weight="semibold" className={s.mono}>
                      {e.eventType}
                    </Text>
                    <Word value={e.outcome} label={e.outcome} />
                  </div>
                  <Button size="small" appearance="transparent" onClick={() => go("audit", e.eventId)}>
                    {t("governance.resources.recordNumber", { seq: e.seq })}
                  </Button>
                </div>
                <Text size={200}>{principalOf(e.principalType, e.principalId, e.agentId)}</Text>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function ResourcesPage({ kind, item, go }: { kind: ResourceKind; item: string | null; go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  if (item) return <ResourceDetail key={`${kind}:${item}`} kind={kind} id={item} go={go} />;
  return (
    <div className={s.page}>
      <ResourceList kind={kind} go={go} />
    </div>
  );
}
