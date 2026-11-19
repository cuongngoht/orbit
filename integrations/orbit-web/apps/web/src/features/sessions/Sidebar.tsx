// The left side: a new chat, the recent sessions with their status, and rename / delete.
import {
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
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  MessageBar,
  MessageBarBody,
  Text,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { Add20Regular, Delete20Regular, MoreHorizontal20Regular, Rename20Regular } from "@fluentui/react-icons";
import type { SessionSummary } from "@orbit-web/contracts";
import { useState } from "react";
import { SessionStatusBadge } from "../../components/StatusBadge";
import { errorText, send } from "../../services/api";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: "8px", padding: "12px", height: "100%", boxSizing: "border-box", overflowY: "auto" },
  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: "4px",
    padding: "8px",
    borderRadius: tokens.borderRadiusMedium,
    cursor: "pointer",
    ":hover": { backgroundColor: tokens.colorNeutralBackground1Hover },
  },
  selected: { backgroundColor: tokens.colorNeutralBackground1Selected },
  text: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flexGrow: 1 },
  title: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  repo: { color: tokens.colorNeutralForeground3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  heading: { color: tokens.colorNeutralForeground3, marginTop: "8px" },
});

export function Sidebar(p: { sessions: SessionSummary[]; selected: string | null; onSelect: (id: string | null) => void; onChanged: () => void }) {
  const s = useStyles();
  const [renaming, setRenaming] = useState<SessionSummary | null>(null);
  const [deleting, setDeleting] = useState<SessionSummary | null>(null);
  return (
    <nav className={s.root} aria-label="Sessions">
      <Button appearance="primary" icon={<Add20Regular />} onClick={() => p.onSelect(null)}>
        New chat
      </Button>
      <Text size={200} weight="semibold" className={s.heading}>
        Recent sessions
      </Text>
      {p.sessions.length === 0 && <Text size={200}>No chats yet.</Text>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {p.sessions.map((session) => (
          <li key={session.id}>
            <div
              className={mergeClasses(s.item, p.selected === session.id && s.selected)}
              role="button"
              tabIndex={0}
              aria-current={p.selected === session.id ? "page" : undefined}
              onClick={() => p.onSelect(session.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") p.onSelect(session.id);
              }}
            >
              <div className={s.text}>
                <Text className={s.title} weight={p.selected === session.id ? "semibold" : "regular"}>
                  {session.title}
                </Text>
                <Text size={200} className={s.repo}>
                  {session.repository} · {session.branch}
                </Text>
                <div>
                  <SessionStatusBadge status={session.status} />
                </div>
              </div>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button appearance="subtle" size="small" icon={<MoreHorizontal20Regular />} aria-label={`Actions for ${session.title}`} onClick={(e) => e.stopPropagation()} />
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem icon={<Rename20Regular />} onClick={() => setRenaming(session)}>
                      Rename
                    </MenuItem>
                    <MenuItem icon={<Delete20Regular />} onClick={() => setDeleting(session)}>
                      Delete
                    </MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            </div>
          </li>
        ))}
      </ul>
      {renaming && <RenameDialog session={renaming} onClose={() => setRenaming(null)} onDone={p.onChanged} />}
      {deleting && (
        <DeleteDialog
          session={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            if (p.selected === deleting.id) p.onSelect(null);
            p.onChanged();
          }}
        />
      )}
    </nav>
  );
}

function RenameDialog({ session, onClose, onDone }: { session: SessionSummary; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(session.title);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      await send("PATCH", `/api/sessions/${session.id}`, { title });
      onDone();
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
