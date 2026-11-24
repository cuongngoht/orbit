// THE RUNTIMES AN EMPLOYEE CAN RUN ON (Execution): one adapter per AI CLI -- how its model plane is started, what its
// stream says, and what its first line must report (fail closed). Each adapter also says, from what was OBSERVED of the
// connection's installed binary (its capability probe, never documentation), whether an employee may run on it at all:
// the model plane must be held to Orbit's tools -- no built-in tool that executes, reads or writes locally beside the
// login -- or nothing starts.
//
//   claude  Claude Code: implemented (claude-employee.adapter.ts); its capability `toolPlaneSplit` is "yes" when the
//           installed binary lists --tools, --restricted and --strict-mcp-config.
//   codex   OpenAI Codex: `codex exec --json`, held as OBSERVED on codex-cli 0.169.0 (a stand-in model provider on the
//           loopback recorded every tool the binary offers a model): every feature that runs, writes or reads locally
//           switched off, the model's catalog entry Orbit's own (no patch tool, no code mode, no sub-agents, no tool
//           search, text only -- so its image viewer refuses every call), Orbit's bridge the one MCP server, required
//           and approved. Its capability `toolPlaneSplit` is "yes" only once that observation held for the account's
//           models (modules/connections/codex-split.ts); until then its employees are refused, with that reason.
//   agy     Google Antigravity: no non-interactive mode Orbit Web could hold to its tools is documented: refused.
import type { AuthState, ConnectionCatalog, EmployeeReadiness, RuntimeCapabilities, RuntimeKind } from "@orbit-web/contracts";
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

// Every feature of codex-cli 0.169.0 that runs, writes or reads something locally, or brings tools of its own (`codex
// features list`): switched off for an employee's model plane.
export const CODEX_EMPLOYEE_FEATURES_OFF = [
  "shell_tool",
  "unified_exec",
  "unified_exec_tty",
  "shell_snapshot",
  "code_mode_host",
  "code_mode_host_grpc",
  "apps",
  "plugins",
  "remote_plugin",
  "hooks",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "image_generation",
  "multi_agent",
  "multi_agent_v2",
  "goals",
  "skill_mcp_dependency_install",
  "sleep_tool",
] as const;

// Where a model plane holds Orbit's catalog entry for the model it runs (in the CLI's own working directory).
export const CODEX_MODEL_FILE = ".orbit-codex-model.json";

type Entry = Record<string, unknown>;

// A model's own catalog entry (`codex debug models`), made Orbit's for an employee: the fields that give the model a tool
// of Codex's own are removed or turned off -- the patch tool, code mode (which runs the model's code and calls the
// other tools from it), sub-agents, the deferred tool search (Orbit's tools are offered as they are), and images (its
// image viewer then refuses every call before reading anything). Everything else stays the model's.
export function neutralizedCodexModel(entry: Entry): Entry {
  const { apply_patch_tool_type: _patch, tool_mode: _mode, multi_agent_version: _agents, ...rest } = entry;
  return { ...rest, experimental_supported_tools: [], node_repl_disabled: true, input_modalities: ["text"], supports_search_tool: false };
}

// The bridge as Codex's one MCP server: the whole table set, so no other server is read; required, so a bridge that
// cannot start or list its tools ends the session before any model is asked; its tools approved, as Orbit holds them.
function bridgeTable(o: EmployeeRunInput): string {
  const env = Object.entries(o.bridge.env).map(([k, v]) => `${k}=${toml(v)}`).join(",");
  return `mcp_servers={${CODEX_BRIDGE}={command=${toml(o.bridge.command)},args=${toml(o.bridge.args)},env={${env}},required=true,default_tools_approval_mode="approve"}}`;
}

export function codexArgs(o: EmployeeRunInput): string[] {
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "--model",
    o.model,
    ...(o.effort !== null ? ["-c", `model_reasoning_effort=${toml(o.effort)}`] : []),
    ...CODEX_EMPLOYEE_FEATURES_OFF.flatMap((f) => ["--disable", f]),
    "-c",
    `web_search=${toml(o.webSearch ? "live" : "disabled")}`,
    "-c",
    bridgeTable(o),
    ...(o.modelFile ? ["-c", `model_catalog_json=${toml(o.modelFile)}`] : []),
    "-c",
    `developer_instructions=${toml(o.systemPrompt)}`,
    // The task on stdin.
    "-",
  ];
}

export const codexEnv = (base: Record<string, string>, home: string, apiKey: string | null): Record<string, string> => ({ ...base, CODEX_HOME: `${home}/codex`, ...(apiKey !== null ? { CODEX_API_KEY: apiKey } : {}) });

// The items an employee's Codex may show: its messages and reasoning, its plan list, its warnings (`error` items), Orbit's
// tools -- and the provider's own search when the run was given it. Anything else, an item nobody has seen above all, is
// a violation (the worker stops it): a command, a file change, a sub-agent, another MCP server.
const QUIET_ITEMS = new Set(["agent_message", "reasoning", "todo_list", "error"]);

// One event of `codex exec --json`, folded.
export function codexFold(facts: StreamFacts, line: Json, webSearch: boolean): StreamFacts {
  if (line.type === "thread.started") return { ...facts, init: { model: null, version: null, sessionId: typeof line.thread_id === "string" ? line.thread_id : null, tools: [], plugins: [], mcpServers: [] } };
  if ((line.type === "item.started" || line.type === "item.updated" || line.type === "item.completed") && isRecord(line.item)) {
    const item = line.item;
    const type = String(item.type);
    if (item.type === "mcp_tool_call") {
      if (item.server !== CODEX_BRIDGE) return { ...facts, foreignTool: `mcp:${String(item.server)}` };
      return line.type === "item.completed" ? { ...facts, toolCalls: facts.toolCalls + 1 } : facts;
    }
    if (item.type === "web_search") {
      if (!webSearch) return { ...facts, foreignTool: "web_search" };
      return line.type === "item.completed" ? { ...facts, webSearches: facts.webSearches + 1 } : facts;
    }
    if (!QUIET_ITEMS.has(type)) return { ...facts, foreignTool: type };
    if (item.type === "agent_message" && line.type === "item.completed" && typeof item.text === "string") return { ...facts, result: { costUsd: null, turns: facts.result?.turns ?? null, durationMs: null, isError: false, subtype: null, text: item.text.slice(0, 2000) } };
    return facts;
  }
  if (line.type === "turn.completed") return { ...facts, result: { costUsd: null, turns: (facts.result?.turns ?? 0) + 1, durationMs: null, isError: false, subtype: "completed", text: facts.result?.text ?? null } };
  if (line.type === "turn.failed") {
    const message = isRecord(line.error) ? String(line.error.message ?? "") : String(line.message ?? "");
    return { ...facts, result: { costUsd: null, turns: facts.result?.turns ?? null, durationMs: null, isError: true, subtype: "failed", text: message.slice(0, 500) } };
  }
  return facts;
}

export const CODEX_RUNTIME: EmployeeRuntime = {
  runtime: "codex",
  program: "codex",
  refusal: (c) => (c.capabilities.toolPlaneSplit === "yes" ? null : notSplit(`OpenAI Codex ("${c.label}")`, `the tools its installed CLI offers a model were not observed to be Orbit's alone; observed: ${c.capabilities.toolPlaneSplit}`)),
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

// WHETHER A CONNECTION CAN RUN EMPLOYEES, and the reason a person acts on when it cannot -- one answer for the page that
// offers it (AI Connections, Hire) and the same facts hire and dispatch hold a run to (usable + the runtime's refusal):
// connected, its models read from the account (never a fallback list), and its model plane observed held to Orbit's
// tools.
export function employeeReadiness(c: { runtime: RuntimeKind; label: string; auth: AuthState; reason: string | null; catalog: ConnectionCatalog; capabilities: RuntimeCapabilities }): EmployeeReadiness {
  // Antigravity runs no employee at all (no non-interactive mode with a closed tool set): said as what the runtime is.
  if (c.runtime === "agy") return { ready: false, reason: EMPLOYEE_RUNTIMES.agy.refusal(c), reasonCode: "runtime_not_supported" };
  if (c.auth !== "connected") return { ready: false, reason: `not connected (${c.reason ?? "its CLI says it is not signed in"})`, reasonCode: "not_connected" };
  if (c.catalog.source !== "account") return { ready: false, reason: "its models were not read from the account", reasonCode: "catalog_not_from_account" };
  if (c.catalog.models.length === 0) return { ready: false, reason: "its account offers no model", reasonCode: "no_models" };
  if (EMPLOYEE_RUNTIMES[c.runtime].refusal(c) !== null) return { ready: false, reason: `its model plane is not held to Orbit's tools (Run without local tools: ${c.capabilities.toolPlaneSplit})`, reasonCode: "not_held" };
  return { ready: true, reason: null, reasonCode: null };
}

export { emptyFacts };
