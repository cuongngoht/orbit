// ONE OPEN CHAT: its title and status above, the conversation, and the composer always at the bottom -- with the
// repository and branch the chat started from (fixed), and the model, effort and mode it runs with (changed here, they
// apply from the next message). On the right, when asked: what changed in the workspace, and what Orbit says.
import { Badge, Button, MessageBar, MessageBarBody, Spinner, Tab, TabList, Text, ToggleButton, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { BranchFork16Regular, Dismiss20Regular, DocumentBulletList20Regular, Info20Regular } from "@fluentui/react-icons";
import { ACCEPTS_MESSAGES, type SessionDetail, type SessionSummary, type UpdateSessionRequest } from "@orbit-web/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { SessionStatusBadge } from "../../components/StatusBadge";
import { SourceMark } from "../../components/SourceMark";
import { useResource } from "../../hooks/useResource";
import { useSessionStream } from "../../hooks/useSessionStream";
import { errorText, get, send } from "../../services/api";
import { ChangesPanel } from "../changes/ChangesPanel";
import { Composer } from "../composer/Composer";
import { ModelEffortPicker, ModePicker } from "../composer/RunPickers";
import { OrbitPanel } from "../orbit/OrbitPanel";
import { Timeline } from "./Timeline";

const useStyles = makeStyles({
  root: { display: "flex", height: "100%", minHeight: 0 },
  main: { flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  top: { display: "flex", alignItems: "center", gap: "10px", padding: "10px 16px", minHeight: "32px" },
  title: { flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  scroll: { flexGrow: 1, overflowY: "auto", padding: "8px 20px 16px" },
  inner: { maxWidth: "820px", margin: "0 auto" },
  bottom: { padding: "0 20px 20px" },
  chip: { display: "inline-flex", alignItems: "center", gap: "6px", padding: "2px 8px", color: tokens.colorNeutralForeground2, maxWidth: "260px", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" },
  right: { width: "400px", flexShrink: 0, borderLeft: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", minHeight: 0, backgroundColor: tokens.colorNeutralBackground1 },
  rightTop: { display: "flex", alignItems: "center", gap: "4px", padding: "6px 8px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  rightBody: { padding: "12px", overflowY: "auto", flexGrow: 1 },
});

type Panel = "changes" | "orbit";

export function ChatScreen({ sessionId, onUpdated }: { sessionId: string; onUpdated: (s: SessionSummary) => void }) {
  const s = useStyles();
  const { state, connected } = useSessionStream(sessionId);
  const detail = useResource<SessionDetail>(() => get(`/api/sessions/${sessionId}`), [sessionId]);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const status = state.status ?? detail.data?.status ?? "preparing";
  const running = status === "running";

  // The header (title, preferences, status) is read again whenever the chat's status changes.
  useEffect(() => {
    void detail.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the status is what moves it
  }, [state.status]);

  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight;
  }, [state.items]);

  // The changes panel reads git again after each tool and each run end.
  const version = useMemo(() => state.items.filter((i) => (i.kind === "tool" && i.state !== "running") || i.kind === "run-end" || i.kind === "workspace").length, [state.items]);

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

  return (
    <div className={s.root}>
      <section className={s.main} aria-label="Chat">
        <header className={s.top}>
          <Text weight="semibold" className={s.title}>
            {session.title}
          </Text>
          <SessionStatusBadge status={status} />
          {!connected && (
            <Badge appearance="outline" color="warning">
              Reconnecting…
            </Badge>
          )}
          <Tooltip content="What changed in the workspace" relationship="description">
            <ToggleButton size="small" appearance="subtle" icon={<DocumentBulletList20Regular />} checked={panel === "changes"} onClick={() => setPanel(panel === "changes" ? null : "changes")}>
              Changes
            </ToggleButton>
          </Tooltip>
          <Tooltip content="What Orbit says about the work" relationship="description">
            <ToggleButton size="small" appearance="subtle" icon={<Info20Regular />} checked={panel === "orbit"} onClick={() => setPanel(panel === "orbit" ? null : "orbit")}>
              Orbit
            </ToggleButton>
          </Tooltip>
        </header>
        <div className={s.scroll} ref={scroller}>
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
        <div className={s.bottom}>
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
                <span className={s.chip} title={session.repository ?? "No repository"}>
                  <SourceMark source={session.source} />
                  {session.repository ?? "No repository"}
                </span>
                {session.workBranch && (
                  <span className={s.chip} title={`${session.branch ?? "an empty start"} → ${session.workBranch}`}>
                    <BranchFork16Regular />
                    {session.branch ? `${session.branch} → ${session.workBranch}` : session.workBranch}
                  </span>
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
      {panel && (
        <aside className={s.right} aria-label="Changes and Orbit">
          <div className={s.rightTop}>
            <TabList size="small" selectedValue={panel} onTabSelect={(_, d) => setPanel(d.value as Panel)} style={{ flexGrow: 1 }}>
              <Tab value="changes">Changes</Tab>
              <Tab value="orbit">Orbit</Tab>
            </TabList>
            <Button appearance="subtle" size="small" icon={<Dismiss20Regular />} aria-label="Close the panel" onClick={() => setPanel(null)} />
          </div>
          <div className={s.rightBody}>{panel === "changes" ? <ChangesPanel sessionId={sessionId} version={version} /> : <OrbitPanel sessionId={sessionId} live={state.orbit} />}</div>
        </aside>
      )}
    </div>
  );
}
