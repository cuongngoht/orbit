// SOURCES of a research workspace, as one session sees them: each source's kind, title and state, and a checkbox that
// says whether THIS session's questions may retrieve from it (kept per session). Adding a source, a note, searching the
// list, selecting all or none; per source: preview its text, rename, try again, refresh a URL, delete.
import {
  Button,
  Checkbox,
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
  SearchBox,
  Spinner,
  Text,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
} from "@fluentui/react-components";
import { Add20Regular, ArrowClockwise16Regular, ArrowSync16Regular, Delete16Regular, DocumentSearch20Regular, MoreHorizontal16Regular, NoteAdd20Regular, Rename16Regular, ShieldCheckmark16Regular } from "@fluentui/react-icons";
import type { ResearchSourceSummary } from "@orbit-web/contracts";
import { useMemo, useState } from "react";
import { errorText } from "../../services/api";
import { research } from "./api";
import { searchable, SourceIcon, SourceState, when } from "./labels";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", minHeight: 0, height: "100%", backgroundColor: tokens.colorNeutralBackground2 },
  head: { display: "flex", alignItems: "center", gap: "4px", paddingTop: "10px", paddingRight: "8px", paddingBottom: "6px", paddingLeft: "12px", flexShrink: 0 },
  title: { flexGrow: 1, minWidth: 0 },
  tools: { display: "flex", flexDirection: "column", gap: "6px", paddingTop: 0, paddingRight: "10px", paddingBottom: "8px", paddingLeft: "10px", flexShrink: 0 },
  selectAll: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", color: tokens.colorNeutralForeground3 },
  list: { flexGrow: 1, minHeight: 0, overflowY: "auto", listStyleType: "none", marginTop: 0, marginBottom: 0, paddingTop: 0, paddingRight: "6px", paddingBottom: "8px", paddingLeft: "6px" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    borderRadius: "10px",
    paddingRight: "2px",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
    "@media (hover: hover) and (pointer: fine)": { "& [data-row-actions]": { opacity: 0 }, "&:hover [data-row-actions], &:focus-within [data-row-actions]": { opacity: 1 } },
  },
  open: { flexGrow: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "8px", border: "none", backgroundColor: "transparent", color: tokens.colorNeutralForeground1, cursor: "pointer", textAlign: "left", paddingTop: "8px", paddingBottom: "8px", paddingLeft: 0, paddingRight: 0, "@media (pointer: coarse)": { minHeight: "44px" } },
  name: { display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1 },
  ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  empty: { paddingTop: "24px", paddingRight: "16px", paddingBottom: "24px", paddingLeft: "16px", textAlign: "center", color: tokens.colorNeutralForeground3, display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" },
  privacy: { display: "flex", gap: "6px", alignItems: "flex-start", paddingTop: "8px", paddingRight: "12px", paddingBottom: "10px", paddingLeft: "12px", borderTop: `1px solid ${tokens.colorNeutralStroke2}`, color: tokens.colorNeutralForeground3, flexShrink: 0 },
  touch: { "@media (pointer: coarse)": { minWidth: "44px", minHeight: "44px" } },
});

export interface SourcesPanelProps {
  sources: ResearchSourceSummary[] | null;
  error: string | null;
  selection: string[];
  onSelect: (ids: string[]) => void;
  onAdd: () => void;
  onNewNote: () => void;
  onPreview: (source: ResearchSourceSummary) => void;
  // The workspace's owner, or whoever added it, may delete a source: the server decides; a refusal is shown.
  disabled?: boolean;
}

export function SourcesPanel(p: SourcesPanelProps) {
  const s = useStyles();
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [renaming, setRenaming] = useState<ResearchSourceSummary | null>(null);
  const [deleting, setDeleting] = useState<ResearchSourceSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sources = useMemo(() => p.sources ?? [], [p.sources]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === "" ? sources : sources.filter((x) => x.title.toLowerCase().includes(q) || (x.origin ?? "").toLowerCase().includes(q));
  }, [sources, query]);
  const selected = new Set(p.selection);
  const all = sources.length > 0 && sources.every((x) => selected.has(x.id));
  const some = sources.some((x) => selected.has(x.id));
  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(errorText(err));
    }
  };
  const toggle = (id: string, on: boolean) => p.onSelect(on ? [...p.selection, id] : p.selection.filter((x) => x !== id));

  return (
    <section className={s.root} aria-label="Sources">
      <div className={s.head}>
        <Text weight="semibold" className={s.title}>
          Sources ({sources.length})
        </Text>
        <Tooltip content="Search the sources" relationship="label">
          <Button className={s.touch} appearance="subtle" size="small" icon={<DocumentSearch20Regular />} onClick={() => setSearching((v) => !v)} aria-pressed={searching} />
        </Tooltip>
        <Tooltip content="New note" relationship="label">
          <Button className={s.touch} appearance="subtle" size="small" icon={<NoteAdd20Regular />} onClick={p.onNewNote} />
        </Tooltip>
        <Button className={s.touch} appearance="primary" size="small" icon={<Add20Regular />} onClick={p.onAdd} disabled={p.disabled}>
          Add
        </Button>
      </div>
      <div className={s.tools}>
        {searching && <SearchBox size="small" autoFocus placeholder="Search sources" aria-label="Search sources" value={query} onChange={(_, d) => setQuery(d.value)} />}
        {sources.length > 0 && (
          <div className={s.selectAll}>
            <Checkbox
              checked={all ? true : some ? "mixed" : false}
              onChange={(_, d) => p.onSelect(d.checked === true ? sources.map((x) => x.id) : [])}
              label={all ? "Deselect all" : "Select all"}
              disabled={p.disabled}
            />
            <Text size={200}>{p.selection.filter((id) => sources.find((x) => x.id === id && searchable(x))).length} in use</Text>
          </div>
        )}
        {(error ?? p.error) && (
          <MessageBar intent="error">
            <MessageBarBody>{error ?? p.error}</MessageBarBody>
          </MessageBar>
        )}
      </div>
      {p.sources === null && !p.error ? (
        <Spinner size="tiny" label="Reading the sources…" />
      ) : sources.length === 0 ? (
        <div className={s.empty}>
          <Text>No sources yet.</Text>
          <Text size={200}>Add PDFs, Word documents, text, Markdown or web pages. Questions are answered from the sources you select.</Text>
          <Button appearance="primary" icon={<Add20Regular />} onClick={p.onAdd}>
            Add sources
          </Button>
        </div>
      ) : (
        <ul className={s.list} aria-label="Sources of this workspace">
          {shown.map((x) => (
            <li key={x.id} className={s.row}>
              <Checkbox checked={selected.has(x.id)} disabled={p.disabled} onChange={(_, d) => toggle(x.id, d.checked === true)} aria-label={`Use ${x.title} in this session`} />
              <button type="button" className={s.open} onClick={() => p.onPreview(x)} title={x.origin ?? x.title} disabled={x.revision === null}>
                <SourceIcon source={x} />
                <span className={s.name}>
                  <span className={s.ellipsis}>{x.title}</span>
                  <Text size={100} className={mergeClasses(s.muted, s.ellipsis)}>
                    {x.revision?.pages ? `${x.revision.pages} pages · ` : ""}
                    {x.revision?.fetchedAt ? `snapshot ${when(x.revision.fetchedAt)}` : `added ${when(x.createdAt)}`}
                  </Text>
                </span>
                <SourceState source={x} />
              </button>
              <Menu>
                <MenuTrigger disableButtonEnhancement>
                  <Button data-row-actions="" className={s.touch} appearance="transparent" size="small" icon={<MoreHorizontal16Regular />} aria-label={`Actions for ${x.title}`} />
                </MenuTrigger>
                <MenuPopover>
                  <MenuList>
                    <MenuItem icon={<DocumentSearch20Regular />} disabled={x.revision === null} onClick={() => p.onPreview(x)}>
                      Preview
                    </MenuItem>
                    <MenuItem icon={<Rename16Regular />} onClick={() => setRenaming(x)}>
                      Rename
                    </MenuItem>
                    {x.state === "failed" && (
                      <MenuItem icon={<ArrowClockwise16Regular />} onClick={() => void act(() => research.retrySource(x.id))}>
                        Try again
                      </MenuItem>
                    )}
                    {x.kind === "url" && x.state !== "queued" && x.state !== "processing" && (
                      <MenuItem icon={<ArrowSync16Regular />} onClick={() => void act(() => research.refreshSource(x.id))}>
                        Fetch again
                      </MenuItem>
                    )}
                    <MenuItem icon={<Delete16Regular />} onClick={() => setDeleting(x)}>
                      Delete
                    </MenuItem>
                  </MenuList>
                </MenuPopover>
              </Menu>
            </li>
          ))}
          {shown.length === 0 && <li className={s.empty}>No source matches.</li>}
        </ul>
      )}
      <div className={s.privacy}>
        <ShieldCheckmark16Regular />
        <Text size={100}>Sources are stored on this Orbit server. The passages a question retrieves are sent to Claude (Anthropic) to answer it.</Text>
      </div>
      {renaming && <RenameSource source={renaming} onClose={() => setRenaming(null)} />}
      {deleting && <DeleteSource source={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}

function RenameSource({ source, onClose }: { source: ResearchSourceSummary; onClose: () => void }) {
  const [title, setTitle] = useState(source.title);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            research.renameSource(source.id, title).then(onClose, (err: unknown) => setError(errorText(err)));
          }}
        >
          <DialogBody>
            <DialogTitle>Rename source</DialogTitle>
            <DialogContent>
              <Field label="Title" validationMessage={error ?? undefined}>
                <Input value={title} onChange={(_, d) => setTitle(d.value)} maxLength={200} autoFocus />
              </Field>
            </DialogContent>
            <DialogActions>
              <Button onClick={onClose}>Cancel</Button>
              <Button appearance="primary" type="submit" disabled={title.trim() === ""}>
                Save
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
}

function DeleteSource({ source, onClose }: { source: ResearchSourceSummary; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>Delete “{source.title}”?</DialogTitle>
          <DialogContent>
            This removes the source, its text and its file from this workspace, for every session of it. Citations that quoted it keep their quote, marked as from a
            deleted source.
            {error && (
              <MessageBar intent="error">
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
            <Button appearance="primary" onClick={() => research.deleteSource(source.id).then(onClose, (err: unknown) => setError(errorText(err)))}>
              Delete
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
