// SETTINGS → MCP SERVERS: the account's knowledge bases and other remote MCP servers (Streamable HTTP) its employees may
// ask -- each turned on per employee on its Access page. Orbit Web connects, with the sign-in given here: a token is typed
// once and never shown again, and it never enters an employee's sandbox. Employees are offered only the tools allowed
// here: one its server marks read-only is allowed when the server is added, any other only once a person checks it.
import { Badge, Button, Checkbox, Field, Input, Link, MessageBar, MessageBarBody, Radio, RadioGroup, Spinner, Text, makeStyles, shorthands, tokens } from "@fluentui/react-components";
import { ArrowClockwise16Regular, Delete16Regular } from "@fluentui/react-icons";
import { MCP_AUTH_KINDS, MCP_AUTH_LABELS, type McpAuthKind, type McpServerList, type McpServerView } from "@orbit-web/contracts";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useI18n } from "../../i18n";
import { errorText, get, send } from "../../services/api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  card: { display: "flex", flexDirection: "column", gap: "10px", paddingTop: "12px", paddingRight: "14px", paddingBottom: "12px", paddingLeft: "14px", borderRadius: "12px", ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2), minWidth: 0 },
  head: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
  grow: { flexGrow: 1, minWidth: 0 },
  url: { color: tokens.colorNeutralForeground3, fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, overflowWrap: "anywhere" },
  tools: { display: "flex", flexDirection: "column", gap: "2px" },
  tool: { display: "flex", alignItems: "flex-start", gap: "6px", minWidth: 0 },
  toolText: { display: "flex", flexDirection: "column", minWidth: 0, paddingTop: "6px" },
  code: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200 },
  form: { display: "flex", flexDirection: "column", gap: "10px", maxWidth: "560px" },
  actions: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" },
});

function ServerCard({ server, onChanged, onRemoved }: { server: McpServerView; onChanged: (s: McpServerView) => void; onRemoved: (l: McpServerList) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async <T,>(work: () => Promise<T>, then: (v: T) => void) => {
    setBusy(true);
    setError(null);
    try {
      then(await work());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const allowed = server.tools.filter((tool) => tool.allowed).map((tool) => tool.name);
  const allow = (name: string, on: boolean) => void act(() => send<McpServerView>("PUT", `/api/mcp-servers/${server.id}`, { allowedTools: on ? [...allowed, name] : allowed.filter((a) => a !== name) }), onChanged);
  const auth = server.auth.kind === "header" ? `${MCP_AUTH_LABELS.header} (${server.auth.header ?? ""})` : MCP_AUTH_LABELS[server.auth.kind];
  return (
    <section className={s.card} aria-label={server.name}>
      <div className={s.head}>
        <div className={s.grow}>
          <Text weight="semibold">{server.name}</Text>
          <div className={s.url}>{server.url}</div>
        </div>
        <Badge appearance="outline" size="small">
          {auth}
        </Badge>
        <Button size="small" icon={busy ? <Spinner size="extra-tiny" /> : <ArrowClockwise16Regular />} disabled={busy} onClick={() => void act(() => send<McpServerView>("POST", `/api/mcp-servers/${server.id}/refresh`), onChanged)}>
          {t("settings.mcp.readAgain")}
        </Button>
        <Button size="small" icon={<Delete16Regular />} disabled={busy} onClick={() => setConfirming(true)}>
          {t("settings.mcp.remove")}
        </Button>
      </div>
      {confirming && (
        <div className={s.actions}>
          <Text size={200}>{t("settings.mcp.removeConfirmHint")}</Text>
          <Button size="small" appearance="primary" disabled={busy} onClick={() => void act(() => send<McpServerList>("DELETE", `/api/mcp-servers/${server.id}`), onRemoved)}>
            {t("settings.mcp.removeNamed", { name: server.name })}
          </Button>
          <Button size="small" disabled={busy} onClick={() => setConfirming(false)}>
            {t("settings.connections.cancel")}
          </Button>
        </div>
      )}
      {server.readError !== null && (
        <MessageBar intent="warning">
          <MessageBarBody>{server.readError}</MessageBarBody>
        </MessageBar>
      )}
      {error !== null && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <Text size={200} className={s.muted}>
        {server.readAt === null ? t("settings.mcp.toolsNotReadYet") : t("settings.mcp.toolsRead", { count: server.tools.length, when: new Date(server.readAt).toLocaleString() })}
      </Text>
      {server.tools.length > 0 && (
        <div className={s.tools}>
          {server.tools.map((tool) => (
            <div key={tool.name} className={s.tool}>
              <Checkbox aria-label={t("settings.mcp.toolCheckboxAria", { name: tool.name })} checked={tool.allowed} disabled={busy} onChange={(_, d) => allow(tool.name, d.checked === true)} />
              <div className={s.toolText}>
                <span className={s.head}>
                  <span className={s.code}>{tool.name}</span>
                  {tool.readOnly === true && (
                    <Badge appearance="tint" color="success" size="small">
                      {t("settings.mcp.readOnly")}
                    </Badge>
                  )}
                  {tool.readOnly === false && (
                    <Badge appearance="tint" color="warning" size="small">
                      {t("settings.mcp.mayChangeData")}
                    </Badge>
                  )}
                </span>
                {tool.description !== "" && (
                  <Text size={200} className={s.muted}>
                    {tool.description.length > 240 ? `${tool.description.slice(0, 240)}…` : tool.description}
                  </Text>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AddServer({ onAdded }: { onAdded: (s: McpServerView) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<McpAuthKind>("none");
  const [header, setHeader] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = name.trim() !== "" && url.trim() !== "" && (kind === "none" || token !== "") && (kind !== "header" || header.trim() !== "");
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const auth = kind === "none" ? { kind } : kind === "bearer" ? { kind, token } : { kind, header: header.trim(), token };
      onAdded(await send<McpServerView>("POST", "/api/mcp-servers", { name: name.trim(), url: url.trim(), auth }));
      setName("");
      setUrl("");
      setHeader("");
      setToken("");
      setKind("none");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={`${s.card} ${s.form}`} aria-label={t("settings.mcp.add.aria")}>
      <Text weight="semibold">{t("settings.mcp.add.title")}</Text>
      <Field label={t("settings.mcp.add.name")}>
        <Input value={name} onChange={(_, d) => setName(d.value)} placeholder={t("settings.mcp.add.namePlaceholder")} />
      </Field>
      <Field label={t("settings.mcp.add.url")} hint={t("settings.mcp.add.urlHint")}>
        <Input value={url} onChange={(_, d) => setUrl(d.value)} placeholder={t("settings.mcp.add.urlPlaceholder")} />
      </Field>
      <Field label={t("settings.mcp.add.signIn")}>
        <RadioGroup layout="horizontal" value={kind} onChange={(_, d) => setKind(d.value as McpAuthKind)}>
          {MCP_AUTH_KINDS.map((k) => (
            <Radio key={k} value={k} label={MCP_AUTH_LABELS[k]} />
          ))}
        </RadioGroup>
      </Field>
      {kind === "header" && (
        <Field label={t("settings.mcp.add.header")}>
          <Input value={header} onChange={(_, d) => setHeader(d.value)} placeholder={t("settings.mcp.add.headerPlaceholder")} />
        </Field>
      )}
      {kind !== "none" && (
        <Field label={t("settings.mcp.add.token")} hint={t("settings.mcp.add.tokenHint")}>
          <Input type="password" value={token} onChange={(_, d) => setToken(d.value)} autoComplete="off" />
        </Field>
      )}
      {error !== null && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.actions}>
        <Button appearance="primary" disabled={busy || !ready} onClick={() => void add()}>
          {t("settings.mcp.add.submit")}
        </Button>
        {busy && <Spinner size="tiny" label={t("settings.mcp.add.readingTools")} />}
      </div>
    </section>
  );
}

export function McpServersSection() {
  const { t } = useI18n();
  const s = useStyles();
  const list = useResource<McpServerList>(() => get<McpServerList>("/api/mcp-servers"), []);
  const servers = list.data?.servers ?? [];
  const replace = (v: McpServerView) => list.set({ servers: servers.map((x) => (x.id === v.id ? v : x)) });
  return (
    <section className={s.root} aria-label={t("settings.mcp.aria")}>
      <Text className={s.muted}>
        {t("settings.mcp.introBefore")} <Link href="#/office">{t("settings.mcp.introLink")}</Link> {t("settings.mcp.introAfter")}
      </Text>
      {list.error !== null && list.data === null && (
        <MessageBar intent="error">
          <MessageBarBody>{list.error}</MessageBarBody>
        </MessageBar>
      )}
      {list.data === null && list.error === null && <Spinner size="tiny" label={t("settings.mcp.loading")} />}
      {list.data !== null && servers.length === 0 && <Text className={s.muted}>{t("settings.mcp.empty")}</Text>}
      {servers.map((x) => (
        <ServerCard key={x.id} server={x} onChanged={replace} onRemoved={(l) => list.set(l)} />
      ))}
      {list.data !== null && <AddServer onAdded={(v) => list.set({ servers: [...servers, v] })} />}
    </section>
  );
}
