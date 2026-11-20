// ONE OPEN CHAT: its title and status above, the conversation, and the composer always at the bottom -- with the
// repository the chat started from (fixed), its working branch (moved here, between runs: WorkBranchPicker), and the
// model, effort and mode it runs with (changed here, they apply from the next message). In the header, Share (a
// read-only link to a snapshot of the conversation). On the right, when asked: what changed in the workspace, and what
// Orbit says.
import { Badge, Button, MessageBar, MessageBarBody, OverlayDrawer, Spinner, Tab, TabList, Text, ToggleButton, Tooltip, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { ArrowDown16Regular, Dismiss20Regular, DocumentBulletList20Regular, Info20Regular, Navigation20Regular } from "@fluentui/react-icons";
import { ACCEPTS_MESSAGES, type SessionDetail, type SessionSummary, type UpdateSessionRequest } from "@orbit-web/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { SessionStatusBadge } from "../../components/StatusBadge";
import { SourceMark } from "../../components/SourceMark";
import { useResource } from "../../hooks/useResource";
import { useSessionStream } from "../../hooks/useSessionStream";
import { useViewport } from "../../hooks/useViewport";
import { errorText, get, send } from "../../services/api";
import { ChangesPanel } from "../changes/ChangesPanel";
import { Composer } from "../composer/Composer";
import { ModelEffortPicker, ModePicker } from "../composer/RunPickers";
import { WorkBranchPicker } from "../composer/WorkBranchPicker";
import { OrbitPanel } from "../orbit/OrbitPanel";
import { PushButton } from "../push/PushButton";
import { ShareButton } from "../share/ShareDialog";
import { Timeline } from "./Timeline";

const useStyles = makeStyles({
  root: { display: "flex", height: "100%", minHeight: 0 },
  main: { flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  top: { display: "flex", alignItems: "center", gap: "10px", paddingTop: "10px", paddingRight: "16px", paddingBottom: "10px", paddingLeft: "16px", minHeight: "32px" },
  topMobile: {
    gap: "6px",
    minHeight: "52px",
    paddingTop: "max(6px, env(safe-area-inset-top))",
    paddingRight: "8px",
    paddingBottom: "6px",
    paddingLeft: "8px",
    ...shorthands.borderBottom("1px", "solid", tokens.colorNeutralStroke2),
  },
  touchBtn: { minWidth: "44px", minHeight: "44px", flexShrink: 0 },
  titleStack: { flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" },
  statusRow: { display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" },
  actions: { display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 },
  title: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  scrollWrap: { position: "relative", flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" },
  scroll: { flexGrow: 1, overflowY: "auto", paddingTop: "8px", paddingRight: "20px", paddingBottom: "16px", paddingLeft: "20px" },
  scrollMobile: { paddingTop: "8px", paddingRight: "12px", paddingBottom: "16px", paddingLeft: "12px" },
  jumpBtn: {
    position: "absolute",
    right: "16px",
    bottom: "12px",
    zIndex: 5,
    boxShadow: tokens.shadow8,
    minHeight: "36px",
    "@media (pointer: coarse)": { minHeight: "44px" },
  },
  inner: { width: "100%", maxWidth: "820px", minWidth: 0, margin: "0 auto" },
  bottom: { paddingTop: "0", paddingRight: "20px", paddingBottom: "20px", paddingLeft: "20px", flexShrink: 0 },
  bottomMobile: { paddingTop: "0", paddingRight: "12px", paddingBottom: "max(12px, env(safe-area-inset-bottom))", paddingLeft: "12px" },
  chip: { display: "inline-flex", alignItems: "center", gap: "6px", paddingTop: "2px", paddingRight: "8px", paddingBottom: "2px", paddingLeft: "8px", color: tokens.colorNeutralForeground2, maxWidth: "260px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
  chipMobile: {
    minHeight: "36px",
    maxWidth: "160px",
    flexShrink: 0,
    borderRadius: "9999px",
    paddingTop: "0",
    paddingRight: "10px",
    paddingBottom: "0",
    paddingLeft: "10px",
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
  },
  chipText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  right: { width: "420px", flexShrink: 0, borderLeft: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", minHeight: 0, backgroundColor: tokens.colorNeutralBackground1 },
  rightInDrawer: { width: "100%", height: "100%", borderLeftStyle: "none" },
  bottomDrawer: {
    width: "100%",
    height: "92dvh",
    borderTopLeftRadius: "20px",
    borderTopRightRadius: "20px",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground1,
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
    backgroundColor: tokens.colorNeutralBackground1,
  },
  grabberWrap: { display: "flex", justifyContent: "center", paddingTop: "10px", paddingBottom: "4px", flexShrink: 0 },
  grabber: { width: "40px", height: "4px", borderRadius: "9999px", backgroundColor: tokens.colorNeutralStroke1 },
  rightTop: { display: "flex", alignItems: "center", gap: "4px", paddingTop: "6px", paddingRight: "8px", paddingBottom: "6px", paddingLeft: "8px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}`, flexShrink: 0 },
  rightBody: { paddingTop: "12px", paddingRight: "12px", paddingBottom: "max(16px, env(safe-area-inset-bottom))", paddingLeft: "12px", overflowY: "auto", flexGrow: 1, minHeight: 0 },
});

type Panel = "changes" | "orbit";

export function ChatScreen({ sessionId, onUpdated, onOpenNav }: { sessionId: string; onUpdated: (s: SessionSummary) => void; onOpenNav?: () => void }) {
  const s = useStyles();
  const { isMobile, isCompact, isNarrowDesktop } = useViewport();
  const { state, connected } = useSessionStream(sessionId);
  const detail = useResource<SessionDetail>(() => get(`/api/sessions/${sessionId}`), [sessionId]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const status = state.status ?? detail.data?.status ?? "preparing";
  const running = status === "running";
  const drawerInspector = isCompact || isNarrowDesktop;

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
      setError(errorText(err));
    }
  };
  const update = async (change: UpdateSessionRequest) => {
    const summary = await send<SessionSummary>("PATCH", `/api/sessions/${sessionId}`, change);
    if (detail.data) detail.set({ ...detail.data, ...summary });
    onUpdated(summary);
  };
  const say = async (text: string) => {
    setSending(true);
    await attempt(() => send("POST", `/api/sessions/${sessionId}/messages`, { text }));
    setSending(false);
  };

  if (detail.error && detail.data === null)
    return (
      <MessageBar intent="error" style={{ margin: 16 }}>
        <MessageBarBody>{detail.error}</MessageBarBody>
      </MessageBar>
    );
  if (detail.data === null) return <Spinner style={{ marginTop: 48 }} label="Opening the chat…" />;
  const session = detail.data;
  const canSend = ACCEPTS_MESSAGES.includes(status);

  const inspectorNode = (
    <aside className={mergeClasses(s.right, drawerInspector && s.rightInDrawer)} aria-label="Changes and Orbit">
      {isMobile && (
        <div className={s.grabberWrap} aria-hidden>
          <span className={s.grabber} />
        </div>
      )}
      <div className={s.rightTop}>
        <TabList size="small" selectedValue={panel ?? "changes"} onTabSelect={(_, d) => setPanel(d.value as Panel)} style={{ flexGrow: 1 }}>
          <Tab value="changes">Changes</Tab>
          <Tab value="orbit">Orbit</Tab>
        </TabList>
        <Button className={isMobile || isCompact ? s.touchBtn : undefined} appearance="subtle" size="small" icon={<Dismiss20Regular />} aria-label="Close the panel" onClick={() => setPanel(null)} />
      </div>
      <div className={s.rightBody}>{panel === "changes" ? <ChangesPanel sessionId={sessionId} version={version} /> : <OrbitPanel sessionId={sessionId} live={state.orbit} />}</div>
    </aside>
  );

  return (
    <div className={s.root}>
      <section className={s.main} aria-label="Chat">
        <header className={mergeClasses(s.top, isMobile && s.topMobile)}>
          {onOpenNav && <Button className={s.touchBtn} appearance="subtle" icon={<Navigation20Regular />} aria-label="Open navigation" onClick={onOpenNav} />}
          {isMobile ? (
            <div className={s.titleStack}>
              <Text weight="semibold" className={s.title}>
                {session.title}
              </Text>
              <div className={s.statusRow}>
                <SessionStatusBadge status={status} />
                {!connected && (
                  <Badge appearance="outline" color="warning" size="small">
                    Reconnecting…
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
                  Reconnecting…
                </Badge>
              )}
            </>
          )}
          <div className={s.actions}>
            <PushButton session={session} compact={isMobile} />
            <ShareButton sessionId={sessionId} compact={isMobile} />
            <Tooltip content="What changed in the workspace" relationship="description">
              <ToggleButton
                className={isMobile ? s.touchBtn : undefined}
                size="small"
                appearance="subtle"
                icon={<DocumentBulletList20Regular />}
                aria-label="Changes"
                checked={panel === "changes"}
                onClick={() => setPanel(panel === "changes" ? null : "changes")}
              >
                {!isMobile && "Changes"}
              </ToggleButton>
            </Tooltip>
            <Tooltip content="What Orbit says about the work" relationship="description">
              <ToggleButton
                className={isMobile ? s.touchBtn : undefined}
                size="small"
                appearance="subtle"
                icon={<Info20Regular />}
                aria-label="Orbit"
                checked={panel === "orbit"}
                onClick={() => setPanel(panel === "orbit" ? null : "orbit")}
              >
                {!isMobile && "Orbit"}
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
                  canRunPlan: canSend && !sending,
                  onRunPlan: () =>
                    void attempt(async () => {
                      await update({ mode: "autonomous" });
                      await say("Carry out the plan above.");
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
              aria-label="Jump to latest"
              onClick={() => {
                const el = scroller.current;
                if (el) el.scrollTop = el.scrollHeight;
                setAwayFromBottom(false);
              }}
            >
              Latest
            </Button>
          )}
        </div>
        <div className={mergeClasses(s.bottom, isMobile && s.bottomMobile)}>
          <Composer
            placeholder={status === "preparing" ? "The workspace is being prepared…" : "Reply to Orbit…"}
            canSend={canSend}
            running={running}
            busy={sending}
            onSend={(text) => void say(text)}
            onStop={() => void attempt(() => send("POST", `/api/sessions/${sessionId}/stop`))}
            commandsPath={`/api/sessions/${sessionId}/commands`}
            commandsVersion={status === "preparing" ? 0 : 1}
            above={
              error && (
                <MessageBar intent="error">
                  <MessageBarBody>{error}</MessageBarBody>
                </MessageBar>
              )
            }
            left={
              <>
                <span className={mergeClasses(s.chip, isMobile && s.chipMobile)} title={session.repository ?? "No repository"}>
                  <SourceMark source={session.source} />
                  <span className={s.chipText}>{session.repository ?? "No repository"}</span>
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
              <>
                <ModelEffortPicker model={session.model} effort={session.effort} onModel={(model) => void attempt(() => update({ model }))} onEffort={(effort) => void attempt(() => update({ effort }))} />
                <ModePicker mode={session.mode} onMode={(mode) => void attempt(() => update({ mode }))} />
              </>
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
