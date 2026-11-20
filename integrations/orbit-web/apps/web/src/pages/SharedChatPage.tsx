// A SHARED CHAT, as its link shows it (`#/share/<token>`): a read-only snapshot of one conversation, opened before --
// and without -- the access token and the Claude sign-in. It asks the API for that one snapshot and nothing else, and
// draws it with the chat's own timeline, so it reads as the chat did. No composer, no workspace, no other chat.
import { MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { SharedChat } from "@orbit-web/contracts";
import { useMemo } from "react";
import { SourceMark } from "../components/SourceMark";
import { chatReducer, emptyChat } from "../features/chat/chatReducer";
import { Timeline } from "../features/chat/Timeline";
import { useResource } from "../hooks/useResource";
import { get } from "../services/api";

const useStyles = makeStyles({
  page: { minHeight: "100dvh", backgroundColor: tokens.colorNeutralBackground1, color: tokens.colorNeutralForeground1 },
  inner: {
    maxWidth: "820px",
    margin: "0 auto",
    paddingTop: "28px",
    paddingRight: "20px",
    paddingBottom: "48px",
    paddingLeft: "20px",
    "@media (max-width: 639px)": { paddingTop: "16px", paddingRight: "12px", paddingBottom: "max(32px, env(safe-area-inset-bottom))", paddingLeft: "12px" },
    display: "flex",
    flexDirection: "column",
    gap: "18px",
  },
  brand: { display: "flex", alignItems: "center", gap: "8px", color: tokens.colorNeutralForeground3 },
  logo: { width: "26px", height: "26px" },
  heading: { margin: 0, fontSize: "clamp(20px, 5vw, 26px)", lineHeight: "1.3", fontWeight: tokens.fontWeightSemibold },
  meta: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", color: tokens.colorNeutralForeground3 },
  foot: { color: tokens.colorNeutralForeground3, borderTop: `1px solid ${tokens.colorNeutralStroke2}`, paddingTop: "12px" },
});

// The token a share link carries, if the page's address is one.
export const sharedTokenOf = (hash: string): string | null => /^#\/share\/([A-Za-z0-9_-]{43})$/.exec(hash)?.[1] ?? null;

const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function SharedChatPage({ token }: { token: string }) {
  const s = useStyles();
  const chat = useResource<SharedChat>(() => get(`/api/shared/${token}`), [token]);
  const items = useMemo(() => (chat.data?.events ?? []).reduce(chatReducer, emptyChat()).items, [chat.data]);
  return (
    <main className={s.page}>
      <div className={s.inner}>
        <div className={s.brand}>
          <img src="/orbit.svg" alt="" className={s.logo} />
          <Text weight="semibold">Orbit Web</Text>
          <Text size={200}>· a shared chat</Text>
        </div>
        {chat.loading && chat.data === null && <Spinner label="Opening the shared chat…" />}
        {chat.error && chat.data === null && (
          <MessageBar intent="warning">
            <MessageBarBody>This chat is not shared, or no longer: the link may be wrong, or its owner stopped sharing it.</MessageBarBody>
          </MessageBar>
        )}
        {chat.data && (
          <>
            <header>
              <h1 className={s.heading}>{chat.data.title}</h1>
              <div className={s.meta}>
                {chat.data.repository && (
                  <>
                    <SourceMark source={chat.data.source} />
                    <Text size={200}>{chat.data.repository}</Text>
                    <Text size={200}>·</Text>
                  </>
                )}
                <Text size={200}>Shared {when(chat.data.sharedAt)}</Text>
                {!chat.data.includeTools && <Text size={200}>· tools shown by their title only</Text>}
              </div>
            </header>
            <Timeline items={items} />
            <Text size={200} className={s.foot}>
              A read-only snapshot of this conversation, as it was when it was shared: it does not change as the chat goes on.
            </Text>
          </>
        )}
      </div>
    </main>
  );
}
