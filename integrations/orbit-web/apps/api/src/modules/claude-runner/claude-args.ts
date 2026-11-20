// The one place Claude Code's command line is written. Headless (`-p`), the prompt on stdin, structured output with
// partial messages, the Orbit plugin (and the chat's project plugins) by directory, a model alias, an effort level, and
// one of the two modes: Autonomous is Claude Code's auto mode (a classifier reviews each action before it runs; in
// `-p` whatever would prompt is denied and reported back as a permission denial), Plan is its plan mode (read and plan,
// change nothing). In both, pushing or driving GitHub from the agent's shell is refused by rule (deny rules bind in
// every mode). There is no bypass mode here, and nothing a request says becomes an argument except the model, effort
// and mode, each checked against its closed list first.
import { MODE_PERMISSION, type EffortChoice, type ModeChoice, type ModelChoice } from "@orbit-web/contracts";

export const BASE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash", "Skill", "Agent", "TodoWrite"];

export const WEB_TOOLS = ["WebFetch", "WebSearch"];

// Defence in depth, not isolation: the agent's shell runs in the same container as the CLIs' sign-ins (README).
export const DENY_RULES = ["Bash(git push:*)", "Bash(gh:*)", "Bash(git credential:*)", "Bash(git config --global:*)"];

export interface ClaudeRunOptions {
  model: ModelChoice;
  effort: EffortChoice;
  mode: ModeChoice;
  // A person let Claude Code use the Azure CLI's sign-in; otherwise `az` is refused to it.
  azure: boolean;
  // Orbit's plugin first, then the chat's project plugins (project.service.ts).
  pluginDirs: string[];
  // The plugins this chat's project declares and Orbit Web installed: enabled for this run only.
  enabledPlugins: Record<string, true>;
  // First turn: the id Orbit Web chose for the Claude session. Later turns: the id to resume.
  sessionId: string;
  resume: boolean;
  webTools: boolean;
  maxBudgetUsd: number | null;
  // Paths the agent may not read or write through its file tools (the sign-ins, Orbit Web's own database).
  protectedDirs: string[];
}

// Claude Code reads a rule path that starts with `//` as an absolute path (a single `/` is relative to the settings
// file), and an Edit rule covers every built-in tool that writes a file.
const fileRules = (dirs: string[]): string[] => dirs.flatMap((d) => [`Read(/${d}/**)`, `Edit(/${d}/**)`]);

export function claudeArgs(o: ClaudeRunOptions): string[] {
  const allowed = [...BASE_TOOLS, ...(o.webTools ? WEB_TOOLS : [])];
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    o.model,
    "--effort",
    o.effort,
    ...o.pluginDirs.flatMap((dir) => ["--plugin-dir", dir]),
    ...(o.resume ? ["--resume", o.sessionId] : ["--session-id", o.sessionId]),
    "--permission-mode",
    MODE_PERMISSION[o.mode],
    "--allowedTools",
    allowed.join(","),
    "--disallowedTools",
    ...DENY_RULES,
    ...(o.azure ? [] : ["Bash(az:*)"]),
    ...fileRules(o.protectedDirs),
    ...(o.webTools ? [] : WEB_TOOLS),
    // The user's settings only: a repository's own .claude/settings.json is untrusted input and could set `env` (an
    // API base URL that would receive the credential) or hooks that run before any tool call.
    "--setting-sources",
    "user",
    "--strict-mcp-config",
    ...(Object.keys(o.enabledPlugins).length > 0 ? ["--settings", JSON.stringify({ enabledPlugins: o.enabledPlugins })] : []),
    ...(o.maxBudgetUsd !== null ? ["--max-budget-usd", String(o.maxBudgetUsd)] : []),
  ];
}
