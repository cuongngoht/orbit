// THE STREAM MAPPER: Claude Code's native stream-json lines in, Orbit Web's application events out. Pure and
// stateful per run; it never invents anything the stream did not say:
//
//   system/init                   -> session.started (the CLI's version, model, permission mode, loaded plugins)
//   stream_event text deltas      -> message.started / message.delta   (partial messages)
//   assistant text block          -> message.completed (the block's whole text)
//   assistant tool_use block      -> tool.started (an Agent call carries its own subagent_type and description);
//                                    an ExitPlanMode call (plan mode's proposal) -> plan.proposed with its `plan` too
//   user tool_result block        -> tool.completed / tool.failed (is_error), with the tool's real output
//   result                        -> kept for the runner, which decides the outcome with the exit code;
//                                    each permission_denials entry -> permission.denied
//   rate_limit_event not allowed  -> run.notice
//
// Thinking blocks are not shown. Messages and tools inside a subagent carry `parentToolUseId`, the CLI's own link
// to the Agent call that started them; no agent name is guessed.
import type { EffortChoice, EventDataMap, ModeChoice, ModelChoice, PluginInfo, SessionEventType } from "@orbit-web/contracts";
import { bounded, redactSecrets } from "../../infra/security/redact.js";
import { DeltaRedactor } from "./delta-redactor.js";

export const TEXT_LIMIT = 200_000;
export const TOOL_INPUT_LIMIT = 8_000;
export const TOOL_OUTPUT_LIMIT = 16_000;
export const PLAN_LIMIT = 64_000;

export type MappedEvent = { [T in SessionEventType]: { type: T; data: EventDataMap[T] } }[SessionEventType];

export interface InitInfo {
  sessionId: string;
  version: string | null;
  model: string | null;
  orbitLoaded: boolean;
}

export interface ResultInfo {
  subtype: string;
  isError: boolean;
  text: string;
  costUsd: number | null;
  turns: number | null;
  durationMs: number | null;
  permissionDenials: number;
}

type Json = Record<string, unknown>;

const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const parentOf = (e: Json): string | null => str(e.parent_tool_use_id);

function pluginsOf(init: Json): PluginInfo[] {
  if (!Array.isArray(init.plugins)) return [];
  return init.plugins.flatMap((p) => {
    if (typeof p === "string") return [{ name: p, version: null }];
    return isRecord(p) && typeof p.name === "string" ? [{ name: p.name, version: str(p.version) }] : [];
  });
}

// What a tool result says, as text: a string, or the text parts of a content array.
export function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (isRecord(c) && c.type === "text" && typeof c.text === "string" ? c.text : isRecord(c) && c.type === "image" ? "[image]" : "")).filter((t) => t.length > 0).join("\n");
}

const firstLine = (s: string, max = 120): string => {
  const line = s.split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

// A one-line title for a tool call, from its own input.
export function toolTitle(name: string, input: Json, cwd: string): string {
  const path = (p: unknown) => (typeof p === "string" ? (p.startsWith(`${cwd}/`) ? p.slice(cwd.length + 1) : p) : "");
  const titles: Record<string, () => string> = {
    Bash: () => `$ ${firstLine(str(input.command) ?? "")}`,
    Read: () => `Read ${path(input.file_path)}`,
    Edit: () => `Edit ${path(input.file_path)}`,
    MultiEdit: () => `Edit ${path(input.file_path)}`,
    Write: () => `Write ${path(input.file_path)}`,
    NotebookEdit: () => `Edit ${path(input.notebook_path)}`,
    Glob: () => `Find ${str(input.pattern) ?? ""}`,
    Grep: () => `Search ${firstLine(str(input.pattern) ?? "", 80)}`,
    Skill: () => `Skill ${str(input.skill) ?? str(input.command) ?? ""}`.trim(),
    Agent: () => `Agent ${str(input.subagent_type) ?? "general"}: ${firstLine(str(input.description) ?? "", 80)}`,
    Task: () => `Agent ${str(input.subagent_type) ?? "general"}: ${firstLine(str(input.description) ?? "", 80)}`,
    TodoWrite: () => "Update the to-do list",
    WebFetch: () => `Fetch ${str(input.url) ?? ""}`,
    WebSearch: () => `Search the web: ${firstLine(str(input.query) ?? "", 80)}`,
  };
  return (titles[name] ?? (() => name))();
}

export class StreamMapper {
  init: InitInfo | null = null;
  result: ResultInfo | null = null;
  // Text segments (one per text content block) still being written: what arrived, what was sent, and who wrote it.
  private readonly open = new Map<string, { raw: string; sent: number; redactor: DeltaRedactor; parent: string | null }>();
  private readonly startedByIndex = new Map<string, string>();
  private readonly currentMessage = new Map<string, string>();
  private readonly textBlocksSeen = new Map<string, number>();
  private readonly textBlocksDone = new Map<string, number>();
  private readonly pendingTools = new Map<string, string | null>();

  constructor(private readonly o: { requestedModel: ModelChoice; requestedEffort: EffortChoice; requestedMode: ModeChoice; resumed: boolean; cwd: string }) {}

  push(event: unknown): MappedEvent[] {
    if (!isRecord(event)) return [];
    if (event.type === "system" && event.subtype === "init") return this.onInit(event);
    if (event.type === "stream_event" && isRecord(event.event)) return this.onStream(event.event, parentOf(event));
    if (event.type === "assistant" && isRecord(event.message)) return this.onAssistant(event.message, parentOf(event));
    if (event.type === "user" && isRecord(event.message)) return this.onUser(event, event.message);
    if (event.type === "result") return this.onResult(event);
    if (event.type === "rate_limit_event") return this.onRateLimit(event);
    return [];
  }

  // The run ended: what was still being written is completed as partial, a tool that never answered as failed.
  finish(): MappedEvent[] {
    const messages: MappedEvent[] = [...this.open.entries()].map(([messageId, m]) => ({
      type: "message.completed",
      data: { messageId, role: "assistant", text: redactSecrets(m.raw), parentToolUseId: m.parent, partial: true, truncated: false },
    }));
    const tools: MappedEvent[] = [...this.pendingTools.entries()].map(([toolUseId, parent]) => ({
      type: "tool.failed",
      data: { toolUseId, output: "The run ended before this tool reported a result.", truncated: false, isError: true, interrupted: true, parentToolUseId: parent },
    }));
    this.open.clear();
    this.pendingTools.clear();
    return [...messages, ...tools];
  }

  private onInit(e: Json): MappedEvent[] {
    const plugins = pluginsOf(e);
    const orbit = plugins.find((p) => p.name === "orbit");
    const sessionId = str(e.session_id) ?? "";
    this.init = { sessionId, version: str(e.claude_code_version), model: str(e.model), orbitLoaded: orbit !== undefined };
    return [
      {
        type: "session.started",
        data: {
          claudeSessionId: sessionId,
          claudeCodeVersion: str(e.claude_code_version),
          model: str(e.model),
          requestedModel: this.o.requestedModel,
          requestedEffort: this.o.requestedEffort,
          requestedMode: this.o.requestedMode,
          permissionMode: str(e.permissionMode),
          plugins,
          orbitLoaded: orbit !== undefined,
          orbitVersion: orbit?.version ?? null,
          resumed: this.o.resumed,
        },
      },
    ];
  }

  private onStream(se: Json, parent: string | null): MappedEvent[] {
    const scope = parent ?? "main";
    if (se.type === "message_start" && isRecord(se.message) && typeof se.message.id === "string") {
      this.currentMessage.set(scope, se.message.id);
      return [];
    }
    const messageId = this.currentMessage.get(scope);
    if (messageId === undefined) return [];
    if (se.type === "content_block_start" && isRecord(se.content_block) && se.content_block.type === "text") return this.startSegment(messageId, num(se.index) ?? 0, parent);
    if (se.type === "content_block_delta" && isRecord(se.delta) && se.delta.type === "text_delta" && typeof se.delta.text === "string") return this.delta(messageId, num(se.index) ?? 0, se.delta.text);
    return [];
  }

  private startSegment(messageId: string, index: number, parent: string | null): MappedEvent[] {
    const n = (this.textBlocksSeen.get(messageId) ?? 0) + 1;
    this.textBlocksSeen.set(messageId, n);
    const segment = `${messageId}:${n}`;
    this.startedByIndex.set(`${messageId}#${index}`, segment);
    this.open.set(segment, { raw: "", sent: 0, redactor: new DeltaRedactor(), parent });
    return [{ type: "message.started", data: { messageId: segment, role: "assistant", parentToolUseId: parent } }];
  }

  private delta(messageId: string, index: number, text: string): MappedEvent[] {
    const segment = this.startedByIndex.get(`${messageId}#${index}`);
    const open = segment === undefined ? undefined : this.open.get(segment);
    if (segment === undefined || open === undefined || open.raw.length + text.length > TEXT_LIMIT) return [];
    open.raw += text;
    const piece = open.redactor.push(text);
    if (piece.length === 0) return [];
    const offset = open.sent;
    open.sent += piece.length;
    return [{ type: "message.delta", data: { messageId: segment, offset, text: piece } }];
  }

  private onAssistant(message: Json, parent: string | null): MappedEvent[] {
    const messageId = str(message.id) ?? `msg-${Date.now()}`;
    const content = Array.isArray(message.content) ? message.content.filter(isRecord) : [];
    return content.flatMap((block) => {
      if (block.type === "text" && typeof block.text === "string") return this.completeText(messageId, block.text, parent);
      if (block.type === "tool_use") return this.toolStarted(block, parent);
      return [];
    });
  }

  private completeText(messageId: string, text: string, parent: string | null): MappedEvent[] {
    const n = (this.textBlocksDone.get(messageId) ?? 0) + 1;
    this.textBlocksDone.set(messageId, n);
    const segment = `${messageId}:${n}`;
    const started: MappedEvent[] = this.open.has(segment) || (this.textBlocksSeen.get(messageId) ?? 0) >= n ? [] : [{ type: "message.started", data: { messageId: segment, role: "assistant", parentToolUseId: parent } }];
    this.open.delete(segment);
    const b = bounded(redactSecrets(text), TEXT_LIMIT);
    return [...started, { type: "message.completed", data: { messageId: segment, role: "assistant", text: b.text, parentToolUseId: parent, partial: false, truncated: b.truncated } }];
  }

  private toolStarted(block: Json, parent: string | null): MappedEvent[] {
    const toolUseId = str(block.id);
    const name = str(block.name) ?? "tool";
    if (toolUseId === null) return [];
    const input = isRecord(block.input) ? block.input : {};
    this.pendingTools.set(toolUseId, parent);
    const shown = bounded(redactSecrets(JSON.stringify(input, null, 2)), TOOL_INPUT_LIMIT);
    const agent = name === "Agent" || name === "Task" ? { subagentType: str(input.subagent_type), description: str(input.description) } : null;
    const started: MappedEvent = { type: "tool.started", data: { toolUseId, name, title: redactSecrets(toolTitle(name, input, this.o.cwd)), input: shown.text, inputTruncated: shown.truncated, parentToolUseId: parent, agent } };
    const plan = name === "ExitPlanMode" && typeof input.plan === "string" ? bounded(redactSecrets(input.plan), PLAN_LIMIT) : null;
    return plan === null ? [started] : [started, { type: "plan.proposed", data: { toolUseId, plan: plan.text, truncated: plan.truncated } }];
  }

  private onUser(event: Json, message: Json): MappedEvent[] {
    const content = Array.isArray(message.content) ? message.content.filter(isRecord) : [];
    const extra = isRecord(event.tool_use_result) ? event.tool_use_result : {};
    return content.flatMap((block) => {
      if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") return [];
      const parent = this.pendingTools.get(block.tool_use_id) ?? parentOf(event);
      this.pendingTools.delete(block.tool_use_id);
      const output = bounded(redactSecrets(toolResultText(block.content)), TOOL_OUTPUT_LIMIT);
      const isError = block.is_error === true;
      const data = { toolUseId: block.tool_use_id, output: output.text, truncated: output.truncated, isError, interrupted: extra.interrupted === true, parentToolUseId: parent };
      return [isError ? { type: "tool.failed" as const, data } : { type: "tool.completed" as const, data }];
    });
  }

  private onResult(e: Json): MappedEvent[] {
    const denials = Array.isArray(e.permission_denials) ? e.permission_denials.filter(isRecord) : [];
    this.result = {
      subtype: str(e.subtype) ?? "unknown",
      isError: e.is_error === true,
      text: bounded(redactSecrets(str(e.result) ?? ""), TEXT_LIMIT).text,
      costUsd: num(e.total_cost_usd),
      turns: num(e.num_turns),
      durationMs: num(e.duration_ms),
      permissionDenials: denials.length,
    };
    return denials.map((d) => ({
      type: "permission.denied" as const,
      data: {
        toolName: str(d.tool_name) ?? "tool",
        toolUseId: str(d.tool_use_id),
        input: bounded(redactSecrets(JSON.stringify(d.tool_input ?? {}, null, 2)), TOOL_INPUT_LIMIT).text,
      },
    }));
  }

  private onRateLimit(e: Json): MappedEvent[] {
    const info = isRecord(e.rate_limit_info) ? e.rate_limit_info : {};
    const status = str(info.status);
    if (status === null || status === "allowed") return [];
    const resets = num(info.resetsAt);
    const when = resets !== null ? ` until ${new Date(resets * 1000).toISOString()}` : "";
    return [{ type: "run.notice", data: { kind: "rate_limit", message: `Claude reports a usage limit (${status}, ${str(info.rateLimitType) ?? "window"})${when}.` } }];
  }
}
