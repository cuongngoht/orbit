// A CHAT ON OPENAI CODEX -- pure: the command line a chat's codex runs with, and its `exec --json` events read into the
// chat's own events (the ones a Claude Code chat's stream becomes: stream-mapper.ts). A chat's codex works in the chat's
// workspace inside Codex's own sandbox: Autonomous may write there (its commands have no network), Plan only reads;
// what the account's policy does not allow it does not have (no execution: no shell). It reads no configuration of
// anybody's (`--ignore-user-config`, `--ignore-rules`), reaches no MCP server (Claude's connectors are Claude's), and
// none of Codex's features that reach outside the workspace -- apps, plugins, hooks, a browser or the desktop -- is on.
// Each message is one `codex exec`; the next resumes its thread (its id is kept as the chat's CLI session).
import type { EffortChoice, ModeChoice, ModelChoice } from "@orbit-web/contracts";
import { redactSecrets } from "../../infra/security/redact.js";
import type { InitInfo, MappedEvent, ResultInfo } from "./stream-mapper.js";
import { TEXT_LIMIT, TOOL_INPUT_LIMIT, TOOL_OUTPUT_LIMIT } from "./stream-mapper.js";

// What reaches outside the workspace, or installs or runs something no one asked for: off for a chat.
export const CODEX_CHAT_FEATURES_OFF = ["apps", "plugins", "remote_plugin", "hooks", "browser_use", "browser_use_external", "computer_use", "skill_mcp_dependency_install"] as const;

const toml = (v: unknown): string => JSON.stringify(v);

export interface CodexChatOptions {
  model: string;
  effort: string | null;
  mode: "autonomous" | "plan";
  // What the account's policy allows the run: the provider's own web search, and running commands at all.
  webTools: boolean;
  execute: boolean;
  // Governance's note for the run (the governed deployment), as developer instructions.
  note: string | null;
  // The thread to resume (null: the chat's first message).
  threadId: string | null;
  // The message's images, as files the CLI reads.
  images: string[];
  // Where Codex's own sandbox runs on this host: its commands may read everything but `denied` (Orbit Web's data:
  // every account's sign-ins, keys and workspaces), and of that only the chat's own `room` -- written in Autonomous,
  // read in Plan. Null: no sandbox here, so its commands cannot run at all (they fail before they start).
  confine: { denied: string[]; room: string[] } | null;
  // The run has a sandbox of its own (a container holding this chat's places alone): that container holds its commands,
  // so Codex's own sandbox -- which cannot start in a container without user namespaces -- is not asked for. A Plan run's
  // workspace is mounted read-only there.
  container?: boolean;
}

// Codex's permission profile for a chat (`[permissions]`, an allow-list: what is not named is not reachable).
function confinement(o: CodexChatOptions): string[] {
  if (o.confine === null) return [];
  const access = o.mode === "plan" || !o.execute ? "read" : "write";
  const entries = [`"/"="read"`, ...o.confine.denied.map((p) => `${toml(p)}="none"`), ...o.confine.room.map((p) => `${toml(p)}=${toml(access)}`)];
  return ["-c", `permissions={orbit_chat={filesystem={${entries.join(",")}}}}`, "-c", 'default_permissions="orbit_chat"'];
}

export function codexChatArgs(o: CodexChatOptions): string[] {
  const sandbox = o.mode === "plan" || !o.execute ? "read-only" : "workspace-write";
  const own = [
    "--json",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "--model",
    o.model,
    ...(o.effort !== null ? ["-c", `model_reasoning_effort=${toml(o.effort)}`] : []),
    "-c",
    `web_search=${toml(o.webTools ? "live" : "disabled")}`,
    "-c",
    "mcp_servers={}",
    ...(o.note !== null ? ["-c", `developer_instructions=${toml(o.note)}`] : []),
    ...confinement(o),
    ...[...CODEX_CHAT_FEATURES_OFF, ...(o.execute ? [] : ["shell_tool", "unified_exec"])].flatMap((f) => ["--disable", f]),
    ...o.images.flatMap((p) => ["-i", p]),
  ];
  // `--sandbox` is the parent's option; the rest are resume's own. Confined, there is none: an explicit sandbox mode
  // takes the place of the permission profile (seen on codex-cli 0.169.0: with `--sandbox workspace-write` beside the
  // profile, a command read the path the profile denied), so the profile alone decides -- it also keeps their
  // network off.
  const parent = o.container === true ? ["exec", "--sandbox", "danger-full-access"] : o.confine === null ? ["exec", "--sandbox", sandbox] : ["exec"];
  return o.threadId === null ? [...parent, ...own, "-"] : [...parent, "resume", ...own, o.threadId, "-"];
}

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

const bounded = (text: string, max: number): { text: string; truncated: boolean } => (text.length > max ? { text: redactSecrets(text.slice(0, max)), truncated: true } : { text: redactSecrets(text), truncated: false });
const firstLine = (s: string, max = 120): string => {
  const line = s.split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

interface ToolOf {
  name: string;
  title: string;
  input: string;
  output: string;
  failed: boolean;
}

// What one item is, as a tool of the chat's timeline (null: not a tool).
function toolOf(item: Json): ToolOf | null {
  const status = str(item.status);
  if (item.type === "command_execution") {
    const command = str(item.command) ?? "";
    const exit = typeof item.exit_code === "number" ? item.exit_code : null;
    return { name: "Shell", title: `$ ${firstLine(command)}`, input: command, output: str(item.aggregated_output) ?? "", failed: status === "failed" || status === "declined" || (exit !== null && exit !== 0) };
  }
  if (item.type === "file_change") {
    const changes = Array.isArray(item.changes) ? item.changes.filter(isRecord) : [];
    const paths = changes.map((c) => str(c.path) ?? "").filter((p) => p.length > 0);
    return { name: "Edit", title: `Edit ${paths.join(", ")}`, input: paths.join("\n"), output: changes.map((c) => `${str(c.kind) ?? "change"} ${str(c.path) ?? ""}`).join("\n"), failed: status === "failed" || status === "declined" };
  }
  if (item.type === "mcp_tool_call") {
    const server = str(item.server) ?? "?";
    const tool = str(item.tool) ?? "?";
    return { name: `mcp__${server}__${tool}`, title: `${server}: ${tool}`, input: JSON.stringify(item.arguments ?? {}), output: JSON.stringify(item.error ?? item.result ?? null), failed: status === "failed" || item.error !== undefined && item.error !== null };
  }
  if (item.type === "web_search") return { name: "WebSearch", title: `Search the web: ${firstLine(str(item.query) ?? "", 80)}`, input: str(item.query) ?? "", output: "", failed: false };
  if (item.type === "todo_list") return { name: "TodoWrite", title: "Update the to-do list", input: "", output: (Array.isArray(item.items) ? item.items.filter(isRecord) : []).map((t) => `${t.completed === true ? "[x]" : "[ ]"} ${str(t.text) ?? ""}`).join("\n"), failed: false };
  if (item.type === "collab_tool_call") return { name: "Agent", title: `Agent: ${str(item.tool) ?? "a sub-agent"}`, input: JSON.stringify(item.arguments ?? {}), output: "", failed: status === "failed" };
  return null;
}

// Scopes a Codex provider item id to its Orbit run so reused per-invocation ids (`item_0`, `cmd_1`) stay stable within
// one execution and never collide across resumed turns, sessions or accounts.
export const codexScopedId = (runId: string, rawId: string): string => `${runId}:${rawId}`;

export const isCodexScopedId = (id: string, runId: string): boolean => id.startsWith(`${runId}:`);

export class CodexStreamMapper {
  init: InitInfo | null = null;
  result: ResultInfo | null = null;
  // Tools started and not yet finished, and the last message written (the turn's answer).
  private readonly pending = new Set<string>();
  private lastText: string | null = null;
  private turns = 0;
  private itemSeq = 0;

  constructor(private readonly o: { runId: string; requestedModel: ModelChoice; requestedEffort: EffortChoice; requestedMode: ModeChoice; resumed: boolean }) {}

  push(event: unknown): MappedEvent[] {
    if (!isRecord(event)) return [];
    if (event.type === "thread.started") return this.onThread(str(event.thread_id) ?? "");
    if ((event.type === "item.started" || event.type === "item.completed") && isRecord(event.item)) return this.onItem(event.type === "item.completed", event.item);
    if (event.type === "turn.completed") {
      this.turns += 1;
      this.result = { subtype: "success", isError: false, text: this.lastText ?? "", costUsd: null, turns: this.turns, durationMs: null, permissionDenials: 0 };
      return [];
    }
    if (event.type === "turn.failed") {
      const message = isRecord(event.error) ? (str(event.error.message) ?? "") : "";
      this.result = { subtype: "error", isError: true, text: redactSecrets(message).slice(0, 2000), costUsd: null, turns: this.turns, durationMs: null, permissionDenials: 0 };
      return [];
    }
    if (event.type === "error" && typeof event.message === "string") return [{ type: "run.notice", data: { kind: "info", message: redactSecrets(event.message).slice(0, 500) } }];
    return [];
  }

  // The run ended: a tool that never finished is said to have been cut off.
  finish(): MappedEvent[] {
    const cut: MappedEvent[] = [...this.pending].map((toolUseId) => ({ type: "tool.failed", data: { toolUseId, output: "The run ended before this tool reported a result.", truncated: false, isError: true, interrupted: true, parentToolUseId: null } }));
    this.pending.clear();
    return cut;
  }

  private onThread(threadId: string): MappedEvent[] {
    this.init = { sessionId: threadId, version: null, model: this.o.requestedModel, orbitLoaded: false };
    return [
      {
        type: "session.started",
        data: { runtime: "codex", claudeSessionId: threadId, claudeCodeVersion: null, model: this.o.requestedModel, requestedModel: this.o.requestedModel, requestedEffort: this.o.requestedEffort, requestedMode: this.o.requestedMode, permissionMode: null, plugins: [], orbitLoaded: false, orbitVersion: null, resumed: this.o.resumed },
      },
    ];
  }

  private itemId(item: Json): string {
    const raw = str(item.id);
    const local = raw !== null && raw.length > 0 ? raw : `item-${++this.itemSeq}`;
    return isCodexScopedId(local, this.o.runId) ? local : codexScopedId(this.o.runId, local);
  }

  private onItem(completed: boolean, item: Json): MappedEvent[] {
    const id = this.itemId(item);
    if (item.type === "agent_message") return completed ? this.message(id, str(item.text) ?? "") : [];
    // Codex's warnings (a setting it ignores, an instruction file cut short): said, never an error of the run.
    if (item.type === "error") return completed ? [{ type: "run.notice", data: { kind: "info", message: redactSecrets(str(item.message) ?? "").slice(0, 500) } }] : [];
    const tool = toolOf(item);
    if (tool === null) return [];
    const out: MappedEvent[] = [];
    if (!this.pending.has(id)) {
      const input = bounded(tool.input, TOOL_INPUT_LIMIT);
      out.push({ type: "tool.started", data: { toolUseId: id, name: tool.name, title: redactSecrets(tool.title), input: input.text, inputTruncated: input.truncated, parentToolUseId: null, agent: null } });
      this.pending.add(id);
    }
    if (!completed) return out;
    this.pending.delete(id);
    const output = bounded(tool.output, TOOL_OUTPUT_LIMIT);
    const data = { toolUseId: id, output: output.text, truncated: output.truncated, isError: tool.failed, interrupted: false, parentToolUseId: null };
    out.push(tool.failed ? { type: "tool.failed", data } : { type: "tool.completed", data });
    return out;
  }

  private message(id: string, raw: string): MappedEvent[] {
    const text = bounded(raw, TEXT_LIMIT);
    this.lastText = text.text;
    return [
      { type: "message.started", data: { messageId: id, role: "assistant", parentToolUseId: null } },
      { type: "message.completed", data: { messageId: id, role: "assistant", text: text.text, parentToolUseId: null, partial: false, truncated: text.truncated } },
    ];
  }
}
