// SETTINGS → CLAUDE CONNECTORS: what Claude may use as the signed-in Claude account -- the connectors it connected at
// claude.ai, and the servers of the plugins installed for it -- each with where it may be used: chats, research. The list
// is the account's own Claude CLI's answer (Read again asks it anew); the choices are this account's, and a connector
// nobody chose for is checked for both. More columns can join as Orbit Web gains places to use a connector.
import { Badge, Button, Checkbox, Link, MessageBar, MessageBarBody, Spinner, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { ArrowClockwise16Regular } from "@fluentui/react-icons";
import { CONNECTOR_USES, type Connector, type ConnectorList, type ConnectorUse } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { useI18n, type MessageKey } from "../../i18n";
import { errorText, get, send } from "../../services/api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "12px" },
  head: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", fontWeight: tokens.fontWeightSemibold, fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, paddingTop: "6px", paddingBottom: "6px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  thUse: { width: "92px", textAlign: "center" },
  td: { paddingTop: "8px", paddingBottom: "8px", borderBottom: `1px solid ${tokens.colorNeutralStroke3}`, verticalAlign: "middle" },
  tdUse: { textAlign: "center" },
  name: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  cardList: { display: "flex", flexDirection: "column", gap: "8px" },
  card: { display: "flex", flexDirection: "column", gap: "8px", padding: "12px", borderRadius: tokens.borderRadiusLarge, ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2), backgroundColor: tokens.colorNeutralBackground1 },
  cardChecks: { display: "flex", gap: "12px", flexWrap: "wrap" },
});

const USE_KEYS: Record<keyof ConnectorUse, MessageKey> = {
  chat: "settings.claudeConnectors.use.chat",
  research: "settings.claudeConnectors.use.research",
};

// The CLI's word, as a person reads it.
const statusOf = (status: string, t: (k: MessageKey) => string): { label: string; color: "success" | "warning" | "danger" | "informative" } => {
  if (status === "connected") return { label: t("settings.claudeConnectors.status.connected"), color: "success" };
  if (status === "needs-auth") return { label: t("settings.claudeConnectors.status.needsAuth"), color: "warning" };
  if (status === "failed") return { label: t("settings.claudeConnectors.status.failed"), color: "danger" };
  if (status === "pending") return { label: t("settings.claudeConnectors.status.pending"), color: "informative" };
  return { label: status, color: "informative" };
};

export function ClaudeConnectorsSection() {
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile } = useViewport();
  const list = useResource<ConnectorList>(() => get<ConnectorList>("/api/claude/connectors"), []);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (key: string, work: () => Promise<ConnectorList>) => {
    setBusyKey(key);
    setError(null);
    try {
      list.set(await work());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusyKey(null);
    }
  };
  const choose = (c: Connector, use: keyof ConnectorUse, value: boolean) => void act(c.name, () => send<ConnectorList>("PUT", "/api/claude/connectors", { connectors: { [c.name]: { [use]: value } } }));
  const readAgain = () => void act("refresh", () => send<ConnectorList>("POST", "/api/claude/connectors/refresh"));

  const data = list.data;
  const refreshing = busyKey === "refresh";
  const statusPill = (c: Connector) => {
    const status = statusOf(c.status, t);
    const badge = (
      <Badge appearance="tint" size="small" color={status.color}>
        {status.label}
      </Badge>
    );
    return c.status === "needs-auth" ? (
      <Link href="https://claude.ai" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
        {badge}
      </Link>
    ) : (
      badge
    );
  };
  return (
    <section className={`${s.root} orbit-touch`} aria-label={t("settings.claudeConnectors.aria")}>
      <Text className={s.muted}>
        {t("settings.claudeConnectors.intro")}
      </Text>
      <div className={s.head}>
        <Text size={200} className={s.muted}>
          {data?.readAt ? t("settings.claudeConnectors.readAt", { when: new Date(data.readAt).toLocaleString() }) : data?.source === "unavailable" ? t("settings.claudeConnectors.notRead") : ""}
        </Text>
        <Button size="small" icon={refreshing ? <Spinner size="extra-tiny" /> : <ArrowClockwise16Regular />} onClick={readAgain} disabled={busyKey !== null}>
          {t("settings.claudeConnectors.readAgain")}
        </Button>
      </div>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {list.error && data === null && (
        <MessageBar intent="error">
          <MessageBarBody>{list.error}</MessageBarBody>
        </MessageBar>
      )}
      {data?.detail && (
        <MessageBar intent="warning">
          <MessageBarBody>{data.detail}</MessageBarBody>
        </MessageBar>
      )}
      {data === null && list.error === null && <Spinner size="tiny" label={t("settings.claudeConnectors.loading")} />}
      {data !== null && data.connectors.length === 0 && <Text className={s.muted}>{t("settings.claudeConnectors.empty")}</Text>}
      {data !== null && data.connectors.length > 0 && isMobile && (
        <div className={s.cardList}>
          {data.connectors.map((c) => (
            <div key={c.name} className={s.card}>
              <span className={s.name}>
                <Text weight="semibold">{c.label}</Text>
                <Badge appearance="outline" size="small">
                  {c.kind === "claude.ai" ? t("settings.claudeConnectors.kind.claudeAi") : c.kind === "plugin" ? t("settings.claudeConnectors.kind.plugin") : t("settings.claudeConnectors.kind.server")}
                </Badge>
                {statusPill(c)}
              </span>
              <div className={s.cardChecks}>
                {CONNECTOR_USES.map((use) => (
                  <Checkbox
                    key={use}
                    label={t(USE_KEYS[use])}
                    aria-label={t("settings.claudeConnectors.checkboxAria", { label: c.label, use: t(USE_KEYS[use]).toLowerCase() })}
                    checked={c[use]}
                    disabled={refreshing || busyKey === c.name}
                    onChange={(_, d) => choose(c, use, d.checked === true)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {data !== null && data.connectors.length > 0 && !isMobile && (
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.th} scope="col">
                {t("settings.claudeConnectors.colConnector")}
              </th>
              {CONNECTOR_USES.map((use) => (
                <th key={use} className={`${s.th} ${s.thUse}`} scope="col">
                  {t(USE_KEYS[use])}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.connectors.map((c) => (
              <tr key={c.name}>
                <td className={s.td}>
                  <span className={s.name}>
                    <Text weight="semibold">{c.label}</Text>
                    <Badge appearance="outline" size="small">
                      {c.kind === "claude.ai" ? t("settings.claudeConnectors.kind.claudeAi") : c.kind === "plugin" ? t("settings.claudeConnectors.kind.plugin") : t("settings.claudeConnectors.kind.server")}
                    </Badge>
                    {statusPill(c)}
                  </span>
                </td>
                {CONNECTOR_USES.map((use) => (
                  <td key={use} className={`${s.td} ${s.tdUse}`}>
                    <Checkbox aria-label={t("settings.claudeConnectors.checkboxAria", { label: c.label, use: t(USE_KEYS[use]).toLowerCase() })} checked={c[use]} disabled={refreshing || busyKey === c.name} onChange={(_, d) => choose(c, use, d.checked === true)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
