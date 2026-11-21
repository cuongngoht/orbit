// THE RUNTIMES AN EMPLOYEE CAN RUN ON (Execution): one adapter per AI CLI -- how its model plane is started, what its
// stream says, and what its first line must report (fail closed). Each adapter also says, from what was OBSERVED of the
// connection's installed binary (its capability probe, never documentation), whether an employee may run on it at all:
// the model plane must be held to Orbit's tools -- no built-in tool that executes, reads or writes locally beside the
// login -- or nothing starts.
//
//   claude  Claude Code: implemented (claude-employee.adapter.ts); its capability `toolPlaneSplit` is "yes" when the
//           installed binary lists --tools, --restricted and --strict-mcp-config.
//   codex   OpenAI Codex: the adapter is written against `codex exec --json` as documented (fixture-tested only: no
//           binary or account here). Its documented switches turn its shell tool off but not its patch and exec tools,
//           so its capability stays "unknown" and its employees are refused, with that reason, until a version can.
//   agy     Google Antigravity: no non-interactive mode Orbit Web could hold to its tools is documented: refused.
import type { RuntimeKind } from "@orbit-web/contracts";
import type { ConnectionFacts } from "../../workforce/infrastructure/connections.reader.js";
import { emptyFacts, employeeArgs, employeeEnv, foldLine, initViolation, type EmployeeRunInput, type StreamFacts } from "./claude-employee.adapter.js";

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export interface EmployeeRuntime {
  readonly runtime: RuntimeKind;
  // Why an employee cannot run on this connection here (null: it can).
  refusal(c: Pick<ConnectionFacts, "label" | "capabilities">): string | null;
  // The program's name on the model plane's PATH.
  readonly program: string;
  args(o: EmployeeRunInput): string[];
  env(base: Record<string, string>, home: string, apiKey: string | null): Record<string, string>;
  // Whether a stream line is the one the first check reads, and what that check says.
  isInit(line: Json): boolean;
  initViolation(line: Json, webSearch: boolean): string | null;
  fold(facts: StreamFacts, line: Json, webSearch: boolean): StreamFacts;
}

const notSplit = (label: string, how: string): string => `${label} cannot run an AI employee here: its model plane could not be held to Orbit's tools (${how}), and Orbit Web never runs a CLI's login beside tools that execute locally.`;

export const CLAUDE_RUNTIME: EmployeeRuntime = {
  runtime: "claude",
  program: "claude",
  refusal: (c) => (c.capabilities.toolPlaneSplit === "yes" ? null : notSplit(`The Claude Code connection "${c.label}"`, `its installed CLI does not list --tools, --restricted and --strict-mcp-config (observed: ${c.capabilities.toolPlaneSplit})`)),
  args: employeeArgs,
  env: employeeEnv,
  isInit: (line) => line.type === "system" && line.subtype === "init",
  initViolation,
  fold: foldLine,
};

// ---- OpenAI Codex: `codex exec --json` ---------------------------------------------------------------------------------

const toml = (v: unknown): string => JSON.stringify(v);
const CODEX_BRIDGE = "orbit_tools";

export function codexArgs(o: EmployeeRunInput): string[] {
  return [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--model",
    o.model,
    "--sandbox",
    "read-only",
    "-c",
    `approval_policy=${toml("never")}`,
    "-c",
    "features.shell_tool=false",
    "-c",
    `tools.web_search=${o.webSearch ? "true" : "false"}`,
    ...(o.effort !== null ? ["-c", `model_reasoning_effort=${toml(o.effort)}`] : []),
    "-c",
    `mcp_servers.${CODEX_BRIDGE}.command=${toml(o.bridge.command)}`,
    "-c",
    `mcp_servers.${CODEX_BRIDGE}.args=${toml(o.bridge.args)}`,
    "-c",
    `mcp_servers.${CODEX_BRIDGE}.env=${toml(o.bridge.env)}`,
    "-c",
    `developer_instructions=${toml(o.systemPrompt)}`,
    // The task on stdin.
    "-",
  ];
}

export const codexEnv = (base: Record<string, string>, home: string, apiKey: string | null): Record<string, string> => ({ ...base, CODEX_HOME: `${home}/codex`, ...(apiKey !== null ? { CODEX_API_KEY: apiKey } : {}) });

// One event of `codex exec --json`, folded. A built-in executor that ran on the model plane (a command, a file change), an
// MCP server other than Orbit's, or a web search the run was not given: a violation (the worker stops it).
export function codexFold(facts: StreamFacts, line: Json, webSearch: boolean): StreamFacts {
  if (line.type === "thread.started") return { ...facts, init: { model: null, version: null, sessionId: typeof line.thread_id === "string" ? line.thread_id : null, tools: [], plugins: [] } };
  if ((line.type === "item.started" || line.type === "item.completed") && isRecord(line.item)) {
    const item = line.item;
    if (item.type === "command_execution" || item.type === "file_change") return { ...facts, foreignTool: String(item.type) };
    if (item.type === "mcp_tool_call") {
      if (item.server !== CODEX_BRIDGE) return { ...facts, foreignTool: `mcp:${String(item.server)}` };
      return line.type === "item.completed" ? { ...facts, toolCalls: facts.toolCalls + 1 } : facts;
    }
    if (item.type === "web_search") {
      if (!webSearch) return { ...facts, foreignTool: "web_search" };
      return line.type === "item.completed" ? { ...facts, webSearches: facts.webSearches + 1 } : facts;
    }
    if (item.type === "agent_message" && line.type === "item.completed" && typeof item.text === "string") return { ...facts, result: { costUsd: null, turns: facts.result?.turns ?? null, durationMs: null, isError: false, subtype: null, text: item.text.slice(0, 2000) } };
    return facts;
  }
  if (line.type === "turn.completed") return { ...facts, result: { costUsd: null, turns: (facts.result?.turns ?? 0) + 1, durationMs: null, isError: false, subtype: "completed", text: facts.result?.text ?? null } };
  if (line.type === "turn.failed" || line.type === "error") {
    const message = isRecord(line.error) ? String(line.error.message ?? "") : String(line.message ?? "");
    return { ...facts, result: { costUsd: null, turns: facts.result?.turns ?? null, durationMs: null, isError: true, subtype: "failed", text: message.slice(0, 500) } };
  }
  return facts;
}

export const CODEX_RUNTIME: EmployeeRuntime = {
  runtime: "codex",
  program: "codex",
  refusal: (c) => (c.capabilities.toolPlaneSplit === "yes" ? null : notSplit(`OpenAI Codex ("${c.label}")`, `its documented switches turn its shell tool off but not its patch and exec tools; observed: ${c.capabilities.toolPlaneSplit}`)),
  args: codexArgs,
  env: codexEnv,
  isInit: (line) => line.type === "thread.started",
  // Codex's first line names no tool list: what it may do is held by every later line (codexFold).
  initViolation: () => null,
  fold: codexFold,
};

export const AGY_RUNTIME: EmployeeRuntime = {
  runtime: "agy",
  program: "agy",
  refusal: (c) => notSplit(`Google Antigravity ("${c.label}")`, "it documents no non-interactive mode with a closed set of tools, only deny rules"),
  args: () => [],
  env: (base) => base,
  isInit: () => false,
  initViolation: () => "Google Antigravity is not run for employees.",
  fold: (facts) => facts,
};

export const EMPLOYEE_RUNTIMES: Record<RuntimeKind, EmployeeRuntime> = { claude: CLAUDE_RUNTIME, codex: CODEX_RUNTIME, agy: AGY_RUNTIME };

export { emptyFacts };
