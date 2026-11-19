// The conversation: messages, tool activity (with what a subagent did inside its Agent call), and what the CLI said
// about each run -- its version and whether Orbit loaded, how it ended, and anything it refused.
import { Badge, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Markdown } from "../../components/Markdown";
import { childrenOf, type MessageItem, type RunEndItem, type RunStartItem, type TimelineItem, type WorkspaceItem } from "./chatReducer";
import { ToolCard } from "./ToolCard";

const useStyles = makeStyles({
  list: { display: "flex", flexDirection: "column", gap: "10px" },
  user: { alignSelf: "flex-end", maxWidth: "80%", backgroundColor: tokens.colorBrandBackground2, padding: "8px 12px", borderRadius: tokens.borderRadiusLarge, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  assistant: { maxWidth: "100%" },
  meta: { color: tokens.colorNeutralForeground3 },
  line: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
  cursor: { display: "inline-block", width: "8px", height: "14px", backgroundColor: tokens.colorNeutralForeground3, marginLeft: "2px", verticalAlign: "text-bottom" },
});

const STEPS: Record<string, string> = { clone: "Cloning the repository with GitHub CLI…", branch: "Creating this session's branch…", identity: "Setting the commit identity…", orbit: "Seating the workspace with Orbit…" };

function Workspace({ item }: { item: WorkspaceItem }) {
  const s = useStyles();
  if (item.state === "preparing") return <Spinner size="tiny" label={STEPS[item.step] ?? "Preparing the workspace…"} labelPosition="after" />;
  if (item.state === "failed")
    return (
      <MessageBar intent="error">
        <MessageBarBody>Workspace not prepared ({item.step}): {item.message}</MessageBarBody>
      </MessageBar>
    );
  return <Text size={200} className={s.meta}>Workspace ready on branch {item.workBranch}.</Text>;
}

function RunStart({ item }: { item: RunStartItem }) {
  const s = useStyles();
  const d = item.data;
  return (
    <div className={s.line}>
      <Text size={200} className={s.meta}>
        {d.resumed ? "Continuing" : "Started"} Claude Code {d.claudeCodeVersion ?? "?"} · {d.model ?? d.requestedModel}
      </Text>
      {d.orbitLoaded ? (
        <Badge appearance="tint" color="brand" size="small">
          Orbit {d.orbitVersion ?? ""} loaded
        </Badge>
      ) : (
        <Badge appearance="tint" color="warning" size="small">
          Orbit plugin not loaded
        </Badge>
      )}
    </div>
  );
}

function RunEnd({ item }: { item: RunEndItem }) {
  const s = useStyles();
  const e = item.end;
  if (e.type === "session.completed") {
    const cost = e.data.costUsd !== null ? ` · $${e.data.costUsd.toFixed(4)}` : "";
    return (
      <Text size={200} className={s.meta}>
        Claude Code finished ({e.data.turns ?? "?"} turns{cost}). Whether the change is verified is Orbit's to say — see the Orbit panel.
      </Text>
    );
  }
  if (e.type === "session.interrupted")
    return (
      <MessageBar intent="warning">
        <MessageBarBody>{e.data.reason === "user_stop" ? "Stopped. The run was interrupted; it did not complete." : "Orbit Web restarted while this run was active; it was interrupted and is not resumed on its own."}</MessageBarBody>
      </MessageBar>
    );
  return (
    <MessageBar intent="error">
      <MessageBarBody>Claude Code failed: {e.data.message}</MessageBarBody>
    </MessageBar>
  );
}

function Message({ item }: { item: MessageItem }) {
  const s = useStyles();
  if (item.role === "user") return <div className={s.user}>{item.text}</div>;
  return (
    <div className={s.assistant} data-testid="assistant-message">
      <Markdown text={item.text} />
      {item.streaming && <span className={s.cursor} aria-label="writing" />}
      {item.partial && <Text size={200} className={s.meta}>(cut off when the run ended)</Text>}
    </div>
  );
}

function Item({ item, items }: { item: TimelineItem; items: TimelineItem[] }) {
  switch (item.kind) {
    case "message":
      return <Message item={item} />;
    case "tool": {
      const inner = childrenOf(items, item.id);
      return (
        <ToolCard tool={item}>
          {inner.length > 0 && inner.map((child) => <Item key={`${child.kind}-${child.id}`} item={child} items={items} />)}
        </ToolCard>
      );
    }
    case "run-start":
      return <RunStart item={item} />;
    case "run-end":
      return <RunEnd item={item} />;
    case "workspace":
      return <Workspace item={item} />;
    case "notice":
      return (
        <MessageBar intent="info">
          <MessageBarBody>{item.notice.message}</MessageBarBody>
        </MessageBar>
      );
    case "denied":
      return (
        <MessageBar intent="warning">
          <MessageBarBody>
            Permission denied: {item.denied.toolName} was not allowed. <code>{item.denied.input.slice(0, 200)}</code>
          </MessageBarBody>
        </MessageBar>
      );
    default:
      return null;
  }
}

export function Timeline({ items }: { items: TimelineItem[] }) {
  const s = useStyles();
  return (
    <div className={s.list}>
      {childrenOf(items, null).map((item) => (
        <Item key={`${item.kind}-${item.id}`} item={item} items={items} />
      ))}
    </div>
  );
}
