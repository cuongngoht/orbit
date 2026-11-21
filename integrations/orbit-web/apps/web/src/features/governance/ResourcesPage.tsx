// THE ACCOUNT'S CHATS AND RESEARCH WORKSPACES, as its governance sees them -- two groups, the owner's own and nobody
// else's. Each inherits the account's policy in effect; an override may narrow it for that one chat or research
// workspace (make an action wait for the owner's approval, or deny it) and never widen it: an allow in an override
// changes nothing. A deleted one stays listed: what concerned it stays on record, and nothing runs there to narrow.
import { Button, MessageBar, MessageBarBody, Spinner, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { ArrowLeft16Regular, BookOpen16Regular, Chat16Regular, DocumentCheckmark16Regular, History16Regular, ShieldTask16Regular } from "@fluentui/react-icons";
import { ACTIONS, type Rule } from "@orbit-web/governance-core";
import type { ResourceGovernanceList, ResourceGovernanceSummary, ResourceGovernanceView, ResourceKind } from "@orbit-web/contracts";
import { useState } from "react";
import type { GovernancePage } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { errorText, get, send } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { limitOf } from "./PolicyTable";
import { overrideRowsOf, withOverrideRows, type Narrowing, type OverrideRow } from "./overrideRows";
import { Card, CleanSelect, ErrorBar, Stat, Word, byWhom, principalOf, short, useParts, when } from "./parts";

const GROUPS: Record<ResourceKind, { page: GovernancePage; path: string; title: string; one: string; all: string; empty: string; about: string }> = {
  workspace: {
    page: "workspaces",
    path: "/api/governance/workspaces",
    title: "Workspaces",
    one: "chat",
    all: "All workspaces",
    empty: "No chat yet.",
    about: "Your chats: each one a Claude Code workspace, under your policy.",
  },
  research_workspace: {
    page: "research",
    path: "/api/governance/research",
    title: "Research workspaces",
    one: "research workspace",
    all: "All research workspaces",
    empty: "No research workspace yet.",
    about: "Your research workspaces, under your policy.",
  },
};

const NARROWING_OPTIONS: { value: Narrowing; label: string }[] = [
  { value: "inherit", label: "As your policy says" },
  { value: "require_approval", label: "You approve first" },
  { value: "deny", label: "Denied" },
];

// What an override says about an action nobody may be granted, or that holds every host.
const OVERRIDE_NOTES: Partial<Record<string, string>> = {
  "network.egress": "Every host, Claude Code's own service included: denied, a run here cannot reach the model.",
};

const useStyles = makeStyles({
  resourceRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    flexWrap: "wrap",
    paddingTop: "10px",
    paddingBottom: "10px",
    paddingLeft: "14px",
    paddingRight: "14px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground2,
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
  const s = useParts();
  return (
    <div className={s.row}>
      {r.deletedAt !== null && <Word value="deleted" />}
      {r.overridden && <Word value="overridden" />}
      <Text size={200} className={s.muted}>
        {r.runningRuns} running · {r.pendingApprovals} waiting for you
      </Text>
    </div>
  );
}

function ResourceList({ kind, go }: { kind: ResourceKind; go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  const styles = useStyles();
  const group = GROUPS[kind];
  const list = useResource<ResourceGovernanceList>(() => get(group.path), [group.path]);
  useAppEvent("governance.changed", (e) => (e.data.area === "resources" || e.data.area === "overrides") && void list.reload());
  useAppEvent("approval.changed", () => void list.reload());
  return (
    <Card title={group.title} icon={kind === "workspace" ? <Chat16Regular /> : <BookOpen16Regular />} description={group.about}>
      {list.data === null ? (
        list.error ? (
          <ErrorBar text={list.error} />
        ) : (
          <Spinner />
        )
      ) : list.data.resources.length === 0 ? (
        <div className={s.empty}>
          <Text>{group.empty}</Text>
        </div>
      ) : (
        <ul className={styles.rowList} aria-label={group.title}>
          {list.data.resources.map((r) => (
            <li key={r.id} className={styles.resourceRow}>
              <div className={s.cardTitleStack}>
                <Button className={styles.titleBtn} appearance="transparent" onClick={() => go(group.page, r.id)}>
                  {r.title || short(r.id, 13)}
                </Button>
                <Text size={200} className={s.muted}>
                  created {when(r.createdAt)}
                  {r.deletedAt !== null ? ` · deleted ${when(r.deletedAt)}` : ""}
                </Text>
              </div>
              <Counts r={r} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function OverrideEditor({ resource, onChanged, onRemoved }: { resource: ResourceGovernanceView; onChanged: (v: ResourceGovernanceView) => void; onRemoved: () => void }) {
  const s = useParts();
  const styles = useStyles();
  const group = GROUPS[resource.kind];
  const rules: Rule[] = resource.override?.override.rules ?? [];
  const [rows, setRows] = useState<OverrideRow[]>(() => overrideRowsOf(rules).rows);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kept = overrideRowsOf(rules).kept;
  const deleted = resource.deletedAt !== null;
  const path = `${group.path}/${encodeURIComponent(resource.id)}/override`;
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
      title={<>Override {resource.override ? <Word value="overridden" label="in effect" /> : <Word value="none" label="none" />}</>}
      icon={<ShieldTask16Regular />}
      description={`It narrows your policy for this ${group.one} alone: an action can wait for your approval or be denied here, never be allowed more. An allow in an override changes nothing -- loosening is done in your policy.`}
    >
      {deleted && (
        <MessageBar intent="info">
          <MessageBarBody>It was deleted: nothing runs there to narrow, so its override cannot change.</MessageBarBody>
        </MessageBar>
      )}
      {resource.override && (
        <Text size={200} className={s.muted}>
          Set {when(resource.override.setAt)} by {byWhom(resource.override.setBy)} · digest <span className={s.codeChip}>{short(resource.override.digest, 16)}</span>
        </Text>
      )}
      {resource.override?.warnings.map((w) => (
        <MessageBar key={`${w.ruleId}:${w.code}`} intent="warning">
          <MessageBarBody>
            <span className={s.mono}>{w.ruleId}</span>: {w.message}
          </MessageBarBody>
        </MessageBar>
      ))}
      <ul className={styles.rowList} aria-label="What the override narrows">
        {rows.map((row) => {
          const limit = limitOf(row.action);
          const note = limit.fixed ? limit.note : OVERRIDE_NOTES[row.action];
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
              <CleanSelect className={styles.overrideSelect} ariaLabel={`In this ${group.one}: ${row.action}`} value={row.narrowing} disabled={deleted || limit.fixed || busy} options={NARROWING_OPTIONS} onChange={(v) => choose(row, v as Narrowing)} />
            </li>
          );
        })}
      </ul>
      {kept.length > 0 && (
        <div className={s.inset}>
          <Text weight="semibold" size={300}>
            Rules these rows do not show
          </Text>
          <ul className={s.list} aria-label="Rules these rows do not show">
            {kept.map((r) => (
              <li key={r.id}>
                <Text size={200}>
                  <span className={s.mono}>{r.id}</span> · {r.action}
                  {r.principalType ? ` · for ${r.principalType === "human" ? "you" : `${r.principalType}s`}` : ""}
                  {r.environment ? ` · in ${r.environment}` : ""}
                  {r.resource ? ` · on ${r.resource}` : ""} · <Word value={r.effect} />
                  {r.effect === "allow" ? " -- changes nothing" : ""}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!deleted && (
        <div className={s.row}>
          <Button appearance="primary" disabled={busy || !dirty} onClick={save}>
            Save override
          </Button>
          {resource.override && (
            <Button disabled={busy} onClick={remove}>
              Remove override
            </Button>
          )}
        </div>
      )}
      <ErrorBar text={error} />
    </Card>
  );
}

function ResourceDetail({ kind, id, go }: { kind: ResourceKind; id: string; go: (page: GovernancePage, item?: string | null) => void }) {
  const s = useParts();
  const group = GROUPS[kind];
  const view = useResource<ResourceGovernanceView>(() => get(`${group.path}/${encodeURIComponent(id)}`), [group.path, id]);
  useAppEvent("governance.changed", (e) => e.data.area !== "reports" && e.data.area !== "isolation" && void view.reload());
  useAppEvent("approval.changed", () => void view.reload());
  const back = (
    <div>
      <Button appearance="subtle" shape="circular" icon={<ArrowLeft16Regular />} onClick={() => go(group.page)}>
        {group.all}
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
      <Card title={<>{r.title || short(r.id, 13)} {r.deletedAt !== null && <Word value="deleted" />}</>} icon={kind === "workspace" ? <Chat16Regular /> : <BookOpen16Regular />} description={`A ${group.one} of your account · created ${when(r.createdAt)}${r.deletedAt !== null ? ` · deleted ${when(r.deletedAt)}` : ""}`}>
        <div className={s.grid}>
          <Stat label="Runs running" value={r.runningRuns} />
          <Stat label="Approvals waiting" value={r.pendingApprovals} tone={r.pendingApprovals > 0 ? "warning" : "neutral"} onClick={() => go("approvals")} />
        </div>
      </Card>
      <Card
        title="Policy it inherits"
        icon={<DocumentCheckmark16Regular />}
        actions={
          r.policy ? (
            <Button size="small" shape="circular" onClick={() => go("policy", r.policy?.revisionId ?? null)}>
              Open
            </Button>
          ) : undefined
        }
      >
        {r.policy ? (
          <Text>
            {r.policy.revision !== null ? `Revision ${r.policy.revision}` : "A revision"} of your policy · digest <span className={s.codeChip}>{short(r.policy.digest, 16)}</span>
          </Text>
        ) : (
          <MessageBar intent="warning">
            <MessageBarBody>No policy is in effect: nothing a run asks here is allowed until you publish one.</MessageBarBody>
          </MessageBar>
        )}
      </Card>
      <OverrideEditor key={`${r.override?.digest ?? "none"}:${r.deletedAt ?? ""}`} resource={r} onChanged={view.set} onRemoved={() => void view.reload()} />
      <Card title="Recent activity" icon={<History16Regular />}>
        {r.activity.length === 0 ? (
          <div className={s.empty}>
            <Text>Nothing on record yet.</Text>
          </div>
        ) : (
          <ul className={s.list} aria-label="Recent activity">
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
                    Record #{e.seq}
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
