// Antigravity native hook protocol 2.
import { binding } from "./binding.mjs";
import { isAbsolute, resolve } from "node:path";
import { within } from "../../../src/project/boundary.mjs";


export const name = "antigravity";
export const protocol = 2;
export const matches = () => false;
const ENGINE_CMD = /(^|\s)(node|npm)\s+.*(cli\/|skills\/|--test|test|lint)/;
const commandOf = (input) => input?.toolCall?.args?.CommandLine ?? "";
export const isWatched = (input, list) => input?.toolCall?.name === "run_command" && list.some((w) => String(commandOf(input)).includes(w));
export const formatPreTool = (input) => input?.toolCall?.name === "run_command" ? { decision: ENGINE_CMD.test(commandOf(input)) ? "allow" : "ask" } : null;
export const formatPostTool = () => ({});
export const formatFailure = () => ({});
export const formatDeny = (reason) => ({ decision: "deny", reason });
export const formatSessionStart = (value, input) => ({ injectSteps: [{ ephemeralMessage: [value, binding(name, input?.conversationId)].filter(Boolean).join("\n\n") }] });
export const formatStop = () => ({ decision: "stop" });
// AGY CLI 1.2.12's tools (measured), and the file tools AGY CLI 1.4.2 sends instead (measured: `read_file`,
// `write_file` and `edit_file`, each naming its file `Path`; 1.4.2 has no list, find or search tool of its own).
const TOOLS = { run_command: ["command"], view_file: ["read", "AbsolutePath"], list_dir: ["read", "DirectoryPath"], write_to_file: ["edit", "TargetFile"], replace_file_content: ["edit", "TargetFile"], multi_replace_file_content: ["edit", "TargetFile"], find_by_name: ["search", "SearchDirectory", "Pattern"], grep_search: ["search", "SearchPath", "Query"], read_file: ["read", "Path"], write_file: ["edit", "Path"], edit_file: ["edit", "Path"] };
const text = (v) => typeof v === "string" ? v : null;

export function normalize(input, argv = []) {
  const hostEvent = argv.find((a) => a.startsWith("--event="))?.slice(8);
  const cwd = cwdOf(input);
  if (!cwd || !["PreInvocation", "PreToolUse", "PostToolUse", "Stop"].includes(hostEvent)) return null;
  if (hostEvent === "PreInvocation" && input?.invocationNum !== 0) return null;
  return normalized(input, hostEvent, cwd);
}

function normalized(input, hostEvent, cwd) {
  const outcome = outcomeOf(input, hostEvent);
  return { protocol, hostEvent, event: hostEvent === "PostToolUse" && outcome === "failure" ? "post-tool-failure" : undefined, session: text(input.conversationId), turn: null, delivery: deliveryOf(input), cwd, outcome, idle: input.fullyIdle === true, ...toolOf(input) };
}

// Measured on AGY CLI 1.2.12: a tool payload carries `stepIdx` and no
// `executionNum`; the step index keeps counting across every execution of one
// conversation (in one process and across `-c`), and a call's Pre and Post share
// it -- so, inside the session, it names one tool call. `executionNum` is 0 on
// every Stop, so it names no turn, and the turn stays unknown rather than one
// number every turn shares.
const deliveryOf = (input) => Number.isInteger(input.stepIdx) ? String(input.stepIdx) : null;

function cwdOf(input) {
  const roots = (input?.workspacePaths ?? []).filter((p) => typeof p === "string" && isAbsolute(p));
  const args = input?.toolCall?.args ?? {};
  const selected = [args.Cwd, args.TargetFile, args.AbsolutePath, args.Path, args.DirectoryPath, args.SearchPath, args.SearchDirectory, input?.cwd].find((p) => typeof p === "string" && isAbsolute(p));
  if (selected) return roots.filter((r) => within(r, resolve(selected))).sort((a, b) => b.length - a.length)[0] ?? null;
  return roots.length === 1 ? roots[0] : null;
}

function toolOf(input) {
  const args = input.toolCall?.args ?? {};
  const row = TOOLS[input.toolCall?.name] ?? ["other"];
  return { tool: { name: text(input.toolCall?.name), kind: row[0] }, paths: [text(args[row[1]])].filter(Boolean), pattern: text(args[row[2]]), command: row[0] === "command" ? text(args.CommandLine) : null, background: args.RunPersistent === true, invokes: null };
}

function outcomeOf(input, event) {
  if (event !== "PostToolUse") return "unknown";
  if (typeof input.error === "string" && input.error.length) return "failure";
  if (input.toolCall?.name === "run_command") return "unknown";
  return input.error === "" ? "success" : "unknown";
}
