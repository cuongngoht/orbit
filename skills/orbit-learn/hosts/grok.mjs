// Grok Build (xAI's `grok` CLI), protocol 2 (1.8.9). Native hook transport only, mapped from payloads MEASURED on
// grok 1.0.62 (test/fixtures/hooks/grok-v2/): the envelope is camelCase with Claude's snake_case aliases beside it --
// `session_id`, `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, and `hook_event_name` in Claude's PascalCase
// -- and Grok names its own tools. Only a tool whose payload has been seen is mapped; every other one is `other`.
//
// What Grok cannot carry is said, never filled in. Its SessionStart reads only a `systemMessage`, which a PERSON sees,
// and it drops an allowing UserPromptSubmit hook's output, so neither the startup recall nor the router's advice
// reaches the model: both answer nothing here. A command's end IS carried: `run_terminal_command` reports its
// `exit_code` and whether it timed out. A turn is Grok's `promptId`. Grok fires one more Stop at teardown, with a
// `reason` other than `end_turn`; that is the session ending, which SessionEnd reports, never a turn.
import { isAbsolute } from "node:path";

export const name = "grok";
export const protocol = 2;
export const matches = () => false;

const EVENTS = new Set(["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "SessionEnd"]);

// [kind, the input key naming its path, the input key naming its pattern], each read off a real payload.
const TOOLS = {
  run_terminal_command: ["command"],
  read_file: ["read", "target_file"],
  search_replace: ["edit", "file_path"],
  write: ["edit", "file_path"],
  grep: ["search", "path", "pattern"],
};

// The reasons Grok gives the Stop it fires while the session is torn down.
const TEARDOWN = new Set(["shutdown", "channel_closed"]);

const text = (v) => (typeof v === "string" && v.length > 0 ? v : null);

export const formatSessionStart = () => null;
export const formatPromptContext = () => null;
export const formatPreTool = () => null;
export const formatPostTool = () => null;
export const formatFailure = (value) => (value ? { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: value } } : null);
export const formatDeny = (reason) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
export const isWatched = (input, list) => input?.tool_name === "run_terminal_command" && list.some((s) => String(input?.tool_input?.command ?? "").includes(s));

// The teardown Stop, and a child session's end, are not this session's turn or end.
const ignored = (input) => (input.hook_event_name === "Stop" && TEARDOWN.has(input.reason)) || (input.hook_event_name === "SessionEnd" && Boolean(input.subagentType));

export function normalize(input) {
  if (!EVENTS.has(input?.hook_event_name) || !text(input.cwd) || !isAbsolute(input.cwd) || ignored(input)) return null;
  const outcome = outcomeOf(input);
  return { protocol, hostEvent: input.hook_event_name, event: eventOf(input, outcome), session: text(input.session_id), turn: text(input.promptId), delivery: text(input.tool_use_id), cwd: input.cwd, prompt: input.hook_event_name === "UserPromptSubmit" ? text(input.prompt) : null, outcome, ...toolOf(input) };
}

const eventOf = (input, outcome) => (input.hook_event_name === "PostToolUse" && outcome === "failure" ? "post-tool-failure" : undefined);

const toolOf = (input) => described(input, TOOLS[input.tool_name] ?? ["other"]);

function described(input, [kind, pathKey, patternKey]) {
  const args = input.tool_input ?? {};
  return { tool: { name: text(input.tool_name), kind }, paths: [text(args[pathKey])].filter(Boolean), pattern: text(args[patternKey]), command: kind === "command" ? text(args.command) : null, background: input.isBackgrounded === true, invokes: null };
}

// How a tool call ended, from what Grok carried, and never a success read from silence. Ordered; the last always matches.
const OUTCOMES = [
  { when: (i) => i.hook_event_name === "PostToolUseFailure", outcome: () => "failure" },
  { when: (i) => i.hook_event_name !== "PostToolUse" || i.isBackgrounded === true, outcome: () => "unknown" },
  { when: (i) => i.tool_name === "run_terminal_command", outcome: (i) => EXIT.find((x) => x.when(resultOf(i))).outcome },
  { when: (i) => TOOLS[i.tool_name]?.[0] === "edit", outcome: (i) => (resultOf(i)?.EditsApplied ? "success" : "unknown") },
  { when: () => true, outcome: () => "unknown" },
];

// A shell command's end: a timeout fails it, its exit code says the rest, and no exit code says nothing.
const EXIT = [
  { when: (r) => r?.timed_out === true, outcome: "failure" },
  { when: (r) => r?.exit_code === 0, outcome: "success" },
  { when: (r) => Number.isInteger(r?.exit_code), outcome: "failure" },
  { when: () => true, outcome: "unknown" },
];

const resultOf = (input) => input.tool_response ?? input.toolResult ?? null;

const outcomeOf = (input) => OUTCOMES.find((r) => r.when(input)).outcome(input);
