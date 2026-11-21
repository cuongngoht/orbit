// SETTINGS → CLAUDE CONNECTORS: what Claude may use as the signed-in Claude account -- the connectors it connected at
// claude.ai, and the servers of the plugins installed for it -- each with where it may be used: chats, research. The list
// is the account's own Claude CLI's answer (Read again asks it anew); the choices are this account's, and a connector
// nobody chose for is checked for both. More columns can join as Orbit Web gains places to use a connector.
import { Badge, Button, Checkbox, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise16Regular } from "@fluentui/react-icons";
import { CONNECTOR_USES, type Connector, type ConnectorList, type ConnectorUse } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
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
});

const USE_LABELS: Record<keyof ConnectorUse, string> = { chat: "Chat", research: "Research" };

// The CLI's word, as a person reads it.
const statusOf = (status: string): { label: string; color: "success" | "warning" | "danger" | "informative" } => {
  if (status === "connected") return { label: "Connected", color: "success" };
  if (status === "needs-auth") return { label: "Sign in at claude.ai", color: "warning" };
  if (status === "failed") return { label: "Failed", color: "danger" };
  if (status === "pending") return { label: "Connecting…", color: "informative" };
  return { label: status, color: "informative" };
};

export function ClaudeConnectorsSection() {
  const s = useStyles();
  const list = useResource<ConnectorList>(() => get<ConnectorList>("/api/claude/connectors"), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (work: () => Promise<ConnectorList>) => {
    setBusy(true);
    setError(null);
    try {
      list.set(await work());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const choose = (c: Connector, use: keyof ConnectorUse, value: boolean) => void act(() => send<ConnectorList>("PUT", "/api/claude/connectors", { connectors: { [c.name]: { [use]: value } } }));
  const readAgain = () => void act(() => send<ConnectorList>("POST", "/api/claude/connectors/refresh"));

  const data = list.data;
  return (
    <section className={s.root} aria-label="Claude connectors">
      <Text className={s.muted}>
        A checked connector can be used by Claude as your Claude account -- it reads and writes in that service: in every chat, or in research sessions, where your sources are references Claude reads beside your question (check there only what you want research to act with, such as Claude Docs). Connectors are connected at claude.ai; one waiting for your sign-in there cannot be used until you do.
      </Text>
      <div className={s.head}>
        <Text size={200} className={s.muted}>
          {data?.readAt ? `Read from your Claude account ${new Date(data.readAt).toLocaleString()}` : data?.source === "unavailable" ? "Not read from your Claude account" : ""}
        </Text>
        <Button size="small" icon={busy ? <Spinner size="extra-tiny" /> : <ArrowClockwise16Regular />} onClick={readAgain} disabled={busy}>
          Read again
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
      {data === null && list.error === null && <Spinner size="tiny" label="Asking your Claude account…" />}
      {data !== null && data.connectors.length === 0 && <Text className={s.muted}>Your Claude account has no connector.</Text>}
      {data !== null && data.connectors.length > 0 && (
        <table className={s.table}>
          <thead>
            <tr>
              <th className={s.th} scope="col">
                Connector
              </th>
              {CONNECTOR_USES.map((use) => (
                <th key={use} className={`${s.th} ${s.thUse}`} scope="col">
                  {USE_LABELS[use]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.connectors.map((c) => {
              const status = statusOf(c.status);
              return (
                <tr key={c.name}>
                  <td className={s.td}>
                    <span className={s.name}>
                      <Text weight="semibold">{c.label}</Text>
                      <Badge appearance="outline" size="small">
                        {c.kind === "claude.ai" ? "claude.ai" : c.kind === "plugin" ? "plugin" : "server"}
                      </Badge>
                      <Badge appearance="tint" size="small" color={status.color}>
                        {status.label}
                      </Badge>
                    </span>
                  </td>
                  {CONNECTOR_USES.map((use) => (
                    <td key={use} className={`${s.td} ${s.tdUse}`}>
                      <Checkbox aria-label={`${c.label} in ${USE_LABELS[use].toLowerCase()}`} checked={c[use]} disabled={busy} onChange={(_, d) => choose(c, use, d.checked === true)} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
