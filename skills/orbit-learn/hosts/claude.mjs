// Claude Code host adapter for learning lifecycle hooks.
import { discover, kept } from "../native.mjs";

export const name = "claude";

export const matches = (input) => Boolean(input?.hook_event_name);

// Where Claude Code keeps its own memory for this project, as the record the
// async SessionStart hook keeps for later commands (cli/knowledge.mjs locate).
// Discovered from the transcript path the host hands a hook -- never computed --
// and `kept` drops that path and the working directory before anything is
// written. `deps` binds the machine: env, home, read, now, host.
export const memoryLocation = (input, deps) => (input?.hook_event_name ? kept(discover({ transcriptPath: input.transcript_path ?? null, env: deps.env, home: deps.home, cwd: input.cwd ?? deps.cwd, host: deps.host, read: deps.read, now: deps.now })) : null);

export const isWatched = (input, list) =>
  input?.tool_name === "Bash" && list.some((w) => String(input?.tool_input?.command ?? "").includes(w));

export const formatSessionStart = (text) =>
  text ? { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } } : null;

export const formatPreTool = () => null;

// A pre-tool refusal, in the shape Claude Code reads off a PreToolUse hook.
export const formatDeny = (reason) => ({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
});

export const formatPostTool = () => null;

// What the prompt router adds to a prompt, in the shape Claude Code reads off a
// UserPromptSubmit hook: context beside the prompt, never a change to it.
export const formatPromptContext = (text) =>
  text ? { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text } } : null;

export const formatFailure = (text) => ({
  hookSpecificOutput: { hookEventName: "PostToolUseFailure", additionalContext: text },
});

// What kind of work a tool does -- the only thing the working set asks. A tool
// with no row is `other`, and records nothing but that it happened.
const KINDS = { Read: "read", Edit: "edit", Write: "edit", MultiEdit: "edit", NotebookEdit: "edit", Grep: "search", Glob: "search", Bash: "command" };

// Which of a plugin's components a tool call is about to start, and the field
// its name arrives in. `Task` is what the Agent tool was called before.
const INVOKES = { Skill: ["skill", "skill"], Agent: ["agent", "subagent_type"], Task: ["agent", "subagent_type"] };

const invokesOf = (input) => named(INVOKES[input.tool_name], input.tool_input);

const named = (row, args) => (row && typeof args?.[row[1]] === "string" ? { kind: row[0], name: args[row[1]] } : null);

// The lifecycle event, as src/lifecycle/event.mjs expects it. `session_id` is
// handed over RAW and hashed there, never stored as it arrives; `tool_response`
// is never read at all -- output is not something this engine keeps. `prompt`
// is read off UserPromptSubmit alone, and only for the router to look at.
export const normalize = (input) => (input?.hook_event_name ? { hostEvent: input.hook_event_name, session: input.session_id ?? null, cwd: input.cwd ?? process.cwd(), prompt: promptOf(input), ...toolOf(input) } : null);

const promptOf = (input) => (input.hook_event_name === "UserPromptSubmit" && typeof input.prompt === "string" ? input.prompt : null);

const toolOf = (input) => ({
  tool: { name: input.tool_name ?? null, kind: KINDS[input.tool_name] ?? "other" },
  paths: [input.tool_input?.file_path, input.tool_input?.notebook_path, input.tool_input?.path].filter((p) => typeof p === "string"),
  pattern: typeof input.tool_input?.pattern === "string" ? input.tool_input.pattern : null,
  command: typeof input.tool_input?.command === "string" ? input.tool_input.command : null,
  ok: input.hook_event_name !== "PostToolUseFailure",
  background: input.tool_input?.run_in_background === true,
  invokes: invokesOf(input),
});
