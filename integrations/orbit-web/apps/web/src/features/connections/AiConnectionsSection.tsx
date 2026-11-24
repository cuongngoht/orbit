// SETTINGS → AI CONNECTIONS: the three AI CLIs an Orbit account can connect -- Claude Code, OpenAI Codex, Google
// Antigravity -- each as a card: whether the CLI is on this server, the ways of signing in it offers (with what each rests
// on), and the account's connections to it. Every status is the CLI's own word, read at the time shown: Connected only
// when its own status command names an identity. A subscription is signed in by the provider's own CLI: from its card
// (ADR 0061: the CLI's sign-in runs on the server, this browser opens the link it printed -- and, for Claude Code, pastes
// back the code its page shows) or in a terminal of the server; an API key is typed here once and never shown back.
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Radio,
  RadioGroup,
  Select,
  Spinner,
  Switch,
  Text,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import { Add16Regular, ArrowSync16Regular, Copy16Regular, Delete16Regular, Key16Regular, Open16Regular, PlugDisconnected16Regular, Star16Regular } from "@fluentui/react-icons";
import {
  AUTH_STATE_TEXT,
  RUNTIME_KINDS,
  RUNTIME_LABELS,
  effortLabel,
  type AiConnectionsView,
  type AuthMethod,
  type AuthState,
  type Capability,
  type ConnectionSignIn,
  type CreateConnectionRequest,
  type MethodSupport,
  type MethodSupportState,
  type PluginUseCase,
  type RuntimeCapabilities,
  type RuntimeConnection,
  type RuntimeInstallation,
  type RuntimeKind,
} from "@orbit-web/contracts";
import { useEffect, useRef, useState } from "react";
import { flowActive } from "../../hooks/useLoginFlow";
import { useResource } from "../../hooks/useResource";
import { useI18n, type MessageKey } from "../../i18n";
import { errorText, get, ifMatch, isStale, send } from "../../services/api";
import { useAppEvent, useAppStream } from "../../services/events/AppEvents";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 },
  helper: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px", "@media (max-width: 639px)": { gridTemplateColumns: "1fr" } },
  helperItem: { display: "flex", flexDirection: "column", gap: "2px", padding: "10px 12px", borderRadius: tokens.borderRadiusLarge, backgroundColor: tokens.colorNeutralBackground2, minWidth: 0 },
  card: { display: "flex", flexDirection: "column", gap: "12px", padding: "16px", borderRadius: "14px", ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2), backgroundColor: "var(--orbit-card-bg)", minWidth: 0 },
  head: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "space-between" },
  row: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  list: { display: "flex", flexDirection: "column", gap: "8px", listStyleType: "none", margin: 0, paddingLeft: 0 },
  method: { display: "flex", flexDirection: "column", gap: "2px", padding: "8px 10px", borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground2, minWidth: 0 },
  methodOff: { opacity: 0.75 },
  conn: { display: "flex", flexDirection: "column", gap: "10px", padding: "12px", borderRadius: "12px", ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2), minWidth: 0 },
  command: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", padding: "8px 10px", borderRadius: tokens.borderRadiusMedium, backgroundColor: tokens.colorNeutralBackground3, minWidth: 0 },
  code: { fontFamily: tokens.fontFamilyMonospace, fontSize: tokens.fontSizeBase200, wordBreak: "break-all", flexGrow: 1, minWidth: 0 },
  caps: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "4px 12px", margin: 0 },
  cap: { display: "flex", justifyContent: "space-between", gap: "6px", minWidth: 0 },
  actions: { display: "flex", gap: "8px", flexWrap: "wrap" },
  action: { "@media (pointer: coarse)": { minHeight: "44px" } },
  form: { display: "flex", flexDirection: "column", gap: "10px", padding: "12px", borderRadius: "12px", backgroundColor: tokens.colorNeutralBackground2, minWidth: 0 },
  models: { display: "flex", flexDirection: "column", gap: "4px", listStyleType: "none", margin: 0, paddingLeft: 0 },
});

const METHOD_KEYS: Record<AuthMethod, MessageKey> = {
  subscription: "settings.connections.method.subscription",
  api_key: "settings.connections.method.apiKey",
  cloud: "settings.connections.method.cloud",
};

const SUPPORT_KEYS: Record<MethodSupportState, MessageKey> = {
  supported: "settings.connections.support.supported",
  not_verified: "settings.connections.support.notVerified",
  not_permitted: "settings.connections.support.notPermitted",
  blocked: "settings.connections.support.blocked",
};

const AUTH_TONE: Record<AuthState, "success" | "subtle" | "warning" | "danger"> = { connected: "success", disconnected: "subtle", auth_required: "warning", error: "danger" };

const CAPABILITY_KEYS: Record<keyof RuntimeCapabilities, MessageKey> = {
  start: "settings.connections.cap.start",
  stream: "settings.connections.cap.stream",
  cancel: "settings.connections.cap.cancel",
  resume: "settings.connections.cap.resume",
  usage: "settings.connections.cap.usage",
  webSearch: "settings.connections.cap.webSearch",
  toolPlaneSplit: "settings.connections.cap.toolPlaneSplit",
  pluginObservation: "settings.connections.cap.pluginObservation",
};

const CAP_WORD_KEYS: Record<Capability, MessageKey> = {
  yes: "settings.connections.capWord.yes",
  no: "settings.connections.capWord.no",
  unknown: "settings.connections.capWord.unknown",
};

const useWhen = () => {
  const { t } = useI18n();
  return (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : t("settings.connections.never"));
};

// What each of the four things a person may confuse is, in one line each.
function Helper() {
  const { t } = useI18n();
  const s = useStyles();
  const items: [string, string][] = [
    [t("settings.connections.helper.orbitSignInTitle"), t("settings.connections.helper.orbitSignInText")],
    [t("settings.connections.helper.providerTitle"), t("settings.connections.helper.providerText")],
    [t("settings.connections.helper.pluginTitle"), t("settings.connections.helper.pluginText")],
    [t("settings.connections.helper.connectorsTitle"), t("settings.connections.helper.connectorsText")],
  ];
  return (
    <div className={s.helper} aria-label={t("settings.connections.helper.aria")}>
      {items.map(([title, text]) => (
        <div key={title} className={s.helperItem}>
          <Text weight="semibold" size={200}>
            {title}
          </Text>
          <Text size={200} className={s.muted}>
            {text}
          </Text>
        </div>
      ))}
    </div>
  );
}

function Installation({ install }: { install: RuntimeInstallation | undefined }) {
  const { t } = useI18n();
  const when = useWhen();
  const s = useStyles();
  if (install === undefined) return <Text className={s.muted}>{t("settings.connections.install.notCheckedYet")}</Text>;
  if (install.state === "installed")
    return (
      <Text size={200}>
        <Badge appearance="tint" color="success">
          {t("settings.connections.install.installed")}
        </Badge>{" "}
        {t("settings.connections.install.versionChecked", { version: install.version ?? t("settings.connections.unknown"), when: when(install.checkedAt) })}
      </Text>
    );
  return (
    <Text size={200}>
      <Badge appearance="tint" color={install.state === "not_installed" ? "subtle" : "danger"}>
        {install.state === "not_installed" ? t("settings.connections.install.notInstalled") : t("settings.connections.install.couldNotBeChecked")}
      </Badge>{" "}
      {t("settings.connections.install.detailChecked", { detail: install.detail ?? t("settings.connections.install.noReasonGiven"), when: when(install.checkedAt) })}
    </Text>
  );
}

function MethodRow({ m }: { m: MethodSupport }) {
  const { t } = useI18n();
  const s = useStyles();
  const methodText = t(METHOD_KEYS[m.method]);
  const supportText = t(SUPPORT_KEYS[m.state]);
  return (
    <li className={mergeClasses(s.method, m.state !== "supported" && s.methodOff)} aria-label={t("settings.connections.method.aria", { method: methodText, support: supportText })}>
      <div className={s.row}>
        <Text weight="semibold" size={200}>
          {methodText}
        </Text>
        <Badge appearance="outline" color={m.state === "supported" ? "success" : m.state === "not_verified" ? "warning" : "danger"}>
          {supportText}
        </Badge>
      </div>
      <Text size={200} className={s.muted}>
        {m.note}
        {m.source && (
          <>
            {" "}
            <Link href={m.source} target="_blank" rel="noopener noreferrer">
              {t("settings.connections.source")}
            </Link>
          </>
        )}
      </Text>
    </li>
  );
}

// SIGNING A SUBSCRIPTION IN FROM ITS CARD (ADR 0061): the connection's CLI runs its own sign-in on the server, and only
// the browser that started it is shown the link it printed -- with Codex's one-time code to enter there -- and, for
// Claude Code, sends back the code its page shows. Connected only once the CLI's own status names who it is.
function SignIn({ c, autoStart, onStarted, onChanged, onClose }: { c: RuntimeConnection; autoStart: boolean; onStarted: () => void; onChanged: () => void; onClose: (() => void) | null }) {
  const { t } = useI18n();
  const s = useStyles();
  const path = `/api/connections/${encodeURIComponent(c.id)}/sign-in`;
  const [view, setView] = useState<ConnectionSignIn | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"url" | "code" | null>(null);
  const flow = view?.flow ?? null;
  const active = flowActive(flow);
  const wasActive = useRef(false);
  // The card's latest reload, for the moment the sign-in ends (kept current after each render, never during one).
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  });
  // What the server says now (a sign-in may be under way from before this card was drawn) -- or, right after the
  // connection was added, its sign-in started.
  useEffect(() => {
    let gone = false;
    const first = autoStart ? send<ConnectionSignIn>("POST", path) : get<ConnectionSignIn>(path);
    if (autoStart) onStarted();
    first.then((v) => !gone && setView(v)).catch((err: unknown) => !gone && setError(errorText(err)));
    return () => {
      gone = true;
    };
    // Once per card: a started sign-in is followed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  // While it runs, it is followed; when it ends, the card is read again (Connected, or the CLI's own reason).
  useEffect(() => {
    if (active) wasActive.current = true;
    else if (wasActive.current) {
      wasActive.current = false;
      changed.current();
    }
    if (!active) return;
    const timer = setInterval(() => void get<ConnectionSignIn>(path).then(setView).catch(() => undefined), 1500);
    return () => clearInterval(timer);
  }, [active, path]);
  const run = async (work: () => Promise<ConnectionSignIn>) => {
    setBusy(true);
    setError(null);
    try {
      setView(await work());
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const copy = async (what: "url" | "code", text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  };
  const start = () => run(() => send("POST", path));
  const cancel = () => run(() => send("POST", `${path}/cancel`));
  const submit = () =>
    run(() => {
      const typed = code.trim();
      setCode("");
      return send("POST", `${path}/code`, { code: typed });
    });
  const label = RUNTIME_LABELS[c.runtime];
  const ended = flow !== null && !active && flow.state !== "idle";
  return (
    <section className={s.form} aria-label={t("settings.connections.signIn.aria", { label: c.label })}>
      {view !== null && !view.mine && active ? (
        <>
          <Text size={200}>{t("settings.connections.signIn.otherBrowser", { who: view.startedBy ?? t("settings.connections.signIn.somebody") })}</Text>
          <div className={s.actions}>
            <Button size="small" disabled={busy} onClick={() => void cancel()}>
              {t("settings.connections.signIn.cancelOther")}
            </Button>
          </div>
        </>
      ) : active && flow !== null ? (
        <>
          {flow.state === "starting" && <Spinner size="tiny" label={t("settings.connections.signIn.starting", { label })} />}
          {flow.state === "awaiting_user" && flow.url && (
            <>
              <Text size={200} weight="semibold">
                {t("settings.connections.signIn.step1")}
              </Text>
              <div className={s.command}>
                <Link href={flow.url} target="_blank" rel="noopener noreferrer" className={s.code} aria-label={t("settings.connections.signIn.linkAria")}>
                  {flow.url}
                </Link>
                <Button size="small" appearance="primary" icon={<Open16Regular />} as="a" href={flow.url} target="_blank" rel="noopener noreferrer">
                  {t("settings.connections.open")}
                </Button>
                <Button size="small" icon={<Copy16Regular />} onClick={() => void copy("url", flow.url as string)}>
                  {copied === "url" ? t("settings.connections.copied") : t("settings.connections.copy")}
                </Button>
              </div>
              {flow.code && (
                <>
                  <Text size={200} weight="semibold">
                    {t("settings.connections.signIn.step2Code")}
                  </Text>
                  <div className={s.command}>
                    <code className={s.code} aria-label={t("settings.connections.signIn.oneTimeCodeAria")}>
                      {flow.code}
                    </code>
                    <Button size="small" icon={<Copy16Regular />} onClick={() => void copy("code", flow.code as string)}>
                      {copied === "code" ? t("settings.connections.copied") : t("settings.connections.copy")}
                    </Button>
                  </div>
                  <Text size={200} className={s.muted}>
                    {t("settings.connections.signIn.autoConnectNote")}
                  </Text>
                </>
              )}
              {flow.needsCode && (
                <form
                  aria-label={t("settings.connections.signIn.sendCodeAria")}
                  className={s.actions}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <Field label={t("settings.connections.signIn.step2Paste")} style={{ flexGrow: 1, minWidth: 0 }}>
                    <Input value={code} autoComplete="off" spellCheck={false} onChange={(_, d) => setCode(d.value)} />
                  </Field>
                  <Button type="submit" appearance="primary" disabled={busy || code.trim().length < 4} style={{ alignSelf: "flex-end" }}>
                    {t("settings.connections.signIn.sendCode")}
                  </Button>
                </form>
              )}
            </>
          )}
          {flow.state === "verifying" && <Spinner size="tiny" label={flow.message ?? t("settings.connections.signIn.verifyingDefault", { label })} />}
          {flow.message && flow.state === "awaiting_user" && (
            <Text size={200} className={s.muted}>
              {flow.message}
            </Text>
          )}
          <div className={s.actions}>
            <Button size="small" disabled={busy} onClick={() => void cancel()}>
              {t("settings.connections.cancel")}
            </Button>
          </div>
        </>
      ) : (
        <>
          {ended && flow !== null && (
            <MessageBar intent={flow.state === "connected" ? "success" : "warning"}>
              <MessageBarBody>{flow.message ?? (flow.state === "cancelled" ? t("settings.connections.signIn.cancelled") : t("settings.connections.signIn.ended"))}</MessageBarBody>
            </MessageBar>
          )}
          <Text size={200}>
            {c.auth === "connected"
              ? t("settings.connections.signIn.againPrompt", { identity: c.identity ?? t("settings.connections.signIn.theOneItHas") })
              : c.runtime === "codex"
                ? t("settings.connections.signIn.newPromptCodex")
                : t("settings.connections.signIn.newPromptClaude")}
          </Text>
          <div className={s.actions}>
            <Button className={s.action} appearance="primary" icon={<Key16Regular />} disabled={busy} onClick={() => void start()}>
              {ended || c.auth === "connected" ? t("settings.connections.signIn.againButton") : t("settings.connections.signIn.button")}
            </Button>
            {onClose && (
              <Button className={s.action} onClick={onClose}>
                {t("settings.connections.close")}
              </Button>
            )}
          </div>
        </>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
    </section>
  );
}

// The one command a person runs in a terminal of the server, to copy.
function TerminalCommand({ command, secondary }: { command: string; secondary: boolean }) {
  const { t } = useI18n();
  const s = useStyles();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={s.form}>
      <Text size={200}>
        {secondary ? t("settings.connections.terminal.secondary") : t("settings.connections.terminal.primary")}
      </Text>
      <div className={s.command}>
        <code className={s.code} aria-label={t("settings.connections.terminal.aria")}>
          {command}
        </code>
        <Button size="small" icon={<Copy16Regular />} onClick={() => void copy()}>
          {copied ? t("settings.connections.copied") : t("settings.connections.copy")}
        </Button>
      </div>
    </div>
  );
}

// WHAT A CONNECTION CAN BE USED FOR, as the server answers it (uses): a chat, research, AI employees -- each usable or
// not, with the reason a person acts on. Authenticated is the badge above; a use its runtime does not have here is left
// out rather than shown "off".
const USE_KEYS: Record<keyof RuntimeConnection["uses"], MessageKey> = {
  chat: "settings.connections.uses.chat",
  research: "settings.connections.uses.research",
  employee: "settings.connections.uses.employee",
};

function Uses({ c }: { c: RuntimeConnection }) {
  const { t } = useI18n();
  const s = useStyles();
  const shown = (Object.keys(USE_KEYS) as (keyof RuntimeConnection["uses"])[]).filter((u) => c.uses[u].reasonCode !== "runtime_not_supported");
  if (shown.length === 0)
    return (
      <Text size={200} className={s.muted}>
        {t("settings.connections.uses.runsNothing", { runtime: RUNTIME_LABELS[c.runtime] })}
      </Text>
    );
  return (
    <>
      <dl className={s.caps} aria-label={t("settings.connections.uses.aria")}>
        {shown.map((u) => (
          <div key={u} className={s.cap}>
            <dt>
              <Text size={200}>{t(USE_KEYS[u])}</Text>
            </dt>
            <dd style={{ margin: 0 }}>
              <Text size={200} weight="semibold">
                {c.uses[u].ready ? t("settings.connections.uses.ready") : t("settings.connections.uses.notReady")}
              </Text>
            </dd>
          </div>
        ))}
      </dl>
      {shown
        .filter((u) => !c.uses[u].ready && c.uses[u].reason !== null)
        .map((u) => (
          <Text key={u} size={200} className={s.muted}>
            {t("settings.connections.uses.why", { use: t(USE_KEYS[u]), reason: c.uses[u].reason ?? "" })}
          </Text>
        ))}
    </>
  );
}

function Capabilities({ caps }: { caps: RuntimeCapabilities }) {
  const { t } = useI18n();
  const s = useStyles();
  return (
    <dl className={s.caps} aria-label={t("settings.connections.caps.aria")}>
      {(Object.keys(CAPABILITY_KEYS) as (keyof RuntimeCapabilities)[]).map((k) => (
        <div key={k} className={s.cap}>
          <dt>
            <Text size={200}>{t(CAPABILITY_KEYS[k])}</Text>
          </dt>
          <dd style={{ margin: 0 }}>
            <Text size={200} weight="semibold">
              {t(CAP_WORD_KEYS[caps[k]])}
            </Text>
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Why a connection has no model list: a CLI that lists none (Antigravity), one not connected yet, or a connected one whose
// CLI did not answer the last check.
function useNoCatalogText() {
  const { t } = useI18n();
  return (c: RuntimeConnection): string => {
    if (c.runtime === "agy") return t("settings.connections.catalog.agy", { label: RUNTIME_LABELS[c.runtime] });
    if (c.auth !== "connected") return t("settings.connections.catalog.notConnected");
    return t("settings.connections.catalog.empty");
  };
}

function Catalog({ c }: { c: RuntimeConnection }) {
  const { t } = useI18n();
  const when = useWhen();
  const noCatalogText = useNoCatalogText();
  const s = useStyles();
  const cat = c.catalog;
  const source =
    cat.source === "account"
      ? t("settings.connections.catalog.account", { when: when(cat.checkedAt) })
      : cat.source === "fallback"
        ? t("settings.connections.catalog.fallback")
        : noCatalogText(c);
  return (
    <div>
      <Text size={200} className={s.muted}>
        {source}
      </Text>
      {cat.models.length > 0 && (
        <ul className={s.models} aria-label={t("settings.connections.catalog.modelsAria", { label: c.label })}>
          {cat.models.map((m) => (
            <li key={m.id}>
              <Text size={200}>
                <strong>{m.label}</strong> ({m.id}){cat.recommended === m.id ? t("settings.connections.catalog.recommended") : ""} — {m.efforts.length === 0 ? t("settings.connections.catalog.noEfforts") : t("settings.connections.catalog.efforts", { efforts: m.efforts.map(effortLabel).join(", ") })}
              </Text>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The Orbit plugin on a Claude Code connection: its version and digest, and one switch per use. A grant is for exactly
// the digest shown; one made for an earlier version needs confirming again.
function OrbitPlugin({ c, onChanged }: { c: RuntimeConnection; onChanged: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const p = c.plugins;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (p === null) return null;
  const grant = async (useCase: PluginUseCase, approved: boolean) => {
    if (p.digest === null) return;
    setBusy(true);
    setError(null);
    try {
      await send("PUT", `/api/connections/${encodeURIComponent(c.id)}/plugins/orbit`, { useCase, approved, digest: p.digest });
      onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const label: Record<PluginUseCase, string> = { chat: t("settings.connections.plugin.useChat"), employee: t("settings.connections.plugin.useEmployee") };
  return (
    <section className={s.form} aria-label={t("settings.connections.plugin.title")}>
      <Text weight="semibold" size={200}>
        {t("settings.connections.plugin.title")}
      </Text>
      {!p.installed || p.digest === null ? (
        <Text size={200} className={s.muted}>
          {t("settings.connections.plugin.notInstalled")}
        </Text>
      ) : (
        <>
          <Text size={200} className={s.muted}>
            {t("settings.connections.plugin.versionPrefix", { version: p.version ?? t("settings.connections.unknown") })} <span title={p.digest}>{p.digest.slice(0, 12)}</span>{t("settings.connections.plugin.versionSuffix")}
          </Text>
          {(["chat", "employee"] as const).map((u) => {
            const g = p.useCases[u];
            return (
              <div key={u} className={s.row}>
                <Switch label={label[u]} checked={g.approved && !g.needsConfirmation} disabled={busy} onChange={(_, d) => void grant(u, d.checked)} />
                {g.needsConfirmation && (
                  <Badge appearance="tint" color="warning">
                    {t("settings.connections.plugin.needsConfirmation")}
                  </Badge>
                )}
              </div>
            );
          })}
        </>
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
    </section>
  );
}

function Confirm({ title, text, action, onConfirm, onClose }: { title: string; text: string; action: string; onConfirm: () => void; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className="orbit-touch">
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{text}</DialogContent>
          <DialogActions>
            <Button onClick={onClose}>{t("settings.connections.cancel")}</Button>
            <Button appearance="primary" onClick={onConfirm}>
              {action}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

// An API key, typed once: sent to the server's credential store and never shown back, here or anywhere.
function ApiKeyField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <Field label={t("settings.connections.apiKey.label")} required hint={t("settings.connections.apiKey.hint")}>
      <Input type="password" value={value} autoComplete="off" spellCheck={false} onChange={(_, d) => onChange(d.value)} />
    </Field>
  );
}

function ConnectionCard({ c, autoSignIn, onAutoSignIn, onChanged }: { c: RuntimeConnection; autoSignIn: boolean; onAutoSignIn: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const when = useWhen();
  const s = useStyles();
  const [error, setError] = useState<{ text: string; stale: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"disconnect" | "delete" | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  // The terminal's way, for whoever prefers it: folded away where the card signs in by itself.
  const [terminal, setTerminal] = useState(false);
  const [key, setKey] = useState("");
  const path = `/api/connections/${encodeURIComponent(c.id)}`;
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (err) {
      setError({ text: isStale(err) ? t("settings.connections.stale") : errorText(err), stale: isStale(err) });
    } finally {
      setBusy(false);
    }
  };
  const replaceKey = () =>
    act(async () => {
      const apiKey = key.trim();
      setKey("");
      await send("PATCH", path, { apiKey }, ifMatch(c.version));
      setReconnecting(false);
    });
  const employees = c.employees === 1 ? t("settings.connections.employees.one") : t("settings.connections.employees.many", { count: c.employees });
  const identityText = c.identity ? t("settings.connections.signedInAs", { identity: c.identity }) : t("settings.connections.noIdentity");
  return (
    <li className={s.conn} aria-label={t("settings.connections.card.aria", { label: c.label })}>
      <div className={s.head}>
        <div className={s.row}>
          <Text weight="semibold">{c.label}</Text>
          {c.isDefault && (
            <Badge appearance="filled" color="brand" icon={<Star16Regular />}>
              {t("settings.connections.default")}
            </Badge>
          )}
          <Text size={200} className={s.muted}>
            {t(METHOD_KEYS[c.method])}
          </Text>
        </div>
        <Badge appearance="tint" color={AUTH_TONE[c.auth]}>
          {AUTH_STATE_TEXT[c.auth]}
        </Badge>
      </div>
      <Text size={200}>
        {t("settings.connections.card.meta", { identityText, when: when(c.checkedAt), employees })}
      </Text>
      {c.reason && (
        <Text size={200} className={s.muted}>
          {c.reason}
        </Text>
      )}
      <Uses c={c} />
      <Catalog c={c} />
      <Capabilities caps={c.capabilities} />
      {c.method === "subscription" && c.signInHere && (c.auth !== "connected" || reconnecting) && (
        <SignIn c={c} autoStart={autoSignIn || reconnecting} onStarted={onAutoSignIn} onChanged={onChanged} onClose={reconnecting ? () => setReconnecting(false) : null} />
      )}
      {c.method === "subscription" && c.terminalCommand && (c.auth !== "connected" || reconnecting) && !c.signInHere && <TerminalCommand command={c.terminalCommand} secondary={false} />}
      {c.method === "subscription" && c.terminalCommand && (c.auth !== "connected" || reconnecting) && c.signInHere && (
        <>
          <Link as="button" className={s.muted} onClick={() => setTerminal((v) => !v)} aria-expanded={terminal}>
            {terminal ? t("settings.connections.terminal.hide") : t("settings.connections.terminal.show")}
          </Link>
          {terminal && <TerminalCommand command={c.terminalCommand} secondary />}
        </>
      )}
      {c.method === "api_key" && reconnecting && (
        <form
          className={s.form}
          aria-label={t("settings.connections.replaceKey.aria", { label: c.label })}
          onSubmit={(e) => {
            e.preventDefault();
            void replaceKey();
          }}
        >
          <ApiKeyField value={key} onChange={setKey} />
          <div className={s.actions}>
            <Button type="submit" appearance="primary" disabled={busy || key.trim().length === 0}>
              {t("settings.connections.replaceKey.save")}
            </Button>
            <Button onClick={() => setReconnecting(false)}>{t("settings.connections.cancel")}</Button>
          </div>
        </form>
      )}
      {c.runtime === "claude" && <OrbitPlugin c={c} onChanged={onChanged} />}
      <div className={s.actions}>
        <Button className={s.action} size="small" icon={<ArrowSync16Regular />} disabled={busy} onClick={() => void act(() => send("POST", `${path}/check`))} title={t("settings.connections.recheck.title")}>
          {t("settings.connections.recheck")}
        </Button>
        {c.method !== "cloud" && (
          <Button className={s.action} size="small" icon={<Key16Regular />} disabled={busy} onClick={() => setReconnecting(true)} title={c.method === "subscription" ? (c.signInHere ? t("settings.connections.reconnect.titleSignInHere") : t("settings.connections.reconnect.titleTerminal")) : t("settings.connections.reconnect.titleApiKey")}>
            {t("settings.connections.reconnect")}
          </Button>
        )}
        {!c.isDefault && (
          <Button className={s.action} size="small" disabled={busy} onClick={() => void act(() => send("PATCH", path, { isDefault: true }, ifMatch(c.version)))} title={t("settings.connections.makeDefault.title", { label: RUNTIME_LABELS[c.runtime] })}>
            {t("settings.connections.makeDefault")}
          </Button>
        )}
        <Button className={s.action} size="small" icon={<PlugDisconnected16Regular />} disabled={busy || c.auth === "disconnected"} onClick={() => setConfirm("disconnect")} title={t("settings.connections.disconnect.title")}>
          {t("settings.connections.disconnect")}
        </Button>
        <Button className={s.action} size="small" appearance="subtle" icon={<Delete16Regular />} disabled={busy} onClick={() => setConfirm("delete")} title={t("settings.connections.delete.title")}>
          {t("settings.connections.delete")}
        </Button>
      </div>
      <Text size={200} className={s.muted}>
        {t("settings.connections.card.legend", { impact: c.employees > 0 ? t("settings.connections.card.impactActive", { count: c.employees }) : t("settings.connections.card.impactIdle") })}
      </Text>
      {error && (
        <MessageBar intent={error.stale ? "warning" : "error"}>
          <MessageBarBody>{error.text}</MessageBarBody>
          {error.stale && (
            <MessageBarActions>
              <Button size="small" onClick={onChanged}>
                {t("settings.connections.loadLatest")}
              </Button>
            </MessageBarActions>
          )}
        </MessageBar>
      )}
      {confirm === "disconnect" && (
        <Confirm
          title={t("settings.connections.confirm.disconnectTitle", { label: c.label })}
          text={t("settings.connections.confirm.disconnectText", { impact: c.employees > 0 ? t("settings.connections.confirm.disconnectImpact", { count: c.employees }) : "" })}
          action={t("settings.connections.disconnect")}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void act(() => send("POST", `${path}/disconnect`));
          }}
        />
      )}
      {confirm === "delete" && (
        <Confirm
          title={t("settings.connections.confirm.deleteTitle", { label: c.label })}
          text={t("settings.connections.confirm.deleteText")}
          action={t("settings.connections.delete")}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void act(() => send("DELETE", path));
          }}
        />
      )}
    </li>
  );
}

const PROVIDERS = [
  { value: "bedrock", labelKey: "settings.connections.provider.bedrock" },
  { value: "vertex", labelKey: "settings.connections.provider.vertex" },
  { value: "foundry", labelKey: "settings.connections.provider.foundry" },
] as const;

function AddConnection({ runtime, methods, onDone, onCancel }: { runtime: RuntimeKind; methods: MethodSupport[]; onDone: (made: RuntimeConnection) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const offered = methods.filter((m) => m.state === "supported");
  const [method, setMethod] = useState<AuthMethod | null>(offered[0]?.method ?? null);
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState<"bedrock" | "vertex" | "foundry">("bedrock");
  const [region, setRegion] = useState("");
  const [project, setProject] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    if (method === null) return;
    const body: CreateConnectionRequest = {
      runtime,
      method,
      ...(label.trim() ? { label: label.trim() } : {}),
      ...(method === "api_key" ? { apiKey: apiKey.trim() } : {}),
      ...(method === "cloud" ? { cloud: { provider, ...(region.trim() ? { region: region.trim() } : {}), ...(project.trim() ? { project: project.trim() } : {}) } } : {}),
    };
    setBusy(true);
    setError(null);
    // The key leaves the page's state as it is sent: it is never shown back.
    setApiKey("");
    try {
      onDone(await send<RuntimeConnection>("POST", "/api/connections", body));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={s.form}
      aria-label={t("settings.connections.add.aria", { label: RUNTIME_LABELS[runtime] })}
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <Field label={t("settings.connections.add.how")}>
        <RadioGroup value={method ?? ""} onChange={(_, d) => setMethod(d.value as AuthMethod)}>
          {methods.map((m) => (
            <Radio key={m.method} value={m.method} disabled={m.state !== "supported"} label={m.state === "supported" ? t(METHOD_KEYS[m.method]) : t("settings.connections.add.methodDisabled", { method: t(METHOD_KEYS[m.method]), support: t(SUPPORT_KEYS[m.state]) })} />
          ))}
        </RadioGroup>
      </Field>
      {offered.length === 0 && <Text size={200}>{t("settings.connections.add.noneOffered", { label: RUNTIME_LABELS[runtime] })}</Text>}
      <Field label={t("settings.connections.add.label")} hint={t("settings.connections.add.labelHint")}>
        <Input value={label} maxLength={60} onChange={(_, d) => setLabel(d.value)} />
      </Field>
      {method === "api_key" && <ApiKeyField value={apiKey} onChange={setApiKey} />}
      {method === "cloud" && (
        <>
          <Field label={t("settings.connections.add.cloudProvider")}>
            <Select value={provider} onChange={(_, d) => setProvider(d.value as typeof provider)}>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {t(p.labelKey)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("settings.connections.add.region")} hint={t("settings.connections.add.optional")}>
            <Input value={region} onChange={(_, d) => setRegion(d.value)} />
          </Field>
          <Field label={t("settings.connections.add.project")} hint={t("settings.connections.add.optional")}>
            <Input value={project} onChange={(_, d) => setProject(d.value)} />
          </Field>
        </>
      )}
      {method === "subscription" && <Text size={200}>{runtime === "codex" ? t("settings.connections.add.subscriptionCodex") : t("settings.connections.add.subscriptionOther")}</Text>}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.actions}>
        <Button type="submit" appearance="primary" disabled={busy || method === null || (method === "api_key" && apiKey.trim().length === 0)}>
          {t("settings.connections.add.submit")}
        </Button>
        <Button onClick={onCancel}>{t("settings.connections.cancel")}</Button>
      </div>
    </form>
  );
}

function RuntimeCard({ runtime, view, onChanged }: { runtime: RuntimeKind; view: AiConnectionsView; onChanged: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const [adding, setAdding] = useState(false);
  // The connection just added: its sign-in starts on its card once, by itself.
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const install = view.installations.find((i) => i.runtime === runtime);
  const methods = view.methods.filter((m) => m.runtime === runtime);
  const connections = view.connections.filter((c) => c.runtime === runtime);
  const installed = install?.state === "installed";
  return (
    <section className={s.card} aria-label={RUNTIME_LABELS[runtime]}>
      <div className={s.head}>
        <Text weight="semibold" size={400}>
          {RUNTIME_LABELS[runtime]}
        </Text>
        <Button size="small" icon={<Add16Regular />} disabled={!installed || adding} onClick={() => setAdding(true)}>
          {t("settings.connections.add.button")}
        </Button>
      </div>
      <Installation install={install} />
      {methods.length > 0 && (
        <ul className={s.list} aria-label={t("settings.connections.methods.aria", { label: RUNTIME_LABELS[runtime] })}>
          {methods.map((m) => (
            <MethodRow key={m.method} m={m} />
          ))}
        </ul>
      )}
      {adding && (
        <AddConnection
          runtime={runtime}
          methods={methods}
          onCancel={() => setAdding(false)}
          onDone={(made) => {
            setAdding(false);
            if (made.method === "subscription" && made.signInHere && made.auth !== "connected") setJustAdded(made.id);
            onChanged();
          }}
        />
      )}
      {connections.length === 0 ? (
        <Text size={200} className={s.muted}>
          {installed ? t("settings.connections.empty.installed") : t("settings.connections.empty.notInstalled")}
        </Text>
      ) : (
        <ul className={s.list} aria-label={t("settings.connections.list.aria", { label: RUNTIME_LABELS[runtime] })}>
          {connections.map((c) => (
            <ConnectionCard key={`${c.id}:${c.version}`} c={c} autoSignIn={justAdded === c.id} onAutoSignIn={() => setJustAdded(null)} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

// The account's connections, read again when the office says they changed and whenever the app stream reopens.
export function useConnections() {
  const { generation } = useAppStream();
  const [changed, setChanged] = useState(0);
  useAppEvent("office.changed", (e) => {
    if (e.data.areas.includes("connections")) setChanged((n) => n + 1);
  });
  return useResource<AiConnectionsView>(() => get("/api/connections"), [generation, changed]);
}

export function AiConnectionsSection() {
  const { t } = useI18n();
  const when = useWhen();
  const s = useStyles();
  const view = useConnections();
  const reload = () => void view.reload();
  return (
    <div className={`${s.root} orbit-touch`}>
      <Helper />
      {view.data === null ? (
        view.error ? (
          <MessageBar intent="error">
            <MessageBarBody>{view.error}</MessageBarBody>
          </MessageBar>
        ) : (
          <Spinner size="tiny" label={t("settings.connections.loading")} />
        )
      ) : (
        <>
          <Text size={200} className={s.muted}>
            {t("settings.connections.summary.asOf", {
              message: view.data.canHire ? t("settings.connections.summary.canHire") : t("settings.connections.summary.cannotHire"),
              when: when(view.data.asOf),
            })}
          </Text>
          {RUNTIME_KINDS.map((r) => (
            <RuntimeCard key={r} runtime={r} view={view.data as AiConnectionsView} onChanged={reload} />
          ))}
        </>
      )}
    </div>
  );
}
