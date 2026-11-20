// Orbit Web: the sign-in page until a Claude account is signed in -- the Claude sign-in IS Orbit Web's sign-in, and the
// API refuses everything else until then -- then the setup page until GitHub is connected, then the chat workspace;
// Settings at any time once signed in. In token mode the access token is asked for before anything.
import { Button, FluentProvider, MessageBar, MessageBarActions, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Chat20Regular, Dismiss20Regular, Settings20Regular } from "@fluentui/react-icons";
import { CLAUDE_SIGN_IN_REQUIRED, DEFAULT_MODEL, type ClaudeStatus, type SetupStatus, type Settings } from "@orbit-web/contracts";
import { useCallback, useEffect } from "react";
import { AccountMenu } from "./features/auth/AccountMenu";
import { useSignOut } from "./features/auth/useSignOut";
import { useHashRoute } from "./hooks/useHashRoute";
import { useResource, type Resource } from "./hooks/useResource";
import { AccessPage } from "./pages/AccessPage";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";
import { SignInPage } from "./pages/SignInPage";
import { get } from "./services/api";
import { isDark, themeOf, useSystemDark } from "./themes/theme";

const useStyles = makeStyles({
  shell: { display: "flex", flexDirection: "column", height: "100vh", backgroundColor: tokens.colorNeutralBackground1, color: tokens.colorNeutralForeground1 },
  header: { display: "flex", alignItems: "center", gap: "12px", padding: "8px 16px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  brand: { display: "flex", alignItems: "center", gap: "8px", flexGrow: 1 },
  logo: { width: "22px", height: "22px" },
  body: { flexGrow: 1, minHeight: 0, overflow: "auto" },
  center: { padding: "48px" },
});

const ACCESS_TOKEN_REQUIRED = "access_token_required";

// Everything a person can reach once signed in. Mounted only then, so nothing here asks the API before the sign-in,
// and leaving it (signing out) closes every stream it opened.
function Workspace({ claude, settings, reloadClaude, onSignedOut }: { claude: ClaudeStatus; settings: Resource<Settings>; reloadClaude: () => void; onSignedOut: (s: ClaudeStatus) => void }) {
  const s = useStyles();
  const [route, go] = useHashRoute();
  const setup = useResource<SetupStatus>(() => get("/api/setup/status"), [], 15_000);
  const signOut = useSignOut(onSignedOut);
  const ready = setup.data?.ready === true;

  // The sign-in ended elsewhere (a terminal, an expiry): the API says so, and the sign-in is read again.
  const lost = setup.errorCode === CLAUDE_SIGN_IN_REQUIRED || settings.errorCode === CLAUDE_SIGN_IN_REQUIRED;
  useEffect(() => {
    if (lost) reloadClaude();
  }, [lost, reloadClaude]);

  const body = () => {
    if (setup.data === null && setup.loading) return <Spinner className={s.center} label="Checking this Orbit Web…" />;
    if (route.page === "settings") return <SettingsPage status={setup.data} claude={claude} signOut={signOut} settings={settings.data} reloadStatus={() => void setup.reload()} onSettings={settings.set} />;
    if (route.page === "setup" || !ready) return <SetupPage status={setup.data} reload={() => void setup.reload()} onContinue={() => go({ page: "chat", sessionId: null })} />;
    return <ChatPage sessionId={route.page === "chat" ? route.sessionId : null} defaultModel={settings.data?.defaultModel ?? DEFAULT_MODEL} onOpen={(id) => go({ page: "chat", sessionId: id })} />;
  };
  return (
    <div className={s.shell}>
      <header className={s.header}>
        <div className={s.brand}>
          <img src="/orbit.svg" alt="" className={s.logo} />
          <Text weight="semibold" size={400}>
            Orbit
          </Text>
          {setup.data && (
            <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
              Web {setup.data.versions.web} · Orbit {setup.data.versions.orbit ?? "?"}
            </Text>
          )}
        </div>
        {ready && route.page !== "chat" && (
          <Button appearance="subtle" icon={<Chat20Regular />} onClick={() => go({ page: "chat", sessionId: null })}>
            Chats
          </Button>
        )}
        <Button appearance={route.page === "settings" ? "primary" : "subtle"} icon={<Settings20Regular />} onClick={() => go({ page: "settings" })}>
          Settings
        </Button>
        <AccountMenu account={claude.account} busy={signOut.busy} onSignOut={() => void signOut.signOut()} />
      </header>
      {signOut.error && route.page !== "settings" && (
        <MessageBar intent="error">
          <MessageBarBody>{signOut.error}</MessageBarBody>
          <MessageBarActions containerAction={<Button appearance="transparent" aria-label="Dismiss" icon={<Dismiss20Regular />} onClick={signOut.clear} />} />
        </MessageBar>
      )}
      <div className={s.body}>{body()}</div>
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
  return <Workspace claude={claude.data} settings={settings} reloadClaude={reload} onSignedOut={claude.set} />;
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
