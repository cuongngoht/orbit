// One open chat: its header (repository, branch, model, status), the conversation, and the input.
import { Badge, Field, MessageBar, MessageBarBody, Select, Text, makeStyles, tokens } from "@fluentui/react-components";
import { BranchFork16Regular } from "@fluentui/react-icons";
import { ACCEPTS_MESSAGES, MODEL_CHOICES, MODEL_LABELS, type ModelChoice, type SessionDetail } from "@orbit-web/contracts";
import { useEffect, useRef, useState } from "react";
import { SessionStatusBadge } from "../../components/StatusBadge";
import { errorText, send } from "../../services/api";
import type { ChatState } from "./chatReducer";
import { Composer } from "./Composer";
import { Timeline } from "./Timeline";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", height: "100%", minWidth: 0 },
  header: { display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", padding: "10px 16px", borderBottom: `1px solid ${tokens.colorNeutralStroke2}` },
  title: { flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  meta: { color: tokens.colorNeutralForeground3, display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" },
  scroll: { flexGrow: 1, overflowY: "auto", padding: "16px" },
  inner: { maxWidth: "880px", margin: "0 auto" },
  composer: { borderTop: `1px solid ${tokens.colorNeutralStroke2}`, padding: "12px 16px" },
  composerInner: { maxWidth: "880px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "8px" },
});

export function ChatView({ session, chat, connected, onChanged }: { session: SessionDetail; chat: ChatState; connected: boolean; onChanged: () => void }) {
  const s = useStyles();
  const scroller = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const status = chat.status ?? session.status;
  const running = status === "running";

  useEffect(() => {
    const el = scroller.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 240) el.scrollTop = el.scrollHeight;
  }, [chat.items]);

  const act = async (work: () => Promise<unknown>) => {
    setError(null);
    try {
      await work();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  };

  const sendMessage = async (text: string) => {
    setSending(true);
    await act(() => send("POST", `/api/sessions/${session.id}/messages`, { text }));
    setSending(false);
  };

  return (
    <section className={s.root} aria-label="Chat">
      <header className={s.header}>
        <div className={s.title}>
          <Text weight="semibold" truncate wrap={false}>
            {session.title}
          </Text>
          <span className={s.meta}>
            <Text size={200}>{session.repository}</Text>
            <BranchFork16Regular />
            <Text size={200}>
              {session.branch}
              {session.workBranch ? ` → ${session.workBranch}` : ""}
            </Text>
          </span>
        </div>
        <Field label="Model" orientation="horizontal">
          <Select value={session.model} disabled={running} onChange={(_, d) => void act(() => send("PATCH", `/api/sessions/${session.id}`, { model: d.value as ModelChoice }))} aria-label="Claude model">
            {MODEL_CHOICES.map((m) => (
              <option key={m} value={m}>
                {MODEL_LABELS[m]}
              </option>
            ))}
          </Select>
        </Field>
        <SessionStatusBadge status={status} />
        {!connected && (
          <Badge appearance="outline" color="warning">
            Reconnecting…
          </Badge>
        )}
      </header>
      <div className={s.scroll} ref={scroller}>
        <div className={s.inner}>
          <Timeline items={chat.items} />
        </div>
      </div>
      <div className={s.composer}>
        <div className={s.composerInner}>
          {error && (
            <MessageBar intent="error">
              <MessageBarBody>{error}</MessageBarBody>
            </MessageBar>
          )}
          <Composer
            placeholder={status === "preparing" ? "The workspace is being prepared…" : "Ask Orbit…"}
            disabled={!ACCEPTS_MESSAGES.includes(status)}
            busy={sending}
            running={running}
            onSend={(text) => void sendMessage(text)}
            onStop={() => void act(() => send("POST", `/api/sessions/${session.id}/stop`))}
          />
        </div>
      </div>
    </section>
  );
}
