// Orbit Web: the setup page until both accounts are connected, then the chat workspace; Settings at any time.
import { Button, FluentProvider, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Chat20Regular, Settings20Regular } from "@fluentui/react-icons";
import { DEFAULT_MODEL, type SetupStatus, type Settings } from "@orbit-web/contracts";
import { useEffect } from "react";
import { useHashRoute } from "./hooks/useHashRoute";
import { useResource } from "./hooks/useResource";
import { AccessPage } from "./pages/AccessPage";
import { ChatPage } from "./pages/ChatPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SetupPage } from "./pages/SetupPage";
import { get } from "./services/api";
import { isDark, themeOf, useSystemDark } from "./themes/theme";

const useStyles = makeStyles({
  shell: { display: "flex", flexDirection: "column", height: "100vh", backgroundColor: tokens.colorNeutralBackground1, color: tokens.colorNeutralForeground1 },
  header: { display: "flex", alignItems: "center", gap: "12px", padding: "8px 16px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  brand: { display: "flex", alignItems: "center", gap: "8px", flexGrow: 1 },
  logo: { width: "22px", height: "22px" },
  body: { flexGrow: 1, minHeight: 0, overflow: "auto" },
});

function Shell() {
  const s = useStyles();
  const [route, go] = useHashRoute();
  const setup = useResource<SetupStatus>(() => get("/api/setup/status"), [], 15_000);
  const settings = useResource<Settings>(() => get("/api/settings"), []);
  const ready = setup.data?.ready === true;

  if (setup.errorCode === "access_token_required" || settings.errorCode === "access_token_required") {
    return (
      <AccessPage
        onGranted={() => {
          void setup.reload();
          void settings.reload();
        }}
      />
    );
  }
  const body = () => {
    if (setup.data === null && setup.loading) return <Spinner label="Checking this Orbit Web…" />;
    if (route.page === "settings") return <SettingsPage status={setup.data} settings={settings.data} reloadStatus={() => void setup.reload()} onSettings={settings.set} />;
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
      </header>
      <div className={s.body}>{body()}</div>
    </div>
  );
}

export function App() {
  const systemDark = useSystemDark();
  const settings = useResource<Settings>(() => get("/api/settings"), []);
  const dark = isDark(settings.data?.theme ?? "system", systemDark);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  return (
    <FluentProvider theme={themeOf(dark)} style={{ height: "100%" }}>
      <Shell />
    </FluentProvider>
  );
}
