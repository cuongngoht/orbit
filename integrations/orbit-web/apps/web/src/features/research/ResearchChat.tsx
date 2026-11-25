// THE RESEARCH CONVERSATION: questions and answers -- an answer streams as it is written, its verified citations as
// chips that open their passage -- with what each answer can become (a note, a finding), the run going on (how many
// passages of which sources it was given), how a run that did not complete ended (and asking again), and the composer.
// A conversation like a chat: the selected sources are references read with each question, and none is needed to ask.
import { Badge, Button, MessageBar, MessageBarActions, MessageBarBody, Spinner, Text, Tooltip, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Add16Regular, ArrowClockwise16Regular, ArrowDown16Regular, BookOpen24Regular, Checkmark16Regular, Copy16Regular, Dismiss16Regular, Edit16Regular, Info16Regular, Lightbulb16Regular, NoteAdd16Regular, TextBulletListSquare16Regular } from "@fluentui/react-icons";
import type { ResearchCitation, ResearchMessage } from "@orbit-web/contracts";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiErrorBar } from "../../components/ApiErrorBar";
import { Markdown } from "../../components/Markdown";
import { useViewport } from "../../hooks/useViewport";
import { useI18n } from "../../i18n";
import { Composer } from "../composer/Composer";
import type { LiveMessage, ResearchState } from "./researchReducer";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", width: "100%", maxWidth: "100%", minHeight: 0, height: "100%", minWidth: 0, overflow: "hidden" },
  scrollWrap: { position: "relative", flexGrow: 1, minHeight: 0, minWidth: 0, maxWidth: "100%", overflow: "hidden", display: "flex", flexDirection: "column" },
  scroll: { flexGrow: 1, minWidth: 0, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", paddingTop: "16px", paddingRight: "20px", paddingBottom: "38px", paddingLeft: "20px", overflowAnchor: "auto" },
  scrollMobile: { paddingTop: "12px", paddingRight: "16px", paddingBottom: "48px", paddingLeft: "16px" },
  scrollFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "44px",
    pointerEvents: "none",
    backgroundImage: "linear-gradient(to bottom, transparent 0%, var(--orbit-fade-bg) 82%)",
  },
  inner: { width: "100%", maxWidth: "780px", marginLeft: "auto", marginRight: "auto", display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 },
  innerEmpty: { minHeight: "100%", justifyContent: "center" },
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
  answer: { display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 },
  actions: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", color: tokens.colorNeutralForeground3 },
  actionBtn: { borderRadius: "9999px" },
  actionBtnTouch: { "@media (pointer: coarse)": { minWidth: "40px", minHeight: "40px" } },
  citeBtn: {
    borderRadius: "9999px",
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
    ":hover": { backgroundColor: tokens.colorBrandBackground2Hover },
  },
  cursor: {
    display: "inline-block",
    width: "2px",
    height: "16px",
    borderRadius: "1px",
    backgroundColor: tokens.colorBrandForeground1,
    marginLeft: "3px",
    verticalAlign: "text-bottom",
    animationName: "orbit-blink",
    animationDuration: "1s",
    animationIterationCount: "infinite",
  },
  muted: { color: tokens.colorNeutralForeground3 },
  working: {
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: "8px",
    backgroundColor: "var(--orbit-tool-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    borderRadius: "12px",
    paddingTop: "8px",
    paddingRight: "12px",
    paddingBottom: "8px",
    paddingLeft: "12px",
    color: tokens.colorNeutralForeground2,
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
    gap: "12px",
    paddingTop: "24px",
    paddingBottom: "24px",
    color: tokens.colorNeutralForeground2,
  },
  emptyEmblem: {
    width: "52px",
    height: "52px",
    borderRadius: "16px",
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    marginTop: 0,
    marginBottom: 0,
    fontSize: "clamp(20px, 3vw, 24px)",
    lineHeight: "1.25",
    letterSpacing: "-0.02em",
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  emptyCopy: { maxWidth: "460px", lineHeight: "1.55", color: tokens.colorNeutralForeground3 },
  steps: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "6px",
    marginTop: "4px",
    maxWidth: "520px",
  },
  stepPill: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    paddingTop: "5px",
    paddingRight: "10px",
    paddingBottom: "5px",
    paddingLeft: "8px",
    borderRadius: "9999px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: "var(--orbit-tool-bg)",
    color: tokens.colorNeutralForeground3,
    fontSize: tokens.fontSizeBase200,
  },
  stepPillActive: {
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.borderColor(tokens.colorBrandStroke2),
    color: tokens.colorNeutralForeground1,
    fontWeight: tokens.fontWeightSemibold,
  },
  stepNum: {
    width: "18px",
    height: "18px",
    borderRadius: "9999px",
    backgroundColor: tokens.colorNeutralBackground3,
    color: tokens.colorNeutralForeground2,
    fontSize: "11px",
    fontWeight: tokens.fontWeightSemibold,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontVariantNumeric: "tabular-nums",
  },
  stepNumActive: {
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  emptyCta: { marginTop: "4px", borderRadius: "10px", minHeight: "38px" },
  emptyCtaTouch: { minHeight: "44px" },
  readyChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    paddingTop: "4px",
    paddingRight: "12px",
    paddingBottom: "4px",
    paddingLeft: "10px",
    borderRadius: "9999px",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    backgroundColor: "var(--orbit-tool-bg)",
    color: tokens.colorNeutralForeground2,
    fontSize: tokens.fontSizeBase200,
  },
  draftCard: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "12px",
    flexWrap: "wrap",
    borderRadius: "16px",
    backgroundColor: "var(--orbit-card-bg)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    boxShadow: "var(--orbit-soft-shadow)",
    paddingTop: "12px",
    paddingRight: "14px",
    paddingBottom: "12px",
    paddingLeft: "14px",
  },
  draftBody: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    flexGrow: 1,
    flexBasis: "240px",
    minWidth: 0,
  },
  draftIcon: { flexShrink: 0, marginTop: "2px", color: tokens.colorBrandForeground1 },
  draftText: { color: tokens.colorNeutralForeground1, lineHeight: "1.45", overflowWrap: "anywhere" },
  draftBtn: { flexShrink: 0, borderRadius: "10px", minHeight: "34px" },
  draftBtnTouch: { minHeight: "40px" },
  bottom: { paddingTop: "2px", paddingRight: "20px", paddingBottom: "18px", paddingLeft: "20px", flexShrink: 0, minWidth: 0, maxWidth: "100%" },
  bottomMobile: { paddingRight: "12px", paddingLeft: "12px", paddingBottom: "max(10px, var(--orbit-safe-bottom, env(safe-area-inset-bottom)))" },
  using: {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    minHeight: "30px",
    borderRadius: "9999px",
    paddingTop: "2px",
    paddingRight: "10px",
    paddingBottom: "2px",
    paddingLeft: "8px",
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground2,
    backgroundColor: "transparent",
    ...shorthands.border("1px", "solid", "transparent"),
    fontFamily: tokens.fontFamilyBase,
    whiteSpace: "nowrap",
  },
  usingBtn: {
    cursor: "pointer",
    transitionProperty: "background-color, border-color",
    transitionDuration: "140ms",
    ":hover": { backgroundColor: tokens.colorSubtleBackgroundHover },
  },
  usingMobile: {
    minHeight: "34px",
    paddingRight: "8px",
    paddingLeft: "8px",
    gap: "5px",
    backgroundColor: tokens.colorNeutralBackground2,
  },
  dot: { width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0, backgroundColor: tokens.colorNeutralForeground4 },
  dotActive: { backgroundColor: tokens.colorPaletteGreenForeground1 },
  usingBadge: { flexShrink: 0, whiteSpace: "nowrap" },
  jump: {
    position: "absolute",
    left: "50%",
    transform: "translateX(-50%)",
    bottom: "10px",
    zIndex: 5,
    backgroundColor: "var(--orbit-header-bg)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    boxShadow: "var(--orbit-soft-shadow)",
    minHeight: "34px",
    "@media (pointer: coarse)": { minHeight: "40px" },
  },
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
  totalSources?: number;
  draftQuestion: string | null;
  busy: boolean;
  onAsk: (text: string) => void | boolean | Promise<boolean | void>;
  onStop: () => void;
  onShowCitations: (messageId: string) => void;
  onCite: (messageId: string, label: string) => void;
  onSaveNote: (message: LiveMessage) => void;
  onAddFinding: (message: LiveMessage) => void;
  onAddSources?: () => void;
  onOpenSources?: () => void;
  // The last refusal, as the API said it (a question that needs an AI connection says where to connect one).
  error: unknown;
  right?: ReactNode;
}

const toLive = (m: ResearchMessage): LiveMessage => ({ id: m.id, role: m.role, text: m.text, streaming: false, partial: m.partial, runId: m.runId });

function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text).catch(() => undefined);
    return;
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
  } catch {
    // ignore
  }
}

export function ResearchChat(p: ResearchChatProps) {
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile, isCoarse } = useViewport();
  const touch = isMobile || isCoarse;
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);
  const [away, setAway] = useState(false);
  const [editedDraft, setEditedDraft] = useState<string | null>(null);
  const [composerKey, setComposerKey] = useState(0);
  const [dismissedDraft, setDismissedDraft] = useState(false);
  const messages = useMemo(() => (p.stream.lastSeq >= p.savedSeq && p.stream.lastSeq > 0 ? p.stream.messages : p.saved.map(toLive)), [p.stream, p.saved, p.savedSeq]);
  const running = p.stream.status === "running" || p.stream.run !== null;
  const lastQuestion = [...messages].reverse().find((m) => m.role === "user")?.text ?? null;
  const totalSources = p.totalSources ?? p.selected;
  const stepOneActive = totalSources === 0;
  const stepTwoActive = totalSources > 0 && p.usable === 0;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (pinnedToBottom.current) {
      el.scrollTop = el.scrollHeight;
      setAway(false);
    } else {
      setAway(el.scrollHeight - el.scrollTop - el.clientHeight > 120);
    }
  }, [messages]);

  const copy = (text: string) => copyText(text);
  const sourceTrigger = p.onOpenSources ?? p.onAddSources;
  const sourceWord = t(p.usable === 1 ? "research.newSession.sourceOne" : "research.newSession.sourceMany");
  const sourceStatusLabel =
    p.selected > p.usable
      ? t("research.chat.usingStatusBoth", { usable: p.usable, word: sourceWord, notReady: p.selected - p.usable })
      : t("research.chat.usingStatusOnly", { usable: p.usable, word: sourceWord });
  const sourceStatusContent = (
    <>
      <span className={mergeClasses(s.dot, p.usable > 0 && s.dotActive)} aria-hidden />
      {!isMobile && <TextBulletListSquare16Regular />}
      {isMobile ? `${p.usable} ${sourceWord}` : t("research.chat.usingStatusOnly", { usable: p.usable, word: sourceWord })}
      {p.selected > p.usable && (
        <Badge className={s.usingBadge} appearance="tint" size="small">
          {p.selected - p.usable} {t(isMobile ? "research.chat.waitWord" : "research.chat.notReadyWord")}
        </Badge>
      )}
    </>
  );

  return (
    <section className={s.root} aria-label={t("research.chat.aria")}>
      <div className={s.scrollWrap}>
        <div
          className={mergeClasses(s.scroll, isMobile && s.scrollMobile)}
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
            pinnedToBottom.current = dist < 48;
            setAway(dist > 120);
          }}
        >
          <div className={mergeClasses(s.inner, messages.length === 0 && !running && !p.stream.ended && !p.stream.notice && s.innerEmpty)}>
            {messages.length === 0 && (
              <div className={s.empty}>
                <span className={s.emptyEmblem} aria-hidden>
                  <BookOpen24Regular />
                </span>
                <Text as="h2" className={s.emptyTitle}>
                  {t("research.chat.askAnything")}
                </Text>
                <Text className={s.emptyCopy}>
                  {t("research.chat.emptyCopy")}
                </Text>
                {p.usable === 0 ? (
                  <>
                    <div className={s.steps} aria-hidden>
                      <span className={mergeClasses(s.stepPill, stepOneActive && s.stepPillActive)}>
                        <span className={mergeClasses(s.stepNum, stepOneActive && s.stepNumActive)}>1</span>
                        {t("research.chat.stepAdd")}
                      </span>
                      <span className={mergeClasses(s.stepPill, stepTwoActive && s.stepPillActive)}>
                        <span className={mergeClasses(s.stepNum, stepTwoActive && s.stepNumActive)}>2</span>
                        {t("research.chat.stepSelect")}
                      </span>
                      <span className={s.stepPill}>
                        <span className={s.stepNum}>3</span>
                        {t("research.chat.stepAsk")}
                      </span>
                    </div>
                    {stepOneActive && p.onAddSources ? (
                      <Button className={mergeClasses(s.emptyCta, touch && s.emptyCtaTouch)} appearance="primary" icon={<Add16Regular />} onClick={p.onAddSources}>
                        {t("research.chat.uploadOrAdd")}
                      </Button>
                    ) : (
                      stepTwoActive &&
                      p.onOpenSources && (
                        <Button className={mergeClasses(s.emptyCta, touch && s.emptyCtaTouch)} appearance="secondary" onClick={p.onOpenSources}>
                          {t("research.chat.selectSources")}
                        </Button>
                      )
                    )}
                  </>
                ) : (
                  <span className={s.readyChip}>
                    <span className={mergeClasses(s.dot, s.dotActive)} aria-hidden />
                    {t("research.chat.readySourcesActive", { count: p.usable, word: sourceWord })}
                  </span>
                )}
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
                <Text size={200}>
                  {p.stream.run
                    ? t("research.chat.answeringFrom", {
                        passages: p.stream.run.passages,
                        passagesPlural: p.stream.run.passages === 1 ? "" : "s",
                        sources: p.stream.run.sources.length,
                        sourceWord: t(p.stream.run.sources.length === 1 ? "research.newSession.sourceOne" : "research.newSession.sourceMany"),
                      })
                    : t("research.chat.searchingSelected")}
                </Text>
              </div>
            )}
            {!running && p.stream.ended && (
              <MessageBar intent={p.stream.ended.kind === "failed" ? "error" : "warning"}>
                <MessageBarBody>{p.stream.ended.message}</MessageBarBody>
                {lastQuestion !== null && (
                  <MessageBarActions>
                    <Button size="small" icon={<ArrowClockwise16Regular />} onClick={() => p.onAsk(lastQuestion)}>
                      {t("research.chat.askAgain")}
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
          <Button
            className={s.jump}
            shape="circular"
            appearance="secondary"
            size="small"
            icon={<ArrowDown16Regular />}
            onClick={() => {
              if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
              pinnedToBottom.current = true;
              setAway(false);
            }}
          >
            {t("research.chat.latest")}
          </Button>
        )}
        <div className={s.scrollFade} aria-hidden />
      </div>
      <div className={mergeClasses(s.bottom, isMobile && s.bottomMobile)}>
        <Composer
          key={composerKey}
          defaultValue={editedDraft ?? undefined}
          autoFocus={!touch && p.usable > 0}
          placeholder={t(p.usable > 0 ? "research.chat.placeholderReady" : p.selected > 0 ? "research.chat.placeholderPreparing" : "research.chat.placeholderEmpty")}
          canSend={!running && !p.busy}
          running={running}
          busy={p.busy}
          onSend={p.onAsk}
          onStop={p.onStop}
          above={
            <>
              <ApiErrorBar error={p.error} />
              {p.draftQuestion && !dismissedDraft && messages.length === 0 && (
                <div className={s.draftCard}>
                  <div className={s.draftBody}>
                    <Info16Regular className={s.draftIcon} aria-hidden />
                    <Text size={200} className={s.draftText}>
                      {t("research.chat.firstQuestionDisplay", {
                        prefix: t(p.usable > 0 ? "research.chat.firstQuestionReady" : "research.chat.firstQuestionKept"),
                        question: p.draftQuestion,
                      })}
                    </Text>
                  </div>
                  <div className={s.actions}>
                    <Button
                      className={mergeClasses(s.draftBtn, touch && s.draftBtnTouch)}
                      size="small"
                      appearance="subtle"
                      icon={<Edit16Regular />}
                      disabled={running}
                      onClick={() => {
                        setEditedDraft(p.draftQuestion);
                        setComposerKey((k) => k + 1);
                        setDismissedDraft(true);
                      }}
                    >
                      {t("research.chat.editDraft")}
                    </Button>
                    <Button
                      className={mergeClasses(s.draftBtn, touch && s.draftBtnTouch)}
                      size="small"
                      appearance={p.usable > 0 ? "primary" : "secondary"}
                      disabled={running}
                      onClick={() => void p.onAsk(p.draftQuestion as string)}
                    >
                      {t("research.chat.askItNow")}
                    </Button>
                    <Button
                      className={mergeClasses(s.actionBtn, touch && s.actionBtnTouch)}
                      size="small"
                      appearance="subtle"
                      icon={<Dismiss16Regular />}
                      aria-label={t("research.chat.dismissDraftAria")}
                      onClick={() => setDismissedDraft(true)}
                    />
                  </div>
                </div>
              )}
            </>
          }
          left={
            <Tooltip content={t("research.chat.sourcesTooltip")} relationship="description">
              {sourceTrigger ? (
                <button
                  type="button"
                  className={mergeClasses(s.using, s.usingBtn, isMobile && s.usingMobile)}
                  aria-label={isMobile ? sourceStatusLabel : undefined}
                  onClick={sourceTrigger}
                >
                  {sourceStatusContent}
                </button>
              ) : (
                <span className={mergeClasses(s.using, isMobile && s.usingMobile)} aria-label={isMobile ? sourceStatusLabel : undefined} tabIndex={0}>
                  {sourceStatusContent}
                </span>
              )}
            </Tooltip>
          }
          right={p.right}
        />
      </div>
    </section>
  );
}

function Answer({ message, citations, onCite, onShowCitations, onCopy, onNote, onFinding }: { message: LiveMessage; citations: ResearchCitation[]; onCite: (label: string) => void; onShowCitations: () => void; onCopy: () => void; onNote: () => void; onFinding: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );
  const handleCopy = () => {
    onCopy();
    setCopied(true);
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };
  const labels = useMemo(() => new Set(citations.map((c) => c.label)), [citations]);
  const cite = useMemo(() => ({ labels, onCite }), [labels, onCite]);
  return (
    <article className={s.answer} aria-label={t("research.chat.answerAria")} data-testid="research-answer">
      <Markdown text={message.text} cite={cite} />
      {message.streaming && <span className={s.cursor} aria-label={t("research.chat.writingAria")} />}
      {message.partial && (
        <Text size={200} className={s.muted}>
          {t("research.chat.cutOff")}
        </Text>
      )}
      {!message.streaming && (
        <div className={s.actions}>
          <Tooltip content={t(copied ? "research.chat.copied" : "research.chat.copy")} relationship="label">
            <Button className={mergeClasses(s.actionBtn, s.actionBtnTouch)} appearance="subtle" size="small" icon={copied ? <Checkmark16Regular /> : <Copy16Regular />} onClick={handleCopy} />
          </Tooltip>
          <Tooltip content={t("research.chat.saveAsNote")} relationship="label">
            <Button className={mergeClasses(s.actionBtn, s.actionBtnTouch)} appearance="subtle" size="small" icon={<NoteAdd16Regular />} onClick={onNote} />
          </Tooltip>
          <Tooltip content={t("research.chat.addAsFinding")} relationship="label">
            <Button className={mergeClasses(s.actionBtn, s.actionBtnTouch)} appearance="subtle" size="small" icon={<Lightbulb16Regular />} onClick={onFinding} />
          </Tooltip>
          <Button
            className={mergeClasses(citations.length > 0 ? s.citeBtn : s.actionBtn, s.actionBtnTouch)}
            appearance="subtle"
            size="small"
            onClick={onShowCitations}
            disabled={citations.length === 0}
          >
            {citations.length === 0 ? t("research.chat.noCitations") : t("research.chat.citationsCount", { count: citations.length, plural: citations.length === 1 ? "" : "s" })}
          </Button>
        </div>
      )}
    </article>
  );
}
