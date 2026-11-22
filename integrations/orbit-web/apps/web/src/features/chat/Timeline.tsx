// The conversation: messages, tool activity (with what a subagent did inside its Agent call), and what the CLI said
// about each run -- its version and whether Orbit loaded, how it ended, and anything it refused.
import { Badge, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Markdown } from "../../components/Markdown";
import { effortLabel, MODE_LABELS, RUNTIME_LABELS, type RuntimeKind } from "@orbit-web/contracts";
import { BranchFork16Regular } from "@fluentui/react-icons";
import { childrenOf, type BranchItem, type MessageItem, type ProjectItem, type RunEndItem, type RunStartItem, type TimelineItem, type WorkspaceItem } from "./chatReducer";
import { PlanCard } from "./PlanCard";
import { ToolCard } from "./ToolCard";

const useStyles = makeStyles({
  list: { display: "flex", flexDirection: "column", gap: "12px", paddingTop: "8px", paddingBottom: "12px", minWidth: 0, maxWidth: "100%" },
  user: {
    alignSelf: "flex-end",
    maxWidth: "80%",
    "@media (max-width: 639px)": { maxWidth: "88%" },
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
    marginTop: "6px",
    fontSize: "15px",
    lineHeight: "1.55",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  userImages: { alignSelf: "flex-end", display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "6px", maxWidth: "80%", marginTop: "6px", "@media (max-width: 639px)": { maxWidth: "88%" } },
  userImageLink: { display: "block", borderRadius: "14px", overflow: "hidden", lineHeight: 0, outlineOffset: "2px" },
  userImage: { display: "block", maxHeight: "220px", maxWidth: "100%", width: "auto", height: "auto", objectFit: "contain", backgroundColor: tokens.colorNeutralBackground3 },
  assistant: { maxWidth: "100%", minWidth: 0 },
  meta: { color: tokens.colorNeutralForeground3, overflowWrap: "anywhere" },
  line: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", minWidth: 0, maxWidth: "100%" },
  msgBar: { minWidth: 0, maxWidth: "100%", borderRadius: "12px" },
  msgBody: { minWidth: 0, overflowWrap: "anywhere", wordBreak: "break-word" },
  msgCode: { overflowWrap: "anywhere", wordBreak: "break-word" },
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
});

const STEPS: Record<string, string> = {
  clone: "Cloning the repository…",
  init: "Creating an empty workspace…",
  branch: "Creating this session's branch…",
  identity: "Setting the commit identity…",
  orbit: "Seating the workspace with Orbit…",
  project: "Reading the project's skills and plugins…",
};

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// What the repository brought: its skills, commands and agents (loaded as instructions), and its plugins with what
// became of each. Settings → Skills and Plugins show them whole.
function Project({ item }: { item: ProjectItem }) {
  const s = useStyles();
  const i = item.inventory;
  const carried = [count(i.skills.length, "skill"), count(i.commands.length, "command"), count(i.agents.length, "agent")].join(", ");
  const plugins = i.plugins.length === 0 ? "" : ` · plugins: ${i.plugins.map((p) => `${p.id} (${p.state})`).join(", ")}`;
  if (i.skills.length + i.commands.length + i.agents.length + i.plugins.length === 0) return null;
  return (
    <Text size={200} className={s.meta}>
      {i.loaded ? `Loaded from this repository: ${carried}` : `This repository has ${carried} (not loaded)`}
      {plugins}.
    </Text>
  );
}

function Workspace({ item }: { item: WorkspaceItem }) {
  const s = useStyles();
  if (item.state === "preparing") return <Spinner size="tiny" label={STEPS[item.step] ?? "Preparing the workspace…"} labelPosition="after" />;
  if (item.state === "failed")
    return (
      <MessageBar intent="error" className={s.msgBar}>
        <MessageBarBody className={s.msgBody}>Workspace not prepared ({item.step}): {item.message}</MessageBarBody>
      </MessageBar>
    );
  return <Text size={200} className={s.meta}>Workspace ready on branch {item.workBranch}.</Text>;
}

// The working branch moved: said in the conversation, where the work before and after it sits.
function Branch({ item }: { item: BranchItem }) {
  const s = useStyles();
  return (
    <div className={s.line}>
      <BranchFork16Regular className={s.meta} />
      <Text size={200} className={s.meta}>
        Now working on <code className={s.msgCode}>{item.workBranch}</code>
        {item.created ? `, a new branch from ${item.from ? `the work on ${item.from}` : "the work as it was"}.` : item.from ? ` (switched from ${item.from}).` : "."}
      </Text>
    </div>
  );
}

function RunStart({ item }: { item: RunStartItem }) {
  const s = useStyles();
  const d = item.data;
  return (
    <div className={s.line}>
      <Text size={200} className={s.meta}>
        {d.resumed ? "Continuing" : "Started"} {d.runtime === "codex" ? "OpenAI Codex" : `Claude Code ${d.claudeCodeVersion ?? "?"}`} · {d.model ?? d.requestedModel}
        {/* A run of an earlier Orbit Web named no effort or mode. */}
        {d.requestedEffort ? ` · ${effortLabel(d.requestedEffort)} effort` : ""}
        {d.requestedMode ? ` · ${MODE_LABELS[d.requestedMode]}` : ""}
        {/* Where it ran: a sandbox of its own (a container holding this chat's places alone). */}
        {d.sandboxed ? " · own sandbox" : ""}
      </Text>
      {d.orbitLoaded ? (
        <Badge appearance="tint" color="brand" size="small">
          Orbit {d.orbitVersion ?? ""} loaded
        </Badge>
      ) : (
        // The Orbit plugin is Claude Code's: a run of another CLI never loads it, which is nothing to warn about.
        d.runtime !== "codex" && (
          <Badge appearance="tint" color="warning" size="small">
            Orbit plugin not loaded
          </Badge>
        )
      )}
    </div>
  );
}

// A run's failure, naming the AI that ran -- once (the message may already start with its name).
const failedText = (label: string, message: string): string => `${label} failed: ${message.startsWith(`${label} `) ? message.slice(label.length + 1) : message}`;

function RunEnd({ item, runtime }: { item: RunEndItem; runtime: RuntimeKind }) {
  const s = useStyles();
  const e = item.end;
  const label = RUNTIME_LABELS[runtime];
  if (e.type === "session.completed") {
    const cost = e.data.costUsd !== null ? ` · $${e.data.costUsd.toFixed(4)}` : "";
    return (
      <Text size={200} className={s.meta}>
        {label} finished ({e.data.turns ?? "?"} turns{cost}). Whether the change is verified is Orbit's to say — see the Orbit panel.
      </Text>
    );
  }
  if (e.type === "session.interrupted")
    return (
      <MessageBar intent="warning" className={s.msgBar}>
        <MessageBarBody className={s.msgBody}>{e.data.reason === "user_stop" ? "Stopped. The run was interrupted; it did not complete." : "Orbit Web restarted while this run was active; it was interrupted and is not resumed on its own."}</MessageBarBody>
      </MessageBar>
    );
  return (
    <MessageBar intent="error" className={s.msgBar}>
      <MessageBarBody className={s.msgBody}>{failedText(label, e.data.message)}</MessageBarBody>
    </MessageBar>
  );
}

function Message({ item, imageUrl }: { item: MessageItem; imageUrl?: (imageId: string) => string }) {
  const s = useStyles();
  if (item.role === "user") return <UserMessage item={item} imageUrl={imageUrl} />;
  return (
    <div className={s.assistant} data-testid="assistant-message">
      <Markdown text={item.text} />
      {item.streaming && <span className={s.cursor} aria-label="writing" />}
      {item.partial && <Text size={200} className={s.meta}>(cut off when the run ended)</Text>}
    </div>
  );
}

// A person's message: the images it carried (each opens full size), then its words.
function UserMessage({ item, imageUrl }: { item: MessageItem; imageUrl?: (imageId: string) => string }) {
  const s = useStyles();
  const images = imageUrl === undefined ? [] : (item.images ?? []);
  return (
    <>
      {images.length > 0 && (
        <div className={s.userImages} role="group" aria-label={images.length === 1 ? "Image sent" : `${images.length} images sent`}>
          {images.map((image, n) => {
            const url = (imageUrl as (imageId: string) => string)(image.id);
            return (
              <a key={image.id} className={s.userImageLink} href={url} target="_blank" rel="noopener noreferrer" title="Open full size">
                <img className={s.userImage} src={url} alt={`Image ${n + 1} of the message`} loading="lazy" {...(image.width && image.height ? { width: image.width, height: image.height } : {})} />
              </a>
            );
          })}
        </div>
      )}
      {item.text.trim().length > 0 && <div className={s.user}>{item.text}</div>}
    </>
  );
}

export interface TimelineActions {
  // The AI the chat runs on (its run ends name it): Claude Code unless said.
  runtime?: RuntimeKind;
  // Where an image a message carried is read.
  imageUrl?: (imageId: string) => string;
  // Carry a proposed plan out: switch to Autonomous and ask for it.
  onRunPlan?: () => void;
  canRunPlan?: boolean;
}

function Item({ item, items, actions }: { item: TimelineItem; items: TimelineItem[]; actions: TimelineActions }) {
  const s = useStyles();
  switch (item.kind) {
    case "message":
      return <Message item={item} imageUrl={actions.imageUrl} />;
    case "plan":
      return <PlanCard plan={item.plan} truncated={item.truncated} onRun={actions.onRunPlan} canRun={actions.canRunPlan === true} />;
    case "project":
      return <Project item={item} />;
    case "tool": {
      const inner = childrenOf(items, item.id);
      return (
        <ToolCard tool={item}>
          {inner.length > 0 && inner.map((child) => <Item key={`${child.kind}-${child.id}`} item={child} items={items} actions={actions} />)}
        </ToolCard>
      );
    }
    case "run-start":
      return <RunStart item={item} />;
    case "run-end":
      return <RunEnd item={item} runtime={actions.runtime ?? "claude"} />;
    case "workspace":
      return <Workspace item={item} />;
    case "branch":
      return <Branch item={item} />;
    case "notice":
      return (
        <MessageBar intent="info" className={s.msgBar}>
          <MessageBarBody className={s.msgBody}>{item.notice.message}</MessageBarBody>
        </MessageBar>
      );
    case "denied":
      return (
        <MessageBar intent="warning" className={s.msgBar}>
          <MessageBarBody className={s.msgBody}>
            Permission denied: {item.denied.toolName} was not allowed. <code className={s.msgCode}>{item.denied.input.slice(0, 200)}</code>
          </MessageBarBody>
        </MessageBar>
      );
    default:
      return null;
  }
}

// Plan mode's ExitPlanMode call (and its refusal under -p) is shown as the plan it carried, not as a tool.
const isPlanPlumbing = (item: TimelineItem): boolean => (item.kind === "tool" && item.name === "ExitPlanMode") || (item.kind === "denied" && item.denied.toolName === "ExitPlanMode");

export function Timeline({ items, actions = {} }: { items: TimelineItem[]; actions?: TimelineActions }) {
  const s = useStyles();
  const hasPlan = items.some((i) => i.kind === "plan");
  return (
    <div className={s.list}>
      {childrenOf(items, null)
        .filter((item) => !(hasPlan && isPlanPlumbing(item)))
        .map((item) => (
          <Item key={`${item.kind}-${item.id}`} item={item} items={items} actions={actions} />
        ))}
    </div>
  );
}
