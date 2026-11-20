// SETTINGS, over whatever page is open: on the left a search and the sections -- Account, Appearance, Code, Connectors,
// Skills, Plugins, System -- and on the right the one chosen. Which one is open is the URL's (`?settings=<section>`), so
// a reload or a link comes back to it. The connectors' status is read here, and again whenever the app stream says a
// connector changed (or reopens, since it replays nothing).
import { Button, Dialog, DialogSurface, DialogTitle, SearchBox, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import {
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
  surface: { width: "min(1040px, 96vw)", maxWidth: "min(1040px, 96vw)", height: "min(760px, 92vh)", padding: 0, display: "flex", overflow: "hidden" },
  nav: { width: "232px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "4px", padding: "18px 10px", backgroundColor: tokens.colorNeutralBackground2, borderRight: `1px solid ${tokens.colorNeutralStroke2}` },
  title: { padding: "0 8px 8px" },
  search: { margin: "0 2px 8px" },
  item: { justifyContent: "flex-start", fontWeight: tokens.fontWeightRegular, width: "100%" },
  itemSelected: { backgroundColor: tokens.colorSubtleBackgroundSelected, fontWeight: tokens.fontWeightSemibold },
  none: { padding: "8px", color: tokens.colorNeutralForeground3 },
  main: { flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  head: { display: "flex", alignItems: "flex-start", gap: "12px", padding: "22px 20px 6px 32px" },
  heading: { display: "flex", flexDirection: "column", gap: "4px", flexGrow: 1, minWidth: 0 },
  muted: { color: tokens.colorNeutralForeground3 },
  body: { flexGrow: 1, overflowY: "auto", padding: "14px 32px 32px" },
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
  const [query, setQuery] = useState("");
  const status = useSetupStatus();
  const shown = found(query.trim().toLowerCase());
  const current = SECTIONS.find((x) => x.id === p.section) ?? SECTIONS[0];
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
