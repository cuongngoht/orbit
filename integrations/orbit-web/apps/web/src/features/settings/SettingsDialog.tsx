// SETTINGS, over whatever page is open: on the left a search and the sections -- Account, Appearance, Code, AI
// Connections, Compute & storage, Connectors, Claude connectors, Skills, Plugins, System -- and on the right the one chosen. Which one is open is the URL's (`?settings=<section>`), so
// a reload or a link comes back to it. The connectors' status is read here, and again whenever the app stream says a
// connector changed (or reopens, since it replays nothing).
import { Button, Dialog, DialogSurface, DialogTitle, SearchBox, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Apps20Regular, ArrowLeft20Regular, BookDatabase20Regular, BrainCircuit20Regular, ChevronRight16Regular, Code20Regular, DataUsage20Regular, Dismiss20Regular, Lightbulb20Regular, PaintBrush20Regular, Person20Regular, PlugConnected20Regular, PuzzlePiece20Regular, Server20Regular } from "@fluentui/react-icons";
import type { AuthStatus, AuthUser, ConnectorName, SetupStatus, Settings } from "@orbit-web/contracts";
import { useCallback, useState, type ReactElement } from "react";
import type { SettingsSection } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { useI18n, type MessageKey } from "../../i18n";
import { get } from "../../services/api";
import { useAppEvent, useAppStream } from "../../services/events/AppEvents";
import type { SignOut } from "../auth/useSignOut";
import { AiConnectionsSection } from "../connections/AiConnectionsSection";
import { ComputeStorageSection } from "../resources/ComputeStorageSection";
import { AccessLinkCard } from "./AccessLinkCard";
import { AccountSection } from "./AccountSection";
import { ClaudeConnectorsSection } from "./ClaudeConnectorsSection";
import { ConnectorsSection } from "./ConnectorsSection";
import { McpServersSection } from "./McpServersSection";
import { PluginsSection, SkillsSection } from "./CustomizeSections";
import { AppearanceSection, CodeSection } from "./PreferenceSections";
import { SystemCard } from "./SystemCard";

const useStyles = makeStyles({
  surface: { width: "min(1040px, 96vw)", maxWidth: "min(1040px, 96vw)", height: "min(760px, 92dvh)", borderRadius: "16px", backgroundColor: "var(--orbit-card-bg)", paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, display: "flex", overflow: "hidden" },
  surfaceMobile: {
    width: "100vw",
    maxWidth: "100vw",
    height: "var(--orbit-app-height, 100dvh)",
    maxHeight: "var(--orbit-app-height, 100dvh)",
    marginTop: 0,
    marginRight: 0,
    marginBottom: 0,
    marginLeft: 0,
    borderRadius: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  surfaceMobileIndex: {
    backgroundColor: tokens.colorNeutralBackground2,
  },
  nav: {
    width: "232px",
    "@media (max-width: 900px)": { width: "204px" },
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    paddingTop: "18px",
    paddingRight: "10px",
    paddingBottom: "18px",
    paddingLeft: "10px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  title: { paddingTop: 0, paddingRight: "8px", paddingBottom: "8px", paddingLeft: "8px" },
  search: { marginTop: 0, marginRight: "2px", marginBottom: "8px", marginLeft: "2px" },
  item: { justifyContent: "flex-start", fontWeight: tokens.fontWeightRegular, width: "100%", borderRadius: "10px", transitionProperty: "background-color", transitionDuration: "140ms" },
  itemSelected: { backgroundColor: tokens.colorSubtleBackgroundSelected, fontWeight: tokens.fontWeightSemibold },
  none: { padding: "8px", color: tokens.colorNeutralForeground3 },
  main: { flexGrow: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
  head: { display: "flex", alignItems: "flex-start", gap: "12px", paddingTop: "22px", paddingRight: "20px", paddingBottom: "6px", paddingLeft: "32px", "@media (max-width: 900px)": { paddingLeft: "20px", paddingRight: "16px" } },
  heading: { display: "flex", flexDirection: "column", gap: "4px", flexGrow: 1, minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  body: { flexGrow: 1, minHeight: 0, overflowY: "auto", paddingTop: "14px", paddingRight: "32px", paddingBottom: "32px", paddingLeft: "32px", "@media (max-width: 900px)": { paddingLeft: "20px", paddingRight: "20px", paddingBottom: "24px" } },
  mobileBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    minHeight: "56px",
    paddingTop: "max(8px, env(safe-area-inset-top))",
    paddingRight: "8px",
    paddingBottom: "8px",
    paddingLeft: "16px",
    backgroundColor: "var(--orbit-header-bg)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    flexShrink: 0,
  },
  mobileDetailBar: {
    paddingLeft: "8px",
  },
  mobileTitle: { marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0 },
  touchBtn: { minWidth: "44px", minHeight: "44px", flexShrink: 0 },
  backBtn: { minHeight: "44px", paddingLeft: "8px", paddingRight: "10px", flexShrink: 0 },
  mobileSearchWrap: {
    paddingTop: "12px",
    paddingRight: "16px",
    paddingBottom: "8px",
    paddingLeft: "16px",
    flexShrink: 0,
  },
  mobileIndexList: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
    paddingTop: "4px",
    paddingRight: "16px",
    paddingBottom: "max(24px, env(safe-area-inset-bottom))",
    paddingLeft: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "8px",
  },
  mobileRow: {
    width: "100%",
    minHeight: "56px",
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    borderRadius: "14px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "var(--orbit-soft-shadow)",
    color: tokens.colorNeutralForeground1,
    display: "flex",
    alignItems: "center",
    gap: "12px",
    textAlign: "left",
    cursor: "pointer",
    transitionProperty: "background-color, border-color",
    transitionDuration: "140ms",
  },
  mobileRowSelected: {
    ...shorthands.borderColor(tokens.colorBrandStroke1),
    backgroundColor: tokens.colorSubtleBackgroundSelected,
  },
  mobileRowText: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flexGrow: 1 },
  mobileRowAbout: {
    color: tokens.colorNeutralForeground3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  mobileBody: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
    paddingTop: "16px",
    paddingRight: "16px",
    paddingBottom: "max(24px, env(safe-area-inset-bottom))",
    paddingLeft: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
});

interface Section {
  id: SettingsSection;
  labelKey: MessageKey;
  icon: ReactElement;
  // What the section is for, under its title.
  aboutKey: MessageKey;
  // Words a search finds it by, beyond its label.
  wordsKey: MessageKey;
}

const SECTIONS: Section[] = [
  { id: "account", labelKey: "settings.dialog.section.account.label", icon: <Person20Regular />, aboutKey: "settings.dialog.section.account.about", wordsKey: "settings.dialog.section.account.words" },
  { id: "appearance", labelKey: "settings.dialog.section.appearance.label", icon: <PaintBrush20Regular />, aboutKey: "settings.dialog.section.appearance.about", wordsKey: "settings.dialog.section.appearance.words" },
  { id: "code", labelKey: "settings.dialog.section.code.label", icon: <Code20Regular />, aboutKey: "settings.dialog.section.code.about", wordsKey: "settings.dialog.section.code.words" },
  { id: "ai-connections", labelKey: "settings.dialog.section.aiConnections.label", icon: <BrainCircuit20Regular />, aboutKey: "settings.dialog.section.aiConnections.about", wordsKey: "settings.dialog.section.aiConnections.words" },
  { id: "compute", labelKey: "settings.dialog.section.compute.label", icon: <DataUsage20Regular />, aboutKey: "settings.dialog.section.compute.about", wordsKey: "settings.dialog.section.compute.words" },
  { id: "connectors", labelKey: "settings.dialog.section.connectors.label", icon: <PlugConnected20Regular />, aboutKey: "settings.dialog.section.connectors.about", wordsKey: "settings.dialog.section.connectors.words" },
  { id: "mcp-servers", labelKey: "settings.dialog.section.mcpServers.label", icon: <BookDatabase20Regular />, aboutKey: "settings.dialog.section.mcpServers.about", wordsKey: "settings.dialog.section.mcpServers.words" },
  { id: "claude-connectors", labelKey: "settings.dialog.section.claudeConnectors.label", icon: <Apps20Regular />, aboutKey: "settings.dialog.section.claudeConnectors.about", wordsKey: "settings.dialog.section.claudeConnectors.words" },
  { id: "skills", labelKey: "settings.dialog.section.skills.label", icon: <Lightbulb20Regular />, aboutKey: "settings.dialog.section.skills.about", wordsKey: "settings.dialog.section.skills.words" },
  { id: "plugins", labelKey: "settings.dialog.section.plugins.label", icon: <PuzzlePiece20Regular />, aboutKey: "settings.dialog.section.plugins.about", wordsKey: "settings.dialog.section.plugins.words" },
  { id: "system", labelKey: "settings.dialog.section.system.label", icon: <Server20Regular />, aboutKey: "settings.dialog.section.system.about", wordsKey: "settings.dialog.section.system.words" },
];

const found = (q: string, t: (k: MessageKey) => string): Section[] => (q === "" ? SECTIONS : SECTIONS.filter((x) => `${t(x.labelKey)} ${t(x.wordsKey)}`.toLowerCase().includes(q)));

export interface SettingsDialogProps {
  section: SettingsSection;
  // The connector to open in Connectors, when a page sent the person here to connect one.
  connector?: ConnectorName | null;
  // The sign-in this browser holds, and how a change of it (a profile, a password) reaches the page.
  auth: AuthStatus & { user: AuthUser };
  onAuth: (s: AuthStatus) => void;
  signOut: SignOut;
  settings: Settings | null;
  onSettings: (s: Settings) => void;
  onSection: (section: SettingsSection) => void;
  onClose: () => void;
}

// The connectors' status (and the system's checks, which come with it), current with the app stream. `reload` keeps
// its identity: a connector's detail reads the status again when its flow ends, from an effect that names it.
function useSetupStatus(): { data: SetupStatus | null; reload: () => void } {
  const { generation } = useAppStream();
  const status = useResource<SetupStatus>(() => get("/api/setup/status"), [generation]);
  const { reload: reloadNow } = status;
  const reload = useCallback(() => void reloadNow(), [reloadNow]);
  useAppEvent("connector.status", reload);
  return { data: status.data, reload };
}

function Body({ p, status, reloadStatus }: { p: SettingsDialogProps; status: SetupStatus | null; reloadStatus: () => void }) {
  const { t } = useI18n();
  if (p.section === "account")
    return (
      <>
        <AccountSection auth={p.auth} onAuth={p.onAuth} signOut={p.signOut} />
        <AccessLinkCard />
      </>
    );
  if (p.section === "ai-connections") return <AiConnectionsSection />;
  if (p.section === "compute") return <ComputeStorageSection />;
  if (p.section === "connectors") return <ConnectorsSection status={status} onChanged={reloadStatus} initial={p.connector ?? null} />;
  if (p.section === "mcp-servers") return <McpServersSection />;
  if (p.section === "claude-connectors") return <ClaudeConnectorsSection />;
  if (p.section === "skills") return <SkillsSection />;
  if (p.section === "plugins") return <PluginsSection onOpenCode={() => p.onSection("code")} />;
  if (p.section === "system") return <SystemCard status={status} />;
  if (p.settings === null) return <Text>{t("settings.dialog.loading")}</Text>;
  if (p.section === "appearance") return <AppearanceSection settings={p.settings} onSettings={p.onSettings} />;
  return <CodeSection settings={p.settings} onSettings={p.onSettings} />;
}

export function SettingsDialog(p: SettingsDialogProps) {
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile } = useViewport();
  const [query, setQuery] = useState("");
  const [mobileStep, setMobileStep] = useState<"index" | "detail">(() => (p.connector !== null || p.section !== "account" ? "detail" : "index"));
  const status = useSetupStatus();
  const shown = found(query.trim().toLowerCase(), t);
  const current = SECTIONS.find((x) => x.id === p.section) ?? SECTIONS[0];

  if (isMobile) {
    return (
      <Dialog open onOpenChange={(_, d) => (!d.open ? p.onClose() : undefined)}>
        <DialogSurface className={mergeClasses(s.surfaceMobile, mobileStep === "index" && s.surfaceMobileIndex)} aria-label={t("settings.dialog.title")}>
          {mobileStep === "index" ? (
            <>
              <header className={s.mobileBar}>
                <DialogTitle className={s.mobileTitle}>{t("settings.dialog.title")}</DialogTitle>
                <Button className={s.touchBtn} appearance="subtle" icon={<Dismiss20Regular />} aria-label={t("settings.dialog.closeAria")} onClick={p.onClose} />
              </header>
              <div className={s.mobileSearchWrap}>
                <SearchBox size="medium" style={{ width: "100%" }} placeholder={t("settings.dialog.searchPlaceholder")} aria-label={t("settings.dialog.searchPlaceholder")} value={query} onChange={(_, d) => setQuery(d.value)} />
              </div>
              <nav className={s.mobileIndexList} aria-label={t("settings.dialog.sectionsAria")}>
                {shown.map((x) => (
                  <button
                    key={x.id}
                    type="button"
                    className={mergeClasses(s.mobileRow, x.id === p.section && s.mobileRowSelected)}
                    aria-current={x.id === p.section ? "page" : undefined}
                    onClick={() => {
                      p.onSection(x.id);
                      setMobileStep("detail");
                    }}
                  >
                    {x.icon}
                    <span className={s.mobileRowText}>
                      <Text weight="semibold">{t(x.labelKey)}</Text>
                      <Text size={200} className={s.mobileRowAbout}>
                        {t(x.aboutKey)}
                      </Text>
                    </span>
                    <ChevronRight16Regular />
                  </button>
                ))}
                {shown.length === 0 && <Text className={s.none}>{t("settings.dialog.nothingMatches")}</Text>}
              </nav>
            </>
          ) : (
            <>
              <header className={mergeClasses(s.mobileBar, s.mobileDetailBar)}>
                <Button className={s.backBtn} appearance="subtle" icon={<ArrowLeft20Regular />} onClick={() => setMobileStep("index")}>
                  {t("settings.dialog.title")}
                </Button>
                <Text as="h2" size={400} weight="semibold">
                  {t(current.labelKey)}
                </Text>
                <Button className={s.touchBtn} appearance="subtle" icon={<Dismiss20Regular />} aria-label={t("settings.dialog.closeAria")} onClick={p.onClose} />
              </header>
              <section className={s.mobileBody} aria-label={t(current.labelKey)}>
                <Text size={200} className={s.muted}>
                  {t(current.aboutKey)}
                </Text>
                <Body p={p} status={status.data} reloadStatus={status.reload} />
              </section>
            </>
          )}
        </DialogSurface>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(_, d) => (!d.open ? p.onClose() : undefined)}>
      <DialogSurface className={s.surface}>
        <nav className={s.nav} aria-label={t("settings.dialog.sectionsAria")}>
          <DialogTitle className={s.title}>{t("settings.dialog.title")}</DialogTitle>
          <SearchBox className={s.search} size="small" placeholder={t("settings.dialog.searchPlaceholder")} aria-label={t("settings.dialog.searchPlaceholder")} value={query} onChange={(_, d) => setQuery(d.value)} />
          {shown.map((x) => (
            <Button key={x.id} className={mergeClasses(s.item, x.id === p.section && s.itemSelected)} appearance="subtle" icon={x.icon} aria-current={x.id === p.section ? "page" : undefined} onClick={() => p.onSection(x.id)}>
              {t(x.labelKey)}
            </Button>
          ))}
          {shown.length === 0 && <Text className={s.none}>{t("settings.dialog.nothingMatches")}</Text>}
        </nav>
        <section className={s.main} aria-label={t(current.labelKey)}>
          <div className={s.head}>
            <div className={s.heading}>
              <Text as="h2" size={500} weight="semibold">
                {t(current.labelKey)}
              </Text>
              <Text size={200} className={s.muted}>
                {t(current.aboutKey)}
              </Text>
            </div>
            <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label={t("settings.dialog.closeAria")} onClick={p.onClose} />
          </div>
          <div className={s.body}>
            <Body p={p} status={status.data} reloadStatus={status.reload} />
          </div>
        </section>
      </DialogSurface>
    </Dialog>
  );
}
