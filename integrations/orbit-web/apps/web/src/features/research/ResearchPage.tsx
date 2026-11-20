// ONE RESEARCH SESSION: its header (title, workspace, model, sources in use, status, who it is shared with), and three
// panels -- SOURCES (what this session may retrieve from), the RESEARCH CHAT, and EVIDENCE (citations, notes,
// findings, a source's text). Side by side from 1440px; below, the evidence opens as a drawer (and the sources fold
// away); on a phone, one panel at a time behind tabs. Each panel scrolls on its own; the composer stays in view.
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogSurface, DialogTitle, DialogTrigger, MessageBar, MessageBarBody, OverlayDrawer, Spinner, Tab, TabList, Text, ToggleButton, Tooltip, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { BookOpen20Regular, Dismiss20Regular, Navigation20Regular, PanelLeftContract20Regular, PanelLeftExpand20Regular, PanelRightContract20Regular, PanelRightExpand20Regular, People20Regular } from "@fluentui/react-icons";
import type { ResearchCitation, ResearchFinding, ResearchNote, ResearchSessionDetail, ResearchSessionSummary, ResearchSourceSummary, ResearchWorkspaceDetail } from "@orbit-web/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SessionStatusBadge } from "../../components/StatusBadge";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { errorText } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { ModelEffortPicker } from "../composer/RunPickers";
import { PeopleAccess } from "../share/PeopleAccess";
import { AddSourcesDialog } from "./AddSourcesDialog";
import { research } from "./api";
import { EvidencePanel, previewOf, type EvidenceTab, type FindingDraft, type NoteDraft } from "./EvidencePanel";
import { searchable } from "./labels";
import { ResearchChat } from "./ResearchChat";
import type { LiveMessage } from "./researchReducer";
import { SourcesPanel } from "./SourcesPanel";
import type { PreviewTarget } from "./SourcePreview";
import { useResearchStream } from "./useResearchStream";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, minWidth: 0 },
  top: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    minHeight: "52px",
    paddingTop: "8px",
    paddingRight: "12px",
    paddingBottom: "8px",
    paddingLeft: "16px",
    backgroundColor: "var(--orbit-header-bg)",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
    flexShrink: 0,
    minWidth: 0,
  },
  topMobile: { paddingTop: "max(6px, env(safe-area-inset-top))", paddingLeft: "8px", paddingRight: "8px", gap: "6px" },
  titles: { display: "flex", flexDirection: "column", minWidth: 0, flexGrow: 1 },
  title: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  sub: { display: "flex", alignItems: "center", gap: "6px", minWidth: 0, color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
  ellipsis: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 },
  actions: { display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 },
  touch: { minWidth: "44px", minHeight: "44px" },
  panels: { display: "flex", flexGrow: 1, minHeight: 0, minWidth: 0 },
  sources: { width: "300px", flexShrink: 0, minHeight: 0, borderRight: `1px solid ${tokens.colorNeutralStroke2}` },
  sourcesNarrow: { width: "272px" },
  chat: { flexGrow: 1, minWidth: 0, minHeight: 0 },
  evidence: { width: "360px", flexShrink: 0, minHeight: 0, borderLeft: `1px solid ${tokens.colorNeutralStroke2}` },
  drawer: { width: "min(420px, 92vw)", maxWidth: "100%", paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0, display: "flex", flexDirection: "column", alignItems: "stretch", overflow: "hidden" },
  drawerHead: { display: "flex", justifyContent: "flex-end", paddingTop: "4px", paddingRight: "4px", flexShrink: 0 },
  mobileTabs: { flexShrink: 0, borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, paddingLeft: "8px", paddingRight: "8px" },
  single: { flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" },
  center: { marginTop: "48px" },
  shareSurface: { width: "min(520px, 94vw)", maxWidth: "min(520px, 94vw)" },
});

type MobilePanel = "sources" | "chat" | "evidence";

export interface ResearchPageProps {
  sessionId: string;
  onUpdated: (s: ResearchSessionSummary) => void;
  onOpenNav?: () => void;
}

export function ResearchPage({ sessionId, onUpdated, onOpenNav }: ResearchPageProps) {
  const s = useStyles();
  const { isMobile, isCompact, isWide } = useViewport();
  const detail = useResource<ResearchSessionDetail>(() => research.session(sessionId), [sessionId]);
  const { state, connected } = useResearchStream(sessionId);
  const workspaceId = detail.data?.workspaceId ?? null;
  const workspace = useResource<ResearchWorkspaceDetail>(workspaceId ? () => research.workspace(workspaceId) : null, [workspaceId]);
  const sources = useResource<ResearchSourceSummary[]>(workspaceId ? () => research.sources(workspaceId) : null, [workspaceId]);
  const notes = useResource<ResearchNote[]>(workspaceId ? () => research.notes(workspaceId) : null, [workspaceId]);
  const findings = useResource<ResearchFinding[]>(workspaceId ? () => research.findings(workspaceId) : null, [workspaceId]);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("chat");
  const [showSources, setShowSources] = useState(true);
  const [showEvidence, setShowEvidence] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [tab, setTab] = useState<EvidenceTab>("citations");
  const [preview, setPreview] = useState<PreviewTarget | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [findingDraft, setFindingDraft] = useState<FindingDraft | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The session (its citations and selection) is read again when a run ends or citations are recorded. Its selection is
  // the one read until this page changes it.
  const { reload: reloadDetail } = detail;
  const streamed = state.lastSeq > 0;
  useEffect(() => {
    if (streamed) void reloadDetail();
  }, [state.citations, state.status, reloadDetail, streamed]);

  // The workspace's sources, notes and findings follow the app stream.
  const { set: setSources, reload: reloadSources } = sources;
  const current = sources.data;
  useAppEvent("research.source.changed", (e) => {
    if (e.data.source.workspaceId !== workspaceId) return;
    const list = current ?? [];
    setSources(list.some((x) => x.id === e.data.source.id) ? list.map((x) => (x.id === e.data.source.id ? e.data.source : x)) : [...list, e.data.source]);
  });
  useAppEvent("research.source.removed", (e) => {
    if (e.data.workspaceId !== workspaceId) return;
    setSources((current ?? []).filter((x) => x.id !== e.data.sourceId));
    setSelection((sel) => (sel ?? detail.data?.selection ?? []).filter((id) => id !== e.data.sourceId));
  });
  const { reload: reloadNotes } = notes;
  const { reload: reloadFindings } = findings;
  const reloadEvidence = useCallback(() => {
    void reloadNotes();
    void reloadFindings();
  }, [reloadNotes, reloadFindings]);
  useAppEvent("research.evidence.changed", (e) => {
    if (e.data.workspaceId === workspaceId) reloadEvidence();
  });
  useAppEvent("research.session.summary", (e) => {
    if (e.data.session.id === sessionId) void reloadDetail();
  });

  const citationsByMessage = useMemo(() => {
    const map = new Map<string, ResearchCitation[]>();
    for (const m of detail.data?.messages ?? []) map.set(m.id, m.citations);
    return map;
  }, [detail.data]);
  const citationsOf = useCallback((id: string) => citationsByMessage.get(id) ?? [], [citationsByMessage]);
  const lastAnswer = [...(detail.data?.messages ?? [])].reverse().find((m) => m.role === "assistant" && m.citations.length > 0)?.id ?? null;
  const shownMessage = chosen ?? lastAnswer;

  const sel = selection ?? detail.data?.selection ?? [];
  const list = sources.data ?? [];
  const usable = list.filter((x) => sel.includes(x.id) && searchable(x)).length;

  // The evidence panel shows a tab, or a passage over it: both are set here, so a tab opened for a note or a finding
  // is never hidden behind the passage opened before it.
  const openEvidence = (next: EvidenceTab, shown: PreviewTarget | null = null) => {
    setTab(next);
    setPreview(shown);
    if (isMobile) setMobilePanel("evidence");
    else if (!isWide) setDrawer(true);
    else setShowEvidence(true);
  };
  const select = async (ids: string[]) => {
    const unique = [...new Set(ids)];
    setSelection(unique);
    setError(null);
    try {
      setSelection((await research.select(sessionId, unique)).selection);
    } catch (err) {
      setError(errorText(err));
    }
  };
  const ask = async (text: string) => {
    setBusy(true);
    setError(null);
    try {
      await research.ask(sessionId, text);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const updateRun = async (change: { model?: string; effort?: string }) => {
    setError(null);
    try {
      const summary = await research.updateSession(sessionId, change);
      onUpdated(summary);
      void reloadDetail();
    } catch (err) {
      setError(errorText(err));
    }
  };
  const firstLine = (text: string) => (text.split("\n").find((l) => l.trim() !== "")?.replace(/^#+\s*/, "").slice(0, 80) ?? "Research note").trim();
  const saveNote = (m: LiveMessage) => {
    const cited = citationsOf(m.id)[0];
    setNoteDraft({ title: firstLine(m.text), body: m.text, ...(cited ? { citationId: cited.id } : {}) });
    openEvidence("notes");
  };
  const addFinding = (m: LiveMessage) => {
    setFindingDraft({ title: firstLine(m.text), statement: m.text, citations: citationsOf(m.id).map((c) => c.id) });
    openEvidence("findings");
  };
  const cite = (messageId: string, label: string) => {
    const c = citationsOf(messageId).find((x) => x.label === label);
    if (!c) return;
    setChosen(messageId);
    openEvidence("citations", previewOf(c));
  };

  if (detail.error && detail.data === null)
    return (
      <MessageBar intent="error" style={{ margin: 16 }}>
        <MessageBarBody>{detail.error}</MessageBarBody>
      </MessageBar>
    );
  if (detail.data === null || workspaceId === null) return <Spinner className={s.center} label="Opening the research session…" />;
  const session = detail.data;
  const status = state.status ?? session.status;

  const sourcesPanel = (
    <SourcesPanel
      sources={sources.data}
      error={sources.error}
      selection={sel}
      onSelect={(ids) => void select(ids)}
      onAdd={() => setAdding(true)}
      onNewNote={() => {
        setNoteDraft({ title: "", body: "" });
        openEvidence("notes");
      }}
      onPreview={(source) => openEvidence(tab, { sourceId: source.id, revisionId: null, chunkOrdinal: null, title: source.title, quote: null })}
    />
  );
  const evidencePanel = (
    <EvidencePanel
      workspaceId={workspaceId}
      sessionId={sessionId}
      tab={tab}
      onTab={setTab}
      citations={shownMessage === null ? null : citationsOf(shownMessage)}
      notes={notes.data}
      findings={findings.data}
      preview={preview}
      onPreview={setPreview}
      noteDraft={noteDraft}
      findingDraft={findingDraft}
      onDrafted={() => {
        setNoteDraft(null);
        setFindingDraft(null);
      }}
      onChanged={reloadEvidence}
    />
  );
  const chat = (
    <ResearchChat
      saved={session.messages}
      savedSeq={session.lastSeq}
      stream={state}
      citationsOf={citationsOf}
      usable={usable}
      selected={sel.length}
      draftQuestion={session.draftQuestion}
      busy={busy}
      error={error}
      onAsk={(text) => void ask(text)}
      onStop={() => void research.stop(sessionId).catch((err: unknown) => setError(errorText(err)))}
      onShowCitations={(id) => {
        setChosen(id);
        openEvidence("citations");
      }}
      onCite={cite}
      onSaveNote={saveNote}
      onAddFinding={addFinding}
      right={<ModelEffortPicker model={session.model} effort={session.effort} onModel={(model) => void updateRun({ model })} onEffort={(effort) => void updateRun({ effort })} disabled={status === "running"} />}
    />
  );

  return (
    <div className={s.root}>
      <header className={mergeClasses(s.top, isMobile && s.topMobile)}>
        {onOpenNav && <Button className={s.touch} appearance="subtle" icon={<Navigation20Regular />} aria-label="Open navigation" onClick={onOpenNav} />}
        <BookOpen20Regular aria-hidden />
        <div className={s.titles}>
          <Text weight="semibold" className={s.title}>
            {session.title}
          </Text>
          <span className={s.sub}>
            <span className={s.ellipsis}>{session.workspaceName}</span>
            {!isMobile && <span>·</span>}
            {!isMobile && <span>{usable} of {list.length} sources in use</span>}
            {session.access === "shared" && (
              <Badge appearance="tint" size="small">
                shared by {session.owner}
              </Badge>
            )}
          </span>
        </div>
        <SessionStatusBadge status={status} />
        {!connected && (
          <Badge appearance="outline" color="warning">
            Reconnecting…
          </Badge>
        )}
        <div className={s.actions}>
          <WorkspaceShare workspaceId={workspaceId} name={workspace.data?.name ?? session.workspaceName} compact={isMobile} />
          {!isMobile && (
            <Tooltip content={showSources ? "Hide the sources" : "Show the sources"} relationship="label">
              <ToggleButton appearance="subtle" size="small" checked={showSources} icon={showSources ? <PanelLeftContract20Regular /> : <PanelLeftExpand20Regular />} onClick={() => setShowSources((v) => !v)} aria-label="Sources panel" />
            </Tooltip>
          )}
          {!isMobile && (
            <Tooltip content="Citations, notes and findings" relationship="label">
              <ToggleButton
                appearance="subtle"
                size="small"
                checked={isWide ? showEvidence : drawer}
                icon={(isWide ? showEvidence : drawer) ? <PanelRightContract20Regular /> : <PanelRightExpand20Regular />}
                onClick={() => (isWide ? setShowEvidence((v) => !v) : setDrawer((v) => !v))}
                aria-label="Evidence panel"
              >
                {!isCompact && "Evidence"}
              </ToggleButton>
            </Tooltip>
          )}
        </div>
      </header>
      {isMobile ? (
        <>
          <div className={s.mobileTabs}>
            <TabList size="small" selectedValue={mobilePanel} onTabSelect={(_, d) => setMobilePanel(d.value as MobilePanel)} aria-label="Research panels">
              <Tab value="sources">Sources</Tab>
              <Tab value="chat">Chat</Tab>
              <Tab value="evidence">Evidence</Tab>
            </TabList>
          </div>
          <div className={s.single}>{mobilePanel === "sources" ? sourcesPanel : mobilePanel === "evidence" ? evidencePanel : chat}</div>
        </>
      ) : (
        <div className={s.panels}>
          {showSources && <div className={mergeClasses(s.sources, !isWide && s.sourcesNarrow)}>{sourcesPanel}</div>}
          <div className={s.chat}>{chat}</div>
          {isWide && showEvidence && <div className={s.evidence}>{evidencePanel}</div>}
        </div>
      )}
      {!isMobile && !isWide && (
        <OverlayDrawer open={drawer} onOpenChange={(_, d) => setDrawer(d.open)} position="end" className={s.drawer} aria-label="Evidence">
          <div className={s.drawerHead}>
            <Button appearance="subtle" icon={<Dismiss20Regular />} aria-label="Close the evidence" onClick={() => setDrawer(false)} />
          </div>
          {drawer && evidencePanel}
        </OverlayDrawer>
      )}
      <AddSourcesDialog
        workspaceId={workspaceId}
        open={adding}
        onOpenChange={setAdding}
        sources={list}
        selection={sel}
        onSelect={(ids) => void select(ids)}
        onAdded={(source) => {
          void reloadSources();
          if (!sel.includes(source.id)) void select([...sel, source.id]);
        }}
      />
    </div>
  );
}

function WorkspaceShare({ workspaceId, name, compact }: { workspaceId: string; name: string; compact: boolean }) {
  const s = useStyles();
  return (
    <Dialog>
      <DialogTrigger disableButtonEnhancement>
        <Button appearance="subtle" size="small" icon={<People20Regular />} aria-label="Share the workspace">
          {!compact && "Share"}
        </Button>
      </DialogTrigger>
      <DialogSurface className={s.shareSurface}>
        <DialogBody>
          <DialogTitle>Share “{name}”</DialogTitle>
          <DialogContent>
            <PeopleAccess path={research.workspaceAccessPath(workspaceId)} what="research workspace" />
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
