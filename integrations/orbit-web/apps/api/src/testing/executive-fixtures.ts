// CEO CHAT in tests: the CEO's answer as the Claude CLI would stream it, or as OpenAI Codex gives it (no tool), each
// recognised by its fixed system prompt.
import { EXECUTIVE_SYSTEM_PROMPT } from "../contexts/executive/infrastructure/executive-prompt.js";
import { program, type SpawnScript } from "./fake-process.js";

// A CEO's answer in CEO Chat: the Claude CLI started with CEO Chat's own system prompt.
export const executiveRun = (file: string, args: string[]): boolean => program("claude", "-p")(file, args) && args.includes(EXECUTIVE_SYSTEM_PROMPT);

// The answer, streamed in two halves; `gate` holds it after the first half (a test stops it, or lets it finish);
// `init` replaces what the CLI says it started with (a tool, say).
export function executiveAnswer(answer: (prompt: string) => string, o: { init?: Record<string, unknown>; gate?: () => Promise<void>; toolCall?: boolean } = {}): SpawnScript {
  return (c) => {
    let signalled = false;
    c.onSignal(() => {
      signalled = true;
      c.exit(null, "SIGINT");
    });
    c.onInputClosed(() => {
      void (async () => {
        const text = answer(c.written.join(""));
        c.line({ type: "system", subtype: "init", session_id: "executive", tools: [], mcp_servers: [], model: "claude-sonnet-5-5", permissionMode: "dontAsk", claude_code_version: "2.1.328", plugins: [], ...o.init });
        c.line({ type: "stream_event", event: { type: "message_start", message: { id: "msg_ceo" } }, parent_tool_use_id: null });
        c.line({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, parent_tool_use_id: null });
        const half = Math.ceil(text.length / 2);
        c.line({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(0, half) } }, parent_tool_use_id: null });
        if (o.toolCall === true) c.line({ type: "assistant", message: { id: "msg_tool", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "ls" } }] }, parent_tool_use_id: null });
        if (o.gate !== undefined) await o.gate();
        if (signalled) return;
        c.line({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(half) } }, parent_tool_use_id: null });
        c.line({ type: "assistant", message: { id: "msg_ceo", content: [{ type: "text", text }] }, parent_tool_use_id: null });
        c.line({ type: "result", subtype: "success", is_error: false, result: text, total_cost_usd: 0.001, num_turns: 1, duration_ms: 500, usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 20 } });
        c.exit(0);
      })();
    });
  };
}

// A CEO's answer on OpenAI Codex: `codex exec --json` given CEO Chat's own system prompt as its developer instructions.
export const executiveCodexRun = (file: string, args: string[]): boolean => program("codex", "exec", "--json")(file, args) && args.includes(`developer_instructions=${JSON.stringify(EXECUTIVE_SYSTEM_PROMPT)}`);

// The answer as Codex gives it: its reasoning, then the whole message at once, then the turn's end. `item` is an item it
// starts first (a tool, say); `gate` holds it before the message (a test stops it, or lets it finish).
export function executiveCodexAnswer(answer: (prompt: string) => string, o: { item?: Record<string, unknown>; gate?: () => Promise<void> } = {}): SpawnScript {
  return (c) => {
    let signalled = false;
    c.onSignal((signal) => {
      signalled = true;
      c.exit(null, signal);
    });
    c.onInputClosed(() => {
      void (async () => {
        const text = answer(c.written.join(""));
        c.line({ type: "thread.started", thread_id: "th_ceo" });
        c.line({ type: "turn.started" });
        c.line({ type: "item.completed", item: { id: "rs_1", type: "reasoning", text: "Reading the records." } });
        if (o.item !== undefined) c.line({ type: "item.started", item: o.item });
        if (o.gate !== undefined) await o.gate();
        if (signalled) return;
        c.line({ type: "item.completed", item: { id: "msg_1", type: "agent_message", text } });
        c.line({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } });
        c.exit(0);
      })();
    });
  };
}
