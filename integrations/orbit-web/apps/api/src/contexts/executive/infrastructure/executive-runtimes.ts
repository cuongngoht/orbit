// HOW THE CEO IS RUN (Executive, infrastructure; ADR 0062) -- one STRATEGY per AI CLI, kept in one REGISTRY. What the CEO
// is asked (executive-prompt.ts: an answer, and later a staffing plan or a profile draft) is runtime-free; how a CLI is
// started, held to no tool, and read is what differs per CLI, and it lives here alone. So TurnRunner keeps one lifecycle
// (ready → sandbox → start → stream → finalize) and no line of it names a runtime; a third runtime is one row here.
//
//   - refusal():   what refuses a turn on this runtime before anything starts (Codex takes no spending cap).
//   - toolless():  the capability PROOF, per runtime, never assumed from switches: Claude Code's start line lists its
//                  tools (none, or the turn stops: violation); Codex is OBSERVED answering with no tool that acts on the
//                  installed binary and this model (codex-split.ts observeCodexToolless), once per version and entry,
//                  and its connection's home holds no global instructions it would add to the fixed prompt.
//   - mapper():    the ADAPTER: both CLIs' JSON lines become the chat's own events, so the outcome rules are shared.
//   - violation(): a SPECIFICATION that fails closed: a line showing a tool -- or an item nobody has seen -- stops the turn.
//
// A runtime with no row (Antigravity) cannot answer in CEO Chat: the turn is refused as runtime_unsupported, saying why.
import type { EffortChoice, ModelChoice, RuntimeKind } from "@orbit-web/contracts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../../../config/config.js";
import { claudeEnv, codexEnv } from "../../../infra/process/env.js";
import { CodexStreamMapper } from "../../../modules/claude-runner/codex-chat.js";
import { StreamMapper, type MappedEvent, type ResultInfo } from "../../../modules/claude-runner/stream-mapper.js";
import { CODEX_GLOBAL_INSTRUCTIONS } from "../../../modules/connections/codex-split.js";
import type { ConnectionProbe } from "../../../modules/connections/probe.js";
import type { RunConnection } from "../../../modules/connections/run-connections.js";
import { forbiddenInit } from "../../../modules/research/runner/research-runner.service.js";
import { codexToollessArgs } from "../../execution/infrastructure/employee-runtimes.js";
import { EXECUTIVE_SYSTEM_PROMPT, executiveArgs } from "./executive-prompt.js";

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

// What a CLI's JSON lines become: the chat's own events (stream-mapper.ts), and the CLI's own result line.
export interface ChatStreamMapper {
  readonly result: ResultInfo | null;
  push(raw: unknown): MappedEvent[];
  finish(): MappedEvent[];
}

// A tool-less answer, proved for this connection and model: with the model entry the CLI is given (Codex: Orbit's
// entry, the one observed), or none (Claude Code) -- or why it cannot answer.
export type ToollessProof = { ok: true; modelEntry: string | null } | { ok: false; reason: string };

export interface ExecutiveRuntime {
  readonly kind: "claude" | "codex";
  // What an outcome names the CLI (decideOutcome's `cli`).
  readonly label: string;
  refusal(config: AppConfig): string | null;
  toolless(probe: ConnectionProbe | null, rc: RunConnection, model: string): Promise<ToollessProof>;
  binary(config: AppConfig): string;
  // The command line, the fixed system prompt inside it; what the CEO is asked arrives on stdin.
  args(o: { model: string; effort: string | null; maxBudgetUsd: number | null; modelFile: string | null }): string[];
  // The connection's own home (and key); governance's variables are added by the runner, whatever the runtime.
  env(config: AppConfig, rc: RunConnection): Record<string, string>;
  mapper(o: { runId: string; model: string; effort: string | null; cwd: string }): ChatStreamMapper;
  violation(raw: Json): string | null;
}

export const CLAUDE_EXECUTIVE: ExecutiveRuntime = {
  kind: "claude",
  label: "Claude Code",
  refusal: () => null,
  // `--tools ""` leaves it none, and its start line says so -- or the turn stops there (violation).
  toolless: () => Promise.resolve({ ok: true, modelEntry: null }),
  binary: (config) => config.binaries.claude,
  args: (o) => executiveArgs({ model: o.model, effort: o.effort, maxBudgetUsd: o.maxBudgetUsd }),
  env: (config, rc) => ({ ...claudeEnv(config, rc.configDir), ...rc.secretEnv, ENABLE_CLAUDEAI_MCP_SERVERS: "false" }),
  mapper: (o) => new StreamMapper({ requestedModel: o.model as ModelChoice, requestedEffort: o.effort as EffortChoice, requestedMode: "plan", resumed: false, cwd: o.cwd }),
  violation: (raw) => (raw.type === "system" && raw.subtype === "init" ? (forbiddenInit(raw, false)?.replace("a research run", "the CEO's answer") ?? null) : null),
};

// What a Codex answer may hold: its message, its reasoning, and its own warnings. Any other item -- a command, an edit,
// an MCP call, a search, a to-do list, a sub-agent, or a kind nobody has seen yet -- stops the turn.
const ANSWER_ITEMS = new Set(["agent_message", "reasoning", "error"]);

export function codexAnswerViolation(raw: Json): string | null {
  if (typeof raw.type !== "string" || !raw.type.startsWith("item.")) return null;
  const kind = isRecord(raw.item) && typeof raw.item.type === "string" ? raw.item.type : "an item with no type";
  return ANSWER_ITEMS.has(kind) ? null : `OpenAI Codex started something other than an answer (${kind}) -- the CEO's answer has no tool, so it was stopped.`;
}

export const CODEX_EXECUTIVE: ExecutiveRuntime = {
  kind: "codex",
  label: "OpenAI Codex",
  refusal: (config) => (config.maxBudgetUsd !== null ? "A spending cap is set for each run (ORBIT_WEB_MAX_BUDGET_USD), and OpenAI Codex cannot be held to it: the CEO cannot answer on it here." : null),
  toolless: async (probe, rc, model) => {
    const own = CODEX_GLOBAL_INSTRUCTIONS.find((f) => existsSync(join(rc.configDir, f)));
    if (own !== undefined) return { ok: false, reason: `its Codex home holds instructions of its own (${own}), which Codex adds to every answer: Orbit's fixed prompt alone is the CEO's` };
    if (probe === null) return { ok: false, reason: "nothing here can observe OpenAI Codex" };
    const held = await probe.codexToollessModel(rc.connection, model);
    return held.split === "yes" && held.file !== null ? { ok: true, modelEntry: held.file } : { ok: false, reason: held.reason ?? "it was not observed answering with no tool" };
  },
  binary: (config) => config.binaries.codex,
  args: (o) => codexToollessArgs({ model: o.model, effort: o.effort, systemPrompt: EXECUTIVE_SYSTEM_PROMPT, modelFile: o.modelFile }),
  env: (config, rc) => codexEnv(config, rc.configDir),
  mapper: (o) => new CodexStreamMapper({ runId: o.runId, requestedModel: o.model as ModelChoice, requestedEffort: o.effort as EffortChoice, requestedMode: "plan", resumed: false }),
  violation: codexAnswerViolation,
};

export const EXECUTIVE_RUNTIMES: Readonly<Record<ExecutiveRuntime["kind"], ExecutiveRuntime>> = { claude: CLAUDE_EXECUTIVE, codex: CODEX_EXECUTIVE };

export const executiveRuntimeOf = (kind: RuntimeKind | string): ExecutiveRuntime | null => (Object.hasOwn(EXECUTIVE_RUNTIMES, kind) ? EXECUTIVE_RUNTIMES[kind as ExecutiveRuntime["kind"]] : null);
