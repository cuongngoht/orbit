// The conversation: messages, tool activity (with what a subagent did inside its Agent call), and what the CLI said
// about each run -- its version and whether Orbit loaded, how it ended, and anything it refused.
import { Badge, MessageBar, MessageBarBody, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { Markdown } from "../../components/Markdown";
import { effortLabel, MODE_LABELS, RUNTIME_LABELS, type RuntimeKind } from "@orbit-web/contracts";
import { BranchFork16Regular } from "@fluentui/react-icons";
import { useI18n, type MessageKey } from "../../i18n";
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

const STEP_KEYS: Record<string, MessageKey> = {
  clone: "chat.timeline.step.clone",
  init: "chat.timeline.step.init",
  branch: "chat.timeline.step.branch",
  identity: "chat.timeline.step.identity",
  orbit: "chat.timeline.step.orbit",
  project: "chat.timeline.step.project",
};

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// What the repository brought: its skills, commands and agents (loaded as instructions), and its plugins with what
// became of each. Settings → Skills and Plugins show them whole.
function Project({ item }: { item: ProjectItem }) {
  const { t } = useI18n();
  const s = useStyles();
  const i = item.inventory;
  const carried = [
    count(i.skills.length, t("chat.timeline.noun.skill")),
    count(i.commands.length, t("chat.timeline.noun.command")),
    count(i.agents.length, t("chat.timeline.noun.agent")),
  ].join(", ");
  const plugins = i.plugins.length === 0 ? "" : t("chat.timeline.pluginsSuffix", { plugins: i.plugins.map((p) => `${p.id} (${p.state})`).join(", ") });
  if (i.skills.length + i.commands.length + i.agents.length + i.plugins.length === 0) return null;
  return (
    <Text size={200} className={s.meta}>
      {i.loaded ? t("chat.timeline.projectLoaded", { carried }) : t("chat.timeline.projectNotLoaded", { carried })}
      {plugins}.
    </Text>
  );
}

function Workspace({ item }: { item: WorkspaceItem }) {
  const { t } = useI18n();
  const s = useStyles();
  if (item.state === "preparing") return <Spinner size="tiny" label={t(STEP_KEYS[item.step] ?? "chat.timeline.step.default")} labelPosition="after" />;
  if (item.state === "failed")
    return (
      <MessageBar intent="error" className={s.msgBar}>
        <MessageBarBody className={s.msgBody}>{t("chat.timeline.workspaceFailed", { step: item.step, message: item.message ?? "" })}</MessageBarBody>
      </MessageBar>
    );
  return <Text size={200} className={s.meta}>{t("chat.timeline.workspaceReady", { branch: item.workBranch ?? "" })}</Text>;
}

// The working branch moved: said in the conversation, where the work before and after it sits.
function Branch({ item }: { item: BranchItem }) {
  const { t } = useI18n();
  const s = useStyles();
  return (
    <div className={s.line}>
      <BranchFork16Regular className={s.meta} />
      <Text size={200} className={s.meta}>
        {t("chat.timeline.nowWorkingOn")}
        <code className={s.msgCode}>{item.workBranch}</code>
        {item.created
          ? t("chat.timeline.newBranchFromWork", {
              what: item.from ? t("chat.timeline.workOnBranch", { branch: item.from }) : t("chat.timeline.workAsItWas"),
            })
          : item.from
            ? t("chat.timeline.switchedFrom", { branch: item.from })
            : "."}
      </Text>
    </div>
  );
}

function RunStart({ item }: { item: RunStartItem }) {
  const { t } = useI18n();
  const s = useStyles();
  const d = item.data;
  return (
    <div className={s.line}>
      <Text size={200} className={s.meta}>
        {d.resumed ? t("chat.timeline.continuing") : t("chat.timeline.started")}{" "}
        {d.runtime === "codex" ? RUNTIME_LABELS.codex : t("chat.timeline.claudeCodeVersion", { version: d.claudeCodeVersion ?? "?" })} · {d.model ?? d.requestedModel}
        {/* A run of an earlier Orbit Web named no effort or mode. */}
        {d.requestedEffort ? t("chat.timeline.effortSuffix", { effort: effortLabel(d.requestedEffort) }) : ""}
        {d.requestedMode ? ` · ${MODE_LABELS[d.requestedMode]}` : ""}
        {/* Where it ran: a sandbox of its own (a container holding this chat's places alone). */}
        {d.sandboxed ? t("chat.timeline.ownSandbox") : ""}
      </Text>
      {d.orbitLoaded ? (
        <Badge appearance="tint" color="brand" size="small">
          {t("chat.timeline.orbitLoaded", { version: d.orbitVersion ?? "" })}
        </Badge>
      ) : (
        // The Orbit plugin is Claude Code's: a run of another CLI never loads it, which is nothing to warn about.
        d.runtime !== "codex" && (
          <Badge appearance="tint" color="warning" size="small">
            {t("chat.timeline.orbitNotLoaded")}
          </Badge>
        )
      )}
    </div>
  );
}

function RunEnd({ item, runtime }: { item: RunEndItem; runtime: RuntimeKind }) {
  const { t } = useI18n();
  const s = useStyles();
  const e = item.end;
  const label = RUNTIME_LABELS[runtime];
  if (e.type === "session.completed") {
    const cost = e.data.costUsd !== null ? ` · $${e.data.costUsd.toFixed(4)}` : "";
    return (
      <Text size={200} className={s.meta}>
        {t("chat.timeline.turnsCost", { label, turns: e.data.turns ?? "?", cost })}
      </Text>
    );
  }
  if (e.type === "session.interrupted")
    return (
      <MessageBar intent="warning" className={s.msgBar}>
        <MessageBarBody className={s.msgBody}>{t(e.data.reason === "user_stop" ? "chat.timeline.interruptedUser" : "chat.timeline.interruptedRestart")}</MessageBarBody>
      </MessageBar>
    );
  const message = e.data.message.startsWith(`${label} `) ? e.data.message.slice(label.length + 1) : e.data.message;
  return (
    <MessageBar intent="error" className={s.msgBar}>
      <MessageBarBody className={s.msgBody}>{t("chat.timeline.failedText", { label, message })}</MessageBarBody>
    </MessageBar>
  );
}

function Message({ item, imageUrl }: { item: MessageItem; imageUrl?: (imageId: string) => string }) {
  const { t } = useI18n();
  const s = useStyles();
  if (item.role === "user") return <UserMessage item={item} imageUrl={imageUrl} />;
  return (
    <div className={s.assistant} data-testid="assistant-message">
      <Markdown text={item.text} />
      {item.streaming && <span className={s.cursor} aria-label={t("chat.timeline.writingAria")} />}
      {item.partial && <Text size={200} className={s.meta}>{t("chat.timeline.cutOff")}</Text>}
    </div>
  );
}

// A person's message: the images it carried (each opens full size), then its words.
function UserMessage({ item, imageUrl }: { item: MessageItem; imageUrl?: (imageId: string) => string }) {
  const { t } = useI18n();
  const s = useStyles();
  const images = imageUrl === undefined ? [] : (item.images ?? []);
  return (
    <>
      {images.length > 0 && (
        <div className={s.userImages} role="group" aria-label={images.length === 1 ? t("chat.timeline.imageSentOne") : t("chat.timeline.imageSentMany", { count: images.length })}>
          {images.map((image, n) => {
            const url = (imageUrl as (imageId: string) => string)(image.id);
            return (
              <a key={image.id} className={s.userImageLink} href={url} target="_blank" rel="noopener noreferrer" title={t("chat.timeline.openFullSize")}>
                <img className={s.userImage} src={url} alt={t("chat.timeline.imageAlt", { index: n + 1 })} loading="lazy" {...(image.width && image.height ? { width: image.width, height: image.height } : {})} />
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
  const { t } = useI18n();
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
            {t("chat.timeline.permissionDenied", { tool: item.denied.toolName })}
            <code className={s.msgCode}>{item.denied.input.slice(0, 200)}</code>
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
