// SETTINGS → AI CONNECTIONS: the three AI CLIs an Orbit account can connect -- Claude Code, OpenAI Codex, Google
// Antigravity -- each as a card: whether the CLI is on this server, the ways of signing in it offers (with what each rests
// on), and the account's connections to it. Every status is the CLI's own word, read at the time shown: Connected only
// when its own status command names an identity. A subscription is signed in by the provider's own CLI: from its card
// (ADR 0068: the CLI's sign-in runs on the server, this browser opens the link it printed -- and, for Claude Code, pastes
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

const METHOD_TEXT: Record<AuthMethod, string> = { subscription: "Subscription sign-in", api_key: "API key", cloud: "Cloud provider" };

const SUPPORT_TEXT: Record<MethodSupportState, string> = { supported: "Available", not_verified: "Not verified", not_permitted: "Not permitted", blocked: "Blocked" };

const AUTH_TONE: Record<AuthState, "success" | "subtle" | "warning" | "danger"> = { connected: "success", disconnected: "subtle", auth_required: "warning", error: "danger" };

const CAPABILITY_TEXT: Record<keyof RuntimeCapabilities, string> = {
  start: "Start a run",
  stream: "Stream its output",
  cancel: "Cancel a run",
  resume: "Resume a run",
  usage: "Report usage",
  webSearch: "Web search",
  toolPlaneSplit: "Run without local tools (employees)",
  pluginObservation: "Say which plugins loaded",
};

const CAP_WORD: Record<Capability, string> = { yes: "Yes", no: "No", unknown: "Unknown" };

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : "never");

// What each of the four things a person may confuse is, in one line each.
function Helper() {
  const s = useStyles();
  const items: [string, string][] = [
    ["Signing in to Orbit", "Your username and password (Settings → Account). It never signs in to an AI provider."],
    ["Connecting a provider", "A connection below: the provider's CLI signed in by its own sign-in (from its card here, or a terminal of the server), or your API key. Its login stays in the connection's own folder on the server."],
    ["Enabling a plugin", "Whether Claude Code loads the Orbit plugin, for chats or for employees, for exactly the version you approve."],
    ["Granting connectors", "Which claude.ai connectors Claude may use in chats and research (Settings → Claude connectors)."],
  ];
  return (
    <div className={s.helper} aria-label="What is what">
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
  const s = useStyles();
  if (install === undefined) return <Text className={s.muted}>Not checked on this server yet.</Text>;
  if (install.state === "installed")
    return (
      <Text size={200}>
        <Badge appearance="tint" color="success">
          Installed
        </Badge>{" "}
        version {install.version ?? "unknown"} · checked {when(install.checkedAt)}
      </Text>
    );
  return (
    <Text size={200}>
      <Badge appearance="tint" color={install.state === "not_installed" ? "subtle" : "danger"}>
        {install.state === "not_installed" ? "Not installed" : "Could not be checked"}
      </Badge>{" "}
      {install.detail ?? "No reason given."} · checked {when(install.checkedAt)}
    </Text>
  );
}

function MethodRow({ m }: { m: MethodSupport }) {
  const s = useStyles();
  return (
    <li className={mergeClasses(s.method, m.state !== "supported" && s.methodOff)} aria-label={`${METHOD_TEXT[m.method]}: ${SUPPORT_TEXT[m.state]}`}>
      <div className={s.row}>
        <Text weight="semibold" size={200}>
          {METHOD_TEXT[m.method]}
        </Text>
        <Badge appearance="outline" color={m.state === "supported" ? "success" : m.state === "not_verified" ? "warning" : "danger"}>
          {SUPPORT_TEXT[m.state]}
        </Badge>
      </div>
      <Text size={200} className={s.muted}>
        {m.note}
        {m.source && (
          <>
            {" "}
            <Link href={m.source} target="_blank" rel="noopener noreferrer">
              Source
            </Link>
          </>
        )}
      </Text>
    </li>
  );
}

// SIGNING A SUBSCRIPTION IN FROM ITS CARD (ADR 0068): the connection's CLI runs its own sign-in on the server, and only
// the browser that started it is shown the link it printed -- with Codex's one-time code to enter there -- and, for
// Claude Code, sends back the code its page shows. Connected only once the CLI's own status names who it is.
function SignIn({ c, autoStart, onStarted, onChanged, onClose }: { c: RuntimeConnection; autoStart: boolean; onStarted: () => void; onChanged: () => void; onClose: (() => void) | null }) {
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
    <section className={s.form} aria-label={`Sign in ${c.label}`}>
      {view !== null && !view.mine && active ? (
        <>
          <Text size={200}>{view.startedBy ?? "Somebody"} is signing this connection in right now, from another browser. It turns Connected here when they finish.</Text>
          <div className={s.actions}>
            <Button size="small" disabled={busy} onClick={() => void cancel()}>
              Cancel that sign-in
            </Button>
          </div>
        </>
      ) : active && flow !== null ? (
        <>
          {flow.state === "starting" && <Spinner size="tiny" label={`Starting ${label}'s own sign-in on the server…`} />}
          {flow.state === "awaiting_user" && flow.url && (
            <>
              <Text size={200} weight="semibold">
                1. Open the sign-in page and sign in with the account this connection is for
              </Text>
              <div className={s.command}>
                <Link href={flow.url} target="_blank" rel="noopener noreferrer" className={s.code} aria-label="Sign-in link">
                  {flow.url}
                </Link>
                <Button size="small" appearance="primary" icon={<Open16Regular />} as="a" href={flow.url} target="_blank" rel="noopener noreferrer">
                  Open
                </Button>
                <Button size="small" icon={<Copy16Regular />} onClick={() => void copy("url", flow.url as string)}>
                  {copied === "url" ? "Copied" : "Copy"}
                </Button>
              </div>
              {flow.code && (
                <>
                  <Text size={200} weight="semibold">
                    2. Enter this one-time code there
                  </Text>
                  <div className={s.command}>
                    <code className={s.code} aria-label="One-time code">
                      {flow.code}
                    </code>
                    <Button size="small" icon={<Copy16Regular />} onClick={() => void copy("code", flow.code as string)}>
                      {copied === "code" ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <Text size={200} className={s.muted}>
                    This card turns Connected by itself once you finish there.
                  </Text>
                </>
              )}
              {flow.needsCode && (
                <form
                  aria-label="Send the sign-in code"
                  className={s.actions}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  <Field label="2. Paste the code the sign-in page shows" style={{ flexGrow: 1, minWidth: 0 }}>
                    <Input value={code} autoComplete="off" spellCheck={false} onChange={(_, d) => setCode(d.value)} />
                  </Field>
                  <Button type="submit" appearance="primary" disabled={busy || code.trim().length < 4} style={{ alignSelf: "flex-end" }}>
                    Send code
                  </Button>
                </form>
              )}
            </>
          )}
          {flow.state === "verifying" && <Spinner size="tiny" label={flow.message ?? `Checking the sign-in with ${label}…`} />}
          {flow.message && flow.state === "awaiting_user" && (
            <Text size={200} className={s.muted}>
              {flow.message}
            </Text>
          )}
          <div className={s.actions}>
            <Button size="small" disabled={busy} onClick={() => void cancel()}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <>
          {ended && flow !== null && (
            <MessageBar intent={flow.state === "connected" ? "success" : "warning"}>
              <MessageBarBody>{flow.message ?? (flow.state === "cancelled" ? "Sign-in cancelled." : "The sign-in ended.")}</MessageBarBody>
            </MessageBar>
          )}
          <Text size={200}>
            {c.auth === "connected"
              ? `Sign in again with the same account (${c.identity ?? "the one it has"}): another account makes this connection Authentication required until it is disconnected.`
              : `Sign in with ${label}'s own sign-in: Orbit Web runs it on the server for this connection, and shows you its link${c.runtime === "codex" ? " and the one-time code to enter there" : ", then takes the code its page shows"}. The login stays in this connection's folder; nothing of it is kept anywhere else.`}
          </Text>
          <div className={s.actions}>
            <Button className={s.action} appearance="primary" icon={<Key16Regular />} disabled={busy} onClick={() => void start()}>
              {ended || c.auth === "connected" ? "Sign in again" : "Sign in"}
            </Button>
            {onClose && (
              <Button className={s.action} onClick={onClose}>
                Close
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
        {secondary
          ? "Or sign it in from a terminal of the server instead: run this command there and follow what it says (nothing of that sign-in passes through this page). Then press Re-check."
          : "A subscription is signed in by the provider's own CLI, in a terminal of the server: run this command there and follow what it says. The sign-in URL and code never pass through Orbit. This card turns Connected once the CLI's own status names who it is signed in as — then press Re-check."}
      </Text>
      <div className={s.command}>
        <code className={s.code} aria-label="Terminal command">
          {command}
        </code>
        <Button size="small" icon={<Copy16Regular />} onClick={() => void copy()}>
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
    </div>
  );
}

function Capabilities({ caps }: { caps: RuntimeCapabilities }) {
  const s = useStyles();
  return (
    <dl className={s.caps} aria-label="Runtime capabilities">
      {(Object.keys(CAPABILITY_TEXT) as (keyof RuntimeCapabilities)[]).map((k) => (
        <div key={k} className={s.cap}>
          <dt>
            <Text size={200}>{CAPABILITY_TEXT[k]}</Text>
          </dt>
          <dd style={{ margin: 0 }}>
            <Text size={200} weight="semibold">
              {CAP_WORD[caps[k]]}
            </Text>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Catalog({ c }: { c: RuntimeConnection }) {
  const s = useStyles();
  const cat = c.catalog;
  const source =
    cat.source === "account"
      ? `Models from your account, read ${when(cat.checkedAt)}.`
      : cat.source === "fallback"
        ? "A fallback list, not read from your account: chats may use it, employees never do."
        : "No model list was read yet: Re-check once it is connected.";
  return (
    <div>
      <Text size={200} className={s.muted}>
        {source}
      </Text>
      {cat.models.length > 0 && (
        <ul className={s.models} aria-label={`Models of ${c.label}`}>
          {cat.models.map((m) => (
            <li key={m.id}>
              <Text size={200}>
                <strong>{m.label}</strong> ({m.id}){cat.recommended === m.id ? " · recommended" : ""} — {m.efforts.length === 0 ? "no effort levels" : `effort ${m.efforts.map(effortLabel).join(", ")}`}
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
  const label: Record<PluginUseCase, string> = { chat: "Use the Orbit plugin in chats", employee: "Use the Orbit plugin for employees" };
  return (
    <section className={s.form} aria-label="Plugins → Orbit">
      <Text weight="semibold" size={200}>
        Plugins → Orbit
      </Text>
      {!p.installed || p.digest === null ? (
        <Text size={200} className={s.muted}>
          The Orbit plugin is not installed in this installation: nothing to enable.
        </Text>
      ) : (
        <>
          <Text size={200} className={s.muted}>
            Version {p.version ?? "unknown"} · digest <span title={p.digest}>{p.digest.slice(0, 12)}</span>. Off until you switch it on; its hooks never run for an employee.
          </Text>
          {(["chat", "employee"] as const).map((u) => {
            const g = p.useCases[u];
            return (
              <div key={u} className={s.row}>
                <Switch label={label[u]} checked={g.approved && !g.needsConfirmation} disabled={busy} onChange={(_, d) => void grant(u, d.checked)} />
                {g.needsConfirmation && (
                  <Badge appearance="tint" color="warning">
                    Needs your confirmation
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
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className="orbit-touch">
        <DialogBody>
          <DialogTitle>{title}</DialogTitle>
          <DialogContent>{text}</DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
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
  return (
    <Field label="API key" required hint="Sent once to this server's credential store. It is never shown back.">
      <Input type="password" value={value} autoComplete="off" spellCheck={false} onChange={(_, d) => onChange(d.value)} />
    </Field>
  );
}

function ConnectionCard({ c, autoSignIn, onAutoSignIn, onChanged }: { c: RuntimeConnection; autoSignIn: boolean; onAutoSignIn: () => void; onChanged: () => void }) {
  const s = useStyles();
  const [error, setError] = useState<{ text: string; stale: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"disconnect" | "delete" | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [key, setKey] = useState("");
  const path = `/api/connections/${encodeURIComponent(c.id)}`;
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      onChanged();
    } catch (err) {
      setError({ text: isStale(err) ? "This connection changed since the page read it: nothing was changed." : errorText(err), stale: isStale(err) });
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
  const employees = c.employees === 1 ? "1 employee runs" : `${c.employees} employees run`;
  return (
    <li className={s.conn} aria-label={`Connection ${c.label}`}>
      <div className={s.head}>
        <div className={s.row}>
          <Text weight="semibold">{c.label}</Text>
          {c.isDefault && (
            <Badge appearance="filled" color="brand" icon={<Star16Regular />}>
              Default
            </Badge>
          )}
          <Text size={200} className={s.muted}>
            {METHOD_TEXT[c.method]}
          </Text>
        </div>
        <Badge appearance="tint" color={AUTH_TONE[c.auth]}>
          {AUTH_STATE_TEXT[c.auth]}
        </Badge>
      </div>
      <Text size={200}>
        {c.identity ? `Signed in as ${c.identity}` : "No identity named"} · checked {when(c.checkedAt)} · {employees} on it
      </Text>
      {c.reason && (
        <Text size={200} className={s.muted}>
          {c.reason}
        </Text>
      )}
      <Catalog c={c} />
      <Capabilities caps={c.capabilities} />
      {c.method === "subscription" && c.signInHere && (c.auth !== "connected" || reconnecting) && (
        <SignIn c={c} autoStart={autoSignIn || reconnecting} onStarted={onAutoSignIn} onChanged={onChanged} onClose={reconnecting ? () => setReconnecting(false) : null} />
      )}
      {c.method === "subscription" && c.terminalCommand && (c.auth !== "connected" || reconnecting) && <TerminalCommand command={c.terminalCommand} secondary={c.signInHere} />}
      {c.method === "api_key" && reconnecting && (
        <form
          className={s.form}
          aria-label={`Replace the API key of ${c.label}`}
          onSubmit={(e) => {
            e.preventDefault();
            void replaceKey();
          }}
        >
          <ApiKeyField value={key} onChange={setKey} />
          <div className={s.actions}>
            <Button type="submit" appearance="primary" disabled={busy || key.trim().length === 0}>
              Save the new key
            </Button>
            <Button onClick={() => setReconnecting(false)}>Cancel</Button>
          </div>
        </form>
      )}
      {c.runtime === "claude" && <OrbitPlugin c={c} onChanged={onChanged} />}
      <div className={s.actions}>
        <Button className={s.action} size="small" icon={<ArrowSync16Regular />} disabled={busy} onClick={() => void act(() => send("POST", `${path}/check`))} title="Asks the CLI again for its status, its models and its capabilities.">
          Re-check
        </Button>
        {c.method !== "cloud" && (
          <Button className={s.action} size="small" icon={<Key16Regular />} disabled={busy} onClick={() => setReconnecting(true)} title={c.method === "subscription" ? (c.signInHere ? "Runs the CLI's own sign-in again, here: a link to open, and the code to send back." : "Shows the terminal command again: the same sign-in, run once more.") : "Replaces the API key."}>
            Reconnect
          </Button>
        )}
        {!c.isDefault && (
          <Button className={s.action} size="small" disabled={busy} onClick={() => void act(() => send("PATCH", path, { isDefault: true }, ifMatch(c.version)))} title={`Makes it the connection employees and chats use for ${RUNTIME_LABELS[c.runtime]} unless they name another.`}>
            Make default
          </Button>
        )}
        <Button className={s.action} size="small" icon={<PlugDisconnected16Regular />} disabled={busy || c.auth === "disconnected"} onClick={() => setConfirm("disconnect")} title="Signs the CLI out of this connection and removes its login.">
          Disconnect
        </Button>
        <Button className={s.action} size="small" appearance="subtle" icon={<Delete16Regular />} disabled={busy} onClick={() => setConfirm("delete")} title="Removes the connection itself.">
          Delete
        </Button>
      </div>
      <Text size={200} className={s.muted}>
        Re-check asks the CLI again. Reconnect runs the same sign-in once more. Disconnect signs the CLI out of this connection and removes its login: {c.employees > 0 ? `the ${c.employees} employee(s) on it take no new work, and their running work stops and is reconciled` : "nothing runs on it now"}. Delete removes the connection itself.
      </Text>
      {error && (
        <MessageBar intent={error.stale ? "warning" : "error"}>
          <MessageBarBody>{error.text}</MessageBarBody>
          {error.stale && (
            <MessageBarActions>
              <Button size="small" onClick={onChanged}>
                Load the latest
              </Button>
            </MessageBarActions>
          )}
        </MessageBar>
      )}
      {confirm === "disconnect" && (
        <Confirm
          title={`Disconnect ${c.label}?`}
          text={`The CLI's own sign-out runs for this connection, and its login is removed from the server. ${c.employees > 0 ? `${c.employees} employee(s) on it take no new work; their running work stops and is reconciled. ` : ""}Nothing switches to another provider by itself.`}
          action="Disconnect"
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            setConfirm(null);
            void act(() => send("POST", `${path}/disconnect`));
          }}
        />
      )}
      {confirm === "delete" && (
        <Confirm
          title={`Delete ${c.label}?`}
          text="The connection itself is removed, with its folder on the server. Employees that run on it must be moved to another connection first."
          action="Delete"
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
  { value: "bedrock", label: "Amazon Bedrock" },
  { value: "vertex", label: "Google Vertex AI" },
  { value: "foundry", label: "Microsoft Foundry" },
] as const;

function AddConnection({ runtime, methods, onDone, onCancel }: { runtime: RuntimeKind; methods: MethodSupport[]; onDone: (made: RuntimeConnection) => void; onCancel: () => void }) {
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
      aria-label={`Add a ${RUNTIME_LABELS[runtime]} connection`}
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
    >
      <Field label="How it signs in">
        <RadioGroup value={method ?? ""} onChange={(_, d) => setMethod(d.value as AuthMethod)}>
          {methods.map((m) => (
            <Radio key={m.method} value={m.method} disabled={m.state !== "supported"} label={`${METHOD_TEXT[m.method]}${m.state === "supported" ? "" : ` — ${SUPPORT_TEXT[m.state]}`}`} />
          ))}
        </RadioGroup>
      </Field>
      {offered.length === 0 && <Text size={200}>No way of signing in is offered for {RUNTIME_LABELS[runtime]} here yet: each row above says why.</Text>}
      <Field label="Label" hint="Optional: how you tell this connection from another of the same CLI.">
        <Input value={label} maxLength={60} onChange={(_, d) => setLabel(d.value)} />
      </Field>
      {method === "api_key" && <ApiKeyField value={apiKey} onChange={setApiKey} />}
      {method === "cloud" && (
        <>
          <Field label="Cloud provider">
            <Select value={provider} onChange={(_, d) => setProvider(d.value as typeof provider)}>
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Region" hint="Optional.">
            <Input value={region} onChange={(_, d) => setRegion(d.value)} />
          </Field>
          <Field label="Project" hint="Optional.">
            <Input value={project} onChange={(_, d) => setProject(d.value)} />
          </Field>
        </>
      )}
      {method === "subscription" && <Text size={200}>Adding it starts its sign-in right away, on its card: a link to open{runtime === "codex" ? " and a one-time code to enter there" : ", then the code its page shows to paste back"}. A terminal command does the same from the server.</Text>}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.actions}>
        <Button type="submit" appearance="primary" disabled={busy || method === null || (method === "api_key" && apiKey.trim().length === 0)}>
          Add connection
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function RuntimeCard({ runtime, view, onChanged }: { runtime: RuntimeKind; view: AiConnectionsView; onChanged: () => void }) {
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
          Add a connection
        </Button>
      </div>
      <Installation install={install} />
      {methods.length > 0 && (
        <ul className={s.list} aria-label={`Ways to sign in to ${RUNTIME_LABELS[runtime]}`}>
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
          {installed ? "No connection yet." : "No connection: the CLI is not installed on this server."}
        </Text>
      ) : (
        <ul className={s.list} aria-label={`${RUNTIME_LABELS[runtime]} connections`}>
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
          <Spinner size="tiny" label="Asking the CLIs on this server…" />
        )
      ) : (
        <>
          <Text size={200} className={s.muted}>
            {view.data.canHire ? "At least one connection is connected with its models read from the CLI: you can hire employees." : "To hire employees, connect at least one CLI and let it read its models."} Data as of {when(view.data.asOf)}.
          </Text>
          {RUNTIME_KINDS.map((r) => (
            <RuntimeCard key={r} runtime={r} view={view.data as AiConnectionsView} onChanged={reload} />
          ))}
        </>
      )}
    </div>
  );
}
