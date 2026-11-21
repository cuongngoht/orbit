// Orbit Web: the sign-in page until THIS browser finished a sign-in with a Claude account -- the Claude sign-in IS Orbit
// Web's sign-in, a browser's own, and the API refuses everything else until then -- then the account's workspace, as in Claude Code: the sidebar (new session, search,
// the chats and research sessions, the account) and beside it a new session, an open chat or an open research session,
// with Settings over any of them. No connector is needed to start: a chat runs with a repository or without one. In token mode
// the access token is asked for before anything -- but for a share link (`#/share/<token>`), which opens its one
// read-only chat and asks the API for nothing else.
import { Button, FluentProvider, MessageBar, MessageBarActions, MessageBarBody, OverlayDrawer, Spinner, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { Dismiss20Regular } from "@fluentui/react-icons";
import { CLAUDE_SIGN_IN_REQUIRED, type ClaudeStatus, type ConnectorName, type SessionSummary, type Settings } from "@orbit-web/contracts";
import { useCallback, useEffect, useState } from "react";
import { useSignOut } from "./features/auth/useSignOut";
import { ChatScreen } from "./features/chat/ChatScreen";
import { GovernanceView } from "./features/governance/GovernanceView";
import { NewSession } from "./features/newSession/NewSession";
import { ResearchPage } from "./features/research/ResearchPage";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { useHashRoute, type GovernancePage } from "./hooks/useHashRoute";
import { useResearchSessions, useSessions, useSources } from "./hooks/useLive";
import { useResource, type Resource } from "./hooks/useResource";
import { useViewport } from "./hooks/useViewport";
import { Sidebar } from "./layout/Sidebar";
import { AccessPage } from "./pages/AccessPage";
import { SharedChatPage, sharedTokenOf } from "./pages/SharedChatPage";
import { SignInPage } from "./pages/SignInPage";
import { rememberSession } from "./services/account";
import { get } from "./services/api";
import { AppEventsProvider, useAppEvent } from "./services/events/AppEvents";
import { ModelCatalogProvider } from "./services/models/ModelCatalog";
import { isDark, themeOf, useSystemDark } from "./themes/theme";

const useStyles = makeStyles({
  shell: {
    display: "flex",
    height: "100dvh",
    overflow: "hidden",
    paddingLeft: "env(safe-area-inset-left)",
    paddingRight: "env(safe-area-inset-right)",
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
  },
  side: { width: "272px", flexShrink: 0, height: "100%" },
  sideCollapsed: { width: "56px" },
  drawer: {
    width: "min(312px, 85vw)",
    maxWidth: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    overflow: "hidden",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  main: { flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
  view: { flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" },
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
  const { isCompact } = useViewport();
  const { route, open, openSettings, closeSettings } = useHashRoute();
  const sessions = useSessions();
  const researchSessions = useResearchSessions();
  const sources = useSources();
  const signOut = useSignOut(onSignedOut);
  const [collapsed, toggle] = useCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The connector a page sent the person to Settings to connect, opened there.
  const [connector, setConnector] = useState<ConnectorName | null>(null);
  const selected = route.view.view === "chat" || route.view.view === "research" ? route.view.sessionId : null;
  const governance = route.view.view === "governance" ? route.view : null;
  const goGovernance = useCallback((page: GovernancePage, item: string | null = null) => open({ view: "governance", page, item }), [open]);

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
  const { remove: removeResearch } = researchSessions;
  const removedResearch = useCallback(
    (id: string) => {
      removeResearch(id);
      if (id === selected) open({ view: "new" });
    },
    [removeResearch, selected, open],
  );
  useAppEvent("research.session.removed", (e) => removedResearch(e.data.sessionId));

  const created = (session: SessionSummary) => {
    sessions.upsert(session);
    open({ view: "chat", sessionId: session.id });
  };
  const connect = (source: ConnectorName) => {
    setConnector(source);
    openSettings("connectors");
  };

  const sidebarProps = {
    sessions: sessions.sessions,
    research: researchSessions.sessions,
    loading: sessions.loading,
    selected,
    account: claude.account,
    signingOut: signOut.busy,
    onNew: () => {
      setDrawerOpen(false);
      open({ view: "new" });
    },
    onOpen: (id: string) => {
      setDrawerOpen(false);
      open({ view: researchSessions.sessions.some((r) => r.id === id) ? "research" : "chat", sessionId: id });
    },
    onCustomize: () => {
      setDrawerOpen(false);
      openSettings("skills");
    },
    onSettings: () => {
      setDrawerOpen(false);
      openSettings("account");
    },
    governance: governance !== null,
    onGovernance: () => {
      setDrawerOpen(false);
      goGovernance("overview");
    },
    onSignOut: () => {
      setDrawerOpen(false);
      void signOut.signOut();
    },
    onRenamed: sessions.upsert,
    onDeleted: removed,
    onResearchRenamed: researchSessions.upsert,
    onResearchDeleted: removedResearch,
  };

  return (
    <div className={s.shell}>
      {!isCompact ? (
        <div className={mergeClasses(s.side, collapsed && s.sideCollapsed)}>
          <Sidebar {...sidebarProps} collapsed={collapsed} onToggle={toggle} />
        </div>
      ) : (
        <OverlayDrawer open={drawerOpen} onOpenChange={(_, d) => setDrawerOpen(d.open)} position="start" className={s.drawer}>
          <Sidebar {...sidebarProps} collapsed={false} isDrawer onToggle={() => setDrawerOpen(false)} />
        </OverlayDrawer>
      )}
      <main className={s.main}>
        {signOut.error && route.settings === null && (
          <MessageBar intent="error">
            <MessageBarBody>{signOut.error}</MessageBarBody>
            <MessageBarActions containerAction={<Button appearance="transparent" aria-label="Dismiss" icon={<Dismiss20Regular />} onClick={signOut.clear} />} />
          </MessageBar>
        )}
        <div className={s.view}>
          {governance !== null ? (
            <GovernanceView page={governance.page} item={governance.item} go={goGovernance} account={claude.session && { displayName: claude.session.displayName, email: claude.session.email }} onOpenNav={isCompact ? () => setDrawerOpen(true) : undefined} />
          ) : selected === null ? (
            <NewSession
              settings={settings.data}
              sources={sources.data}
              onCreated={created}
              onResearchCreated={(session) => {
                researchSessions.upsert(session);
                open({ view: "research", sessionId: session.id });
              }}
              onConnect={connect}
              onOpenNav={isCompact ? () => setDrawerOpen(true) : undefined}
              account={claude.account}
              onOpenAccount={isCompact ? () => openSettings("account") : undefined}
            />
          ) : route.view.view === "research" ? (
            <ResearchPage key={selected} sessionId={selected} onUpdated={researchSessions.upsert} onOpenNav={isCompact ? () => setDrawerOpen(true) : undefined} />
          ) : (
            <ChatScreen key={selected} sessionId={selected} onUpdated={sessions.upsert} onOpenNav={isCompact ? () => setDrawerOpen(true) : undefined} />
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
  rememberSession(claude.data.session);
  if (claude.data.state !== "connected" || claude.data.session === null) return <SignInPage status={claude.data} onChanged={reload} />;
  // Keyed by the account: another account signing in here starts everything afresh -- no stream, cache or page state of
  // the account before survives into the next one's.
  return (
    <AppEventsProvider key={claude.data.session.accountId}>
      <ModelCatalogProvider>
        <Workspace claude={claude.data} settings={settings} reloadClaude={reload} onSignedOut={claude.set} />
      </ModelCatalogProvider>
    </AppEventsProvider>
  );
}

export function App() {
  const shared = sharedTokenOf(window.location.hash);
  return shared === null ? <OrbitWeb /> : <Shared token={shared} />;
}

// A share link: the one chat it shows, in the reader's own light or dark.
function Shared({ token }: { token: string }) {
  const dark = isDark("system", useSystemDark());
  return (
    <FluentProvider theme={themeOf(dark)} style={{ minHeight: "100%" }}>
      <SharedChatPage token={token} />
    </FluentProvider>
  );
}

function OrbitWeb() {
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
