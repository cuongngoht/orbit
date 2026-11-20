// THE RESEARCH CONVERSATION: questions and answers -- an answer streams as it is written, its verified citations as
// chips that open their passage -- with what each answer can become (a note, a finding), the run going on (how many
// passages of which sources it was given), how a run that did not complete ended (and asking again), and the composer.
// Mode: the selected sources only -- nothing else is offered, because nothing else is built.
import { Badge, Button, MessageBar, MessageBarActions, MessageBarBody, Spinner, Text, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowClockwise16Regular, ArrowDown16Regular, BookOpen20Regular, Copy16Regular, Lightbulb16Regular, NoteAdd16Regular, TextBulletListSquare16Regular } from "@fluentui/react-icons";
import type { ResearchCitation, ResearchMessage } from "@orbit-web/contracts";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Markdown } from "../../components/Markdown";
import { useViewport } from "../../hooks/useViewport";
import { Composer } from "../composer/Composer";
import type { LiveMessage, ResearchState } from "./researchReducer";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", minHeight: 0, height: "100%", minWidth: 0 },
  scrollWrap: { position: "relative", flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" },
  scroll: { flexGrow: 1, overflowY: "auto", paddingTop: "12px", paddingRight: "20px", paddingBottom: "24px", paddingLeft: "20px", overflowAnchor: "auto" },
  scrollMobile: { paddingRight: "12px", paddingLeft: "12px" },
  inner: { width: "100%", maxWidth: "780px", marginLeft: "auto", marginRight: "auto", display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 },
  user: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    backgroundColor: "var(--orbit-user-bubble)",
    color: tokens.colorNeutralForeground1,
    paddingTop: "10px",
    paddingRight: "16px",
    paddingBottom: "10px",
    paddingLeft: "16px",
    borderTopLeftRadius: "20px",
    borderTopRightRadius: "20px",
    borderBottomRightRadius: "6px",
    borderBottomLeftRadius: "20px",
    fontSize: "15px",
    lineHeight: "1.55",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  answer: { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 },
  actions: { display: "flex", alignItems: "center", gap: "2px", flexWrap: "wrap", color: tokens.colorNeutralForeground3 },
  cursor: { display: "inline-block", width: "2px", height: "16px", backgroundColor: tokens.colorBrandForeground1, marginLeft: "3px", verticalAlign: "text-bottom", animationName: "orbit-blink", animationDuration: "1s", animationIterationCount: "infinite" },
  muted: { color: tokens.colorNeutralForeground3 },
  working: { display: "flex", alignItems: "center", gap: "8px", color: tokens.colorNeutralForeground2 },
  empty: { display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: "10px", paddingTop: "8vh", color: tokens.colorNeutralForeground2 },
  emptyIcon: { width: "32px", height: "32px", color: tokens.colorBrandForeground1 },
  bottom: { paddingTop: "2px", paddingRight: "20px", paddingBottom: "18px", paddingLeft: "20px", flexShrink: 0 },
  bottomMobile: { paddingRight: "12px", paddingLeft: "12px", paddingBottom: "max(12px, env(safe-area-inset-bottom))" },
  using: { display: "inline-flex", alignItems: "center", gap: "6px", minHeight: "30px", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2, paddingLeft: "6px", paddingRight: "6px" },
  jump: { position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: "10px", zIndex: 5 },
});

export interface ResearchChatProps {
  // The conversation as read with the session (shown until the stream has caught up), and the stream's fold.
  saved: ResearchMessage[];
  savedSeq: number;
  stream: ResearchState;
  citationsOf: (messageId: string) => ResearchCitation[];
  // Selected sources a question can search now, and selected in all.
  usable: number;
  selected: number;
  draftQuestion: string | null;
  busy: boolean;
  onAsk: (text: string) => void;
  onStop: () => void;
  onShowCitations: (messageId: string) => void;
  onCite: (messageId: string, label: string) => void;
  onSaveNote: (message: LiveMessage) => void;
  onAddFinding: (message: LiveMessage) => void;
  error: string | null;
  right?: ReactNode;
}

const toLive = (m: ResearchMessage): LiveMessage => ({ id: m.id, role: m.role, text: m.text, streaming: false, partial: m.partial, runId: m.runId });

export function ResearchChat(p: ResearchChatProps) {
  const s = useStyles();
  const { isMobile, isCoarse } = useViewport();
  const scroller = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);
  const messages = useMemo(() => (p.stream.lastSeq >= p.savedSeq && p.stream.lastSeq > 0 ? p.stream.messages : p.saved.map(toLive)), [p.stream, p.saved, p.savedSeq]);
  const running = p.stream.status === "running" || p.stream.run !== null;
  const lastQuestion = [...messages].reverse().find((m) => m.role === "user")?.text ?? null;

  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const copy = (text: string) => void navigator.clipboard?.writeText(text).catch(() => undefined);

  return (
    <section className={s.root} aria-label="Research chat">
      <div className={s.scrollWrap}>
        <div className={`${s.scroll} ${isMobile ? s.scrollMobile : ""}`} ref={scroller} onScroll={(e) => setAway(e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight > 280)}>
          <div className={s.inner}>
            {messages.length === 0 && (
              <div className={s.empty}>
                <BookOpen20Regular className={s.emptyIcon} />
                <Text weight="semibold" size={500}>
                  Ask about your sources
                </Text>
                <Text className={s.muted}>
                  Answers come only from passages of the sources you select, each cited. When the sources do not say, the answer says so.
                </Text>
              </div>
            )}
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className={s.user}>
                  {m.text}
                </div>
              ) : (
                <Answer key={m.id} message={m} citations={p.citationsOf(m.id)} onCite={(label) => p.onCite(m.id, label)} onShowCitations={() => p.onShowCitations(m.id)} onCopy={() => copy(m.text)} onNote={() => p.onSaveNote(m)} onFinding={() => p.onAddFinding(m)} />
              ),
            )}
            {running && (
              <div className={s.working} role="status">
                <Spinner size="tiny" />
                <Text size={200}>{p.stream.run ? `Answering from ${p.stream.run.passages} passage${p.stream.run.passages === 1 ? "" : "s"} of ${p.stream.run.sources.length} source${p.stream.run.sources.length === 1 ? "" : "s"}…` : "Searching the selected sources…"}</Text>
              </div>
            )}
            {!running && p.stream.ended && (
              <MessageBar intent={p.stream.ended.kind === "failed" ? "error" : "warning"}>
                <MessageBarBody>{p.stream.ended.message}</MessageBarBody>
                {lastQuestion !== null && (
                  <MessageBarActions>
                    <Button size="small" icon={<ArrowClockwise16Regular />} onClick={() => p.onAsk(lastQuestion)} disabled={p.usable === 0}>
                      Ask again
                    </Button>
                  </MessageBarActions>
                )}
              </MessageBar>
            )}
            {p.stream.notice && (
              <MessageBar intent="info">
                <MessageBarBody>{p.stream.notice}</MessageBarBody>
              </MessageBar>
            )}
          </div>
        </div>
        {away && (
          <Button className={s.jump} shape="circular" size="small" icon={<ArrowDown16Regular />} onClick={() => scroller.current && (scroller.current.scrollTop = scroller.current.scrollHeight)}>
            Latest
          </Button>
        )}
      </div>
      <div className={`${s.bottom} ${isMobile ? s.bottomMobile : ""}`}>
        <Composer
          autoFocus={!isMobile && !isCoarse}
          placeholder={p.usable > 0 ? "Ask about your sources…" : p.selected > 0 ? "Waiting for the selected sources to be read…" : "Select a source to ask about"}
          canSend={p.usable > 0 && !running && !p.busy}
          running={running}
          busy={p.busy}
          onSend={p.onAsk}
          onStop={p.onStop}
          above={
            <>
              {p.error && (
                <MessageBar intent="error">
                  <MessageBarBody>{p.error}</MessageBarBody>
                </MessageBar>
              )}
              {p.draftQuestion && messages.length === 0 && (
                <MessageBar intent="info">
                  <MessageBarBody>
                    {p.usable > 0 ? "Your first question is ready to ask" : "Your first question waits for a selected source to be ready"}: “{p.draftQuestion}”
                  </MessageBarBody>
                  <MessageBarActions>
                    <Button size="small" disabled={p.usable === 0 || running} onClick={() => p.onAsk(p.draftQuestion as string)}>
                      Ask it now
                    </Button>
                  </MessageBarActions>
                </MessageBar>
              )}
            </>
          }
          left={
            <Tooltip content="Questions are answered only from passages of the selected sources: no web search, no other workspace." relationship="description">
              <span className={s.using} tabIndex={0}>
                <TextBulletListSquare16Regular />
                Using {p.usable} source{p.usable === 1 ? "" : "s"}
                {p.selected > p.usable && <Badge appearance="tint" size="small">{p.selected - p.usable} not ready</Badge>}
              </span>
            </Tooltip>
          }
          right={p.right}
        />
      </div>
    </section>
  );
}

function Answer({ message, citations, onCite, onShowCitations, onCopy, onNote, onFinding }: { message: LiveMessage; citations: ResearchCitation[]; onCite: (label: string) => void; onShowCitations: () => void; onCopy: () => void; onNote: () => void; onFinding: () => void }) {
  const s = useStyles();
  const labels = useMemo(() => new Set(citations.map((c) => c.label)), [citations]);
  const cite = useMemo(() => ({ labels, onCite }), [labels, onCite]);
  return (
    <article className={s.answer} aria-label="Answer" data-testid="research-answer">
      <Markdown text={message.text} cite={cite} />
      {message.streaming && <span className={s.cursor} aria-label="writing" />}
      {message.partial && (
        <Text size={200} className={s.muted}>
          (cut off when the run ended)
        </Text>
      )}
      {!message.streaming && (
        <div className={s.actions}>
          <Tooltip content="Copy" relationship="label">
            <Button appearance="subtle" size="small" icon={<Copy16Regular />} onClick={onCopy} />
          </Tooltip>
          <Tooltip content="Save as note" relationship="label">
            <Button appearance="subtle" size="small" icon={<NoteAdd16Regular />} onClick={onNote} />
          </Tooltip>
          <Tooltip content="Add as finding" relationship="label">
            <Button appearance="subtle" size="small" icon={<Lightbulb16Regular />} onClick={onFinding} />
          </Tooltip>
          <Button appearance="subtle" size="small" onClick={onShowCitations} disabled={citations.length === 0}>
            {citations.length === 0 ? "No citations" : `${citations.length} citation${citations.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}
    </article>
  );
}
