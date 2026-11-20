// SETTINGS → CONNECTORS, in the style of Claude's own: a table of the repository connectors -- GitHub and Azure
// DevOps -- with their type, authorization and status (✓ and the account, or Connect). A row opens its detail: the
// CLI's own device sign-in (the URL and the one-time code it printed), the tenant for Azure, Disconnect, and whether
// Claude Code may use the Azure sign-in. Behaviour is the CLIs' own, as before; only the presentation is new.
import {
  Button,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  Spinner,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import { Checkmark16Regular } from "@fluentui/react-icons";
import { SOURCE_LABELS, type AzureStatus, type ConnectorName, type GitHubStatus, type LoginSnapshot, type SetupStatus } from "@orbit-web/contracts";
import { useEffect, useState } from "react";
import { ConnectionBadge } from "../../components/StatusBadge";
import { SourceMark } from "../../components/SourceMark";
import { flowActive, useConnectorFlow } from "../../hooks/useLoginFlow";
import { useViewport } from "../../hooks/useViewport";
import { errorText, send } from "../../services/api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "16px" },
  row: { cursor: "pointer" },
  rowSelected: { backgroundColor: tokens.colorSubtleBackgroundSelected },
  name: { display: "flex", alignItems: "center", gap: "10px" },
  icon: { width: "28px", height: "28px", borderRadius: tokens.borderRadiusMedium, border: `1px solid ${tokens.colorNeutralStroke2}`, display: "inline-flex", alignItems: "center", justifyContent: "center", backgroundColor: tokens.colorNeutralBackground1, flexShrink: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  status: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0 },
  accountWrap: { color: tokens.colorNeutralForeground3, overflowWrap: "anywhere" },
  detail: { display: "flex", flexDirection: "column", gap: "10px", padding: "16px", borderRadius: tokens.borderRadiusLarge, border: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: tokens.colorNeutralBackground1 },
  detailHead: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
  buttons: { display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "flex-end", "@media (max-width: 639px)": { flexDirection: "column", alignItems: "stretch" } },
  actionBtn: { "@media (max-width: 639px), (pointer: coarse)": { minHeight: "44px" } },
  code: { fontFamily: tokens.fontFamilyMonospace, fontSize: "clamp(20px, 6vw, 28px)", letterSpacing: "3px", fontWeight: tokens.fontWeightSemibold },
  cardList: { display: "flex", flexDirection: "column", gap: "8px" },
  cardBtn: {
    width: "100%",
    minHeight: "60px",
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    borderRadius: tokens.borderRadiusLarge,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    display: "flex",
    alignItems: "center",
    gap: "12px",
    textAlign: "left",
    cursor: "pointer",
  },
  cardSelected: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    backgroundColor: tokens.colorSubtleBackgroundSelected,
  },
  cardBody: { display: "flex", flexDirection: "column", gap: "2px", flexGrow: 1, minWidth: 0 },
  cardTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" },
});

const CLI: Record<ConnectorName, string> = { github: "GitHub CLI", azure: "the Azure CLI" };

function DeviceFlow({ connector, flow, onCancel, busy }: { connector: ConnectorName; flow: LoginSnapshot | null; onCancel: () => void; busy: boolean }) {
  const s = useStyles();
  if (flow === null || flow.state === "idle" || flow.state === "connected") return null;
  if (flow.state === "starting") return <Spinner size="tiny" label={`Starting ${CLI[connector]}'s sign-in…`} />;
  if (flow.state === "verifying") return <Spinner size="tiny" label={flow.message ?? "Checking the sign-in…"} />;
  if (flow.state === "awaiting_user")
    return (
      <div className={s.root}>
        <Text>
          Open{" "}
          <Link href={flow.url ?? "#"} target="_blank" rel="noopener noreferrer">
            {flow.url}
          </Link>{" "}
          and enter the code {CLI[connector]} printed:
        </Text>
        <Text className={s.code} aria-label={connector === "github" ? "one-time code" : "Azure one-time code"}>
          {flow.code}
        </Text>
        <Spinner size="tiny" label="Waiting for authorization…" labelPosition="after" />
        <div>
          <Button appearance="subtle" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    );
  return (
    <MessageBar intent={flow.state === "cancelled" ? "info" : "error"}>
      <MessageBarBody>{flow.message ?? `Sign-in ${flow.state.replace("_", " ")}.`}</MessageBarBody>
    </MessageBar>
  );
}

// One action at a time, its error said, the status read again after it.
function useAct(onChanged: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, act };
}

function GitHubDetail({ status, onChanged }: { status: GitHubStatus; onChanged: () => void }) {
  const s = useStyles();
  const flow = useConnectorFlow("github", status.flow);
  const { error, busy, act } = useAct(onChanged);
  useEffect(() => {
    if (flow?.state === "connected" || flow?.state === "failed") onChanged();
  }, [flow?.state, onChanged]);
  const connected = status.state === "connected";
  return (
    <>
      {connected && status.account && (
        <Text>
          Connected as <strong>@{status.account.login}</strong>
          {status.account.name ? ` (${status.account.name})` : ""}
        </Text>
      )}
      {status.state === "expired" && (
        <MessageBar intent="warning">
          <MessageBarBody>{status.detail ?? "The GitHub sign-in has expired."} Your chats are kept; connect again to continue.</MessageBarBody>
        </MessageBar>
      )}
      {status.state === "unavailable" && status.detail && <Text size={200} className={s.muted}>{status.detail}</Text>}
      <DeviceFlow connector="github" flow={flow} onCancel={() => act(() => send("POST", "/api/github/login/cancel"))} busy={busy} />
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {!flowActive(flow) && (
        <div className={s.buttons}>
          {!connected && (
            <Button className={s.actionBtn} appearance="primary" disabled={busy} onClick={() => act(() => send<LoginSnapshot>("POST", "/api/github/login"))}>
              Connect GitHub
            </Button>
          )}
          {connected && (
            <Button className={s.actionBtn} appearance="secondary" disabled={busy} onClick={() => act(() => send("POST", "/api/github/logout"))}>
              Disconnect
            </Button>
          )}
        </div>
      )}
      <Switch checked={status.availableToClaude} disabled={busy} onChange={(_, d) => void act(() => send("PATCH", "/api/settings", { githubForClaude: d.checked }))} label="Let Claude Code push and open pull requests with this GitHub sign-in" />
      <Text size={200} className={s.muted}>
        Off, Claude Code commits in its workspace and you push. On, it may push branches and open pull requests with <code>gh</code> as this account in any chat (never a force-push or the default branch, by its instructions); the sign-in itself stays out of its reach (<code>gh auth</code> is refused). Turn it on only for repositories you trust.
      </Text>
      <Text size={200} className={s.muted}>
        Uses GitHub CLI's own sign-in; no GitHub App and no personal access token. Disconnecting ends the CLI's sign-in in this container; to revoke the authorization itself, use GitHub's Settings → Applications.
      </Text>
    </>
  );
}

function AzureDetail({ status, onChanged }: { status: AzureStatus; onChanged: () => void }) {
  const s = useStyles();
  const flow = useConnectorFlow("azure", status.flow);
  const { error, busy, act } = useAct(onChanged);
  const [tenant, setTenant] = useState("");
  useEffect(() => {
    if (flow?.state === "connected" || flow?.state === "failed") onChanged();
  }, [flow?.state, onChanged]);
  const connected = status.state === "connected";
  const installed = status.state !== "unavailable" || !/not installed/.test(status.detail ?? "");
  return (
    <>
      {connected && status.account && (
        <Text>
          Signed in as <strong>{status.account.user}</strong>
          {status.account.subscription ? ` · ${status.account.subscription}` : ""}
        </Text>
      )}
      {status.detail && !connected && <Text size={200} className={s.muted}>{status.detail}</Text>}
      <DeviceFlow connector="azure" flow={flow} onCancel={() => act(() => send("POST", "/api/azure/login/cancel"))} busy={busy} />
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {installed && !flowActive(flow) && !connected && (
        <form
          className={s.buttons}
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => send<LoginSnapshot>("POST", "/api/azure/login", tenant.trim() ? { tenant: tenant.trim() } : {}));
          }}
        >
          <Field label="Tenant (optional)">
            <Input value={tenant} onChange={(_, d) => setTenant(d.value)} placeholder="contoso.onmicrosoft.com" autoComplete="off" spellCheck={false} />
          </Field>
          <Button className={s.actionBtn} appearance="primary" type="submit" disabled={busy}>
            Connect Azure
          </Button>
        </form>
      )}
      {connected && !flowActive(flow) && (
        <div className={s.buttons}>
          <Button className={s.actionBtn} appearance="secondary" disabled={busy} onClick={() => act(() => send("POST", "/api/azure/logout"))}>
            Sign out
          </Button>
        </div>
      )}
      <Switch checked={status.availableToClaude} disabled={busy} onChange={(_, d) => void act(() => send("PATCH", "/api/settings", { azureForClaude: d.checked }))} label="Let Claude Code use this Azure sign-in" />
      <Text size={200} className={s.muted}>
        Lists and clones your Azure DevOps repositories with the Azure CLI's own sign-in, kept in this container. With the switch on, Claude Code may also run <code>az</code> as this account in any chat — including against resources that matter — so turn it on only for accounts and repositories you trust.
      </Text>
    </>
  );
}

interface Row {
  connector: ConnectorName;
  state: SetupStatus["github"]["state"];
  account: string | null;
}

export function ConnectorsSection({ status, onChanged, initial }: { status: SetupStatus | null; onChanged: () => void; initial?: ConnectorName | null }) {
  const s = useStyles();
  const { isMobile } = useViewport();
  const [open, setOpen] = useState<ConnectorName | null>(initial ?? null);
  if (status === null) return <Spinner label="Reading the connectors…" />;
  const rows: Row[] = [
    { connector: "github", state: status.github.state, account: status.github.account ? `@${status.github.account.login}` : null },
    { connector: "azure", state: status.azure.state, account: status.azure.account?.user ?? null },
  ];
  return (
    <div className={s.root}>
      {isMobile ? (
        <div className={s.cardList} role="list" aria-label="Connectors">
          {rows.map((r) => {
            const connected = r.state === "connected";
            return (
              <button key={r.connector} type="button" role="listitem" className={mergeClasses(s.cardBtn, open === r.connector && s.cardSelected)} aria-label={SOURCE_LABELS[r.connector]} onClick={() => setOpen(r.connector)}>
                <span className={s.icon}>
                  <SourceMark source={r.connector} />
                </span>
                <span className={s.cardBody}>
                  <span className={s.cardTop}>
                    <Text weight="semibold">{SOURCE_LABELS[r.connector]}</Text>
                    <ConnectionBadge state={r.state} />
                  </span>
                  <Text size={200} className={s.accountWrap}>
                    CLI · {r.connector === "github" ? "gh" : "az"}
                    {connected && r.account ? ` · ${r.account}` : ""}
                  </Text>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <Table aria-label="Connectors">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Connector</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Authorization</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => {
              const connected = r.state === "connected";
              return (
                <TableRow key={r.connector} className={mergeClasses(s.row, open === r.connector && s.rowSelected)} onClick={() => setOpen(r.connector)} aria-label={SOURCE_LABELS[r.connector]}>
                  <TableCell>
                    <span className={s.name}>
                      <span className={s.icon}>
                        <SourceMark source={r.connector} />
                      </span>
                      {SOURCE_LABELS[r.connector]}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={s.muted}>CLI · {r.connector === "github" ? "gh" : "az"}</span>
                  </TableCell>
                  <TableCell>{connected ? "Individual" : <span className={s.muted}>—</span>}</TableCell>
                  <TableCell>
                    {connected ? (
                      <span className={s.status}>
                        <Checkmark16Regular aria-label="connected" />
                        <Text size={200} className={s.accountWrap}>
                          {r.account}
                        </Text>
                      </span>
                    ) : r.state === "not_connected" ? (
                      <Button size="small" onClick={() => setOpen(r.connector)}>
                        Connect
                      </Button>
                    ) : (
                      <ConnectionBadge state={r.state} />
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      {open !== null && (
        <section className={s.detail} aria-label={`${SOURCE_LABELS[open]} connection`}>
          <div className={s.detailHead}>
            <span className={s.icon}>
              <SourceMark source={open} />
            </span>
            <Text weight="semibold">{SOURCE_LABELS[open]}</Text>
            <ConnectionBadge state={open === "github" ? status.github.state : status.azure.state} />
          </div>
          {open === "github" ? <GitHubDetail status={status.github} onChanged={onChanged} /> : <AzureDetail status={status.azure} onChanged={onChanged} />}
        </section>
      )}
    </div>
  );
}
