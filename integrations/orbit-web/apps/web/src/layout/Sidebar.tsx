// THE SIDEBAR, as in Claude Code: Orbit and a collapse button; New session, Search (it filters the recents), Customize
// (Settings → Skills); the recent sessions of both kinds -- a chat (code icon, its source) or a research session (book
// icon, its workspace), each with a dot while it works or when it failed, a mark when another account shared it, and a
// menu to rename or delete it -- filtered by kind, kept current by the app stream; and at the bottom the Claude account
// Orbit Web is signed in with, whose menu opens Settings or signs out.
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
  BookOpen16Regular,
  ChevronDown12Regular,
  Code16Regular,
  Delete16Regular,
  Dismiss20Regular,
  MoreHorizontal16Regular,
  PanelLeftContract20Regular,
  PanelLeftExpand20Regular,
  PuzzlePiece20Regular,
  People16Regular,
  Rename16Regular,
  Search20Regular,
  ShieldKeyhole20Regular,
  Settings20Regular,
  SignOut20Regular,
} from "@fluentui/react-icons";
import type { ClaudeAccount, ResearchSessionSummary, SessionSummary } from "@orbit-web/contracts";
import { useMemo, useState } from "react";
import { SourceMark } from "../components/SourceMark";
import { accountLine } from "../features/auth/account";
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
  itemTitle: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: tokens.fontSizeBase300 },
  touchBtn: { "@media (pointer: coarse)": { minWidth: "44px", minHeight: "44px" } },
  dot: { width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0 },
  running: { backgroundColor: tokens.colorPaletteMarigoldBackground3 },
  failed: { backgroundColor: tokens.colorPaletteRedBackground3 },
  foot: { borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: "8px", paddingRight: "8px", paddingBottom: "8px", paddingLeft: "8px" },
  footCollapsed: { paddingTop: "8px", paddingRight: "0", paddingBottom: "8px", paddingLeft: "0", display: "flex", justifyContent: "center", width: "100%" },
  account: { width: "100%", justifyContent: "flex-start", fontWeight: tokens.fontWeightRegular, "@media (pointer: coarse)": { minHeight: "44px" } },
  accountCollapsed: { width: "40px", minWidth: "40px", height: "40px", paddingTop: "0", paddingRight: "0", paddingBottom: "0", paddingLeft: "0", justifyContent: "center" },
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
  account: ClaudeAccount | null;
  signingOut: boolean;
  onToggle: () => void;
  onNew: () => void;
  onOpen: (id: string) => void;
  onCustomize: () => void;
  onSettings: () => void;
  // The Governance console is open (and its entry is the current page).
  governance?: boolean;
  onGovernance?: () => void;
  onSignOut: () => void;
  onRenamed: (s: SessionSummary) => void;
  onDeleted: (id: string) => void;
  onResearchRenamed?: (s: ResearchSessionSummary) => void;
  onResearchDeleted?: (id: string) => void;
}

function AccountMenu({ account, collapsed, busy, onSettings, onSignOut }: { account: ClaudeAccount | null; collapsed: boolean; busy: boolean; onSettings: () => void; onSignOut: () => void }) {
  const s = useStyles();
  const name = account?.email ?? "Claude account";
  const line = accountLine(account);
  return (
    <Menu positioning="above-start">
      <MenuTrigger disableButtonEnhancement>
        <Button className={mergeClasses(s.account, collapsed && s.accountCollapsed)} appearance="subtle" icon={<Avatar name={name} size={24} />} aria-label={`Signed in as ${name}`} disabled={busy}>
          {!collapsed && (
            <span className={s.accountText}>
              <span className={s.email}>{name}</span>
              {account?.plan && (
                <Text size={200} className={s.muted}>
                  {account.plan}
                </Text>
              )}
            </span>
          )}
          {!collapsed && <ChevronDown12Regular />}
        </Button>
      </MenuTrigger>
      <MenuPopover>
        <MenuList>
          <MenuGroup>
            <MenuGroupHeader>Signed in with Claude</MenuGroupHeader>
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
            Settings
          </MenuItem>
          <MenuItem icon={<SignOut20Regular />} onClick={onSignOut}>
            Sign out
          </MenuItem>
        </MenuList>
      </MenuPopover>
    </Menu>
  );
}

export function Sidebar(p: SidebarProps) {
  const s = useStyles();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<RecentEntry | null>(null);
  const [deleting, setDeleting] = useState<RecentEntry | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const hasResearch = (p.research?.length ?? 0) > 0;
  const shown = useMemo(() => {
    const entries: RecentEntry[] = [...p.sessions.map((session) => ({ kind: "coding" as const, session })), ...(p.research ?? []).map((session) => ({ kind: "research" as const, session }))];
    entries.sort((a, b) => b.session.updatedAt.localeCompare(a.session.updatedAt) || b.session.createdAt.localeCompare(a.session.createdAt));
    const q = query.trim().toLowerCase();
    return entries.filter((e) => (filter === "all" || e.kind === filter) && (q === "" || e.session.title.toLowerCase().includes(q) || (subtitleOf(e) ?? "").toLowerCase().includes(q)));
  }, [p.sessions, p.research, query, filter]);

  if (p.collapsed)
    return (
      <nav className={mergeClasses(s.root, s.collapsed)} aria-label="Orbit">
        <div className={mergeClasses(s.head, s.headCollapsed)}>
          <Tooltip content="Open the sidebar" relationship="label">
            <Button appearance="subtle" icon={<PanelLeftExpand20Regular />} onClick={p.onToggle} />
          </Tooltip>
        </div>
        <div className={mergeClasses(s.nav, s.navCollapsed)}>
          <Tooltip content="New session" relationship="label">
            <Button appearance="subtle" icon={<Add20Regular />} onClick={p.onNew} />
          </Tooltip>
          <Tooltip content="Customize" relationship="label">
            <Button appearance="subtle" icon={<PuzzlePiece20Regular />} onClick={p.onCustomize} />
          </Tooltip>
          {p.onGovernance && (
            <Tooltip content="Governance" relationship="label">
              <Button appearance="subtle" icon={<ShieldKeyhole20Regular />} aria-current={p.governance ? "page" : undefined} onClick={p.onGovernance} />
            </Tooltip>
          )}
        </div>
        <div style={{ flexGrow: 1 }} />
        <div className={mergeClasses(s.foot, s.footCollapsed)}>
          <AccountMenu account={p.account} collapsed busy={p.signingOut} onSettings={p.onSettings} onSignOut={p.onSignOut} />
        </div>
      </nav>
    );

  return (
    <nav className={mergeClasses(s.root, p.isDrawer && s.rootDrawer)} aria-label="Orbit">
      <div className={s.head}>
        <div className={s.brand}>
          <img src="/orbit.svg" alt="" className={s.logo} />
          <Text weight="semibold" size={500}>
            Orbit
          </Text>
        </div>
        <Tooltip content="Close the sidebar" relationship="label">
          <Button className={p.isDrawer ? s.touchBtn : undefined} appearance="subtle" icon={p.isDrawer ? <Dismiss20Regular /> : <PanelLeftContract20Regular />} aria-label="Close the sidebar" onClick={p.onToggle} />
        </Tooltip>
      </div>
      <div className={s.nav}>
        <Button className={mergeClasses(s.navItem, p.selected === null && !p.governance && s.navSelected)} appearance="subtle" icon={<Add20Regular />} aria-current={p.selected === null && !p.governance ? "page" : undefined} onClick={p.onNew}>
          New session
        </Button>
        {searching ? (
          <SearchBox
            autoFocus
            size="medium"
            placeholder="Search chats"
            aria-label="Search chats"
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
            Search
          </Button>
        )}
        <Button className={s.navItem} appearance="subtle" icon={<PuzzlePiece20Regular />} onClick={p.onCustomize}>
          Customize
        </Button>
        {p.onGovernance && (
          <Button className={mergeClasses(s.navItem, p.governance && s.navSelected)} appearance="subtle" icon={<ShieldKeyhole20Regular />} aria-current={p.governance ? "page" : undefined} onClick={p.onGovernance}>
            Governance
          </Button>
        )}
      </div>
      <div className={s.section}>
        <Text size={100} weight="semibold" className={s.sectionText}>
          Recents
        </Text>
      </div>
      {hasResearch && (
        <div className={s.filter}>
          <TabList size="small" selectedValue={filter} onTabSelect={(_, d) => setFilter(d.value as Filter)} aria-label="Show sessions of kind">
            <Tab value="all">All</Tab>
            <Tab value="coding">Chat</Tab>
            <Tab value="research">Research</Tab>
          </TabList>
        </div>
      )}
      <ul className={s.recents} aria-label="Chats">
        {p.loading && <Spinner size="tiny" />}
        {!p.loading && shown.length === 0 && <li className={s.empty}>{query ? "No chat matches." : filter === "research" ? "No research sessions yet." : "No chats yet."}</li>}
        {shown.map((e) => {
          const x = e.session;
          const subtitle = subtitleOf(e);
          return (
            <li key={x.id} className={mergeClasses(s.item, p.selected === x.id && s.itemSelected)}>
              <button type="button" className={s.itemButton} onClick={() => p.onOpen(x.id)} aria-current={p.selected === x.id ? "page" : undefined} title={subtitle ? `${x.title} — ${subtitle}` : x.title}>
                {e.kind === "research" ? <BookOpen16Regular className={s.kindIcon} aria-hidden /> : <Code16Regular className={s.kindIcon} aria-hidden />}
                <span className={s.itemTitle}>{x.title}</span>
                {e.kind === "research" && <span className={s.srOnly}> (research)</span>}
                {isWorking(e) && <span role="img" className={mergeClasses(s.dot, s.running)} aria-label={x.status === "running" ? "working" : "preparing"} />}
                {isFailed(e) && <span role="img" className={mergeClasses(s.dot, s.failed)} aria-label="failed" />}
                {x.access === "shared" && <People16Regular className={s.shared} role="img" aria-label={`Shared with you by ${x.owner ?? "its owner"}`} />}
                {e.kind === "coding" && <SourceMark source={e.session.source} />}
              </button>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button data-row-actions="" className={s.touchBtn} appearance="transparent" size="small" icon={<MoreHorizontal16Regular />} aria-label={`Actions for ${x.title}`} />
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem icon={<Rename16Regular />} onClick={() => setRenaming(e)}>
                      Rename
                    </MenuItem>
                    <MenuItem icon={<Delete16Regular />} onClick={() => setDeleting(e)}>
                      Delete
                    </MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            </li>
          );
        })}
      </ul>
      <div className={s.foot}>
        <AccountMenu account={p.account} collapsed={false} busy={p.signingOut} onSettings={p.onSettings} onSignOut={p.onSignOut} />
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
  const session = entry.session;
  const [title, setTitle] = useState(session.title);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      if (entry.kind === "research") onDone({ kind: "research", session: await send<ResearchSessionSummary>("PATCH", `/api/research/sessions/${session.id}`, { title }) });
      else onDone({ kind: "coding", session: await send<SessionSummary>("PATCH", `/api/sessions/${session.id}`, { title }) });
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Dialog open onOpenChange={(_, d) => (!d.open ? onClose() : undefined)}>
      <DialogSurface>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <DialogBody>
            <DialogTitle>{entry.kind === "research" ? "Rename research session" : "Rename chat"}</DialogTitle>
            <DialogContent>
              <Field label="Title">
                <Input value={title} onChange={(_, d) => setTitle(d.value)} maxLength={120} autoFocus />
              </Field>
              {error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )}
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button appearance="primary" type="submit" disabled={title.trim().length === 0}>
                Save
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

function DeleteDialog({ entry, onClose, onDone }: { entry: RecentEntry; onClose: () => void; onDone: () => void }) {
  const session = entry.session;
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    try {
      await send("DELETE", entry.kind === "research" ? `/api/research/sessions/${session.id}` : `/api/sessions/${session.id}`);
      onDone();
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Dialog open onOpenChange={(_, d) => (!d.open ? onClose() : undefined)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Delete “{session.title}”?</DialogTitle>
          <DialogContent>
            {entry.kind === "research"
              ? `This removes the research session's conversation. The workspace “${entry.session.workspaceName}” keeps its sources, notes and findings.`
              : "This removes the chat, its history and its workspace (including any local commits in it). Nothing was pushed from it."}
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={() => void remove()}>
              Delete
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
