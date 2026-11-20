// EVIDENCE beside the research chat: the CITATIONS of the answer chosen (each one a passage the server verified, opening
// at its place in the source), the workspace's NOTES, and its FINDINGS with their review status -- and, when one is
// opened, a source's text. A finding marked reviewed is a reviewed research conclusion, not an approved policy.
import {
  Badge,
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Tab,
  TabList,
  Text,
  Textarea,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { Delete16Regular, Edit16Regular } from "@fluentui/react-icons";
import { FINDING_MOVES, FINDING_STATUS_LABELS, RESEARCH_LIMITS, type FindingStatus, type ResearchCitation, type ResearchFinding, type ResearchNote } from "@orbit-web/contracts";
import { useState } from "react";
import { Markdown } from "../../components/Markdown";
import { errorText } from "../../services/api";
import { research } from "./api";
import { placeOf, when } from "./labels";
import { SourcePreview, type PreviewTarget } from "./SourcePreview";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", minHeight: 0, height: "100%", backgroundColor: tokens.colorNeutralBackground1 },
  tabs: { flexShrink: 0, paddingTop: "6px", paddingRight: "8px", paddingBottom: "2px", paddingLeft: "8px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  body: { flexGrow: 1, minHeight: 0, overflowY: "auto", paddingTop: "12px", paddingRight: "12px", paddingBottom: "max(16px, env(safe-area-inset-bottom))", paddingLeft: "12px", display: "flex", flexDirection: "column", gap: "10px" },
  card: { display: "flex", flexDirection: "column", gap: "6px", borderRadius: "12px", border: `1px solid ${tokens.colorNeutralStroke2}`, backgroundColor: "var(--orbit-card-bg)", paddingTop: "10px", paddingRight: "12px", paddingBottom: "10px", paddingLeft: "12px", minWidth: 0 },
  cardButton: { textAlign: "left", cursor: "pointer", color: tokens.colorNeutralForeground1, ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover } },
  line: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0, flexWrap: "wrap" },
  grow: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  quote: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 5, WebkitBoxOrient: "vertical", overflow: "hidden", color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200 },
  muted: { color: tokens.colorNeutralForeground3 },
  form: { display: "flex", flexDirection: "column", gap: "8px" },
  actions: { display: "flex", gap: "6px", flexWrap: "wrap" },
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
  notes: ResearchNote[] | null;
  findings: ResearchFinding[] | null;
  preview: PreviewTarget | null;
  onPreview: (target: PreviewTarget | null) => void;
  noteDraft: NoteDraft | null;
  findingDraft: FindingDraft | null;
  onDrafted: () => void;
  // Something was written: the notes and findings are read again.
  onChanged: () => void;
}

export const previewOf = (c: ResearchCitation): PreviewTarget => ({ sourceId: c.sourceId, revisionId: c.revisionId, chunkOrdinal: c.chunkOrdinal, title: c.sourceTitle, quote: c.quote });

export function EvidencePanel(p: EvidencePanelProps) {
  const s = useStyles();
  return (
    <section className={s.root} aria-label="Evidence">
      <div className={s.tabs}>
        <TabList size="small" selectedValue={p.tab} onTabSelect={(_, d) => (p.onPreview(null), p.onTab(d.value as EvidenceTab))}>
          <Tab value="citations">Citations</Tab>
          <Tab value="notes">Notes{p.notes && p.notes.length > 0 ? ` (${p.notes.length})` : ""}</Tab>
          <Tab value="findings">Findings{p.findings && p.findings.length > 0 ? ` (${p.findings.length})` : ""}</Tab>
        </TabList>
      </div>
      <div className={s.body}>
        {p.preview !== null ? (
          <SourcePreview target={p.preview} onBack={() => p.onPreview(null)} />
        ) : p.tab === "citations" ? (
          <Citations citations={p.citations} onOpen={(c) => p.onPreview(previewOf(c))} />
        ) : p.tab === "notes" ? (
          <Notes {...p} />
        ) : (
          <Findings {...p} />
        )}
      </div>
    </section>
  );
}

function Citations({ citations, onOpen }: { citations: ResearchCitation[] | null; onOpen: (c: ResearchCitation) => void }) {
  const s = useStyles();
  if (citations === null || citations.length === 0)
    return <Text className={s.muted}>{citations === null ? "Ask a question: the passages an answer cites are listed here, each opening at its place in the source." : "This answer cites no passage of the selected sources."}</Text>;
  return (
    <>
      {citations.map((c) => (
        <button key={c.id} type="button" className={`${s.card} ${s.cardButton}`} onClick={() => onOpen(c)} aria-label={`Open citation ${c.label}: ${c.sourceTitle}`}>
          <span className={s.line}>
            <Badge appearance="filled" color="brand" size="small">
              {c.label}
            </Badge>
            <Text weight="semibold" className={s.grow}>
              {c.sourceTitle}
            </Text>
            {!c.sourceAvailable && (
              <Badge appearance="tint" color="warning" size="small">
                deleted
              </Badge>
            )}
            {c.sourceAvailable && !c.revisionCurrent && (
              <Badge appearance="tint" color="informative" size="small">
                older revision
              </Badge>
            )}
          </span>
          <Text size={100} className={s.muted}>
            {placeOf(c) || "—"} · {c.match === "fts" ? "matched the question" : "opening of the source"}
          </Text>
          <span className={s.quote}>{c.quote}</span>
        </button>
      ))}
    </>
  );
}

function Notes(p: EvidencePanelProps) {
  const s = useStyles();
  const [editing, setEditing] = useState<ResearchNote | null>(null);
  const draft = p.noteDraft;
  return (
    <>
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
        <Text className={s.muted}>No notes yet. Save an answer as a note, or write one from the sources panel.</Text>
      ) : (
        p.notes.map((n) => (
          <article key={n.id} className={s.card} aria-label={`Note: ${n.title}`}>
            <div className={s.line}>
              <Text weight="semibold" className={s.grow}>
                {n.title}
              </Text>
              <Button appearance="subtle" size="small" icon={<Edit16Regular />} aria-label={`Edit ${n.title}`} onClick={() => setEditing(n)} />
              <Button appearance="subtle" size="small" icon={<Delete16Regular />} aria-label={`Delete ${n.title}`} onClick={() => void research.deleteNote(n.id).then(p.onChanged)} />
            </div>
            <Markdown text={n.body} />
            {n.citation && (
              <Button appearance="transparent" size="small" onClick={() => p.onPreview(previewOf(n.citation as ResearchCitation))}>
                {n.citation.label} · {n.citation.sourceTitle} {placeOf(n.citation) && `(${placeOf(n.citation)})`}
              </Button>
            )}
            <Text size={100} className={s.muted}>
              {n.createdBy} · {when(n.updatedAt)}
            </Text>
          </article>
        ))
      )}
    </>
  );
}

function NoteForm({ workspaceId, sessionId, note, draft, onDone }: { workspaceId: string; sessionId: string; note: ResearchNote | null; draft: NoteDraft | null; onDone: () => void }) {
  const s = useStyles();
  const [title, setTitle] = useState(note?.title ?? draft?.title ?? "");
  const [body, setBody] = useState(note?.body ?? draft?.body ?? "");
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    try {
      if (note !== null) await research.updateNote(note.id, { title, body });
      else await research.createNote(workspaceId, { title, body, sessionId, ...(draft?.citationId ? { citationId: draft.citationId } : {}), ...(draft?.sourceId ? { sourceId: draft.sourceId } : {}) });
      onDone();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <form
      className={`${s.card} ${s.form}`}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      aria-label={note ? "Edit note" : "New note"}
    >
      <Field label="Title">
        <Input value={title} onChange={(_, d) => setTitle(d.value)} maxLength={RESEARCH_LIMITS.titleLength} autoFocus />
      </Field>
      <Field label="Note (Markdown)">
        <Textarea value={body} onChange={(_, d) => setBody(d.value)} rows={6} resize="vertical" maxLength={RESEARCH_LIMITS.noteBodyLength} />
      </Field>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.actions}>
        <Button appearance="primary" type="submit" disabled={title.trim() === "" || body.trim() === ""}>
          Save note
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

const STATUS_COLOR: Record<FindingStatus, "informative" | "warning" | "success" | "danger"> = { draft: "informative", needs_review: "warning", reviewed: "success", rejected: "danger" };

const MOVE_LABEL: Record<FindingStatus, string> = { draft: "Back to draft", needs_review: "Ask for review", reviewed: "Mark reviewed", rejected: "Reject" };

function Findings(p: EvidencePanelProps) {
  const s = useStyles();
  const [error, setError] = useState<string | null>(null);
  const move = async (f: ResearchFinding, status: FindingStatus) => {
    setError(null);
    try {
      await research.updateFinding(f.id, { status });
      p.onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <>
      <Text size={200} className={s.muted}>
        A finding is a research conclusion a person reviews. Reviewed means reviewed -- it is not an approved policy, and nothing here changes Orbit's governance.
      </Text>
      {p.findingDraft !== null && <FindingForm workspaceId={p.workspaceId} sessionId={p.sessionId} draft={p.findingDraft} onDone={() => (p.onDrafted(), p.onChanged())} />}
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      {p.findings === null ? (
        <Spinner size="tiny" />
      ) : p.findings.length === 0 && p.findingDraft === null ? (
        <Text className={s.muted}>No findings yet. Add an answer as a finding to start one.</Text>
      ) : (
        p.findings.map((f) => (
          <article key={f.id} className={s.card} aria-label={`Finding ${f.code}`}>
            <div className={s.line}>
              <Badge appearance="outline" size="small">
                {f.code}
              </Badge>
              <Text weight="semibold" className={s.grow}>
                {f.title}
              </Text>
              <Badge appearance="tint" color={STATUS_COLOR[f.status]} size="small">
                {FINDING_STATUS_LABELS[f.status]}
              </Badge>
            </div>
            <Markdown text={f.statement} />
            {f.citations.length > 0 && (
              <div className={s.actions}>
                {f.citations.map((c) => (
                  <Button key={c.id} appearance="outline" size="small" onClick={() => p.onPreview(previewOf(c))}>
                    {c.label} · {c.sourceTitle}
                  </Button>
                ))}
              </div>
            )}
            <div className={s.actions}>
              {FINDING_MOVES[f.status].map((to) => (
                <Button key={to} size="small" appearance={to === "reviewed" ? "primary" : "secondary"} onClick={() => void move(f, to)}>
                  {MOVE_LABEL[to]}
                </Button>
              ))}
              <Button size="small" appearance="subtle" icon={<Delete16Regular />} aria-label={`Delete ${f.code}`} onClick={() => void research.deleteFinding(f.id).then(p.onChanged, (err: unknown) => setError(errorText(err)))} />
            </div>
            <Text size={100} className={s.muted}>
              {f.reviewedBy ? `${FINDING_STATUS_LABELS[f.status]} by ${f.reviewedBy}${f.reviewedAt ? ` · ${when(f.reviewedAt)}` : ""}` : `Written by ${f.createdBy} · ${when(f.updatedAt)}`}
            </Text>
          </article>
        ))
      )}
    </>
  );
}

function FindingForm({ workspaceId, sessionId, draft, onDone }: { workspaceId: string; sessionId: string; draft: FindingDraft; onDone: () => void }) {
  const s = useStyles();
  const [title, setTitle] = useState(draft.title);
  const [statement, setStatement] = useState(draft.statement);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className={`${s.card} ${s.form}`}
      aria-label="New finding"
      onSubmit={(e) => {
        e.preventDefault();
        research.createFinding(workspaceId, { title, statement, sessionId, citations: draft.citations }).then(onDone, (err: unknown) => setError(errorText(err)));
      }}
    >
      <Field label="Finding">
        <Input value={title} onChange={(_, d) => setTitle(d.value)} maxLength={RESEARCH_LIMITS.titleLength} autoFocus />
      </Field>
      <Field label="Statement (Markdown)" hint={draft.citations.length > 0 ? `Rests on ${draft.citations.length} citation${draft.citations.length === 1 ? "" : "s"}.` : "No citation: it rests on nothing yet."}>
        <Textarea value={statement} onChange={(_, d) => setStatement(d.value)} rows={5} resize="vertical" maxLength={RESEARCH_LIMITS.findingStatementLength} />
      </Field>
      {error && (
        <MessageBar intent="error">
          <MessageBarBody>{error}</MessageBarBody>
        </MessageBar>
      )}
      <div className={s.actions}>
        <Button appearance="primary" type="submit" disabled={title.trim() === "" || statement.trim() === ""}>
          Save as draft
        </Button>
        <Button onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}
