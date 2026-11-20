// Orbit Web: the sign-in page until a Claude account is signed in -- the Claude sign-in IS Orbit Web's sign-in, and the
// API refuses everything else until then -- then the workspace, as in Claude Code: the sidebar (new session, search,
// the chats, the account) and beside it a new session or an open chat, the composer always at the bottom, with
// Settings over either. No connector is needed to start: a chat runs with a repository or without one. In token mode
// the access token is asked for before anything.
import { Button, FluentProvider, MessageBar, MessageBarActions, MessageBarBody, Spinner, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { Dismiss20Regular } from "@fluentui/react-icons";
import { CLAUDE_SIGN_IN_REQUIRED, type ClaudeStatus, type ConnectorName, type SessionSummary, type Settings } from "@orbit-web/contracts";
import { useCallback, useEffect, useState } from "react";
import { useSignOut } from "./features/auth/useSignOut";
import { ChatScreen } from "./features/chat/ChatScreen";
import { NewSession } from "./features/newSession/NewSession";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { useHashRoute } from "./hooks/useHashRoute";
import { useSessions, useSources } from "./hooks/useLive";
import { useResource, type Resource } from "./hooks/useResource";
import { Sidebar } from "./layout/Sidebar";
import { AccessPage } from "./pages/AccessPage";
import { SignInPage } from "./pages/SignInPage";
import { get } from "./services/api";
import { AppEventsProvider, useAppEvent } from "./services/events/AppEvents";
import { isDark, themeOf, useSystemDark } from "./themes/theme";

const useStyles = makeStyles({
  shell: { display: "flex", height: "100vh", backgroundColor: tokens.colorNeutralBackground1, color: tokens.colorNeutralForeground1 },
  side: { width: "272px", flexShrink: 0, height: "100%" },
  sideCollapsed: { width: "56px" },
  main: { flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
  view: { flexGrow: 1, minHeight: 0 },
  center: { padding: "48px" },
});

const ACCESS_TOKEN_REQUIRED = "access_token_required";

const COLLAPSED_KEY = "orbit-web.sidebar.collapsed";

// Whether the sidebar is folded, kept in this browser.
function useCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(COLLAPSED_KEY) === "1");
  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);
  return [collapsed, useCallback(() => setCollapsed((c) => !c), [])];
}

// Everything a person can reach once signed in. Mounted only then, so nothing here asks the API before the sign-in,
// and leaving it (signing out) closes every stream it opened.
function Workspace({ claude, settings, reloadClaude, onSignedOut }: { claude: ClaudeStatus; settings: Resource<Settings>; reloadClaude: () => void; onSignedOut: (s: ClaudeStatus) => void }) {
  const s = useStyles();
  const { route, open, openSettings, closeSettings } = useHashRoute();
  const sessions = useSessions();
  const sources = useSources();
  const signOut = useSignOut(onSignedOut);
  const [collapsed, toggle] = useCollapsed();
  // The connector a page sent the person to Settings to connect, opened there.
  const [connector, setConnector] = useState<ConnectorName | null>(null);
  const selected = route.view.view === "chat" ? route.view.sessionId : null;

  // The sign-in ended elsewhere (a terminal, an expiry): the API says so, and the sign-in is read again.
  const lost = [sessions.errorCode, sources.errorCode, settings.errorCode].includes(CLAUDE_SIGN_IN_REQUIRED);
  useEffect(() => {
    if (lost) reloadClaude();
  }, [lost, reloadClaude]);

  // The open chat was deleted (here or in another tab): back to a new session.
  const { remove } = sessions;
  const removed = useCallback(
    (id: string) => {
      remove(id);
      if (id === selected) open({ view: "new" });
    },
    [remove, selected, open],
  );
  useAppEvent("session.removed", (e) => removed(e.data.sessionId));

  const created = (session: SessionSummary) => {
    sessions.upsert(session);
    open({ view: "chat", sessionId: session.id });
  };
  const connect = (source: ConnectorName) => {
    setConnector(source);
    openSettings("connectors");
  };

  return (
    <div className={s.shell}>
      <div className={mergeClasses(s.side, collapsed && s.sideCollapsed)}>
        <Sidebar
          sessions={sessions.sessions}
          loading={sessions.loading}
          selected={selected}
          collapsed={collapsed}
          account={claude.account}
          signingOut={signOut.busy}
          onToggle={toggle}
          onNew={() => open({ view: "new" })}
          onOpen={(id) => open({ view: "chat", sessionId: id })}
          onCustomize={() => openSettings("skills")}
          onSettings={() => openSettings("account")}
          onSignOut={() => void signOut.signOut()}
          onRenamed={sessions.upsert}
          onDeleted={removed}
        />
      </div>
      <main className={s.main}>
        {signOut.error && route.settings === null && (
          <MessageBar intent="error">
            <MessageBarBody>{signOut.error}</MessageBarBody>
            <MessageBarActions containerAction={<Button appearance="transparent" aria-label="Dismiss" icon={<Dismiss20Regular />} onClick={signOut.clear} />} />
          </MessageBar>
        )}
        <div className={s.view}>
          {selected === null ? (
            <NewSession settings={settings.data} sources={sources.data} onCreated={created} onConnect={connect} />
          ) : (
            <ChatScreen key={selected} sessionId={selected} onUpdated={sessions.upsert} />
          )}
        </div>
      </main>
      {route.settings !== null && (
        <SettingsDialog
          section={route.settings}
          connector={connector}
          claude={claude}
          signOut={signOut}
          settings={settings.data}
          onSettings={settings.set}
          onSection={openSettings}
          onClose={() => {
            setConnector(null);
            closeSettings();
          }}
        />
      )}
    </div>
  );
}

// What opens: the access token (token mode), the Claude sign-in, or the workspace. Nothing else decides it.
function Gate({ claude, settings }: { claude: Resource<ClaudeStatus>; settings: Resource<Settings> }) {
  const s = useStyles();
  const { reload: reloadClaude } = claude;
  const reload = useCallback(() => void reloadClaude(), [reloadClaude]);
  if (claude.errorCode === ACCESS_TOKEN_REQUIRED) return <AccessPage onGranted={reload} />;
  if (claude.data === null) {
    if (claude.loading) return <Spinner className={s.center} label="Checking this Orbit Web…" />;
    return (
      <MessageBar intent="error" className={s.center}>
        <MessageBarBody>Orbit Web did not answer: {claude.error ?? "no reason given"}</MessageBarBody>
        <MessageBarActions>
          <Button onClick={reload}>Try again</Button>
        </MessageBarActions>
      </MessageBar>
    );
  }
  if (claude.data.state !== "connected") return <SignInPage status={claude.data} onChanged={reload} />;
  return (
    <AppEventsProvider>
      <Workspace claude={claude.data} settings={settings} reloadClaude={reload} onSignedOut={claude.set} />
    </AppEventsProvider>
  );
}

export function App() {
  const systemDark = useSystemDark();
  // The sign-in is read again every few seconds: a sign-out from a terminal closes the page here too.
  const claude = useResource<ClaudeStatus>(() => get("/api/claude/status"), [], 15_000);
  const signedIn = claude.data?.state === "connected";
  const settings = useResource<Settings>(signedIn ? () => get("/api/settings") : null, [signedIn]);
  const dark = isDark((signedIn ? settings.data?.theme : null) ?? "system", systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  return (
    <FluentProvider theme={themeOf(dark)} style={{ height: "100%" }}>
      <Gate claude={claude} settings={settings} />
    </FluentProvider>
  );
}
