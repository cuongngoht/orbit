// SETTINGS, over whatever page is open: on the left a search and the sections -- Account, Appearance, Code, Connectors,
// Skills, Plugins, System -- and on the right the one chosen. Which one is open is the URL's (`?settings=<section>`), so
// a reload or a link comes back to it. The connectors' status is read here, and again whenever the app stream says a
// connector changed (or reopens, since it replays nothing).
import { Button, Dialog, DialogSurface, DialogTitle, SearchBox, Text, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import {
  ArrowLeft20Regular,
  ChevronRight16Regular,
  Code20Regular,
  Dismiss20Regular,
  Lightbulb20Regular,
  PaintBrush20Regular,
  Person20Regular,
  PlugConnected20Regular,
  PuzzlePiece20Regular,
  Server20Regular,
} from "@fluentui/react-icons";
import type { ClaudeStatus, ConnectorName, SetupStatus, Settings } from "@orbit-web/contracts";
import { useCallback, useState, type ReactElement } from "react";
import type { SettingsSection } from "../../hooks/useHashRoute";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { get } from "../../services/api";
import { useAppEvent, useAppStream } from "../../services/events/AppEvents";
import type { SignOut } from "../auth/useSignOut";
import { AccessLinkCard } from "./AccessLinkCard";
import { ClaudeAccountCard } from "./ClaudeAccountCard";
import { ConnectorsSection } from "./ConnectorsSection";
import { PluginsSection, SkillsSection } from "./CustomizeSections";
import { AppearanceSection, CodeSection } from "./PreferenceSections";
import { SystemCard } from "./SystemCard";

const useStyles = makeStyles({
  surface: { width: "min(1040px, 96vw)", maxWidth: "min(1040px, 96vw)", height: "min(760px, 92dvh)", paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, display: "flex", overflow: "hidden" },
  surfaceMobile: {
    width: "100vw",
    maxWidth: "100vw",
    height: "100dvh",
    maxHeight: "100dvh",
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
  item: { justifyContent: "flex-start", fontWeight: tokens.fontWeightRegular, width: "100%" },
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
    borderRadius: tokens.borderRadiusLarge,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    display: "flex",
    alignItems: "center",
    gap: "12px",
    textAlign: "left",
    cursor: "pointer",
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
  label: string;
  icon: ReactElement;
  // What the section is for, under its title.
  about: string;
  // Words a search finds it by, beyond its label.
  words: string;
}

const SECTIONS: Section[] = [
  { id: "account", label: "Account", icon: <Person20Regular />, about: "The Claude account Orbit Web is signed in with, and its access link.", words: "claude sign out email plan access link token" },
  { id: "appearance", label: "Appearance", icon: <PaintBrush20Regular />, about: "How Orbit Web looks.", words: "theme dark light system" },
  { id: "code", label: "Code", icon: <Code20Regular />, about: "How a new chat runs, and what a repository brings to it.", words: "model effort mode autonomous plan skills plugins web tools budget" },
  { id: "connectors", label: "Connectors", icon: <PlugConnected20Regular />, about: "Connect Orbit Web to your repositories on GitHub and Azure DevOps.", words: "github azure devops sign in cli repository" },
  { id: "skills", label: "Skills", icon: <Lightbulb20Regular />, about: "The skills, commands and agents Claude Code is given: Orbit's own, and each project's.", words: "commands agents project orbit" },
  { id: "plugins", label: "Plugins", icon: <PuzzlePiece20Regular />, about: "The plugins Claude Code runs with, and what became of each project's.", words: "plugin marketplace hooks mcp" },
  { id: "system", label: "System", icon: <Server20Regular />, about: "The programs, the plugin and the storage this container holds.", words: "status version health storage git node" },
];

const found = (q: string): Section[] => (q === "" ? SECTIONS : SECTIONS.filter((x) => `${x.label} ${x.words}`.toLowerCase().includes(q)));

export interface SettingsDialogProps {
  section: SettingsSection;
  // The connector to open in Connectors, when a page sent the person here to connect one.
  connector?: ConnectorName | null;
  claude: ClaudeStatus;
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
  if (p.section === "account")
    return (
      <>
        <ClaudeAccountCard status={p.claude} signOut={p.signOut} />
        <AccessLinkCard />
      </>
    );
  if (p.section === "connectors") return <ConnectorsSection status={status} onChanged={reloadStatus} initial={p.connector ?? null} />;
  if (p.section === "skills") return <SkillsSection />;
  if (p.section === "plugins") return <PluginsSection onOpenCode={() => p.onSection("code")} />;
  if (p.section === "system") return <SystemCard status={status} />;
  if (p.settings === null) return <Text>Reading the settings…</Text>;
  if (p.section === "appearance") return <AppearanceSection settings={p.settings} onSettings={p.onSettings} />;
  return <CodeSection settings={p.settings} onSettings={p.onSettings} />;
}

export function SettingsDialog(p: SettingsDialogProps) {
  const s = useStyles();
  const { isMobile } = useViewport();
  const [query, setQuery] = useState("");
  const [mobileStep, setMobileStep] = useState<"index" | "detail">(() => (p.connector !== null || p.section !== "account" ? "detail" : "index"));
  const status = useSetupStatus();
  const shown = found(query.trim().toLowerCase());
  const current = SECTIONS.find((x) => x.id === p.section) ?? SECTIONS[0];

  if (isMobile) {
    return (
      <Dialog open onOpenChange={(_, d) => (!d.open ? p.onClose() : undefined)}>
        <DialogSurface className={s.surfaceMobile} aria-label="Settings">
          {mobileStep === "index" ? (
            <>
              <header className={s.mobileBar}>
                <DialogTitle className={s.mobileTitle}>Settings</DialogTitle>
                <Button className={s.touchBtn} appearance="subtle" icon={<Dismiss20Regular />} aria-label="Close settings" onClick={p.onClose} />
              </header>
              <div className={s.mobileSearchWrap}>
                <SearchBox size="medium" style={{ width: "100%" }} placeholder="Search settings" aria-label="Search settings" value={query} onChange={(_, d) => setQuery(d.value)} />
              </div>
              <nav className={s.mobileIndexList} aria-label="Settings sections">
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
                      <Text weight="semibold">{x.label}</Text>
                      <Text size={200} className={s.mobileRowAbout}>
                        {x.about}
                      </Text>
                    </span>
                    <ChevronRight16Regular />
                  </button>
                ))}
                {shown.length === 0 && <Text className={s.none}>Nothing matches.</Text>}
              </nav>
            </>
          ) : (
            <>
              <header className={mergeClasses(s.mobileBar, s.mobileDetailBar)}>
                <Button className={s.backBtn} appearance="subtle" icon={<ArrowLeft20Regular />} onClick={() => setMobileStep("index")}>
                  Settings
                </Button>
                <Text as="h2" size={400} weight="semibold">
                  {current.label}
                </Text>
                <Button className={s.touchBtn} appearance="subtle" icon={<Dismiss20Regular />} aria-label="Close settings" onClick={p.onClose} />
              </header>
              <section className={s.mobileBody} aria-label={current.label}>
                <Text size={200} className={s.muted}>
                  {current.about}
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
        <nav className={s.nav} aria-label="Settings sections">
          <DialogTitle className={s.title}>Settings</DialogTitle>
          <SearchBox className={s.search} size="small" placeholder="Search settings" aria-label="Search settings" value={query} onChange={(_, d) => setQuery(d.value)} />
          {shown.map((x) => (
            <Button key={x.id} className={mergeClasses(s.item, x.id === p.section && s.itemSelected)} appearance="subtle" icon={x.icon} aria-current={x.id === p.section ? "page" : undefined} onClick={() => p.onSection(x.id)}>
              {x.label}
            </Button>
          ))}
          {shown.length === 0 && <Text className={s.none}>Nothing matches.</Text>}
        </nav>
        <section className={s.main} aria-label={current.label}>
          <div className={s.head}>
            <div className={s.heading}>
              <Text as="h2" size={500} weight="semibold">
                {current.label}
              </Text>
              <Text size={200} className={s.muted}>
                {current.about}
              </Text>
            </div>
            <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Close settings" onClick={p.onClose} />
          </div>
          <div className={s.body}>
            <Body p={p} status={status.data} reloadStatus={status.reload} />
          </div>
        </section>
      </DialogSurface>
    </Dialog>
  );
}
