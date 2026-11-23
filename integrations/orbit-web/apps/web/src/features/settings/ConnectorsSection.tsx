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
import { useI18n, type MessageKey } from "../../i18n";
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

const CLI_KEYS: Record<ConnectorName, MessageKey> = {
  github: "settings.connectors.cli.github",
  azure: "settings.connectors.cli.azure",
};

function DeviceFlow({ connector, flow, onCancel, busy }: { connector: ConnectorName; flow: LoginSnapshot | null; onCancel: () => void; busy: boolean }) {
  const { t } = useI18n();
  const s = useStyles();
  const cli = t(CLI_KEYS[connector]);
  if (flow === null || flow.state === "idle" || flow.state === "connected") return null;
  if (flow.state === "starting") return <Spinner size="tiny" label={t("settings.connectors.device.starting", { cli })} />;
  if (flow.state === "verifying") return <Spinner size="tiny" label={flow.message ?? t("settings.connectors.device.verifying")} />;
  if (flow.state === "awaiting_user")
    return (
      <div className={s.root}>
        <Text>
          {t("settings.connectors.device.openPrefix")}{" "}
          <Link href={flow.url ?? "#"} target="_blank" rel="noopener noreferrer">
            {flow.url}
          </Link>{" "}
          {t("settings.connectors.device.enterCode", { cli })}
        </Text>
        <Text className={s.code} aria-label={connector === "github" ? t("settings.connectors.device.codeAriaGithub") : t("settings.connectors.device.codeAriaAzure")}>
          {flow.code}
        </Text>
        <Spinner size="tiny" label={t("settings.connectors.device.waiting")} labelPosition="after" />
        <div>
          <Button appearance="subtle" onClick={onCancel} disabled={busy}>
            {t("settings.connections.cancel")}
          </Button>
        </div>
      </div>
    );
  return (
    <MessageBar intent={flow.state === "cancelled" ? "info" : "error"}>
      <MessageBarBody>{flow.message ?? t("settings.connectors.device.signInStatus", { state: flow.state.replace("_", " ") })}</MessageBarBody>
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
  const { t } = useI18n();
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
          {t("settings.connectors.github.connectedAs")} <strong>@{status.account.login}</strong>
          {status.account.name ? ` (${status.account.name})` : ""}
        </Text>
      )}
      {status.state === "expired" && (
        <MessageBar intent="warning">
          <MessageBarBody>{t("settings.connectors.github.expiredRest", { detail: status.detail ?? t("settings.connectors.github.expiredDefault") })}</MessageBarBody>
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
              {t("settings.connectors.github.connect")}
            </Button>
          )}
          {connected && (
            <Button className={s.actionBtn} appearance="secondary" disabled={busy} onClick={() => act(() => send("POST", "/api/github/logout"))}>
              {t("settings.connectors.github.disconnect")}
            </Button>
          )}
        </div>
      )}
      <Switch checked={status.availableToClaude} disabled={busy} onChange={(_, d) => void act(() => send("PATCH", "/api/settings", { githubForClaude: d.checked }))} label={t("settings.connectors.github.switchLabel")} />
      <Text size={200} className={s.muted}>
        {t("settings.connectors.github.switchHintBeforeGh")} <code>gh</code> {t("settings.connectors.github.switchHintMiddle")}<code>gh auth</code> {t("settings.connectors.github.switchHintAfterAuth")}
      </Text>
      <Text size={200} className={s.muted}>
        {t("settings.connectors.github.cliHint")}
      </Text>
    </>
  );
}

function AzureDetail({ status, onChanged }: { status: AzureStatus; onChanged: () => void }) {
  const { t } = useI18n();
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
          {t("settings.connectors.azure.signedInAs")} <strong>{status.account.user}</strong>
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
          <Field label={t("settings.connectors.azure.tenantLabel")}>
            <Input value={tenant} onChange={(_, d) => setTenant(d.value)} placeholder={t("settings.connectors.azure.tenantPlaceholder")} autoComplete="off" spellCheck={false} />
          </Field>
          <Button className={s.actionBtn} appearance="primary" type="submit" disabled={busy}>
            {t("settings.connectors.azure.connect")}
          </Button>
        </form>
      )}
      {connected && !flowActive(flow) && (
        <div className={s.buttons}>
          <Button className={s.actionBtn} appearance="secondary" disabled={busy} onClick={() => act(() => send("POST", "/api/azure/logout"))}>
            {t("settings.connectors.azure.signOut")}
          </Button>
        </div>
      )}
      <Switch checked={status.availableToClaude} disabled={busy} onChange={(_, d) => void act(() => send("PATCH", "/api/settings", { azureForClaude: d.checked }))} label={t("settings.connectors.azure.switchLabel")} />
      <Text size={200} className={s.muted}>
        {t("settings.connectors.azure.switchHintBefore")} <code>az</code> {t("settings.connectors.azure.switchHintAfter")}
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
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile } = useViewport();
  const [open, setOpen] = useState<ConnectorName | null>(initial ?? null);
  if (status === null) return <Spinner label={t("settings.connectors.loading")} />;
  const rows: Row[] = [
    { connector: "github", state: status.github.state, account: status.github.account ? `@${status.github.account.login}` : null },
    { connector: "azure", state: status.azure.state, account: status.azure.account?.user ?? null },
  ];
  return (
    <div className={s.root}>
      {isMobile ? (
        <div className={s.cardList} role="list" aria-label={t("settings.connectors.listAria")}>
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
                    {t("settings.connectors.cliMeta", { cmd: r.connector === "github" ? "gh" : "az" })}
                    {connected && r.account ? ` · ${r.account}` : ""}
                  </Text>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <Table aria-label={t("settings.connectors.listAria")}>
          <TableHeader>
            <TableRow>
              <TableHeaderCell>{t("settings.connectors.colConnector")}</TableHeaderCell>
              <TableHeaderCell>{t("settings.connectors.colType")}</TableHeaderCell>
              <TableHeaderCell>{t("settings.connectors.colAuthorization")}</TableHeaderCell>
              <TableHeaderCell>{t("settings.connectors.colStatus")}</TableHeaderCell>
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
                    <span className={s.muted}>{t("settings.connectors.cliMeta", { cmd: r.connector === "github" ? "gh" : "az" })}</span>
                  </TableCell>
                  <TableCell>{connected ? t("settings.connectors.individual") : <span className={s.muted}>—</span>}</TableCell>
                  <TableCell>
                    {connected ? (
                      <span className={s.status}>
                        <Checkmark16Regular aria-label={t("settings.connectors.connectedAria")} />
                        <Text size={200} className={s.accountWrap}>
                          {r.account}
                        </Text>
                      </span>
                    ) : r.state === "not_connected" ? (
                      <Button size="small" onClick={() => setOpen(r.connector)}>
                        {t("settings.connectors.connect")}
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
        <section className={s.detail} aria-label={t("settings.connectors.detailAria", { label: SOURCE_LABELS[open] })}>
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
