// CEO CHAT's home and one conversation. The home asks "What should we work on today?": a message starts a conversation
// the CEO answers; a quick action starts one with Orbit's records; "Assign work" gives the CEO a mission in the owner's
// own words. A conversation shows what was said -- the owner's, the CEO's (a former CEO's stays theirs), Orbit's records
// and notices -- the answer as it is written, where an answer stands (queued, waiting and why, answering, cut off, not
// answered) with Stop and Ask again, and the missions given from it, followed live.
import { Avatar, Button, MessageBar, MessageBarBody, Spinner, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { ArrowClockwise16Regular } from "@fluentui/react-icons";
import type { ExecutiveConversationList, ExecutiveMessage, ExecutiveReportKind, ExecutiveState, ExecutiveTurn } from "@orbit-web/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "../../components/Markdown";
import { useResource } from "../../hooks/useResource";
import { useViewport } from "../../hooks/useViewport";
import { useI18n } from "../../i18n";
import { errorText, newIdempotencyKey } from "../../services/api";
import { useAppEvent } from "../../services/events/AppEvents";
import { Composer } from "../composer/Composer";
import { Callout } from "../office/parts";
import { executive } from "./api";
import { MissionLinkCard, MissionProposalCard, SystemReportCard } from "./cards";
import { AssignWorkCard, QuickActions } from "./CeoParts";
import { openTurns } from "./executiveReducer";
import { useConversation } from "./useConversation";

const useStyles = makeStyles({
  home: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "18px", flexGrow: 1, padding: "24px", overflowY: "auto" },
  homeInner: { width: "100%", maxWidth: "760px", display: "flex", flexDirection: "column", gap: "16px" },
  heading: { textAlign: "center", fontSize: tokens.fontSizeHero700, fontWeight: tokens.fontWeightSemibold, lineHeight: tokens.lineHeightHero700 },
  recent: { display: "flex", flexDirection: "column", gap: "4px" },
  recentItem: { justifyContent: "flex-start", width: "100%" },
  muted: { color: tokens.colorNeutralForeground3 },
  timeline: { flexGrow: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "14px", minHeight: 0 },
  timelineInner: { width: "100%", maxWidth: "820px", marginLeft: "auto", marginRight: "auto", display: "flex", flexDirection: "column", gap: "14px" },
  owner: { alignSelf: "flex-end", maxWidth: "80%", padding: "8px 12px", borderRadius: "14px", backgroundColor: tokens.colorBrandBackground2, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  ceo: { display: "flex", gap: "10px", alignItems: "flex-start", maxWidth: "100%" },
  ceoBody: { display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, flexGrow: 1 },
  who: { display: "flex", gap: "6px", alignItems: "baseline", flexWrap: "wrap" },
  notice: { alignSelf: "center", maxWidth: "90%", padding: "6px 10px", borderRadius: "10px", backgroundColor: tokens.colorNeutralBackground3, color: tokens.colorNeutralForeground2, fontSize: tokens.fontSizeBase200 },
  status: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", color: tokens.colorNeutralForeground3 },
  foot: { padding: "8px 16px 16px", display: "flex", flexDirection: "column", gap: "8px", width: "100%", maxWidth: "852px", marginLeft: "auto", marginRight: "auto", boxSizing: "border-box" },
  footMobile: { padding: "6px 8px max(10px, env(safe-area-inset-bottom))" },
});

// Whether the composer takes a message now (the CEO answers -- now, or once its run ends), and what to say above it.
function composerState(t: ReturnType<typeof useI18n>["t"], state: ExecutiveState): { canSend: boolean; notice: string | null } {
  if (state.converse.ok) return { canSend: true, notice: null };
  return { canSend: false, notice: `${t("executive.unavailable.title")}: ${state.converse.reason ?? ""} ${t("executive.unavailable.records")}`.trim() };
}

export function CeoHome({ state, go }: { state: ExecutiveState; go: (conversationId: string | null) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [changed, setChanged] = useState(0);
  useAppEvent("executive.conversation.created", () => setChanged((n) => n + 1));
  const list = useResource<ExecutiveConversationList>(() => executive.conversations(), [changed]);
  const c = composerState(t, state);
  const run = async (work: () => Promise<{ conversationId: string }>) => {
    setBusy(true);
    setProblem(null);
    try {
      go((await work()).conversationId);
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={s.home}>
      <div className={s.homeInner}>
        <Text as="h1" className={s.heading}>
          {t("executive.home.heading")}
        </Text>
        {c.notice !== null && <Callout tone="warn">{c.notice}</Callout>}
        {!state.assign.ok && state.assign.reason !== null && (
          <Text size={200} className={s.muted}>
            {t("executive.assignBlocked")} {state.assign.reason}
          </Text>
        )}
        {assigning ? (
          <AssignWorkCard onCancel={() => setAssigning(false)} onGive={(body, key) => run(() => executive.startWithMission(body, key))} />
        ) : (
          <Composer placeholder={t("executive.home.placeholder")} canSend={c.canSend && !busy} running={false} busy={busy} autoFocus onSend={(text) => void run(() => executive.start(text, newIdempotencyKey()))} above={problem !== null ? <Text className={s.muted}>{problem}</Text> : undefined} />
        )}
        <QuickActions onReport={(kind: ExecutiveReportKind) => void run(() => executive.startWithReport(kind, newIdempotencyKey()))} onAssign={() => setAssigning(true)} canAssign={state.assign.ok} busy={busy} />
        <div className={s.recent}>
          <Text weight="semibold">{t("executive.home.recent")}</Text>
          {list.data === null ? (
            <Spinner size="tiny" />
          ) : list.data.conversations.length === 0 ? (
            <Text size={200} className={s.muted}>
              {t("executive.home.noRecent")}
            </Text>
          ) : (
            list.data.conversations.slice(0, 10).map((conv) => (
              <Button key={conv.id} className={s.recentItem} appearance="subtle" onClick={() => go(conv.id)}>
                {conv.title}
              </Button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function turnLine(t: ReturnType<typeof useI18n>["t"], turn: ExecutiveTurn): string {
  if (turn.state === "queued") return t("executive.turn.queued");
  if (turn.state === "waiting") return turn.waitingReason !== null ? t("executive.turn.waitingWhy", { reason: turn.waitingReason }) : t("executive.turn.waiting", { name: turn.authorName });
  if (turn.state === "running") return t("executive.turn.running", { name: turn.authorName });
  const word = turn.state === "interrupted" ? t("executive.turn.interrupted") : turn.state === "cancelled" ? t("executive.turn.cancelled") : t("executive.turn.failed");
  return turn.detail !== null ? `${word}: ${turn.detail}` : word;
}

function OneMessage({ m, conversationId, canAssign, links }: { m: ExecutiveMessage; conversationId: string; canAssign: boolean; links: { missionId: string; messageId: string; title: string }[] }) {
  const { t } = useI18n();
  const s = useStyles();
  const linked = links.filter((l) => l.messageId === m.id);
  if (m.role === "owner")
    return (
      <>
        <div className={s.owner} aria-label={t("executive.message.you")}>
          {m.text}
        </div>
        {linked.map((l) => (
          <MissionLinkCard key={l.missionId} missionId={l.missionId} title={l.title} />
        ))}
      </>
    );
  if (m.role === "system")
    return m.report !== null ? (
      <SystemReportCard report={m.report} />
    ) : (
      <div className={s.notice} role="note" aria-label={t("executive.message.orbit")}>
        {m.text}
      </div>
    );
  return (
    <div className={s.ceo}>
      <Avatar name={m.author.name} color="colorful" size={28} />
      <div className={s.ceoBody}>
        <div className={s.who}>
          <Text weight="semibold">{m.author.current ? t("executive.message.ceo", { name: m.author.name }) : t("executive.message.former", { name: m.author.name })}</Text>
          {m.model !== null && (
            <Text size={100} className={s.muted}>
              {m.model}
            </Text>
          )}
          {m.partial && (
            <Text size={100} className={s.muted}>
              {t("executive.message.partial")}
            </Text>
          )}
        </div>
        <Markdown text={m.text} />
        {m.proposalNote !== null && <Callout tone="info">{m.proposalNote}</Callout>}
        {m.proposal !== null && <MissionProposalCard conversationId={conversationId} message={m} canAssign={canAssign} />}
        {linked.map((l) => (
          <MissionLinkCard key={l.missionId} missionId={l.missionId} title={l.title} />
        ))}
      </div>
    </div>
  );
}

export function CeoConversation({ conversationId, state, onRecords }: { conversationId: string; state: ExecutiveState; onRecords: (lines: string[]) => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile } = useViewport();
  const { view, loading, error, connected, loadOlder } = useConversation(conversationId);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const open = openTurns(view);
  const running = open.find((x) => x.state === "running") ?? null;
  const lastEnded = useMemo(() => [...view.turns].reverse().find((x) => ["failed", "interrupted", "cancelled"].includes(x.state)) ?? null, [view.turns]);
  const lastCompleted = useMemo(() => [...view.turns].reverse().find((x) => x.records.length > 0) ?? null, [view.turns]);
  const c = composerState(t, state);
  useEffect(() => {
    onRecords(lastCompleted?.records ?? []);
  }, [lastCompleted, onRecords]);
  // A block, returning nothing: scrollIntoView() answers a promise now, and an effect's return is its clean-up.
  useEffect(() => {
    void bottom.current?.scrollIntoView?.({ block: "end" });
  }, [view.messages.length, view.live?.text.length, open.length]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await work();
    } catch (err) {
      setProblem(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  // An ended answer may be asked again only when it is the newest and nothing else is on its way.
  const retryable = lastEnded !== null && open.length === 0 && view.turns.at(-1)?.id === lastEnded.id;

  if (loading && view.messages.length === 0)
    return (
      <div className={s.home}>
        <Spinner />
      </div>
    );
  return (
    <>
      <div className={s.timeline}>
        <div className={s.timelineInner}>
          {error !== null && (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}
          {view.hasOlder && (
            <Button appearance="subtle" onClick={() => void act(loadOlder)}>
              {t("executive.message.olders")}
            </Button>
          )}
          {view.messages.map((m) => (
            <OneMessage key={m.id} m={m} conversationId={conversationId} canAssign={state.assign.ok} links={view.links} />
          ))}
          {view.live !== null && (
            <div className={s.ceo} aria-live="polite">
              <Avatar name={view.live.authorName} color="colorful" size={28} />
              <div className={s.ceoBody}>
                <Text weight="semibold">{t("executive.message.ceo", { name: view.live.authorName })}</Text>
                {view.live.text === "" ? <Spinner size="tiny" /> : <Markdown text={view.live.text} />}
              </div>
            </div>
          )}
          {open
            .filter((x) => x.state !== "running" || view.live === null)
            .map((x) => (
              <div key={x.id} className={s.status} role="status">
                <Spinner size="extra-tiny" />
                <Text size={200}>{turnLine(t, x)}</Text>
              </div>
            ))}
          {retryable && lastEnded !== null && (
            <div className={s.status} role="status">
              <Text size={200}>{turnLine(t, lastEnded)}</Text>
              <Button size="small" icon={<ArrowClockwise16Regular />} disabled={busy || !c.canSend} onClick={() => void act(() => executive.retry(conversationId, lastEnded.id))}>
                {t("executive.turn.retry")}
              </Button>
            </div>
          )}
          {!connected && !loading && (
            <Text size={200} className={s.muted}>
              {t("executive.page.reconnecting")}
            </Text>
          )}
          <div ref={bottom} />
        </div>
      </div>
      <div className={mergeClasses(s.foot, isMobile && s.footMobile)}>
        {c.notice !== null && <Callout tone="warn">{c.notice}</Callout>}
        {problem !== null && (
          <MessageBar intent="error">
            <MessageBarBody>{problem}</MessageBarBody>
          </MessageBar>
        )}
        {assigning ? (
          <AssignWorkCard onCancel={() => setAssigning(false)} onGive={async (body, key) => { await executive.give(conversationId, { proposalMessageId: null, ...body }, key); setAssigning(false); }} />
        ) : (
          <Composer
            placeholder={t("executive.home.placeholder")}
            canSend={c.canSend && !busy}
            running={running !== null}
            busy={busy}
            onSend={(text) => void act(() => executive.send(conversationId, text, newIdempotencyKey()))}
            onStop={running !== null ? () => void act(() => executive.stop(conversationId, running.id)) : undefined}
          />
        )}
        <QuickActions onReport={(kind) => void act(() => executive.report(conversationId, kind))} onAssign={() => setAssigning(true)} canAssign={state.assign.ok} busy={busy} />
      </div>
    </>
  );
}
