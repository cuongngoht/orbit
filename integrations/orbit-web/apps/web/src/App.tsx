// Orbit Web: Orbit's own sign-in until THIS browser holds a session of an Orbit user -- a username and a password, never
// an AI provider's sign-in -- then the account's workspace: the sidebar (new session, search, the office, governance,
// the chats and research sessions, the person signed in) and beside it a new session, an open chat or research session,
// the office or the governance console, with Settings over any of them. Nothing needs an AI connection to open: a chat,
// a research question or an employee's work that needs one says where to connect it (Settings → AI Connections). In
// token mode the access token is asked for before anything -- but for a share link (`#/share/<token>`), which opens its
// one read-only chat and asks the API for nothing else.
import { Button, FluentProvider, MessageBar, MessageBarActions, MessageBarBody, OverlayDrawer, Spinner, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { Dismiss20Regular } from "@fluentui/react-icons";
import { PASSWORD_CHANGE_REQUIRED, SIGN_IN_REQUIRED, type AuthStatus, type ConnectorName, type SessionSummary, type Settings } from "@orbit-web/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { TrialBar } from "./features/auth/TrialBar";
import { useSignOut, type SignOut } from "./features/auth/useSignOut";
import { ChatScreen } from "./features/chat/ChatScreen";
import { GovernanceView } from "./features/governance/GovernanceView";
import { NewSession } from "./features/newSession/NewSession";
import { OfficeView } from "./features/office/OfficeView";
import { useExecutiveState } from "./features/executive/api";
import { CeoChatView } from "./features/executive/CeoChatView";
import { ResearchPage } from "./features/research/ResearchPage";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { useHashRoute, type GovernancePage, type OfficePage } from "./hooks/useHashRoute";
import { useResearchSessions, useSessions, useSources } from "./hooks/useLive";
import { useResource, type Resource } from "./hooks/useResource";
import { useViewport, useVisualViewport } from "./hooks/useViewport";
import { Sidebar } from "./layout/Sidebar";
import { AccessPage } from "./pages/AccessPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { SharedChatPage, sharedTokenOf } from "./pages/SharedChatPage";
import { SignInPage } from "./pages/SignInPage";
import { rememberSession } from "./services/account";
import { get } from "./services/api";
import { AppEventsProvider, useAppEvent } from "./services/events/AppEvents";
import { ModelCatalogProvider } from "./services/models/ModelCatalog";
import { I18nProvider, useI18n } from "./i18n";
import { isDark, themeOf, useSystemDark } from "./themes/theme";

const useStyles = makeStyles({
  shell: {
    display: "flex",
    width: "100%",
    maxWidth: "100%",
    height: "var(--orbit-app-height, 100dvh)",
    overflow: "hidden",
    paddingLeft: "env(safe-area-inset-left)",
    paddingRight: "env(safe-area-inset-right)",
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
  },
  shellTouch: {
    position: "fixed",
    top: "var(--orbit-app-top, 0px)",
    left: 0,
    right: 0,
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
  main: { flexGrow: 1, minWidth: 0, maxWidth: "100%", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" },
  view: { flexGrow: 1, minWidth: 0, maxWidth: "100%", minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" },
  center: {
    minHeight: "100dvh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: "24px",
    paddingRight: "16px",
    paddingBottom: "24px",
    paddingLeft: "16px",
    gap: "12px",
  },
  centerCard: { maxWidth: "460px", width: "100%" },
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

interface WorkspaceProps {
  auth: AuthStatus & { user: NonNullable<AuthStatus["user"]> };
  settings: Resource<Settings>;
  // The sign-in as the API answered a change of it (a new password, a profile).
  onAuth: (s: AuthStatus) => void;
  reloadAuth: () => void;
  signOut: SignOut;
}

// Everything a person can reach once signed in. Mounted only then, so nothing here asks the API before the sign-in,
// and leaving it (signing out) closes every stream it opened.
function Workspace({ auth, settings, onAuth, reloadAuth, signOut }: WorkspaceProps) {
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile, isCompact, isCoarse } = useViewport();
  const touch = isMobile || isCoarse;
  useVisualViewport(touch);
  useEffect(() => {
    document.documentElement.dataset.orbitShell = "fixed";
    return () => {
      delete document.documentElement.dataset.orbitShell;
    };
  }, []);
  const { route, open, replace, openSettings, closeSettings } = useHashRoute();
  // What CEO Chat is for this account: whether it has a company decides the navigation (and the `#/ceo` route).
  const executiveState = useExecutiveState();
  const companyName = executiveState.data === null ? undefined : (executiveState.data.company?.name ?? null);
  const company = useMemo(() => (companyName === undefined ? undefined : companyName === null ? null : { name: companyName }), [companyName]);
  const sessions = useSessions();
  const researchSessions = useResearchSessions();
  const sources = useSources();
  const [collapsed, toggle] = useCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The connector a page sent the person to Settings to connect, opened there.
  const [connector, setConnector] = useState<ConnectorName | null>(null);
  const selected = route.view.view === "chat" || route.view.view === "research" ? route.view.sessionId : null;
  const governance = route.view.view === "governance" ? route.view : null;
  const office = route.view.view === "office" ? route.view : null;
  const ceo = route.view.view === "ceo" ? route.view : null;
  // CEO Chat is a company's: with no company, its route is not a place to be.
  useEffect(() => {
    if (ceo !== null && company === null) replace({ view: "new" });
  }, [ceo, company, replace]);
  const goGovernance = useCallback((page: GovernancePage, item: string | null = null) => open({ view: "governance", page, item }), [open]);
  const goOffice = useCallback((page: OfficePage, item: string | null = null, tab: string | null = null) => open({ view: "office", page, item, tab }), [open]);

  // The session ended elsewhere (a sign-out everywhere, an expiry), or its password must change first: the API says so,
  // and the sign-in is read again.
  const lost = [sessions.errorCode, sources.errorCode, settings.errorCode].some((c) => c === SIGN_IN_REQUIRED || c === PASSWORD_CHANGE_REQUIRED);
  useEffect(() => {
    if (lost) reloadAuth();
  }, [lost, reloadAuth]);

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
  const closeDrawer = (then: () => void) => () => {
    setDrawerOpen(false);
    then();
  };

  const sidebarProps = {
    sessions: sessions.sessions,
    research: researchSessions.sessions,
    loading: sessions.loading,
    selected,
    user: auth.user,
    account: auth.account,
    signingOut: signOut.busy,
    onNew: closeDrawer(() => open({ view: "new" })),
    onOpen: (id: string) => {
      setDrawerOpen(false);
      open({ view: researchSessions.sessions.some((r) => r.id === id) ? "research" : "chat", sessionId: id });
    },
    onCustomize: closeDrawer(() => openSettings("skills")),
    onSettings: closeDrawer(() => openSettings("account")),
    office: office !== null,
    onOffice: closeDrawer(() => goOffice("overview")),
    governance: governance !== null,
    onGovernance: closeDrawer(() => goGovernance("overview")),
    company,
    ceo: ceo !== null,
    onCeo: closeDrawer(() => open({ view: "ceo", conversationId: null })),
    onResources: closeDrawer(() => openSettings("compute")),
    onSignOut: closeDrawer(() => void signOut.signOut()),
    onRenamed: sessions.upsert,
    onDeleted: removed,
    onResearchRenamed: researchSessions.upsert,
    onResearchDeleted: removedResearch,
  };
  const onOpenNav = isCompact ? () => setDrawerOpen(true) : undefined;

  return (
    <div className={mergeClasses(s.shell, touch && s.shellTouch)}>
      {!isCompact ? (
        <div className={mergeClasses(s.side, collapsed && s.sideCollapsed)}>
          <Sidebar {...sidebarProps} collapsed={collapsed} onToggle={toggle} />
        </div>
      ) : (
        route.settings === null && (
          <OverlayDrawer open={drawerOpen} onOpenChange={(_, d) => setDrawerOpen(d.open)} position="start" className={s.drawer}>
            <Sidebar {...sidebarProps} collapsed={false} isDrawer onToggle={() => setDrawerOpen(false)} />
          </OverlayDrawer>
        )
      )}
      <main className={s.main}>
        <TrialBar trial={auth.trial} onChangePassword={() => openSettings("account")} />
        {signOut.error && route.settings === null && (
          <MessageBar intent="error">
            <MessageBarBody>{signOut.error}</MessageBarBody>
            <MessageBarActions containerAction={<Button appearance="transparent" aria-label={t("common.app.dismiss")} icon={<Dismiss20Regular />} onClick={signOut.clear} />} />
          </MessageBar>
        )}
        <div className={s.view}>
          {ceo !== null ? (
            company === null ? null : <CeoChatView state={executiveState} conversationId={ceo.conversationId} go={(conversationId) => open({ view: "ceo", conversationId })} onOpenNav={onOpenNav} />
          ) : office !== null ? (
            <OfficeView page={office.page} item={office.item} tab={office.tab} go={goOffice} account={auth.account} onOpenNav={onOpenNav} />
          ) : governance !== null ? (
            <GovernanceView
              page={governance.page}
              item={governance.item}
              go={goGovernance}
              account={{ displayName: auth.account?.companyName || auth.account?.displayName || auth.user.fullName, email: auth.user.email ?? `@${auth.user.username}` }}
              onOpenNav={onOpenNav}
            />
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
              onOpenNav={onOpenNav}
              userName={auth.user.fullName}
              onOpenAccount={isCompact ? () => openSettings("account") : undefined}
            />
          ) : route.view.view === "research" ? (
            <ResearchPage key={selected} sessionId={selected} onUpdated={researchSessions.upsert} onOpenNav={onOpenNav} />
          ) : (
            <ChatScreen key={selected} sessionId={selected} onUpdated={sessions.upsert} onOpenNav={onOpenNav} />
          )}
        </div>
      </main>
      {route.settings !== null && (
        <SettingsDialog
          section={route.settings}
          connector={connector}
          auth={auth}
          onAuth={onAuth}
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

// What opens: the access token (token mode), Orbit's sign-in (or the first administrator's setup), a new password the
// user must choose first, or the workspace. Nothing else decides it, and none of it starts an AI provider's sign-in.
function Gate({ auth, settings }: { auth: Resource<AuthStatus>; settings: Resource<Settings> }) {
  const { t } = useI18n();
  const s = useStyles();
  const { reload: reloadAuth, set: setAuth } = auth;
  const reload = useCallback(() => void reloadAuth(), [reloadAuth]);
  const signOut = useSignOut(reload);
  if (auth.errorCode === ACCESS_TOKEN_REQUIRED) return <AccessPage onGranted={reload} />;
  if (auth.data === null) {
    if (auth.loading)
      return (
        <div className={s.center}>
          <Spinner label={t("common.app.checking")} />
        </div>
      );
    return (
      <div className={s.center}>
        <MessageBar intent="error" className={s.centerCard}>
          <MessageBarBody>{t("common.app.noAnswer", { reason: auth.error ?? t("common.app.noReason") })}</MessageBarBody>
          <MessageBarActions>
            <Button onClick={reload}>{t("common.app.tryAgain")}</Button>
          </MessageBarActions>
        </MessageBar>
      </div>
    );
  }
  const status = auth.data;
  rememberSession(status.session);
  const user = status.user;
  if (status.state !== "signed_in" || status.session === null || user === null) return <SignInPage status={status} onStatus={setAuth} onReload={reload} />;
  if (user.mustChangePassword) return <ChangePasswordPage status={status} onChanged={setAuth} signOut={signOut} />;
  // Keyed by the account and the user: another user signing in here starts everything afresh -- no stream, cache or
  // page state of the one before survives into the next one's.
  return (
    <AppEventsProvider key={`${status.session.orbitId}:${user.id}`}>
      <ModelCatalogProvider>
        <Workspace auth={{ ...status, user }} settings={settings} onAuth={setAuth} reloadAuth={reload} signOut={signOut} />
      </ModelCatalogProvider>
    </AppEventsProvider>
  );
}

export function App() {
  const [shared, setShared] = useState(() => sharedTokenOf(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setShared(sharedTokenOf(window.location.hash));
    };
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
    };
  }, []);
  return shared === null ? <OrbitWeb /> : <Shared token={shared} />;
}

// A share link: the one chat it shows, in the reader's own light or dark.
function Shared({ token }: { token: string }) {
  const dark = isDark("system", useSystemDark());
  return (
    <I18nProvider locale="en">
      <FluentProvider theme={themeOf(dark)} style={{ minHeight: "100%" }}>
        <SharedChatPage token={token} />
      </FluentProvider>
    </I18nProvider>
  );
}

function OrbitWeb() {
  const systemDark = useSystemDark();
  // The sign-in is read again every few seconds: a sign-out everywhere (or an expiry) closes the page here too.
  const auth = useResource<AuthStatus>(() => get("/api/auth/status"), [], 15_000);
  const signedIn = auth.data?.state === "signed_in" && auth.data.user?.mustChangePassword === false;
  const settings = useResource<Settings>(signedIn ? () => get("/api/settings") : null, [signedIn]);
  const dark = isDark((signedIn ? settings.data?.theme : null) ?? "system", systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  useEffect(() => {
    if (signedIn) return;
    const clearHidden = () => document.getElementById("root")?.removeAttribute("aria-hidden");
    clearHidden();
    const id = window.requestAnimationFrame(clearHidden);
    return () => {
      window.cancelAnimationFrame(id);
    };
  }, [signedIn]);
  return (
    <I18nProvider locale={auth.data?.account?.locale ?? "en"}>
      <FluentProvider theme={themeOf(dark)} style={{ height: "100%" }}>
        <Gate auth={auth} settings={settings} />
      </FluentProvider>
    </I18nProvider>
  );
}
