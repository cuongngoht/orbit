// THE SIDEBAR, as in Claude Code: Orbit and a collapse button; New session, Search (it filters the recents), Customize
// (Settings → Skills); the recent chats -- each with its source and a dot while it works or when it failed, and a menu
// to rename or delete it -- kept current by the app stream; and at the bottom the Claude account Orbit Web is signed in
// with, whose menu opens Settings or signs out.
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
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import {
  Add20Regular,
  ChevronDown12Regular,
  Delete16Regular,
  Dismiss20Regular,
  MoreHorizontal16Regular,
  PanelLeftContract20Regular,
  PanelLeftExpand20Regular,
  PuzzlePiece20Regular,
  Rename16Regular,
  Search20Regular,
  ShieldKeyhole20Regular,
  Settings20Regular,
  SignOut20Regular,
} from "@fluentui/react-icons";
import type { ClaudeAccount, SessionSummary } from "@orbit-web/contracts";
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
  logo: { width: "22px", height: "22px" },
  nav: { display: "flex", flexDirection: "column", gap: "2px", paddingTop: "4px", paddingRight: "8px", paddingBottom: "4px", paddingLeft: "8px", minWidth: 0 },
  navCollapsed: { paddingTop: "4px", paddingRight: "0", paddingBottom: "4px", paddingLeft: "0", alignItems: "center" },
  navItem: { justifyContent: "flex-start", fontWeight: tokens.fontWeightRegular, width: "100%", "@media (pointer: coarse)": { minHeight: "44px" } },
  navSelected: { backgroundColor: tokens.colorSubtleBackgroundSelected },
  section: { display: "flex", alignItems: "center", gap: "4px", padding: "14px 16px 4px", color: tokens.colorNeutralForeground3 },
  recents: { flexGrow: 1, minWidth: 0, maxWidth: "100%", overflowY: "auto", overflowX: "hidden", padding: "0 8px 8px", margin: 0, listStyleType: "none" },
  item: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0, maxWidth: "100%", overflow: "hidden", borderRadius: tokens.borderRadiusMedium, paddingLeft: "8px", ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover } },
  itemSelected: { backgroundColor: tokens.colorSubtleBackgroundSelected },
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
});

export interface SidebarProps {
  sessions: SessionSummary[];
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
  const [renaming, setRenaming] = useState<SessionSummary | null>(null);
  const [deleting, setDeleting] = useState<SessionSummary | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === "" ? p.sessions : p.sessions.filter((x) => x.title.toLowerCase().includes(q) || (x.repository ?? "").toLowerCase().includes(q));
  }, [p.sessions, query]);

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
        <Text size={200} weight="semibold">
          Recents
        </Text>
      </div>
      <ul className={s.recents} aria-label="Chats">
        {p.loading && <Spinner size="tiny" />}
        {!p.loading && shown.length === 0 && <li className={s.empty}>{query ? "No chat matches." : "No chats yet."}</li>}
        {shown.map((x) => (
          <li key={x.id} className={mergeClasses(s.item, p.selected === x.id && s.itemSelected)}>
            <button type="button" className={s.itemButton} onClick={() => p.onOpen(x.id)} aria-current={p.selected === x.id ? "page" : undefined} title={x.repository ? `${x.title} — ${x.repository}` : x.title}>
              <span className={s.itemTitle}>{x.title}</span>
              {(x.status === "running" || x.status === "preparing") && <span role="img" className={mergeClasses(s.dot, s.running)} aria-label={x.status === "running" ? "working" : "preparing"} />}
              {(x.status === "failed" || x.status === "setup_failed") && <span role="img" className={mergeClasses(s.dot, s.failed)} aria-label="failed" />}
              <SourceMark source={x.source} />
            </button>
            <Menu>
              <MenuTrigger disableButtonEnhancement>
                <Button className={s.touchBtn} appearance="transparent" size="small" icon={<MoreHorizontal16Regular />} aria-label={`Actions for ${x.title}`} />
              </MenuTrigger>
              <MenuPopover>
                <MenuList>
                  <MenuItem icon={<Rename16Regular />} onClick={() => setRenaming(x)}>
                    Rename
                  </MenuItem>
                  <MenuItem icon={<Delete16Regular />} onClick={() => setDeleting(x)}>
                    Delete
                  </MenuItem>
                </MenuList>
              </MenuPopover>
            </Menu>
          </li>
        ))}
      </ul>
      <div className={s.foot}>
        <AccountMenu account={p.account} collapsed={false} busy={p.signingOut} onSettings={p.onSettings} onSignOut={p.onSignOut} />
      </div>
      {renaming && <RenameDialog session={renaming} onClose={() => setRenaming(null)} onDone={p.onRenamed} />}
      {deleting && <DeleteDialog session={deleting} onClose={() => setDeleting(null)} onDone={() => p.onDeleted(deleting.id)} />}
    </nav>
  );
}

function RenameDialog({ session, onClose, onDone }: { session: SessionSummary; onClose: () => void; onDone: (s: SessionSummary) => void }) {
  const [title, setTitle] = useState(session.title);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      onDone(await send<SessionSummary>("PATCH", `/api/sessions/${session.id}`, { title }));
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
            <DialogTitle>Rename chat</DialogTitle>
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

function DeleteDialog({ session, onClose, onDone }: { session: SessionSummary; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    try {
      await send("DELETE", `/api/sessions/${session.id}`);
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
            This removes the chat, its history and its workspace (including any local commits in it). Nothing was pushed from it.
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
