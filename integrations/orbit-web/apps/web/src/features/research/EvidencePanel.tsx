// EVIDENCE beside the research chat: the CITATIONS of the answer chosen (each one a passage the server verified, opening
// at its place in the source), the workspace's NOTES, and its FINDINGS with their review status -- and, when one is
// opened, a source's text. A finding marked reviewed is a reviewed research conclusion, not an approved policy.
import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  Spinner,
  Tab,
  TabList,
  Text,
  Textarea,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import { BookOpen20Regular, ChevronRight16Regular, Delete16Regular, Dismiss20Regular, Edit16Regular, Lightbulb20Regular, NoteAdd20Regular } from "@fluentui/react-icons";
import { FINDING_MOVES, FINDING_STATUS_LABELS, RESEARCH_LIMITS, type FindingStatus, type ResearchCitation, type ResearchFinding, type ResearchNote } from "@orbit-web/contracts";
import { useState, type ReactNode } from "react";
import { Markdown } from "../../components/Markdown";
import { useViewport } from "../../hooks/useViewport";
import { useI18n, type MessageKey } from "../../i18n";
import { errorText } from "../../services/api";
import { research } from "./api";
import { placeOf, when } from "./labels";
import { SourcePreview, type PreviewTarget } from "./SourcePreview";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", minWidth: 0, maxWidth: "100%", minHeight: 0, height: "100%", overflow: "hidden", backgroundColor: tokens.colorNeutralBackground1 },
  drawerBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "8px",
    paddingTop: "10px",
    paddingRight: "10px",
    paddingBottom: "4px",
    paddingLeft: "16px",
    flexShrink: 0,
  },
  drawerTitle: { fontSize: "15px", letterSpacing: "-0.01em" },
  closeBtn: { borderRadius: "10px" },
  touchBtn: { minWidth: "44px", minHeight: "44px" },
  tabs: {
    flexShrink: 0,
    paddingTop: "8px",
    paddingRight: "12px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
  },
  tabsDrawer: { paddingTop: "4px" },
  tabList: {
    width: "100%",
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: "2px",
    paddingTop: "3px",
    paddingRight: "3px",
    paddingBottom: "3px",
    paddingLeft: "3px",
    borderRadius: "12px",
    backgroundColor: tokens.colorNeutralBackground3,
    "& [role='tab']": {
      justifyContent: "center",
      borderRadius: "9px",
      minHeight: "32px",
      paddingTop: "4px",
      paddingRight: "6px",
      paddingBottom: "4px",
      paddingLeft: "6px",
      fontSize: tokens.fontSizeBase200,
    },
    "& [role='tab']::after": { display: "none" },
    "& .fui-Tab__indicator": { display: "none" },
    "& [role='tab'][aria-selected='true']": {
      backgroundColor: "var(--orbit-card-bg)",
      boxShadow: "var(--orbit-soft-shadow)",
      color: tokens.colorNeutralForeground1,
      fontWeight: tokens.fontWeightSemibold,
    },
  },
  body: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    paddingTop: "12px",
    paddingRight: "12px",
    paddingBottom: "max(16px, var(--orbit-safe-bottom, env(safe-area-inset-bottom)))",
    paddingLeft: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    borderRadius: "14px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: "var(--orbit-card-bg)",
    boxShadow: "var(--orbit-soft-shadow)",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
    minWidth: 0,
  },
  cardButton: {
    width: "100%",
    textAlign: "left",
    cursor: "pointer",
    color: tokens.colorNeutralForeground1,
    transitionProperty: "background-color, border-color",
    transitionDuration: "140ms",
    ":hover": {
      backgroundColor: tokens.colorSubtleBackgroundHover,
      ...shorthands.borderColor(tokens.colorBrandStroke2),
    },
  },
  line: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0, flexWrap: "nowrap" },
  grow: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  badge: { flexShrink: 0, whiteSpace: "nowrap" },
  codeBadge: { flexShrink: 0, whiteSpace: "nowrap", fontFamily: tokens.fontFamilyMonospace },
  chevron: { flexShrink: 0, color: tokens.colorNeutralForeground3 },
  quoteBox: {
    backgroundColor: "var(--orbit-tool-bg)",
    borderRadius: "0 8px 8px 0",
    boxShadow: `inset 2.5px 0 0 ${tokens.colorBrandStroke2}`,
    paddingTop: "8px",
    paddingRight: "10px",
    paddingBottom: "8px",
    paddingLeft: "10px",
  },
  quoteText: {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    display: "-webkit-box",
    WebkitLineClamp: 4,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
    lineHeight: "1.55",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  emptyBox: {
    borderRadius: "14px",
    ...shorthands.border("1px", "dashed", tokens.colorNeutralStroke1),
    backgroundColor: "var(--orbit-tool-bg)",
    paddingTop: "22px",
    paddingRight: "16px",
    paddingBottom: "22px",
    paddingLeft: "16px",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
  },
  emptyIcon: {
    width: "36px",
    height: "36px",
    borderRadius: "10px",
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  noticeBox: {
    borderRadius: "12px",
    backgroundColor: "var(--orbit-tool-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    paddingTop: "10px",
    paddingRight: "12px",
    paddingBottom: "10px",
    paddingLeft: "12px",
    color: tokens.colorNeutralForeground3,
    lineHeight: "1.45",
  },
  topAction: { alignSelf: "flex-start", borderRadius: "10px" },
  citeJump: { alignSelf: "flex-start", borderRadius: "9999px" },
  form: { display: "flex", flexDirection: "column", gap: "10px" },
  field: { minWidth: 0, width: "100%", maxWidth: "100%" },
  input: { minWidth: 0, width: "100%", maxWidth: "100%" },
  actions: { display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" },
  pillBtn: { borderRadius: "9999px" },
});

export type EvidenceTab = "citations" | "notes" | "findings";

export interface NoteDraft {
  title: string;
  body: string;
  citationId?: string;
  sourceId?: string;
}

export interface FindingDraft {
  title: string;
  statement: string;
  citations: string[];
}

export interface EvidencePanelProps {
  workspaceId: string;
  sessionId: string;
  tab: EvidenceTab;
  onTab: (tab: EvidenceTab) => void;
  // The citations of the answer chosen (null: no answer has any yet).
  citations: ResearchCitation[] | null;
  showingEarlier?: boolean;
  onShowLatest?: () => void;
  notes: ResearchNote[] | null;
  findings: ResearchFinding[] | null;
  preview: PreviewTarget | null;
  onPreview: (target: PreviewTarget | null) => void;
  noteDraft: NoteDraft | null;
  findingDraft: FindingDraft | null;
  onDrafted: () => void;
  // Something was written: the notes and findings are read again.
  onChanged: () => void;
  onClose?: () => void;
  onNewNote?: () => void;
}

export const previewOf = (c: ResearchCitation): PreviewTarget => ({ sourceId: c.sourceId, revisionId: c.revisionId, chunkOrdinal: c.chunkOrdinal, title: c.sourceTitle, quote: c.quote });

export function EvidencePanel(p: EvidencePanelProps) {
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile, isCoarse } = useViewport();
  const touch = isMobile || isCoarse;
  return (
    <section className={s.root} aria-label={t("research.evidence.aria")}>
      {p.onClose && (
        <div className={s.drawerBar}>
          <Text weight="semibold" className={s.drawerTitle}>
            {t("research.evidence.title")}
          </Text>
          <Button
            className={mergeClasses(s.closeBtn, touch && s.touchBtn)}
            appearance="subtle"
            size="small"
            icon={<Dismiss20Regular />}
            aria-label={t("research.evidence.closeAria")}
            onClick={p.onClose}
          />
        </div>
      )}
      <div className={mergeClasses(s.tabs, Boolean(p.onClose) && s.tabsDrawer)}>
        <TabList className={s.tabList} size="small" selectedValue={p.tab} onTabSelect={(_, d) => (p.onPreview(null), p.onTab(d.value as EvidenceTab))}>
          <Tab value="citations">{t("research.evidence.tabCitations")}</Tab>
          <Tab value="notes">{t("research.evidence.tabNotes", { count: p.notes && p.notes.length > 0 ? ` (${p.notes.length})` : "" })}</Tab>
          <Tab value="findings">{t("research.evidence.tabFindings", { count: p.findings && p.findings.length > 0 ? ` (${p.findings.length})` : "" })}</Tab>
        </TabList>
      </div>
      <div className={s.body}>
        {p.preview !== null ? (
          <SourcePreview key={`${p.preview.sourceId}-${p.preview.revisionId ?? ""}-${p.preview.chunkOrdinal ?? ""}`} target={p.preview} onBack={() => p.onPreview(null)} />
        ) : p.tab === "citations" ? (
          <Citations citations={p.citations} showingEarlier={p.showingEarlier} onShowLatest={p.onShowLatest} onOpen={(c) => p.onPreview(previewOf(c))} />
        ) : p.tab === "notes" ? (
          <Notes {...p} />
        ) : (
          <Findings {...p} />
        )}
      </div>
    </section>
  );
}

function EmptyState({ icon, message }: { icon: ReactNode; message: string }) {
  const s = useStyles();
  return (
    <div className={s.emptyBox}>
      <span className={s.emptyIcon} aria-hidden>
        {icon}
      </span>
      <Text size={200} className={s.muted}>
        {message}
      </Text>
    </div>
  );
}

function Citations({ citations, showingEarlier, onShowLatest, onOpen }: { citations: ResearchCitation[] | null; showingEarlier?: boolean; onShowLatest?: () => void; onOpen: (c: ResearchCitation) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  if (citations === null || citations.length === 0)
    return (
      <EmptyState
        icon={<BookOpen20Regular />}
        message={t(citations === null ? "research.evidence.citationsEmptyAsk" : "research.evidence.citationsEmptyNone")}
      />
    );
  return (
    <>
      {showingEarlier && onShowLatest && (
        <MessageBar intent="info">
          <MessageBarBody>{t("research.evidence.showingEarlierCitations")}</MessageBarBody>
          <MessageBarActions>
            <Button size="small" onClick={onShowLatest}>
              {t("research.evidence.showLatestCitations")}
            </Button>
          </MessageBarActions>
        </MessageBar>
      )}
      {citations.map((c) => (
        <button key={c.id} type="button" className={mergeClasses(s.card, s.cardButton)} onClick={() => onOpen(c)} aria-label={t("research.evidence.openCitationAria", { label: c.label, title: c.sourceTitle })}>
          <span className={s.line}>
            <Badge className={s.badge} appearance="filled" color="brand" size="small">
              {c.label}
            </Badge>
            <Text weight="semibold" className={s.grow}>
              {c.sourceTitle}
            </Text>
            {!c.sourceAvailable && (
              <Badge className={s.badge} appearance="tint" color="warning" size="small">
                {t("research.evidence.deletedBadge")}
              </Badge>
            )}
            {c.sourceAvailable && !c.revisionCurrent && (
              <Badge className={s.badge} appearance="tint" color="informative" size="small">
                {t("research.evidence.olderRevBadge")}
              </Badge>
            )}
            <ChevronRight16Regular className={s.chevron} aria-hidden />
          </span>
          <Text size={100} className={s.muted}>
            {placeOf(c) || "—"} · {t(c.match === "fts" ? "research.evidence.matchFts" : "research.evidence.matchOpening")}
          </Text>
          <span className={s.quoteBox}>
            <span className={s.quoteText}>{c.quote}</span>
          </span>
        </button>
      ))}
    </>
  );
}

function DeleteEvidenceDialog({
  title,
  body,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog open onOpenChange={(_, d) => !d.open && !busy && onCancel()}>
      <DialogSurface className="orbit-touch" style={{ width: "min(440px, 92vw)", maxWidth: "min(440px, 92vw)" }}>
        <DialogBody>
          <DialogTitle
            action={<Button appearance="subtle" size="small" aria-label={t("research.addSources.closeAria")} icon={<Dismiss20Regular />} onClick={onCancel} />}
          >
            {title}
          </DialogTitle>
          <DialogContent>
            <Text>{body}</Text>
            {error && (
              <MessageBar intent="error" style={{ marginTop: "8px" }}>
                <MessageBarBody>{error}</MessageBarBody>
              </MessageBar>
            )}
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={onCancel}>
              {t("research.evidence.cancel")}
            </Button>
            <Button appearance="primary" disabled={busy} style={{ backgroundColor: tokens.colorPaletteRedBackground3, color: tokens.colorNeutralForegroundOnBrand }} onClick={onConfirm}>
              {t("research.sources.delete")}
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

function Notes(p: EvidencePanelProps) {
  const { t } = useI18n();
  const s = useStyles();
  const [editing, setEditing] = useState<ResearchNote | null>(null);
  const [deleting, setDeleting] = useState<ResearchNote | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const draft = p.noteDraft;
  const confirmDelete = () => {
    if (deleting === null) return;
    setDeleteBusy(true);
    setDeleteError(null);
    void research
      .deleteNote(deleting.id)
      .then(
        () => {
          setDeleting(null);
          p.onChanged();
        },
        (err: unknown) => setDeleteError(errorText(err)),
      )
      .finally(() => setDeleteBusy(false));
  };
  return (
    <>
      {p.onNewNote && draft === null && editing === null && (
        <Button className={s.topAction} appearance="secondary" size="small" icon={<NoteAdd20Regular />} onClick={p.onNewNote}>
          {t("research.evidence.writeNote")}
        </Button>
      )}
      {(draft !== null || editing !== null) && (
        <NoteForm
          key={editing?.id ?? "new"}
          workspaceId={p.workspaceId}
          sessionId={p.sessionId}
          note={editing}
          draft={draft}
          onDone={() => {
            setEditing(null);
            p.onDrafted();
            p.onChanged();
          }}
        />
      )}
      {p.notes === null ? (
        <Spinner size="tiny" />
      ) : p.notes.length === 0 && draft === null ? (
        <EmptyState icon={<NoteAdd20Regular />} message={t("research.evidence.notesEmpty")} />
      ) : (
        p.notes.map((n) => (
          <article key={n.id} className={s.card} aria-label={t("research.evidence.noteArticleAria", { title: n.title })}>
            <div className={s.line}>
              <Text weight="semibold" className={s.grow}>
                {n.title}
              </Text>
              <Button appearance="subtle" size="small" icon={<Edit16Regular />} aria-label={t("research.evidence.editAria", { title: n.title })} onClick={() => setEditing(n)} />
              <Button
                appearance="subtle"
                size="small"
                icon={<Delete16Regular />}
                aria-label={t("research.evidence.deleteAria", { title: n.title })}
                onClick={() => {
                  setDeleteError(null);
                  setDeleting(n);
                }}
              />
            </div>
            <Markdown text={n.body} />
            {n.citation && (
              <Button className={s.citeJump} appearance="outline" size="small" onClick={() => p.onPreview(previewOf(n.citation as ResearchCitation))}>
                {n.citation.label} · {n.citation.sourceTitle} {placeOf(n.citation) && `(${placeOf(n.citation)})`}
              </Button>
            )}
            <Text size={100} className={s.muted}>
              {n.createdBy} · {when(n.updatedAt)}
            </Text>
          </article>
        ))
      )}
      {deleting && (
        <DeleteEvidenceDialog
          title={t("research.evidence.confirmDeleteNoteTitle", { title: deleting.title })}
          body={t("research.evidence.confirmDeleteNoteBody")}
          busy={deleteBusy}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function NoteForm({ workspaceId, sessionId, note, draft, onDone }: { workspaceId: string; sessionId: string; note: ResearchNote | null; draft: NoteDraft | null; onDone: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const [title, setTitle] = useState(note?.title ?? draft?.title ?? "");
  const [body, setBody] = useState(note?.body ?? draft?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (note !== null) await research.updateNote(note.id, { title, body });
      else await research.createNote(workspaceId, { title, body, sessionId, ...(draft?.citationId ? { citationId: draft.citationId } : {}), ...(draft?.sourceId ? { sourceId: draft.sourceId } : {}) });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={mergeClasses(s.card, s.form)}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      aria-label={t(note ? "research.evidence.editNoteAria" : "research.evidence.newNoteAria")}
    >
      <Field className={s.field} label={t("research.addSources.titleRequired")}>
        <Input className={s.input} value={title} onChange={(_, d) => setTitle(d.value)} maxLength={RESEARCH_LIMITS.titleLength} autoFocus />
      </Field>
      <Field className={s.field} label={t("research.evidence.noteMarkdownLabel")}>
        <Textarea className={s.input} value={body} onChange={(_, d) => setBody(d.value)} rows={6} resize="vertical" maxLength={RESEARCH_LIMITS.noteBodyLength} />
      </Field>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.actions}>
        <Button appearance="primary" type="submit" disabled={busy || title.trim() === "" || body.trim() === ""}>
          {busy ? t("research.evidence.saving") : t("research.evidence.saveNote")}
        </Button>
        <Button disabled={busy} onClick={onDone}>{t("research.evidence.cancel")}</Button>
      </div>
    </form>
  );
}

const STATUS_COLOR: Record<FindingStatus, "informative" | "warning" | "success" | "danger"> = { draft: "informative", needs_review: "warning", reviewed: "success", rejected: "danger" };

const MOVE_LABEL_KEYS: Record<FindingStatus, MessageKey> = {
  draft: "research.evidence.move.draft",
  needs_review: "research.evidence.move.needs_review",
  reviewed: "research.evidence.move.reviewed",
  rejected: "research.evidence.move.rejected",
};

function Findings(p: EvidencePanelProps) {
  const { t } = useI18n();
  const s = useStyles();
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [editing, setEditing] = useState<ResearchFinding | null>(null);
  const [deleting, setDeleting] = useState<ResearchFinding | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const move = async (f: ResearchFinding, status: FindingStatus) => {
    setError(null);
    try {
      await research.updateFinding(f.id, { status });
      p.onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  };
  const confirmDelete = () => {
    if (deleting === null) return;
    setDeleteBusy(true);
    setDeleteError(null);
    void research
      .deleteFinding(deleting.id)
      .then(
        () => {
          setDeleting(null);
          p.onChanged();
        },
        (err: unknown) => setDeleteError(errorText(err)),
      )
      .finally(() => setDeleteBusy(false));
  };
  const showingForm = p.findingDraft !== null || writing || editing !== null;
  return (
    <>
      <div className={s.noticeBox}>
        <Text size={200}>
          {t("research.evidence.findingDisclaimer")}
        </Text>
      </div>
      {!showingForm && (
        <Button className={s.topAction} appearance="secondary" size="small" icon={<Lightbulb20Regular />} onClick={() => setWriting(true)}>
          {t("research.evidence.writeFinding")}
        </Button>
      )}
      {showingForm && (
        <FindingForm
          key={editing?.id ?? (p.findingDraft ? "draft" : "blank")}
          workspaceId={p.workspaceId}
          sessionId={p.sessionId}
          finding={editing}
          draft={p.findingDraft ?? { title: "", statement: "", citations: [] }}
          onDone={() => {
            setWriting(false);
            setEditing(null);
            p.onDrafted();
            p.onChanged();
          }}
        />
      )}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {p.findings === null ? (
        <Spinner size="tiny" />
      ) : p.findings.length === 0 && !showingForm ? (
        <EmptyState icon={<Lightbulb20Regular />} message={t("research.evidence.findingsEmpty")} />
      ) : (
        p.findings.map((f) => (
          <article key={f.id} className={s.card} aria-label={t("research.evidence.findingArticleAria", { code: f.code })}>
            <div className={s.line}>
              <Badge className={s.codeBadge} appearance="outline" size="small">
                {f.code}
              </Badge>
              <Text weight="semibold" className={s.grow}>
                {f.title}
              </Text>
              <Badge className={s.badge} appearance="tint" color={STATUS_COLOR[f.status]} size="small">
                {FINDING_STATUS_LABELS[f.status]}
              </Badge>
            </div>
            <Markdown text={f.statement} />
            {f.citations.length > 0 && (
              <div className={s.actions}>
                {f.citations.map((c) => (
                  <Button key={c.id} className={s.pillBtn} appearance="outline" size="small" onClick={() => p.onPreview(previewOf(c))}>
                    {c.label} · {c.sourceTitle}
                  </Button>
                ))}
              </div>
            )}
            <div className={s.actions}>
              {FINDING_MOVES[f.status].map((to) => (
                <Button key={to} size="small" appearance={to === "reviewed" ? "primary" : "secondary"} onClick={() => void move(f, to)}>
                  {t(MOVE_LABEL_KEYS[to])}
                </Button>
              ))}
              {f.status === "draft" && (
                <Button size="small" appearance="subtle" icon={<Edit16Regular />} aria-label={t("research.evidence.editFindingAria")} onClick={() => setEditing(f)} />
              )}
              <Button
                size="small"
                appearance="subtle"
                icon={<Delete16Regular />}
                aria-label={t("research.evidence.deleteAria", { title: f.code })}
                onClick={() => {
                  setDeleteError(null);
                  setDeleting(f);
                }}
              />
            </div>
            <Text size={100} className={s.muted}>
              {f.reviewedBy
                ? t("research.evidence.findingReviewedMeta", {
                    status: FINDING_STATUS_LABELS[f.status],
                    by: f.reviewedBy,
                    at: f.reviewedAt ? ` · ${when(f.reviewedAt)}` : "",
                  })
                : t("research.evidence.findingWrittenMeta", { by: f.createdBy, at: when(f.updatedAt) })}
            </Text>
          </article>
        ))
      )}
      {deleting && (
        <DeleteEvidenceDialog
          title={t("research.evidence.confirmDeleteFindingTitle", { code: deleting.code })}
          body={t("research.evidence.confirmDeleteFindingBody")}
          busy={deleteBusy}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </>
  );
}

function FindingForm({ workspaceId, sessionId, finding, draft, onDone }: { workspaceId: string; sessionId: string; finding: ResearchFinding | null; draft: FindingDraft; onDone: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const [title, setTitle] = useState(finding?.title ?? draft.title);
  const [statement, setStatement] = useState(finding?.statement ?? draft.statement);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (finding !== null) await research.updateFinding(finding.id, { title, statement });
      else await research.createFinding(workspaceId, { title, statement, sessionId, citations: draft.citations });
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className={mergeClasses(s.card, s.form)}
      aria-label={t("research.evidence.newFindingAria")}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Field className={s.field} label={t("research.evidence.findingLabel")}>
        <Input className={s.input} value={title} onChange={(_, d) => setTitle(d.value)} maxLength={RESEARCH_LIMITS.titleLength} autoFocus />
      </Field>
      <Field
        className={s.field}
        label={t("research.evidence.statementLabel")}
        hint={
          finding !== null
            ? undefined
            : draft.citations.length > 0
              ? t("research.evidence.restsOnCitations", { count: draft.citations.length, plural: draft.citations.length === 1 ? "" : "s" })
              : t("research.evidence.restsOnNothing")
        }
      >
        <Textarea className={s.input} value={statement} onChange={(_, d) => setStatement(d.value)} rows={5} resize="vertical" maxLength={RESEARCH_LIMITS.findingStatementLength} />
      </Field>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.actions}>
        <Button appearance="primary" type="submit" disabled={busy || title.trim() === "" || statement.trim() === ""}>
          {busy ? t("research.evidence.saving") : finding !== null ? t("research.evidence.saveFinding") : t("research.evidence.saveAsDraft")}
        </Button>
        <Button disabled={busy} onClick={onDone}>{t("research.evidence.cancel")}</Button>
      </div>
    </form>
  );
}
