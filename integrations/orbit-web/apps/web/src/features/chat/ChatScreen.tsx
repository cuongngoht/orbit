// ONE OPEN CHAT: its title and status above, the conversation, and the composer always at the bottom -- with the
// repository the chat started from (fixed), its working branch (moved here, between runs: WorkBranchPicker), and the
// model, effort and mode it runs with (changed here, they apply from the next message). In the header, Share (a
// read-only link to a snapshot of the conversation). On the right, when asked: what changed in the workspace, and what
// Orbit says.
import { Badge, Button, MessageBar, MessageBarBody, OverlayDrawer, Spinner, Tab, TabList, Text, ToggleButton, Tooltip, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { ArrowDown16Regular, Dismiss20Regular, DocumentBulletList20Regular, Info20Regular, Navigation20Regular } from "@fluentui/react-icons";
import { ACCEPTS_MESSAGES, chatImagePath, RUNTIME_LABELS, type SessionDetail, type SessionSummary, type UpdateSessionRequest } from "@orbit-web/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiErrorBar } from "../../components/ApiErrorBar";
import { SessionStatusBadge } from "../../components/StatusBadge";
import { SourceMark } from "../../components/SourceMark";
import { useResource } from "../../hooks/useResource";
import { useSessionStream } from "../../hooks/useSessionStream";
import { useViewport } from "../../hooks/useViewport";
import { useI18n } from "../../i18n";
import { get, send } from "../../services/api";
import { uploadImage } from "../../services/images";
import { ChangesPanel } from "../changes/ChangesPanel";
import { Composer } from "../composer/Composer";
import { catalogOfConnection, ModelCatalogOverride, useModelCatalog } from "../../services/models/ModelCatalog";
import { useConnections } from "../connections/AiConnectionsSection";
import { AiPicker, autoModeWith, ModelEffortPicker, ModePicker } from "../composer/RunPickers";
import { WorkBranchPicker } from "../composer/WorkBranchPicker";
import { OrbitPanel } from "../orbit/OrbitPanel";
import { PushButton } from "../push/PushButton";
import { ShareButton } from "../share/ShareDialog";
import { Timeline } from "./Timeline";

const useStyles = makeStyles({
  root: { display: "flex", width: "100%", maxWidth: "100%", height: "100%", minHeight: 0, overflow: "hidden" },
  main: { flexGrow: 1, minWidth: 0, maxWidth: "100%", overflow: "hidden", display: "flex", flexDirection: "column" },
  top: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    minWidth: 0,
    maxWidth: "100%",
    overflow: "hidden",
    paddingTop: "8px",
    paddingRight: "16px",
    paddingBottom: "8px",
    paddingLeft: "16px",
    minHeight: "52px",
    backgroundColor: "var(--orbit-header-bg)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
  },
  topMobile: {
    gap: "6px",
    minHeight: "52px",
    paddingTop: "max(6px, env(safe-area-inset-top))",
    paddingRight: "8px",
    paddingBottom: "6px",
    paddingLeft: "8px",
  },
  touchBtn: { minWidth: "44px", minHeight: "44px", flexShrink: 0 },
  titleStack: { flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" },
  statusRow: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" },
  actions: { display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 },
  title: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  titleMobile: { fontSize: "15px", letterSpacing: "-0.01em" },
  scrollWrap: { position: "relative", flexGrow: 1, minHeight: 0, minWidth: 0, maxWidth: "100%", overflow: "hidden", display: "flex", flexDirection: "column" },
  scroll: { flexGrow: 1, minWidth: 0, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", paddingTop: "12px", paddingRight: "20px", paddingBottom: "38px", paddingLeft: "20px" },
  scrollMobile: { paddingTop: "10px", paddingRight: "16px", paddingBottom: "48px", paddingLeft: "16px" },
  scrollFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "44px",
    pointerEvents: "none",
    backgroundImage: "linear-gradient(to bottom, transparent 0%, var(--orbit-fade-bg) 82%)",
  },
  jumpBtn: {
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
  inner: { width: "100%", maxWidth: "820px", minWidth: 0, marginTop: 0, marginRight: "auto", marginBottom: 0, marginLeft: "auto" },
  bottom: { paddingTop: "2px", paddingRight: "20px", paddingBottom: "18px", paddingLeft: "20px", flexShrink: 0, minWidth: 0, maxWidth: "100%" },
  bottomMobile: { paddingTop: "2px", paddingRight: "12px", paddingBottom: "max(10px, var(--orbit-safe-bottom, env(safe-area-inset-bottom)))", paddingLeft: "12px" },
  chip: { display: "inline-flex", alignItems: "center", gap: "6px", minHeight: "30px", borderRadius: "9999px", paddingTop: "2px", paddingRight: "8px", paddingBottom: "2px", paddingLeft: "8px", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground2, maxWidth: "200px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
  chipMobile: {
    minHeight: "34px",
    maxWidth: "164px",
    flexShrink: 0,
    borderRadius: "9999px",
    paddingTop: "0",
    paddingRight: "10px",
    paddingBottom: "0",
    paddingLeft: "10px",
    backgroundColor: tokens.colorNeutralBackground2,
  },
  chipText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  right: { width: "420px", flexShrink: 0, borderLeft: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", minHeight: 0, backgroundColor: tokens.colorNeutralBackground1 },
  rightInDrawer: { width: "100%", height: "100%", borderLeftStyle: "none" },
  bottomDrawer: {
    width: "100%",
    height: "92dvh",
    borderTopLeftRadius: "24px",
    borderTopRightRadius: "24px",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    overflow: "hidden",
    backgroundColor: "var(--orbit-card-bg)",
  },
  endDrawer: {
    width: "min(440px, 90vw)",
    maxWidth: "100%",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    overflow: "hidden",
    backgroundColor: "var(--orbit-card-bg)",
  },
  grabberWrap: { display: "flex", justifyContent: "center", paddingTop: "10px", paddingBottom: "4px", flexShrink: 0 },
  grabber: { width: "36px", height: "4px", borderRadius: "9999px", backgroundColor: tokens.colorNeutralStroke1, opacity: 0.45 },
  rightTop: { display: "flex", alignItems: "center", gap: "4px", paddingTop: "6px", paddingRight: "8px", paddingBottom: "6px", paddingLeft: "8px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, flexShrink: 0 },
  rightBody: { paddingTop: "12px", paddingRight: "12px", paddingBottom: "max(16px, env(safe-area-inset-bottom))", paddingLeft: "12px", overflowY: "auto", flexGrow: 1, minHeight: 0 },
});

type Panel = "changes" | "orbit";

export function ChatScreen({ sessionId, onUpdated, onOpenNav }: { sessionId: string; onUpdated: (s: SessionSummary) => void; onOpenNav?: () => void }) {
  const { t } = useI18n();
  const s = useStyles();
  const { isMobile, isCompact, isNarrowDesktop } = useViewport();
  const { state, connected } = useSessionStream(sessionId);
  const detail = useResource<SessionDetail>(() => get(`/api/sessions/${sessionId}`), [sessionId]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const status = state.status ?? detail.data?.status ?? "preparing";
  const running = status === "running";
  const drawerInspector = isCompact || isNarrowDesktop;
  // A chat on a connection it named (OpenAI Codex, say) offers that connection's own models; else the account's.
  const accountCatalog = useModelCatalog();
  const connections = useConnections();
  const named = detail.data?.connectionId ? ((connections.data?.connections ?? []).find((c) => c.id === detail.data?.connectionId) ?? null) : null;
  const catalog = named !== null ? catalogOfConnection(named) : accountCatalog;
  // The AI the chat runs on, said for every chat: the connection it named, else its own runtime (the default Claude Code).
  const ai = named ?? (detail.data ? { id: detail.data.connectionId ?? "default", runtime: detail.data.runtime, label: RUNTIME_LABELS[detail.data.runtime] } : null);

  // The header (title, preferences, status, working branch) is read again whenever the chat's status changes, or its
  // working branch moved (in this tab or another).
  const branchMoves = useMemo(() => state.items.filter((i) => i.kind === "branch").length, [state.items]);
  useEffect(() => {
    void detail.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the status and the branch moves are what move it
  }, [state.status, branchMoves]);

  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight;
  }, [state.items]);

  // The changes panel reads git again after each tool and each run end.
  const version = useMemo(() => state.items.filter((i) => (i.kind === "tool" && i.state !== "running") || i.kind === "run-end" || i.kind === "workspace" || i.kind === "branch").length, [state.items]);

  const attempt = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err);
    }
  };
  const update = async (change: UpdateSessionRequest) => {
    const summary = await send<SessionSummary>("PATCH", `/api/sessions/${sessionId}`, change);
    if (detail.data) detail.set({ ...detail.data, ...summary });
    onUpdated(summary);
  };
  const say = async (text: string, images: string[] = []) => {
    setSending(true);
    await attempt(() => send("POST", `/api/sessions/${sessionId}/messages`, { text, ...(images.length > 0 ? { images } : {}) }));
    setSending(false);
  };

  if (detail.error && detail.data === null)
    return (
      <MessageBar intent="error" style={{ margin: 16 }}>
        <MessageBarBody>{detail.error}</MessageBarBody>
      </MessageBar>
    );
  if (detail.data === null) return <Spinner style={{ marginTop: 48 }} label={t("chat.screen.openingChat")} />;
  const session = detail.data;
  const canSend = ACCEPTS_MESSAGES.includes(status);

  const inspectorNode = (
    <aside className={mergeClasses(s.right, drawerInspector && s.rightInDrawer)} aria-label={t("chat.screen.inspectorAria")}>
      {isMobile && (
        <div className={s.grabberWrap} aria-hidden>
          <span className={s.grabber} />
        </div>
      )}
      <div className={s.rightTop}>
        <TabList size="small" selectedValue={panel ?? "changes"} onTabSelect={(_, d) => setPanel(d.value as Panel)} style={{ flexGrow: 1 }}>
          <Tab value="changes">{t("chat.screen.tabChanges")}</Tab>
          <Tab value="orbit">{t("chat.screen.tabOrbit")}</Tab>
        </TabList>
        <Button className={isMobile || isCompact ? s.touchBtn : undefined} appearance="subtle" size="small" icon={<Dismiss20Regular />} aria-label={t("chat.screen.closePanelAria")} onClick={() => setPanel(null)} />
      </div>
      <div className={s.rightBody}>{panel === "changes" ? <ChangesPanel sessionId={sessionId} version={version} /> : <OrbitPanel sessionId={sessionId} live={state.orbit} />}</div>
    </aside>
  );

  return (
    <div className={s.root}>
      <section className={s.main} aria-label={t("chat.screen.chatAria")}>
        <header className={mergeClasses(s.top, isMobile && s.topMobile)}>
          {onOpenNav && <Button className={s.touchBtn} appearance="subtle" icon={<Navigation20Regular />} aria-label={t("chat.screen.openNavAria")} onClick={onOpenNav} />}
          {isMobile ? (
            <div className={s.titleStack}>
              <Text weight="semibold" className={mergeClasses(s.title, s.titleMobile)}>
                {session.title}
              </Text>
              <div className={s.statusRow}>
                <SessionStatusBadge status={status} />
                {!connected && (
                  <Badge appearance="outline" color="warning" size="small">
                    {t("chat.screen.reconnecting")}
                  </Badge>
                )}
              </div>
            </div>
          ) : (
            <>
              <Text weight="semibold" className={s.title}>
                {session.title}
              </Text>
              <SessionStatusBadge status={status} />
              {!connected && (
                <Badge appearance="outline" color="warning">
                  {t("chat.screen.reconnecting")}
                </Badge>
              )}
            </>
          )}
          <div className={s.actions}>
            <PushButton session={session} compact={isMobile} />
            <ShareButton sessionId={sessionId} compact={isMobile} access={session.access} />
            <Tooltip content={t("chat.screen.changesTooltip")} relationship="description">
              <ToggleButton
                className={isMobile ? s.touchBtn : undefined}
                size="small"
                appearance="subtle"
                icon={<DocumentBulletList20Regular />}
                aria-label={t("chat.screen.tabChanges")}
                checked={panel === "changes"}
                onClick={() => setPanel(panel === "changes" ? null : "changes")}
              >
                {!isMobile && t("chat.screen.tabChanges")}
              </ToggleButton>
            </Tooltip>
            <Tooltip content={t("chat.screen.orbitTooltip")} relationship="description">
              <ToggleButton
                className={isMobile ? s.touchBtn : undefined}
                size="small"
                appearance="subtle"
                icon={<Info20Regular />}
                aria-label={t("chat.screen.tabOrbit")}
                checked={panel === "orbit"}
                onClick={() => setPanel(panel === "orbit" ? null : "orbit")}
              >
                {!isMobile && t("chat.screen.tabOrbit")}
              </ToggleButton>
            </Tooltip>
          </div>
        </header>
        <div className={s.scrollWrap}>
          <div
            className={mergeClasses(s.scroll, isMobile && s.scrollMobile)}
            ref={scroller}
            onScroll={(e) => {
              const el = e.currentTarget;
              setAwayFromBottom(el.scrollHeight - el.scrollTop - el.clientHeight > 280);
            }}
          >
            <div className={s.inner}>
              <Timeline
                items={state.items}
                actions={{
                  runtime: detail.data?.runtime ?? "claude",
                  imageUrl: (imageId) => chatImagePath(sessionId, imageId),
                  canRunPlan: canSend && !sending,
                  onRunPlan: () =>
                    void attempt(async () => {
                      await update({ mode: "autonomous" });
                      await say(t("chat.screen.carryOutPlan"));
                    }),
                }}
              />
            </div>
          </div>
          {awayFromBottom && (
            <Button
              className={s.jumpBtn}
              shape="circular"
              appearance="secondary"
              size="small"
              icon={<ArrowDown16Regular />}
              aria-label={t("chat.screen.jumpLatestAria")}
              onClick={() => {
                const el = scroller.current;
                if (el) el.scrollTop = el.scrollHeight;
                setAwayFromBottom(false);
              }}
            >
              {t("chat.screen.latest")}
            </Button>
          )}
          <div className={s.scrollFade} aria-hidden />
        </div>
        <div className={mergeClasses(s.bottom, isMobile && s.bottomMobile)}>
          <Composer
            placeholder={status === "preparing" ? t("chat.screen.preparingPlaceholder") : t("chat.screen.replyPlaceholder")}
            canSend={canSend}
            running={running}
            busy={sending}
            onSend={(text, images) => void say(text, images)}
            onUploadImage={uploadImage}
            onStop={() => void attempt(() => send("POST", `/api/sessions/${sessionId}/stop`))}
            commandsPath={`/api/sessions/${sessionId}/commands`}
            commandsVersion={status === "preparing" ? 0 : 1}
            above={error !== null && <ApiErrorBar error={error} />}
            left={
              <>
                <span className={mergeClasses(s.chip, isMobile && s.chipMobile)} title={session.repository ?? t("chat.screen.noRepository")}>
                  <SourceMark source={session.source} />
                  <span className={s.chipText}>{session.repository ?? t("chat.screen.noRepository")}</span>
                </span>
                {session.workBranch && (
                  <WorkBranchPicker
                    sessionId={sessionId}
                    base={session.branch}
                    work={session.workBranch}
                    disabled={!canSend || sending}
                    onMoved={(summary) => {
                      if (detail.data) detail.set({ ...detail.data, ...summary });
                      onUpdated(summary);
                    }}
                  />
                )}
              </>
            }
            right={
              <ModelCatalogOverride catalog={catalog}>
                {/* The AI a chat names is its own for its whole life: said, never offered again. */}
                {ai !== null && <AiPicker choices={[ai]} value={ai.id} readOnly />}
                <ModelEffortPicker
                  model={session.model}
                  effort={session.effort}
                  onModel={(model) => void attempt(() => update({ model, ...(!autoModeWith(catalog, model) && session.mode === "autonomous" ? { mode: "plan" as const } : {}) }))}
                  onEffort={(effort) => void attempt(() => update({ effort }))}
                />
                <ModePicker mode={session.mode} onMode={(mode) => void attempt(() => update({ mode }))} autoMode={autoModeWith(catalog, session.model)} />
              </ModelCatalogOverride>
            }
          />
        </div>
      </section>
      {drawerInspector ? (
        <OverlayDrawer
          open={panel !== null}
          onOpenChange={(_, d) => !d.open && setPanel(null)}
          position={isMobile ? "bottom" : "end"}
          modalType="modal"
          className={isMobile ? s.bottomDrawer : s.endDrawer}
        >
          {panel !== null && inspectorNode}
        </OverlayDrawer>
      ) : (
        panel && inspectorNode
      )}
    </div>
  );
}
