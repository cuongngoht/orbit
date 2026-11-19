// The chat workspace: sessions on the left, the open chat (or a new one) in the middle, and on the right what changed
// in the workspace and what Orbit says about it.
import { Button, Spinner, Tab, TabList, Tooltip, makeStyles, tokens } from "@fluentui/react-components";
import { PanelRightContract20Regular, PanelRightExpand20Regular } from "@fluentui/react-icons";
import type { ModelChoice, SessionDetail, SessionSummary } from "@orbit-web/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChangesPanel } from "../features/changes/ChangesPanel";
import { ChatView } from "../features/chat/ChatView";
import { OrbitPanel } from "../features/orbit/OrbitPanel";
import { NewChat } from "../features/sessions/NewChat";
import { Sidebar } from "../features/sessions/Sidebar";
import { useResource } from "../hooks/useResource";
import { useSessionStream } from "../hooks/useSessionStream";
import { get } from "../services/api";

const useStyles = makeStyles({
  root: { display: "grid", gridTemplateColumns: "280px minmax(0, 1fr)", height: "100%", minHeight: 0 },
  side: { borderRight: `1px solid ${tokens.colorNeutralStroke2}`, minHeight: 0 },
  main: { minHeight: 0, overflow: "hidden", position: "relative" },
  right: { width: "420px", borderLeft: `1px solid ${tokens.colorNeutralStroke2}`, display: "flex", flexDirection: "column", minHeight: 0 },
  rightBody: { padding: "12px", overflowY: "auto", flexGrow: 1 },
  toggle: { position: "absolute", top: "10px", right: "10px", zIndex: 1 },
});

function OpenChat({ sessionId, onChanged }: { sessionId: string; onChanged: () => void }) {
  const s = useStyles();
  const { state, connected } = useSessionStream(sessionId);
  const detail = useResource<SessionDetail>(() => get(`/api/sessions/${sessionId}`), [sessionId]);
  const [tab, setTab] = useState<"changes" | "orbit">("changes");
  const [showRight, setShowRight] = useState(true);
  const status = state.status;

  // Reload the header (title, model, status) whenever the session's status changes.
  useEffect(() => {
    void detail.reload();
    onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // The changes panel reads git again after each tool and each run end.
  const version = useMemo(() => state.items.filter((i) => (i.kind === "tool" && i.state !== "running") || i.kind === "run-end" || i.kind === "workspace").length, [state.items]);

  if (detail.error) return <div style={{ padding: 16 }}>{detail.error}</div>;
  if (detail.data === null) return <Spinner label="Opening the chat…" />;
  return (
    <div style={{ display: "flex", height: "100%" }}>
      <div className={s.main} style={{ flexGrow: 1 }}>
        <Tooltip content={showRight ? "Hide changes and Orbit" : "Show changes and Orbit"} relationship="label">
          <Button className={s.toggle} appearance="subtle" icon={showRight ? <PanelRightContract20Regular /> : <PanelRightExpand20Regular />} onClick={() => setShowRight(!showRight)} />
        </Tooltip>
        <ChatView
          session={detail.data}
          chat={state}
          connected={connected}
          onChanged={() => {
            void detail.reload();
            onChanged();
          }}
        />
      </div>
      {showRight && (
        <aside className={s.right} aria-label="Changes and Orbit">
          <TabList selectedValue={tab} onTabSelect={(_, d) => setTab(d.value as "changes" | "orbit")}>
            <Tab value="changes">Changes</Tab>
            <Tab value="orbit">Orbit</Tab>
          </TabList>
          <div className={s.rightBody}>{tab === "changes" ? <ChangesPanel sessionId={sessionId} version={version} /> : <OrbitPanel sessionId={sessionId} live={state.orbit} />}</div>
        </aside>
      )}
    </div>
  );
}

export function ChatPage({ sessionId, defaultModel, onOpen }: { sessionId: string | null; defaultModel: ModelChoice; onOpen: (id: string | null) => void }) {
  const s = useStyles();
  const sessions = useResource<SessionSummary[]>(() => get("/api/sessions"), [], 15_000);
  const reload = useCallback(() => void sessions.reload(), [sessions]);
  return (
    <div className={s.root}>
      <div className={s.side}>
        <Sidebar sessions={sessions.data ?? []} selected={sessionId} onSelect={onOpen} onChanged={reload} />
      </div>
      <main className={s.main}>
        {sessionId === null ? (
          <NewChat
            defaultModel={defaultModel}
            onCreated={(created) => {
              reload();
              onOpen(created.id);
            }}
          />
        ) : (
          <OpenChat key={sessionId} sessionId={sessionId} onChanged={reload} />
        )}
      </main>
    </div>
  );
}
