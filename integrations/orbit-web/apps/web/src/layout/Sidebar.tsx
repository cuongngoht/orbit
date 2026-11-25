// THE SIDEBAR, as in Claude Code: Orbit and a collapse button; New session, Search (it filters the recents), Customize
// (Settings → Skills); the recent sessions of both kinds -- a chat (code icon, its source) or a research session (book
// icon, its workspace), each with a dot while it works or when it failed, a mark when another account shared it, and a
// menu to rename or delete it -- filtered by kind, kept current by the app stream; and at the bottom the person signed in
// to Orbit, by their full name, whose menu opens Settings or signs out.
import {
  Avatar,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Menu,
  MenuDivider,
  MenuGroup,
  MenuGroupHeader,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarBody,
  SearchBox,
  Spinner,
  Tab,
  TabList,
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  Add20Regular,
  Building20Regular,
  BookOpen16Regular,
  ChatSparkle20Regular,
  ChevronDown12Regular,
  Code16Regular,
  Delete16Regular,
  Dismiss20Regular,
  History20Regular,
  MoreHorizontal16Regular,
  PanelLeftContract20Regular,
  PanelLeftExpand20Regular,
  PuzzlePiece20Regular,
  People16Regular,
  Rename16Regular,
  Search20Regular,
  Server20Regular,
  Settings20Regular,
  SignOut20Regular,
} from "@fluentui/react-icons";
import type { AuthAccount, AuthUser, ResearchSessionSummary, SessionSummary } from "@orbit-web/contracts";
import { useEffect, useMemo, useState } from "react";
import { GovernanceIcon, OfficeIcon } from "../components/SectionIcons";
import { SourceMark } from "../components/SourceMark";
import { useI18n } from "../i18n";
import { errorText, send } from "../services/api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", width: "100%", maxWidth: "100%", minWidth: 0, overflow: "hidden", height: "100%", minHeight: 0, backgroundColor: tokens.colorNeutralBackground2, borderRight: `1px solid ${tokens.colorNeutralStroke2}` },
  rootDrawer: { borderRightStyle: "none", paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" },
  head: { display: "flex", alignItems: "center", gap: "8px", paddingTop: "12px", paddingRight: "12px", paddingBottom: "8px", paddingLeft: "16px", minWidth: 0 },
  headCollapsed: { paddingTop: "12px", paddingRight: "0", paddingBottom: "8px", paddingLeft: "0", justifyContent: "center" },
  brand: { display: "flex", alignItems: "center", gap: "8px", flexGrow: 1, minWidth: 0 },
  logo: { width: "26px", height: "26px" },
  nav: { display: "flex", flexDirection: "column", gap: "2px", paddingTop: "4px", paddingRight: "8px", paddingBottom: "4px", paddingLeft: "8px", minWidth: 0 },
  navCollapsed: { paddingTop: "4px", paddingRight: "0", paddingBottom: "4px", paddingLeft: "0", alignItems: "center" },
  navItem: { justifyContent: "flex-start", fontWeight: tokens.fontWeightRegular, width: "100%", borderRadius: "10px", transitionProperty: "background-color", transitionDuration: "140ms", ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover }, "@media (pointer: coarse)": { minHeight: "44px" } },
  navSelected: { backgroundColor: tokens.colorSubtleBackgroundSelected, color: tokens.colorNeutralForeground1, fontWeight: tokens.fontWeightSemibold, ":hover": { backgroundColor: tokens.colorSubtleBackgroundSelected } },
  section: { display: "flex", alignItems: "center", gap: "4px", paddingTop: "14px", paddingRight: "16px", paddingBottom: "4px", paddingLeft: "16px", color: tokens.colorNeutralForeground3 },
  sectionText: { fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.05em" },
  recents: { flexGrow: 1, minWidth: 0, maxWidth: "100%", overflowY: "auto", overflowX: "hidden", paddingTop: 0, paddingRight: "8px", paddingBottom: "8px", paddingLeft: "8px", marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0, listStyleType: "none" },
  item: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    maxWidth: "100%",
    overflow: "hidden",
    borderRadius: "10px",
    paddingLeft: "8px",
    transitionProperty: "background-color",
    transitionDuration: "140ms",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
    "@media (hover: hover) and (pointer: fine)": {
      "& [data-row-actions]": { opacity: 0, transitionProperty: "opacity", transitionDuration: "140ms" },
      "&:hover [data-row-actions], &:focus-within [data-row-actions]": { opacity: 1 },
    },
  },
  itemSelected: {
    backgroundColor: tokens.colorSubtleBackgroundSelected,
    "@media (hover: hover) and (pointer: fine)": {
      "& [data-row-actions]": { opacity: 0.85 },
    },
  },
  itemButton: { flexGrow: 1, minWidth: 0, maxWidth: "100%", overflow: "hidden", display: "flex", alignItems: "center", gap: "8px", border: "none", backgroundColor: "transparent", paddingTop: "7px", paddingRight: "0", paddingBottom: "7px", paddingLeft: "0", textAlign: "left", cursor: "pointer", color: tokens.colorNeutralForeground1, "@media (pointer: coarse)": { minHeight: "44px", paddingTop: "10px", paddingBottom: "10px" } },
  itemText: { flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "1px", overflow: "hidden" },
  itemTitle: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: tokens.fontSizeBase300 },
  itemSub: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", color: tokens.colorNeutralForeground3 },
  touchBtn: { "@media (pointer: coarse)": { minWidth: "44px", minHeight: "44px" } },
  dot: { width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0 },
  recentsBtnWrap: { position: "relative", display: "inline-flex" },
  recentsBadgeDot: { position: "absolute", top: "6px", right: "6px", width: "7px", height: "7px", borderRadius: "50%", pointerEvents: "none" },
  running: { backgroundColor: tokens.colorPaletteMarigoldBackground3 },
  failed: { backgroundColor: tokens.colorPaletteRedBackground3 },
  foot: { borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: "8px", paddingRight: "8px", paddingBottom: "8px", paddingLeft: "8px", display: "flex", alignItems: "center", gap: "4px" },
  footCollapsed: { paddingTop: "8px", paddingRight: "0", paddingBottom: "8px", paddingLeft: "0", display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", width: "100%" },
  account: { flexGrow: 1, minWidth: 0, justifyContent: "flex-start", fontWeight: tokens.fontWeightRegular, "@media (pointer: coarse)": { minHeight: "44px" } },
  accountCollapsed: { width: "40px", minWidth: "40px", height: "40px", paddingTop: "0", paddingRight: "0", paddingBottom: "0", paddingLeft: "0", justifyContent: "center" },
  dangerBtn: { backgroundColor: tokens.colorPaletteRedBackground3, color: tokens.colorNeutralForegroundOnBrand, ":hover": { backgroundColor: tokens.colorPaletteRedBorderActive, color: tokens.colorNeutralForegroundOnBrand } },
  accountText: { display: "flex", alignItems: "baseline", gap: "6px", minWidth: 0, flexGrow: 1, overflow: "hidden" },
  email: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  who: { display: "flex", flexDirection: "column", padding: "2px 10px 8px" },
  collapsed: { alignItems: "center" },
  empty: { padding: "8px", color: tokens.colorNeutralForeground3 },
  filter: { paddingTop: 0, paddingRight: "8px", paddingBottom: "4px", paddingLeft: "8px" },
  kindIcon: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  shared: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  srOnly: { position: "absolute", width: "1px", height: "1px", overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" },
});

// One row of the recents: a chat or a research session.
export type RecentEntry = { kind: "coding"; session: SessionSummary } | { kind: "research"; session: ResearchSessionSummary };

type Filter = "all" | "coding" | "research";

const isWorking = (e: RecentEntry): boolean => e.session.status === "running" || (e.kind === "coding" && e.session.status === "preparing");
const isFailed = (e: RecentEntry): boolean => e.session.status === "failed" || (e.kind === "coding" && e.session.status === "setup_failed");
const subtitleOf = (e: RecentEntry): string | null => (e.kind === "coding" ? e.session.repository : e.session.workspaceName);

export interface SidebarProps {
  sessions: SessionSummary[];
  // The research sessions, listed beside the chats.
  research?: ResearchSessionSummary[];
  loading: boolean;
  selected: string | null;
  collapsed: boolean;
  isDrawer?: boolean;
  // Who is signed in to Orbit, and the account (company) it is.
  user: AuthUser | null;
  account?: AuthAccount | null;
  signingOut: boolean;
  onToggle: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onCustomize: () => void;
  onSettings: () => void;
  // The office is open (and its entry is the current page).
  office?: boolean;
  onOffice?: () => void;
  // The Governance console is open (and its entry is the current page).
  governance?: boolean;
  onGovernance?: () => void;
  // The account's company as CEO Chat's state says it: undefined while that is not known (the entries are as they always
  // were), null when the account has none (Create company and Governance), else the company section -- CEO Chat, Office,
  // Governance, Resources.
  company?: { name: string } | null;
  // CEO Chat is open (and its entry is the current page).
  ceo?: boolean;
  onCeo?: () => void;
  // Resources: Settings → Compute.
  onResources?: () => void;
  onSignOut: () => void;
  onRenamed: (s: SessionSummary) => void;
  onDeleted: (id: string) => void;
  onResearchRenamed?: (s: ResearchSessionSummary) => void;
  onResearchDeleted?: (id: string) => void;
}

// The person signed in, as a line under their name: their username and the company of the account, when it has one.
const userLine = (user: AuthUser | null, account: AuthAccount | null): string | null => {
  const parts = [user ? `@${user.username}` : null, account?.companyName || null].filter((p): p is string => typeof p === "string" && p !== "");
  return parts.length > 0 ? parts.join(" · ") : null;
};

function AccountMenu({ user, account, collapsed, busy, onSettings, onSignOut }: { user: AuthUser | null; account: AuthAccount | null; collapsed: boolean; busy: boolean; onSettings: () => void; onSignOut: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const name = user?.fullName || user?.username || t("common.sidebar.yourAccount");
  const line = userLine(user, account);
  return (
    <Menu positioning="above-start">
      <MenuTrigger disableButtonEnhancement>
        <Button className={mergeClasses(s.account, collapsed && s.accountCollapsed)} appearance="subtle" icon={<Avatar name={name} size={24} />} aria-label={t("common.sidebar.signedInAs", { name })} disabled={busy}>
          {!collapsed && (
            <span className={s.accountText}>
              <span className={s.email}>{name}</span>
            </span>
          )}
          {!collapsed && <ChevronDown12Regular />}
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuGroup>
            <MenuGroupHeader>{t("common.sidebar.signedInToOrbit")}</MenuGroupHeader>
            <div className={s.who}>
              <Text weight="semibold">{name}</Text>
              {line && (
                <Text size={200} className={s.muted}>
                  {line}
                </Text>
              )}
            </div>
          </MenuGroup>
          <MenuDivider />
          <MenuItem icon={<Settings20Regular />} onClick={onSettings}>
            {t("common.sidebar.settings")}
          </MenuItem>
          <MenuItem icon={<SignOut20Regular />} onClick={onSignOut}>
            {t("common.sidebar.signOut")}
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

export function Sidebar(p: SidebarProps) {
  const { t } = useI18n();
  const s = useStyles();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<RecentEntry | null>(null);
  const [deleting, setDeleting] = useState<RecentEntry | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const hasResearch = (p.research?.length ?? 0) > 0;
  const activeFilter: Filter = hasResearch ? filter : "all";
  const isNewSession = p.selected === null && !p.governance && !p.office && !p.ceo;
  const { collapsed, onToggle } = p;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (collapsed) onToggle();
        setSearching(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [collapsed, onToggle]);
  const allEntries = useMemo(() => {
    const entries: RecentEntry[] = [...p.sessions.map((session) => ({ kind: "coding" as const, session })), ...(p.research ?? []).map((session) => ({ kind: "research" as const, session }))];
    entries.sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt) || b.session.createdAt.localeCompare(a.session.createdAt));
    return entries;
  }, [p.sessions, p.research]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allEntries.filter((e) => (activeFilter === "all" || e.kind === activeFilter) && (q === "" || e.session.title.toLowerCase().includes(q) || (subtitleOf(e) ?? "").toLowerCase().includes(q)));
  }, [allEntries, query, activeFilter]);
  const anyFailed = allEntries.some(isFailed);
  const anyWorking = allEntries.some(isWorking);

  if (p.collapsed)
    return (
      <nav className={mergeClasses(s.root, s.collapsed)} aria-label={t("common.sidebar.navLabel")}>
        <div className={mergeClasses(s.head, s.headCollapsed)}>
          <Tooltip content={t("common.sidebar.open")} relationship="label">
            <Button appearance="subtle" className={s.accountCollapsed} icon={<PanelLeftExpand20Regular />} onClick={p.onToggle} />
          </Tooltip>
        </div>
        <div className={mergeClasses(s.nav, s.navCollapsed)}>
          <Tooltip content={t("common.sidebar.newSession")} relationship="label">
            <Button appearance="subtle" className={mergeClasses(s.accountCollapsed, isNewSession && s.navSelected)} icon={<Add20Regular />} aria-current={isNewSession ? "page" : undefined} onClick={p.onNew} />
          </Tooltip>
          <Tooltip content={t("common.sidebar.searchShortcut")} relationship="label">
            <Button
              appearance="subtle"
              className={s.accountCollapsed}
              icon={<Search20Regular />}
              aria-label={t("common.sidebar.search")}
              onClick={() => {
                p.onToggle();
                setSearching(true);
              }}
            />
          </Tooltip>
          <Menu positioning="after-top">
            <MenuTrigger disableButtonEnhancement>
              <span className={s.recentsBtnWrap}>
                <Tooltip content={t("common.sidebar.recents")} relationship="label">
                  <Button appearance="subtle" className={s.accountCollapsed} icon={<History20Regular />} aria-label={t("common.sidebar.recents")} />
                </Tooltip>
                {(anyFailed || anyWorking) && <span className={mergeClasses(s.recentsBadgeDot, anyFailed ? s.failed : s.running)} aria-hidden />}
              </span>
            </MenuTrigger>
            <MenuPopover>
              <MenuList>
                <MenuGroup>
                  <MenuGroupHeader>{t("common.sidebar.recents")}</MenuGroupHeader>
                  {allEntries.length === 0 ? (
                    <MenuItem disabled>{t("common.sidebar.emptyChats")}</MenuItem>
                  ) : (
                    allEntries.slice(0, 20).map((e) => (
                      <MenuItem
                        key={e.session.id}
                        icon={e.kind === "research" ? <BookOpen16Regular /> : <Code16Regular />}
                        onClick={() => p.onOpen(e.session.id)}
                      >
                        {e.session.title}
                      </MenuItem>
                    ))
                  )}
                </MenuGroup>
              </MenuList>
            </MenuPopover>
          </Menu>
          <Tooltip content={t("common.sidebar.customize")} relationship="label">
            <Button appearance="subtle" className={s.accountCollapsed} icon={<PuzzlePiece20Regular />} onClick={p.onCustomize} />
          </Tooltip>
          {p.company && p.onCeo && (
            <Tooltip content={t("executive.nav.ceoChat")} relationship="label">
              <Button appearance="subtle" className={mergeClasses(s.accountCollapsed, p.ceo && s.navSelected)} icon={<ChatSparkle20Regular />} aria-current={p.ceo ? "page" : undefined} onClick={p.onCeo} />
            </Tooltip>
          )}
          {p.onOffice && (
            <Tooltip content={p.company === null ? t("executive.nav.createCompany") : t("common.sidebar.office")} relationship="label">
              <Button
                appearance="subtle"
                className={mergeClasses(s.accountCollapsed, p.office && s.navSelected)}
                icon={p.company === null ? <Building20Regular /> : <OfficeIcon size={18} active={p.office} />}
                aria-current={p.office ? "page" : undefined}
                onClick={p.onOffice}
              />
            </Tooltip>
          )}
          {p.onGovernance && (
            <Tooltip content={t("common.sidebar.governance")} relationship="label">
              <Button appearance="subtle" className={mergeClasses(s.accountCollapsed, p.governance && s.navSelected)} icon={<GovernanceIcon size={18} active={p.governance} />} aria-current={p.governance ? "page" : undefined} onClick={p.onGovernance} />
            </Tooltip>
          )}
          {p.company && p.onResources && (
            <Tooltip content={t("executive.nav.resources")} relationship="label">
              <Button appearance="subtle" className={s.accountCollapsed} icon={<Server20Regular />} onClick={p.onResources} />
            </Tooltip>
          )}
        </div>
        <div style={{ flexGrow: 1 }} />
        <div className={mergeClasses(s.foot, s.footCollapsed)}>
          <Tooltip content={t("common.sidebar.settings")} relationship="label">
            <Button appearance="subtle" className={s.accountCollapsed} icon={<Settings20Regular />} aria-label={t("common.sidebar.settings")} onClick={p.onSettings} />
          </Tooltip>
          <AccountMenu user={p.user} account={p.account ?? null} collapsed busy={p.signingOut} onSettings={p.onSettings} onSignOut={p.onSignOut} />
        </div>
      </nav>
    );

  return (
    <nav className={mergeClasses(s.root, p.isDrawer && s.rootDrawer)} aria-label={t("common.sidebar.navLabel")}>
      <div className={s.head}>
        <div className={s.brand}>
          <img src="/orbit.svg" alt="" className={s.logo} />
          <Text weight="semibold" size={500}>
            {t("common.sidebar.brand")}
          </Text>
        </div>
        <Tooltip content={t("common.sidebar.close")} relationship="label">
          <Button className={p.isDrawer ? s.touchBtn : undefined} appearance="subtle" icon={p.isDrawer ? <Dismiss20Regular /> : <PanelLeftContract20Regular />} aria-label={t("common.sidebar.close")} onClick={p.onToggle} />
        </Tooltip>
      </div>
      <div className={s.nav}>
        <Button className={mergeClasses(s.navItem, p.selected === null && !p.governance && !p.office && !p.ceo && s.navSelected)} appearance="subtle" icon={<Add20Regular />} aria-current={p.selected === null && !p.governance && !p.office && !p.ceo ? "page" : undefined} onClick={p.onNew}>
          {t("common.sidebar.newSession")}
        </Button>
        {searching ? (
          <SearchBox
            autoFocus
            size="medium"
            placeholder={t("common.sidebar.searchChats")}
            aria-label={t("common.sidebar.searchChats")}
            value={query}
            onChange={(_, d) => setQuery(d.value)}
            onBlur={() => query === "" && setSearching(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery("");
                setSearching(false);
              }
            }}
          />
        ) : (
          <Button className={s.navItem} appearance="subtle" icon={<Search20Regular />} onClick={() => setSearching(true)}>
            {t("common.sidebar.search")}
          </Button>
        )}
        <Button className={s.navItem} appearance="subtle" icon={<PuzzlePiece20Regular />} onClick={p.onCustomize}>
          {t("common.sidebar.customize")}
        </Button>
        {p.company !== undefined && (
          <div className={s.section} role="presentation">
            <Text size={100} weight="semibold" className={s.sectionText}>
              {p.company === null ? t("executive.nav.section") : p.company.name || t("executive.nav.section")}
            </Text>
          </div>
        )}
        {p.company && p.onCeo && (
          <Button className={mergeClasses(s.navItem, p.ceo && s.navSelected)} appearance="subtle" icon={<ChatSparkle20Regular />} aria-current={p.ceo ? "page" : undefined} onClick={p.onCeo}>
            {t("executive.nav.ceoChat")}
          </Button>
        )}
        {p.onOffice && (
          <Button className={mergeClasses(s.navItem, p.office && s.navSelected)} appearance="subtle" icon={p.company === null ? <Building20Regular /> : <OfficeIcon size={18} active={p.office} />} aria-current={p.office ? "page" : undefined} onClick={p.onOffice}>
            {p.company === null ? t("executive.nav.createCompany") : t("common.sidebar.office")}
          </Button>
        )}
        {p.onGovernance && (
          <Button className={mergeClasses(s.navItem, p.governance && s.navSelected)} appearance="subtle" icon={<GovernanceIcon size={18} active={p.governance} />} aria-current={p.governance ? "page" : undefined} onClick={p.onGovernance}>
            {t("common.sidebar.governance")}
          </Button>
        )}
        {p.company && p.onResources && (
          <Button className={s.navItem} appearance="subtle" icon={<Server20Regular />} onClick={p.onResources}>
            {t("executive.nav.resources")}
          </Button>
        )}
      </div>
      <div className={s.section}>
        <Text size={100} weight="semibold" className={s.sectionText}>
          {t("common.sidebar.recents")}
        </Text>
      </div>
      {hasResearch && (
        <div className={s.filter}>
          <TabList size="small" selectedValue={activeFilter} onTabSelect={(_, d) => setFilter(d.value as Filter)} aria-label={t("common.sidebar.filterLabel")}>
            <Tab value="all">{t("common.sidebar.filterAll")}</Tab>
            <Tab value="coding">{t("common.sidebar.filterChat")}</Tab>
            <Tab value="research">{t("common.sidebar.filterResearch")}</Tab>
          </TabList>
        </div>
      )}
      <ul className={s.recents} aria-label={t("common.sidebar.chatsLabel")}>
        {p.loading && <Spinner size="tiny" />}
        {!p.loading && shown.length === 0 && <li className={s.empty}>{query ? t("common.sidebar.emptyMatch") : activeFilter === "research" ? t("common.sidebar.emptyResearch") : t("common.sidebar.emptyChats")}</li>}
        {shown.map((e) => {
          const x = e.session;
          const subtitle = subtitleOf(e);
          return (
            <li key={x.id} className={mergeClasses(s.item, p.selected === x.id && s.itemSelected)}>
              <button type="button" className={s.itemButton} onClick={() => p.onOpen(x.id)} aria-current={p.selected === x.id ? "page" : undefined} title={subtitle ? `${x.title} — ${subtitle}` : x.title}>
                {e.kind === "research" ? <BookOpen16Regular className={s.kindIcon} aria-hidden /> : <Code16Regular className={s.kindIcon} aria-hidden />}
                <span className={s.itemText}>
                  <span className={s.itemTitle}>
                    {x.title}
                    {e.kind === "research" && <span className={s.srOnly}>{t("common.sidebar.researchSuffix")}</span>}
                  </span>
                  {subtitle && (
                    <span className={s.itemSub} aria-hidden="true">
                      {subtitle}
                    </span>
                  )}
                </span>
                {isWorking(e) && <span role="img" className={mergeClasses(s.dot, s.running)} aria-label={x.status === "running" ? t("common.sidebar.statusWorking") : t("common.sidebar.statusPreparing")} />}
                {isFailed(e) && <span role="img" className={mergeClasses(s.dot, s.failed)} aria-label={t("common.sidebar.statusFailed")} />}
                {x.access === "shared" && <People16Regular className={s.shared} role="img" aria-label={t("common.sidebar.sharedWithYou", { owner: x.owner ?? t("common.sidebar.itsOwner") })} />}
                {e.kind === "coding" && <SourceMark source={e.session.source} />}
              </button>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button data-row-actions="" className={s.touchBtn} appearance="transparent" size="small" icon={<MoreHorizontal16Regular />} aria-label={t("common.sidebar.actionsFor", { title: x.title })} />
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem icon={<Rename16Regular />} onClick={() => setRenaming(e)}>
                      {t("common.sidebar.rename")}
                    </MenuItem>
                    {x.access !== "shared" && (
                      <MenuItem icon={<Delete16Regular />} onClick={() => setDeleting(e)}>
                        {t("common.sidebar.delete")}
                      </MenuItem>
                    )}
                  </MenuList>
                </MenuPopover>
              </Menu>
            </li>
          );
        })}
      </ul>
      <div className={s.foot}>
        <AccountMenu user={p.user} account={p.account ?? null} collapsed={false} busy={p.signingOut} onSettings={p.onSettings} onSignOut={p.onSignOut} />
        <Tooltip content={t("common.sidebar.settings")} relationship="label">
          <Button className={s.touchBtn} appearance="subtle" icon={<Settings20Regular />} aria-label={t("common.sidebar.settings")} onClick={p.onSettings} />
        </Tooltip>
      </div>
      {renaming && (
        <RenameDialog
          entry={renaming}
          onClose={() => setRenaming(null)}
          onDone={(updated) => (updated.kind === "research" ? p.onResearchRenamed?.(updated.session) : p.onRenamed(updated.session))}
        />
      )}
      {deleting && <DeleteDialog entry={deleting} onClose={() => setDeleting(null)} onDone={() => (deleting.kind === "research" ? p.onResearchDeleted?.(deleting.session.id) : p.onDeleted(deleting.session.id))} />}
    </nav>
  );
}

function RenameDialog({ entry, onClose, onDone }: { entry: RecentEntry; onClose: () => void; onDone: (e: RecentEntry) => void }) {
  const { t } = useI18n();
  const session = entry.session;
  const [title, setTitle] = useState(session.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (entry.kind === "research") onDone({ kind: "research", session: await send<ResearchSessionSummary>("PATCH", `/api/research/sessions/${session.id}`, { title }) });
      else onDone({ kind: "coding", session: await send<SessionSummary>("PATCH", `/api/sessions/${session.id}`, { title }) });
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(_, d) => (!d.open && !busy ? onClose() : undefined)}>
      <DialogSurface>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogBody>
            <DialogTitle>{entry.kind === "research" ? t("common.sidebar.renameResearchTitle") : t("common.sidebar.renameChatTitle")}</DialogTitle>
            <DialogContent>
              <Field label={t("common.sidebar.titleField")}>
                <Input value={title} disabled={busy} onChange={(_, d) => setTitle(d.value)} maxLength={120} autoFocus />
              </Field>
              {error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" disabled={busy} onClick={onClose}>
                {t("common.sidebar.cancel")}
              </Button>
              <Button appearance="primary" type="submit" icon={busy ? <Spinner size="extra-tiny" /> : undefined} disabled={busy || title.trim().length === 0}>
                {t("common.sidebar.save")}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

function DeleteDialog({ entry, onClose, onDone }: { entry: RecentEntry; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const session = entry.session;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await send("DELETE", entry.kind === "research" ? `/api/research/sessions/${session.id}` : `/api/sessions/${session.id}`);
      onDone();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(_, d) => (!d.open && !busy ? onClose() : undefined)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{t("common.sidebar.deleteTitle", { title: session.title })}</DialogTitle>
          <DialogContent>
            {entry.kind === "research"
              ? t("common.sidebar.deleteResearchBody", { workspace: entry.session.workspaceName })
              : t("common.sidebar.deleteChatBody")}
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" disabled={busy} onClick={onClose}>
              {t("common.sidebar.cancel")}
            </Button>
            <Button className={s.dangerBtn} appearance="primary" icon={busy ? <Spinner size="extra-tiny" /> : undefined} disabled={busy} onClick={() => void remove()}>
              {t("common.sidebar.delete")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
