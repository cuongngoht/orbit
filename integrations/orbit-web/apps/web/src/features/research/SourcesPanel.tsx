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
  DialogTrigger,
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
  shorthands,
  tokens,
} from "@fluentui/react-components";
import { Add20Regular, ArrowClockwise16Regular, ArrowSync16Regular, Delete16Regular, Dismiss20Regular, DocumentSearch20Regular, DocumentText20Regular, MoreHorizontal16Regular, NoteAdd20Regular, Rename16Regular, ShieldCheckmark16Regular } from "@fluentui/react-icons";
import type { ResearchSourceSummary } from "@orbit-web/contracts";
import { useMemo, useState } from "react";
import { useViewport } from "../../hooks/useViewport";
import { errorText } from "../../services/api";
import { research } from "./api";
import { searchable, SourceIcon, SourceState, when } from "./labels";

const FORMAT_CHIPS = ["PDF", "DOCX", "MD", "TXT", "URL"] as const;

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    maxWidth: "100%",
    minHeight: 0,
    height: "100%",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    paddingTop: "12px",
    paddingRight: "12px",
    paddingBottom: "8px",
    paddingLeft: "14px",
    flexShrink: 0,
  },
  title: { flexGrow: 1, minWidth: 0, fontSize: "14px", letterSpacing: "-0.01em" },
  iconBtn: {
    minWidth: "32px",
    minHeight: "32px",
    width: "32px",
    height: "32px",
    borderRadius: "8px",
    flexShrink: 0,
  },
  iconBtnTouch: {
    minWidth: "44px",
    minHeight: "44px",
    width: "44px",
    height: "44px",
    borderRadius: "10px",
  },
  addBtn: { minHeight: "30px", borderRadius: "10px", flexShrink: 0 },
  addBtnTouch: { minHeight: "40px", borderRadius: "10px" },
  tools: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    paddingTop: 0,
    paddingRight: "12px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    flexShrink: 0,
  },
  searchBox: { width: "100%", minWidth: 0 },
  selectAll: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    backgroundColor: "var(--orbit-tool-bg)",
    borderRadius: "10px",
    paddingTop: "3px",
    paddingRight: "10px",
    paddingBottom: "3px",
    paddingLeft: "4px",
    color: tokens.colorNeutralForeground2,
  },
  inUseCount: {
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    flexShrink: 0,
    color: tokens.colorNeutralForeground3,
  },
  list: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
    listStyleType: "none",
    marginTop: 0,
    marginBottom: 0,
    paddingTop: "2px",
    paddingRight: "10px",
    paddingBottom: "10px",
    paddingLeft: "10px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    minWidth: 0,
    borderRadius: "12px",
    ...shorthands.border("1px", "solid", "transparent"),
    paddingTop: "4px",
    paddingRight: "4px",
    paddingBottom: "4px",
    paddingLeft: "4px",
    transitionProperty: "background-color, border-color, box-shadow",
    transitionDuration: "140ms",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
    "@media (hover: hover) and (pointer: fine)": {
      "& [data-row-actions]": { opacity: 0, transitionProperty: "opacity", transitionDuration: "140ms" },
      "&:hover [data-row-actions], &:focus-within [data-row-actions]": { opacity: 1 },
    },
  },
  rowSelected: {
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.borderColor(tokens.colorNeutralStroke2),
    boxShadow: "0 1px 2px rgba(28, 25, 23, 0.04)",
  },
  rowFailed: {
    ...shorthands.borderColor(tokens.colorPaletteRedBorder1),
  },
  open: {
    flexGrow: 1,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: "9px",
    ...shorthands.border("0"),
    backgroundColor: "transparent",
    color: tokens.colorNeutralForeground1,
    cursor: "pointer",
    textAlign: "left",
    paddingTop: "6px",
    paddingBottom: "6px",
    paddingLeft: 0,
    paddingRight: 0,
    "@media (pointer: coarse)": { minHeight: "44px" },
  },
  openMuted: { opacity: 0.78 },
  name: { display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flexGrow: 1 },
  titleRow: { fontSize: tokens.fontSizeBase300, fontWeight: tokens.fontWeightMedium, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  muted: { color: tokens.colorNeutralForeground3 },
  loadingWrap: {
    flexGrow: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: "24px",
    paddingBottom: "24px",
  },
  emptyWrap: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    paddingTop: "16px",
    paddingRight: "14px",
    paddingBottom: "16px",
    paddingLeft: "14px",
  },
  emptyCard: {
    borderRadius: "16px",
    ...shorthands.border("1px", "dashed", tokens.colorNeutralStroke1),
    backgroundColor: "var(--orbit-tool-bg)",
    paddingTop: "24px",
    paddingRight: "16px",
    paddingBottom: "22px",
    paddingLeft: "16px",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "10px",
  },
  emptyEmblem: {
    width: "40px",
    height: "40px",
    borderRadius: "12px",
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  formatRow: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "4px",
    marginTop: "2px",
  },
  formatChip: {
    fontSize: "10px",
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: "0.04em",
    color: tokens.colorNeutralForeground3,
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: "6px",
    paddingTop: "2px",
    paddingRight: "6px",
    paddingBottom: "2px",
    paddingLeft: "6px",
  },
  emptyCta: { marginTop: "4px", borderRadius: "10px", minHeight: "36px" },
  emptyCtaTouch: { minHeight: "42px" },
  emptyFilter: {
    paddingTop: "28px",
    paddingRight: "16px",
    paddingBottom: "28px",
    paddingLeft: "16px",
    textAlign: "center",
    color: tokens.colorNeutralForeground3,
  },
  privacy: {
    marginTop: "auto",
    display: "flex",
    gap: "8px",
    alignItems: "flex-start",
    paddingTop: "10px",
    paddingRight: "14px",
    paddingBottom: "max(12px, var(--orbit-safe-bottom, env(safe-area-inset-bottom)))",
    paddingLeft: "14px",
    backgroundColor: "var(--orbit-tool-bg)",
    ...shorthands.borderTop("1px", "solid", tokens.colorNeutralStroke2),
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
  privacyIcon: { flexShrink: 0, marginTop: "1px", color: tokens.colorNeutralForeground3 },
  touch: { "@media (pointer: coarse)": { minWidth: "44px", minHeight: "44px" } },
  dialogSurface: {
    borderRadius: "20px",
    backgroundColor: "var(--orbit-card-bg)",
    width: "min(440px, 92vw)",
    maxWidth: "min(440px, 92vw)",
  },
  dialogField: { minWidth: 0, width: "100%", maxWidth: "100%" },
  dialogInput: { minWidth: 0, width: "100%", maxWidth: "100%" },
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
  const { isMobile, isCoarse } = useViewport();
  const touch = isMobile || isCoarse;
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
  const inUse = p.selection.filter((id) => sources.some((x) => x.id === id && searchable(x))).length;
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
          <Button
            className={mergeClasses(s.iconBtn, touch && s.iconBtnTouch)}
            appearance={searching ? "secondary" : "subtle"}
            size="small"
            icon={<DocumentSearch20Regular />}
            onClick={() => setSearching((v) => !v)}
            aria-pressed={searching}
          />
        </Tooltip>
        <Tooltip content="New note" relationship="label">
          <Button
            className={mergeClasses(s.iconBtn, touch && s.iconBtnTouch)}
            appearance="subtle"
            size="small"
            icon={<NoteAdd20Regular />}
            onClick={p.onNewNote}
          />
        </Tooltip>
        <Button
          className={mergeClasses(s.addBtn, touch && s.addBtnTouch)}
          appearance={sources.length === 0 ? "secondary" : "primary"}
          size="small"
          icon={<Add20Regular />}
          onClick={p.onAdd}
          disabled={p.disabled}
        >
          Add
        </Button>
      </div>
      {(searching || sources.length > 0 || error !== null || p.error !== null) && (
        <div className={s.tools}>
          {searching && <SearchBox className={s.searchBox} size={isMobile ? "medium" : "small"} autoFocus placeholder="Search sources" aria-label="Search sources" value={query} onChange={(_, d) => setQuery(d.value)} />}
          {sources.length > 0 && (
            <div className={s.selectAll}>
              <Checkbox
                checked={all ? true : some ? "mixed" : false}
                onChange={(_, d) => p.onSelect(d.checked === true ? sources.map((x) => x.id) : [])}
                label={all ? "Deselect all" : "Select all"}
                disabled={p.disabled}
              />
              <Text size={200} className={s.inUseCount}>
                {inUse} in use
              </Text>
            </div>
          )}
          {(error ?? p.error) && (
            <MessageBar intent="error">
              <MessageBarBody>{error ?? p.error}</MessageBarBody>
            </MessageBar>
          )}
        </div>
      )}
      {p.sources === null && !p.error ? (
        <div className={s.loadingWrap}>
          <Spinner size="tiny" label="Reading the sources…" />
        </div>
      ) : sources.length === 0 ? (
        <div className={s.emptyWrap}>
          <div className={s.emptyCard}>
            <span className={s.emptyEmblem} aria-hidden>
              <DocumentText20Regular />
            </span>
            <Text weight="semibold">No sources yet.</Text>
            <Text size={200} className={s.muted}>
              Add PDFs, Word documents, text, Markdown or web pages. Questions are answered from the sources you select.
            </Text>
            <div className={s.formatRow} aria-hidden>
              {FORMAT_CHIPS.map((fmt) => (
                <span key={fmt} className={s.formatChip}>
                  {fmt}
                </span>
              ))}
            </div>
            <Button className={mergeClasses(s.emptyCta, touch && s.emptyCtaTouch)} appearance="primary" icon={<Add20Regular />} onClick={p.onAdd} disabled={p.disabled}>
              Add sources
            </Button>
          </div>
        </div>
      ) : (
        <ul className={s.list} aria-label="Sources of this workspace">
          {shown.map((x) => {
            const isSelected = selected.has(x.id);
            return (
              <li key={x.id} className={mergeClasses(s.row, isSelected && s.rowSelected, x.state === "failed" && s.rowFailed)}>
                <Checkbox checked={isSelected} disabled={p.disabled} onChange={(_, d) => toggle(x.id, d.checked === true)} aria-label={`Use ${x.title} in this session`} />
                <button type="button" className={mergeClasses(s.open, !isSelected && s.openMuted)} onClick={() => p.onPreview(x)} title={x.origin ?? x.title} disabled={x.revision === null}>
                  <SourceIcon source={x} />
                  <span className={s.name}>
                    <span className={s.titleRow}>{x.title}</span>
                    <Text size={100} className={mergeClasses(s.muted, s.ellipsis)}>
                      {x.revision?.pages ? `${x.revision.pages} pages · ` : ""}
                      {x.revision?.fetchedAt ? `snapshot ${when(x.revision.fetchedAt)}` : `added ${when(x.createdAt)}`}
                    </Text>
                  </span>
                  <SourceState source={x} />
                </button>
                <Menu>
                  <MenuTrigger disableButtonEnhancement>
                    <Button data-row-actions="" className={mergeClasses(s.iconBtn, touch && s.touch)} appearance="transparent" size="small" icon={<MoreHorizontal16Regular />} aria-label={`Actions for ${x.title}`} />
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
            );
          })}
          {shown.length === 0 && <li className={s.emptyFilter}>No source matches.</li>}
        </ul>
      )}
      <div className={s.privacy}>
        <ShieldCheckmark16Regular className={s.privacyIcon} />
        <Text size={100}>Sources are stored on this Orbit server. The passages a question retrieves are sent to Claude (Anthropic) to answer it.</Text>
      </div>
      {renaming && <RenameSource source={renaming} onClose={() => setRenaming(null)} />}
      {deleting && <DeleteSource source={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}

function RenameSource({ source, onClose }: { source: ResearchSourceSummary; onClose: () => void }) {
  const s = useStyles();
  const [title, setTitle] = useState(source.title);
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={s.dialogSurface}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            research.renameSource(source.id, title).then(onClose, (err: unknown) => setError(errorText(err)));
          }}
        >
          <DialogBody>
            <DialogTitle
              action={
                <DialogTrigger action="close" disableButtonEnhancement>
                  <Button appearance="subtle" size="small" aria-label="Close" icon={<Dismiss20Regular />} onClick={onClose} />
                </DialogTrigger>
              }
            >
              Rename source
            </DialogTitle>
            <DialogContent>
              <Field className={s.dialogField} label="Title" validationMessage={error ?? undefined}>
                <Input className={s.dialogInput} value={title} onChange={(_, d) => setTitle(d.value)} maxLength={200} autoFocus />
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
  const s = useStyles();
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface className={s.dialogSurface}>
        <DialogBody>
          <DialogTitle
            action={
              <DialogTrigger action="close" disableButtonEnhancement>
                <Button appearance="subtle" size="small" aria-label="Close" icon={<Dismiss20Regular />} onClick={onClose} />
              </DialogTrigger>
            }
          >
            Delete “{source.title}”?
          </DialogTitle>
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
