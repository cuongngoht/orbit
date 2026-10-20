// Native hook transport only. Outcomes without structured proof stay unknown.
import { binding } from "./binding.mjs";
import { isAbsolute } from "node:path";

export const name = "codex";
export const protocol = 2;
export const matches = () => false;
const EVENTS = new Set(["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "SessionEnd"]);
const KINDS = { Bash: "command", apply_patch: "edit" };
const text = (v) => typeof v === "string" ? v : null;
const context = (event, value) => value ? { hookSpecificOutput: { hookEventName: event, additionalContext: value } } : null;
export const formatSessionStart = (value, input) => context("SessionStart", [value, binding(name, input?.session_id)].filter(Boolean).join("\n\n"));
export const formatPromptContext = (value) => context("UserPromptSubmit", value);
export const formatFailure = (value) => context("PostToolUse", value);
export const formatPreTool = () => null;
export const formatPostTool = () => null;
export const formatDeny = (reason) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
export const isWatched = (input, list) => input?.tool_name === "Bash" && list.some((s) => String(input?.tool_input?.command ?? "").includes(s));

export function normalize(input) {
  if (!EVENTS.has(input?.hook_event_name) || !text(input.cwd) || !isAbsolute(input.cwd)) return null;
  const outcome = outcomeOf(input);
  return { protocol, hostEvent: input.hook_event_name, event: failureEvent(input, outcome), session: text(input.session_id), turn: text(input.turn_id), delivery: text(input.tool_use_id), cwd: input.cwd, prompt: input.hook_event_name === "UserPromptSubmit" ? text(input.prompt) : null, outcome, ...toolOf(input) };
}

const failureEvent = (input, outcome) => input.hook_event_name === "PostToolUse" && outcome === "failure" ? "post-tool-failure" : undefined;
const patchPaths = (patch) => String(patch ?? "").split("\n").filter((l) => /^\*\*\* (Add|Update|Delete) File: |^\*\*\* Move to: /.test(l)).map((l) => l.slice(l.indexOf(": ") + 2)).slice(0, 20);
const toolOf = (input) => ({ tool: { name: text(input.tool_name), kind: KINDS[input.tool_name] ?? "other" }, paths: input.tool_name === "apply_patch" ? patchPaths(input.tool_input?.command) : [], pattern: null, command: input.tool_name === "Bash" ? text(input.tool_input?.command) : null, background: input.tool_input?.run_in_background === true, invokes: null });

function outcomeOf(input) {
  if (input.hook_event_name !== "PostToolUse" || input.tool_input?.run_in_background === true) return "unknown";
  const result = input.tool_response;
  if (input.tool_name?.startsWith("mcp__") && result?.isError === true) return "failure";
  return "unknown";
}
